-- F3: derived actual Variable revenue for authorized UP3 and management users.
create or replace function public.list_variable_actual_revenue(
  p_contract_id uuid,
  p_up3_id uuid,
  p_period_month date,
  p_unit_id uuid default null
)
returns table (
  source_type text,
  unit_id uuid,
  indicator_id uuid,
  entry_id uuid,
  work_date date,
  realization numeric,
  unit_price numeric,
  price_effective_from date,
  revenue_amount numeric,
  price_missing boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_month date;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;
  if v_month is null then raise exception 'period_month is required'; end if;

  if p_unit_id is null then
    if not public.auth_can_manage_up3_operations(p_contract_id, p_up3_id) then
      raise exception 'Not authorized to read Variable revenue in this UP3' using errcode = '42501';
    end if;
  elsif not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, p_unit_id) then
    raise exception 'Not authorized to read Variable revenue in this scope' using errcode = '42501';
  end if;

  return query
  select
    'UNIT_RATE'::text,
    entry.unit_id,
    entry.indicator_id,
    entry.id,
    entry.work_date,
    entry.realization,
    price.unit_price,
    price.effective_from,
    case when price.unit_price is null then null else entry.realization * price.unit_price end,
    price.unit_price is null
  from public.variable_cost_entries entry
  left join lateral (
    select configured.unit_price, configured.effective_from
    from public.variable_unit_prices configured
    where configured.contract_id = entry.contract_id
      and configured.operational_up3_id = entry.up3_id
      and configured.indicator_id = entry.indicator_id
      and configured.effective_from <= entry.work_date
    order by configured.effective_from desc
    limit 1
  ) price on true
  where entry.contract_id = p_contract_id
    and entry.up3_id = p_up3_id
    and entry.status = 'APPROVED'
    and entry.work_date >= v_month
    and entry.work_date < (v_month + interval '1 month')::date
    and (p_unit_id is null or entry.unit_id = p_unit_id)
    and public.is_priced_variable_indicator(p_contract_id, p_up3_id, entry.indicator_id)
    and public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, entry.unit_id)

  union all

  select
    'KONSTRUKSI'::text,
    amount.unit_id,
    amount.indicator_id,
    null::uuid,
    amount.period_month,
    null::numeric,
    null::numeric,
    null::date,
    amount.amount_rp,
    false
  from public.variable_cost_konstruksi_monthly_amounts amount
  where amount.contract_id = p_contract_id
    and amount.up3_id = p_up3_id
    and amount.period_month = v_month
    and (p_unit_id is null or amount.unit_id = p_unit_id)
    and public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, amount.unit_id);
end;
$function$;

revoke all on function public.list_variable_actual_revenue(uuid,uuid,date,uuid) from public, anon, authenticated;
grant execute on function public.list_variable_actual_revenue(uuid,uuid,date,uuid) to authenticated, service_role;

comment on function public.list_variable_actual_revenue(uuid,uuid,date,uuid)
  is 'Derived APPROVED Variable revenue using each transaction work date, plus direct monthly Konstruksi actuals.';

notify pgrst, 'reload schema';
