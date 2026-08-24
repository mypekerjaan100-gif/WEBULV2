-- M0: Fix expire authorization to use MANAGE scope, not READ scope.
-- TEAM_LEADER / MANAGER_UNIT / MANAGER_UP / ASMAN_* must not gain mutation via expiry.
-- Reuse existing canonical helper public.auth_can_manage_overtime_scope.

create or replace function public.expire_overtime_initial_drafts_l6(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  with expired as (
    update public.overtime_activities activity
    set status = 'CLOSED',
        closure_reason = 'EXPIRED',
        closed_at = clock_timestamp(),
        closed_by = auth.uid(),
        updated_by = auth.uid()
    where activity.contract_id = p_contract_id
      and activity.up3_id = p_up3_id
      and (p_unit_id is null or activity.unit_id = p_unit_id)
      and activity.status = 'DRAFT'
      and coalesce(activity.submission_count, 0) = 0
      and clock_timestamp() > (
        activity.submission_deadline + time '23:59:59.999999'
      ) at time zone 'Asia/Pontianak'
      and public.auth_can_manage_overtime_scope(
        activity.contract_id,
        activity.up3_id,
        activity.unit_id
      )
    returning activity.id
  ), history as (
    insert into public.overtime_activity_history (
      activity_id,
      event,
      actor_user_id,
      previous_status,
      new_status,
      reason
    )
    select id, 'CLOSED', auth.uid(), 'DRAFT', 'CLOSED',
      'Batas pengajuan awal D+7 telah lewat'
    from expired
    returning 1
  )
  select count(*) into v_count from history;

  return v_count;
end;
$$;

-- Backward-compatible alias for callers referencing l5 naming.
create or replace function public.expire_overtime_initial_drafts_l5(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.expire_overtime_initial_drafts_l6(p_contract_id, p_up3_id, p_unit_id);
end;
$$;

revoke all on function public.expire_overtime_initial_drafts_l6(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.expire_overtime_initial_drafts_l5(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.expire_overtime_initial_drafts_l6(uuid, uuid, uuid) to authenticated;
grant execute on function public.expire_overtime_initial_drafts_l5(uuid, uuid, uuid) to authenticated;

comment on function public.expire_overtime_initial_drafts_l6(uuid, uuid, uuid)
  is 'Closes never-submitted DRAFT overtime after D+7 23:59 Asia/Pontianak in the caller MANAGE scope (SUPER_ADMIN/ADMIN_UP3/ADMIN_ULP). Management read roles are denied.';
comment on function public.expire_overtime_initial_drafts_l5(uuid, uuid, uuid)
  is 'Alias to expire_overtime_initial_drafts_l6 for backward compatibility; same MANAGE-scope authorization.';
