-- AUTH-F2 - Canonical internal organization and contract ownership data.
-- Scope only: approved internal organization rows and Pelayanan Teknik access.
-- No Auth users, profiles, memberships, employees, or employee RLS policies.

do $$
declare
  v_up_id uuid;
  v_contract_id uuid;
  v_operational_up3_id uuid;
  v_ul_id uuid;
begin
  select id into v_contract_id
  from public.contracts
  where code = 'pelayanan-teknik' and status = 'active';
  if v_contract_id is null then
    raise exception 'Pelayanan Teknik contract not found';
  end if;

  select id into v_operational_up3_id
  from public.organization_units
  where legacy_key = 'up3' and type = 'UP3';
  if v_operational_up3_id is null then
    raise exception 'operational UP3 Singkawang not found';
  end if;

  insert into public.internal_organization_units
    (code, legacy_key, name, type, parent_id, status)
  values
    ('UP-KAL1', 'up-kalimantan-1', 'Unit Pelaksana Kalimantan 1', 'UP', null, 'ACTIVE')
  on conflict (legacy_key) do nothing;

  select id into v_up_id
  from public.internal_organization_units
  where code = 'UP-KAL1'
    and legacy_key = 'up-kalimantan-1'
    and name = 'Unit Pelaksana Kalimantan 1'
    and type = 'UP'
    and parent_id is null
    and status = 'ACTIVE';
  if v_up_id is null then
    raise exception 'UP-KAL1 conflicts with existing internal organization data';
  end if;

  insert into public.internal_organization_units
    (code, legacy_key, name, type, parent_id, status)
  values
    ('UL-SKW', 'ul-singkawang', 'Unit Layanan Singkawang', 'UL', v_up_id, 'ACTIVE'),
    ('UL-SGU', 'ul-sanggau', 'Unit Layanan Sanggau', 'UL', v_up_id, 'ACTIVE'),
    ('UL-KTP', 'ul-ketapang', 'Unit Layanan Ketapang', 'UL', v_up_id, 'ACTIVE'),
    ('UL-PTK', 'ul-pontianak', 'Unit Layanan Pontianak', 'UL', v_up_id, 'ACTIVE'),
    ('UL-MPW', 'ul-mempawah', 'Unit Layanan Mempawah', 'UL', v_up_id, 'ACTIVE')
  on conflict (legacy_key) do nothing;

  if exists (
    select 1
    from (values
      ('UL-SKW', 'ul-singkawang', 'Unit Layanan Singkawang'),
      ('UL-SGU', 'ul-sanggau', 'Unit Layanan Sanggau'),
      ('UL-KTP', 'ul-ketapang', 'Unit Layanan Ketapang'),
      ('UL-PTK', 'ul-pontianak', 'Unit Layanan Pontianak'),
      ('UL-MPW', 'ul-mempawah', 'Unit Layanan Mempawah')
    ) as expected(code, legacy_key, name)
    left join public.internal_organization_units actual
      on actual.code = expected.code
     and actual.legacy_key = expected.legacy_key
     and actual.name = expected.name
     and actual.type = 'UL'
     and actual.parent_id = v_up_id
     and actual.status = 'ACTIVE'
    where actual.id is null
  ) then
    raise exception 'canonical UL conflicts with existing internal organization data';
  end if;

  select id into v_ul_id
  from public.internal_organization_units
  where code = 'UL-SKW' and legacy_key = 'ul-singkawang';

  insert into public.organization_contract_access (
    internal_org_unit_id,
    contract_id,
    operational_up3_id,
    operational_unit_id,
    status,
    effective_from,
    effective_to
  )
  select v_ul_id, v_contract_id, v_operational_up3_id, null, 'ACTIVE', date '2024-07-18', null
  where not exists (
    select 1
    from public.organization_contract_access a
    where a.internal_org_unit_id = v_ul_id
      and a.contract_id = v_contract_id
      and a.operational_up3_id = v_operational_up3_id
      and a.operational_unit_id is null
      and a.effective_to is null
  );

  if (select count(*) from public.authorization_permissions) <> 14
     or (select count(*) from public.authorization_roles) <> 7
     or (select count(*) from public.authorization_role_permissions) <> 37 then
    raise exception 'AUTH-F1 permission catalog/package data is incomplete';
  end if;
end;
$$;

-- AUTH-F2 does not add users, profiles, memberships, employees, or RLS policies.
