-- A UP3-scoped custom role has no ULP, but its UP3 must still be active and
-- mapped to the contract. Keep the ULP branch unchanged.
create or replace function public.validate_contract_membership_role()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_custom boolean;
  v_active boolean;
  v_level text;
begin
  if new.contract_role in ('ADMIN_UP3', 'ADMIN_ULP') then
    if new.contract_role = 'ADMIN_UP3' and new.operational_unit_id is not null then
      raise exception 'ADMIN_UP3 must not have operational unit';
    end if;
    if new.contract_role = 'ADMIN_ULP' and new.operational_unit_id is null then
      raise exception 'ADMIN_ULP requires operational unit';
    end if;
    return new;
  end if;

  select is_custom, is_active, role_level
    into v_custom, v_active, v_level
  from public.authorization_roles
  where code = new.contract_role and role_namespace = 'CONTRACT';
  if not found or not v_custom or not v_active
    or coalesce(v_level, '') not in ('ULP', 'UP3') then
    raise exception 'Invalid contract role';
  end if;

  if v_level = 'UP3' then
    if new.operational_unit_id is not null then
      raise exception 'Custom UP3 role must not have ULP';
    end if;
    if not exists (
      select 1 from public.organization_units u
      where u.id = new.operational_up3_id
        and u.type = 'UP3' and u.own_status = 'Aktif'
    ) then
      raise exception 'Invalid UP3 for role scope';
    end if;
    if not exists (
      select 1 from public.contract_up3_scopes s
      where s.contract_id = new.contract_id
        and s.up3_id = new.operational_up3_id
        and s.status = 'Aktif'
    ) then
      raise exception 'Contract is not scoped to this UP3';
    end if;
    return new;
  end if;

  if new.operational_unit_id is null then
    raise exception 'Custom ULP role requires operational unit';
  end if;
  if not exists (
    select 1 from public.organization_units u
    where u.id = new.operational_unit_id
      and u.type = 'ULP' and u.parent_id = new.operational_up3_id
      and u.own_status = 'Aktif'
  ) then
    raise exception 'Invalid ULP for role scope';
  end if;
  return new;
end;
$$;
