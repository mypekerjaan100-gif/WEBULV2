alter table public.ops_prescribed_vehicles
  add column if not exists location_id uuid references public.locations(id) on delete restrict;

create index if not exists ops_prescribed_location
  on public.ops_prescribed_vehicles(location_id);

create or replace function public.ops_prescribed_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_mutable text[]; v_old jsonb; v_new jsonb; v_ord bigint; v_slot public.ops_prescribed_vehicles;
  v_registry public.ops_vehicles; v_type uuid; v_assignment uuid; v_lock text;
  v_revising boolean; v_location_required boolean;
begin
  if tg_op in ('DELETE', 'TRUNCATE') or tg_table_name in ('ops_vehicle_monthly_history', 'ops_prescribed_vehicle_history') then
    raise exception 'Records cannot be deleted or truncated; history is append-only';
  end if;
  if new.ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_prescribed_assert_scope(new.contract_id, new.up3_id, new.ulp_id);
  perform pg_advisory_xact_lock(hashtextextended('ops_prescribed:' || new.contract_id || ':' || new.up3_id || ':' || new.ulp_id, 0));
  v_revising := coalesce(current_setting('ops.revising_vehicle_fleet', true), '') = 'on';
  v_location_required := coalesce(current_setting('ops.require_prescribed_location', true), '') = 'on';
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

