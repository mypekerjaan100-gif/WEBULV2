-- F2 Master Harga Satuan: UP3-level, effective-dated, 9 revenue indicators
create table public.variable_unit_prices (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  operational_up3_id uuid not null references public.organization_units(id) on delete restrict,
  indicator_id uuid not null,
  unit_price numeric(18,2) not null check (unit_price >= 0),
  effective_from date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  revision integer not null default 1,
  constraint variable_unit_price_effective_start check (effective_from = date_trunc('month', effective_from::timestamp)::date),
  constraint variable_unit_price_unique_version unique (contract_id, operational_up3_id, indicator_id, effective_from)
);

create index idx_variable_unit_prices_scope on public.variable_unit_prices (contract_id, operational_up3_id, indicator_id, effective_from desc);
create trigger trg_variable_unit_prices_touch before update on public.variable_unit_prices for each row execute function public.touch_audit_columns();

alter table public.variable_unit_prices enable row level security;

create policy variable_unit_prices_select_scope on public.variable_unit_prices for select to authenticated using (
  public.auth_can_manage_pelayanan_teknik_scope(
    contract_id,
    operational_up3_id,
    (select id from public.organization_units where parent_id=operational_up3_id and type='ULP' limit 1)
  )
);

revoke all on public.variable_unit_prices from public, anon, authenticated;

create or replace function public.is_priced_variable_indicator(
  p_contract_id uuid,
  p_up3_id uuid,
  p_indicator_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
  select public.is_tebang_variable_indicator(p_indicator_id)
    or exists (
      select 1
      from public.sla_indicators si
      join public.sla_versions sv on sv.id = si.sla_version_id
      where si.id = p_indicator_id
        and sv.contract_id = p_contract_id
        and sv.up3_id = p_up3_id
        and si.input_mode = 'VARIABLE_COST'
        and si.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1b','3.2a','3.2b')
    );
$function$;

revoke all on function public.is_priced_variable_indicator(uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.set_variable_unit_price(
  p_contract_id uuid,
  p_up3_id uuid,
  p_indicator_id uuid,
  p_effective_from date,
  p_unit_price numeric
) returns public.variable_unit_prices
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_effective date;
  v_existing public.variable_unit_prices%rowtype;
  v_result public.variable_unit_prices%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- use any child ULP for scope check (price is UP3-level, same for all ULP)
  if not exists (select 1 from public.organization_units where parent_id=p_up3_id and type='ULP' and own_status='Aktif') then raise exception 'UP3 has no active ULP'; end if;
  if not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, (select id from public.organization_units where parent_id=p_up3_id and type='ULP' limit 1)) and not public.auth_is_super_admin() then
    raise exception 'Not authorized to manage Harga Satuan in this scope' using errcode='42501';
  end if;
  if p_unit_price is null or p_unit_price < 0 then raise exception 'unit_price must be >=0'; end if;
  v_effective := date_trunc('month', p_effective_from::timestamp)::date;
  if v_effective is null then v_effective := p_effective_from; end if;
  if not public.is_priced_variable_indicator(p_contract_id, p_up3_id, p_indicator_id) then
    raise exception 'Indicator is not eligible for Harga Satuan: %', p_indicator_id;
  end if;
  -- check contract/UP3 active
  if not exists (select 1 from public.contracts where id=p_contract_id and status='active') then raise exception 'Invalid contract'; end if;
  if not exists (select 1 from public.organization_units where id=p_up3_id and type='UP3' and own_status='Aktif') then raise exception 'Invalid UP3'; end if;
  if not exists (select 1 from public.contract_up3_scopes where contract_id=p_contract_id and up3_id=p_up3_id and status='Aktif') then raise exception 'Contract not scoped to UP3'; end if;

  select * into v_existing from public.variable_unit_prices where contract_id=p_contract_id and operational_up3_id=p_up3_id and indicator_id=p_indicator_id and effective_from=v_effective for update;
  if found then
    if v_existing.unit_price = p_unit_price then return v_existing; end if;
    update public.variable_unit_prices set unit_price=p_unit_price, updated_by=auth.uid() where id=v_existing.id returning * into v_result;
  else
    insert into public.variable_unit_prices (contract_id, operational_up3_id, indicator_id, unit_price, effective_from, created_by, updated_by)
    values (p_contract_id, p_up3_id, p_indicator_id, p_unit_price, v_effective, auth.uid(), auth.uid()) returning * into v_result;
  end if;
  return v_result;
end;
$function$;

create or replace function public.set_variable_unit_prices(
  p_contract_id uuid,
  p_up3_id uuid,
  p_effective_from date,
  p_values jsonb
) returns setof public.variable_unit_prices
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_val jsonb; v_res public.variable_unit_prices%rowtype;
begin
  if jsonb_typeof(p_values) is distinct from 'array' or jsonb_array_length(p_values)=0 then raise exception 'values must be non-empty array'; end if;
  if (select count(distinct value->>'indicator_id') from jsonb_array_elements(p_values)) <> jsonb_array_length(p_values) then
    raise exception 'duplicate indicator_id in values';
  end if;
  -- Validate the complete payload before any row is written.
  for v_val in select value from jsonb_array_elements(p_values) loop
    if not public.is_priced_variable_indicator(p_contract_id, p_up3_id, (v_val->>'indicator_id')::uuid) then
      raise exception 'Indicator is not eligible for Harga Satuan: %', v_val->>'indicator_id';
    end if;
    if (v_val->>'unit_price')::numeric < 0 then raise exception 'unit_price must be >=0'; end if;
  end loop;
  for v_val in select value from jsonb_array_elements(p_values) loop
    select * into v_res from public.set_variable_unit_price(p_contract_id, p_up3_id, (v_val->>'indicator_id')::uuid, p_effective_from, (v_val->>'unit_price')::numeric);
    return next v_res;
  end loop; return;
end;
$function$;

revoke all on function public.set_variable_unit_price(uuid,uuid,uuid,date,numeric) from public, anon, authenticated;
revoke all on function public.set_variable_unit_prices(uuid,uuid,date,jsonb) from public, anon, authenticated;
grant execute on function public.set_variable_unit_prices(uuid,uuid,date,jsonb) to authenticated, service_role;

create or replace function public.list_variable_unit_prices(
  p_contract_id uuid,
  p_up3_id uuid,
  p_as_of date default null
) returns table (indicator_id uuid, unit_price numeric, effective_from date)
language sql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
  select distinct on (indicator_id) indicator_id, unit_price, effective_from
  from public.variable_unit_prices
  where contract_id=p_contract_id and operational_up3_id=p_up3_id
    and (p_as_of is null or effective_from <= p_as_of)
    and public.is_priced_variable_indicator(p_contract_id, p_up3_id, indicator_id)
    and public.auth_can_manage_pelayanan_teknik_scope(
      p_contract_id,
      p_up3_id,
      (select id from public.organization_units where parent_id=p_up3_id and type='ULP' limit 1)
    )
  order by indicator_id, effective_from desc;
$function$;

revoke all on function public.list_variable_unit_prices(uuid,uuid,date) from public, anon, authenticated;
grant execute on function public.list_variable_unit_prices(uuid,uuid,date) to authenticated, service_role;
