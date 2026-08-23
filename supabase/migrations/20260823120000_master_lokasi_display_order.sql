-- Master Lokasi: persistent display order for ULPs and locations.

alter table public.organization_units
  add column if not exists sort_order integer not null default 0;

alter table public.locations
  add column if not exists sort_order integer not null default 0;

-- Establish a deterministic initial order without changing IDs or relationships.
with ranked_ulps as (
  select
    id,
    row_number() over (partition by parent_id order by legacy_key, id) - 1 as position
  from public.organization_units
  where type = 'ULP'
    and parent_id is not null
)
update public.organization_units as unit
set sort_order = ranked_ulps.position
from ranked_ulps
where unit.id = ranked_ulps.id;

with ranked_locations as (
  select
    id,
    row_number() over (
      partition by contract_id, unit_id
      order by case when type = 'UNIT_OFFICE' then 0 else 1 end, legacy_key, id
    ) - 1 as position
  from public.locations
  where type in ('UNIT_OFFICE', 'KANTOR_JAGA')
)
update public.locations as location
set sort_order = ranked_locations.position
from ranked_locations
where location.id = ranked_locations.id;

create index if not exists idx_organization_units_parent_sort
  on public.organization_units (parent_id, sort_order, id)
  where type = 'ULP' and parent_id is not null;

create index if not exists idx_locations_unit_sort
  on public.locations (contract_id, unit_id, sort_order, id)
  where type in ('UNIT_OFFICE', 'KANTOR_JAGA');

create or replace function public.reorder_organization_units(p_unit_ids uuid[])
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_up3_id uuid;
  v_supplied_count integer := coalesce(cardinality(p_unit_ids), 0);
  v_distinct_count integer;
  v_matching_count integer;
  v_sibling_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_supplied_count < 2 then
    raise exception 'At least two unit IDs are required' using errcode = '22023';
  end if;

  select count(distinct supplied.id)
  into v_distinct_count
  from unnest(p_unit_ids) as supplied(id);

  if v_distinct_count <> v_supplied_count then
    raise exception 'Duplicate unit IDs are not allowed' using errcode = '22023';
  end if;

  select unit.parent_id
  into v_up3_id
  from public.organization_units as unit
  where unit.id = p_unit_ids[1]
    and unit.type = 'ULP';

  if v_up3_id is null then
    raise exception 'The target must contain ULP rows' using errcode = '22023';
  end if;

  perform 1
  from public.organization_units as unit
  where unit.parent_id = v_up3_id
    and unit.type = 'ULP'
  for update;

  select count(*)
  into v_matching_count
  from public.organization_units as unit
  where unit.id = any(p_unit_ids)
    and unit.type = 'ULP'
    and unit.parent_id = v_up3_id;

  select count(*)
  into v_sibling_count
  from public.organization_units as unit
  where unit.type = 'ULP'
    and unit.parent_id = v_up3_id;

  if v_matching_count <> v_supplied_count then
    raise exception 'Every supplied unit must be a sibling ULP under the same UP3'
      using errcode = '22023';
  end if;

  if v_sibling_count <> v_supplied_count then
    raise exception 'The complete sibling ULP list is required' using errcode = '22023';
  end if;

  if not public.auth_is_super_admin() and not exists (
    select 1
    from public.contract_memberships as membership
    join public.contracts as contract
      on contract.id = membership.contract_id
     and contract.status = 'active'
    join public.contract_up3_scopes as scope
      on scope.contract_id = membership.contract_id
     and scope.up3_id = membership.operational_up3_id
     and scope.status = 'Aktif'
    where membership.user_id = auth.uid()
      and membership.contract_role = 'ADMIN_UP3'
      and membership.operational_up3_id = v_up3_id
      and membership.operational_unit_id is null
      and membership.status = 'ACTIVE'
      and membership.effective_from <= current_date
      and (membership.effective_to is null or membership.effective_to > current_date)
  ) then
    raise exception 'Not authorized to reorder ULPs in this UP3' using errcode = '42501';
  end if;

  update public.organization_units as unit
  set sort_order = supplied.position - 1
  from unnest(p_unit_ids) with ordinality as supplied(id, position)
  where unit.id = supplied.id;

  return true;
end;
$$;

