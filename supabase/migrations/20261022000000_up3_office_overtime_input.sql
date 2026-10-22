-- Fitur Lembur Kantor UP3.
--
-- Aturan usaha (disetujui):
--   1) Admin UP3 (asli, contract_role='ADMIN_UP3' tanpa operational_unit_id)
--      dapat membuat/memutasi/menghapus pengajuan lembur untuk pegawai yang
--      unit penugasannya langsung = UP3 (unit kantor UP3), bukan pegawai ULP.
--      Pegawai ULP tetap diinput Admin ULP masing-masing.
--   2) Semua jenis lembur ikut tersedia (Pengganti Cuti/Sakit/Izin dan
--      Lembur Pekerjaan) karena pipeline pengganti sendiri memakai helper
--      mutasi yang sama.
--   3) Keputusan (Setujui/Tolak) dan Koreksi untuk lembur kantor UP3 hanya
--      oleh Super Admin - Admin UP3 tidak boleh memutuskan inputannya
--      sendiri. Review lembur ULP oleh Admin UP3 tidak berubah.
--   4) Role manajemen tidak mendapat hak input baru (helper tetap menuntut
--      membership kontrak atau Super Admin).
--
-- Mekanisme:
--   A) Perluas auth_can_mutate_overtime_replacement_l2: selain unit ULP child,
--      unit = UP3 sendiri boleh dimutasi, tetapi hanya oleh Admin UP3 exact
--      atau Super Admin (dipakai save/submit draft pengganti + delegasi
--      auth_can_mutate_overtime_work_l3 untuk pekerjaan + soft delete +
--      resubmit).
--   B) Perluas auth_can_manage_overtime_evidence_scope: Admin UP3 exact boleh
--      mengelola evidence untuk aktivitas ber-unit UP3 sendiri (upload/
--      batal/finalisasi/hapus evidence via wrapper auth_can_manage_overtime_
--      activity/entry_evidence).
--   C) Perluas join list_overtime_replacement_employees_l2 agar pegawai
--      dengan penugasan langsung di UP3 ikut direkomendasikan (hanya untuk
--      Super Admin/Admin UP3; Admin ULP tetap terbatas unitnya).
--   D) Guard keputusan: approve/reject (aktivitas & peserta) dan koreksi
--      menolak keputusan unit kantor UP3 oleh non-Super Admin.
--   E) Pesan error hapus dinetralisasi: unit kerja, bukan hanya ULP.

