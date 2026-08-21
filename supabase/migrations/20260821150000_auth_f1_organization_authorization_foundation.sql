-- AUTH-F1 - Organization-aware authorization foundation.
-- Scope only: schema and static permission packages.
-- No Auth users, user memberships, employee data, or employee RLS policies.

-- ============================================================================
-- 1. INTERNAL NUSA DAYA ORGANIZATION
-- Separate from public.organization_units, which remains the operational UP3/ULP master.
-- ============================================================================
create table public.internal_organization_units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  legacy_key text not null unique,
  name text not null,
  type text not null check (type in ('UP', 'UL')),
  parent_id uuid references public.internal_organization_units(id),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1
);

create or replace function public.validate_internal_organization_hierarchy()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_parent_type text;
begin
  if new.type = 'UP' then
    if new.parent_id is not null then
      raise exception 'internal UP cannot have a parent';
    end if;
  else
    if new.parent_id is null or new.parent_id = new.id then
      raise exception 'internal UL requires a distinct parent UP';
    end if;
    select type into v_parent_type
    from public.internal_organization_units
    where id = new.parent_id;
    if v_parent_type is distinct from 'UP' then
      raise exception 'internal UL parent must be an internal UP';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_internal_org_units_hierarchy
  before insert or update on public.internal_organization_units
  for each row execute function public.validate_internal_organization_hierarchy();

create trigger trg_internal_org_units_touch
  before update on public.internal_organization_units
  for each row execute function public.touch_audit_columns();

create index idx_internal_org_units_parent
  on public.internal_organization_units (parent_id)
  where parent_id is not null;
create index idx_internal_org_units_type_status
  on public.internal_organization_units (type, status);

-- ============================================================================
-- 2. ORGANIZATION MEMBERSHIPS
-- Organization role is intentionally separate from contract role.
-- ============================================================================
create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  internal_org_unit_id uuid not null
    references public.internal_organization_units(id) on delete cascade,
  organization_role text not null check (organization_role in (
    'MANAGER_UP',
    'ASMAN_OPERASI',
    'ASMAN_KEUANGAN',
    'MANAGER_UNIT',
    'TEAM_LEADER'
  )),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'INACTIVE')),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1,
  constraint organization_memberships_effective_range
    check (effective_to is null or effective_to > effective_from)
);

create unique index uq_organization_memberships_current
  on public.organization_memberships (user_id, internal_org_unit_id, organization_role)
  where effective_to is null;

alter table public.organization_memberships
  add constraint ex_organization_memberships_no_overlap
  exclude using gist (
    user_id with =,
    internal_org_unit_id with =,
    organization_role with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index idx_organization_memberships_user
  on public.organization_memberships (user_id, status, effective_from desc);
create index idx_organization_memberships_scope
  on public.organization_memberships (internal_org_unit_id, organization_role, status);

create trigger trg_organization_memberships_touch
  before update on public.organization_memberships
  for each row execute function public.touch_audit_columns();

-- ============================================================================
-- 3. INTERNAL ORGANIZATION -> CONTRACT ACCESS
-- operational_unit_id NULL means the exact operational UP3 scope, not a wildcard.
-- ============================================================================
create table public.organization_contract_access (
  id uuid primary key default gen_random_uuid(),
  internal_org_unit_id uuid not null
    references public.internal_organization_units(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  operational_up3_id uuid not null references public.organization_units(id),
  operational_unit_id uuid references public.organization_units(id),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'INACTIVE')),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1,
  constraint organization_contract_access_effective_range
    check (effective_to is null or effective_to > effective_from)
);

create or replace function public.validate_organization_contract_access_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_up3_type text;
  v_unit_type text;
  v_unit_parent uuid;
begin
  select type into v_up3_type
  from public.organization_units
  where id = new.operational_up3_id;
  if v_up3_type is distinct from 'UP3' then
    raise exception 'organization_contract_access.operational_up3_id must be a UP3';
  end if;

  if new.operational_unit_id is not null then
    select type, parent_id into v_unit_type, v_unit_parent
    from public.organization_units
    where id = new.operational_unit_id;
    if v_unit_type is distinct from 'ULP'
       or v_unit_parent is distinct from new.operational_up3_id then
      raise exception 'organization_contract_access.operational_unit_id must be a child ULP of operational_up3_id';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_organization_contract_access_scope
  before insert or update on public.organization_contract_access
  for each row execute function public.validate_organization_contract_access_scope();

create trigger trg_organization_contract_access_touch
  before update on public.organization_contract_access
  for each row execute function public.touch_audit_columns();