create or replace function public.reorder_locations(p_location_ids uuid[])
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract_id uuid;
  v_up3_id uuid;
  v_unit_id uuid;
  v_supplied_count integer := coalesce(cardinality(p_location_ids), 0);
  v_distinct_count integer;
  v_matching_count integer;
  v_sibling_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_supplied_count < 2 then
    raise exception 'At least two location IDs are required' using errcode = '22023';
  end if;

  select count(distinct supplied.id)
  into v_distinct_count
  from unnest(p_location_ids) as supplied(id);

  if v_distinct_count <> v_supplied_count then
    raise exception 'Duplicate location IDs are not allowed' using errcode = '22023';
  end if;

  select location.contract_id, location.up3_id, location.unit_id
  into v_contract_id, v_up3_id, v_unit_id
  from public.locations as location
  join public.organization_units as unit
    on unit.id = location.unit_id
   and unit.type = 'ULP'
   and unit.parent_id = location.up3_id
  where location.id = p_location_ids[1]
    and location.type in ('UNIT_OFFICE', 'KANTOR_JAGA');

  if v_unit_id is null then
    raise exception 'Locations can only be reordered inside a ULP' using errcode = '22023';
  end if;

  perform 1
  from public.locations as location
  where location.contract_id = v_contract_id
    and location.unit_id = v_unit_id
    and location.type in ('UNIT_OFFICE', 'KANTOR_JAGA')
  for update;

  select count(*)
  into v_matching_count
  from public.locations as location
  where location.id = any(p_location_ids)
    and location.contract_id = v_contract_id
    and location.up3_id = v_up3_id
    and location.unit_id = v_unit_id
    and location.type in ('UNIT_OFFICE', 'KANTOR_JAGA');

  select count(*)
  into v_sibling_count
  from public.locations as location
  where location.contract_id = v_contract_id
    and location.up3_id = v_up3_id
    and location.unit_id = v_unit_id
    and location.type in ('UNIT_OFFICE', 'KANTOR_JAGA');

  if v_matching_count <> v_supplied_count then
    raise exception 'Every supplied location must belong to the same ULP'
      using errcode = '22023';
  end if;

  if v_sibling_count <> v_supplied_count then
    raise exception 'The complete sibling location list is required' using errcode = '22023';
  end if;

  if not public.auth_is_super_admin() and not exists (
    select 1
    from public.contract_memberships as membership
    join public.contracts as contract
      on contract.id = membership.contract_id
     and contract.status = 'active'
    join public.contract_up3_scopes as scope
      on scope.contract_id = membership.contract_id
     and scope.up3_id = membership.operational_up3_id
     and scope.status = 'Aktif'
    where membership.user_id = auth.uid()
      and membership.contract_id = v_contract_id
      and membership.contract_role = 'ADMIN_UP3'
      and membership.operational_up3_id = v_up3_id
      and membership.operational_unit_id is null
      and membership.status = 'ACTIVE'
      and membership.effective_from <= current_date
      and (membership.effective_to is null or membership.effective_to > current_date)
  ) then
    raise exception 'Not authorized to reorder locations in this UP3' using errcode = '42501';
  end if;

  update public.locations as location
  set sort_order = supplied.position - 1
  from unnest(p_location_ids) with ordinality as supplied(id, position)
  where location.id = supplied.id;

  return true;
end;
$$;

-- New Kantor Jaga rows are appended using the current database order.
create or replace function public.create_kantor_jaga(
  p_contract_id uuid,
  p_unit_id uuid,
  p_name text,
  p_effective_from date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_location_id uuid := gen_random_uuid();
  v_up3_id uuid;
  v_unit_type text;
  v_unit_status text;
  v_name text := btrim(p_name);
  v_sort_order integer;
begin
  if auth.uid() is null or not public.auth_is_super_admin() then
    raise exception 'Not authorized to create Kantor Jaga' using errcode = '42501';
  end if;
  if v_name = '' or p_effective_from is null then
    raise exception 'Name and effective date are required' using errcode = '22023';
  end if;

  select unit.parent_id, unit.type, unit.own_status
  into v_up3_id, v_unit_type, v_unit_status
  from public.organization_units as unit
  where unit.id = p_unit_id;

  if v_unit_type is distinct from 'ULP' or v_up3_id is null or v_unit_status <> 'Aktif' then
    raise exception 'Kantor Jaga must belong to an active ULP' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.contract_up3_scopes as scope
    where scope.contract_id = p_contract_id
      and scope.up3_id = v_up3_id
      and scope.status = 'Aktif'
  ) then
    raise exception 'ULP is outside the active contract scope' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.locations as location
    join public.location_name_history as history
      on history.location_id = location.id
     and history.effective_to is null
    where location.contract_id = p_contract_id
      and location.unit_id = p_unit_id
      and location.type = 'KANTOR_JAGA'
      and lower(history.name) = lower(v_name)
  ) then
    raise exception 'Kantor Jaga with this name already exists in the unit'
      using errcode = '23505';
  end if;

  perform 1
  from public.locations as location
  where location.contract_id = p_contract_id
    and location.unit_id = p_unit_id
    and location.type in ('UNIT_OFFICE', 'KANTOR_JAGA')
  for update;

  select coalesce(max(location.sort_order), -1) + 1
  into v_sort_order
  from public.locations as location
  where location.contract_id = p_contract_id
    and location.unit_id = p_unit_id
    and location.type in ('UNIT_OFFICE', 'KANTOR_JAGA');

  insert into public.locations (
    id,
    legacy_key,
    contract_id,
    up3_id,
    unit_id,
    type,
    own_status,
    sort_order,
    created_by,
    updated_by
  ) values (
    v_location_id,
    'loc-kj-' || replace(v_location_id::text, '-', ''),
    p_contract_id,
    v_up3_id,
    p_unit_id,
    'KANTOR_JAGA',
    'Aktif',
    v_sort_order,
    auth.uid(),
    auth.uid()
  );

  insert into public.location_name_history (
    location_id,
    name,
    effective_from,
    created_by
  ) values (
    v_location_id,
    v_name,
    p_effective_from,
    auth.uid()
  );

  return v_location_id;
end;
$$;

revoke all on function public.reorder_organization_units(uuid[]) from public, anon;
revoke all on function public.reorder_locations(uuid[]) from public, anon;

grant execute on function public.reorder_organization_units(uuid[]) to authenticated;
grant execute on function public.reorder_locations(uuid[]) to authenticated;
