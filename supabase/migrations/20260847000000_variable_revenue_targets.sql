-- F4: manual Target Pendapatan for the 9 unit-priced Variable indicators.
create table public.variable_revenue_targets (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  operational_up3_id uuid not null references public.organization_units(id) on delete restrict,
  operational_unit_id uuid not null references public.organization_units(id) on delete restrict,
  indicator_id uuid not null,
  period_month date not null,
  target_amount numeric(18,2) not null check (target_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  revision integer not null default 1,
  constraint variable_revenue_target_month_start check (period_month = date_trunc('month', period_month::timestamp)::date),
  constraint variable_revenue_target_identity unique (contract_id, operational_up3_id, operational_unit_id, indicator_id, period_month)
);

create index idx_variable_revenue_targets_scope
  on public.variable_revenue_targets (contract_id, operational_up3_id, period_month, operational_unit_id, indicator_id);

create trigger trg_variable_revenue_targets_touch
  before update on public.variable_revenue_targets
  for each row execute function public.touch_audit_columns();

alter table public.variable_revenue_targets enable row level security;
revoke all on public.variable_revenue_targets from public, anon, authenticated;

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
  select exists (
      select 1 from public.sla_versions version
      where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE'
        and p_period_month between version.period_start and version.period_end
    ) and (
      public.is_tebang_variable_indicator(p_indicator_id)
      or exists (
      select 1
      from public.sla_indicators indicator
      join public.sla_versions version on version.id=indicator.sla_version_id
      where indicator.id=p_indicator_id
        and version.contract_id=p_contract_id
        and version.up3_id=p_up3_id
        and version.status='ACTIVE'
        and p_period_month between version.period_start and version.period_end
        and indicator.input_mode='VARIABLE_COST'
        and indicator.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1b','3.2a','3.2b')
      )
    );
$function$;

revoke all on function public.is_current_variable_revenue_target_indicator(uuid,uuid,uuid,date) from public,anon,authenticated;

create or replace function public.list_variable_revenue_targets(
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
declare
  v_month date;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;
  if v_month is null then raise exception 'period_month is required'; end if;
  if p_unit_id is null then
    if not public.auth_can_manage_up3_operations(p_contract_id, p_up3_id) then
      raise exception 'Not authorized to read Target Pendapatan in this UP3' using errcode='42501';
    end if;
  elsif not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, p_unit_id) then
    raise exception 'Not authorized to read Target Pendapatan in this scope' using errcode='42501';
  end if;

  return query
  with eligible_indicators as (
    select indicator.id as indicator_id, indicator.point_code as indicator_code
    from public.sla_indicators indicator
    join public.sla_versions version on version.id=indicator.sla_version_id
    where version.contract_id=p_contract_id
      and version.up3_id=p_up3_id
      and version.status='ACTIVE'
      and v_month between version.period_start and version.period_end
      and indicator.input_mode='VARIABLE_COST'
      and indicator.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1b','3.2a','3.2b')
    union all select '7e5b0214-f394-4f1e-86ad-2040d1972040'::uuid, 'TEBANG_20_40_CM'::text where exists (select 1 from public.sla_versions version where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE' and v_month between version.period_start and version.period_end)
    union all select 'b612e8c7-68b6-4ed7-9bba-4060d1974060'::uuid, 'TEBANG_40_60_CM'::text where exists (select 1 from public.sla_versions version where version.contract_id=p_contract_id and version.up3_id=p_up3_id and version.status='ACTIVE' and v_month between version.period_start and version.period_end)
  ), allowed_units as (
    select unit.id as unit_id
    from public.organization_units unit
    where unit.type='ULP'
      and unit.parent_id=p_up3_id
      and unit.own_status='Aktif'
      and (p_unit_id is null or unit.id=p_unit_id)
      and public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, unit.id)
  )
  select allowed.unit_id, eligible.indicator_id, eligible.indicator_code, target.target_amount
  from allowed_units allowed
  cross join eligible_indicators eligible
  left join public.variable_revenue_targets target
    on target.contract_id=p_contract_id
   and target.operational_up3_id=p_up3_id
   and target.operational_unit_id=allowed.unit_id
   and target.indicator_id=eligible.indicator_id
   and target.period_month=v_month
  order by allowed.unit_id, eligible.indicator_id;
end;
$function$;

create or replace function public.set_variable_revenue_targets(
  p_contract_id uuid,
  p_up3_id uuid,
  p_period_month date,
  p_values jsonb
)
returns integer
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
  if jsonb_typeof(p_values) is distinct from 'array' or jsonb_array_length(p_values)=0 then
    raise exception 'values must be a non-empty array';
  end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;
  if v_month is null then raise exception 'period_month is required'; end if;
  if (
    select count(distinct concat_ws(':',value->>'unit_id',value->>'indicator_id'))
    from jsonb_array_elements(p_values)
  ) <> jsonb_array_length(p_values) then
    raise exception 'duplicate unit_id and indicator_id in values';
  end if;

  -- Validate the complete matrix before any target is changed.
  for v_value in select value from jsonb_array_elements(p_values) loop
    v_unit_id := (v_value->>'unit_id')::uuid;
    v_indicator_id := (v_value->>'indicator_id')::uuid;
    v_target := (v_value->>'target_amount')::numeric;
    if not exists (
      select 1 from public.organization_units unit
      where unit.id=v_unit_id and unit.type='ULP' and unit.parent_id=p_up3_id and unit.own_status='Aktif'
    ) then raise exception 'unit_id must be an active child ULP of up3_id'; end if;
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
      where contract_id=p_contract_id and operational_up3_id=p_up3_id
        and operational_unit_id=v_unit_id and indicator_id=v_indicator_id and period_month=v_month;
    else
      insert into public.variable_revenue_targets(
        contract_id,operational_up3_id,operational_unit_id,indicator_id,period_month,target_amount,created_by,updated_by
      ) values (
        p_contract_id,p_up3_id,v_unit_id,v_indicator_id,v_month,v_target,auth.uid(),auth.uid()
      )
      on conflict (contract_id,operational_up3_id,operational_unit_id,indicator_id,period_month)
      do update set target_amount=excluded.target_amount,updated_by=auth.uid();
    end if;
    get diagnostics v_affected = row_count;
    v_changed := v_changed + v_affected;
  end loop;
  return v_changed;
end;
$function$;

revoke all on function public.list_variable_revenue_targets(uuid,uuid,date,uuid) from public,anon,authenticated;
revoke all on function public.set_variable_revenue_targets(uuid,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.list_variable_revenue_targets(uuid,uuid,date,uuid) to authenticated,service_role;
grant execute on function public.set_variable_revenue_targets(uuid,uuid,date,jsonb) to authenticated,service_role;

comment on table public.variable_revenue_targets is 'Manual Target Pendapatan per ULP/month for exactly 9 unit-priced Variable indicators; isolated from SLA and Konstruksi.';

notify pgrst, 'reload schema';
