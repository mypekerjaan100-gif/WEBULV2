-- Follow-up: monthly condition overview treats unreported vehicles as 100% good.
-- Only the read-only overview function changes; no report rows or history are written.

create or replace function public.ops_list_vehicle_condition_overview(p_contract_id uuid, p_up3_id uuid, p_period_month date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.ops_prescribed_assert_scope(p_contract_id, p_up3_id, null);
  if p_period_month is null or not isfinite(p_period_month) or extract(day from p_period_month) <> 1 then raise exception 'Period must be finite and month-first'; end if;
  return (with tool_counts as (
    select ti.template_id, count(*) as n from public.ops_equipment_template_items ti join public.ops_equipment_templates t on t.id = ti.template_id
      where t.contract_id = p_contract_id and t.up3_id = p_up3_id group by ti.template_id
  ), fleet as (
    select s.ulp_id, count(*) as vehicle_count, count(*) filter (where s.plate_normalized is null) as missing_plates,
      sum(1 + coalesce(tc.n, 0)) as items_count from public.ops_prescribed_vehicles s left join tool_counts tc on tc.template_id = s.template_id
      where s.contract_id = p_contract_id and s.up3_id = p_up3_id and s.effective_month <= p_period_month
        and (s.end_month is null or p_period_month < s.end_month) group by s.ulp_id
  ), reports as (
    select r.*, (select count(*) from jsonb_array_elements(r.vehicles) v where nullif(v ->> 'plate_normalized', '') is null) as missing_plates
      from public.ops_vehicle_monthly_reports r
      where r.contract_id = p_contract_id and r.up3_id = p_up3_id and r.period_month = p_period_month
  ), item_rows as (
    select r.id as report_id, i.value as item, nullif(i.value ->> 'vehicle_id', '')::uuid as vehicle_id,
      ((i.value ->> 'good_qty') is null and (i.value ->> 'bad_qty') is null) as default_item
      from reports r cross join lateral jsonb_array_elements(r.items) i
  ), vehicle_defaults as (
    select report_id, vehicle_id, bool_and(default_item) as is_default
      from item_rows where vehicle_id is not null group by report_id, vehicle_id having count(*) > 0
  ), report_counts as (
    select ir.report_id,
      count(*) filter (where ir.item ->> 'status' in ('compliant', 'non_compliant')) as raw_filled,
      count(*) filter (where ir.item ->> 'status' = 'non_compliant') as raw_failed,
      count(*) filter (where vd.is_default) as default_items
      from item_rows ir left join vehicle_defaults vd on vd.report_id = ir.report_id and vd.vehicle_id = ir.vehicle_id
      group by ir.report_id
  ), computed as (
    select u.id as ulp_id, u.sort_order, u.legacy_key,
      case when r.id is not null then jsonb_array_length(r.vehicles) else coalesce(f.vehicle_count, 0) end as vehicle_count,
      coalesce(r.missing_plates, f.missing_plates, 0) as missing_plates,
      case when r.id is not null then jsonb_array_length(r.items) else coalesce(f.items_count, 0) end as items_count,
      case when r.id is not null then least(jsonb_array_length(r.items), coalesce(rc.raw_filled, 0) + coalesce(rc.default_items, 0))
        else coalesce(f.items_count, 0) end as filled_count,
      case when r.id is not null then coalesce(rc.raw_failed, 0) else 0 end as failed_count,
      r.updated_at
      from public.organization_units u left join fleet f on f.ulp_id = u.id left join reports r on r.ulp_id = u.id
      left join report_counts rc on rc.report_id = r.id
      where u.type = 'ULP' and u.parent_id = p_up3_id
  ) select coalesce(jsonb_agg(jsonb_build_object('ulp_id', c.ulp_id, 'vehicle_count', c.vehicle_count,
      'missing_plates', c.missing_plates, 'items_count', c.items_count, 'filled_count', c.filled_count,
      'failed_count', c.failed_count,
      'report_status', case when c.vehicle_count = 0 then 'no_assigned_vehicles'
        when c.missing_plates > 0 or c.filled_count < c.items_count then 'draft'
        when c.failed_count > 0 then 'non_compliant' else 'compliant' end,
      'updated_at', c.updated_at) order by c.sort_order, c.legacy_key, c.ulp_id), '[]'::jsonb)
    from computed c);
end;
$$;

revoke all on function public.ops_list_vehicle_condition_overview(uuid, uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.ops_list_vehicle_condition_overview(uuid, uuid, date)
  to authenticated;