-- ---------------------------------------------------------------------------
-- A) Perluasan mutasi lembur (draft pengganti L2 + delegasi WORK L3 + hapus)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_can_mutate_overtime_replacement_l2(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  select auth.uid() is not null and public.auth_can_manage_overtime_scope(p_contract_id, p_up3_id, p_unit_id)
   and exists(select 1 from public.organization_units u where u.id = p_unit_id and u.own_status = 'Aktif' and ((u.type = 'ULP' and u.parent_id = p_up3_id) or (u.type = 'UP3' and u.id = p_up3_id)))
   and (
     public.auth_is_super_admin()
     or exists(select 1 from public.contract_memberships m where m.user_id = auth.uid() and m.contract_role = 'ADMIN_ULP' and m.status = 'ACTIVE' and m.effective_from <= current_date and (m.effective_to is null or current_date < m.effective_to) and m.contract_id = p_contract_id and m.operational_up3_id = p_up3_id and m.operational_unit_id = p_unit_id)
     or (
       p_unit_id = p_up3_id
       and exists(select 1 from public.contract_memberships m where m.user_id = auth.uid() and m.contract_role = 'ADMIN_UP3' and m.operational_unit_id is null and m.status = 'ACTIVE' and m.effective_from <= current_date and (m.effective_to is null or current_date < m.effective_to) and m.contract_id = p_contract_id and m.operational_up3_id = p_up3_id)
     )
   )
$function$;

-- ---------------------------------------------------------------------------
-- B) Perluasan kelola evidence: Admin UP3 exact pada aktivitas unit UP3 sendiri
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_can_manage_overtime_evidence_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or (
      p_unit_id = p_up3_id
      and exists (
        select 1 from public.contract_memberships membership
        join public.contracts contract on contract.id = membership.contract_id and contract.status = 'active'
        join public.contract_up3_scopes scope
          on scope.contract_id = membership.contract_id
         and scope.up3_id = membership.operational_up3_id and scope.status = 'Aktif'
        where membership.user_id = auth.uid()
          and membership.contract_role = 'ADMIN_UP3'
          and membership.status = 'ACTIVE'
          and membership.effective_from <= current_date
          and (membership.effective_to is null or current_date < membership.effective_to)
          and membership.contract_id = p_contract_id
          and membership.operational_up3_id = p_up3_id
          and membership.operational_unit_id is null
      )
    )
    or exists (
      select 1 from public.contract_memberships membership
      join public.contracts contract on contract.id = membership.contract_id and contract.status = 'active'
      join public.contract_up3_scopes scope
        on scope.contract_id = membership.contract_id
       and scope.up3_id = membership.operational_up3_id and scope.status = 'Aktif'
      where membership.user_id = auth.uid()
        and membership.contract_role = 'ADMIN_ULP'
        and membership.status = 'ACTIVE'
        and membership.effective_from <= current_date
        and (membership.effective_to is null or current_date < membership.effective_to)
        and membership.contract_id = p_contract_id
        and membership.operational_up3_id = p_up3_id
        and membership.operational_unit_id = p_unit_id
    )
  )
$function$;

-- ---------------------------------------------------------------------------
-- C) Daftar pegawai pengganti: sertakan penugasan langsung di unit UP3 sendiri
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_overtime_replacement_employees_l2(p_contract_id uuid, p_up3_id uuid, p_started_at timestamp with time zone)
RETURNS TABLE(employee_id uuid, name text, unit_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_business_date date;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_started_at is null then raise exception 'Overtime start is required'; end if;
 v_business_date:=(p_started_at at time zone 'Asia/Pontianak')::date;
 if not exists(select 1 from public.contracts c join public.contract_up3_scopes s on s.contract_id=c.id and s.up3_id=p_up3_id and s.status='Aktif' join public.organization_units u on u.id=p_up3_id and u.type='UP3' and u.own_status='Aktif' where c.id=p_contract_id and c.status='active') then raise exception 'Requested overtime scope is not valid' using errcode='22023'; end if;
 if not public.auth_is_super_admin() and not exists(select 1 from public.contract_memberships m where m.user_id=auth.uid() and m.status='ACTIVE' and m.effective_from<=current_date and (m.effective_to is null or current_date<m.effective_to) and m.contract_id=p_contract_id and m.operational_up3_id=p_up3_id and m.contract_role in ('ADMIN_UP3','ADMIN_ULP')) then raise exception 'Requested overtime scope is not authorized' using errcode='42501'; end if;
 return query select e.id,e.name,a.unit_id from public.employees e join public.employee_unit_history a on a.employee_id=e.id and a.contract_id=p_contract_id and a.up3_id=p_up3_id and a.effective_from<=v_business_date and (a.effective_to is null or v_business_date<a.effective_to) join public.organization_units u on u.id=a.unit_id and u.own_status='Aktif' and ((u.type='ULP' and u.parent_id=p_up3_id) or (u.type='UP3' and u.id=p_up3_id))
 where public.overtime_employee_is_eligible_l2(e.id,p_contract_id,p_up3_id,a.unit_id,v_business_date)
 and (public.auth_is_super_admin() or exists(select 1 from public.contract_memberships m where m.user_id=auth.uid() and m.status='ACTIVE' and m.effective_from<=current_date and (m.effective_to is null or current_date<m.effective_to) and m.contract_id=p_contract_id and m.operational_up3_id=p_up3_id and ((m.contract_role='ADMIN_UP3' and m.operational_unit_id is null) or (m.contract_role='ADMIN_ULP' and m.operational_unit_id=a.unit_id)))) order by e.name,e.id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- D) Keputusan lembur kantor UP3 hanya oleh Super Admin
