-- Lembur L2: authoritative replacement-overtime draft and submission RPCs.
-- Existing activity, entry, evidence, history, and private Storage foundations
-- are reused. No rate or multiplier is exposed by the L2 read surface.

-- Minute fractions must remain auditable independently of the legacy hours
-- column, which is retained for compatibility with existing overtime entries.
alter table public.overtime_entries
  alter column duration_hours_snapshot type numeric(10,4)
    using duration_hours_snapshot::numeric(10,4),
  alter column multiplier_hours_snapshot type numeric(10,4)
    using multiplier_hours_snapshot::numeric(10,4);

-- A draft type may only change when every live or in-flight evidence row is
-- valid for the new type. This extends, rather than replaces, the L1 guards.
create or replace function public.guard_overtime_replacement_type_evidence_l2()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.type, new.work_category) is distinct from (old.type, old.work_category)
     and exists (
       select 1
       from public.overtime_evidence evidence
       where evidence.activity_id = old.id
         and evidence.status in ('ACTIVE', 'PENDING', 'DELETE_PENDING')
         and not (
           (new.type = 'REPLACEMENT_LEAVE'
             and evidence.evidence_type = 'FORM_CUTI')
           or (new.type = 'REPLACEMENT_SICK'
             and evidence.evidence_type in ('FORM_SAKIT', 'SURAT_SAKIT'))
           or (new.type = 'REPLACEMENT_PERMISSION'
             and evidence.evidence_type in ('FORM_IZIN', 'SURAT_IZIN'))
           or (new.type = 'WORK' and new.work_category = 'ADMINISTRASI'
             and evidence.evidence_type in ('FOTO_SEBELUM', 'FOTO_SESUDAH'))
           or (new.type = 'WORK' and new.work_category in ('GARDU', 'JTM', 'JTR')
             and evidence.evidence_type in (
               'SPK', 'FOTO_BRIEFING', 'FOTO_PROSES', 'FOTO_SELESAI'
             ))
         )
     ) then
    raise exception 'Overtime type change would invalidate existing evidence';
  end if;
  return new;
end;
$$;

create trigger trg_overtime_replacement_type_evidence_l2
  before update of type, work_category on public.overtime_activities
  for each row execute function public.guard_overtime_replacement_type_evidence_l2();

