-- AUTH-F2.1 - System-level SUPER_ADMIN authorization foundation.
-- Scope only: permission catalog/package and future assignment audit schema.
-- No Auth users, user assignments, employee RLS, or business overrides.

-- ============================================================================
-- 1. EXTEND ROLE NAMESPACE WITH SYSTEM
-- Existing ORGANIZATION and CONTRACT roles remain unchanged.
-- ============================================================================
alter table public.authorization_roles
  drop constraint authorization_roles_role_namespace_check;

alter table public.authorization_roles
  add constraint authorization_roles_role_namespace_check
  check (role_namespace in ('SYSTEM', 'ORGANIZATION', 'CONTRACT'));

insert into public.authorization_roles (role_namespace, code, display_name)
values ('SYSTEM', 'SUPER_ADMIN', 'Super Admin')
on conflict (role_namespace, code) do nothing;

-- ============================================================================
-- 2. SUPER_ADMIN-REQUIRED PERMISSIONS
-- Existing permission codes are preserved; only missing capabilities are added.
-- ============================================================================
insert into public.authorization_permissions (code, description)
values
  ('organization.read', 'Read all internal and operational organization data'),
  ('organization.manage', 'Manage organization data'),
  ('contract.read', 'Read all contract data'),
  ('contract.manage', 'Manage contract data'),
  ('overtime.manage', 'Manage overtime records'),
  ('user.read', 'Read users and authorization assignments'),
  ('user.invite', 'Invite users through controlled Auth workflow'),
  ('user.assign_role', 'Assign or revoke authorization roles'),
  ('user.disable', 'Disable users through controlled Auth workflow'),
  ('user.manage_membership', 'Manage organization and contract memberships'),
  ('configuration.manage', 'Manage system configuration')
on conflict (code) do nothing;

-- SUPER_ADMIN receives the complete permission catalog currently defined.
insert into public.authorization_role_permissions (role_id, permission_id)
select r.id, p.id
from public.authorization_roles r
cross join public.authorization_permissions p
where r.role_namespace = 'SYSTEM'
  and r.code = 'SUPER_ADMIN'
on conflict (role_id, permission_id) do nothing;

-- ============================================================================
-- 3. FUTURE SYSTEM ROLE ASSIGNMENT
-- SUPER_ADMIN is independent from organization/contract memberships.
-- AUTH-F3 will control mutation and actor authorization.
-- ============================================================================
create table public.system_role_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.authorization_roles(id),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'INACTIVE')),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1,
  constraint system_role_memberships_effective_range
    check (effective_to is null or effective_to > effective_from)
);

create or replace function public.validate_system_role_membership()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_namespace text;
  v_code text;
begin
  select role_namespace, code
    into v_namespace, v_code
  from public.authorization_roles
  where id = new.role_id;
  if v_namespace is distinct from 'SYSTEM' or v_code is distinct from 'SUPER_ADMIN' then
    raise exception 'system_role_memberships only supports SYSTEM/SUPER_ADMIN';
  end if;
  return new;
end;
$$;

create trigger trg_system_role_memberships_validate
  before insert or update on public.system_role_memberships
  for each row execute function public.validate_system_role_membership();

create trigger trg_system_role_memberships_touch
  before update on public.system_role_memberships
  for each row execute function public.touch_audit_columns();

create unique index uq_system_role_memberships_current
  on public.system_role_memberships (user_id, role_id)
  where effective_to is null;

alter table public.system_role_memberships
  add constraint ex_system_role_memberships_no_overlap
  exclude using gist (
    user_id with =,
    role_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index idx_system_role_memberships_user
  on public.system_role_memberships (user_id, status, effective_from desc);

-- ============================================================================
-- 4. AUTHORIZATION AUDIT FOUNDATION
-- Supports future role assignment/revoke, controlled override, and View As.
-- ============================================================================
create table public.authorization_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'SYSTEM_ROLE_ASSIGNED',
    'SYSTEM_ROLE_REVOKED',
    'OVERRIDE_USED',
    'VIEW_AS_STARTED',
    'VIEW_AS_ENDED'
  )),
  actor_user_id uuid not null references auth.users(id),
  target_user_id uuid references auth.users(id),
  target_role_id uuid references public.authorization_roles(id),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint authorization_audit_override_reason
    check (
      event_type <> 'OVERRIDE_USED'
      or nullif(btrim(reason), '') is not null
    )
);

create index idx_authorization_audit_actor_time
  on public.authorization_audit_events (actor_user_id, occurred_at desc);
create index idx_authorization_audit_target_time
  on public.authorization_audit_events (target_user_id, occurred_at desc)
  where target_user_id is not null;

-- ============================================================================
-- 5. RLS BASELINE - deny by default, no broad policies
-- ============================================================================
alter table public.system_role_memberships enable row level security;
alter table public.authorization_audit_events enable row level security;

revoke all on public.system_role_memberships,
  public.authorization_audit_events
from anon, authenticated;

revoke execute on function public.validate_system_role_membership() from public, anon, authenticated;

-- No Auth users or system assignments are inserted by AUTH-F2.1.
-- Existing organization/contract memberships and employee data remain untouched.
