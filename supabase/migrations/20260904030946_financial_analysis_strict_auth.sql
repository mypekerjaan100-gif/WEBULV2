-- Financial Analysis strict auth: only TL / Manager Unit / Manager UP (+ Super Admin) can read comparison dashboard.
-- No change to aggregation/business logic, only authorization scope is narrowed.

create or replace function public.auth_has_financial_analysis_scope(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.organization_memberships m
    join public.internal_organization_units assigned
      on assigned.id = m.internal_org_unit_id
     and assigned.status = 'ACTIVE'
    join public.internal_organization_units mapped_ul
      on mapped_ul.status = 'ACTIVE'
     and mapped_ul.type = 'UL'
     and (
       (m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT') and assigned.type = 'UL' and mapped_ul.id = assigned.id)
       or
       (m.organization_role = 'MANAGER_UP' and assigned.type = 'UP' and mapped_ul.parent_id = assigned.id)
     )
    join public.organization_contract_access oca
      on oca.internal_org_unit_id = mapped_ul.id
     and oca.status = 'ACTIVE'
     and oca.effective_from <= current_date
     and (oca.effective_to is null or current_date < oca.effective_to)
    where m.user_id = auth.uid()
      and m.status = 'ACTIVE'
      and m.effective_from <= current_date
      and (m.effective_to is null or current_date < m.effective_to)
      and m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT', 'MANAGER_UP')
      and oca.contract_id = p_contract_id
      and oca.operational_up3_id = p_up3_id
      and (
        p_unit_id is null
        or oca.operational_unit_id is null
        or oca.operational_unit_id = p_unit_id
      )
      and (
        p_unit_id is null
        or exists (
          select 1
          from public.organization_units ou
          where ou.id = p_unit_id
            and ou.type = 'ULP'
            and ou.parent_id = p_up3_id
            and ou.own_status = 'Aktif'
        )
      )
  )
$$;

revoke all on function public.auth_has_financial_analysis_scope(uuid, uuid, uuid) from public, anon;
grant execute on function public.auth_has_financial_analysis_scope(uuid, uuid, uuid) to authenticated;

-- Replace dashboard RPC with strict guard, keeping all aggregation logic identical
create or replace function public.get_financial_comparison_dashboard(
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
  v_month := date_trunc('month', p_period_month::timestamp)::date;
  if v_month is null then raise exception 'period_month is required'; end if;
  if v_month <> date_trunc('month', v_month::timestamp)::date then raise exception 'period_month must be first day of month'; end if;

  -- Strict financial analysis scope: Super Admin or TL/Manager/MUP with explicit UL mapping
  if p_unit_id is null then
    if not (public.auth_is_super_admin() or public.auth_has_financial_analysis_scope(p_contract_id, p_up3_id, null)) then
      raise exception 'Not authorized to read Financial Comparison in this UP3' using errcode='42501';
    end if;
  elsif not (public.auth_is_super_admin() or public.auth_has_financial_analysis_scope(p_contract_id, p_up3_id, p_unit_id)) then
    raise exception 'Not authorized to read Financial Comparison in this scope' using errcode='42501';
  end if;

  -- active version check (reuse canonical registry) required for revenue interpretation
  if not exists (
    select 1 from public.sla_versions version
    where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE'
      and v_month between version.period_start and version.period_end
  ) then
    raise exception 'No active SLA version for this period';
  end if;

  with
  -- Revenue: reuse canonical list_variable_actual_revenue
  revenue_raw as (
    select * from public.list_variable_actual_revenue(p_contract_id, p_up3_id, v_month, p_unit_id)
  ),
  revenue_by_code as (
    select
      case
        when actual.source_type='KONSTRUKSI' then '3.1c'
        when actual.indicator_id='7e5b0214-f394-4f1e-86ad-2040d1972040'::uuid then 'TEBANG_20_40_CM'
        when actual.indicator_id='b612e8c7-68b6-4ed7-9bba-4060d1974060'::uuid then 'TEBANG_40_60_CM'
        else ind.point_code
      end as indicator_code,
      coalesce(sum(actual.revenue_amount) filter (where actual.revenue_amount is not null),0)::numeric as amount,
      count(*) filter (where actual.price_missing)::bigint as missing_price_count
    from revenue_raw actual
    left join public.sla_indicators ind on ind.id = actual.indicator_id
    group by 1
  ),
  revenue_mapped as (
    select
      r.indicator_code,
      case r.indicator_code
        when '2.1a' then 'Inspeksi SUTM Tier 1'
        when '2.1b' then 'Inspeksi SUTM Tier 2'
        when '2.1c' then 'Inspeksi Gardu/Keypoint Tier 1'
        when '2.1d' then 'Inspeksi Gardu/Keypoint Tier 2'
        when '3.1a' then 'ROW Fix'
        when '3.1b' then 'ROW Var'
        when '3.2a' then 'Pengukuran Gardu'
        when '3.2b' then 'Pemeliharaan Gardu'
        when '3.1c' then 'Konstruksi'
        when 'TEBANG_20_40_CM' then 'Tebang 20–40 cm'
        when 'TEBANG_40_60_CM' then 'Tebang 40–60 cm'
        else coalesce(ind2.criteria, r.indicator_code)
      end as indicator_name,
      r.amount,
      r.missing_price_count,
      case r.indicator_code
        when '2.1a' then 1 when '2.1b' then 2 when '2.1c' then 3 when '2.1d' then 4
        when '3.1a' then 5 when '3.1b' then 6 when '3.2a' then 7 when '3.2b' then 8
        when '3.1c' then 9 when 'TEBANG_20_40_CM' then 10 when 'TEBANG_40_60_CM' then 11
        else 99
      end as sort_order,
      case when r.indicator_code='3.1a' then false else true end as revenue_eligible
    from revenue_by_code r
    left join public.sla_indicators ind2 on ind2.point_code = r.indicator_code and ind2.input_mode='VARIABLE_COST'
    where r.indicator_code is not null
  ),
  revenue_eligible as (
    select * from revenue_mapped where revenue_eligible = true
  ),
  cost_raw as (
    select
      a.id as activity_id,
      a.work_category,
      a.type,
      a.unit_id,
      e.calculated_amount_snapshot as amount
    from public.overtime_activities a
    join public.overtime_entries e on e.activity_id = a.id
    where a.contract_id = p_contract_id
      and a.up3_id = p_up3_id
      and a.status = 'APPROVED'
      and a.period_month = v_month
      and (p_unit_id is null or a.unit_id = p_unit_id)
      and public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, a.unit_id)
  ),
  cost_by_code as (
    select
      case
        when cr.type = 'WORK' then cr.work_category
        when cr.type = 'REPLACEMENT_LEAVE' then 'REPLACEMENT_LEAVE'
        when cr.type = 'REPLACEMENT_SICK' then 'REPLACEMENT_SICK'
        when cr.type = 'REPLACEMENT_PERMISSION' then 'REPLACEMENT_PERMISSION'
        else cr.type
      end as cost_code,
      sum(cr.amount)::numeric as amount,
      count(distinct cr.activity_id)::bigint as activity_count,
      count(*)::bigint as entry_count
    from cost_raw cr
    group by 1
  ),
  cost_mapped as (
    select
      c.cost_code,
      case c.cost_code
        when 'ADMINISTRASI' then 'Administrasi'
        when 'GARDU' then 'Gardu'
        when 'JTM' then 'JTM'
        when 'JTR' then 'JTR'
        when 'REPLACEMENT_LEAVE' then 'Pengganti Cuti'
        when 'REPLACEMENT_SICK' then 'Pengganti Sakit'
        when 'REPLACEMENT_PERMISSION' then 'Pengganti Izin'
        else c.cost_code
      end as cost_label,
      case c.cost_code
        when 'ADMINISTRASI' then 1 when 'GARDU' then 2 when 'JTM' then 3 when 'JTR' then 4
        when 'REPLACEMENT_LEAVE' then 5 when 'REPLACEMENT_SICK' then 6 when 'REPLACEMENT_PERMISSION' then 7
        else 99
      end as sort_order,
      c.amount,
      c.activity_count,
      c.entry_count
    from cost_by_code c
    where c.cost_code is not null
  ),
  revenue_total as (
    select coalesce(sum(amount),0)::numeric as total from revenue_eligible
  ),
  cost_total as (
    select coalesce(sum(amount),0)::numeric as total from cost_mapped
  ),
  summary as (
    select
      (select total from revenue_total) as revenue_amount,
      (select total from cost_total) as cost_amount,
      ((select total from revenue_total) - (select total from cost_total))::numeric as margin_amount,
      case when (select total from revenue_total) > 0
        then (((select total from revenue_total) - (select total from cost_total)) / (select total from revenue_total) * 100)::numeric
        else null end as margin_percent,
      case when (select total from cost_total) > 0 and (select total from revenue_total) > 0
        then ((select total from cost_total) / (select total from revenue_total) * 100)::numeric
        else null end as cost_ratio_percent
  )
  select jsonb_build_object(
    'period_month', v_month,
    'summary', (select to_jsonb(s) from summary s),
    'revenue_components', coalesce((select jsonb_agg(to_jsonb(r) order by r.sort_order) from revenue_mapped r), '[]'::jsonb),
    'revenue_eligible_components', coalesce((select jsonb_agg(to_jsonb(r) order by r.sort_order) from revenue_eligible r), '[]'::jsonb),
    'cost_components', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order) from cost_mapped c), '[]'::jsonb),
    'has_data', ((select total from revenue_total) > 0 or (select total from cost_total) > 0)
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.get_financial_comparison_dashboard(uuid,uuid,date,uuid) from public, anon, authenticated;
grant execute on function public.get_financial_comparison_dashboard(uuid,uuid,date,uuid) to authenticated, service_role;
comment on function public.get_financial_comparison_dashboard(uuid,uuid,date,uuid) is 'Financial Comparison (strict): aggregated revenue vs lembur cost, only TL/MANAGER_UNIT/MANAGER_UP + Super Admin, approved-only, period single-month.';
notify pgrst, 'reload schema';
