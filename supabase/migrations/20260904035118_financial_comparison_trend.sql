-- Multi-period Financial Comparison reuses the canonical single-period RPC.
create or replace function public.get_financial_comparison_trend(
  p_contract_id uuid,
  p_up3_id uuid,
  p_end_period_month date,
  p_unit_id uuid default null,
  p_month_count integer default 6
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_end_month date;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_end_month := date_trunc('month', p_end_period_month::timestamp)::date;
  if v_end_month is null then raise exception 'end_period_month is required'; end if;
  if p_month_count not in (6, 12) then raise exception 'month_count must be 6 or 12'; end if;

  if not (
    public.auth_is_super_admin()
    or public.auth_has_financial_analysis_scope(p_contract_id, p_up3_id, p_unit_id)
  ) then
    raise exception 'Not authorized to read Financial Comparison trend in this scope' using errcode = '42501';
  end if;

  with months as (
    select month::date as period_month
    from generate_series(
      v_end_month - make_interval(months => p_month_count - 1),
      v_end_month,
      interval '1 month'
    ) month
    where exists (
      select 1
      from public.sla_versions version
      where version.contract_id = p_contract_id
        and version.up3_id = p_up3_id
        and version.status = 'ACTIVE'
        and month::date between version.period_start and version.period_end
    )
  ), snapshots as (
    select
      period_month,
      public.get_financial_comparison_dashboard(
        p_contract_id,
        p_up3_id,
        period_month,
        p_unit_id
      ) as snapshot
    from months
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'period_month', period_month,
        'revenue_components', snapshot -> 'revenue_components',
        'revenue_eligible_components', snapshot -> 'revenue_eligible_components',
        'cost_components', snapshot -> 'cost_components',
        'has_data', snapshot -> 'has_data'
      ) order by period_month
    ),
    '[]'::jsonb
  )
  into v_result
  from snapshots;

  return v_result;
end;
$function$;

revoke all on function public.get_financial_comparison_trend(uuid, uuid, date, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_financial_comparison_trend(uuid, uuid, date, uuid, integer) to authenticated, service_role;
comment on function public.get_financial_comparison_trend(uuid, uuid, date, uuid, integer) is
  'Financial Comparison 6/12-month trend using canonical monthly dashboard aggregation and strict financial analysis authorization.';

notify pgrst, 'reload schema';
