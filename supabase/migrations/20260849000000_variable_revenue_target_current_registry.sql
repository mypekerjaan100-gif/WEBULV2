-- Restrict target writes to the current canonical 9-indicator registry.
create or replace function public.is_current_variable_revenue_target_indicator(
  p_contract_id uuid,
  p_up3_id uuid,
  p_indicator_id uuid,
  p_period_month date
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (select 1 from public.sla_versions version where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE' and p_period_month between version.period_start and version.period_end)
    and (public.is_tebang_variable_indicator(p_indicator_id) or exists (
      select 1 from public.sla_indicators indicator
      join public.sla_versions version on version.id=indicator.sla_version_id
      where indicator.id=p_indicator_id and version.contract_id=p_contract_id and version.up3_id=p_up3_id
        and version.status='ACTIVE' and p_period_month between version.period_start and version.period_end and indicator.input_mode='VARIABLE_COST'
        and indicator.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1b','3.2a','3.2b')
    ));
$function$;

revoke all on function public.is_current_variable_revenue_target_indicator(uuid,uuid,uuid,date) from public,anon,authenticated;

create or replace function public.set_variable_revenue_targets(
  p_contract_id uuid,
  p_up3_id uuid,
  p_period_month date,
  p_values jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_month date;
  v_value jsonb;
  v_unit_id uuid;
  v_indicator_id uuid;
  v_target numeric;
  v_changed integer := 0;
  v_affected integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_values) is distinct from 'array' or jsonb_array_length(p_values)=0 then raise exception 'values must be a non-empty array'; end if;
  v_month := date_trunc('month',p_period_month::timestamp)::date;
  if v_month is null then raise exception 'period_month is required'; end if;
  if (select count(distinct concat_ws(':',value->>'unit_id',value->>'indicator_id')) from jsonb_array_elements(p_values)) <> jsonb_array_length(p_values) then
    raise exception 'duplicate unit_id and indicator_id in values';
  end if;
  for v_value in select value from jsonb_array_elements(p_values) loop
    v_unit_id := (v_value->>'unit_id')::uuid;
    v_indicator_id := (v_value->>'indicator_id')::uuid;
    v_target := (v_value->>'target_amount')::numeric;
    if not exists (select 1 from public.organization_units unit where unit.id=v_unit_id and unit.type='ULP' and unit.parent_id=p_up3_id and unit.own_status='Aktif') then
      raise exception 'unit_id must be an active child ULP of up3_id';
    end if;
    if not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id,p_up3_id,v_unit_id) then
      raise exception 'Not authorized to manage Target Pendapatan in this scope' using errcode='42501';
    end if;
    if not public.is_current_variable_revenue_target_indicator(p_contract_id,p_up3_id,v_indicator_id,v_month) then
      raise exception 'Indicator is not eligible for Target Pendapatan: %',v_indicator_id;
    end if;
    if v_target is not null and v_target < 0 then raise exception 'target_amount must be greater than or equal to zero'; end if;
  end loop;
  for v_value in select value from jsonb_array_elements(p_values) loop
    v_unit_id := (v_value->>'unit_id')::uuid;
    v_indicator_id := (v_value->>'indicator_id')::uuid;
    v_target := (v_value->>'target_amount')::numeric;
    if v_target is null then
      delete from public.variable_revenue_targets
      where contract_id=p_contract_id and operational_up3_id=p_up3_id and operational_unit_id=v_unit_id and indicator_id=v_indicator_id and period_month=v_month;
    else
      insert into public.variable_revenue_targets(contract_id,operational_up3_id,operational_unit_id,indicator_id,period_month,target_amount,created_by,updated_by)
      values(p_contract_id,p_up3_id,v_unit_id,v_indicator_id,v_month,v_target,auth.uid(),auth.uid())
      on conflict (contract_id,operational_up3_id,operational_unit_id,indicator_id,period_month)
      do update set target_amount=excluded.target_amount,updated_by=auth.uid();
    end if;
    get diagnostics v_affected = row_count;
    v_changed := v_changed+v_affected;
  end loop;
  return v_changed;
end;
$function$;

revoke all on function public.set_variable_revenue_targets(uuid,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.set_variable_revenue_targets(uuid,uuid,date,jsonb) to authenticated,service_role;
notify pgrst,'reload schema';
