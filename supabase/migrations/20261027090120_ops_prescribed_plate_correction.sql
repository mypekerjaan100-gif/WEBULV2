-- Admin ULP / Super Admin plate correction for a prescribed vehicle.
--
-- The first plate entry uses ops_set_prescribed_vehicle_plate. This follow-up adds
-- a narrow correction RPC for an already filled plate:
--   * same permission gate: Super Admin or the exact active Admin ULP;
--   * mandatory nonempty reason, recorded in history metadata;
--   * expected-revision conflict protection (SQLSTATE 40001);
--   * scope, overlap, lock, normalization and registry-link rules all stay in
--     ops_prescribed_guard, which runs on every direct table update;
--   * saved monthly reports that embed the OLD plate are rewritten with the new
--     plate under fresh report revisions so saved snapshots display the fix. All
--     condition values, statuses, percentages, items, ordering, and other
--     vehicle metadata stay identical. Every rewritten report and all old
--     monthly history revisions keep their original revision rows untouched.
--
-- ops_vehicle_monthly_guard rejects metadata changes on saved snapshots
-- ("Historical nonempty plates are immutable"). A plate correction must update
-- exactly that metadata, so the same guard gains one extra escape hatch: while
-- ops.correcting_vehicle_plate is 'on', ONLY the plate fields of vehicles whose
-- stored plate differs from their current slot plate may change. Everything else
-- in the report row must stay identical. Normal report saves still cannot touch
-- plates because that mode is never enabled for them. Existing guard behavior is
-- preserved otherwise; the function is replaced idempotently.
--
-- The remote guard was upgraded first during development; this migration carries
-- the same definition so local and remote stay in sync on fresh replays.

create or replace function public.ops_prescribed_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_mutable text[]; v_old jsonb; v_new jsonb; v_ord bigint; v_slot public.ops_prescribed_vehicles;
  v_registry public.ops_vehicles; v_type uuid; v_assignment uuid; v_lock text;
  v_revising boolean; v_location_required boolean; v_plate_correcting boolean;
