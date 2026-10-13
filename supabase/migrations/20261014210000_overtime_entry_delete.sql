-- Hapus satu peserta Lembur tanpa menghapus batch.
-- Menghapus baris entry (evidence scoped ikut cascade, file Storage milik
-- entry dibersihkan, audit tersimpan sebagai DELETED dengan alasan).
-- Peserta lain, evidence bersama, dan status mereka tidak berubah.
-- Jika tidak ada peserta tersisa, aktivitas ikut di-soft-delete.
-- ADMIN_ULP: scope ULP sendiri + target belum APPROVED/CLOSED.
-- SUPER_ADMIN: penuh seperti soft delete aktivitas.

create or replace function public.soft_delete_overtime_entry_l5(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path to public, storage, pg_temp
as $function$
declare
  v_entry public.overtime_entries%rowtype;
  v_activity public.overtime_activities%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_is_super_admin boolean := public.auth_is_super_admin();
  v_remaining int;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_entry_id is null then
    raise exception 'Overtime participant is required';
  end if;
  if v_reason = '' then
    raise exception 'Alasan hapus wajib diisi';
  end if;

  select * into v_entry
  from public.overtime_entries
  where id = p_entry_id
  for update;
  if not found then
    raise exception 'Overtime participant not found';
  end if;

  select * into v_activity
  from public.overtime_activities
  where id = v_entry.activity_id
  for update;
  if not found or v_activity.deleted_at is not null then
    raise exception 'Overtime activity is not available';
  end if;

  if not v_is_super_admin then
    if not public.auth_can_mutate_overtime_replacement_l2(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id)
      and not public.auth_can_mutate_overtime_work_l3(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
      raise exception 'Hanya pemilik data pada ULP sendiri yang dapat menghapus' using errcode = '42501';
    end if;
    if v_entry.approval_status not in ('DRAFT', 'SUBMITTED', 'CORRECTION_REQUIRED') then
      raise exception 'Hanya peserta yang belum disetujui yang dapat dihapus';
    end if;
  end if;

  -- Audit dahulu (entry_id menjadi null setelah baris entry dihapus).
  insert into public.overtime_activity_history(
    activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason
  ) values (
    v_activity.id, v_entry.id, 'DELETED', auth.uid(),
    v_entry.approval_status, v_entry.approval_status,
    'Hapus peserta ' || coalesce(v_entry.employee_name_snapshot, v_entry.id::text) || ': ' || v_reason
  );

  -- Bersihkan file Storage milik entry agar tidak yatim.
  delete from storage.objects
  where bucket_id = 'overtime-evidence'
    and name in (
      select storage_path from public.overtime_evidence where entry_id = p_entry_id
    );
  -- Metadata scoped ikut terhapus (cascade); pastikan tidak ada sisa.
  delete from public.overtime_evidence where entry_id = p_entry_id;
  delete from public.overtime_entries where id = p_entry_id;

  select count(*) into v_remaining
  from public.overtime_entries where activity_id = v_activity.id;
  if v_remaining = 0 then
    update public.overtime_activities
    set deleted_at = clock_timestamp(),
        deleted_by = auth.uid(),
        delete_reason = v_reason,
        updated_by = auth.uid()
    where id = v_activity.id;
  else
    update public.overtime_activities set started_at = (select min(participant_started_at) from public.overtime_entries where activity_id = v_activity.id), ended_at = (select max(participant_ended_at) from public.overtime_entries where activity_id = v_activity.id), updated_by = auth.uid()
    where id = v_activity.id;
    perform public.refresh_overtime_activity_review_status(v_activity.id);
  end if;

  return p_entry_id;
end;
$function$;

revoke all on function public.soft_delete_overtime_entry_l5(uuid, text) from public, anon;
grant execute on function public.soft_delete_overtime_entry_l5(uuid, text) to authenticated;

comment on function public.soft_delete_overtime_entry_l5(uuid, text)
is 'Deletes one overtime participant; siblings, shared evidence, and their statuses are preserved.';
