-- Tolak Final: penolakan langsung (bukan perintah revisi) yang menutup
-- pengajuan secara permanen dan dikecualikan dari rekap pembayaran.
-- Cakupan fitur (diputuskan bersama pengguna): Lembur Administrasi
-- (WORK/ADMINISTRASI), Pengganti Izin (REPLACEMENT_PERMISSION),
-- Pengganti Sakit (REPLACEMENT_SICK). Lembur lain tetap mengikuti alur
-- revisi yang sudah ada (penolakan ke-3 menutup otomatis).

-- 1. Alasan penutupan per peserta, agar tampilan Tetap "Ditolak Final"
-- pada batch campuran (peserta Disetujui + Ditutup) tanpa mewarisi
-- alasan aktivitas milik peserta lain.
alter table public.overtime_entries
  add column if not exists closure_reason text;

-- Backfill dari alasan aktivitas; entry CLOSED tanpa alasan aktivitas
-- adalah penutupan per-peserta (revisi ke-3) yang berarti penolakan final.
update public.overtime_entries e
set closure_reason = 'EXPIRED'
from public.overtime_activities a
where a.id = e.activity_id
  and e.approval_status = 'CLOSED'
  and a.closure_reason = 'EXPIRED';

update public.overtime_entries e
set closure_reason = 'FINAL_REJECTED'
from public.overtime_activities a
where a.id = e.activity_id
  and e.approval_status = 'CLOSED'
  and a.closure_reason = 'FINAL_REJECTED';

update public.overtime_entries e
set closure_reason = 'FINAL_REJECTED'
where e.approval_status = 'CLOSED'
  and not exists (
    select 1 from public.overtime_activities a
    where a.id = e.activity_id
      and a.closure_reason in ('FINAL_REJECTED', 'EXPIRED')
  );

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.overtime_entries'::regclass
      and conname = 'oe_closure_reason_check'
  ) then
    alter table public.overtime_entries
      add constraint oe_closure_reason_check
      check (closure_reason is null or closure_reason in ('FINAL_REJECTED', 'EXPIRED'));
  end if;
end;
$constraint$;

-- 2. Penutupan revisi ke-3 per peserta juga menandai alasan final.
create or replace function public.reject_overtime_entry_l5(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_entry public.overtime_entries%rowtype;
  v_activity public.overtime_activities%rowtype;
  v_reason text;
  v_deadline timestamptz;
  v_participant_label text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'Reject reason is required';
  end if;
  select * into v_entry from public.overtime_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Overtime participant not found';
  end if;
  select * into v_activity
  from public.overtime_activities
  where id = v_entry.activity_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Overtime activity not found';
  end if;
  if v_activity.unit_id = v_activity.up3_id and not public.auth_is_super_admin() then
    raise exception 'Lembur kantor UP3 hanya dapat diputuskan oleh Super Admin' using errcode='42501';
  end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to reject in this UP3' using errcode = '42501';
  end if;
  if v_entry.approval_status <> 'SUBMITTED' then
    raise exception 'Only submitted overtime entries can be rejected';
  end if;
  if v_entry.rejection_count >= 3 then
    raise exception 'Maximum rejections reached';
  end if;
  v_deadline := ((now() at time zone 'Asia/Pontianak')::date + 3 + time '23:59:59.999999') at time zone 'Asia/Pontianak';
  v_participant_label := 'Peserta: ' || coalesce(v_entry.employee_name_snapshot, v_entry.employee_id::text);
  if v_entry.rejection_count = 0 then
    update public.overtime_entries
    set approval_status = 'CORRECTION_REQUIRED',
        rejection_count = 1,
        revision_deadline_at = v_deadline,
        updated_by = auth.uid()
    where id = p_entry_id;
    insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, rejection_number, notes)
    values (v_activity.id, p_entry_id, 'REJECTED', auth.uid(), 'SUBMITTED', 'CORRECTION_REQUIRED', v_reason, 1, v_participant_label);
  elsif v_entry.rejection_count = 1 then
    update public.overtime_entries
    set approval_status = 'CORRECTION_REQUIRED',
        rejection_count = 2,
        revision_deadline_at = v_deadline,
        updated_by = auth.uid()
    where id = p_entry_id;
    insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, rejection_number, notes)
    values (v_activity.id, p_entry_id, 'REJECTED', auth.uid(), 'SUBMITTED', 'CORRECTION_REQUIRED', v_reason, 2, v_participant_label);
  else
    update public.overtime_entries
    set approval_status = 'CLOSED',
        closure_reason = 'FINAL_REJECTED',
        rejection_count = 3,
        revision_deadline_at = null,
        updated_by = auth.uid()
    where id = p_entry_id;
    insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, rejection_number, notes)
    values (v_activity.id, p_entry_id, 'CLOSED', auth.uid(), 'SUBMITTED', 'CLOSED', v_reason, 3, v_participant_label);
  end if;
  perform public.refresh_overtime_activity_review_status(v_activity.id);
  return p_entry_id;