create unique index uq_organization_contract_access_current
  on public.organization_contract_access (
    internal_org_unit_id,
    contract_id,
    operational_up3_id,
    coalesce(operational_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where effective_to is null;

alter table public.organization_contract_access
  add constraint ex_organization_contract_access_no_overlap
  exclude using gist (
    internal_org_unit_id with =,
    contract_id with =,
    operational_up3_id with =,
    coalesce(operational_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index idx_organization_contract_access_internal
  on public.organization_contract_access (internal_org_unit_id, contract_id, status);
create index idx_organization_contract_access_operational
  on public.organization_contract_access (contract_id, operational_up3_id, operational_unit_id, status);

-- ============================================================================
-- 4. CONTRACT MEMBERSHIPS
-- ADMIN_UP3 and ADMIN_ULP are contract roles, not internal organization roles.
-- ============================================================================
create table public.contract_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  contract_role text not null check (contract_role in ('ADMIN_UP3', 'ADMIN_ULP')),
  operational_up3_id uuid not null references public.organization_units(id),
  operational_unit_id uuid references public.organization_units(id),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'INACTIVE')),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1,
  constraint contract_memberships_effective_range
    check (effective_to is null or effective_to > effective_from),
  constraint contract_memberships_role_scope
    check (
      (contract_role = 'ADMIN_UP3' and operational_unit_id is null)
      or
      (contract_role = 'ADMIN_ULP' and operational_unit_id is not null)
    )
);

create trigger trg_contract_memberships_scope
  before insert or update on public.contract_memberships
  for each row execute function public.validate_organization_contract_access_scope();

create trigger trg_contract_memberships_touch
  before update on public.contract_memberships
  for each row execute function public.touch_audit_columns();

create unique index uq_contract_memberships_current
  on public.contract_memberships (
    user_id,
    contract_id,
    contract_role,
    operational_up3_id,
    coalesce(operational_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where effective_to is null;

alter table public.contract_memberships
  add constraint ex_contract_memberships_no_overlap
  exclude using gist (
    user_id with =,
    contract_id with =,
    contract_role with =,
    operational_up3_id with =,
    coalesce(operational_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index idx_contract_memberships_user
  on public.contract_memberships (user_id, contract_id, contract_role, status);
create index idx_contract_memberships_scope
  on public.contract_memberships (contract_id, operational_up3_id, operational_unit_id, status);

-- ============================================================================
-- 5. PERMISSIONS AND ROLE PACKAGES
-- Static catalog/package rows only. No user or membership rows are inserted.
-- ============================================================================
create table public.authorization_permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.authorization_roles (
  id uuid primary key default gen_random_uuid(),
  role_namespace text not null check (role_namespace in ('ORGANIZATION', 'CONTRACT')),
  code text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint uq_authorization_roles_namespace_code unique (role_namespace, code)
);

create table public.authorization_role_permissions (
  role_id uuid not null references public.authorization_roles(id) on delete cascade,
  permission_id uuid not null references public.authorization_permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

insert into public.authorization_permissions (code, description)
values
  ('employee.read', 'Read employee records within authorized scope'),
  ('employee.sensitive_read', 'Read sensitive employee payment fields'),
  ('employee.manage', 'Manage employee records'),
  ('overtime.read', 'Read overtime records within authorized scope'),
  ('overtime.submit', 'Submit overtime records'),
  ('overtime.approve', 'Approve overtime records'),
  ('overtime.reject', 'Reject overtime records'),
  ('sla.read', 'Read SLA records'),
  ('sla.manage', 'Manage SLA records'),
  ('variable_cost.read', 'Read variable cost records'),
  ('variable_cost.manage', 'Manage variable cost records'),
  ('finance.read', 'Read finance-related records'),
  ('evidence.read', 'Read evidence records'),
  ('contract.monitor', 'Monitor assigned contract operations');

insert into public.authorization_roles (role_namespace, code, display_name)
values
  ('ORGANIZATION', 'MANAGER_UP', 'Manager UP'),
  ('ORGANIZATION', 'ASMAN_OPERASI', 'Asman Operasi'),
  ('ORGANIZATION', 'ASMAN_KEUANGAN', 'Asman Keuangan'),
  ('ORGANIZATION', 'MANAGER_UNIT', 'Manager Unit'),
  ('ORGANIZATION', 'TEAM_LEADER', 'Team Leader'),
  ('CONTRACT', 'ADMIN_UP3', 'Admin UP3'),
  ('CONTRACT', 'ADMIN_ULP', 'Admin ULP');

with package (role_namespace, role_code, permission_code) as (
  values
    ('ORGANIZATION', 'TEAM_LEADER', 'employee.read'),
    ('ORGANIZATION', 'TEAM_LEADER', 'overtime.read'),
    ('ORGANIZATION', 'TEAM_LEADER', 'sla.read'),
    ('ORGANIZATION', 'TEAM_LEADER', 'variable_cost.read'),
    ('ORGANIZATION', 'TEAM_LEADER', 'evidence.read'),
    ('ORGANIZATION', 'TEAM_LEADER', 'contract.monitor'),
    ('ORGANIZATION', 'MANAGER_UNIT', 'employee.read'),
    ('ORGANIZATION', 'MANAGER_UNIT', 'overtime.read'),
    ('ORGANIZATION', 'MANAGER_UNIT', 'sla.read'),
    ('ORGANIZATION', 'MANAGER_UNIT', 'variable_cost.read'),
    ('ORGANIZATION', 'MANAGER_UNIT', 'evidence.read'),
    ('ORGANIZATION', 'MANAGER_UNIT', 'finance.read'),
    ('ORGANIZATION', 'MANAGER_UNIT', 'contract.monitor'),
    ('ORGANIZATION', 'ASMAN_OPERASI', 'employee.read'),
    ('ORGANIZATION', 'ASMAN_OPERASI', 'overtime.read'),
    ('ORGANIZATION', 'ASMAN_OPERASI', 'sla.read'),
    ('ORGANIZATION', 'ASMAN_OPERASI', 'variable_cost.read'),
    ('ORGANIZATION', 'ASMAN_OPERASI', 'evidence.read'),
    ('ORGANIZATION', 'ASMAN_OPERASI', 'contract.monitor'),
    ('ORGANIZATION', 'ASMAN_KEUANGAN', 'finance.read'),
    ('ORGANIZATION', 'ASMAN_KEUANGAN', 'contract.monitor'),
    ('ORGANIZATION', 'MANAGER_UP', 'employee.read'),
    ('ORGANIZATION', 'MANAGER_UP', 'overtime.read'),
    ('ORGANIZATION', 'MANAGER_UP', 'sla.read'),
    ('ORGANIZATION', 'MANAGER_UP', 'variable_cost.read'),
    ('ORGANIZATION', 'MANAGER_UP', 'finance.read'),
    ('ORGANIZATION', 'MANAGER_UP', 'evidence.read'),
    ('ORGANIZATION', 'MANAGER_UP', 'contract.monitor'),
    ('CONTRACT', 'ADMIN_UP3', 'employee.read'),
    ('CONTRACT', 'ADMIN_UP3', 'overtime.read'),
    ('CONTRACT', 'ADMIN_UP3', 'overtime.approve'),
    ('CONTRACT', 'ADMIN_UP3', 'overtime.reject'),
    ('CONTRACT', 'ADMIN_UP3', 'evidence.read'),
    ('CONTRACT', 'ADMIN_UP3', 'contract.monitor'),
    ('CONTRACT', 'ADMIN_ULP', 'employee.read'),
    ('CONTRACT', 'ADMIN_ULP', 'overtime.read'),
    ('CONTRACT', 'ADMIN_ULP', 'overtime.submit')
)
insert into public.authorization_role_permissions (role_id, permission_id)
select r.id, p.id
from package
join public.authorization_roles r
  on r.role_namespace = package.role_namespace
 and r.code = package.role_code
join public.authorization_permissions p
  on p.code = package.permission_code;

-- ============================================================================
-- 6. RLS BASELINE - deny by default, no broad policies
-- ============================================================================
alter table public.internal_organization_units enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_contract_access enable row level security;
alter table public.contract_memberships enable row level security;
alter table public.authorization_permissions enable row level security;
alter table public.authorization_roles enable row level security;
alter table public.authorization_role_permissions enable row level security;

revoke all on public.internal_organization_units,
  public.organization_memberships,
  public.organization_contract_access,
  public.contract_memberships,
  public.authorization_permissions,
  public.authorization_roles,
  public.authorization_role_permissions
from anon, authenticated;

revoke execute on function public.validate_internal_organization_hierarchy() from public, anon, authenticated;
revoke execute on function public.validate_organization_contract_access_scope() from public, anon, authenticated;

-- Existing public.organization_units remains the operational UP3/ULP hierarchy.
-- Existing public.user_memberships remains intact as a compatibility layer.
-- No Auth users, user memberships, employees, or employee RLS policies are added here.
