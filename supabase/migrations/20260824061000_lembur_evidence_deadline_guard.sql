-- Keep every evidence lifecycle mutation inside the activity's active deadline.
-- Initial Draft uses D+7; an already submitted revision continues to use D+3.

create or replace function public.auth_can_manage_overtime_activity_evidence(
  p_activity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.overtime_activities activity
    where activity.id = p_activity_id
      and (
        (
          activity.status = 'DRAFT'
          and coalesce(activity.submission_count, 0) = 0
          and clock_timestamp() <= (
            activity.submission_deadline + time '23:59:59.999999'
          ) at time zone 'Asia/Pontianak'
        )
        or (
          activity.status = 'CORRECTION_REQUIRED'
          and activity.revision_deadline_at is not null
          and clock_timestamp() <= activity.revision_deadline_at
        )
      )
      and public.auth_can_manage_overtime_evidence_scope(
        activity.contract_id,
        activity.up3_id,
        activity.unit_id
      )
  )
$$;

revoke all on function public.auth_can_manage_overtime_activity_evidence(uuid)
  from public, anon, authenticated;
grant execute on function public.auth_can_manage_overtime_activity_evidence(uuid)
  to authenticated;

comment on function public.auth_can_manage_overtime_activity_evidence(uuid)
  is 'Allows private evidence mutation only inside initial D+7 or existing revision D+3 deadline.';