end;
$function$;

-- 3. Tolak Final per peserta: hanya peserta berstatus Diajukan, alasan
-- wajib, tidak mengubah peserta lain, tidak menaikkan hitungan revisi.
create or replace function public.final_reject_overtime_entry_l5(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_activity public.overtime_activities%rowtype;
  v_entry public.overtime_entries%rowtype;
  v_updated_entry public.overtime_entries%rowtype;
  v_reason text;
  v_participant_label text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'Final reject reason is required';
  end if;
  select * into v_entry from public.overtime_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Overtime participant not found';
  end if;
  select * into v_activity
  from public.overtime_activities
  where id = v_entry.activity_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Overtime activity not found';
  end if;
  if v_activity.unit_id = v_activity.up3_id and not public.auth_is_super_admin() then
    raise exception 'Lembur kantor UP3 hanya dapat diputuskan oleh Super Admin' using errcode='42501';
  end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to reject in this UP3' using errcode = '42501';
  end if;
  if not (
    v_activity.type in ('REPLACEMENT_PERMISSION', 'REPLACEMENT_SICK')
    or (v_activity.type = 'WORK' and v_activity.work_category = 'ADMINISTRASI')
  ) then
    raise exception 'Tolak Final hanya tersedia untuk Lembur Administrasi, Pengganti Izin, atau Pengganti Sakit';
  end if;
  if v_entry.approval_status <> 'SUBMITTED' then
    raise exception 'Only submitted overtime entries can be finally rejected';
  end if;
  update public.overtime_entries
  set approval_status = 'CLOSED',
      closure_reason = 'FINAL_REJECTED',
      revision_deadline_at = null,
      updated_by = auth.uid()
  where id = p_entry_id
  returning * into v_updated_entry;
  if v_updated_entry.approval_status is distinct from 'CLOSED'
     or v_updated_entry.closure_reason is distinct from 'FINAL_REJECTED' then
    raise exception 'Final reject was not applied';
  end if;
  v_participant_label := 'Peserta: ' || coalesce(v_entry.employee_name_snapshot, v_entry.employee_id::text);
  insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, notes)
  values (v_activity.id, p_entry_id, 'CLOSED', auth.uid(), 'SUBMITTED', 'CLOSED', v_reason,
          'Penolakan final (Tolak Final) — tidak dapat direvisi dan tidak masuk rekap pembayaran. ' || v_participant_label);
  perform public.refresh_overtime_activity_review_status(v_activity.id);
  return p_entry_id;
end;
$function$;