begin
  if tg_op in ('DELETE', 'TRUNCATE') or tg_table_name in ('ops_vehicle_monthly_history', 'ops_prescribed_vehicle_history') then
    raise exception 'Records cannot be deleted or truncated; history is append-only';
  end if;
  if new.ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_prescribed_assert_scope(new.contract_id, new.up3_id, new.ulp_id);
  perform pg_advisory_xact_lock(hashtextextended('ops_prescribed:' || new.contract_id || ':' || new.up3_id || ':' || new.ulp_id, 0));
  v_revising := coalesce(current_setting('ops.revising_vehicle_fleet', true), '') = 'on';
  v_location_required := coalesce(current_setting('ops.require_prescribed_location', true), '') = 'on';
  v_plate_correcting := coalesce(current_setting('ops.correcting_vehicle_plate', true), '') = 'on';
  if tg_table_name = 'ops_prescribed_vehicles' then
    v_mutable := array['end_month', 'plate_display', 'plate_normalized', 'legacy_vehicle_id', 'revision', 'updated_at', 'updated_by'];
    if tg_op = 'INSERT' or new.end_month is distinct from old.end_month then
      if not public.ops_can_manage_master(new.contract_id, new.up3_id) then raise exception 'Fleet management denied' using errcode = '42501'; end if;
      if tg_op = 'INSERT' then
        if new.plate_display is not null or new.plate_normalized is not null or new.legacy_vehicle_id is not null then
          raise exception 'New slots must be unplated';
        end if;
        if v_location_required and new.location_id is null then
          raise exception 'A location is required for new prescribed vehicles';
        end if;
        if new.location_id is not null and not exists (select 1 from public.locations l
          where l.id = new.location_id and l.contract_id = new.contract_id and l.up3_id = new.up3_id
            and l.unit_id = new.ulp_id and l.type in ('UNIT_OFFICE', 'KANTOR_JAGA') and l.own_status = 'Aktif') then
          raise exception 'An active UNIT_OFFICE or KANTOR_JAGA in the same ULP is required';
        end if;
        if not exists (select 1 from public.ops_equipment_templates t where t.id = new.template_id
          and t.contract_id = new.contract_id and t.up3_id = new.up3_id and t.status = 'Aktif') then
          raise exception 'An active template in the same scope is required';
        end if;
        if not v_revising and exists (select 1 from public.ops_vehicle_monthly_reports r where r.contract_id = new.contract_id
          and r.up3_id = new.up3_id and r.ulp_id = new.ulp_id and r.period_month >= new.effective_month) then
          raise exception 'Creation would alter an already frozen monthly fleet';
        end if;
      else
        if old.end_month is not null or new.end_month is null then raise exception 'An ended slot cannot be reopened or rescheduled'; end if;
        if (to_jsonb(new) - array['end_month', 'revision', 'updated_at', 'updated_by'])
          is distinct from (to_jsonb(old) - array['end_month', 'revision', 'updated_at', 'updated_by']) then
          raise exception 'Ending a slot cannot also change its plate or identity';
        end if;
        if exists (select 1 from public.ops_vehicle_monthly_reports r where r.contract_id = new.contract_id
          and r.up3_id = new.up3_id and r.ulp_id = new.ulp_id and r.period_month >= new.end_month
          and r.vehicles @> jsonb_build_array(jsonb_build_object('id', new.id))) then
          raise exception 'End month conflicts with an existing report referencing this slot';
        end if;
      end if;
    else
      if not public.ops_vehicle_can_manage(new.contract_id, new.up3_id, new.ulp_id) then raise exception 'Plate write denied' using errcode = '42501'; end if;
      if new.plate_display is null then raise exception 'A plate cannot be cleared'; end if;
      new.plate_display := upper(regexp_replace(btrim(new.plate_display), '\s+', ' ', 'g'));
      new.plate_normalized := regexp_replace(new.plate_display, '[^A-Z0-9]+', '', 'g');
      if length(new.plate_display) > 100 or length(new.plate_normalized) not between 2 and 12 then raise exception 'Plate must normalize to 2..12 characters'; end if;
      for v_lock in select distinct x from unnest(array[old.plate_normalized, new.plate_normalized]) a(x) where x is not null order by x loop
        perform pg_advisory_xact_lock(hashtextextended('ops_plate:' || v_lock, 0));
      end loop;
      if old.legacy_vehicle_id is not null and (new.plate_normalized is distinct from old.plate_normalized
        or new.legacy_vehicle_id is distinct from old.legacy_vehicle_id) then
        raise exception 'Linked registry plate cannot be corrected here; an administrator must handle the existing registry link';
      end if;
      if exists (select 1 from public.ops_prescribed_vehicles s where s.plate_normalized = new.plate_normalized and s.id <> new.id
        and daterange(s.effective_month, s.end_month, '[)') && daterange(new.effective_month, new.end_month, '[)')) then
        raise exception 'Plate is already reserved by another slot for an overlapping month range';
      end if;
      begin
        select v.* into v_registry from public.ops_vehicles v where v.plate_normalized = new.plate_normalized for key share nowait;
      exception when lock_not_available then
        raise exception 'Registry vehicle is busy; reload and retry plate assignment' using errcode = '40001';
      end;
      if found then
        if (v_registry.contract_id, v_registry.up3_id, v_registry.ulp_id) is distinct from (new.contract_id, new.up3_id, new.ulp_id) then
          raise exception 'Plate exists in a different registry scope';
        end if;
        select t.vehicle_type_id, t.assignment_id into v_type, v_assignment from public.ops_vehicle_template_assignments a
          join public.ops_equipment_templates t on t.id = a.template_id and t.contract_id = new.contract_id and t.up3_id = new.up3_id
          where a.vehicle_id = v_registry.id and a.contract_id = new.contract_id and a.up3_id = new.up3_id and a.ulp_id = new.ulp_id
          order by a.effective_from desc, a.created_at desc, a.id desc limit 1;
        if not found then
          select t.vehicle_type_id, t.assignment_id into v_type, v_assignment from public.ops_vehicle_history h
            join public.ops_equipment_templates t on t.id = coalesce(h.detail ->> 'to_template_id', h.detail ->> 'template_id')::uuid
              and t.contract_id = new.contract_id and t.up3_id = new.up3_id
            where h.vehicle_id = v_registry.id and h.action in ('CREATED', 'ASSIGNED') order by h.created_at desc, h.id desc limit 1;
        end if;
        if not exists (select 1 from public.ops_equipment_templates t where t.id = new.template_id
          and t.vehicle_type_id = v_type and t.assignment_id = v_assignment) then
          raise exception 'Existing registry vehicle must have the same verified vehicle type and assignment';
        end if;
        new.legacy_vehicle_id := v_registry.id;
      else
        if old.legacy_vehicle_id is not null then raise exception 'Existing registry link is inconsistent; administrator action required'; end if;
        new.legacy_vehicle_id := null;
      end if;
    end if;
  else
    v_mutable := array['vehicles', 'items', 'status', 'revision', 'updated_at', 'updated_by'];
    if v_revising then
      if not public.ops_can_manage_master(new.contract_id, new.up3_id) then raise exception 'Report write denied' using errcode = '42501'; end if;
    elsif v_plate_correcting then
      null; -- plate correction already validated by ops_correct_prescribed_vehicle_plate
    elsif not public.ops_vehicle_can_manage(new.contract_id, new.up3_id, new.ulp_id) then
      raise exception 'Report write denied' using errcode = '42501';
    end if;
    if new.period_month > date_trunc('month', public.ops_business_today())::date then raise exception 'Future reports cannot be saved'; end if;
    if tg_op = 'UPDATE' then
      if v_revising then
        if jsonb_array_length(new.vehicles) <= jsonb_array_length(old.vehicles)
          or jsonb_array_length(new.items) <= jsonb_array_length(old.items) then
          raise exception 'Fleet revision must append both vehicles and items';
        end if;
        if (select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
            from jsonb_array_elements(new.vehicles) with ordinality a(value, ord)
            where ord <= jsonb_array_length(old.vehicles)) is distinct from old.vehicles then
          raise exception 'Fleet revision must preserve the existing vehicle array exactly';
        end if;
        if (select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
            from jsonb_array_elements(new.items) with ordinality a(value, ord)
            where ord <= jsonb_array_length(old.items)) is distinct from old.items then
          raise exception 'Fleet revision must preserve existing item values exactly';
        end if;
        for v_new in select value from jsonb_array_elements(new.items) with ordinality a(value, ord)
          where ord > jsonb_array_length(old.items) loop
          if (v_new -> 'good_qty') is distinct from 'null'::jsonb
            or (v_new -> 'bad_qty') is distinct from 'null'::jsonb
            or (v_new ->> 'note') is distinct from ''
            or (v_new ->> 'status') is distinct from 'unfilled'
            or (v_new -> 'available_qty') is distinct from 'null'::jsonb
            or (v_new -> 'percentage') is distinct from 'null'::jsonb then
            raise exception 'Appended fleet items must be unfilled';
          end if;
        end loop;
        if new.status is distinct from 'draft' then raise exception 'Fleet revision must reset the report to draft'; end if;
      elsif v_plate_correcting then
        if jsonb_array_length(new.vehicles) <> jsonb_array_length(old.vehicles) then raise exception 'Report fleet is pinned'; end if;
        if (new.items, new.status) is distinct from (old.items, old.status) then raise exception 'Plate correction must not change report contents'; end if;
        for v_old, v_ord in select value, ordinality from jsonb_array_elements(old.vehicles) with ordinality loop
          v_new := new.vehicles -> (v_ord::integer - 1);
          if v_new is not distinct from v_old then
            -- Untouched snapshots always pass; the correction only carries
            -- plate fixes for the one target vehicle.
            continue;
          end if;
          select s.* into v_slot from public.ops_prescribed_vehicles s
            where s.id = (v_old ->> 'id')::uuid and s.contract_id = new.contract_id
              and s.up3_id = new.up3_id and s.ulp_id = new.ulp_id;
          if not found then raise exception 'Plate correction references an unknown vehicle'; end if;
          -- Only the plate metadata (plus the location overlay the report
          -- getter stamps in) may differ from the stored snapshot.
          if (v_new - array['revision', 'plate_display', 'plate_normalized', 'location_id', 'location_name', 'location_type'])
            is distinct from (v_old - array['revision', 'plate_display', 'plate_normalized', 'location_id', 'location_name', 'location_type']) then
            raise exception 'Plate correction may only fix vehicle plates';
          end if;
          -- The replacement plate must be exactly the slot's current plate,
          -- which ops_correct_prescribed_vehicle_plate just wrote.
          if (v_new ->> 'plate_display', v_new ->> 'plate_normalized')
            is distinct from (v_slot.plate_display, v_slot.plate_normalized) then
            raise exception 'Plate correction may only fix vehicle plates';
          end if;
        end loop;
      else
        if jsonb_array_length(new.vehicles) <> jsonb_array_length(old.vehicles) then raise exception 'Report fleet is pinned'; end if;
        for v_old, v_ord in select value, ordinality from jsonb_array_elements(old.vehicles) with ordinality loop
          v_new := new.vehicles -> (v_ord::integer - 1);
          if (v_new - array['revision', 'plate_display', 'plate_normalized']) is distinct from
            (v_old - array['revision', 'plate_display', 'plate_normalized']) then raise exception 'Report vehicle metadata is pinned'; end if;
          if nullif(v_old ->> 'plate_normalized', '') is not null then
            if (v_new -> 'plate_display', v_new -> 'plate_normalized') is distinct from
              (v_old -> 'plate_display', v_old -> 'plate_normalized') then raise exception 'Historical nonempty plates are immutable'; end if;
          else
            select s.* into v_slot from public.ops_prescribed_vehicles s where s.id = (v_old ->> 'id')::uuid
              and s.contract_id = new.contract_id and s.up3_id = new.up3_id and s.ulp_id = new.ulp_id;
            if not found or (v_new ->> 'plate_display', v_new ->> 'plate_normalized') is distinct from
              (v_slot.plate_display, v_slot.plate_normalized) then raise exception 'Only the current slot may enrich an empty plate'; end if;
          end if;
        end loop;
        if (select jsonb_agg(value - array['good_qty', 'bad_qty', 'note', 'status', 'available_qty', 'percentage'] order by ord)
            from jsonb_array_elements(new.items) with ordinality a(value, ord)) is distinct from
          (select jsonb_agg(value - array['good_qty', 'bad_qty', 'note', 'status', 'available_qty', 'percentage'] order by ord)
            from jsonb_array_elements(old.items) with ordinality a(value, ord)) then raise exception 'Report item metadata and keys are pinned'; end if;
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'Identity, scope, source template, start month and creation audit are immutable';
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  new.revision := case when tg_op = 'INSERT' then 1 else old.revision + 1 end;
  if tg_op = 'INSERT' then new.created_at := now(); new.created_by := auth.uid(); end if;
  return new;
