-- P1C - SLA, Variable Cost, Overtime, and Signature persistence.
-- Scope only: no seed data, UI switch, or repository integration.

-- SLA versions are exact contract + UP3 revisions.
create table public.sla_versions (
  id uuid primary key default gen_random_uuid(),
  legacy_key text,
  contract_id uuid not null,
  up3_id uuid not null,
  name text not null,
  parent_contract_number text not null,
  addendum_number text,
  effective_date date not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  previous_active_version_id uuid,
  source text,
  source_version_id uuid,
  notes text,
  first_used_at timestamptz,
  first_used_by uuid references auth.users(id),
  first_used_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1,
  constraint sla_versions_period_valid check (period_end >= period_start),
  constraint sla_versions_scope_fk
    foreign key (contract_id, up3_id)
    references public.contract_up3_scopes(contract_id, up3_id),
  constraint sla_versions_legacy_key_unique
    unique (contract_id, up3_id, legacy_key),
  constraint sla_versions_id_scope_unique
    unique (id, contract_id, up3_id),
  constraint sla_versions_previous_scope_fk
    foreign key (previous_active_version_id, contract_id, up3_id)
    references public.sla_versions(id, contract_id, up3_id),
  constraint sla_versions_source_scope_fk
    foreign key (source_version_id, contract_id, up3_id)
    references public.sla_versions(id, contract_id, up3_id)
);

alter table public.sla_versions
  add constraint ex_sla_versions_active_period
  exclude using gist (
    contract_id with =,
    up3_id with =,
    daterange(period_start, period_end, '[]') with &&
  ) where (status = 'ACTIVE');

create unique index uq_sla_versions_one_active
  on public.sla_versions (contract_id, up3_id)
  where status = 'ACTIVE';

create index idx_sla_versions_scope_status
  on public.sla_versions (contract_id, up3_id, status, effective_date desc);

create trigger trg_sla_versions_touch
  before update on public.sla_versions
  for each row execute function public.touch_audit_columns();

-- Explicit version -> section -> scope -> indicator hierarchy.
create table public.sla_sections (
  id uuid primary key default gen_random_uuid(),
  sla_version_id uuid not null references public.sla_versions(id) on delete cascade,
  legacy_key text not null,
  code text not null,
  name text not null,
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint sla_sections_legacy_unique unique (sla_version_id, legacy_key),
  constraint sla_sections_code_unique unique (sla_version_id, code),
  constraint sla_sections_order_unique unique (sla_version_id, sort_order),
  constraint sla_sections_id_version_unique unique (id, sla_version_id)
);

create table public.sla_scopes (
  id uuid primary key default gen_random_uuid(),
  sla_version_id uuid not null,
  section_id uuid not null,
  legacy_key text not null,
  name text not null,
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint sla_scopes_section_fk
    foreign key (section_id, sla_version_id)
    references public.sla_sections(id, sla_version_id) on delete cascade,
  constraint sla_scopes_legacy_unique unique (sla_version_id, legacy_key),
  constraint sla_scopes_order_unique unique (section_id, sort_order),
  constraint sla_scopes_id_hierarchy_unique unique (id, section_id, sla_version_id),
  constraint sla_scopes_id_version_unique unique (id, sla_version_id)
);

create table public.sla_indicators (
  id uuid primary key default gen_random_uuid(),
  sla_version_id uuid not null,
  section_id uuid not null,
  scope_id uuid not null,
  legacy_key text not null,
  point_code text not null,
  criteria text not null,
  performance_target text not null,
  evidence text not null,
  weight_type text not null,
  weight numeric(12,4) not null check (weight >= 0),
  penalty_formula text,
  measurement_unit text,
  default_target_value numeric(18,4),
  input_mode text not null default 'MANUAL'
    check (input_mode in ('MANUAL', 'VARIABLE_COST')),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint sla_indicators_section_fk
    foreign key (section_id, sla_version_id)
    references public.sla_sections(id, sla_version_id) on delete cascade,
  constraint sla_indicators_scope_fk
    foreign key (scope_id, section_id, sla_version_id)
    references public.sla_scopes(id, section_id, sla_version_id) on delete cascade,
  constraint sla_indicators_legacy_unique unique (sla_version_id, legacy_key),
  constraint sla_indicators_order_unique unique (scope_id, sort_order),
  constraint sla_indicators_id_version_unique unique (id, sla_version_id)
);

create index idx_sla_sections_order
  on public.sla_sections (sla_version_id, sort_order);
create index idx_sla_scopes_order
  on public.sla_scopes (sla_version_id, section_id, sort_order);
create index idx_sla_indicators_order
  on public.sla_indicators (sla_version_id, section_id, scope_id, sort_order);

