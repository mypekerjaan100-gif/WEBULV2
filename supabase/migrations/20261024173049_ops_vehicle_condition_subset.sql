-- Follow-up migration for prescribed vehicle monthly conditions.
--
-- 1. Admin UP3 is allowed to revise an already frozen fleet. That path writes
--    ops_vehicle_monthly_history with actor_role = 'ADMIN_UP3', but the original
--    check constraint only accepted SUPER_ADMIN and ADMIN_ULP. The named
--    constraint is recreated with the same name and the complete role set.
--
-- 2. ops_save_vehicle_condition_subset lets an ULP save one vehicle's rows
--    without resending every other vehicle. Other vehicles are rebuilt from the
--    locked current bundle, never from client data. The normal report RPC still
--    performs permission, revision, quantity, status, and audit work.
--
-- No rows are rewritten. The replacement constraint is added NOT VALID and then
-- validated so the exclusive lock window stays short.

alter table public.ops_vehicle_monthly_history
  drop constraint if exists ops_vehicle_monthly_history_actor_role_check;

alter table public.ops_vehicle_monthly_history
  add constraint ops_vehicle_monthly_history_actor_role_check
  check (actor_role in ('SUPER_ADMIN', 'ADMIN_UP3', 'ADMIN_ULP')) not valid;

alter table public.ops_vehicle_monthly_history
  validate constraint ops_vehicle_monthly_history_actor_role_check;

create function public.ops_save_vehicle_condition_subset(
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
  -- Same permission gate as the normal report save: Super Admin or exact ULP.
  if auth.uid() is null or not public.ops_vehicle_can_manage(p_contract_id, p_up3_id, p_ulp_id) then
    raise exception 'Only Super Admin or the exact Admin ULP may report' using errcode = '42501';
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

  -- The report save and fleet revision share this lock; take it before reading.
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

  -- The bundle is the server truth for the fleet and for every other vehicle.
  v_bundle := public.ops_get_vehicle_condition_report(
    p_contract_id, p_up3_id, p_ulp_id, p_period_month);

  if not exists (
    select 1
    from jsonb_array_elements(v_bundle -> 'vehicles') v
    where (v.value ->> 'id')::uuid = p_vehicle_id
  ) then
    raise exception 'Vehicle is not part of the prescribed fleet for this month';
  end if;

  -- Accept only the four public row fields, exactly once per key.
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

  -- Uniqueness plus subset membership plus this count equals complete coverage.
  select count(*) into v_selected_count
  from jsonb_array_elements(v_bundle -> 'items') i
  where (i.value ->> 'vehicle_id')::uuid = p_vehicle_id;
  if jsonb_array_length(p_items) <> v_selected_count then
    raise exception 'Every item for the selected vehicle is required exactly once';
  end if;

  -- Rebuild the full input in bundle order. Only the selected vehicle uses
  -- request values; every other row comes from the current bundle.
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

  -- Same transaction and advisory lock: the normal RPC rechecks permissions
  -- and revision, computes statuses, writes history, and returns the bundle.
  return public.ops_save_vehicle_condition_report(
    p_contract_id,
    p_up3_id,
    p_ulp_id,
    p_period_month,
    v_current_revision,
    v_full);
end;
$$;

revoke all on function public.ops_save_vehicle_condition_subset(uuid, uuid, uuid, date, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ops_save_vehicle_condition_subset(uuid, uuid, uuid, date, uuid, integer, jsonb)
  to authenticated;