create or replace function public.ops_create_prescribed_vehicles_batch_v2(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid,
  p_effective_month date, p_contract_reference text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_row jsonb; v_template uuid; v_location uuid; v_count integer; v_total bigint := 0;
  v_pair text; v_seen text[] := '{}'; v_label text; v_meta jsonb; v_slot jsonb;
  v_slots jsonb := '[]'; v_vehicles jsonb := '[]'; v_items jsonb := '[]'; v_item jsonb;
  v_created integer := 0; v_revised integer := 0; v_periods jsonb := '[]'::jsonb;
  v_location_name text; v_location_type text; v_today date := public.ops_business_today();
  n integer; s public.ops_prescribed_vehicles; t public.ops_equipment_templates;
  r public.ops_vehicle_monthly_reports;
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
    if jsonb_typeof(v_row) <> 'object' or not (v_row ?& array['template_id', 'count', 'location_id'])
      or (v_row - array['template_id', 'count', 'location_id']) <> '{}'::jsonb then
      raise exception 'Each row must contain exactly template_id, count and location_id';
    end if;
    if jsonb_typeof(v_row -> 'template_id') is distinct from 'string'
      or (v_row ->> 'template_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Each row requires a UUID template_id string';
    end if;
    if jsonb_typeof(v_row -> 'location_id') is distinct from 'string'
      or (v_row ->> 'location_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Each row requires a UUID location_id string';
    end if;
    v_template := (v_row ->> 'template_id')::uuid;
    v_location := (v_row ->> 'location_id')::uuid;
    v_pair := v_template::text || ':' || v_location::text;
    if v_pair = any(v_seen) then raise exception 'Duplicate template_id and location_id combination in rows'; end if;
    v_seen := array_append(v_seen, v_pair);
    if jsonb_typeof(v_row -> 'count') is distinct from 'number' or (v_row ->> 'count') !~ '^[0-9]{1,3}$' then
      raise exception 'Each row count must be an integer 1..50';
    end if;
    v_count := (v_row ->> 'count')::integer;
    if v_count not between 1 and 50 then raise exception 'Each row count must be an integer 1..50'; end if;
    v_total := v_total + v_count;
    if v_total > 200 then raise exception 'Total vehicle count is limited to 200'; end if;
    if not exists (select 1 from public.locations l
      where l.id = v_location and l.contract_id = p_contract_id and l.up3_id = p_up3_id
        and l.unit_id = p_ulp_id and l.type in ('UNIT_OFFICE', 'KANTOR_JAGA') and l.own_status = 'Aktif') then
      raise exception 'An active UNIT_OFFICE or KANTOR_JAGA in the same ULP is required';
    end if;
    if not exists (select 1 from public.ops_equipment_templates x
      where x.id = v_template and x.contract_id = p_contract_id and x.up3_id = p_up3_id and x.status = 'Aktif') then
      raise exception 'An active template in the same scope is required';
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('ops_prescribed:' || p_contract_id || ':' || p_up3_id || ':' || p_ulp_id, 0));
  perform set_config('ops.revising_vehicle_fleet', 'on', true);
  perform set_config('ops.require_prescribed_location', 'on', true);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_template := (v_row ->> 'template_id')::uuid;
    v_location := (v_row ->> 'location_id')::uuid;
    v_count := (v_row ->> 'count')::integer;
    select x.* into t from public.ops_equipment_templates x where x.id = v_template
      and x.contract_id = p_contract_id and x.up3_id = p_up3_id and x.status = 'Aktif' for share;
    if not found then raise exception 'An active template in the same scope is required'; end if;
    v_meta := public.ops_prescribed_template_snapshot(v_template, p_contract_id, p_up3_id, p_ulp_id);
    v_label := (v_meta ->> 'vehicle_type_name') || ' - ' || (v_meta ->> 'assignment_name');
    if length(v_label) > 200 - (case when v_count > 1 then length(' #' || v_count) else 0 end) then
      raise exception 'Label including its count suffix is limited to 200 characters';
    end if;
    for n in 1..v_count loop
      insert into public.ops_prescribed_vehicles(contract_id, up3_id, ulp_id, template_id, label,
        contract_reference, effective_month, location_id, created_by, updated_by)
      values (p_contract_id, p_up3_id, p_ulp_id, v_template,
        v_label || case when v_count > 1 then ' #' || n else '' end,
        nullif(btrim(p_contract_reference), ''), p_effective_month, v_location, auth.uid(), auth.uid())
      returning * into s;
      v_slots := v_slots || jsonb_build_array(to_jsonb(s));
      v_created := v_created + 1;
    end loop;
  end loop;
  for v_slot in select value from jsonb_array_elements(v_slots) loop
    v_meta := public.ops_prescribed_template_snapshot((v_slot ->> 'template_id')::uuid, p_contract_id, p_up3_id, p_ulp_id);
    select l.type, h.name into v_location_type, v_location_name
      from public.locations l
      left join lateral (
        select x.name from public.location_name_history x
        where x.location_id = l.id and x.effective_from <= v_today
          and (x.effective_to is null or x.effective_to > v_today)
        order by x.effective_from desc limit 1
      ) h on true
      where l.id = (v_slot ->> 'location_id')::uuid;
    v_vehicles := v_vehicles || jsonb_build_array((v_meta - 'items') || jsonb_build_object(
      'id', (v_slot ->> 'id')::uuid, 'label', v_slot ->> 'label', 'plate_display', null,
      'plate_normalized', null, 'revision', (v_slot ->> 'revision')::integer,
      'contract_reference', v_slot -> 'contract_reference',
      'location_id', v_slot -> 'location_id', 'location_name', v_location_name,
      'location_type', v_location_type));
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
  perform set_config('ops.require_prescribed_location', 'off', true);
  return jsonb_build_object('vehicles_created', v_created, 'reports_revised', v_revised, 'periods', v_periods);
end;
$$;

create or replace function public.ops_list_prescribed_vehicles(p_contract_id uuid, p_up3_id uuid, p_period_month date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_today date := public.ops_business_today();
begin
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, null);
  if p_period_month is null or not isfinite(p_period_month) or extract(day from p_period_month) <> 1 then raise exception 'Period must be finite and month-first'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object('template_name', t.template_name,
    'template_code', t.template_code, 'template_revision', t.revision, 'template_version', t.version_number,
    'vehicle_type_name', coalesce(nullif(btrim(t.vehicle_type_name), ''), vt.name),
    'assignment_name', coalesce(nullif(btrim(t.assignment_name), ''), a.name), 'legacy_metadata', t.published_at is null,
    'location_name', ln.name, 'location_type', l.type)
    order by s.ulp_id, s.label, s.id), '[]'::jsonb) from public.ops_prescribed_vehicles s
    join public.ops_equipment_templates t on t.id = s.template_id and t.contract_id = s.contract_id and t.up3_id = s.up3_id
    left join public.ops_vehicle_types vt on vt.id = t.vehicle_type_id and vt.contract_id = s.contract_id and vt.up3_id = s.up3_id
    left join public.ops_vehicle_assignments a on a.id = t.assignment_id and a.contract_id = s.contract_id and a.up3_id = s.up3_id
    left join public.locations l on l.id = s.location_id and l.contract_id = s.contract_id and l.up3_id = s.up3_id
    left join lateral (
      select h.name from public.location_name_history h
      where h.location_id = s.location_id and h.effective_from <= v_today
        and (h.effective_to is null or h.effective_to > v_today)
      order by h.effective_from desc limit 1
    ) ln on true
    where s.contract_id = p_contract_id and s.up3_id = p_up3_id and s.effective_month <= p_period_month
      and (s.end_month is null or p_period_month < s.end_month));
end;
$$;