-- ---------------------------------------------------------------------------

-- Aktivitas: persetujuan
CREATE OR REPLACE FUNCTION public.approve_overtime_l5(p_activity_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare v_activity public.overtime_activities%rowtype; begin if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if; select * into v_activity from public.overtime_activities where id=p_activity_id for update; if not found then raise exception 'Overtime activity not found'; end if; if v_activity.unit_id = v_activity.up3_id and not public.auth_is_super_admin() then raise exception 'Lembur kantor UP3 hanya dapat diputuskan oleh Super Admin' using errcode='42501'; end if; if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then raise exception 'Not authorized to approve in this UP3' using errcode='42501'; end if; if v_activity.status <> 'SUBMITTED' then raise exception 'Only submitted overtime can be approved'; end if; update public.overtime_activities set status='APPROVED', approved_at=clock_timestamp(), approved_by=auth.uid(), updated_by=auth.uid(), closed_at=null, closure_reason=null where id=p_activity_id; update public.overtime_entries set approval_status='APPROVED', revision_deadline_at=null, updated_by=auth.uid() where activity_id=p_activity_id and approval_status <> 'CLOSED'; insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status) values (p_activity_id,'APPROVED',auth.uid(),v_activity.status,'APPROVED'); return p_activity_id; end; $function$;

-- Aktivitas: penolakan
CREATE OR REPLACE FUNCTION public.reject_overtime_l5(p_activity_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare v_activity public.overtime_activities%rowtype; v_reason text; v_deadline timestamptz; v_next_count int; begin if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if; v_reason:=btrim(coalesce(p_reason,'')); if v_reason='' then raise exception 'Reject reason is required'; end if; select * into v_activity from public.overtime_activities where id=p_activity_id for update; if not found then raise exception 'Overtime activity not found'; end if; if v_activity.unit_id = v_activity.up3_id and not public.auth_is_super_admin() then raise exception 'Lembur kantor UP3 hanya dapat diputuskan oleh Super Admin' using errcode='42501'; end if; if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then raise exception 'Not authorized to reject in this UP3' using errcode='42501'; end if; if v_activity.status <> 'SUBMITTED' then raise exception 'Only submitted overtime can be rejected'; end if; if v_activity.rejection_count >= 3 then raise exception 'Maximum rejections reached'; end if; v_deadline := ((now() at time zone 'Asia/Pontianak')::date + 3 + time '23:59:59.999999') at time zone 'Asia/Pontianak'; v_next_count := v_activity.rejection_count + 1; if v_activity.rejection_count = 0 then update public.overtime_activities set status='CORRECTION_REQUIRED', rejection_count=1, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), revision_deadline_at=v_deadline, updated_by=auth.uid() where id=p_activity_id; insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number) values (p_activity_id,'REJECTED',auth.uid(),v_activity.status,'CORRECTION_REQUIRED',v_reason,1); elsif v_activity.rejection_count = 1 then update public.overtime_activities set status='CORRECTION_REQUIRED', rejection_count=2, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), revision_deadline_at=v_deadline, updated_by=auth.uid() where id=p_activity_id; insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number) values (p_activity_id,'REJECTED',auth.uid(),v_activity.status,'CORRECTION_REQUIRED',v_reason,2); else update public.overtime_activities set status='CLOSED', closure_reason='FINAL_REJECTED', rejection_count=3, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), closed_at=clock_timestamp(), closed_by=auth.uid(), updated_by=auth.uid(), revision_deadline_at=null where id=p_activity_id; insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number) values (p_activity_id,'CLOSED',auth.uid(),v_activity.status,'CLOSED',v_reason,3); end if; update public.overtime_entries set approval_status = case when v_next_count >= 3 then 'CLOSED' else 'CORRECTION_REQUIRED' end, rejection_count = v_next_count, revision_deadline_at = case when v_next_count >= 3 then null else v_deadline end, updated_by = auth.uid() where activity_id = p_activity_id and approval_status not in ('APPROVED', 'CLOSED'); return p_activity_id; end; $function$;