-- 4. Tolak Final tingkat pengajuan untuk Pengganti Izin/Sakit (alur
-- approval pengganti bekerja pada tingkat aktivitas). Peserta Disetujui
-- tidak terusir; hanya peserta berstatus Diajukan yang ditutup.
create or replace function public.final_reject_overtime_l5(p_activity_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_activity public.overtime_activities%rowtype;
  v_entry public.overtime_entries%rowtype;
  v_reason text;
  v_occurred_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'Final reject reason is required';
  end if;
  select * into v_activity
  from public.overtime_activities
  where id = p_activity_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Overtime activity not found';
  end if;
  if v_activity.unit_id = v_activity.up3_id and not public.auth_is_super_admin() then
    raise exception 'Lembur kantor UP3 hanya dapat diputuskan oleh Super Admin' using errcode='42501';
  end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to reject in this UP3' using errcode = '42501';
  end if;
  if not (
    v_activity.type in ('REPLACEMENT_PERMISSION', 'REPLACEMENT_SICK')
    or (v_activity.type = 'WORK' and v_activity.work_category = 'ADMINISTRASI')
  ) then
    raise exception 'Tolak Final hanya tersedia untuk Lembur Administrasi, Pengganti Izin, atau Pengganti Sakit';
  end if;
  if v_activity.status <> 'SUBMITTED' then
    raise exception 'Only submitted overtime can be finally rejected';
  end if;
  if not exists (
    select 1 from public.overtime_entries
    where activity_id = p_activity_id and approval_status = 'SUBMITTED'
  ) then
    raise exception 'No submitted overtime participant to reject';
  end if;
  v_occurred_at := clock_timestamp();
  for v_entry in
    select * from public.overtime_entries
    where activity_id = p_activity_id and approval_status = 'SUBMITTED'
    for update
  loop
    update public.overtime_entries
    set approval_status = 'CLOSED',
        closure_reason = 'FINAL_REJECTED',
        revision_deadline_at = null,
        updated_by = auth.uid()
    where id = v_entry.id;
    insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, notes)
    values (v_activity.id, v_entry.id, 'CLOSED', auth.uid(), 'SUBMITTED', 'CLOSED', v_reason,
            'Penolakan final (Tolak Final) — tidak dapat direvisi dan tidak masuk rekap pembayaran. Peserta: '
            || coalesce(v_entry.employee_name_snapshot, v_entry.employee_id::text));
  end loop;
  update public.overtime_activities
  set last_rejection_at = v_occurred_at,
      last_rejected_by = auth.uid(),
      updated_by = auth.uid()
  where id = p_activity_id;
  insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, notes)
  values (p_activity_id, 'CLOSED', auth.uid(), v_activity.status, 'CLOSED', v_reason,
          'Penolakan final (Tolak Final) — tidak dapat direvisi dan tidak masuk rekap pembayaran.');
  perform public.refresh_overtime_activity_review_status(p_activity_id);
  return p_activity_id;
end;
$function$;

-- 5. Penolakan ke-3 tingkat aktivitas memberi alasan final pada peserta
-- yang ikut ditutup bersama aktivitas (tidak mengubah peserta Disetujui).
create or replace function public.reject_overtime_l5(p_activity_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_activity public.overtime_activities%rowtype;
  v_reason text;
  v_deadline timestamptz;
  v_next_count int;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  v_reason:=btrim(coalesce(p_reason,''));
  if v_reason='' then
    raise exception 'Reject reason is required';
  end if;
  select * into v_activity from public.overtime_activities where id=p_activity_id for update;
  if not found then
    raise exception 'Overtime activity not found';
  end if;
  if v_activity.unit_id = v_activity.up3_id and not public.auth_is_super_admin() then
    raise exception 'Lembur kantor UP3 hanya dapat diputuskan oleh Super Admin' using errcode='42501';
  end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to reject in this UP3' using errcode = '42501';
  end if;
  if v_activity.status <> 'SUBMITTED' then
    raise exception 'Only submitted overtime can be rejected';
  end if;
  if v_activity.rejection_count >= 3 then
    raise exception 'Maximum rejections reached';
  end if;
  v_deadline := ((now() at time zone 'Asia/Pontianak')::date + 3 + time '23:59:59.999999') at time zone 'Asia/Pontianak';
  v_next_count := v_activity.rejection_count + 1;
  if v_activity.rejection_count = 0 then
    update public.overtime_activities
    set status='CORRECTION_REQUIRED', rejection_count=1, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), revision_deadline_at=v_deadline, updated_by=auth.uid()
    where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number)
    values (p_activity_id,'REJECTED',auth.uid(),v_activity.status,'CORRECTION_REQUIRED',v_reason,1);
  elsif v_activity.rejection_count = 1 then
    update public.overtime_activities
    set status='CORRECTION_REQUIRED', rejection_count=2, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), revision_deadline_at=v_deadline, updated_by=auth.uid()
    where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number)
    values (p_activity_id,'REJECTED',auth.uid(),v_activity.status,'CORRECTION_REQUIRED',v_reason,2);
  else
    update public.overtime_activities
    set status='CLOSED', closure_reason='FINAL_REJECTED', rejection_count=3, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), closed_at=clock_timestamp(), closed_by=auth.uid(), updated_by=auth.uid(), revision_deadline_at=null
    where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number)
    values (p_activity_id,'CLOSED',auth.uid(),v_activity.status,'CLOSED',v_reason,3);
  end if;
  update public.overtime_entries
  set approval_status = case when v_next_count >= 3 then 'CLOSED' else 'CORRECTION_REQUIRED' end,
      closure_reason = case when v_next_count >= 3 then 'FINAL_REJECTED' else closure_reason end,
      rejection_count = v_next_count,
      revision_deadline_at = case when v_next_count >= 3 then null else v_deadline end,
      updated_by = auth.uid()
  where activity_id = p_activity_id
    and approval_status not in ('APPROVED', 'CLOSED');
  return p_activity_id;
