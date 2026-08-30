-- Konstruksi is monthly-only and has one authoritative amount per ULP/month.

create or replace function public.guard_variable_konstruksi_monthly_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_profile text;
begin
  select variable_cost_profile into v_profile
  from public.sla_indicators
  where id = new.indicator_id;
  if v_profile = 'KONSTRUKSI' then
    raise exception 'Konstruksi is managed through direct monthly revenue, not daily Variable Cost workflow';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_variable_konstruksi_monthly_only on public.variable_cost_entries;
create trigger trg_variable_konstruksi_monthly_only
  before insert or update on public.variable_cost_entries
  for each row execute function public.guard_variable_konstruksi_monthly_only();

alter table public.variable_cost_konstruksi_monthly_amounts
  drop constraint variable_konstruksi_monthly_identity;
alter table public.variable_cost_konstruksi_monthly_amounts
  add constraint variable_konstruksi_monthly_identity
  unique (contract_id, up3_id, unit_id, period_month);

create index idx_variable_konstruksi_history_scope
  on public.variable_cost_konstruksi_amount_history (contract_id, up3_id, unit_id, period_month);

create or replace function public.set_konstruksi_monthly_amount(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_period_month date,
  p_indicator_id uuid,
  p_amount_rp numeric
)
returns public.variable_cost_konstruksi_monthly_amounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date;
  v_existing public.variable_cost_konstruksi_monthly_amounts%rowtype;
  v_result public.variable_cost_konstruksi_monthly_amounts%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, p_unit_id) then raise exception 'Not authorized to manage Konstruksi in this scope' using errcode = '42501'; end if;
  if p_amount_rp is null or p_amount_rp < 0 then raise exception 'amount_rp must be greater than or equal to zero'; end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;
  if not exists (select 1 from public.organization_units unit where unit.id=p_unit_id and unit.type='ULP' and unit.parent_id=p_up3_id and unit.own_status='Aktif') then raise exception 'unit_id must be an active child ULP of up3_id'; end if;
  if not exists (
    select 1 from public.sla_indicators indicator join public.sla_versions version on version.id=indicator.sla_version_id
    where indicator.id=p_indicator_id and indicator.point_code='3.1c' and indicator.variable_cost_profile='KONSTRUKSI'
      and version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE'
      and v_month between date_trunc('month',version.period_start::timestamp)::date and date_trunc('month',version.period_end::timestamp)::date
  ) then raise exception 'canonical active Konstruksi indicator not found for this scope and period'; end if;

  select * into v_existing from public.variable_cost_konstruksi_monthly_amounts
  where contract_id=p_contract_id and up3_id=p_up3_id and unit_id=p_unit_id and period_month=v_month
  for update;
  if found then
    if v_existing.amount_rp=p_amount_rp and v_existing.indicator_id=p_indicator_id then return v_existing; end if;
    update public.variable_cost_konstruksi_monthly_amounts
    set indicator_id=p_indicator_id,amount_rp=p_amount_rp,updated_by=auth.uid()
    where id=v_existing.id returning * into v_result;
  else
    insert into public.variable_cost_konstruksi_monthly_amounts(contract_id,up3_id,unit_id,period_month,indicator_id,amount_rp,created_by,updated_by)
    values(p_contract_id,p_up3_id,p_unit_id,v_month,p_indicator_id,p_amount_rp,auth.uid(),auth.uid()) returning * into v_result;
  end if;
  insert into public.variable_cost_konstruksi_amount_history(monthly_amount_id,contract_id,up3_id,unit_id,period_month,indicator_id,old_amount,new_amount,changed_by)
  values(v_result.id,v_result.contract_id,v_result.up3_id,v_result.unit_id,v_result.period_month,v_result.indicator_id,case when v_existing.id is null then null else v_existing.amount_rp end,v_result.amount_rp,auth.uid());
  return v_result;
end;
$$;

create or replace function public.set_konstruksi_monthly_amounts(
  p_contract_id uuid,
  p_up3_id uuid,
  p_period_month date,
  p_indicator_id uuid,
  p_values jsonb
)
returns setof public.variable_cost_konstruksi_monthly_amounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value jsonb;
  v_result public.variable_cost_konstruksi_monthly_amounts%rowtype;
begin
  if jsonb_typeof(p_values) is distinct from 'array' or jsonb_array_length(p_values) = 0 then
    raise exception 'values must be a non-empty array';
  end if;
  for v_value in select value from jsonb_array_elements(p_values)
  loop
    select * into v_result
    from public.set_konstruksi_monthly_amount(
      p_contract_id,
      p_up3_id,
      (v_value->>'unit_id')::uuid,
      p_period_month,
      p_indicator_id,
      (v_value->>'amount_rp')::numeric
    );
    return next v_result;
  end loop;
  return;
end;
$$;

revoke all on function public.guard_variable_konstruksi_monthly_only() from public, anon, authenticated;
revoke all on function public.set_konstruksi_monthly_amount(uuid, uuid, uuid, date, uuid, numeric) from public, anon, authenticated;
revoke all on function public.set_konstruksi_monthly_amounts(uuid, uuid, date, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_konstruksi_monthly_amounts(uuid, uuid, date, uuid, jsonb) to authenticated;
