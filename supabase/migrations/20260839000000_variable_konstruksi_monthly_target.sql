-- Variable Konstruksi F1.1: Target Pendapatan monthly per ULP, isolated from SLA.

create table public.variable_cost_konstruksi_monthly_targets (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  up3_id uuid not null references public.organization_units(id) on delete restrict,
  unit_id uuid not null references public.organization_units(id) on delete restrict,
  period_month date not null,
  indicator_id uuid not null references public.sla_indicators(id) on delete restrict,
  target_rp numeric(18,2) not null check (target_rp >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  revision integer not null default 1,
  constraint variable_konstruksi_target_period_month_start check (period_month = date_trunc('month', period_month::timestamp)::date),
  constraint variable_konstruksi_target_monthly_identity unique (contract_id, up3_id, unit_id, period_month)
);

create index idx_variable_konstruksi_target_scope
  on public.variable_cost_konstruksi_monthly_targets (contract_id, up3_id, period_month, unit_id);

create trigger trg_variable_konstruksi_target_touch
  before update on public.variable_cost_konstruksi_monthly_targets
  for each row execute function public.touch_audit_columns();

create table public.variable_cost_konstruksi_target_history (
  id uuid primary key default gen_random_uuid(),
  monthly_target_id uuid not null references public.variable_cost_konstruksi_monthly_targets(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  up3_id uuid not null references public.organization_units(id) on delete restrict,
  unit_id uuid not null references public.organization_units(id) on delete restrict,
  period_month date not null,
  indicator_id uuid not null references public.sla_indicators(id) on delete restrict,
  old_target numeric(18,2),
  new_target numeric(18,2) not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  constraint variable_konstruksi_target_history_old check (old_target is null or old_target >= 0),
  constraint variable_konstruksi_target_history_new check (new_target >= 0)
);

create index idx_variable_konstruksi_target_history_record
  on public.variable_cost_konstruksi_target_history (monthly_target_id, changed_at desc);
create index idx_variable_konstruksi_target_history_scope
  on public.variable_cost_konstruksi_target_history (contract_id, up3_id, unit_id, period_month);

alter table public.variable_cost_konstruksi_monthly_targets enable row level security;
alter table public.variable_cost_konstruksi_target_history enable row level security;

create policy variable_konstruksi_target_select_scope
  on public.variable_cost_konstruksi_monthly_targets
  for select to authenticated
  using (public.auth_can_access_variable_scope(contract_id, up3_id, unit_id));

create policy variable_konstruksi_target_history_select_scope
  on public.variable_cost_konstruksi_target_history
  for select to authenticated
  using (public.auth_can_access_variable_scope(contract_id, up3_id, unit_id));

grant select on public.variable_cost_konstruksi_monthly_targets to authenticated;
grant select on public.variable_cost_konstruksi_target_history to authenticated;
revoke insert, update, delete on public.variable_cost_konstruksi_monthly_targets from public, anon, authenticated;
revoke insert, update, delete on public.variable_cost_konstruksi_target_history from public, anon, authenticated;

create or replace function public.set_konstruksi_monthly_target(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_period_month date,
  p_indicator_id uuid,
  p_target_rp numeric
)
returns public.variable_cost_konstruksi_monthly_targets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date;
  v_existing public.variable_cost_konstruksi_monthly_targets%rowtype;
  v_result public.variable_cost_konstruksi_monthly_targets%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, p_unit_id) then raise exception 'Not authorized to manage Konstruksi target in this scope' using errcode = '42501'; end if;
  if p_target_rp is null or p_target_rp < 0 then raise exception 'target_rp must be greater than or equal to zero'; end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;
  if not exists (select 1 from public.organization_units unit where unit.id=p_unit_id and unit.type='ULP' and unit.parent_id=p_up3_id and unit.own_status='Aktif') then raise exception 'unit_id must be an active child ULP of up3_id'; end if;
  if not exists (
    select 1 from public.sla_indicators indicator join public.sla_versions version on version.id=indicator.sla_version_id
    where indicator.id=p_indicator_id and indicator.point_code='3.1c' and indicator.variable_cost_profile='KONSTRUKSI'
      and version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE'
      and v_month between date_trunc('month',version.period_start::timestamp)::date and date_trunc('month',version.period_end::timestamp)::date
  ) then raise exception 'canonical active Konstruksi indicator not found for this scope and period'; end if;

  select * into v_existing from public.variable_cost_konstruksi_monthly_targets
  where contract_id=p_contract_id and up3_id=p_up3_id and unit_id=p_unit_id and period_month=v_month
  for update;
  if found then
    if v_existing.target_rp=p_target_rp and v_existing.indicator_id=p_indicator_id then return v_existing; end if;
    update public.variable_cost_konstruksi_monthly_targets set indicator_id=p_indicator_id, target_rp=p_target_rp, updated_by=auth.uid() where id=v_existing.id returning * into v_result;
  else
    insert into public.variable_cost_konstruksi_monthly_targets(contract_id,up3_id,unit_id,period_month,indicator_id,target_rp,created_by,updated_by)
    values(p_contract_id,p_up3_id,p_unit_id,v_month,p_indicator_id,p_target_rp,auth.uid(),auth.uid()) returning * into v_result;
  end if;
  insert into public.variable_cost_konstruksi_target_history(monthly_target_id,contract_id,up3_id,unit_id,period_month,indicator_id,old_target,new_target,changed_by)
  values(v_result.id,v_result.contract_id,v_result.up3_id,v_result.unit_id,v_result.period_month,v_result.indicator_id,case when v_existing.id is null then null else v_existing.target_rp end,v_result.target_rp,auth.uid());
  return v_result;
end;
$$;

create or replace function public.set_konstruksi_monthly_targets(
  p_contract_id uuid,
  p_up3_id uuid,
  p_period_month date,
  p_indicator_id uuid,
  p_values jsonb
)
returns setof public.variable_cost_konstruksi_monthly_targets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_value jsonb; v_result public.variable_cost_konstruksi_monthly_targets%rowtype;
begin
  if jsonb_typeof(p_values) is distinct from 'array' or jsonb_array_length(p_values)=0 then raise exception 'values must be a non-empty array'; end if;
  for v_value in select value from jsonb_array_elements(p_values) loop
    select * into v_result from public.set_konstruksi_monthly_target(p_contract_id,p_up3_id,(v_value->>'unit_id')::uuid,p_period_month,p_indicator_id,(v_value->>'target_rp')::numeric);
    return next v_result;
  end loop; return;
end;
$$;

revoke all on function public.set_konstruksi_monthly_target(uuid,uuid,uuid,date,uuid,numeric) from public,anon,authenticated;
revoke all on function public.set_konstruksi_monthly_targets(uuid,uuid,date,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.set_konstruksi_monthly_targets(uuid,uuid,date,uuid,jsonb) to authenticated;
comment on table public.variable_cost_konstruksi_monthly_targets is 'Authoritative Konstruksi Target Pendapatan per ULP/month. Isolated from SLA.';