end;
$function$;

-- 6. List WORK membawa alasan penutupan per peserta;
-- peserta lain dan aktivitas tidak mewarisinya demi tampilan.
drop function if exists public.list_overtime_work_l3(uuid, uuid, uuid, date);
create function public.list_overtime_work_l3(
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
  row_var_span_count integer,
  row_pruning_span_count integer,
  row_felling_20_40_count integer,
  row_felling_41_60_count integer,
  status text,
  participant_employee_id uuid,
  participant_name text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_hours numeric,
  total_amount numeric,
  submission_deadline_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  rejection_count integer,
  revision_deadline_at timestamptz,
  closure_reason text,
  evidence_mode text,
  entry_approval_status text,
  entry_rejection_count integer,
  entry_revision_deadline_at timestamptz,
  entry_closure_reason text
)
language plpgsql
stable
security definer
set search_path to public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_period_month is not null
     and p_period_month <> date_trunc('month', p_period_month::timestamp)::date then
    raise exception 'Period month must be the first day of a month';
  end if;
  return query
  select
    activity.id,
    entry.id,
    activity.contract_id,
    activity.up3_id,
    activity.unit_id,
    activity.period_month,
    activity.overtime_date,
    activity.work_category,
    activity.work_title,
    activity.work_location,
    activity.description,
    activity.row_var_span_count,
    activity.row_pruning_span_count,
    activity.row_felling_20_40_count,
    activity.row_felling_41_60_count,
    activity.status,
    entry.employee_id,
    entry.employee_name_snapshot,
    entry.participant_started_at,
    entry.participant_ended_at,
    entry.duration_hours_snapshot,
    entry.calculated_amount_snapshot,
    public.resolve_overtime_initial_deadline(
      activity.contract_id,
      activity.up3_id,
      activity.overtime_date,
      statement_timestamp()
    ),
    activity.created_at,
    activity.updated_at,
    activity.rejection_count,
    activity.revision_deadline_at,
    activity.closure_reason,
    coalesce(activity.evidence_mode, 'LEGACY_SHARED'),
    entry.approval_status,
    entry.rejection_count,
    entry.revision_deadline_at,
    entry.closure_reason
  from public.overtime_activities activity
  join public.overtime_entries entry on entry.activity_id = activity.id
  where activity.contract_id = p_contract_id
    and activity.up3_id = p_up3_id
    and activity.type = 'WORK'
    and activity.deleted_at is null
    and (p_unit_id is null or activity.unit_id = p_unit_id)
    and (p_period_month is null or activity.period_month = p_period_month)
    and public.auth_can_read_overtime_evidence_scope(
      activity.contract_id,
      activity.up3_id,
      activity.unit_id
    )
  order by activity.started_at desc, activity.id, entry.participant_started_at;
end;
$$;

revoke all on function public.reject_overtime_entry_l5(uuid, text) from public, anon, authenticated;
grant execute on function public.reject_overtime_entry_l5(uuid, text) to authenticated;
revoke all on function public.reject_overtime_l5(uuid, text) from public, anon, authenticated;
grant execute on function public.reject_overtime_l5(uuid, text) to authenticated;
revoke all on function public.final_reject_overtime_entry_l5(uuid, text) from public, anon, authenticated;
grant execute on function public.final_reject_overtime_entry_l5(uuid, text) to authenticated;
revoke all on function public.final_reject_overtime_l5(uuid, text) from public, anon, authenticated;
grant execute on function public.final_reject_overtime_l5(uuid, text) to authenticated;
revoke all on function public.list_overtime_work_l3(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.list_overtime_work_l3(uuid, uuid, uuid, date) to authenticated;
