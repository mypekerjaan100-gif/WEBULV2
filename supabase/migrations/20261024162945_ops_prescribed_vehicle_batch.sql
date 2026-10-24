create function public.ops_list_affected_vehicle_reports(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_from_month date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if auth.uid() is null or not public.ops_can_manage_master(p_contract_id, p_up3_id) then
    raise exception 'Fleet management denied' using errcode = '42501';
  end if;
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, p_ulp_id);
  if p_from_month is null or not isfinite(p_from_month) or extract(day from p_from_month) <> 1 then
    raise exception 'From month must be finite and month-first';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('period_month', r.period_month,
    'status', r.status, 'revision', r.revision) order by r.period_month), '[]'::jsonb)
    from public.ops_vehicle_monthly_reports r where r.contract_id = p_contract_id
      and r.up3_id = p_up3_id and r.ulp_id = p_ulp_id and r.period_month >= p_from_month);
end;
$$;

create or replace function public.ops_prescribed_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_mutable text[]; v_old jsonb; v_new jsonb; v_ord bigint; v_slot public.ops_prescribed_vehicles;
  v_registry public.ops_vehicles; v_type uuid; v_assignment uuid; v_lock text;
  v_revising boolean;
begin
  if tg_op in ('DELETE', 'TRUNCATE') or tg_table_name in ('ops_vehicle_monthly_history', 'ops_prescribed_vehicle_history') then
    raise exception 'Records cannot be deleted or truncated; history is append-only';
  end if;
  if new.ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_prescribed_assert_scope(new.contract_id, new.up3_id, new.ulp_id);
  perform pg_advisory_xact_lock(hashtextextended('ops_prescribed:' || new.contract_id || ':' || new.up3_id || ':' || new.ulp_id, 0));
  v_revising := coalesce(current_setting('ops.revising_vehicle_fleet', true), '') = 'on';
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

create function public.ops_create_prescribed_vehicles_batch(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid,
  p_effective_month date, p_contract_reference text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_row jsonb; v_template uuid; v_count integer; v_total bigint := 0; v_seen uuid[] := '{}';
  v_slots jsonb; v_created_slots jsonb := '[]'; v_vehicles jsonb := '[]'; v_items jsonb := '[]';
  v_meta jsonb; v_slot jsonb; v_item jsonb; v_created integer := 0; v_revised integer := 0;
  v_periods jsonb := '[]'::jsonb; r public.ops_vehicle_monthly_reports;
begin
  if auth.uid() is null or not public.ops_can_manage_master(p_contract_id, p_up3_id) then
    raise exception 'Fleet management denied' using errcode = '42501';
  end if;
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, p_ulp_id);
  if p_effective_month is null or not isfinite(p_effective_month) or extract(day from p_effective_month) <> 1 then
    raise exception 'Effective month must be finite and month-first';
  end if;
  if length(coalesce(p_contract_reference, '')) > 500 then raise exception 'Contract reference is limited to 500 characters'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a JSON array'; end if;
  if jsonb_array_length(p_rows) not between 1 and 50 then raise exception 'Rows must contain 1..50 entries'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' or not (v_row ?& array['template_id', 'count'])
      or (v_row - array['template_id', 'count']) <> '{}'::jsonb then
      raise exception 'Each row must contain exactly template_id and count';
    end if;
    if jsonb_typeof(v_row -> 'template_id') is distinct from 'string'
      or (v_row ->> 'template_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Each row requires a UUID template_id string';
    end if;
    v_template := (v_row ->> 'template_id')::uuid;
    if v_template = any(v_seen) then raise exception 'Duplicate template_id in rows'; end if;
    v_seen := array_append(v_seen, v_template);
    if jsonb_typeof(v_row -> 'count') is distinct from 'number' or (v_row ->> 'count') !~ '^[0-9]{1,3}$' then
      raise exception 'Each row count must be an integer 1..50';
    end if;
    v_count := (v_row ->> 'count')::integer;
    if v_count not between 1 and 50 then raise exception 'Each row count must be an integer 1..50'; end if;
    v_total := v_total + v_count;
    if v_total > 200 then raise exception 'Total vehicle count is limited to 200'; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('ops_prescribed:' || p_contract_id || ':' || p_up3_id || ':' || p_ulp_id, 0));
  perform set_config('ops.revising_vehicle_fleet', 'on', true);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_slots := public.ops_create_prescribed_vehicles(p_contract_id, p_up3_id, p_ulp_id,
      (v_row ->> 'template_id')::uuid, null::text, p_contract_reference, (v_row ->> 'count')::integer, p_effective_month);
    v_created_slots := v_created_slots || v_slots;
    v_created := v_created + jsonb_array_length(v_slots);
  end loop;
  for v_slot in select value from jsonb_array_elements(v_created_slots) loop
    v_meta := public.ops_prescribed_template_snapshot((v_slot ->> 'template_id')::uuid, p_contract_id, p_up3_id, p_ulp_id);
    v_vehicles := v_vehicles || jsonb_build_array((v_meta - 'items') || jsonb_build_object(
      'id', (v_slot ->> 'id')::uuid, 'label', v_slot ->> 'label', 'plate_display', null,
      'plate_normalized', null, 'revision', (v_slot ->> 'revision')::integer,
      'contract_reference', v_slot -> 'contract_reference'));
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'key', (v_slot ->> 'id') || ':vehicle', 'kind', 'vehicle', 'vehicle_id', (v_slot ->> 'id')::uuid,
      'name', v_slot ->> 'label', 'category', 'Kondisi Kendaraan', 'unit', 'unit', 'required_qty', 1,
      'good_qty', null, 'bad_qty', null, 'note', '', 'status', 'unfilled', 'available_qty', null, 'percentage', null));
    for v_item in select value from jsonb_array_elements(v_meta -> 'items') loop
      v_items := v_items || jsonb_build_array(v_item || jsonb_build_object(
        'key', (v_slot ->> 'id') || ':' || (v_item ->> 'equipment_id'),
        'vehicle_id', (v_slot ->> 'id')::uuid, 'good_qty', null, 'bad_qty', null, 'note', '',
        'status', 'unfilled', 'available_qty', null, 'percentage', null));
    end loop;
  end loop;
  for r in select x.* from public.ops_vehicle_monthly_reports x
    where x.contract_id = p_contract_id and x.up3_id = p_up3_id and x.ulp_id = p_ulp_id
      and x.period_month >= p_effective_month order by x.period_month for update loop
    update public.ops_vehicle_monthly_reports x set vehicles = r.vehicles || v_vehicles,
      items = r.items || v_items, status = 'draft' where x.id = r.id;
    v_revised := v_revised + 1;
    v_periods := v_periods || jsonb_build_array(r.period_month);
  end loop;
  perform set_config('ops.revising_vehicle_fleet', 'off', true);
  return jsonb_build_object('vehicles_created', v_created, 'reports_revised', v_revised, 'periods', v_periods);
end;
$$;

revoke all on function public.ops_list_affected_vehicle_reports(uuid, uuid, uuid, date),
  public.ops_create_prescribed_vehicles_batch(uuid, uuid, uuid, date, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ops_list_affected_vehicle_reports(uuid, uuid, uuid, date),
  public.ops_create_prescribed_vehicles_batch(uuid, uuid, uuid, date, text, jsonb)
  to authenticated;
