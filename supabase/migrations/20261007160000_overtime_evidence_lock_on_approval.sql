-- Lock shared activity evidence once any participant is APPROVED.
-- Evidence is stored per activity/form, so replacing it during a partial
-- revision would also change the evidence shown for already-approved
-- participants. Block prepare/finalize/delete via the central manage check.

create or replace function public.auth_can_manage_overtime_activity_evidence(p_activity_id uuid)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $function$
  select exists (
    select 1
    from public.overtime_activities activity
    where activity.id = p_activity_id
      and activity.deleted_at is null
      and (
        (
          activity.status = 'DRAFT'
          and coalesce(activity.submission_count, 0) = 0
          and statement_timestamp() <= public.resolve_overtime_initial_deadline(
            activity.contract_id,
            activity.up3_id,
            activity.overtime_date,
            statement_timestamp()
          )
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
      and not exists (
        select 1 from public.overtime_entries entry
        where entry.activity_id = p_activity_id
          and entry.approval_status = 'APPROVED'
      )
  )
$function$;

comment on function public.auth_can_manage_overtime_activity_evidence(uuid)
  is 'Evidence is manageable in DRAFT/CORRECTION_REQUIRED within deadline and scope, and never while any participant is APPROVED.';