-- Targets are monthly and explicitly UP3 or unit-specific ULP.
create table public.sla_targets (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null,
  up3_id uuid not null,
  unit_id uuid references public.organization_units(id),
  sla_version_id uuid not null,
  indicator_id uuid not null,
  period_month date not null,
  target_scope text not null check (target_scope in ('UP3', 'ULP')),
  target_value numeric(18,4) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1,
  constraint sla_targets_month_start check (extract(day from period_month) = 1),
  constraint sla_targets_unit_scope check (
    (target_scope = 'UP3' and unit_id is null) or
    (target_scope = 'ULP' and unit_id is not null)
  ),
  constraint sla_targets_version_scope_fk
    foreign key (sla_version_id, contract_id, up3_id)
    references public.sla_versions(id, contract_id, up3_id),
  constraint sla_targets_indicator_version_fk
    foreign key (indicator_id, sla_version_id)
    references public.sla_indicators(id, sla_version_id)
);

create unique index uq_sla_targets_up3
  on public.sla_targets (
    contract_id, up3_id, sla_version_id, indicator_id, period_month
  ) where target_scope = 'UP3' and unit_id is null;

create unique index uq_sla_targets_ulp
  on public.sla_targets (
    contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month
  ) where target_scope = 'ULP' and unit_id is not null;

create trigger trg_sla_targets_touch
  before update on public.sla_targets
  for each row execute function public.touch_audit_columns();

