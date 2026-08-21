-- P1C.1 - Additive overtime activity model.
-- Business timezone: Asia/Pontianak.
-- Scope only: no seed data, UI, Storage upload, or RPC workflow implementation.

-- =============================================================================
-- 1. OVERTIME ACTIVITIES
-- =============================================================================
create table public.overtime_activities (
  id uuid primary key default gen_random_uuid(),
  legacy_key text,
  contract_id uuid not null,
  up3_id uuid not null,
  unit_id uuid not null references public.organization_units(id),
  type text not null
    check (type in (
      'REPLACEMENT_LEAVE',
      'REPLACEMENT_SICK',
      'REPLACEMENT_PERMISSION',
      'WORK'
    )),
  work_category text
    check (work_category in ('ADMINISTRASI', 'GARDU', 'JTM', 'JTR')),
  replaced_employee_id uuid references public.employees(id),
  description text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,

  -- Workflow fields
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'SUBMITTED', 'CORRECTION_REQUIRED', 'APPROVED', 'CLOSED')),
  submission_count integer not null default 0 check (submission_count >= 0),
  rejection_count integer not null default 0 check (rejection_count >= 0),
  current_submission_number integer not null default 0 check (current_submission_number >= 0),

  -- Timestamps for workflow milestones
  submitted_at timestamptz,
  last_rejection_at timestamptz,
  last_resubmitted_at timestamptz,
  approved_at timestamptz,
  closed_at timestamptz,

  -- Actor references
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  submitted_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  closed_by uuid references auth.users(id),
  last_rejected_by uuid references auth.users(id),
  last_resubmitted_by uuid references auth.users(id),

  -- Audit timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,

  -- Constraints
  constraint oa_ended_at_gt_started_at check (ended_at > started_at),
  constraint oa_scope_fk
    foreign key (contract_id, up3_id)
    references public.contract_up3_scopes(contract_id, up3_id),
  constraint oa_legacy_key_unique
    unique (contract_id, up3_id, legacy_key),

  -- WORK must have work_category, must NOT have replaced_employee_id
  constraint oa_work_category_required
    check ((
      type = 'WORK' and work_category is not null
    ) or (
      type != 'WORK'
    )),
  constraint oa_work_no_replaced_employee
    check ((
      type = 'WORK' and replaced_employee_id is null
    ) or (
      type != 'WORK'
    )),

  -- Replacement types must have replaced_employee_id
  constraint oa_replacement_requires_replaced_employee
    check ((
      type in ('REPLACEMENT_LEAVE', 'REPLACEMENT_SICK', 'REPLACEMENT_PERMISSION')
      and replaced_employee_id is not null
    ) or (
      type = 'WORK'
    )),

  -- Submission count <= 3
  constraint oa_max_three_submissions check (submission_count <= 3),
  -- Rejection count <= 2
  constraint oa_max_two_rejections check (rejection_count <= 2)
);

create index idx_oa_scope_type_status
  on public.overtime_activities (contract_id, up3_id, unit_id, type, status);
create index idx_oa_scope_date
  on public.overtime_activities (contract_id, up3_id, unit_id, started_at desc);
create index idx_oa_employee
  on public.overtime_activities (replaced_employee_id)
  where replaced_employee_id is not null;
create index idx_oa_status_submissions
  on public.overtime_activities (status, submission_count, rejection_count);

create trigger trg_overtime_activities_touch
  before update on public.overtime_activities
  for each row execute function public.touch_audit_columns();

-- =============================================================================
-- 2. ADDITIVE COLUMNS ON EXISTING OVERTIME_ENTRIES
-- =============================================================================
alter table public.overtime_entries
  add column activity_id uuid references public.overtime_activities(id),
  add column participant_started_at timestamptz,
  add column participant_ended_at timestamptz,
  add column duration_hours_snapshot numeric(8,2) check (duration_hours_snapshot >= 0),
  add column multiplier_hours_snapshot numeric(8,2) check (multiplier_hours_snapshot >= 0);

-- Participant times must be consistent when provided
alter table public.overtime_entries
  add constraint oe_participant_times_consistent
  check (
    participant_started_at is null or
    participant_ended_at is null or
    participant_ended_at > participant_started_at
  );

-- Activity-linked entries must have participant times
alter table public.overtime_entries
  add constraint oe_activity_participant_times_required
  check (
    activity_id is null or (
      participant_started_at is not null and
      participant_ended_at is not null and
      duration_hours_snapshot is not null and
      multiplier_hours_snapshot is not null
    )
  );

create index idx_oe_activity
  on public.overtime_entries (activity_id)
  where activity_id is not null;

-- =============================================================================
-- 3. OVERTIME EVIDENCE (activity-level, metadata only)
-- =============================================================================
create table public.overtime_evidence (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.overtime_activities(id) on delete cascade,
  evidence_type text not null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size_bytes bigint,
  checksum text,
  uploader_user_id uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),

  -- Revision tracking
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'SUPERSEDED')),
  supersedes_evidence_id uuid references public.overtime_evidence(id),
  revision_note text,
  revision_number integer not null default 1 check (revision_number >= 1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,

  constraint ev_unique_storage_path unique (storage_path),
  constraint ev_superseded_has_reference
    check (
      (status = 'ACTIVE' and supersedes_evidence_id is null) or
      (status = 'SUPERSEDED')
    )
);

create index idx_ev_activity_type_status
  on public.overtime_evidence (activity_id, evidence_type, status);

create trigger trg_overtime_evidence_touch
  before update on public.overtime_evidence
  for each row execute function public.touch_audit_columns();

-- =============================================================================
-- 4. OVERTIME ACTIVITY HISTORY (append-only audit trail)
-- =============================================================================
create table public.overtime_activity_history (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.overtime_activities(id) on delete cascade,
  event text not null
    check (event in ('CREATED', 'SUBMITTED', 'REJECTED', 'RESUBMITTED', 'APPROVED', 'CLOSED')),
  actor_user_id uuid references auth.users(id),
  occurred_at timestamptz not null default now(),

  -- Context fields
  submission_number integer,
  rejection_number integer,
  previous_status text,
  new_status text,
  reason text,
  notes text,

  created_at timestamptz not null default now()
);

create index idx_oah_activity_event
  on public.overtime_activity_history (activity_id, occurred_at);

-- =============================================================================
-- 5. RLS — Deny-by-default until P2 Auth/RLS policies
-- =============================================================================
alter table public.overtime_activities enable row level security;
alter table public.overtime_evidence enable row level security;
alter table public.overtime_activity_history enable row level security;

revoke all on public.overtime_activities, public.overtime_evidence,
  public.overtime_activity_history
from anon, authenticated;

-- =============================================================================
-- 6. No seed data inserted by P1C.1.
-- =============================================================================
