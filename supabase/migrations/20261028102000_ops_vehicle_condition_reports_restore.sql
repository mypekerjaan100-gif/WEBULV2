-- Restore the monthly aggregate condition report that was temporarily
-- disabled when per-unit inspection was introduced.
--
-- The aggregate remains the primary report:
--   * contract quantity comes from the assigned template;
--   * available at ULP equals the contract quantity;
--   * good + damaged must equal the contract quantity;
--   * no separate shortage column or stock rule is introduced.
--
-- Per-unit inspection stays additive. It records evidence, issues, replacement
-- handover, and useful life without rewriting the monthly snapshot or closing
-- an issue just because an aggregate count changes.
--
-- Writers of the aggregate are Super Admin or a custom role in the exact ULP
-- scope with alat.inspect. Admin ULP keeps plate-only control; Admin UP3 and
-- management keep read access.

create or replace function public.ops_vehicle_can_report(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_ulp_id, 'alat.inspect')
  )
$function$;

-- The monthly history now accepts the inspector actor. Existing rows are
-- untouched and the new check is validated before the constraint is trusted.
alter table public.ops_vehicle_monthly_history
  drop constraint if exists ops_vehicle_monthly_history_actor_role_check;

alter table public.ops_vehicle_monthly_history
  add constraint ops_vehicle_monthly_history_actor_role_check
  check (actor_role in ('SUPER_ADMIN', 'ADMIN_UP3', 'ADMIN_ULP', 'INSPECTOR')) not valid;

alter table public.ops_vehicle_monthly_history
  validate constraint ops_vehicle_monthly_history_actor_role_check;

create or replace function public.ops_vehicle_actor_role(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when public.auth_is_super_admin() then 'SUPER_ADMIN'
    when exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.contract_role = 'ADMIN_ULP' and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
        and cm.operational_unit_id = p_ulp_id
    ) then 'ADMIN_ULP'
    when exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.contract_role = 'ADMIN_UP3' and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
    ) then 'ADMIN_UP3'
    when public.auth_custom_has_permission(p_contract_id, p_up3_id, p_ulp_id, 'alat.inspect')
      then 'INSPECTOR'
    else 'USER'
  end
$function$;

-- Keep the live guard intact; only the monthly-report write gate changes from
-- plate management to the aggregate-report permission.
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
    elsif not public.ops_vehicle_can_report(new.contract_id, new.up3_id, new.ulp_id) then
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
            continue;
          end if;
          select s.* into v_slot from public.ops_prescribed_vehicles s
            where s.id = (v_old ->> 'id')::uuid and s.contract_id = new.contract_id
              and s.up3_id = new.up3_id and s.ulp_id = new.ulp_id;
          if not found then raise exception 'Plate correction references an unknown vehicle'; end if;
          if (v_new - array['revision', 'plate_display', 'plate_normalized', 'location_id', 'location_name', 'location_type'])
            is distinct from (v_old - array['revision', 'plate_display', 'plate_normalized', 'location_id', 'location_name', 'location_type']) then
            raise exception 'Plate correction may only fix vehicle plates';
          end if;
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

