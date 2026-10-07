-- Hide legacy duplicate activity-level APPROVED/REJECTED/CLOSED history rows.
-- Older entry approvals also wrote a second activity-level event in the same
-- transaction (identical occurred_at). Raw audit rows are preserved; only the
-- list RPC suppresses the redundant row when a matching participant event
-- exists (same activity, actor, event, timestamp).
-- reject_overtime_entry_l5 no longer writes the redundant activity-level
-- event either; the participant event already carries reason and identity.

create or replace function public.list_overtime_history_l5(p_activity_id uuid)
returns setof public.overtime_activity_history
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.overtime_activity_history h
  where h.activity_id = p_activity_id
    and not (
      h.entry_id is null
      and h.event in ('APPROVED', 'REJECTED', 'CLOSED')
      and exists (
        select 1 from public.overtime_activity_history p
        where p.activity_id = h.activity_id
          and p.entry_id is not null
          and p.event = h.event
          and p.actor_user_id is not distinct from h.actor_user_id
          and p.occurred_at = h.occurred_at
      )
    )
  order by h.occurred_at
$$;

-- Reject a single participant entry (entry-scoped history only).
create or replace function public.reject_overtime_entry_l5(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.overtime_entries%rowtype;
  v_activity public.overtime_activities%rowtype;
  v_reason text;
  v_deadline timestamptz;
  v_participant_label text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then raise exception 'Reject reason is required'; end if;
  select * into v_entry from public.overtime_entries where id = p_entry_id for update;
  if not found then raise exception 'Overtime participant not found'; end if;
  select * into v_activity from public.overtime_activities where id = v_entry.activity_id and deleted_at is null for update;
  if not found then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to reject in this UP3' using errcode = '42501';
  end if;
  if v_entry.approval_status <> 'SUBMITTED' then
    raise exception 'Only submitted overtime entries can be rejected';
  end if;
  if v_entry.rejection_count >= 3 then raise exception 'Maximum rejections reached'; end if;

  v_deadline := ((now() at time zone 'Asia/Pontianak')::date + 3 + time '23:59:59.999999') at time zone 'Asia/Pontianak';
  v_participant_label := 'Peserta: ' || coalesce(v_entry.employee_name_snapshot, v_entry.employee_id::text);

  if v_entry.rejection_count = 0 then
    update public.overtime_entries
    set approval_status = 'CORRECTION_REQUIRED', rejection_count = 1,
        revision_deadline_at = v_deadline, updated_by = auth.uid()
    where id = p_entry_id;
    insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, rejection_number, notes)
    values (v_activity.id, p_entry_id, 'REJECTED', auth.uid(), 'SUBMITTED', 'CORRECTION_REQUIRED', v_reason, 1, v_participant_label);
  elsif v_entry.rejection_count = 1 then
    update public.overtime_entries
    set approval_status = 'CORRECTION_REQUIRED', rejection_count = 2,
        revision_deadline_at = v_deadline, updated_by = auth.uid()
    where id = p_entry_id;
    insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, rejection_number, notes)
    values (v_activity.id, p_entry_id, 'REJECTED', auth.uid(), 'SUBMITTED', 'CORRECTION_REQUIRED', v_reason, 2, v_participant_label);
  else
    update public.overtime_entries
    set approval_status = 'CLOSED', rejection_count = 3,
        revision_deadline_at = null, updated_by = auth.uid()
    where id = p_entry_id;
    insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, rejection_number, notes)
    values (v_activity.id, p_entry_id, 'CLOSED', auth.uid(), 'SUBMITTED', 'CLOSED', v_reason, 3, v_participant_label);
  end if;

  perform public.refresh_overtime_activity_review_status(v_activity.id);
  return p_entry_id;
end;
$$;

revoke all on function public.list_overtime_history_l5(uuid) from public, anon, authenticated;
revoke all on function public.reject_overtime_entry_l5(uuid, text) from public, anon, authenticated;
grant execute on function public.list_overtime_history_l5(uuid) to authenticated;
grant execute on function public.reject_overtime_entry_l5(uuid, text) to authenticated;
