-- ============================================================================
-- P1B — EMPLOYEE + GLOBAL HISTORIES
-- Project: WEBULV2 (bssmimicruhmjcxkcmqz) | SKW Reporting
-- Source of truth: FINAL REVISED P1 PLAN (approved).
--
-- Scope (P1B ONLY):
--   employees (global person master)
--   employee_unit_history
--   employee_position_history
--   employee_status_history
--   employee_work_location_history
--   employee_hourly_rate_history
--   pension_policies
--   employee_change_requests
--
-- Security baseline (P1B):
--   RLS ENABLED on every P1B table, NO policies (deny-by-default).
--   Full Auth/RLS policies are P2.
--
-- Conventions:
--   UUID PK for all entities.
--   History: [effective_from, effective_to) — effective_to NULL = current.
--   One current row per employee per history type (partial unique).
--   No overlapping effective ranges per employee (exclusion constraint).
--   NIP is globally unique — one NIP = one employee.
--   Existing frontend IDs preserved via legacy_key where needed.
--   No seed / no dummy data in this migration.
-- ============================================================================

-- Extensions (P1A already enabled pgcrypto + btree_gist)
create extension if not exists pg_trgm;

-- ============================================================================
-- 1. EMPLOYEES — GLOBAL PERSON MASTER
-- One UUID = one person. NIP is the stable business key.
-- Current placement/status resolved from open history rows.
-- Calculated UI fields (umur, sisa masa kerja) NOT persisted.
-- Hourly rate NOT stored as a permanent current field on employee.
-- ============================================================================
create table public.employees (
  id                      uuid primary key default gen_random_uuid(),
  legacy_key              text unique,
  nip                     text not null unique,
  name                    text not null,
  birth_date              date,
  bank                    text,
  account_number          text,
  source_position         text,
  retirement_date_override date,
  pension_override_reason text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references auth.users(id),
  updated_by              uuid references auth.users(id),
  revision                integer not null default 1
);

create trigger trg_employees_touch
  before update on public.employees
  for each row execute function public.touch_audit_columns();

create index idx_employees_nip
  on public.employees (nip);

create index idx_employees_name
  on public.employees using gin (name gin_trgm_ops);

-- ============================================================================
-- 2. EMPLOYEE UNIT HISTORY
-- Tracks which contract + UP3 + unit an employee was assigned to.
-- Unit = UP3 itself or child ULP of up3_id.
-- ============================================================================
create table public.employee_unit_history (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  contract_id   uuid not null references public.contracts(id),
  up3_id        uuid not null references public.organization_units(id),
  unit_id       uuid not null references public.organization_units(id),
  effective_from date not null,
  effective_to  date,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  constraint emp_unit_history_effective_range
    check (effective_to is null or effective_to > effective_from)
);

create unique index uq_emp_unit_history_current
  on public.employee_unit_history (employee_id)
  where effective_to is null;

alter table public.employee_unit_history
  add constraint ex_emp_unit_history_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

-- Validate unit scope: UP3 itself or child ULP of up3_id
create or replace function public.validate_employee_unit_history()
returns trigger
language plpgsql
as $$
declare
  v_up3_type  text;
  v_unit_type text;
  v_unit_parent uuid;
begin
  select type into v_up3_type
    from public.organization_units
   where id = new.up3_id;
  if v_up3_type is null or v_up3_type <> 'UP3' then
    raise exception 'employee_unit_history.up3_id must reference a UP3 unit';
  end if;

  if new.unit_id <> new.up3_id then
    select type, parent_id into v_unit_type, v_unit_parent
      from public.organization_units
     where id = new.unit_id;
    if v_unit_type is null or v_unit_type <> 'ULP'
       or v_unit_parent is distinct from new.up3_id then
      raise exception 'employee_unit_history.unit_id must be the UP3 itself or a child ULP of up3_id';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_emp_unit_history_validate
  before insert or update on public.employee_unit_history
  for each row execute function public.validate_employee_unit_history();

create index idx_emp_unit_history_employee
  on public.employee_unit_history (employee_id, effective_from desc);

