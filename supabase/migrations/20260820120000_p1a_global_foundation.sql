-- ============================================================================
-- P1A — SUPABASE GLOBAL FOUNDATION
-- Project: WEBULV2 (bssmimicruhmjcxkcmqz) | SKW Reporting
-- Source of truth: FINAL REVISED P1 PLAN (approved).
--
-- Scope (P1A ONLY):
--   contracts, organization_units, organization_name_history,
--   contract_up3_scopes, locations, location_name_history, positions,
--   profiles, user_memberships (scaffold)
--
-- Security baseline (P1A):
--   RLS ENABLED on every application table, NO policies (deny-by-default).
--   Full Auth/RLS policies are P2. No service_role/PAT in frontend.
--
-- Conventions:
--   UUID PK for all database entities.
--   Existing prototype stable string IDs preserved via legacy_key / code.
--   History: [effective_from, effective_to) — effective_to NULL = current.
--   effectiveStatus is COMPUTED/RESOLVED — never persisted.
--   No application data/seed in this migration.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- Shared audit / optimistic concurrency helper ------------------------------
-- All root tables: created_at, updated_at, created_by, updated_by, revision.
create or replace function public.touch_audit_columns()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.revision := new.revision + 1;
  return new;
end;
$$;

-- ============================================================================
-- 1. CONTRACTS
-- Existing prototype ID (e.g. 'pelayanan-teknik') kept as unique `code`.
-- ============================================================================
create table public.contracts (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  title       text not null,
  description text,
  status      text not null default 'active'
              check (status in ('active', 'inactive', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_by  uuid references auth.users(id),
  revision    integer not null default 1
);

create trigger trg_contracts_touch
  before update on public.contracts
  for each row execute function public.touch_audit_columns();

-- ============================================================================
-- 2. ORGANIZATION UNITS — GLOBAL MASTER (shared across contracts)
-- No exclusive contract ownership. Hierarchy: UP3 -> ULP.
-- legacy_key is globally unique. Contracts attach via contract_up3_scopes.
-- ============================================================================
create table public.organization_units (
  id          uuid primary key default gen_random_uuid(),
  legacy_key  text not null unique,
  type        text not null check (type in ('UP3', 'ULP')),
  parent_id   uuid references public.organization_units(id),
  own_status  text not null default 'Aktif'
              check (own_status in ('Aktif', 'Nonaktif')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_by  uuid references auth.users(id),
  revision    integer not null default 1
);

create or replace function public.validate_organization_hierarchy()
returns trigger
language plpgsql
as $$
declare
  v_parent_type text;
begin
  if new.parent_id is not null and new.parent_id = new.id then
    raise exception 'organization unit cannot be its own parent';
  end if;
  if new.type = 'UP3' then
    if new.parent_id is not null then
      raise exception 'UP3 unit cannot have a parent';
    end if;
  else
    if new.parent_id is null then
      raise exception 'ULP unit requires a parent UP3';
    end if;
    select type into v_parent_type
      from public.organization_units
     where id = new.parent_id;
    if v_parent_type is null then
      raise exception 'parent organization unit does not exist';
    end if;
    if v_parent_type <> 'UP3' then
      raise exception 'ULP parent must be a UP3 unit';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_organization_units_hierarchy
  before insert or update on public.organization_units
  for each row execute function public.validate_organization_hierarchy();

create trigger trg_organization_units_touch
  before update on public.organization_units
  for each row execute function public.touch_audit_columns();

create index idx_organization_units_parent
  on public.organization_units (parent_id)
  where parent_id is not null;

create index idx_organization_units_type
  on public.organization_units (type, own_status);

-- ============================================================================
-- 3. ORGANIZATION NAME HISTORY
-- [effective_from, effective_to): exactly one current row; no overlaps.
-- ============================================================================
create table public.organization_name_history (
  id                   uuid primary key default gen_random_uuid(),
  organization_unit_id uuid not null
                       references public.organization_units(id) on delete cascade,
  name                 text not null,
  effective_from       date not null,
  effective_to         date,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id),
  constraint org_name_history_effective_range
    check (effective_to is null or effective_to > effective_from)
);

create unique index uq_org_name_history_current
  on public.organization_name_history (organization_unit_id)
  where effective_to is null;

alter table public.organization_name_history
  add constraint ex_org_name_history_no_overlap
  exclude using gist (
    organization_unit_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index idx_org_name_history_unit
  on public.organization_name_history (organization_unit_id, effective_from desc);

-- ============================================================================
-- 4. CONTRACT <-> UP3 SCOPES
-- Many-to-many association. UP3/ULP are NEVER duplicated per contract.
-- ============================================================================
create table public.contract_up3_scopes (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  up3_id      uuid not null references public.organization_units(id) on delete cascade,
  status      text not null default 'Aktif'
              check (status in ('Aktif', 'Nonaktif')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_by  uuid references auth.users(id),
  revision    integer not null default 1,
  constraint uq_contract_up3_scope unique (contract_id, up3_id)
);

create or replace function public.validate_contract_up3_scope()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select type into v_type
    from public.organization_units
   where id = new.up3_id;
  if v_type is null then
    raise exception 'contract_up3_scopes.up3_id must reference an existing organization unit';
  end if;
  if v_type <> 'UP3' then
    raise exception 'contract_up3_scopes.up3_id must reference a UP3 unit';
  end if;
  return new;
end;
$$;

create trigger trg_contract_up3_scopes_validate
  before insert or update on public.contract_up3_scopes
  for each row execute function public.validate_contract_up3_scope();

create trigger trg_contract_up3_scopes_touch
  before update on public.contract_up3_scopes
  for each row execute function public.touch_audit_columns();

-- ============================================================================
-- 5. LOCATIONS
-- Scoped contract + UP3 + unit. Unit = UP3 itself or child ULP of up3_id.
-- Exactly one UNIT_OFFICE per (contract, unit); KANTOR_JAGA unlimited.
-- ============================================================================
create table public.locations (
  id          uuid primary key default gen_random_uuid(),
  legacy_key  text not null,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  up3_id      uuid not null references public.organization_units(id),
  unit_id     uuid not null references public.organization_units(id),
  type        text not null check (type in ('UNIT_OFFICE', 'KANTOR_JAGA')),
  own_status  text not null default 'Aktif'
              check (own_status in ('Aktif', 'Nonaktif')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_by  uuid references auth.users(id),
  revision    integer not null default 1,
  constraint uq_locations_legacy_key unique (contract_id, up3_id, legacy_key)
);

create unique index uq_locations_unit_office
  on public.locations (contract_id, unit_id)
  where type = 'UNIT_OFFICE';

create or replace function public.validate_location_scope()
returns trigger
language plpgsql
as $$
declare
  v_up3_type    text;
  v_unit_type   text;
  v_unit_parent uuid;
begin
  select type into v_up3_type
    from public.organization_units
   where id = new.up3_id;
  if v_up3_type is null or v_up3_type <> 'UP3' then
    raise exception 'locations.up3_id must reference a UP3 unit';
  end if;

  select type, parent_id into v_unit_type, v_unit_parent
    from public.organization_units
   where id = new.unit_id;
  if v_unit_type is null then
    raise exception 'locations.unit_id must reference an existing organization unit';
  end if;

  if new.unit_id <> new.up3_id then
    if v_unit_type <> 'ULP' or v_unit_parent is distinct from new.up3_id then
      raise exception 'locations.unit_id must be the UP3 itself or a child ULP of locations.up3_id';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_locations_scope_validate
  before insert or update on public.locations
  for each row execute function public.validate_location_scope();

create trigger trg_locations_touch
  before update on public.locations
  for each row execute function public.touch_audit_columns();

create index idx_locations_scope
  on public.locations (contract_id, up3_id, unit_id, type, own_status);

-- ============================================================================
-- 6. LOCATION NAME HISTORY
-- [effective_from, effective_to): exactly one current row; no overlaps.
-- ============================================================================
create table public.location_name_history (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references public.locations(id) on delete cascade,
  name           text not null,
  effective_from date not null,
  effective_to   date,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  constraint location_name_history_effective_range
    check (effective_to is null or effective_to > effective_from)
);

create unique index uq_location_name_history_current
  on public.location_name_history (location_id)
  where effective_to is null;

alter table public.location_name_history
  add constraint ex_location_name_history_no_overlap
  exclude using gist (
    location_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index idx_location_name_history_location
  on public.location_name_history (location_id, effective_from desc);

-- ============================================================================
-- 7. POSITIONS
-- Scoped contract + UP3. legacy_key scoped (contract, up3).
-- ============================================================================
create table public.positions (
  id          uuid primary key default gen_random_uuid(),
  legacy_key  text not null,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  up3_id      uuid not null references public.organization_units(id),
  name        text not null,
  description text,
  status      text not null default 'Aktif'
              check (status in ('Aktif', 'Nonaktif')),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_by  uuid references auth.users(id),
  revision    integer not null default 1,
  constraint uq_positions_legacy_key unique (contract_id, up3_id, legacy_key),
  constraint uq_positions_order unique (contract_id, up3_id, sort_order)
);

create or replace function public.validate_position_scope()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select type into v_type
    from public.organization_units
   where id = new.up3_id;
  if v_type is null or v_type <> 'UP3' then
    raise exception 'positions.up3_id must reference a UP3 unit';
  end if;
  return new;
end;
$$;

create trigger trg_positions_scope_validate
  before insert or update on public.positions
  for each row execute function public.validate_position_scope();

create trigger trg_positions_touch
  before update on public.positions
  for each row execute function public.touch_audit_columns();

create index idx_positions_scope
  on public.positions (contract_id, up3_id, status, sort_order);

-- ============================================================================
-- 8. PROFILES (P2 scaffold — identity baseline only)
-- Employee link arrives with P1B (employees table).
-- ============================================================================
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  status       text not null default 'active'
               check (status in ('active', 'inactive')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  revision     integer not null default 1
);

create trigger trg_profiles_touch
  before update on public.profiles
  for each row execute function public.touch_audit_columns();

-- ============================================================================
-- 9. USER MEMBERSHIPS (P2 scaffold — NOT yet an authorization source)
-- Role 'up3' -> unit_id NULL; role 'ulp' -> exact child ULP of up3_id.
-- One active membership per context; no overlapping effective ranges.
-- ============================================================================
create table public.user_memberships (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  contract_id    uuid not null references public.contracts(id) on delete cascade,
  up3_id         uuid not null references public.organization_units(id),
  unit_id        uuid references public.organization_units(id),
  role           text not null check (role in ('up3', 'ulp')),
  status         text not null default 'active'
                 check (status in ('active', 'inactive')),
  effective_from date not null,
  effective_to   date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  updated_by     uuid references auth.users(id),
  revision       integer not null default 1,
  constraint user_memberships_effective_range
    check (effective_to is null or effective_to > effective_from),
  constraint user_memberships_role_scope
    check ((role = 'ulp' and unit_id is not null) or (role = 'up3' and unit_id is null))
);

create unique index uq_user_memberships_active
  on public.user_memberships (
    user_id,
    contract_id,
    up3_id,
    coalesce(unit_id, '00000000-0000-0000-0000-000000000000')
  )
  where effective_to is null;

alter table public.user_memberships
  add constraint ex_user_memberships_no_overlap
  exclude using gist (
    user_id with =,
    contract_id with =,
    up3_id with =,
    coalesce(unit_id, '00000000-0000-0000-0000-000000000000') with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create or replace function public.validate_user_membership_scope()
returns trigger
language plpgsql
as $$
declare
  v_up3_type    text;
  v_unit_type   text;
  v_unit_parent uuid;
begin
  select type into v_up3_type
    from public.organization_units
   where id = new.up3_id;
  if v_up3_type is null or v_up3_type <> 'UP3' then
    raise exception 'user_memberships.up3_id must reference a UP3 unit';
  end if;

  if new.unit_id is not null then
    select type, parent_id into v_unit_type, v_unit_parent
      from public.organization_units
     where id = new.unit_id;
    if v_unit_type is null or v_unit_type <> 'ULP'
       or v_unit_parent is distinct from new.up3_id then
      raise exception 'user_memberships.unit_id must be a child ULP of user_memberships.up3_id';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_user_memberships_scope_validate
  before insert or update on public.user_memberships
  for each row execute function public.validate_user_membership_scope();

create trigger trg_user_memberships_touch
  before update on public.user_memberships
  for each row execute function public.touch_audit_columns();

create index idx_user_memberships_user
  on public.user_memberships (user_id, status, effective_from desc);

create index idx_user_memberships_contract
  on public.user_memberships (contract_id, up3_id, role);

-- ============================================================================
-- 10. SECURITY BASELINE — RLS ENABLED, NO POLICIES (deny-by-default)
-- Full Auth/RLS policies arrive in P2. No permissive anon policy.
-- Defense in depth: revoke direct grants from anon/authenticated.
-- ============================================================================
alter table public.contracts                 enable row level security;
alter table public.organization_units        enable row level security;
alter table public.organization_name_history enable row level security;
alter table public.contract_up3_scopes       enable row level security;
alter table public.locations                 enable row level security;
alter table public.location_name_history     enable row level security;
alter table public.positions                 enable row level security;
alter table public.profiles                  enable row level security;
alter table public.user_memberships          enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'contracts',
    'organization_units',
    'organization_name_history',
    'contract_up3_scopes',
    'locations',
    'location_name_history',
    'positions',
    'profiles',
    'user_memberships'
  ]
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ============================================================================
-- END OF P1A — no application data/seed in this migration.
-- ============================================================================