alter table public.overtime_activities
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id),
  add column delete_reason text;

alter table public.overtime_activities
  add constraint overtime_activities_soft_delete_audit_check
  check (
    (deleted_at is null and deleted_by is null and delete_reason is null)
    or (deleted_at is not null and deleted_by is not null and btrim(delete_reason) <> '')
  );

alter table public.overtime_activity_history
  drop constraint overtime_activity_history_event_check;

alter table public.overtime_activity_history
  add constraint overtime_activity_history_event_check
  check (event in ('CREATED', 'SUBMITTED', 'REJECTED', 'RESUBMITTED', 'APPROVED', 'CLOSED', 'DELETED'));

create or replace function public.soft_delete_overtime_activity(p_activity_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.auth_is_super_admin() then
    raise exception 'Only SUPER_ADMIN may delete overtime data' using errcode = '42501';
  end if;
  if p_activity_id is null then
    raise exception 'Overtime activity is required';
  end if;
  if v_reason = '' then
    raise exception 'Alasan hapus wajib diisi';
  end if;

  select * into v_activity
  from public.overtime_activities
  where id = p_activity_id
  for update;

  if not found or v_activity.deleted_at is not null then
    raise exception 'Overtime activity is not available';
  end if;

  update public.overtime_activities
  set deleted_at = clock_timestamp(),
      deleted_by = auth.uid(),
      delete_reason = v_reason,
      updated_by = auth.uid()
  where id = p_activity_id;

  insert into public.overtime_activity_history(
    activity_id, event, actor_user_id, previous_status, new_status, reason
  ) values (
    p_activity_id, 'DELETED', auth.uid(), v_activity.status, v_activity.status, v_reason
  );

  return p_activity_id;
end;
$$;

revoke all on function public.soft_delete_overtime_activity(uuid, text) from public, anon;
grant execute on function public.soft_delete_overtime_activity(uuid, text) to authenticated;

create or replace function public.list_overtime_replacements_l2(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid default null, p_period_month date default null)
returns table(activity_id uuid, entry_id uuid, contract_id uuid, up3_id uuid, unit_id uuid, period_month date, overtime_date date, type text, participant_employee_id uuid, participant_name text, started_at timestamptz, ended_at timestamptz, duration_hours numeric, total_amount numeric, description text, status text, submission_deadline_at timestamptz, replaced_employee_id uuid, replaced_employee_name text, submitted_at timestamptz, created_at timestamptz, updated_at timestamptz, rejection_count integer, revision_deadline_at timestamptz, closure_reason text)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_period_month is not null and p_period_month <> date_trunc('month', p_period_month::timestamp)::date then raise exception 'Period month must be the first day of a month'; end if;
  return query
  select activity.id, entry.id, activity.contract_id, activity.up3_id, activity.unit_id, activity.period_month, activity.overtime_date, activity.type, entry.employee_id, entry.employee_name_snapshot, entry.participant_started_at, entry.participant_ended_at, entry.duration_hours_snapshot, entry.calculated_amount_snapshot, activity.description, activity.status, (activity.submission_deadline + time '23:59:59.999999') at time zone 'Asia/Pontianak', activity.replaced_employee_id, replaced_employee.name, activity.submitted_at, activity.created_at, activity.updated_at, activity.rejection_count, activity.revision_deadline_at, activity.closure_reason
  from public.overtime_activities activity
  join public.overtime_entries entry on entry.activity_id = activity.id
  join public.employees replaced_employee on replaced_employee.id = activity.replaced_employee_id
  where activity.contract_id = p_contract_id and activity.up3_id = p_up3_id
    and activity.type in ('REPLACEMENT_LEAVE', 'REPLACEMENT_SICK', 'REPLACEMENT_PERMISSION')
    and activity.deleted_at is null
    and (p_unit_id is null or activity.unit_id = p_unit_id)
    and (p_period_month is null or activity.period_month = p_period_month)
    and public.auth_can_read_overtime_evidence_scope(activity.contract_id, activity.up3_id, activity.unit_id)
  order by activity.started_at desc, activity.id;
end;
$$;

create or replace function public.list_overtime_work_l3(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid default null, p_period_month date default null)
returns table(activity_id uuid, entry_id uuid, contract_id uuid, up3_id uuid, unit_id uuid, period_month date, overtime_date date, work_category text, work_title text, work_location text, description text, status text, participant_employee_id uuid, participant_name text, started_at timestamptz, ended_at timestamptz, duration_hours numeric, total_amount numeric, submission_deadline_at timestamptz, created_at timestamptz, updated_at timestamptz, rejection_count integer, revision_deadline_at timestamptz, closure_reason text)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_period_month is not null and p_period_month <> date_trunc('month', p_period_month::timestamp)::date then raise exception 'Period month must be the first day of a month'; end if;
  return query
  select a.id, e.id, a.contract_id, a.up3_id, a.unit_id, a.period_month, a.overtime_date, a.work_category, a.work_title, a.work_location, a.description, a.status, e.employee_id, e.employee_name_snapshot, e.participant_started_at, e.participant_ended_at, e.duration_hours_snapshot, e.calculated_amount_snapshot, (a.submission_deadline + time '23:59:59.999999') at time zone 'Asia/Pontianak', a.created_at, a.updated_at, a.rejection_count, a.revision_deadline_at, a.closure_reason
  from public.overtime_activities a
  join public.overtime_entries e on e.activity_id = a.id
  where a.contract_id=p_contract_id and a.up3_id=p_up3_id and a.type='WORK'
    and a.deleted_at is null
    and (p_unit_id is null or a.unit_id=p_unit_id)
    and (p_period_month is null or a.period_month=p_period_month)
    and public.auth_can_read_overtime_evidence_scope(a.contract_id,a.up3_id,a.unit_id)
  order by a.started_at desc, a.id, e.participant_started_at;
end;
$$;
