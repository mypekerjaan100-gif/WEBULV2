-- One physical vehicle may retain its plate across successive, non-overlapping template slots.
-- btree_gist is already installed; the old ops_vehicles global plate uniqueness stays intact.
alter table public.ops_prescribed_vehicles
  add constraint ops_prescribed_vehicles_plate_month_excl exclude using gist
    (plate_normalized with =, daterange(effective_month, end_month, '[)') with &&)
    where (plate_normalized is not null);
create index ops_prescribed_legacy_vehicle on public.ops_prescribed_vehicles(legacy_vehicle_id);
alter table public.ops_prescribed_vehicles
  drop constraint ops_prescribed_vehicles_plate_normalized_key,
  drop constraint ops_prescribed_vehicles_legacy_vehicle_id_key;

-- The reverse registry guard already checks every link with EXISTS, including historical slots.
-- Preserve that guard, registry identity checks, locks, audit and immutable report snapshots.
create or replace function public.ops_prescribed_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_mutable text[]; v_old jsonb; v_new jsonb; v_ord bigint; v_slot public.ops_prescribed_vehicles;
  v_registry public.ops_vehicles; v_type uuid; v_assignment uuid; v_lock text;
begin
  if tg_op in ('DELETE', 'TRUNCATE') or tg_table_name in ('ops_vehicle_monthly_history', 'ops_prescribed_vehicle_history') then
    raise exception 'Records cannot be deleted or truncated; history is append-only';
  end if;
  if new.ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_prescribed_assert_scope(new.contract_id, new.up3_id, new.ulp_id);
  perform pg_advisory_xact_lock(hashtextextended('ops_prescribed:' || new.contract_id || ':' || new.up3_id || ':' || new.ulp_id, 0));
  if tg_table_name = 'ops_prescribed_vehicles' then
    v_mutable := array['end_month', 'plate_display', 'plate_normalized', 'legacy_vehicle_id', 'revision', 'updated_at', 'updated_by'];
    if tg_op = 'INSERT' or new.end_month is distinct from old.end_month then
      if not public.ops_can_manage_master(new.contract_id, new.up3_id) then raise exception 'Fleet management denied' using errcode = '42501'; end if;
      if tg_op = 'INSERT' then
        if new.plate_display is not null or new.plate_normalized is not null or new.legacy_vehicle_id is not null then
          raise exception 'New slots must be unplated';
        end if;
        if not exists (select 1 from public.ops_equipment_templates t where t.id = new.template_id
          and t.contract_id = new.contract_id and t.up3_id = new.up3_id and t.status = 'Aktif') then
          raise exception 'An active template in the same scope is required';
        end if;
        if exists (select 1 from public.ops_vehicle_monthly_reports r where r.contract_id = new.contract_id
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
      -- Scope first, then sorted global plate locks; registry guards use the same keys.
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
      -- Legacy RPCs may hold FOR UPDATE before entering their trigger; never wait behind that lock.
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
    if not public.ops_vehicle_can_manage(new.contract_id, new.up3_id, new.ulp_id) then raise exception 'Report write denied' using errcode = '42501'; end if;
    if new.period_month > date_trunc('month', public.ops_business_today())::date then raise exception 'Future reports cannot be saved'; end if;
    if tg_op = 'UPDATE' then
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
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'Identity, scope, source template, start month and creation audit are immutable';
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  new.revision := case when tg_op = 'INSERT' then 1 else old.revision + 1 end;
  if tg_op = 'INSERT' then new.created_at := now(); new.created_by := auth.uid(); end if;
  return new;
end;
$$;
revoke all on function public.ops_prescribed_guard() from public, anon, authenticated, service_role;