-- L2 mutations deliberately exclude ADMIN_UP3. The existing L1 helper remains
-- authoritative for contract, UP3, active unit, and membership validation.
create or replace function public.auth_can_mutate_overtime_replacement_l2(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.auth_can_manage_overtime_scope(
      p_contract_id, p_up3_id, p_unit_id
    )
    and exists (
      select 1
      from public.organization_units unit_scope
      where unit_scope.id = p_unit_id
        and unit_scope.type = 'ULP'
        and unit_scope.parent_id = p_up3_id
        and unit_scope.own_status = 'Aktif'
    )
    and (
      public.auth_is_super_admin()
      or exists (
        select 1
        from public.contract_memberships membership
        where membership.user_id = auth.uid()
          and membership.contract_role = 'ADMIN_ULP'
          and membership.status = 'ACTIVE'
          and membership.effective_from <= current_date
          and (membership.effective_to is null
            or current_date < membership.effective_to)
          and membership.contract_id = p_contract_id
          and membership.operational_up3_id = p_up3_id
          and membership.operational_unit_id = p_unit_id
      )
    )
$$;

-- Eligibility is evaluated on the Pontianak business date. A pension policy is
-- required so that "non-retired" is an affirmative, deterministic decision.
create or replace function public.overtime_employee_is_eligible_l2(
  p_employee_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_business_date date
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employees employee
    join public.employee_unit_history assignment
      on assignment.employee_id = employee.id
     and assignment.contract_id = p_contract_id
     and assignment.up3_id = p_up3_id
     and assignment.unit_id = p_unit_id
     and assignment.effective_from <= p_business_date
     and (assignment.effective_to is null
       or p_business_date < assignment.effective_to)
    join public.employee_status_history employee_status
      on employee_status.employee_id = employee.id
     and employee_status.status = 'Aktif'
     and employee_status.effective_from <= p_business_date
     and (employee_status.effective_to is null
       or p_business_date < employee_status.effective_to)
    join public.pension_policies policy
      on policy.contract_id = p_contract_id
     and policy.up3_id = p_up3_id
     and policy.status = 'active'
     and policy.effective_from <= p_business_date
     and (policy.effective_to is null or p_business_date < policy.effective_to)
    where employee.id = p_employee_id
      and (
        coalesce(
          employee.retirement_date_override,
          case
            when employee.birth_date is null then null
            else (
              date_trunc(
                'month',
                employee.birth_date
                  + make_interval(years => policy.retirement_age)
              ) + interval '1 month'
            )::date
          end
        ) is null
        or p_business_date < coalesce(
          employee.retirement_date_override,
          (
            date_trunc(
              'month',
              employee.birth_date + make_interval(years => policy.retirement_age)
            ) + interval '1 month'
          )::date
        )
      )
  )
$$;

comment on function public.auth_can_mutate_overtime_replacement_l2(uuid, uuid, uuid)
  is 'Internal L2 mutation gate: SUPER_ADMIN or exact-unit ADMIN_ULP only.';
comment on function public.overtime_employee_is_eligible_l2(uuid, uuid, uuid, uuid, date)
  is 'Internal effective assignment, active status, and retirement eligibility check.';

create or replace function public.list_overtime_replacement_employees_l2(
  p_contract_id uuid,
  p_up3_id uuid,
  p_started_at timestamptz
)
returns table (
  employee_id uuid,
  name text,
  unit_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_date date;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_started_at is null then
    raise exception 'Overtime start is required';
  end if;
  v_business_date := (p_started_at at time zone 'Asia/Pontianak')::date;

  if not exists (
    select 1
    from public.contracts contract
    join public.contract_up3_scopes scope
      on scope.contract_id = contract.id
     and scope.up3_id = p_up3_id
     and scope.status = 'Aktif'
    join public.organization_units up3
      on up3.id = p_up3_id
     and up3.type = 'UP3'
     and up3.own_status = 'Aktif'
    where contract.id = p_contract_id
      and contract.status = 'active'
  ) then
    raise exception 'Requested overtime scope is not valid' using errcode = '22023';
  end if;

  if not public.auth_is_super_admin()
     and not exists (
       select 1
       from public.contract_memberships membership
       where membership.user_id = auth.uid()
         and membership.status = 'ACTIVE'
         and membership.effective_from <= current_date
         and (membership.effective_to is null
           or current_date < membership.effective_to)
         and membership.contract_id = p_contract_id
         and membership.operational_up3_id = p_up3_id
         and membership.contract_role in ('ADMIN_UP3', 'ADMIN_ULP')
     ) then
    raise exception 'Requested overtime scope is not authorized'
      using errcode = '42501';
  end if;

  return query
  select employee.id, employee.name, assignment.unit_id
  from public.employees employee
  join public.employee_unit_history assignment
    on assignment.employee_id = employee.id
   and assignment.contract_id = p_contract_id
   and assignment.up3_id = p_up3_id
   and assignment.effective_from <= v_business_date
   and (assignment.effective_to is null
     or v_business_date < assignment.effective_to)
  join public.organization_units unit_scope
    on unit_scope.id = assignment.unit_id
   and unit_scope.type = 'ULP'
   and unit_scope.parent_id = p_up3_id
   and unit_scope.own_status = 'Aktif'
  where public.overtime_employee_is_eligible_l2(
      employee.id, p_contract_id, p_up3_id, assignment.unit_id, v_business_date
    )
    and (
      public.auth_is_super_admin()
      or exists (
        select 1
        from public.contract_memberships membership
        where membership.user_id = auth.uid()
          and membership.status = 'ACTIVE'
          and membership.effective_from <= current_date
          and (membership.effective_to is null
            or current_date < membership.effective_to)
          and membership.contract_id = p_contract_id
          and membership.operational_up3_id = p_up3_id
          and (
            (membership.contract_role = 'ADMIN_UP3'
              and membership.operational_unit_id is null)
            or (membership.contract_role = 'ADMIN_ULP'
              and membership.operational_unit_id = assignment.unit_id)
          )
      )
    )
  order by employee.name, employee.id;
end;
$$;

comment on function public.list_overtime_replacement_employees_l2(uuid, uuid, timestamptz)
  is 'Lists eligible replacement employees in actual JWT membership scope; never returns rates.';

create or replace function public.save_overtime_replacement_draft_l2(
  p_activity_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_type text,
  p_replaced_employee_id uuid,
  p_participant_employee_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_entry public.overtime_entries%rowtype;
  v_activity_id uuid;
  v_business_date date;
  v_period_month date;
  v_actual_minutes numeric;
  v_duration_hours numeric;
  v_multiplier_hours numeric;
  v_rate numeric(18,2);
  v_participant_name text;
  v_replaced_name text;
  v_description text;
  v_month_names text[] := array[
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_type is null or p_type not in (
    'REPLACEMENT_LEAVE', 'REPLACEMENT_SICK', 'REPLACEMENT_PERMISSION'
  ) then
    raise exception 'L2 replacement type must be leave, sick, or permission';
  end if;
  if p_replaced_employee_id is null or p_participant_employee_id is null
     or p_replaced_employee_id = p_participant_employee_id then
    raise exception 'Replaced and participant employees must be distinct';
  end if;
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then
    raise exception 'Overtime end must be after start';
  end if;
  if p_ended_at - p_started_at < interval '1 minute' then
    raise exception 'Overtime duration must be at least one minute';
  end if;

  -- Existing activity is always the first locked business row.
  if p_activity_id is not null then
    select * into v_activity
    from public.overtime_activities activity
    where activity.id = p_activity_id
      and public.auth_can_mutate_overtime_replacement_l2(
        activity.contract_id, activity.up3_id, activity.unit_id
      )
    for update;
    if not found then
      raise exception 'Overtime activity is not available to this account'
        using errcode = '42501';
    end if;
    if v_activity.status <> 'DRAFT' then
      raise exception 'Only DRAFT replacement overtime can be changed';
    end if;
    if v_activity.type not in (
      'REPLACEMENT_LEAVE', 'REPLACEMENT_SICK', 'REPLACEMENT_PERMISSION'
    ) then
      raise exception 'The requested activity is not an L2 replacement';
    end if;
    if (v_activity.contract_id, v_activity.up3_id, v_activity.unit_id)
       is distinct from (p_contract_id, p_up3_id, p_unit_id) then
      raise exception 'Overtime activity is not in the exact requested scope';
    end if;

  end if;

  if not public.auth_can_mutate_overtime_replacement_l2(
    p_contract_id, p_up3_id, p_unit_id
  ) then
    raise exception 'Replacement overtime scope is not mutable by this account'
      using errcode = '42501';
  end if;

  if p_activity_id is not null then
    select entry.* into v_entry
    from public.overtime_entries entry
    where entry.activity_id = p_activity_id
    order by entry.id
    limit 1
    for update;
    if (select count(*) from public.overtime_entries entry
        where entry.activity_id = p_activity_id) > 1 then
      raise exception 'Replacement overtime must have exactly one participant';
    end if;
  end if;

  v_business_date := (p_started_at at time zone 'Asia/Pontianak')::date;
  v_period_month := date_trunc(
    'month', p_started_at at time zone 'Asia/Pontianak'
  )::date;

  if not public.overtime_employee_is_eligible_l2(
    p_replaced_employee_id, p_contract_id, p_up3_id, p_unit_id, v_business_date
  ) then
    raise exception 'Replaced employee is not eligible in the exact scope/date';
  end if;
  if not public.overtime_employee_is_eligible_l2(
    p_participant_employee_id, p_contract_id, p_up3_id, p_unit_id,
    v_business_date
  ) then
    raise exception 'Participant employee is not eligible in the exact scope/date';
  end if;

  select upper(employee.name) into v_participant_name
  from public.employees employee where employee.id = p_participant_employee_id;
  select upper(employee.name) into v_replaced_name
  from public.employees employee where employee.id = p_replaced_employee_id;
  select rate.hourly_rate into v_rate
  from public.employee_hourly_rate_history rate
  where rate.employee_id = p_participant_employee_id
    and rate.effective_from <= v_business_date
    and (rate.effective_to is null or v_business_date < rate.effective_to)
  order by rate.effective_from desc
  limit 1;
  if v_rate is null then
    raise exception 'Participant hourly rate not found for overtime start date';
  end if;

  v_actual_minutes := extract(epoch from (p_ended_at - p_started_at)) / 60;
  v_duration_hours := v_actual_minutes / 60;
  v_multiplier_hours := case
    when v_actual_minutes <= 60 then v_actual_minutes * 1.5 / 60
    else 1.5 + ((v_actual_minutes - 60) * 2 / 60)
  end;
  v_duration_hours := round(v_duration_hours, 4);
  v_multiplier_hours := round(v_multiplier_hours, 4);
  v_description := v_participant_name || ' menggantikan ' || v_replaced_name
    || ' yang ' || case p_type
      when 'REPLACEMENT_LEAVE' then 'cuti'
      when 'REPLACEMENT_SICK' then 'sakit'
      else 'izin'
    end
    || ' pada ' || extract(day from p_started_at at time zone 'Asia/Pontianak')::integer
    || ' ' || v_month_names[extract(month from p_started_at at time zone 'Asia/Pontianak')::integer]
    || ' ' || extract(year from p_started_at at time zone 'Asia/Pontianak')::integer
    || ' pukul ' || to_char(p_started_at at time zone 'Asia/Pontianak', 'HH24:MI')
    || '–' || to_char(p_ended_at at time zone 'Asia/Pontianak', 'HH24:MI') || '.';

  if v_entry.id is not null then
    -- Removing the locked draft entry lets the unchanged L1 activity guard
    -- validate an arbitrary new date/time before one recalculated entry is added.
    delete from public.overtime_entries where id = v_entry.id;
  end if;

  if p_activity_id is null then
    insert into public.overtime_activities (
      contract_id, up3_id, unit_id, type, work_category,
      replaced_employee_id, description, started_at, ended_at,
      status, created_by, updated_by
    ) values (
      p_contract_id, p_up3_id, p_unit_id, p_type, null,
      p_replaced_employee_id, v_description, p_started_at, p_ended_at,
      'DRAFT', auth.uid(), auth.uid()
    ) returning id into v_activity_id;
  else
    update public.overtime_activities
    set type = p_type,
        work_category = null,
        replaced_employee_id = p_replaced_employee_id,
        description = v_description,
        started_at = p_started_at,
        ended_at = p_ended_at,
        updated_by = auth.uid()
    where id = p_activity_id
    returning id into v_activity_id;
  end if;

  insert into public.overtime_entries (
    activity_id, contract_id, up3_id, unit_id, employee_id,
    work_date, period_month, hours, description, employee_name_snapshot,
    hourly_rate_snapshot, calculated_amount_snapshot,
    participant_started_at, participant_ended_at,
    duration_hours_snapshot, multiplier_hours_snapshot,
    created_by, updated_by
  ) values (
    v_activity_id, p_contract_id, p_up3_id, p_unit_id,
    p_participant_employee_id, v_business_date, v_period_month,
    round(v_duration_hours, 2), v_description, v_participant_name,
    v_rate, round(v_rate * v_multiplier_hours, 2),
    p_started_at, p_ended_at,
    v_duration_hours, v_multiplier_hours,
    auth.uid(), auth.uid()
  );

  if p_activity_id is null then
    insert into public.overtime_activity_history (
      activity_id, event, actor_user_id, previous_status, new_status
    ) values (
      v_activity_id, 'CREATED', auth.uid(), null, 'DRAFT'
    );
  end if;
  return v_activity_id;
end;
$$;

comment on function public.save_overtime_replacement_draft_l2(uuid, uuid, uuid, uuid, text, uuid, uuid, timestamptz, timestamptz)
  is 'Creates or recalculates one DRAFT L2 replacement activity and its sole participant atomically.';

create or replace function public.submit_overtime_replacement_l2(
  p_activity_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_required_types text[];
  v_required_type text;
  v_submission_number integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_activity
  from public.overtime_activities activity
  where activity.id = p_activity_id
    and public.auth_can_mutate_overtime_replacement_l2(
      activity.contract_id, activity.up3_id, activity.unit_id
    )
  for update;
  if not found then
    raise exception 'Overtime activity is not available to this account'
      using errcode = '42501';
  end if;
  if v_activity.type not in (
    'REPLACEMENT_LEAVE', 'REPLACEMENT_SICK', 'REPLACEMENT_PERMISSION'
  ) then
    raise exception 'Only L2 replacement overtime can be submitted';
  end if;
  if v_activity.status <> 'DRAFT' then
    raise exception 'Only DRAFT replacement overtime can be submitted';
  end if;
  if not public.auth_can_mutate_overtime_replacement_l2(
    v_activity.contract_id, v_activity.up3_id, v_activity.unit_id
  ) then
    raise exception 'Replacement overtime scope is not mutable by this account'
      using errcode = '42501';
  end if;
  if clock_timestamp() > (
    v_activity.submission_deadline + time '23:59:59.999999'
  ) at time zone 'Asia/Pontianak' then
    raise exception 'Replacement overtime submission deadline has passed';
  end if;
  if (select count(*) from public.overtime_entries entry
      where entry.activity_id = p_activity_id) <> 1 then
    raise exception 'Replacement overtime must have exactly one participant';
  end if;
  if exists (
    select 1 from public.overtime_evidence evidence
    where evidence.activity_id = p_activity_id
      and evidence.status in ('PENDING', 'DELETE_PENDING')
  ) then
    raise exception 'Resolve pending evidence operations before submission';
  end if;

  v_required_types := case v_activity.type
    when 'REPLACEMENT_LEAVE' then array['FORM_CUTI']::text[]
    when 'REPLACEMENT_SICK' then array['FORM_SAKIT', 'SURAT_SAKIT']::text[]
    else array['FORM_IZIN', 'SURAT_IZIN']::text[]
  end;
  foreach v_required_type in array v_required_types loop
    if (select count(*) from public.overtime_evidence evidence
        where evidence.activity_id = p_activity_id
          and evidence.evidence_type = v_required_type
          and evidence.status = 'ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: %',
        v_required_type;
    end if;
  end loop;
  if exists (
    select 1 from public.overtime_evidence evidence
    where evidence.activity_id = p_activity_id
      and evidence.status = 'ACTIVE'
      and not (evidence.evidence_type = any(v_required_types))
  ) then
    raise exception 'ACTIVE evidence contains a type not required by this replacement';
  end if;

  v_submission_number := v_activity.submission_count + 1;
  update public.overtime_activities
  set status = 'SUBMITTED',
      submitted_at = now(),
      submitted_by = auth.uid(),
      submission_count = v_submission_number,
      current_submission_number = v_submission_number,
      updated_by = auth.uid()
  where id = p_activity_id;

  insert into public.overtime_activity_history (
    activity_id, event, actor_user_id, submission_number,
    previous_status, new_status
  ) values (
    p_activity_id, 'SUBMITTED', auth.uid(), v_submission_number,
    'DRAFT', 'SUBMITTED'
  );
  return p_activity_id;
end;
$$;

comment on function public.submit_overtime_replacement_l2(uuid)
  is 'Submits a complete DRAFT L2 replacement through D+7 23:59 Asia/Pontianak.';

create or replace function public.list_overtime_replacements_l2(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid default null,
  p_period_month date default null
)
returns table (
  activity_id uuid,
  entry_id uuid,
  contract_id uuid,
  up3_id uuid,
  unit_id uuid,
  period_month date,
  overtime_date date,
  type text,
  participant_employee_id uuid,
  participant_name text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_hours numeric(10,4),
  total_amount numeric(18,2),
  description text,
  status text,
  submission_deadline_at timestamptz,
  replaced_employee_id uuid,
  replaced_employee_name text,
  submitted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_period_month is not null
     and p_period_month <> date_trunc('month', p_period_month::timestamp)::date then
    raise exception 'Period month must be the first day of a month';
  end if;

  return query
  select
    activity.id,
    entry.id,
    activity.contract_id,
    activity.up3_id,
    activity.unit_id,
    activity.period_month,
    activity.overtime_date,
    activity.type,
    entry.employee_id,
    entry.employee_name_snapshot,
    entry.participant_started_at,
    entry.participant_ended_at,
    entry.duration_hours_snapshot,
    entry.calculated_amount_snapshot,
    activity.description,
    activity.status,
    (activity.submission_deadline + time '23:59:59.999999')
      at time zone 'Asia/Pontianak',
    activity.replaced_employee_id,
    replaced_employee.name,
    activity.submitted_at,
    activity.created_at,
    activity.updated_at
  from public.overtime_activities activity
  join public.overtime_entries entry on entry.activity_id = activity.id
  join public.employees replaced_employee
    on replaced_employee.id = activity.replaced_employee_id
  where activity.contract_id = p_contract_id
    and activity.up3_id = p_up3_id
    and activity.type in (
      'REPLACEMENT_LEAVE', 'REPLACEMENT_SICK', 'REPLACEMENT_PERMISSION'
    )
    and (p_unit_id is null or activity.unit_id = p_unit_id)
    and (p_period_month is null or activity.period_month = p_period_month)
    and public.auth_can_read_overtime_evidence_scope(
      activity.contract_id, activity.up3_id, activity.unit_id
    )
  order by activity.started_at desc, activity.id;
end;
$$;

comment on function public.list_overtime_replacements_l2(uuid, uuid, uuid, date)
  is 'Scope-safe L2 replacement list; exposes total but no hourly-rate or multiplier snapshot.';

-- L2 activity participants are mutable only through the activity RPC above.
-- Closing direct SELECT also prevents ADMIN_ULP clients from querying rate and
-- multiplier snapshots while retaining the role-approved total in the L2 list.
revoke select on public.overtime_entries from authenticated;

create or replace function public.save_overtime_entry_authenticated(
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
security definer
set search_path = public, pg_temp
as $$
declare
  v_result public.overtime_entries%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.auth_can_manage_overtime_scope(
    p_contract_id, p_up3_id, p_unit_id
  ) then
    raise exception 'Overtime scope is not authorized for this account'
      using errcode = '42501';
  end if;
  if p_entry_id is not null and exists (
    select 1 from public.overtime_entries
    where id = p_entry_id and activity_id is not null
  ) then
    raise exception 'Activity participant must be changed through its activity workflow';
  end if;
  select * into v_result
  from public.save_overtime_entry(
    p_entry_id, p_contract_id, p_up3_id, p_unit_id, p_employee_id,
    p_work_date, p_hours, p_description, p_legacy_key
  );
  return v_result;
end;
$$;

create or replace function public.delete_overtime_entry_authenticated(
  p_entry_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.auth_can_manage_overtime_scope(
    p_contract_id, p_up3_id, p_unit_id
  ) then
    raise exception 'Overtime scope is not authorized for this account'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from public.overtime_entries
    where id = p_entry_id and activity_id is not null
  ) then
    raise exception 'Activity participant must be changed through its activity workflow';
  end if;
  perform public.delete_overtime_entry(
    p_entry_id, p_contract_id, p_up3_id, p_unit_id
  );
end;
$$;

-- Trigger/helper functions are internal. Only the four L2 API RPCs are callable
-- by authenticated clients; PUBLIC and anon retain no execution privilege.
revoke all on function public.guard_overtime_replacement_type_evidence_l2()
  from public, anon, authenticated;
revoke all on function public.auth_can_mutate_overtime_replacement_l2(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.overtime_employee_is_eligible_l2(uuid, uuid, uuid, uuid, date)
  from public, anon, authenticated;

revoke all on function public.list_overtime_replacement_employees_l2(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.save_overtime_replacement_draft_l2(uuid, uuid, uuid, uuid, text, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.submit_overtime_replacement_l2(uuid)
  from public, anon, authenticated;
revoke all on function public.list_overtime_replacements_l2(uuid, uuid, uuid, date)
  from public, anon, authenticated;

grant execute on function public.list_overtime_replacement_employees_l2(uuid, uuid, timestamptz)
  to authenticated;
grant execute on function public.save_overtime_replacement_draft_l2(uuid, uuid, uuid, uuid, text, uuid, uuid, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.submit_overtime_replacement_l2(uuid)
  to authenticated;
grant execute on function public.list_overtime_replacements_l2(uuid, uuid, uuid, date)
  to authenticated;

-- The basic L1 entry RPC returns a full overtime_entries composite, including
-- rate snapshots. L2 replaces that client write surface and keeps it internal.
revoke execute on function public.save_overtime_entry_authenticated(
  uuid, uuid, uuid, uuid, uuid, date, numeric, text, text
) from authenticated;
revoke execute on function public.delete_overtime_entry_authenticated(
  uuid, uuid, uuid, uuid
) from authenticated;
