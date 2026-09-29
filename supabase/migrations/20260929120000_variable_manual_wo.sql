-- Variable Cost via Spreadsheet (read-only): WO manual per ULP disimpan di sini.
-- Realisasi dibaca live dari Google Spreadsheet via Apps Script, bukan dari tabel ini.

create table public.variable_cost_manual_wo (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  up3_id uuid not null references public.organization_units(id) on delete restrict,
  unit_id uuid not null references public.organization_units(id) on delete restrict,
  period_month date not null,
  indicator_code text not null,
  wo_value numeric(18,2) not null check (wo_value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  revision integer not null default 1,
  constraint variable_manual_wo_period_month_start check (period_month = date_trunc('month', period_month::timestamp)::date),
  constraint variable_manual_wo_identity unique (contract_id, up3_id, unit_id, period_month, indicator_code)
);

create index idx_variable_manual_wo_scope
  on public.variable_cost_manual_wo (contract_id, up3_id, period_month, unit_id);

create trigger trg_variable_manual_wo_touch
  before update on public.variable_cost_manual_wo
  for each row execute function public.touch_audit_columns();

alter table public.variable_cost_manual_wo enable row level security;

create policy variable_manual_wo_select_scope
  on public.variable_cost_manual_wo
  for select to authenticated
  using (public.auth_can_access_variable_scope(contract_id, up3_id, unit_id));

grant select on public.variable_cost_manual_wo to authenticated;
revoke insert, update, delete on public.variable_cost_manual_wo from public, anon, authenticated;

create or replace function public.set_variable_manual_wo(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_period_month date,
  p_indicator_code text,
  p_wo_value numeric
)
returns public.variable_cost_manual_wo
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date;
  v_existing public.variable_cost_manual_wo%rowtype;
  v_result public.variable_cost_manual_wo%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.auth_can_access_variable_scope(p_contract_id, p_up3_id, p_unit_id) then raise exception 'Not authorized to set WO in this scope' using errcode = '42501'; end if;
  if p_indicator_code is null or btrim(p_indicator_code) = '' then raise exception 'indicator_code wajib diisi'; end if;
  if p_wo_value is null or p_wo_value < 0 then raise exception 'wo_value must be greater than or equal to zero'; end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;
  if not exists (select 1 from public.organization_units unit where unit.id=p_unit_id and unit.type='ULP' and unit.parent_id=p_up3_id and unit.own_status='Aktif') then raise exception 'unit_id must be an active child ULP of up3_id'; end if;

  select * into v_existing from public.variable_cost_manual_wo
  where contract_id=p_contract_id and up3_id=p_up3_id and unit_id=p_unit_id and period_month=v_month and indicator_code=btrim(p_indicator_code)
  for update;
  if found then
    if v_existing.wo_value=p_wo_value then return v_existing; end if;
    update public.variable_cost_manual_wo set wo_value=p_wo_value, updated_by=auth.uid() where id=v_existing.id returning * into v_result;
  else
    insert into public.variable_cost_manual_wo(contract_id,up3_id,unit_id,period_month,indicator_code,wo_value,created_by,updated_by)
    values(p_contract_id,p_up3_id,p_unit_id,v_month,btrim(p_indicator_code),p_wo_value,auth.uid(),auth.uid()) returning * into v_result;
  end if;
  return v_result;
end;
$$;

revoke all on function public.set_variable_manual_wo(uuid,uuid,uuid,date,text,numeric) from public,anon,authenticated;
grant execute on function public.set_variable_manual_wo(uuid,uuid,uuid,date,text,numeric) to authenticated;
comment on table public.variable_cost_manual_wo is 'WO manual per ULP/month/indikator untuk Variable Cost spreadsheet (read-only). Realisasi dibaca live dari spreadsheet.';
