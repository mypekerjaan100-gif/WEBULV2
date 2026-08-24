-- L5 Rekap: extend list functions to expose revision deadlines and counts for UI, without changing financial hiding.
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
  updated_at timestamptz,
  rejection_count int,
  revision_deadline_at timestamptz,
  closure_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_period_month is not null and p_period_month <> date_trunc('month', p_period_month::timestamp)::date then raise exception 'Period month must be the first day of a month'; end if;
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
    (activity.submission_deadline + time '23:59:59.999999') at time zone 'Asia/Pontianak',
    activity.replaced_employee_id,
    replaced_employee.name,
    activity.submitted_at,
    activity.created_at,
    activity.updated_at,
    activity.rejection_count,
    activity.revision_deadline_at,
    activity.closure_reason
  from public.overtime_activities activity
  join public.overtime_entries entry on entry.activity_id = activity.id
  join public.employees replaced_employee on replaced_employee.id = activity.replaced_employee_id
  where activity.contract_id = p_contract_id
    and activity.up3_id = p_up3_id
    and activity.type in ('REPLACEMENT_LEAVE', 'REPLACEMENT_SICK', 'REPLACEMENT_PERMISSION')
    and (p_unit_id is null or activity.unit_id = p_unit_id)
    and (p_period_month is null or activity.period_month = p_period_month)
    and public.auth_can_read_overtime_evidence_scope(activity.contract_id, activity.up3_id, activity.unit_id)
  order by activity.started_at desc, activity.id;
end;
$$;

create or replace function public.list_overtime_work_l3(
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
  work_category text,
  work_title text,
  work_location text,
  description text,
  status text,
  participant_employee_id uuid,
  participant_name text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_hours numeric(10,4),
  total_amount numeric(18,2),
  submission_deadline_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  rejection_count int,
  revision_deadline_at timestamptz,
  closure_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_period_month is not null and p_period_month <> date_trunc('month', p_period_month::timestamp)::date then raise exception 'Period month must be the first day of a month'; end if;
  return query
  select a.id, e.id, a.contract_id, a.up3_id, a.unit_id, a.period_month, a.overtime_date, a.work_category, a.work_title, a.work_location, a.description, a.status, e.employee_id, e.employee_name_snapshot, e.participant_started_at, e.participant_ended_at, e.duration_hours_snapshot, e.calculated_amount_snapshot, (a.submission_deadline + time '23:59:59.999999') at time zone 'Asia/Pontianak', a.created_at, a.updated_at, a.rejection_count, a.revision_deadline_at, a.closure_reason
  from public.overtime_activities a
  join public.overtime_entries e on e.activity_id = a.id
  where a.contract_id=p_contract_id and a.up3_id=p_up3_id and a.type='WORK' and (p_unit_id is null or a.unit_id=p_unit_id) and (p_period_month is null or a.period_month=p_period_month)
    and public.auth_can_read_overtime_evidence_scope(a.contract_id,a.up3_id,a.unit_id)
  order by a.started_at desc, a.id, e.participant_started_at;
end;
$$;

revoke all on function public.list_overtime_replacements_l2(uuid, uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.list_overtime_work_l3(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.list_overtime_replacements_l2(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.list_overtime_work_l3(uuid, uuid, uuid, date) to authenticated;