create or replace function public.ops_save_vehicle_condition_report(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_period_month date,
  p_expected_revision integer, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  r public.ops_vehicle_monthly_reports; v_bundle jsonb; v_input jsonb := '{}'; v_items jsonb := '[]';
  v_item jsonb; v_spec jsonb; v_field text; v_good bigint; v_bad bigint; v_status text := 'compliant'; v_row_status text;
begin
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  if auth.uid() is null or not public.ops_vehicle_can_report(p_contract_id, p_up3_id, p_ulp_id) then
    raise exception 'Only Super Admin or the assigned equipment inspector may report' using errcode = '42501';
  end if;
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, p_ulp_id);
  if p_period_month is null or not isfinite(p_period_month) or extract(day from p_period_month) <> 1
    or p_period_month > date_trunc('month', public.ops_business_today())::date then raise exception 'Period must be month-first and not in the future'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Items must be an array'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ops_prescribed:' || p_contract_id || ':' || p_up3_id || ':' || p_ulp_id, 0));
  select x.* into r from public.ops_vehicle_monthly_reports x where x.contract_id = p_contract_id and x.up3_id = p_up3_id
    and x.ulp_id = p_ulp_id and x.period_month = p_period_month for update;
  if coalesce(r.revision, 0) is distinct from p_expected_revision then raise exception 'Report revision conflict; reload' using errcode = '40001'; end if;
  v_bundle := public.ops_get_vehicle_condition_report(p_contract_id, p_up3_id, p_ulp_id, p_period_month);
  if jsonb_array_length(v_bundle -> 'vehicles') = 0 then raise exception 'No prescribed vehicles for this month'; end if;
  if jsonb_array_length(p_items) <> jsonb_array_length(v_bundle -> 'items') then raise exception 'Every prescribed report key is required exactly once'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Report entries must be objects'; end if;
    if not (v_item ?& array['key', 'good_qty', 'bad_qty', 'note']) or (v_item - array['key', 'good_qty', 'bad_qty', 'note']) <> '{}'::jsonb
      or jsonb_typeof(v_item -> 'key') is distinct from 'string' or v_input ? (v_item ->> 'key') then
      raise exception 'Each entry requires only key/good_qty/bad_qty/note, with no duplicate keys';
    end if;
    v_input := v_input || jsonb_build_object(v_item ->> 'key', v_item);
  end loop;
  if exists (select 1 from jsonb_array_elements(v_bundle -> 'vehicles') v where nullif(v ->> 'plate_normalized', '') is null) then v_status := 'draft'; end if;
  for v_spec in select value from jsonb_array_elements(v_bundle -> 'items') loop
    v_item := v_input -> (v_spec ->> 'key');
    if v_item is null then raise exception 'Missing prescribed key or out-of-fleet entry'; end if;
    foreach v_field in array array['good_qty', 'bad_qty'] loop
      if v_item -> v_field <> 'null'::jsonb then
        if jsonb_typeof(v_item -> v_field) <> 'number' or (v_item ->> v_field) !~ '^[0-9]{1,10}$' then raise exception 'Quantities must be null or nonnegative integers'; end if;
        if (v_item ->> v_field)::bigint > 2147483647 then raise exception 'Quantity exceeds 2147483647'; end if;
      end if;
    end loop;
    if jsonb_typeof(v_item -> 'note') not in ('string', 'null') or length(coalesce(v_item ->> 'note', '')) > 2000 then raise exception 'Note must be text of at most 2000 characters'; end if;
    v_good := (v_item ->> 'good_qty')::bigint; v_bad := (v_item ->> 'bad_qty')::bigint;
    if v_spec ->> 'kind' = 'vehicle' and ((v_good is null) <> (v_bad is null) or coalesce(v_good + v_bad, 0) > 1) then
      raise exception 'Vehicle counts must be null/null or binary whole counts with sum at most one';
    end if;
    if v_spec ->> 'kind' <> 'vehicle' and v_good is not null and v_bad is not null
      and v_good + v_bad <> (v_spec ->> 'required_qty')::bigint then
      raise exception 'Good + damaged quantity must equal required quantity';
    end if;
    v_row_status := case when v_good is null or v_bad is null then 'unfilled'
      when v_bad > 0 or v_good < (v_spec ->> 'required_qty')::bigint then 'non_compliant' else 'compliant' end;
    if v_row_status = 'unfilled' then v_status := 'draft';
    elsif v_row_status = 'non_compliant' and v_status <> 'draft' then v_status := 'non_compliant'; end if;
    v_items := v_items || jsonb_build_array(v_spec || jsonb_build_object('good_qty', v_good, 'bad_qty', v_bad,
      'note', coalesce(v_item ->> 'note', ''), 'status', v_row_status,
      'available_qty', case when v_spec ->> 'kind' = 'vehicle' then v_good + v_bad
        else (v_spec ->> 'required_qty')::bigint end,
      'percentage', case when v_row_status <> 'unfilled' then least(100::numeric, v_good::numeric * 100 / (v_spec ->> 'required_qty')::numeric) else null end));
  end loop;
  if r.id is null then
    insert into public.ops_vehicle_monthly_reports(contract_id, up3_id, ulp_id, period_month, vehicles, items, status, created_by, updated_by)
      values (p_contract_id, p_up3_id, p_ulp_id, p_period_month, v_bundle -> 'vehicles', v_items, v_status, auth.uid(), auth.uid());
  else
    update public.ops_vehicle_monthly_reports x set vehicles = v_bundle -> 'vehicles', items = v_items, status = v_status where x.id = r.id;
  end if;
  return public.ops_get_vehicle_condition_report(p_contract_id, p_up3_id, p_ulp_id, p_period_month);
end;
$$;