-- Transactional SLA rows are ULP rows only. UP3 is a read projection.
create table public.sla_entries (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null,
  up3_id uuid not null,
  unit_id uuid not null references public.organization_units(id),
  sla_version_id uuid not null,
  indicator_id uuid not null,
  period_month date not null,
  source_type text not null default 'MANUAL'
    check (source_type in ('MANUAL', 'VARIABLE_COST_AGGREGATE')),
  measurement_unit text,
  target_value numeric(18,4),
  work_order numeric(18,4),
  realization numeric(18,4),
  achievement numeric(12,4),
  penalty_value numeric(12,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1,
  constraint sla_entries_month_start check (extract(day from period_month) = 1),
  constraint sla_entries_version_scope_fk
    foreign key (sla_version_id, contract_id, up3_id)
    references public.sla_versions(id, contract_id, up3_id),
  constraint sla_entries_indicator_version_fk
    foreign key (indicator_id, sla_version_id)
    references public.sla_indicators(id, sla_version_id),
  constraint sla_entries_business_key unique (
    contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month
  )
);

create index idx_sla_entries_scope_period
  on public.sla_entries (contract_id, up3_id, unit_id, period_month);

create trigger trg_sla_entries_touch
  before update on public.sla_entries
  for each row execute function public.touch_audit_columns();

-- Daily Variable Cost is the source; monthly SLA is synchronized atomically.
create table public.variable_cost_entries (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null,
  up3_id uuid not null,
  unit_id uuid not null references public.organization_units(id),
  sla_version_id uuid not null,
  indicator_id uuid not null,
  work_date date not null,
  measurement_unit text,
  work_order numeric(18,4),
  realization numeric(18,4),
  achievement numeric(12,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1,
  constraint variable_cost_version_scope_fk
    foreign key (sla_version_id, contract_id, up3_id)
    references public.sla_versions(id, contract_id, up3_id),
  constraint variable_cost_indicator_version_fk
    foreign key (indicator_id, sla_version_id)
    references public.sla_indicators(id, sla_version_id),
  constraint variable_cost_daily_business_key unique (
    contract_id, up3_id, unit_id, indicator_id, work_date
  )
);

create index idx_variable_cost_scope_date
  on public.variable_cost_entries (
    contract_id, up3_id, unit_id, sla_version_id, work_date
  );

create trigger trg_variable_cost_touch
  before update on public.variable_cost_entries
  for each row execute function public.touch_audit_columns();

-- Overtime is an employee/work-date/event record with immutable snapshots.
create table public.overtime_entries (
  id uuid primary key default gen_random_uuid(),
  legacy_key text,
  contract_id uuid not null,
  up3_id uuid not null,
  unit_id uuid not null references public.organization_units(id),
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  period_month date not null,
  hours numeric(8,2) not null check (hours > 0),
  description text,
  employee_name_snapshot text not null,
  hourly_rate_snapshot numeric(18,2) not null check (hourly_rate_snapshot >= 0),
  calculated_amount_snapshot numeric(18,2) not null
    check (calculated_amount_snapshot >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1,
  constraint overtime_period_matches_work_date check (
    period_month = date_trunc('month', work_date::timestamp)::date
  ),
  constraint overtime_scope_fk
    foreign key (contract_id, up3_id)
    references public.contract_up3_scopes(contract_id, up3_id),
  constraint overtime_legacy_key_unique unique (contract_id, up3_id, legacy_key)
);

create index idx_overtime_scope_date
  on public.overtime_entries (contract_id, up3_id, unit_id, work_date desc);
create index idx_overtime_employee_date
  on public.overtime_entries (employee_id, work_date desc);

create trigger trg_overtime_touch
  before update on public.overtime_entries
  for each row execute function public.touch_audit_columns();

-- Exact signature groups; no wildcard/global scope.
create table public.signature_groups (
  id uuid primary key default gen_random_uuid(),
  legacy_key text,
  contract_id uuid not null,
  up3_id uuid not null,
  document_scope text not null check (document_scope in ('SLA_UP3', 'SLA_ULP')),
  unit_id uuid references public.organization_units(id),
  title text not null,
  institution text not null,
  sort_order integer not null check (sort_order >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1,
  constraint signature_groups_period_valid
    check (effective_to is null or effective_to > effective_from),
  constraint signature_groups_unit_scope check (
    (document_scope = 'SLA_UP3' and unit_id is null) or
    (document_scope = 'SLA_ULP' and unit_id is not null)
  ),
  constraint signature_groups_scope_fk
    foreign key (contract_id, up3_id)
    references public.contract_up3_scopes(contract_id, up3_id),
  constraint signature_groups_legacy_unique
    unique (contract_id, up3_id, legacy_key)
);

create unique index uq_signature_groups_current
  on public.signature_groups (
    contract_id,
    up3_id,
    document_scope,
    coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    sort_order
  ) where effective_to is null;

alter table public.signature_groups
  add constraint ex_signature_groups_no_overlap
  exclude using gist (
    contract_id with =,
    up3_id with =,
    document_scope with =,
    coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    sort_order with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index idx_signature_groups_resolver
  on public.signature_groups (
    contract_id, up3_id, document_scope, unit_id, status, effective_from, effective_to
  );

create trigger trg_signature_groups_touch
  before update on public.signature_groups
  for each row execute function public.touch_audit_columns();

create table public.signatories (
  id uuid primary key default gen_random_uuid(),
  legacy_key text,
  signature_group_id uuid not null
    references public.signature_groups(id) on delete cascade,
  name text not null,
  position_title text not null,
  organization_label text,
  sort_order integer not null check (sort_order >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1,
  constraint signatories_period_valid
    check (effective_to is null or effective_to > effective_from),
  constraint signatories_legacy_unique unique (signature_group_id, legacy_key)
);

create unique index uq_signatories_current_slot
  on public.signatories (signature_group_id, sort_order)
  where effective_to is null;

alter table public.signatories
  add constraint ex_signatories_slot_no_overlap
  exclude using gist (
    signature_group_id with =,
    sort_order with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create index idx_signatories_resolver
  on public.signatories (
    signature_group_id, status, effective_from, effective_to, sort_order
  );

create trigger trg_signatories_touch
  before update on public.signatories
  for each row execute function public.touch_audit_columns();

-- Shared validation for unit-scoped SLA rows and targets.
create or replace function public.validate_p1c_scoped_unit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_contract_id uuid;
  v_up3_id uuid;
  v_unit_id uuid;
  v_version_id uuid;
  v_period_month date;
  v_work_date date;
  v_unit_type text;
  v_parent_id uuid;
  v_version_status text;
  v_period_start date;
  v_period_end date;
begin
  v_row := to_jsonb(new);
  v_contract_id := (v_row ->> 'contract_id')::uuid;
  v_up3_id := (v_row ->> 'up3_id')::uuid;
  v_unit_id := nullif(v_row ->> 'unit_id', '')::uuid;
  v_version_id := (v_row ->> 'sla_version_id')::uuid;
  v_period_month := nullif(v_row ->> 'period_month', '')::date;
  v_work_date := nullif(v_row ->> 'work_date', '')::date;

  if v_unit_id is not null then
    select type, parent_id into v_unit_type, v_parent_id
    from public.organization_units
    where id = v_unit_id;

    if v_unit_type <> 'ULP' or v_parent_id is distinct from v_up3_id then
      raise exception 'unit_id must be a child ULP of up3_id';
    end if;
  end if;

  select status, period_start, period_end
    into v_version_status, v_period_start, v_period_end
  from public.sla_versions
  where id = v_version_id
    and contract_id = v_contract_id
    and up3_id = v_up3_id;

  if v_version_status is null then
    raise exception 'SLA version does not match contract/up3 scope';
  end if;

  if tg_table_name in ('sla_entries', 'variable_cost_entries')
     and v_version_status <> 'ACTIVE' then
    raise exception 'Transactional SLA data requires an ACTIVE SLA version';
  end if;

  if v_period_month is not null
     and (v_period_month < date_trunc('month', v_period_start::timestamp)::date
          or v_period_month > date_trunc('month', v_period_end::timestamp)::date) then
    raise exception 'period_month is outside the SLA version period';
  end if;

  if v_work_date is not null
     and (v_work_date < v_period_start or v_work_date > v_period_end) then
    raise exception 'work_date is outside the SLA version period';
  end if;

  return new;
end;
$$;

create trigger trg_sla_targets_unit_validate
  before insert or update on public.sla_targets
  for each row execute function public.validate_p1c_scoped_unit();

create trigger trg_sla_entries_unit_validate
  before insert or update on public.sla_entries
  for each row execute function public.validate_p1c_scoped_unit();

create trigger trg_variable_cost_unit_validate
  before insert or update on public.variable_cost_entries
  for each row execute function public.validate_p1c_scoped_unit();

create or replace function public.validate_variable_cost_indicator()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_status text;
begin
  select input_mode into v_mode
  from public.sla_indicators
  where id = new.indicator_id and sla_version_id = new.sla_version_id;

  if v_mode <> 'VARIABLE_COST' then
    raise exception 'indicator is not a Variable Cost indicator';
  end if;

  select status into v_status
  from public.sla_versions
  where id = new.sla_version_id;

  if v_status <> 'ACTIVE' then
    raise exception 'Variable Cost entries require an ACTIVE SLA version';
  end if;

  return new;
end;
$$;

create trigger trg_variable_cost_indicator_validate
  before insert or update on public.variable_cost_entries
  for each row execute function public.validate_variable_cost_indicator();

create or replace function public.validate_sla_entry_source()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_mode text;
begin
  select input_mode into v_mode
  from public.sla_indicators
  where id = new.indicator_id and sla_version_id = new.sla_version_id;

  if new.source_type = 'MANUAL' and v_mode <> 'MANUAL' then
    raise exception 'MANUAL SLA entry requires a MANUAL indicator';
  end if;
  if new.source_type = 'VARIABLE_COST_AGGREGATE' and v_mode <> 'VARIABLE_COST' then
    raise exception 'Variable Cost aggregate requires a VARIABLE_COST indicator';
  end if;
  return new;
end;
$$;

create trigger trg_sla_entries_source_validate
  before insert or update on public.sla_entries
  for each row execute function public.validate_sla_entry_source();

-- UP3 document groups use NULL unit; ULP groups require an exact child ULP.
create or replace function public.validate_signature_group_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_type text;
  v_parent uuid;
begin
  if new.document_scope = 'SLA_ULP' then
    select type, parent_id into v_type, v_parent
    from public.organization_units where id = new.unit_id;
    if v_type <> 'ULP' or v_parent is distinct from new.up3_id then
      raise exception 'SLA_ULP signature unit must be a child ULP of up3_id';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_signature_groups_scope_validate
  before insert or update on public.signature_groups
  for each row execute function public.validate_signature_group_scope();

create or replace function public.validate_signature_group_children()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.effective_from is distinct from old.effective_from
     or new.effective_to is distinct from old.effective_to then
    if exists (
      select 1 from public.signatories s
      where s.signature_group_id = new.id
        and (
          s.effective_from < new.effective_from
          or (new.effective_to is not null
              and (s.effective_to is null or s.effective_to > new.effective_to))
        )
    ) then
      raise exception 'Signature group period cannot exclude existing signatories';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_signature_groups_children_validate
  before update on public.signature_groups
  for each row execute function public.validate_signature_group_children();

create or replace function public.validate_signatory_period()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_from date;
  v_to date;
begin
  select effective_from, effective_to into v_from, v_to
  from public.signature_groups where id = new.signature_group_id;

  if new.effective_from < v_from
     or (v_to is not null and (new.effective_to is null or new.effective_to > v_to)) then
    raise exception 'signatory effective period must be inside its group period';
  end if;
  return new;
end;
$$;

create trigger trg_signatories_period_validate
  before insert or update on public.signatories
  for each row execute function public.validate_signatory_period();

-- A version is referenced by persisted reporting data or an explicit export mark.
create or replace function public.sla_version_is_referenced(p_version_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.sla_versions v
    where v.id = p_version_id and v.first_used_at is not null
  ) or exists (
    select 1 from public.sla_entries e where e.sla_version_id = p_version_id
  ) or exists (
    select 1 from public.variable_cost_entries vc where vc.sla_version_id = p_version_id
  );
$$;

create or replace function public.guard_sla_structure_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_version_id uuid;
  v_new_version_id uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_old_version_id := old.sla_version_id;
  elsif tg_op = 'INSERT' then
    v_new_version_id := new.sla_version_id;
  else
    v_old_version_id := old.sla_version_id;
    v_new_version_id := new.sla_version_id;
  end if;

  if v_old_version_id is not null then
    select status into v_status from public.sla_versions where id = v_old_version_id;
    if v_status = 'ARCHIVED' then
      raise exception 'ARCHIVED SLA structure and targets are immutable';
    end if;
    if v_status = 'ACTIVE' and public.sla_version_is_referenced(v_old_version_id) then
      raise exception 'Referenced ACTIVE SLA structure and targets are immutable; create a Draft Revision/Addendum';
    end if;
  end if;

  if v_new_version_id is not null
     and v_new_version_id is distinct from v_old_version_id then
    select status into v_status from public.sla_versions where id = v_new_version_id;
    if v_status = 'ARCHIVED' then
      raise exception 'ARCHIVED SLA structure and targets are immutable';
    end if;
    if v_status = 'ACTIVE' and public.sla_version_is_referenced(v_new_version_id) then
      raise exception 'Referenced ACTIVE SLA structure and targets are immutable; create a Draft Revision/Addendum';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_sla_sections_mutability
  before insert or update or delete on public.sla_sections
  for each row execute function public.guard_sla_structure_mutation();
create trigger trg_sla_scopes_mutability
  before insert or update or delete on public.sla_scopes
  for each row execute function public.guard_sla_structure_mutation();
create trigger trg_sla_indicators_mutability
  before insert or update or delete on public.sla_indicators
  for each row execute function public.guard_sla_structure_mutation();
create trigger trg_sla_targets_mutability
  before insert or update or delete on public.sla_targets
  for each row execute function public.guard_sla_structure_mutation();

create or replace function public.mark_sla_version_used_from_entry()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.sla_versions
    where id = new.sla_version_id and status = 'ACTIVE'
  ) then
    raise exception 'Only an ACTIVE SLA version can be marked referenced';
  end if;
  update public.sla_versions
  set first_used_at = coalesce(first_used_at, now()),
      first_used_by = coalesce(first_used_by, auth.uid()),
      first_used_reason = coalesce(first_used_reason, tg_table_name)
  where id = new.sla_version_id;
  return new;
end;
$$;

create trigger trg_sla_entries_mark_used
  after insert on public.sla_entries
  for each row execute function public.mark_sla_version_used_from_entry();
create trigger trg_variable_cost_mark_used
  after insert on public.variable_cost_entries
  for each row execute function public.mark_sla_version_used_from_entry();

create or replace function public.mark_sla_version_referenced(
  p_version_id uuid,
  p_reason text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.sla_versions
    where id = p_version_id and status = 'ACTIVE'
  ) then
    raise exception 'Only an ACTIVE SLA version can be marked referenced';
  end if;
  update public.sla_versions
  set first_used_at = coalesce(first_used_at, now()),
      first_used_by = coalesce(first_used_by, auth.uid()),
      first_used_reason = coalesce(first_used_reason, nullif(trim(p_reason), ''))
  where id = p_version_id;
  if not found then
    raise exception 'SLA version not found';
  end if;
end;
$$;

-- Atomic lifecycle functions. No destructive historical delete.
create or replace function public.activate_sla_version(p_version_id uuid)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_target public.sla_versions%rowtype;
  v_previous_id uuid;
begin
  select * into v_target from public.sla_versions
  where id = p_version_id for update;
  if not found then raise exception 'SLA version not found'; end if;
  if v_target.status <> 'DRAFT' then raise exception 'Only DRAFT SLA can be activated'; end if;
  if not exists (select 1 from public.sla_indicators where sla_version_id = p_version_id) then
    raise exception 'SLA version must contain at least one indicator';
  end if;

  select id into v_previous_id
  from public.sla_versions
  where contract_id = v_target.contract_id
    and up3_id = v_target.up3_id
    and status = 'ACTIVE'
  order by effective_date desc
  limit 1 for update;

  update public.sla_versions
  set status = 'ARCHIVED'
  where contract_id = v_target.contract_id
    and up3_id = v_target.up3_id
    and status = 'ACTIVE';

  update public.sla_versions
  set status = 'ACTIVE', previous_active_version_id = v_previous_id
  where id = p_version_id;
  return p_version_id;
end;
$$;

create or replace function public.rollback_sla_activation(p_active_version_id uuid)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_target public.sla_versions%rowtype;
begin
  select * into v_target from public.sla_versions
  where id = p_active_version_id for update;
  if not found or v_target.status <> 'ACTIVE' then
    raise exception 'Active SLA version not found';
  end if;
  if public.sla_version_is_referenced(p_active_version_id) then
    raise exception 'Referenced ACTIVE SLA cannot be rolled back; create an Addendum';
  end if;

  update public.sla_versions set status = 'DRAFT' where id = p_active_version_id;
  if v_target.previous_active_version_id is not null then
    update public.sla_versions set status = 'ACTIVE'
    where id = v_target.previous_active_version_id
      and contract_id = v_target.contract_id
      and up3_id = v_target.up3_id
      and status = 'ARCHIVED';
    return v_target.previous_active_version_id;
  end if;
  return p_active_version_id;
end;
$$;

create or replace function public.reactivate_sla_version(p_archived_version_id uuid)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_target public.sla_versions%rowtype;
  v_current_id uuid;
begin
  select * into v_target from public.sla_versions
  where id = p_archived_version_id for update;
  if not found or v_target.status <> 'ARCHIVED' then
    raise exception 'Archived SLA version not found';
  end if;

  select id into v_current_id from public.sla_versions
  where contract_id = v_target.contract_id
    and up3_id = v_target.up3_id
    and status = 'ACTIVE'
  limit 1 for update;

  update public.sla_versions set status = 'ARCHIVED'
  where id = v_current_id;
  update public.sla_versions
  set status = 'ACTIVE', previous_active_version_id = v_current_id
  where id = p_archived_version_id;
  return p_archived_version_id;
end;
$$;

create or replace function public.create_sla_draft_revision(
  p_source_version_id uuid,
  p_legacy_key text,
  p_name text,
  p_parent_contract_number text,
  p_addendum_number text,
  p_effective_date date,
  p_period_start date,
  p_period_end date,
  p_notes text
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_source public.sla_versions%rowtype;
  v_new_version_id uuid;
  v_section record;
  v_scope record;
  v_indicator record;
  v_new_section_id uuid;
  v_new_scope_id uuid;
  v_new_indicator_id uuid;
begin
  select * into v_source from public.sla_versions
  where id = p_source_version_id;
  if not found then raise exception 'Source SLA version not found'; end if;

  insert into public.sla_versions (
    legacy_key, contract_id, up3_id, name, parent_contract_number,
    addendum_number, effective_date, period_start, period_end, status,
    previous_active_version_id, source, source_version_id, notes, created_by
  ) values (
    p_legacy_key, v_source.contract_id, v_source.up3_id, p_name,
    p_parent_contract_number, p_addendum_number, p_effective_date,
    p_period_start, p_period_end, 'DRAFT',
    case when v_source.status = 'ACTIVE' then v_source.id else v_source.previous_active_version_id end,
    'COPY', v_source.id, p_notes, auth.uid()
  ) returning id into v_new_version_id;

  for v_section in
    select * from public.sla_sections
    where sla_version_id = v_source.id order by sort_order
  loop
    insert into public.sla_sections (
      sla_version_id, legacy_key, code, name, sort_order, created_by
    ) values (
      v_new_version_id, v_section.legacy_key, v_section.code,
      v_section.name, v_section.sort_order, auth.uid()
    ) returning id into v_new_section_id;

    for v_scope in
      select * from public.sla_scopes
      where sla_version_id = v_source.id and section_id = v_section.id
      order by sort_order
    loop
      insert into public.sla_scopes (
        sla_version_id, section_id, legacy_key, name, sort_order, created_by
      ) values (
        v_new_version_id, v_new_section_id, v_scope.legacy_key,
        v_scope.name, v_scope.sort_order, auth.uid()
      ) returning id into v_new_scope_id;

      for v_indicator in
        select * from public.sla_indicators
        where sla_version_id = v_source.id and scope_id = v_scope.id
        order by sort_order
      loop
        insert into public.sla_indicators (
          sla_version_id, section_id, scope_id, legacy_key, point_code,
          criteria, performance_target, evidence, weight_type, weight,
          penalty_formula, measurement_unit, default_target_value,
          input_mode, sort_order, created_by
        ) values (
          v_new_version_id, v_new_section_id, v_new_scope_id,
          v_indicator.legacy_key, v_indicator.point_code, v_indicator.criteria,
          v_indicator.performance_target, v_indicator.evidence,
          v_indicator.weight_type, v_indicator.weight,
          v_indicator.penalty_formula, v_indicator.measurement_unit,
          v_indicator.default_target_value, v_indicator.input_mode,
          v_indicator.sort_order, auth.uid()
        ) returning id into v_new_indicator_id;

        insert into public.sla_targets (
          contract_id, up3_id, unit_id, sla_version_id, indicator_id,
          period_month, target_scope, target_value, created_by
        )
        select v_source.contract_id, v_source.up3_id, unit_id,
               v_new_version_id, v_new_indicator_id, period_month,
               target_scope, target_value, auth.uid()
        from public.sla_targets
        where sla_version_id = v_source.id and indicator_id = v_indicator.id
          and period_month between
              date_trunc('month', p_period_start::timestamp)::date and
              date_trunc('month', p_period_end::timestamp)::date;
      end loop;
    end loop;
  end loop;
  return v_new_version_id;
end;
$$;

-- Existing UP3 consolidation: sum WO and realization; achievement remains unset.
create view public.sla_up3_consolidation
with (security_invoker = true)
as
select
  contract_id,
  up3_id,
  sla_version_id,
  indicator_id,
  period_month,
  min(measurement_unit) as measurement_unit,
  sum(coalesce(work_order, 0)) as work_order,
  sum(coalesce(realization, 0)) as realization,
  null::numeric(12,4) as achievement,
  null::numeric(12,4) as penalty_value
from public.sla_entries
group by contract_id, up3_id, sla_version_id, indicator_id, period_month;

-- Synchronize known additive VC fields. Achievement/penalty are not invented.
create or replace function public.sync_variable_cost_month(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_sla_version_id uuid,
  p_indicator_id uuid,
  p_period_month date
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count bigint;
  v_unit text;
  v_target numeric(18,4);
  v_work_order numeric(18,4);
  v_realization numeric(18,4);
begin
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_contract_id, p_up3_id, p_unit_id,
              p_sla_version_id, p_indicator_id, p_period_month),
    0
  ));

  select count(*), min(measurement_unit),
         sum(coalesce(work_order, 0)), sum(coalesce(realization, 0))
    into v_count, v_unit, v_work_order, v_realization
  from public.variable_cost_entries
  where contract_id = p_contract_id
    and up3_id = p_up3_id
    and unit_id = p_unit_id
    and sla_version_id = p_sla_version_id
    and indicator_id = p_indicator_id
    and work_date >= p_period_month
    and work_date < (p_period_month + interval '1 month')::date;

  if v_count = 0 then
    delete from public.sla_entries
    where contract_id = p_contract_id and up3_id = p_up3_id
      and unit_id = p_unit_id and sla_version_id = p_sla_version_id
      and indicator_id = p_indicator_id and period_month = p_period_month
      and source_type = 'VARIABLE_COST_AGGREGATE';
    return;
  end if;

  select target_value into v_target
  from public.sla_targets
  where contract_id = p_contract_id and up3_id = p_up3_id
    and unit_id = p_unit_id and sla_version_id = p_sla_version_id
    and indicator_id = p_indicator_id and period_month = p_period_month
    and target_scope = 'ULP';

  insert into public.sla_entries (
    contract_id, up3_id, unit_id, sla_version_id, indicator_id,
    period_month, source_type, measurement_unit, target_value,
    work_order, realization, achievement, penalty_value
  ) values (
    p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id,
    p_period_month, 'VARIABLE_COST_AGGREGATE', v_unit, v_target,
    v_work_order, v_realization, null, null
  )
  on conflict (
    contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month
  ) do update set
    source_type = 'VARIABLE_COST_AGGREGATE',
    measurement_unit = excluded.measurement_unit,
    target_value = excluded.target_value,
    work_order = excluded.work_order,
    realization = excluded.realization,
    achievement = null,
    penalty_value = null;
end;
$$;

create or replace function public.sync_variable_cost_after_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.sync_variable_cost_month(
      old.contract_id, old.up3_id, old.unit_id, old.sla_version_id,
      old.indicator_id, date_trunc('month', old.work_date::timestamp)::date
    );
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sync_variable_cost_month(
      new.contract_id, new.up3_id, new.unit_id, new.sla_version_id,
      new.indicator_id, date_trunc('month', new.work_date::timestamp)::date
    );
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_variable_cost_monthly_sync
  after insert or update or delete on public.variable_cost_entries
  for each row execute function public.sync_variable_cost_after_change();

-- Create/update overtime atomically using P1B histories and existing formula.
create or replace function public.save_overtime_entry(
  p_entry_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_employee_id uuid,
  p_work_date date,
  p_hours numeric,
  p_description text,
  p_legacy_key text default null
)
returns public.overtime_entries
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_employee_name text;
  v_rate numeric(18,2);
  v_status text;
  v_birth_date date;
  v_retirement_override date;
  v_retirement_age integer;
  v_retirement_effective date;
  v_existing public.overtime_entries%rowtype;
  v_result public.overtime_entries%rowtype;
begin
  if p_hours is null or p_hours <= 0 then raise exception 'hours must be positive'; end if;

  if p_entry_id is not null then
    select * into v_existing
    from public.overtime_entries
    where id = p_entry_id and contract_id = p_contract_id
      and up3_id = p_up3_id and unit_id = p_unit_id
    for update;
    if not found then raise exception 'Overtime entry not found in exact scope'; end if;
  end if;

  if not exists (
    select 1 from public.employee_unit_history h
    where h.employee_id = p_employee_id
      and h.contract_id = p_contract_id and h.up3_id = p_up3_id
      and h.unit_id = p_unit_id
      and h.effective_from <= p_work_date
      and (h.effective_to is null or p_work_date < h.effective_to)
  ) then
    raise exception 'Employee assignment is not valid for contract/up3/unit/work_date';
  end if;

  select h.status into v_status
  from public.employee_status_history h
  where h.employee_id = p_employee_id
    and h.effective_from <= p_work_date
    and (h.effective_to is null or p_work_date < h.effective_to)
  order by h.effective_from desc limit 1;
  if v_status is distinct from 'Aktif' then
    raise exception 'Employee is not active on work_date';
  end if;

  select e.name, e.birth_date, e.retirement_date_override
    into v_employee_name, v_birth_date, v_retirement_override
  from public.employees e where e.id = p_employee_id;
  if v_employee_name is null then raise exception 'Employee not found'; end if;

  select p.retirement_age into v_retirement_age
  from public.pension_policies p
  where p.contract_id = p_contract_id and p.up3_id = p_up3_id
    and p.status = 'active' and p.effective_from <= p_work_date
    and (p.effective_to is null or p_work_date < p.effective_to)
  order by p.effective_from desc limit 1;
  if v_retirement_age is null then raise exception 'Active pension policy not found for work_date'; end if;

  if v_retirement_override is not null then
    v_retirement_effective := v_retirement_override;
  elsif v_birth_date is not null then
    v_retirement_effective := (
      date_trunc('month', v_birth_date + make_interval(years => v_retirement_age))
      + interval '1 month'
    )::date;
  end if;
  if v_retirement_effective is not null and p_work_date >= v_retirement_effective then
    raise exception 'Employee is retired on work_date';
  end if;

  select h.hourly_rate into v_rate
  from public.employee_hourly_rate_history h
  where h.employee_id = p_employee_id
    and h.effective_from <= p_work_date
    and (h.effective_to is null or p_work_date < h.effective_to)
  order by h.effective_from desc limit 1;
  if v_rate is null then raise exception 'Hourly rate not found for work_date'; end if;

  -- Preserve historical name/rate snapshots when employee and date did not change.
  if p_entry_id is not null
     and v_existing.employee_id = p_employee_id
     and v_existing.work_date = p_work_date then
    v_employee_name := v_existing.employee_name_snapshot;
    v_rate := v_existing.hourly_rate_snapshot;
  end if;

  if p_entry_id is null then
    insert into public.overtime_entries (
      legacy_key, contract_id, up3_id, unit_id, employee_id, work_date,
      period_month, hours, description, employee_name_snapshot,
      hourly_rate_snapshot, calculated_amount_snapshot, created_by
    ) values (
      p_legacy_key, p_contract_id, p_up3_id, p_unit_id, p_employee_id,
      p_work_date, date_trunc('month', p_work_date::timestamp)::date,
      p_hours, coalesce(p_description, ''), v_employee_name,
      v_rate, round(p_hours * v_rate), auth.uid()
  ) returning * into v_result;
  else
    update public.overtime_entries set
      employee_id = p_employee_id,
      work_date = p_work_date,
      period_month = date_trunc('month', p_work_date::timestamp)::date,
      hours = p_hours,
      description = coalesce(p_description, ''),
      employee_name_snapshot = v_employee_name,
      hourly_rate_snapshot = v_rate,
      calculated_amount_snapshot = round(p_hours * v_rate),
      legacy_key = coalesce(p_legacy_key, legacy_key),
      updated_by = auth.uid()
    where id = p_entry_id
    returning * into v_result;
  end if;
  return v_result;
end;
$$;

create or replace function public.delete_overtime_entry(
  p_entry_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  delete from public.overtime_entries
  where id = p_entry_id and contract_id = p_contract_id
    and up3_id = p_up3_id and unit_id = p_unit_id;
  if not found then raise exception 'Overtime entry not found in exact scope'; end if;
end;
$$;

-- Deny-by-default until P2 Auth/RLS policies.
alter table public.sla_versions enable row level security;
alter table public.sla_sections enable row level security;
alter table public.sla_scopes enable row level security;
alter table public.sla_indicators enable row level security;
alter table public.sla_targets enable row level security;
alter table public.sla_entries enable row level security;
alter table public.variable_cost_entries enable row level security;
alter table public.overtime_entries enable row level security;
alter table public.signature_groups enable row level security;
alter table public.signatories enable row level security;

revoke all on public.sla_versions, public.sla_sections, public.sla_scopes,
  public.sla_indicators, public.sla_targets, public.sla_entries,
  public.variable_cost_entries, public.overtime_entries,
  public.signature_groups, public.signatories
from anon, authenticated;

revoke all on public.sla_up3_consolidation from anon, authenticated;

revoke execute on function public.activate_sla_version(uuid) from public, anon, authenticated;
revoke execute on function public.rollback_sla_activation(uuid) from public, anon, authenticated;
revoke execute on function public.reactivate_sla_version(uuid) from public, anon, authenticated;
revoke execute on function public.create_sla_draft_revision(uuid, text, text, text, text, date, date, date, text) from public, anon, authenticated;
revoke execute on function public.mark_sla_version_referenced(uuid, text) from public, anon, authenticated;
revoke execute on function public.sla_version_is_referenced(uuid) from public, anon, authenticated;
revoke execute on function public.sync_variable_cost_month(uuid, uuid, uuid, uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.save_overtime_entry(uuid, uuid, uuid, uuid, uuid, date, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.delete_overtime_entry(uuid, uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.activate_sla_version(uuid) to service_role;
grant execute on function public.rollback_sla_activation(uuid) to service_role;
grant execute on function public.reactivate_sla_version(uuid) to service_role;
grant execute on function public.create_sla_draft_revision(uuid, text, text, text, text, date, date, date, text) to service_role;
grant execute on function public.mark_sla_version_referenced(uuid, text) to service_role;
grant execute on function public.sla_version_is_referenced(uuid) to service_role;
grant execute on function public.sync_variable_cost_month(uuid, uuid, uuid, uuid, uuid, date) to service_role;
grant execute on function public.save_overtime_entry(uuid, uuid, uuid, uuid, uuid, date, numeric, text, text) to service_role;
grant execute on function public.delete_overtime_entry(uuid, uuid, uuid, uuid) to service_role;

-- No seed data is inserted by P1C.