create index idx_emp_unit_history_scope
  on public.employee_unit_history (contract_id, up3_id, unit_id);

-- ============================================================================
-- 3. EMPLOYEE POSITION HISTORY
-- FK to positions (scoped contract + UP3).
-- ============================================================================
create table public.employee_position_history (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  position_id   uuid not null references public.positions(id),
  effective_from date not null,
  effective_to  date,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  constraint emp_position_history_effective_range
    check (effective_to is null or effective_to > effective_from)
);

create unique index uq_emp_position_history_current
  on public.employee_position_history (employee_id)
  where effective_to is null;

alter table public.employee_position_history
  add constraint ex_emp_position_history_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index idx_emp_position_history_employee
  on public.employee_position_history (employee_id, effective_from desc);

-- ============================================================================
-- 4. EMPLOYEE STATUS HISTORY
-- Supports existing status model: Aktif / Nonaktif.
-- Nonaktif requires a reason (Pensiun, Resign, PHK, Lainnya).
-- ============================================================================
create table public.employee_status_history (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  status        text not null check (status in ('Aktif', 'Nonaktif')),
  reason        text check (
                  (status = 'Aktif' and reason is null) or
                  (status = 'Nonaktif' and reason is not null)
                ),
  reason_note   text,
  effective_from date not null,
  effective_to  date,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  constraint emp_status_history_effective_range
    check (effective_to is null or effective_to > effective_from)
);

create unique index uq_emp_status_history_current
  on public.employee_status_history (employee_id)
  where effective_to is null;

alter table public.employee_status_history
  add constraint ex_emp_status_history_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index idx_emp_status_history_employee
  on public.employee_status_history (employee_id, effective_from desc);

-- ============================================================================
-- 5. EMPLOYEE WORK LOCATION HISTORY
-- FK to locations. Location scope validated at application/repository level.
-- ============================================================================
create table public.employee_work_location_history (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  location_id   uuid not null references public.locations(id),
  effective_from date not null,
  effective_to  date,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  constraint emp_wlocation_history_effective_range
    check (effective_to is null or effective_to > effective_from)
);

create unique index uq_emp_wlocation_history_current
  on public.employee_work_location_history (employee_id)
  where effective_to is null;

alter table public.employee_work_location_history
  add constraint ex_emp_wlocation_history_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index idx_emp_wlocation_history_employee
  on public.employee_work_location_history (employee_id, effective_from desc);

-- ============================================================================
-- 6. EMPLOYEE HOURLY RATE HISTORY
-- Numeric (not floating point). Rate lama tetap historis.
-- P1C Overtime resolve rate by work_date and snapshot.
-- ============================================================================
create table public.employee_hourly_rate_history (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  hourly_rate   numeric(12,2) not null check (hourly_rate >= 0),
  effective_from date not null,
  effective_to  date,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  constraint emp_rate_history_effective_range
    check (effective_to is null or effective_to > effective_from)
);

create unique index uq_emp_rate_history_current
  on public.employee_hourly_rate_history (employee_id)
  where effective_to is null;

alter table public.employee_hourly_rate_history
  add constraint ex_emp_rate_history_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index idx_emp_rate_history_employee
  on public.employee_hourly_rate_history (employee_id, effective_from desc);

-- ============================================================================
-- 7. PENSION POLICIES
-- Scoped contract + UP3. Effective-dated history.
-- One active current policy per contract+UP3.
-- retirement_age is persisted; derived retirement date NOT stored here.
-- ============================================================================
create table public.pension_policies (
  id              uuid primary key default gen_random_uuid(),
  legacy_key      text,
  contract_id     uuid not null references public.contracts(id) on delete cascade,
  up3_id          uuid not null references public.organization_units(id),
  retirement_age  integer not null check (retirement_age > 0 and retirement_age < 100),
  status          text not null default 'active'
                  check (status in ('active', 'inactive')),
  note            text,
  effective_from  date not null,
  effective_to    date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  revision        integer not null default 1,
  constraint pension_policy_effective_range
    check (effective_to is null or effective_to > effective_from)
);

