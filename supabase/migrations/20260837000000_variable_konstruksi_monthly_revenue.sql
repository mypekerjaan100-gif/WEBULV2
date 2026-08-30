-- Variable Konstruksi F1: direct monthly revenue per ULP, outside daily approval workflow.

create table public.variable_cost_konstruksi_monthly_amounts (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  up3_id uuid not null references public.organization_units(id) on delete restrict,
  unit_id uuid not null references public.organization_units(id) on delete restrict,
  period_month date not null,
  indicator_id uuid not null references public.sla_indicators(id) on delete restrict,
  amount_rp numeric(18,2) not null check (amount_rp >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  revision integer not null default 1,
  constraint variable_konstruksi_period_month_start check (period_month = date_trunc('month', period_month::timestamp)::date),
  constraint variable_konstruksi_monthly_identity unique (contract_id, up3_id, unit_id, period_month, indicator_id)
);

create index idx_variable_konstruksi_monthly_scope
  on public.variable_cost_konstruksi_monthly_amounts (contract_id, up3_id, period_month, unit_id);

create trigger trg_variable_konstruksi_monthly_touch
  before update on public.variable_cost_konstruksi_monthly_amounts
  for each row execute function public.touch_audit_columns();

create table public.variable_cost_konstruksi_amount_history (
  id uuid primary key default gen_random_uuid(),
  monthly_amount_id uuid not null references public.variable_cost_konstruksi_monthly_amounts(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  up3_id uuid not null references public.organization_units(id) on delete restrict,
  unit_id uuid not null references public.organization_units(id) on delete restrict,
  period_month date not null,
  indicator_id uuid not null references public.sla_indicators(id) on delete restrict,
  old_amount numeric(18,2),
  new_amount numeric(18,2) not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  constraint variable_konstruksi_history_old_amount check (old_amount is null or old_amount >= 0),
  constraint variable_konstruksi_history_new_amount check (new_amount >= 0)
);

create index idx_variable_konstruksi_history_record
  on public.variable_cost_konstruksi_amount_history (monthly_amount_id, changed_at desc);

alter table public.variable_cost_konstruksi_monthly_amounts enable row level security;
alter table public.variable_cost_konstruksi_amount_history enable row level security;

create policy variable_konstruksi_monthly_select_scope
  on public.variable_cost_konstruksi_monthly_amounts
  for select to authenticated
  using (public.auth_can_access_variable_scope(contract_id, up3_id, unit_id));

create policy variable_konstruksi_history_select_scope
  on public.variable_cost_konstruksi_amount_history
  for select to authenticated
  using (public.auth_can_access_variable_scope(contract_id, up3_id, unit_id));

grant select on public.variable_cost_konstruksi_monthly_amounts to authenticated;
grant select on public.variable_cost_konstruksi_amount_history to authenticated;
revoke insert, update, delete on public.variable_cost_konstruksi_monthly_amounts from public, anon, authenticated;
revoke insert, update, delete on public.variable_cost_konstruksi_amount_history from public, anon, authenticated;

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
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, p_unit_id) then
    raise exception 'Not authorized to manage Konstruksi in this scope' using errcode = '42501';
  end if;
  if p_amount_rp is null or p_amount_rp < 0 then
    raise exception 'amount_rp must be greater than or equal to zero';
  end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;
  if not exists (
    select 1
    from public.organization_units unit
    where unit.id = p_unit_id
      and unit.type = 'ULP'
      and unit.parent_id = p_up3_id
      and unit.own_status = 'Aktif'
  ) then
    raise exception 'unit_id must be an active child ULP of up3_id';
  end if;
  if not exists (
    select 1
    from public.sla_indicators indicator
    join public.sla_versions version on version.id = indicator.sla_version_id
    where indicator.id = p_indicator_id
      and indicator.point_code = '3.1c'
      and indicator.variable_cost_profile = 'KONSTRUKSI'
      and version.contract_id = p_contract_id
      and version.up3_id = p_up3_id
      and version.status = 'ACTIVE'
      and v_month between date_trunc('month', version.period_start::timestamp)::date
                      and date_trunc('month', version.period_end::timestamp)::date
  ) then
    raise exception 'canonical active Konstruksi indicator not found for this scope and period';
  end if;

  select * into v_existing
  from public.variable_cost_konstruksi_monthly_amounts
  where contract_id = p_contract_id
    and up3_id = p_up3_id
    and unit_id = p_unit_id
    and period_month = v_month
    and indicator_id = p_indicator_id
  for update;

  if found then
    if v_existing.amount_rp = p_amount_rp then
      return v_existing;
    end if;
    update public.variable_cost_konstruksi_monthly_amounts
    set amount_rp = p_amount_rp,
        updated_by = auth.uid()
    where id = v_existing.id
    returning * into v_result;
  else
    insert into public.variable_cost_konstruksi_monthly_amounts (
      contract_id, up3_id, unit_id, period_month, indicator_id,
      amount_rp, created_by, updated_by
    ) values (
      p_contract_id, p_up3_id, p_unit_id, v_month, p_indicator_id,
      p_amount_rp, auth.uid(), auth.uid()
    ) returning * into v_result;
  end if;

  insert into public.variable_cost_konstruksi_amount_history (
    monthly_amount_id, contract_id, up3_id, unit_id, period_month,
    indicator_id, old_amount, new_amount, changed_by
  ) values (
    v_result.id, v_result.contract_id, v_result.up3_id, v_result.unit_id,
    v_result.period_month, v_result.indicator_id,
    case when v_existing.id is null then null else v_existing.amount_rp end,
    v_result.amount_rp, auth.uid()
  );

  return v_result;
end;
$$;

revoke all on function public.set_konstruksi_monthly_amount(uuid, uuid, uuid, date, uuid, numeric) from public, anon, authenticated;
grant execute on function public.set_konstruksi_monthly_amount(uuid, uuid, uuid, date, uuid, numeric) to authenticated;

comment on table public.variable_cost_konstruksi_monthly_amounts
  is 'Authoritative direct Konstruksi revenue per ULP/month. No daily input or approval status.';