end;
$$;

create function public.ops_correct_prescribed_vehicle_plate(
  p_slot_id uuid,
  p_plate text,
  p_expected_revision integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  s public.ops_prescribed_vehicles;
  r public.ops_vehicle_monthly_reports;
  v_old_plate text;
  v_new_normalized text;
  v_reason text;
  v_reports_changed jsonb := '[]';
begin
  if auth.uid() is null
    or not public.ops_vehicle_can_manage(
      (select x.contract_id from public.ops_prescribed_vehicles x where x.id = p_slot_id),
      (select x.up3_id from public.ops_prescribed_vehicles x where x.id = p_slot_id),
      (select x.ulp_id from public.ops_prescribed_vehicles x where x.id = p_slot_id)) then
    raise exception 'Only Super Admin or the exact Admin ULP may correct plates' using errcode = '42501';
  end if;
  select x.* into s from public.ops_prescribed_vehicles x where x.id = p_slot_id;
  if not found then
    raise exception 'Slot not found';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'A correction reason of at most 500 characters is required';
  end if;
  if p_plate is null or btrim(p_plate) = '' then
    raise exception 'Plate is required';
  end if;
  v_new_normalized := regexp_replace(upper(btrim(p_plate)), '[^A-Z0-9]+', '', 'g');
  if length(v_new_normalized) not between 2 and 12 then
    raise exception 'Plate must normalize to 2..12 characters';
  end if;
  perform public.ops_prescribed_assert_scope(s.contract_id, s.up3_id, s.ulp_id);
  if s.plate_display is null then
    raise exception 'Plate has not been filled yet; use the initial plate entry';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'ops_prescribed:' || s.contract_id || ':' || s.up3_id || ':' || s.ulp_id, 0));
  select x.* into s from public.ops_prescribed_vehicles x where x.id = p_slot_id for update;
  if s.revision is distinct from p_expected_revision then
    raise exception 'Slot revision conflict; reload' using errcode = '40001';
  end if;
  if s.plate_display is null then
    raise exception 'Plate has not been filled yet; use the initial plate entry';
  end if;
  v_old_plate := s.plate_display;

  -- Guard + audit triggers run on this direct update: scope, overlap exclusion,
  -- registry consistency, normalization, revision bump, and slot history.
  update public.ops_prescribed_vehicles x
    set plate_display = p_plate
    where x.id = s.id
    returning x.* into s;
  if s.plate_normalized is distinct from v_new_normalized then
    raise exception 'Plate normalization mismatch; reload and retry';
  end if;

  if v_new_normalized = regexp_replace(upper(btrim(v_old_plate)), '[^A-Z0-9]+', '', 'g') then
    -- Same normalized plate, spacing/case only: one audited slot revision and
    -- no saved report rewrite because stored snapshots stay display-equal.
    return jsonb_build_object(
      'slot', to_jsonb(s),
      'reports_revised', v_reports_changed);
  end if;

  -- Saved reports embed the OLD plate in their vehicle snapshots. Rewrite only
  -- that metadata, in deterministic report order, each with a new revision.
  for r in
    select x.* from public.ops_vehicle_monthly_reports x
    where x.contract_id = s.contract_id and x.up3_id = s.up3_id and x.ulp_id = s.ulp_id
      and x.period_month >= s.effective_month
      and (s.end_month is null or x.period_month < s.end_month)
      and exists (
        select 1 from jsonb_array_elements(x.vehicles) v
        where v ->> 'id' = s.id::text
          and nullif(v ->> 'plate_normalized', '') is not null
          and ((v ->> 'plate_display') is distinct from s.plate_display
            or (v ->> 'plate_normalized') is distinct from s.plate_normalized))
    order by x.period_month
  for update
  loop
    perform set_config('ops.correcting_vehicle_plate', 'on', true);
    update public.ops_vehicle_monthly_reports y
      set vehicles = (
        select coalesce(jsonb_agg(
          case
            when v.value ->> 'id' = s.id::text
              and nullif(v.value ->> 'plate_normalized', '') is not null
            then v.value
              || jsonb_build_object(
                'plate_display', s.plate_display,
                'plate_normalized', s.plate_normalized)
            else v.value
          end order by v.ord), y.vehicles)
        from jsonb_array_elements(y.vehicles) with ordinality v(value, ord)
      )
      where y.id = r.id
      returning y.* into r;
    perform set_config('ops.correcting_vehicle_plate', 'off', true);
    v_reports_changed := v_reports_changed || jsonb_build_array(
      jsonb_build_object('report_id', r.id, 'period_month', r.period_month, 'revision', r.revision));
  end loop;

  return jsonb_build_object(
    'slot', to_jsonb(s),
    'reports_revised', v_reports_changed);
end;
$$;

revoke all on function public.ops_correct_prescribed_vehicle_plate(uuid, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ops_correct_prescribed_vehicle_plate(uuid, text, integer, text)
  to authenticated;