-- One active current policy per contract + UP3
create unique index uq_pension_policy_current
  on public.pension_policies (contract_id, up3_id)
  where effective_to is null;

-- No overlapping policies per contract + UP3
alter table public.pension_policies
  add constraint ex_pension_policy_no_overlap
  exclude using gist (
    contract_id with =,
    up3_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

-- Validate up3_id is a UP3 unit
create or replace function public.validate_pension_policy_scope()
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
    raise exception 'pension_policies.up3_id must reference a UP3 unit';
  end if;
  return new;
end;
$$;

create trigger trg_pension_policy_validate
  before insert or update on public.pension_policies
  for each row execute function public.validate_pension_policy_scope();

create trigger trg_pension_policies_touch
  before update on public.pension_policies
  for each row execute function public.touch_audit_columns();

create index idx_pension_policies_scope
  on public.pension_policies (contract_id, up3_id, status, effective_from desc);

-- ============================================================================
-- 8. EMPLOYEE CHANGE REQUESTS
-- Supports existing workflow: Pending → Approved/Rejected.
-- Stores old/proposed snapshots as JSONB for UI compatibility.
-- Explicit FK fields for proposed changes where applicable.
-- ============================================================================
create table public.employee_change_requests (
  id              uuid primary key default gen_random_uuid(),
  legacy_key      text,
  employee_id     uuid references public.employees(id),
  contract_id     uuid not null references public.contracts(id),
  up3_id          uuid not null references public.organization_units(id),
  request_type    text not null check (request_type in ('add', 'edit')),
  source_unit_id  uuid references public.organization_units(id),
  target_unit_id  uuid references public.organization_units(id),
  old_snapshot    jsonb,
  proposed_snapshot jsonb,
  base_revision   integer not null default 0,
  status          text not null default 'Pending'
                  check (status in ('Pending', 'Approved', 'Rejected')),
  note            text,
  created_by_actor text,
  decided_by      text,
  decided_at      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  revision        integer not null default 1,
  constraint emp_change_request_edit_requires_employee
    check (request_type <> 'edit' or employee_id is not null),
  constraint emp_change_request_add_requires_no_employee
    check (request_type <> 'add' or employee_id is null),
  constraint emp_change_request_pending_no_decision
    check (status <> 'Pending' or (decided_by is null and decided_at is null)),
  constraint emp_change_request_decided_requires_decision
    check (status in ('Pending', 'Rejected') or (decided_by is not null and decided_at is not null))
);

-- Validate up3_id is a UP3 unit
create or replace function public.validate_emp_change_request_scope()
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
    raise exception 'employee_change_requests.up3_id must reference a UP3 unit';
  end if;
  return new;
end;
$$;

create trigger trg_emp_change_request_validate
  before insert or update on public.employee_change_requests
  for each row execute function public.validate_emp_change_request_scope();

create trigger trg_emp_change_requests_touch
  before update on public.employee_change_requests
  for each row execute function public.touch_audit_columns();

create index idx_emp_change_requests_employee
  on public.employee_change_requests (employee_id, status);

create index idx_emp_change_requests_scope
  on public.employee_change_requests (contract_id, up3_id, status, created_at desc);

-- ============================================================================
-- 9. SECURITY BASELINE — RLS ENABLED, NO POLICIES (deny-by-default)
-- Full Auth/RLS policies arrive in P2.
-- ============================================================================
alter table public.employees                     enable row level security;
alter table public.employee_unit_history         enable row level security;
alter table public.employee_position_history     enable row level security;
alter table public.employee_status_history       enable row level security;
alter table public.employee_work_location_history enable row level security;
alter table public.employee_hourly_rate_history  enable row level security;
alter table public.pension_policies              enable row level security;
alter table public.employee_change_requests      enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'employees',
    'employee_unit_history',
    'employee_position_history',
    'employee_status_history',
    'employee_work_location_history',
    'employee_hourly_rate_history',
    'pension_policies',
    'employee_change_requests'
  ]
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ============================================================================
-- END OF P1B — no seed / no application data in this migration.
-- RPC mutations deferred to the repository/mutation phase.
-- ============================================================================