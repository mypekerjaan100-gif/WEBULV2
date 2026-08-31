-- Keep Rp0 Konstruksi data detection aligned with the active F5 ULP matrix.
create or replace function public.get_variable_financial_trend(
  p_contract_id uuid,p_up3_id uuid,p_end_period_month date,p_unit_id uuid default null,p_month_count integer default 6
) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare
  v_end_month date;v_period_month date;v_dashboard jsonb;v_summary jsonb;
  v_months jsonb:='[]'::jsonb;v_required_count integer;v_has_data boolean;v_offset integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_month_count not in (6,12) then raise exception 'month_count must be 6 or 12'; end if;
  v_end_month:=date_trunc('month',p_end_period_month::timestamp)::date;
  if v_end_month is null then raise exception 'end_period_month is required'; end if;
  if p_unit_id is null then
    if not public.auth_can_manage_up3_operations(p_contract_id,p_up3_id) then raise exception 'Not authorized to read Financial Trend in this UP3' using errcode='42501'; end if;
  elsif not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id,p_up3_id,p_unit_id) then raise exception 'Not authorized to read Financial Trend in this scope' using errcode='42501';
  end if;
  for v_offset in 0..p_month_count-1 loop
    v_period_month:=(v_end_month-make_interval(months=>p_month_count-1-v_offset))::date;
    if exists(select 1 from public.sla_versions version where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE' and v_period_month between version.period_start and version.period_end) then
      v_dashboard:=public.get_variable_financial_dashboard(p_contract_id,p_up3_id,v_period_month,p_unit_id);
      v_summary:=v_dashboard->'summary';
      v_required_count:=coalesce((v_summary->>'configured_target_count')::integer,0)+coalesce((v_summary->>'missing_target_count')::integer,0);
      v_has_data:=coalesce((v_summary->>'configured_target_count')::integer,0)>0
        or coalesce((v_summary->>'actual_amount')::numeric,0)<>0
        or coalesce((v_summary->>'missing_price_count')::integer,0)>0
        or exists(select 1 from jsonb_array_elements(v_dashboard->'cells') cell where jsonb_array_length(coalesce(cell->'actual_indicator_ids','[]'::jsonb))>0)
        or exists(
          select 1 from public.variable_cost_konstruksi_monthly_amounts amount
          where amount.contract_id=p_contract_id and amount.up3_id=p_up3_id and amount.period_month=v_period_month
            and (p_unit_id is null or amount.unit_id=p_unit_id)
            and public.auth_can_manage_pelayanan_teknik_scope(p_contract_id,p_up3_id,amount.unit_id)
            and exists(select 1 from public.organization_units unit where unit.id=amount.unit_id and unit.type='ULP' and unit.parent_id=p_up3_id and unit.own_status='Aktif')
        );
      v_months:=v_months||jsonb_build_array(jsonb_build_object(
        'period_month',v_period_month,'target_amount',coalesce((v_summary->>'target_amount')::numeric,0),
        'actual_amount',coalesce((v_summary->>'actual_amount')::numeric,0),
        'difference_amount',case when v_summary->>'difference_amount' is null then null else (v_summary->>'difference_amount')::numeric end,
        'achievement_percent',case when v_summary->>'achievement_percent' is null then null else (v_summary->>'achievement_percent')::numeric end,
        'configured_target_count',coalesce((v_summary->>'configured_target_count')::integer,0),
        'required_target_count',v_required_count,'missing_target_count',coalesce((v_summary->>'missing_target_count')::integer,0),
        'target_complete',v_required_count>0 and coalesce((v_summary->>'missing_target_count')::integer,0)=0,
        'missing_price_count',coalesce((v_summary->>'missing_price_count')::integer,0),'has_data',v_has_data
      ));
    else
      v_months:=v_months||jsonb_build_array(jsonb_build_object(
        'period_month',v_period_month,'target_amount',0,'actual_amount',0,'difference_amount',null,'achievement_percent',null,
        'configured_target_count',0,'required_target_count',0,'missing_target_count',0,'target_complete',false,'missing_price_count',0,'has_data',false
      ));
    end if;
  end loop;
  return jsonb_build_object('end_period_month',v_end_month,'month_count',p_month_count,'months',v_months);
end;
$function$;
revoke all on function public.get_variable_financial_trend(uuid,uuid,date,uuid,integer) from public,anon,authenticated;
grant execute on function public.get_variable_financial_trend(uuid,uuid,date,uuid,integer) to authenticated,service_role;
notify pgrst,'reload schema';
