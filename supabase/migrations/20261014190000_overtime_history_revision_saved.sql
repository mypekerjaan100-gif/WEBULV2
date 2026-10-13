-- Riwayat Lembur: bedakan revisi disimpan vs diajukan ulang.
-- 1. Event baru REVISION_SAVED (revisi disimpan, belum diajukan ulang)
--    dan UPDATED (draft diperbarui).
-- 2. Save draft in-place: revisi mencatat REVISION_SAVED per entry yang
--    ditolak (entry_id terisi agar tidak muncul di peserta lain);
--    simpanan draft awal mencatat UPDATED, bukan RESUBMITTED.
-- 3. Jalur legacy: revisi mencatat REVISION_SAVED per entry koreksi.
-- RESUBMITTED tetap hanya untuk pengajuan ulang yang sebenarnya.
-- Aman dijalankan ulang: hanya mengganti bila pola lama ditemukan.

alter table public.overtime_activity_history
  drop constraint overtime_activity_history_event_check;

alter table public.overtime_activity_history
  add constraint overtime_activity_history_event_check
  check (event in ('CREATED', 'SUBMITTED', 'REJECTED', 'RESUBMITTED', 'APPROVED', 'CLOSED', 'DELETED', 'REVISION_SAVED', 'UPDATED'));

do $$
declare
  v_def text;
  v_old_inplace text;
  v_new_inplace text;
  v_old_legacy text;
  v_new_legacy text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'save_overtime_work_draft_l3';
  if v_def is null then raise exception 'save_overtime_work_draft_l3 not found'; end if;

  -- Cabang in-place: RESUBMITTED 'Revision updated' -> REVISION_SAVED/UPDATED.
  v_old_inplace := 'insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, notes)' || chr(10)
    || '    values (v_activity_id, ''RESUBMITTED'', auth.uid(), v_activity.status, v_activity.status, ''Revision updated'');' || chr(10) || '    return v_activity_id;';
  if position(v_old_inplace in v_def) = 0 then
    raise exception 'In-place history pattern not found; aborting';
  end if;
  v_new_inplace := 'if v_is_revision then' || chr(10)
    || '      for v_row in select id, employee_name_snapshot from public.overtime_entries where activity_id = v_activity_id and approval_status = ''CORRECTION_REQUIRED'' loop' || chr(10)
    || '        insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, notes)' || chr(10)
    || '        values (v_activity_id, v_row.id, ''REVISION_SAVED'', auth.uid(), v_activity.status, v_activity.status, ''Peserta: '' || v_row.employee_name_snapshot);' || chr(10)
    || '      end loop;' || chr(10)
    || '    else' || chr(10)
    || '      insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, notes)' || chr(10)
    || '      values (v_activity_id, ''UPDATED'', auth.uid(), v_activity.status, v_activity.status, ''Draft updated'');' || chr(10)
    || '    end if;' || chr(10)
    || '    return v_activity_id;';
  v_def := replace(v_def, v_old_inplace, v_new_inplace);

  -- Jalur legacy: RESUBMITTED 'Revision updated' -> REVISION_SAVED per entry.
  v_old_legacy := 'insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, notes) values (v_activity_id, ''RESUBMITTED'', auth.uid(), v_activity.status, v_activity.status, ''Revision updated'');';
  if position(v_old_legacy in v_def) = 0 then
    raise exception 'Legacy history pattern not found; aborting';
  end if;
  v_new_legacy := 'for v_row in select id, employee_name_snapshot from public.overtime_entries where activity_id = v_activity_id and approval_status = ''CORRECTION_REQUIRED'' loop' || chr(10)
    || '      insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, notes)' || chr(10)
    || '      values (v_activity_id, v_row.id, ''REVISION_SAVED'', auth.uid(), v_activity.status, v_activity.status, ''Peserta: '' || v_row.employee_name_snapshot);' || chr(10)
    || '    end loop;';
  v_def := replace(v_def, v_old_legacy, v_new_legacy);

  execute v_def;
end;
$$;
