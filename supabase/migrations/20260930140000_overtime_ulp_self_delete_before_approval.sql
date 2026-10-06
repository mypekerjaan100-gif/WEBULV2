-- Allow ADMIN_ULP to soft-delete their own overtime before any approval.
-- SUPER_ADMIN keeps full delete rights. ULP delete is blocked when the
-- activity is APPROVED/CLOSED or any participant entry is already APPROVED.
-- Deletion stays activity-level: the whole form (all participants) is removed
-- from recap while evidence and audit history are preserved.

create or replace function public.soft_delete_overtime_activity(p_activity_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_is_super_admin boolean := public.auth_is_super_admin();
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
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

  if not v_is_super_admin then
    if not (
      public.auth_can_mutate_overtime_replacement_l2(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id)
      or public.auth_can_mutate_overtime_work_l3(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id)
    ) then
      raise exception 'Hanya pemilik data pada ULP sendiri yang dapat menghapus' using errcode = '42501';
    end if;
    if v_activity.status not in ('DRAFT', 'SUBMITTED', 'CORRECTION_REQUIRED') then
      raise exception 'Hanya lembur yang belum disetujui yang dapat dihapus';
    end if;
    if exists (
      select 1 from public.overtime_entries
      where activity_id = p_activity_id
        and approval_status = 'APPROVED'
    ) then
      raise exception 'Sebagian peserta sudah disetujui sehingga data tidak dapat dihapus';
    end if;
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

comment on function public.soft_delete_overtime_activity(uuid, text)
  is 'Soft-deletes overtime: SUPER_ADMIN any state; ADMIN_ULP only own ULP data with no approved participant.';
