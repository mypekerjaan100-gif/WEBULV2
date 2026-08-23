-- Master Lokasi: Persistent Display Order (sort_order) for ULP and Locations

-- 1. Add sort_order column to organization_units (for ULP ordering under UP3)
alter table public.organization_units
add column if not exists sort_order integer not null default 0;

create index if not exists idx_organization_units_parent_sort
  on public.organization_units (parent_id, sort_order)
  where parent_id is not null;

-- 2. Add sort_order column to locations (for KANTOR_JAGA and UNIT_OFFICE ordering under ULP)
alter table public.locations
add column if not exists sort_order integer not null default 0;

create index if not exists idx_locations_unit_sort
  on public.locations (unit_id, sort_order)
  where type in ('UNIT_OFFICE', 'KANTOR_JAGA');

-- 3. Backfill sort_order for existing ULP rows under each UP3
-- Order by legacy_key for deterministic initial ordering
with ranked_ulps as (
  select
    id,
    row_number() over (partition by parent_id order by legacy_key) - 1 as rn
  from public.organization_units
  where type = 'ULP' and parent_id is not null
)
update public.organization_units ou
set sort_order = ranked_ulps.rn
from ranked_ulps
where ou.id = ranked_ulps.id;

-- 4. Backfill sort_order for existing locations per unit
-- UNIT_OFFICE first (sort_order = 0), then KANTOR_JAGA by legacy_key
with ranked_locations as (
  select
    id,
    row_number() over (partition by unit_id order by type desc, legacy_key) - 1 as rn
  from public.locations
  where type in ('UNIT_OFFICE', 'KANTOR_JAGA')
)
update public.locations loc
set sort_order = ranked_locations.rn
from ranked_locations
where loc.id = ranked_locations.id;

-- 5. RPC: Reorder ULP within same UP3
create or replace function public.reorder_organization_units(
  p_unit_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_up3_id uuid;
  v_idx integer;
  v_unit_id uuid;
  v_parent_id uuid;
  v_type text;
begin
  -- Authorization: SUPER_ADMIN or ADMIN_UP3 for the UP3
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Must have at least 2 IDs to reorder
  if p_unit_ids is null or array_length(p_unit_ids, 1) < 2 then
    raise exception 'At least two unit IDs required' using errcode = '22023';
  end if;

  -- Verify all units are ULPs under the same UP3
  select parent_id, type
    into v_up3_id, v_type
  from public.organization_units
  where id = p_unit_ids[1]
  for update;

  if v_type is distinct from 'ULP' or v_up3_id is null then
    raise exception 'Only ULP units can be reordered' using errcode = '42501';
  end if;

  -- Verify all units belong to the same UP3
  for v_idx in 1..array_length(p_unit_ids, 1) loop
    v_unit_id := p_unit_ids[v_idx];
    select parent_id, type
      into v_parent_id, v_type
    from public.organization_units
    where id = v_unit_id
    for update;

    if v_type is distinct from 'ULP' or v_parent_id is distinct from v_up3_id then
      raise exception 'All units must be ULPs under the same UP3' using errcode = '42501';
    end if;
  end loop;

  -- Authorization check: user must be SUPER_ADMIN or ADMIN_UP3 for this UP3
  if not public.auth_is_super_admin() then
    if not exists (
      select 1
      from public.contract_memberships cm
      join public.authorization_roles ar on ar.id = cm.role_id
      where cm.user_id = auth.uid()
        and ar.code in ('SUPER_ADMIN', 'ADMIN_UP3')
        and cm.contract_id = (
          select c.id
          from public.contracts c
          join public.contract_up3_scopes s on s.contract_id = c.id
          where s.up3_id = v_up3_id
            and s.status = 'Aktif'
        )
        and cm.is_active
    ) then
      raise exception 'Not authorized to reorder ULPs in this UP3' using errcode = '42501';
    end if;
  end if;

  -- Perform reorder by updating sort_order
  for v_idx in 1..array_length(p_unit_ids, 1) loop
    v_unit_id := p_unit_ids[v_idx];
    update public.organization_units
      set sort_order = v_idx - 1,
          updated_by = auth.uid()
    where id = v_unit_id;
  end loop;

  return true;
end;
$$;

-- 6. RPC: Reorder locations within same ULP
create or replace function public.reorder_locations(
  p_location_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_unit_id uuid;
  v_idx integer;
  v_location_id uuid;
  v_type text;
  v_location_unit_id uuid;
begin
  -- Authorization
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_location_ids is null or array_length(p_location_ids, 1) < 2 then
    raise exception 'At least two location IDs required' using errcode = '22023';
  end if;

  -- Verify all locations belong to the same ULP
  select unit_id, type
    into v_unit_id, v_type
  from public.locations
  where id = p_location_ids[1]
  for update;

  if v_type not in ('UNIT_OFFICE', 'KANTOR_JAGA') then
    raise exception 'Only UNIT_OFFICE and KANTOR_JAGA can be reordered' using errcode = '42501';
  end if;

  for v_idx in 1..array_length(p_location_ids, 1) loop
    v_location_id := p_location_ids[v_idx];
    select unit_id, type
      into v_location_unit_id, v_type
    from public.locations
    where id = v_location_id
    for update;

    if v_location_unit_id is distinct from v_unit_id then
      raise exception 'All locations must belong to the same ULP' using errcode = '42501';
    end if;
    if v_type not in ('UNIT_OFFICE', 'KANTOR_JAGA') then
      raise exception 'Only UNIT_OFFICE and KANTOR_JAGA can be reordered' using errcode = '42501';
    end if;
  end loop;

  -- Authorization check
  if not public.auth_is_super_admin() then
    if not exists (
      select 1
      from public.contract_memberships cm
      join public.authorization_roles ar on ar.id = cm.role_id
      where cm.user_id = auth.uid()
        and ar.code in ('SUPER_ADMIN', 'ADMIN_UP3')
        and cm.contract_id = (
          select c.id
          from public.contracts c
          join public.contract_up3_scopes s on s.contract_id = c.id
          where s.up3_id = (
            select ou.parent_id
            from public.organization_units ou
            where ou.id = v_unit_id
          )
            and s.status = 'Aktif'
        )
        and cm.is_active
    ) then
      raise exception 'Not authorized to reorder locations in this ULP' using errcode = '42501';
    end if;
  end if;

  -- Perform reorder by updating sort_order
  for v_idx in 1..array_length(p_location_ids, 1) loop
    v_location_id := p_location_ids[v_idx];
    update public.locations
      set sort_order = v_idx - 1,
          updated_by = auth.uid()
    where id = v_location_id;
  end loop;

  return true;
end;
$$;

-- 7. Revoke and grant execute permissions
revoke all on function public.reorder_organization_units(uuid[]) from public, anon;
revoke all on function public.reorder_locations(uuid[]) from public, anon;

grant execute on function public.reorder_organization_units(uuid[]) to authenticated;
grant execute on function public.reorder_locations(uuid[]) to authenticated;