create or replace function public.ops_save_vehicle_condition_subset(
  p_contract_id uuid,
  p_up3_id uuid,
  p_ulp_id uuid,
  p_period_month date,
  p_vehicle_id uuid,
  p_expected_revision integer,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_report public.ops_vehicle_monthly_reports;
  v_bundle jsonb;
  v_input jsonb := '{}';
  v_full jsonb := '[]';
  v_entry jsonb;
  v_spec jsonb;
  v_supplied jsonb;
  v_key text;
  v_selected_count integer;
  v_current_revision integer;
begin
  if p_ulp_id is null then
    raise exception 'ULP is required';
  end if;
  if auth.uid() is null or not public.ops_vehicle_can_report(p_contract_id, p_up3_id, p_ulp_id) then
    raise exception 'Only Super Admin or the assigned equipment inspector may report' using errcode = '42501';
  end if;
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, p_ulp_id);
  if p_vehicle_id is null then
    raise exception 'Vehicle is required';
  end if;
  if p_period_month is null or not isfinite(p_period_month)
    or extract(day from p_period_month) <> 1
    or p_period_month > date_trunc('month', public.ops_business_today())::date then
    raise exception 'Period must be month-first and not in the future';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Items must be an array';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'ops_prescribed:' || p_contract_id || ':' || p_up3_id || ':' || p_ulp_id, 0));

  select r.* into v_report
  from public.ops_vehicle_monthly_reports r
  where r.contract_id = p_contract_id
    and r.up3_id = p_up3_id
    and r.ulp_id = p_ulp_id
    and r.period_month = p_period_month
  for update;

  v_current_revision := coalesce(v_report.revision, 0);
  if p_expected_revision is not null
    and v_current_revision is distinct from p_expected_revision then
    raise exception 'Report revision conflict; reload' using errcode = '40001';
  end if;

  v_bundle := public.ops_get_vehicle_condition_report(
    p_contract_id, p_up3_id, p_ulp_id, p_period_month);

  if not exists (
    select 1
    from jsonb_array_elements(v_bundle -> 'vehicles') v
    where (v.value ->> 'id')::uuid = p_vehicle_id
  ) then
    raise exception 'Vehicle is not part of the prescribed fleet for this month';
  end if;

  for v_entry in select e.value from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_entry) <> 'object' then
      raise exception 'Each item must be an object';
    end if;
    if not (v_entry ?& array['key', 'good_qty', 'bad_qty', 'note'])
      or (v_entry - array['key', 'good_qty', 'bad_qty', 'note']) <> '{}'::jsonb
      or jsonb_typeof(v_entry -> 'key') is distinct from 'string' then
      raise exception 'Each item requires only key, good_qty, bad_qty and note';
    end if;
    v_key := v_entry ->> 'key';
    if v_key not like p_vehicle_id::text || ':%' then
      raise exception 'Item key does not belong to the selected vehicle: %', v_key;
    end if;
    if v_input ? v_key then
      raise exception 'Duplicate report key: %', v_key;
    end if;
    if not exists (
      select 1
      from jsonb_array_elements(v_bundle -> 'items') i
      where i.value ->> 'key' = v_key
        and (i.value ->> 'vehicle_id')::uuid = p_vehicle_id
    ) then
      raise exception 'Item key is not part of the selected vehicle: %', v_key;
    end if;
    v_input := v_input || jsonb_build_object(v_key, v_entry);
  end loop;

  select count(*) into v_selected_count
  from jsonb_array_elements(v_bundle -> 'items') i
  where (i.value ->> 'vehicle_id')::uuid = p_vehicle_id;
  if jsonb_array_length(p_items) <> v_selected_count then
    raise exception 'Every item for the selected vehicle is required exactly once';
  end if;

  for v_spec in select i.value from jsonb_array_elements(v_bundle -> 'items') i loop
    if (v_spec ->> 'vehicle_id')::uuid = p_vehicle_id then
      v_supplied := v_input -> (v_spec ->> 'key');
      if v_supplied is null then
        raise exception 'Missing item for key: %', v_spec ->> 'key';
      end if;
      v_full := v_full || jsonb_build_array(jsonb_build_object(
        'key', v_spec ->> 'key',
        'good_qty', v_supplied -> 'good_qty',
        'bad_qty', v_supplied -> 'bad_qty',
        'note', v_supplied -> 'note'));
    else
      v_full := v_full || jsonb_build_array(jsonb_build_object(
        'key', v_spec ->> 'key',
        'good_qty', coalesce(v_spec -> 'good_qty', 'null'::jsonb),
        'bad_qty', coalesce(v_spec -> 'bad_qty', 'null'::jsonb),
        'note', to_jsonb(coalesce(v_spec ->> 'note', ''))));
    end if;
  end loop;

  return public.ops_save_vehicle_condition_report(
    p_contract_id,
    p_up3_id,
    p_ulp_id,
    p_period_month,
    v_current_revision,
    v_full);
end;
$$;

revoke all on function public.ops_vehicle_can_report(uuid, uuid, uuid) from public, anon;
grant execute on function public.ops_vehicle_can_report(uuid, uuid, uuid) to authenticated;

revoke all on function public.ops_save_vehicle_condition_report(uuid, uuid, uuid, date, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ops_save_vehicle_condition_report(uuid, uuid, uuid, date, integer, jsonb)
  to authenticated;

revoke all on function public.ops_save_vehicle_condition_subset(uuid, uuid, uuid, date, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ops_save_vehicle_condition_subset(uuid, uuid, uuid, date, uuid, integer, jsonb)
  to authenticated;