-- Peserta: persetujuan
CREATE OR REPLACE FUNCTION public.approve_overtime_entry_l5(p_entry_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare v_entry public.overtime_entries%rowtype; v_activity public.overtime_activities%rowtype; v_prev_activity_status text; v_after public.overtime_activities%rowtype; begin if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if; select * into v_entry from public.overtime_entries where id = p_entry_id for update; if not found then raise exception 'Overtime participant not found'; end if; select * into v_activity from public.overtime_activities where id = v_entry.activity_id and deleted_at is null for update; if not found then raise exception 'Overtime activity not found'; end if; if v_activity.unit_id = v_activity.up3_id and not public.auth_is_super_admin() then raise exception 'Lembur kantor UP3 hanya dapat diputuskan oleh Super Admin' using errcode='42501'; end if; if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then raise exception 'Not authorized to approve in this UP3' using errcode = '42501'; end if; if v_entry.approval_status <> 'SUBMITTED' then raise exception 'Only submitted overtime entries can be approved'; end if; update public.overtime_entries set approval_status = 'APPROVED', revision_deadline_at = null, updated_by = auth.uid() where id = p_entry_id; insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, notes) values (v_activity.id, p_entry_id, 'APPROVED', auth.uid(), 'SUBMITTED', 'APPROVED', 'Peserta: ' || coalesce(v_entry.employee_name_snapshot, v_entry.employee_id::text)); v_prev_activity_status := v_activity.status; perform public.refresh_overtime_activity_review_status(v_activity.id); select * into v_after from public.overtime_activities where id = v_activity.id; if v_after.status = 'APPROVED' and v_prev_activity_status <> 'APPROVED' then update public.overtime_activities set approved_at = clock_timestamp(), approved_by = auth.uid(), closed_at = null, closure_reason = null where id = v_activity.id; end if; return p_entry_id; end; $function$;

-- Peserta: penolakan
CREATE OR REPLACE FUNCTION public.reject_overtime_entry_l5(p_entry_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare v_entry public.overtime_entries%rowtype; v_activity public.overtime_activities%rowtype; v_reason text; v_deadline timestamptz; v_participant_label text; begin if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if; v_reason := btrim(coalesce(p_reason, '')); if v_reason = '' then raise exception 'Reject reason is required'; end if; select * into v_entry from public.overtime_entries where id = p_entry_id for update; if not found then raise exception 'Overtime participant not found'; end if; select * into v_activity from public.overtime_activities where id = v_entry.activity_id and deleted_at is null for update; if not found then raise exception 'Overtime activity not found'; end if; if v_activity.unit_id = v_activity.up3_id and not public.auth_is_super_admin() then raise exception 'Lembur kantor UP3 hanya dapat diputuskan oleh Super Admin' using errcode='42501'; end if; if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then raise exception 'Not authorized to reject in this UP3' using errcode = '42501'; end if; if v_entry.approval_status <> 'SUBMITTED' then raise exception 'Only submitted overtime entries can be rejected'; end if; if v_entry.rejection_count >= 3 then raise exception 'Maximum rejections reached'; end if; v_deadline := ((now() at time zone 'Asia/Pontianak')::date + 3 + time '23:59:59.999999') at time zone 'Asia/Pontianak'; v_participant_label := 'Peserta: ' || coalesce(v_entry.employee_name_snapshot, v_entry.employee_id::text); if v_entry.rejection_count = 0 then update public.overtime_entries set approval_status = 'CORRECTION_REQUIRED', rejection_count = 1, revision_deadline_at = v_deadline, updated_by = auth.uid() where id = p_entry_id; insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, rejection_number, notes) values (v_activity.id, p_entry_id, 'REJECTED', auth.uid(), 'SUBMITTED', 'CORRECTION_REQUIRED', v_reason, 1, v_participant_label); elsif v_entry.rejection_count = 1 then update public.overtime_entries set approval_status = 'CORRECTION_REQUIRED', rejection_count = 2, revision_deadline_at = v_deadline, updated_by = auth.uid() where id = p_entry_id; insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, rejection_number, notes) values (v_activity.id, p_entry_id, 'REJECTED', auth.uid(), 'SUBMITTED', 'CORRECTION_REQUIRED', v_reason, 2, v_participant_label); else update public.overtime_entries set approval_status = 'CLOSED', rejection_count = 3, revision_deadline_at = null, updated_by = auth.uid() where id = p_entry_id; insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, rejection_number, notes) values (v_activity.id, p_entry_id, 'CLOSED', auth.uid(), 'SUBMITTED', 'CLOSED', v_reason, 3, v_participant_label); end if; perform public.refresh_overtime_activity_review_status(v_activity.id); return p_entry_id; end; $function$;

