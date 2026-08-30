-- Read-only current-period financial dashboard over the locked F3/F4 sources.
create or replace function public.get_variable_financial_dashboard(
  p_contract_id uuid,
  p_up3_id uuid,
  p_period_month date,
  p_unit_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_month date;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  v_month := date_trunc('month',p_period_month::timestamp)::date;
  if v_month is null then raise exception 'period_month is required'; end if;

  if p_unit_id is null then
    if not public.auth_can_manage_up3_operations(p_contract_id,p_up3_id) then
      raise exception 'Not authorized to read Financial Dashboard in this UP3' using errcode='42501';
    end if;
  elsif not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id,p_up3_id,p_unit_id) then
    raise exception 'Not authorized to read Financial Dashboard in this scope' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.sla_versions version
    where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE'
      and v_month between version.period_start and version.period_end
  ) then
    raise exception 'No active SLA version for this period';
  end if;

  if not (
    select count(*)=7 and count(distinct indicator.point_code)=7
    from public.sla_indicators indicator
    join public.sla_versions version on version.id=indicator.sla_version_id
    where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE'
      and v_month between version.period_start and version.period_end
      and indicator.input_mode='VARIABLE_COST'
      and indicator.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1b','3.2a','3.2b')
  ) then
    raise exception 'Canonical priced indicator registry is incomplete for this period';
  end if;

  if not exists (
    select 1
    from public.sla_indicators indicator
    join public.sla_versions version on version.id=indicator.sla_version_id
    where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE'
      and v_month between version.period_start and version.period_end
      and indicator.point_code='3.1c' and indicator.input_mode='VARIABLE_COST'
      and indicator.variable_cost_profile='KONSTRUKSI'
  ) then
    raise exception 'Canonical Konstruksi indicator is unavailable for this period';
  end if;

  with priced_targets as (
    select target.unit_id,target.indicator_id,target.indicator_code,target.target_amount
    from public.list_variable_revenue_targets(p_contract_id,p_up3_id,v_month,p_unit_id) target
  ), allowed_units as (
    select distinct target.unit_id from priced_targets target
  ), konstruksi_indicator as (
    select indicator.id
    from public.sla_indicators indicator
    join public.sla_versions version on version.id=indicator.sla_version_id
    where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE'
      and v_month between version.period_start and version.period_end
      and indicator.point_code='3.1c' and indicator.input_mode='VARIABLE_COST'
      and indicator.variable_cost_profile='KONSTRUKSI'
    limit 1
  ), matrix as (
    select
      target.unit_id,target.indicator_id,target.indicator_code,'UNIT_RATE'::text source_type,
      case target.indicator_code
        when '2.1a' then 'Inspeksi SUTM Tier 1'
        when '2.1b' then 'Inspeksi SUTM Tier 2'
        when '2.1c' then 'Inspeksi Gardu/Keypoint Tier 1'
        when '2.1d' then 'Inspeksi Gardu/Keypoint Tier 2'
        when '3.1b' then 'ROW Var'
        when '3.2a' then 'Pengukuran Gardu'
        when '3.2b' then 'Pemeliharaan Gardu'
        when 'TEBANG_20_40_CM' then 'Tebang 20-40 cm'
        when 'TEBANG_40_60_CM' then 'Tebang 40-60 cm'
      end indicator_name,
      case target.indicator_code
        when '2.1a' then 1 when '2.1b' then 2 when '2.1c' then 3 when '2.1d' then 4
        when '3.1b' then 5 when '3.2a' then 6 when '3.2b' then 7
        when 'TEBANG_20_40_CM' then 8 when 'TEBANG_40_60_CM' then 9
      end sort_order,
      target.target_amount
    from priced_targets target
    union all
    select
      unit.unit_id,indicator.id,'3.1c','KONSTRUKSI','Konstruksi',10,
      target.target_rp
    from allowed_units unit
    cross join konstruksi_indicator indicator
    left join public.variable_cost_konstruksi_monthly_targets target
      on target.contract_id=p_contract_id and target.up3_id=p_up3_id
     and target.unit_id=unit.unit_id and target.period_month=v_month
  ), actuals as (
    select
      actual.unit_id,actual.source_type,
      case
        when actual.source_type='KONSTRUKSI' then '3.1c'
        when actual.indicator_id='7e5b0214-f394-4f1e-86ad-2040d1972040'::uuid then 'TEBANG_20_40_CM'
        when actual.indicator_id='b612e8c7-68b6-4ed7-9bba-4060d1974060'::uuid then 'TEBANG_40_60_CM'
        else actual_indicator.point_code
      end indicator_code,
      coalesce(sum(actual.revenue_amount) filter (where actual.revenue_amount is not null),0)::numeric actual_amount,
      count(*) filter (where actual.price_missing)::bigint missing_price_count,
      array_agg(distinct actual.indicator_id) filter (where actual.source_type='UNIT_RATE') actual_indicator_ids
    from public.list_variable_actual_revenue(p_contract_id,p_up3_id,v_month,p_unit_id) actual
    left join public.sla_indicators actual_indicator on actual_indicator.id=actual.indicator_id
    group by actual.unit_id,actual.source_type,
      case
        when actual.source_type='KONSTRUKSI' then '3.1c'
        when actual.indicator_id='7e5b0214-f394-4f1e-86ad-2040d1972040'::uuid then 'TEBANG_20_40_CM'
        when actual.indicator_id='b612e8c7-68b6-4ed7-9bba-4060d1974060'::uuid then 'TEBANG_40_60_CM'
        else actual_indicator.point_code
      end
  ), cells as (
    select
      matrix.unit_id,matrix.indicator_id,matrix.indicator_code,matrix.indicator_name,
      matrix.source_type,matrix.sort_order,matrix.target_amount,
      coalesce(actual.actual_amount,0)::numeric actual_amount,
      (matrix.target_amount is null) target_missing,
      coalesce(actual.missing_price_count,0)::bigint missing_price_count,
      coalesce(actual.actual_indicator_ids,array[]::uuid[]) actual_indicator_ids
    from matrix
    left join actuals actual
     on actual.unit_id=matrix.unit_id
     and actual.source_type=matrix.source_type
     and actual.indicator_code=matrix.indicator_code
  ), calculated_cells as (
    select cells.*,
      case when not target_missing and missing_price_count=0 then actual_amount-target_amount end difference_amount,
      case when not target_missing and missing_price_count=0 and target_amount>0 then actual_amount/target_amount*100 end achievement_percent
    from cells
  ), summary_base as (
    select
      coalesce(sum(target_amount) filter (where target_amount is not null),0)::numeric target_amount,
      coalesce(sum(actual_amount),0)::numeric actual_amount,
      count(*) filter (where target_amount is not null)::bigint configured_target_count,
      count(*) filter (where target_missing)::bigint missing_target_count,
      coalesce(sum(missing_price_count),0)::bigint missing_price_count
    from calculated_cells
  ), summary as (
    select summary_base.*,
      case when missing_target_count=0 and missing_price_count=0 then actual_amount-target_amount end difference_amount,
      case when missing_target_count=0 and missing_price_count=0 and target_amount>0 then actual_amount/target_amount*100 end achievement_percent
    from summary_base
  ), unit_base as (
    select
      cell.unit_id,
      coalesce(sum(cell.target_amount) filter (where cell.target_amount is not null),0)::numeric target_amount,
      coalesce(sum(cell.actual_amount),0)::numeric actual_amount,
      count(*) filter (where cell.target_amount is not null)::bigint configured_target_count,
      count(*) filter (where cell.target_missing)::bigint missing_target_count,
      coalesce(sum(cell.missing_price_count),0)::bigint missing_price_count
    from calculated_cells cell
    group by cell.unit_id
  ), unit_totals as (
    select unit_base.*,
      case when missing_target_count=0 and missing_price_count=0 then actual_amount-target_amount end difference_amount,
      case when missing_target_count=0 and missing_price_count=0 and target_amount>0 then actual_amount/target_amount*100 end achievement_percent
    from unit_base
  ), indicator_base as (
    select
      cell.indicator_id,cell.indicator_code,cell.indicator_name,cell.source_type,cell.sort_order,
      coalesce(sum(cell.target_amount) filter (where cell.target_amount is not null),0)::numeric target_amount,
      coalesce(sum(cell.actual_amount),0)::numeric actual_amount,
      count(*) filter (where cell.target_amount is not null)::bigint configured_target_count,
      count(*) filter (where cell.target_missing)::bigint missing_target_count,
      coalesce(sum(cell.missing_price_count),0)::bigint missing_price_count
    from calculated_cells cell
    group by cell.indicator_id,cell.indicator_code,cell.indicator_name,cell.source_type,cell.sort_order
  ), indicator_totals as (
    select indicator_base.*,
      case when missing_target_count=0 and missing_price_count=0 then actual_amount-target_amount end difference_amount,
      case when missing_target_count=0 and missing_price_count=0 and target_amount>0 then actual_amount/target_amount*100 end achievement_percent
    from indicator_base
  )
  select jsonb_build_object(
    'period_month',v_month,
    'summary',coalesce((select to_jsonb(summary) from summary),'{}'::jsonb),
    'units',coalesce((select jsonb_agg(to_jsonb(unit_totals) order by unit_totals.unit_id) from unit_totals),'[]'::jsonb),
    'indicators',coalesce((select jsonb_agg(to_jsonb(indicator_totals) order by indicator_totals.sort_order) from indicator_totals),'[]'::jsonb),
    'cells',coalesce((select jsonb_agg(to_jsonb(calculated_cells) order by calculated_cells.sort_order,calculated_cells.unit_id) from calculated_cells),'[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_variable_financial_dashboard(uuid,uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.get_variable_financial_dashboard(uuid,uuid,date,uuid) to authenticated,service_role;
notify pgrst,'reload schema';
