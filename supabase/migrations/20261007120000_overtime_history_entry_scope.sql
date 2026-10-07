-- Scope overtime history to participant entries.
-- Form-level events keep entry_id NULL (CREATED, SUBMITTED, RESUBMITTED,
-- activity transitions, DELETED). Participant approve/reject events carry
-- entry_id so per-participant detail only shows its own review trail.

alter table public.overtime_activity_history
  add column if not exists entry_id uuid references public.overtime_entries(id) on delete set null;

create index if not exists idx_overtime_history_activity_entry
  on public.overtime_activity_history (activity_id, occurred_at, entry_id);

-- Backfill participant events written before entry scoping, matched by the
-- "Peserta: NAME" note against the entry name snapshot.
update public.overtime_activity_history h
set entry_id = e.id
from public.overtime_entries e
where h.entry_id is null
  and e.activity_id = h.activity_id
  and h.event in ('APPROVED', 'REJECTED', 'CLOSED')
  and h.notes like 'Peserta: %'
  and upper(e.employee_name_snapshot) = upper(btrim(substring(h.notes from 10)));

-- Approve a single participant entry (entry-scoped history, no duplicate
-- activity-level APPROVED event when the last participant is approved).
create or replace function public.approve_overtime_entry_l5(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.overtime_entries%rowtype;
  v_activity public.overtime_activities%rowtype;
  v_prev_activity_status text;
  v_after public.overtime_activities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_entry from public.overtime_entries where id = p_entry_id for update;
  if not found then raise exception 'Overtime participant not found'; end if;
  select * into v_activity from public.overtime_activities where id = v_entry.activity_id and deleted_at is null for update;
  if not found then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to approve in this UP3' using errcode = '42501';
  end if;
  if v_entry.approval_status <> 'SUBMITTED' then
    raise exception 'Only submitted overtime entries can be approved';
  end if;

  update public.overtime_entries
  set approval_status = 'APPROVED',
      revision_deadline_at = null,
      updated_by = auth.uid()
  where id = p_entry_id;

  insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, notes)
  values (v_activity.id, p_entry_id, 'APPROVED', auth.uid(), 'SUBMITTED', 'APPROVED', 'Peserta: ' || coalesce(v_entry.employee_name_snapshot, v_entry.employee_id::text));

  v_prev_activity_status := v_activity.status;
  perform public.refresh_overtime_activity_review_status(v_activity.id);
  select * into v_after from public.overtime_activities where id = v_activity.id;
  if v_after.status = 'APPROVED' and v_prev_activity_status <> 'APPROVED' then
    update public.overtime_activities
    set approved_at = clock_timestamp(),
        approved_by = auth.uid(),
        closed_at = null,
        closure_reason = null
    where id = v_activity.id;
  end if;
  return p_entry_id;
end;
$$;

-- Reject a single participant entry (entry-scoped history).
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
  v_prev_activity_status text;
  v_after public.overtime_activities%rowtype;
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

  v_prev_activity_status := v_activity.status;
  perform public.refresh_overtime_activity_review_status(v_activity.id);
  select * into v_after from public.overtime_activities where id = v_activity.id;
  if v_after.status <> v_prev_activity_status then
    if v_after.status = 'CORRECTION_REQUIRED' then
      insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, notes)
      values (v_activity.id, 'REJECTED', auth.uid(), v_prev_activity_status, 'CORRECTION_REQUIRED', v_reason, v_participant_label);
    elsif v_after.status = 'CLOSED' then
      insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, notes)
      values (v_activity.id, 'CLOSED', auth.uid(), v_prev_activity_status, 'CLOSED', v_reason, v_participant_label);
    end if;
  end if;
  return p_entry_id;
end;
$$;

revoke all on function public.approve_overtime_entry_l5(uuid) from public, anon, authenticated;
revoke all on function public.reject_overtime_entry_l5(uuid, text) from public, anon, authenticated;
grant execute on function public.approve_overtime_entry_l5(uuid) to authenticated;
grant execute on function public.reject_overtime_entry_l5(uuid, text) to authenticated;