-- ---------------------------------------------------------------------------
-- E) Koreksi lembur disetujui: unit kantor UP3 hanya oleh Super Admin
-- ---------------------------------------------------------------------------

-- Koreksi (definisi approved-correction terdahulu, ditambah guard kantor UP3)
CREATE OR REPLACE FUNCTION public.correct_approved_overtime_work_l6(p_activity_id uuid, p_overtime_date date, p_participants jsonb, p_reason text, p_expected_updated_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_activity public.overtime_activities%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_count int;
  v_idx int;
  v_part jsonb;
  v_entry_id uuid;
  v_started timestamptz;
  v_ended timestamptz;
  v_row public.overtime_entries%rowtype;
  v_business_date date;
  v_actual_minutes numeric;
  v_duration numeric;
  v_multiplier numeric;
  v_rate numeric(18,2);
  v_new_rate numeric(18,2);
  v_hours numeric;
  v_amount numeric(18,2);
  v_min_started timestamptz;
  v_max_ended timestamptz;
  v_old_min timestamptz;
  v_old_max timestamptz;
  v_changed int := 0;
  v_notes text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_activity_id is null then
    raise exception 'Overtime activity is required';
  end if;
  if v_reason = '' then
    raise exception 'Alasan koreksi wajib diisi';
  end if;
  if p_overtime_date is null then
    raise exception 'Tanggal lembur wajib diisi';
  end if;
  if p_participants is null or jsonb_typeof(p_participants) <> 'array' then
    raise exception 'Participants must be a JSON array';
  end if;
  v_count := jsonb_array_length(p_participants);
  if v_count = 0 then
    raise exception 'At least one participant is required';
  end if;

  select * into v_activity
  from public.overtime_activities
  where id = p_activity_id
  for update;
  if not found or v_activity.deleted_at is not null then
    raise exception 'Overtime activity is not available';
  end if;
  if v_activity.type <> 'WORK' then
    raise exception 'Hanya Lembur Pekerjaan yang dapat dikoreksi';
  end if;
  if v_activity.status <> 'APPROVED' then
    raise exception 'Hanya pengajuan yang sudah disetujui yang dapat dikoreksi';
  end if;
  if p_expected_updated_at is null
    or v_activity.updated_at is distinct from p_expected_updated_at then
    raise exception 'Data sudah berubah. Muat ulang daftar lembur lalu buka kembali koreksinya.';
  end if;

  if v_activity.unit_id = v_activity.up3_id and not public.auth_is_super_admin() then
    raise exception 'Koreksi lembur kantor UP3 hanya dapat dilakukan oleh Super Admin' using errcode = '42501';
  end if;

  if not public.auth_is_super_admin()
    and not exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid()
        and cm.contract_role = 'ADMIN_UP3'
        and cm.contract_id = v_activity.contract_id
        and cm.operational_up3_id = v_activity.up3_id
        and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date
        and (cm.effective_to is null or current_date < cm.effective_to)
    ) then
    raise exception 'Hanya Super Admin atau Admin UP3 pada scope ini yang dapat mengoreksi data yang sudah disetujui' using errcode = '42501';
  end if;

  -- Seluruh peserta harus APPROVED (koreksi batch penuh).
  if (select count(*) from public.overtime_entries where activity_id = p_activity_id) <> v_count then
    raise exception 'Jumlah peserta tidak sesuai dengan data tersimpan';
  end if;
  if exists (
    select 1 from public.overtime_entries
    where activity_id = p_activity_id and approval_status <> 'APPROVED'
  ) then
    raise exception 'Koreksi ini hanya untuk pengajuan yang seluruh pesertanya sudah disetujui';
  end if;

  v_min_started := null;
  v_max_ended := null;
  for v_idx in 0..v_count - 1 loop
    v_part := p_participants -> v_idx;
    v_entry_id := nullif(btrim(v_part ->> 'entry_id'), '')::uuid;
    v_started := nullif(btrim(v_part ->> 'started_at'), '')::timestamptz;
    v_ended := nullif(btrim(v_part ->> 'ended_at'), '')::timestamptz;
    if v_entry_id is null or v_started is null or v_ended is null then
      raise exception 'Each participant requires entry, start, and end';
    end if;
    if v_ended <= v_started then
      raise exception 'Participant end must be after start';
    end if;
    if v_ended - v_started < interval '1 minute' then
      raise exception 'Participant duration must be at least one minute';
    end if;
    select * into v_row from public.overtime_entries
    where id = v_entry_id and activity_id = p_activity_id
    for update;
    if not found then
      raise exception 'Peserta tidak termasuk dalam pengajuan ini';
    end if;
    if (v_started at time zone 'Asia/Pontianak')::date <> p_overtime_date then
      raise exception 'Semua peserta harus mulai pada tanggal lembur yang dikoreksi';
    end if;
    if not public.overtime_employee_is_eligible_l2(
      v_row.employee_id, v_activity.contract_id, v_activity.up3_id, v_activity.unit_id,
      (v_started at time zone 'Asia/Pontianak')::date) then
      raise exception 'Pegawai tidak eligible pada tanggal koreksi: %', coalesce(v_row.employee_name_snapshot, v_row.employee_id::text);
    end if;
    if v_min_started is null or v_started < v_min_started then v_min_started := v_started; end if;
    if v_max_ended is null or v_ended > v_max_ended then v_max_ended := v_ended; end if;
  end loop;

  -- Perlebar envelope sementara agar trigger tidak menolak jam baru.
  select min(participant_started_at), max(participant_ended_at)
    into v_old_min, v_old_max
  from public.overtime_entries where activity_id = p_activity_id;
  update public.overtime_activities
  set started_at = least(v_old_min, v_min_started),
      ended_at = greatest(v_old_max, v_max_ended),
      updated_by = auth.uid()
  where id = p_activity_id;

  for v_idx in 0..v_count - 1 loop
    v_part := p_participants -> v_idx;
    v_entry_id := (v_part ->> 'entry_id')::uuid;
    v_started := (v_part ->> 'started_at')::timestamptz;
    v_ended := (v_part ->> 'ended_at')::timestamptz;
    select * into v_row from public.overtime_entries where id = v_entry_id;
    v_business_date := (v_started at time zone 'Asia/Pontianak')::date;
    if v_row.participant_started_at is not distinct from v_started
      and v_row.participant_ended_at is not distinct from v_ended then
      continue;
    end if;
    v_actual_minutes := extract(epoch from (v_ended - v_started)) / 60;
    v_duration := round(v_actual_minutes / 60, 4);
    v_multiplier := round(case when v_actual_minutes <= 60 then v_actual_minutes * 1.5 / 60 else 1.5 + ((v_actual_minutes - 60) * 2 / 60) end, 4);
    -- Tanggal sama: pertahankan tarif snapshot agar perubahan master rate
    -- tidak mengubah transaksi retroaktif. Tanggal berubah: pakai tarif
    -- efektif pada tanggal baru.
    if v_row.work_date is not distinct from v_business_date then
      v_new_rate := v_row.hourly_rate_snapshot;
    else
      select r.hourly_rate into v_new_rate
      from public.employee_hourly_rate_history r
      where r.employee_id = v_row.employee_id
        and r.effective_from <= v_business_date
        and (r.effective_to is null or v_business_date < r.effective_to)
      order by r.effective_from desc limit 1;
      if v_new_rate is null then
        raise exception 'Hourly rate not found for corrected date';
      end if;
    end if;
    v_hours := round(v_duration, 2);
    v_amount := round(v_new_rate * v_multiplier, 2);
    v_notes := 'Tanggal ' || v_row.work_date::text || '→' || v_business_date::text
      || '; jam ' || to_char(v_row.participant_started_at at time zone 'Asia/Pontianak', 'HH24:MI')
      || '–' || to_char(v_row.participant_ended_at at time zone 'Asia/Pontianak', 'HH24:MI')
      || '→' || to_char(v_started at time zone 'Asia/Pontianak', 'HH24:MI')
      || '–' || to_char(v_ended at time zone 'Asia/Pontianak', 'HH24:MI')
      || ' (' || v_row.hours::text || '→' || v_hours::text || ' jam)'
      || '; tarif Rp ' || trim(to_char(v_row.hourly_rate_snapshot, '999G999G999G990'))
      || '→Rp ' || trim(to_char(v_new_rate, '999G999G999G990'))
      || '; total Rp ' || trim(to_char(v_row.calculated_amount_snapshot, '999G999G999G990'))
      || '→Rp ' || trim(to_char(v_amount, '999G999G999G990')) || '.';
    update public.overtime_entries
    set work_date = v_business_date,
        period_month = date_trunc('month', v_started at time zone 'Asia/Pontianak')::date,
        hours = v_hours,
        participant_started_at = v_started,
        participant_ended_at = v_ended,
        duration_hours_snapshot = v_duration,
        multiplier_hours_snapshot = v_multiplier,
        hourly_rate_snapshot = v_new_rate,
        calculated_amount_snapshot = v_amount,
        updated_by = auth.uid()
    where id = v_entry_id;
    insert into public.overtime_activity_history(
      activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, notes
    ) values (
      p_activity_id, v_entry_id, 'CORRECTED', auth.uid(), 'APPROVED', 'APPROVED',
      v_reason, v_notes
    );
    v_changed := v_changed + 1;
  end loop;

  if v_changed = 0 then
    raise exception 'Tidak ada perubahan tanggal/jam.';
  end if;

  -- Ketatkan envelope ke hasil akhir; status harus tetap APPROVED.
  select min(participant_started_at), max(participant_ended_at)
    into v_min_started, v_max_ended
  from public.overtime_entries where activity_id = p_activity_id;
  update public.overtime_activities
  set started_at = v_min_started,
      ended_at = v_max_ended,
      updated_by = auth.uid()
  where id = p_activity_id;
  perform public.refresh_overtime_activity_review_status(p_activity_id);
  select * into v_activity from public.overtime_activities where id = p_activity_id;
  if v_activity.status <> 'APPROVED' then
    raise exception 'Koreksi dibatalkan: status agregat berubah.';
  end if;

  return p_activity_id;
end;
$function$;
