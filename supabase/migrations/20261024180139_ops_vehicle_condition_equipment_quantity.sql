create or replace function public.ops_save_vehicle_condition_report(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_period_month date,
  p_expected_revision integer, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  r public.ops_vehicle_monthly_reports; v_bundle jsonb; v_input jsonb := '{}'; v_items jsonb := '[]';
  v_item jsonb; v_spec jsonb; v_field text; v_good bigint; v_bad bigint; v_status text := 'compliant'; v_row_status text;
begin
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  if auth.uid() is null or not public.ops_vehicle_can_manage(p_contract_id, p_up3_id, p_ulp_id) then
    raise exception 'Only Super Admin or the exact Admin ULP may report' using errcode = '42501';
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

revoke all on function public.ops_save_vehicle_condition_report(uuid, uuid, uuid, date, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ops_save_vehicle_condition_report(uuid, uuid, uuid, date, integer, jsonb)
  to authenticated;