create or replace function public.ops_get_vehicle_condition_report(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_period_month date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_report jsonb; v_vehicles jsonb := '[]'; v_items jsonb := '[]'; v_history jsonb := '[]';
  v_slot public.ops_prescribed_vehicles; v_meta jsonb; v_item jsonb;
  v_location_name text; v_location_type text; v_today date := public.ops_business_today();
begin
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, p_ulp_id);
  if p_period_month is null or not isfinite(p_period_month) or extract(day from p_period_month) <> 1 then raise exception 'Period must be finite and month-first'; end if;
  select to_jsonb(r) into v_report from public.ops_vehicle_monthly_reports r where r.contract_id = p_contract_id
    and r.up3_id = p_up3_id and r.ulp_id = p_ulp_id and r.period_month = p_period_month;
  if v_report is not null then
    v_items := v_report -> 'items';
    select jsonb_agg(v.value || jsonb_build_object('revision', s.revision) || case
      when nullif(v.value ->> 'plate_normalized', '') is null then jsonb_build_object('plate_display', s.plate_display, 'plate_normalized', s.plate_normalized)
      else '{}'::jsonb end || case
      when (v.value ->> 'location_id') is null and s.location_id is not null then
        jsonb_build_object('location_id', s.location_id, 'location_name', ln.name, 'location_type', l.type)
      else '{}'::jsonb end order by v.ord) into v_vehicles
      from jsonb_array_elements(v_report -> 'vehicles') with ordinality v(value, ord)
      join public.ops_prescribed_vehicles s on s.id = (v.value ->> 'id')::uuid
        and s.contract_id = p_contract_id and s.up3_id = p_up3_id and s.ulp_id = p_ulp_id
      left join public.locations l on l.id = s.location_id and l.contract_id = s.contract_id and l.up3_id = s.up3_id
      left join lateral (
        select h.name from public.location_name_history h
        where h.location_id = s.location_id and h.effective_from <= v_today
          and (h.effective_to is null or h.effective_to > v_today)
        order by h.effective_from desc limit 1
      ) ln on true;
    select coalesce(jsonb_agg(to_jsonb(h) order by h.revision desc), '[]'::jsonb) into v_history from
      (select x.* from public.ops_vehicle_monthly_history x where x.report_id = (v_report ->> 'id')::uuid order by x.revision desc limit 20) h;
  else
    for v_slot in select x.* from public.ops_prescribed_vehicles x where x.contract_id = p_contract_id and x.up3_id = p_up3_id
      and x.ulp_id = p_ulp_id and x.effective_month <= p_period_month and (x.end_month is null or p_period_month < x.end_month)
      order by x.label, x.id loop
      v_meta := public.ops_prescribed_template_snapshot(v_slot.template_id, p_contract_id, p_up3_id, p_ulp_id);
      select l.type, h.name into v_location_type, v_location_name
        from public.locations l
        left join lateral (
          select x.name from public.location_name_history x
          where x.location_id = l.id and x.effective_from <= v_today
            and (x.effective_to is null or x.effective_to > v_today)
          order by x.effective_from desc limit 1
        ) h on true
        where l.id = v_slot.location_id;
      v_vehicles := v_vehicles || jsonb_build_array((v_meta - 'items') || jsonb_build_object('id', v_slot.id, 'label', v_slot.label,
        'plate_display', v_slot.plate_display, 'plate_normalized', v_slot.plate_normalized, 'revision', v_slot.revision,
        'contract_reference', v_slot.contract_reference, 'location_id', v_slot.location_id,
        'location_name', v_location_name, 'location_type', v_location_type));
      v_items := v_items || jsonb_build_array(jsonb_build_object('key', v_slot.id || ':vehicle', 'kind', 'vehicle', 'vehicle_id', v_slot.id,
        'name', v_slot.label, 'category', 'Kondisi Kendaraan', 'unit', 'unit', 'required_qty', 1));
      for v_item in select value from jsonb_array_elements(v_meta -> 'items') loop
        v_items := v_items || jsonb_build_array(v_item || jsonb_build_object('key', v_slot.id || ':' || (v_item ->> 'equipment_id'), 'vehicle_id', v_slot.id));
      end loop;
    end loop;
    select coalesce(jsonb_agg(value || jsonb_build_object('good_qty', null, 'bad_qty', null, 'note', '',
      'status', 'unfilled', 'available_qty', null, 'percentage', null) order by ord), '[]'::jsonb) into v_items
      from jsonb_array_elements(v_items) with ordinality a(value, ord);
  end if;
  return jsonb_build_object('report', v_report, 'vehicles', coalesce(v_vehicles, '[]'::jsonb), 'items', v_items, 'history', v_history);
end;
$$;

revoke all on function public.ops_create_prescribed_vehicles_batch_v2(uuid, uuid, uuid, date, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ops_create_prescribed_vehicles_batch_v2(uuid, uuid, uuid, date, text, jsonb)
  to authenticated;
