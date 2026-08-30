-- Include canonical Variable codes in the target matrix projection.
drop function public.list_variable_revenue_targets(uuid,uuid,date,uuid);

create function public.list_variable_revenue_targets(
  p_contract_id uuid,
  p_up3_id uuid,
  p_period_month date,
  p_unit_id uuid default null
)
returns table (unit_id uuid, indicator_id uuid, indicator_code text, target_amount numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare v_month date;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_month := date_trunc('month',p_period_month::timestamp)::date;
  if v_month is null then raise exception 'period_month is required'; end if;
  if p_unit_id is null then
    if not public.auth_can_manage_up3_operations(p_contract_id,p_up3_id) then raise exception 'Not authorized to read Target Pendapatan in this UP3' using errcode='42501'; end if;
  elsif not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id,p_up3_id,p_unit_id) then
    raise exception 'Not authorized to read Target Pendapatan in this scope' using errcode='42501';
  end if;
  return query
  with eligible_indicators as (
    select indicator.id indicator_id,indicator.point_code indicator_code
    from public.sla_indicators indicator join public.sla_versions version on version.id=indicator.sla_version_id
    where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE' and v_month between version.period_start and version.period_end
      and indicator.input_mode='VARIABLE_COST' and indicator.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1b','3.2a','3.2b')
    union all select '7e5b0214-f394-4f1e-86ad-2040d1972040'::uuid,'TEBANG_20_40_CM'::text where exists (select 1 from public.sla_versions version where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE' and v_month between version.period_start and version.period_end)
    union all select 'b612e8c7-68b6-4ed7-9bba-4060d1974060'::uuid,'TEBANG_40_60_CM'::text where exists (select 1 from public.sla_versions version where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE' and v_month between version.period_start and version.period_end)
  ), allowed_units as (
    select unit.id unit_id from public.organization_units unit
    where unit.type='ULP' and unit.parent_id=p_up3_id and unit.own_status='Aktif'
      and (p_unit_id is null or unit.id=p_unit_id)
      and public.auth_can_manage_pelayanan_teknik_scope(p_contract_id,p_up3_id,unit.id)
  )
  select allowed.unit_id,eligible.indicator_id,eligible.indicator_code,target.target_amount
  from allowed_units allowed cross join eligible_indicators eligible
  left join public.variable_revenue_targets target
    on target.contract_id=p_contract_id and target.operational_up3_id=p_up3_id
   and target.operational_unit_id=allowed.unit_id and target.indicator_id=eligible.indicator_id and target.period_month=v_month
  order by allowed.unit_id,eligible.indicator_code;
end;
$function$;

revoke all on function public.list_variable_revenue_targets(uuid,uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.list_variable_revenue_targets(uuid,uuid,date,uuid) to authenticated,service_role;
notify pgrst,'reload schema';
