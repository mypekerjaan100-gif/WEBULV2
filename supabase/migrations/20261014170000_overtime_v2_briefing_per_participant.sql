-- Lembur Pekerjaan V2: Foto Briefing wajib per pegawai, evidence lain bersama.
-- Shared prepare V2 menolak FOTO_BRIEFING (harus scoped per entry) dan hanya
-- mengizinkan SPK/FOTO_PROSES/FOTO_SELESAI pada draft awal. Submit awal V2
-- memvalidasi briefing langsung ke baris scoped peserta (bukan fallback).
-- Revisi tetap memakai override scoped untuk semua tipe. Legacy tidak berubah.

create or replace function public.prepare_overtime_evidence_upload(p_activity_id uuid, p_evidence_type text, p_original_filename text, p_original_mime_type text, p_original_size_bytes bigint, p_stored_size_bytes bigint, p_stored_mime_type text, p_checksum text default null, p_sort_order integer default 0, p_supersedes_evidence_id uuid default null)
returns public.overtime_evidence
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_activity public.overtime_activities%rowtype;
  v_existing public.overtime_evidence%rowtype;
  v_result public.overtime_evidence%rowtype;
  v_evidence_id uuid := gen_random_uuid();
  v_extension text;
  v_revision integer := 1;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_activity
  from public.overtime_activities
  where id = p_activity_id
  for update;
  if not found or not public.auth_can_manage_overtime_activity_evidence(p_activity_id) then
    raise exception 'Overtime evidence scope/status is not manageable by this account'
      using errcode = '42501';
  end if;
  if v_activity.type = 'WORK'
    and coalesce(v_activity.evidence_mode, 'LEGACY_SHARED') = 'PARTICIPANT_V2' then
    if p_evidence_type = 'FOTO_BRIEFING' then
      raise exception 'Foto Briefing Pekerjaan model baru wajib diunggah per pegawai (entry_id).'
        using errcode = '22023';
    end if;
    if v_activity.status <> 'DRAFT' or coalesce(v_activity.submission_count, 0) <> 0 then
      raise exception 'Evidence bersama model baru hanya dapat diunggah pada draft awal. Revisi memakai evidence khusus peserta (entry_id).'
        using errcode = '22023';
    end if;
  end if;
  if btrim(coalesce(p_original_filename, '')) = '' then
    raise exception 'Original filename is required';
  end if;
  if p_original_size_bytes is null or p_original_size_bytes <= 0 then
    raise exception 'Original file size must be positive';
  end if;
  if p_stored_size_bytes is null or p_stored_size_bytes <= 0
     or p_stored_size_bytes > 1048576 then
    raise exception 'Processed evidence must not exceed 1 MB';
  end if;
  if p_sort_order is null or p_sort_order < 0 then
    raise exception 'Evidence sort order must be nonnegative';
  end if;
  if p_checksum is not null and p_checksum !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'Evidence checksum must be a SHA-256 hex value';
  end if;

  v_extension := case p_stored_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/webp' then 'webp'
    when 'application/pdf' then 'pdf'
    when 'application/msword' then 'doc'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
    else null
  end;
  if v_extension is null then
    raise exception 'Unsupported stored evidence MIME type';
  end if;
  if p_evidence_type in (
    'FOTO_SEBELUM', 'FOTO_SESUDAH', 'FOTO_BRIEFING',
    'FOTO_PROSES', 'FOTO_SELESAI'
  ) and p_stored_mime_type not in ('image/jpeg', 'image/webp') then
    raise exception 'Photo evidence must be JPEG or WebP';
  end if;

  if not (
    (v_activity.type = 'REPLACEMENT_LEAVE' and p_evidence_type = 'FORM_CUTI')
    or (v_activity.type = 'REPLACEMENT_SICK' and p_evidence_type in ('FORM_SAKIT', 'SURAT_SAKIT'))
    or (v_activity.type = 'REPLACEMENT_PERMISSION' and p_evidence_type in ('FORM_IZIN', 'SURAT_IZIN'))
    or (v_activity.type = 'WORK' and v_activity.work_category = 'ADMINISTRASI'
      and p_evidence_type in ('FOTO_SEBELUM', 'FOTO_SESUDAH'))
    or (v_activity.type = 'WORK' and v_activity.work_category in ('GARDU', 'JTM', 'JTR', 'ROW')
      and p_evidence_type in ('SPK', 'FOTO_BRIEFING', 'FOTO_PROSES', 'FOTO_SELESAI'))
  ) then
    raise exception 'Evidence type is not valid for this overtime activity';
  end if;

  if p_supersedes_evidence_id is not null then
    select * into v_existing
    from public.overtime_evidence
    where id = p_supersedes_evidence_id
      and activity_id = p_activity_id
      and entry_id is null
      and evidence_type = p_evidence_type
      and status = 'ACTIVE'
    for update;
    if not found then
      raise exception 'Active evidence to replace was not found in this activity/type';
    end if;
    if exists (
      select 1
      from public.overtime_evidence
      where activity_id = p_activity_id
        and entry_id is null
        and evidence_type = p_evidence_type
        and status in ('PENDING', 'DELETE_PENDING')
    ) then
      raise exception 'Another evidence operation is already pending for this slot';
    end if;
    v_revision := v_existing.revision_number + 1;
  elsif p_evidence_type <> 'FOTO_BRIEFING' and exists (
    select 1 from public.overtime_evidence
    where activity_id = p_activity_id
      and entry_id is null
      and evidence_type = p_evidence_type
      and status in ('PENDING', 'ACTIVE', 'DELETE_PENDING')
  ) then
    raise exception 'Evidence slot already exists; use replacement flow';
  end if;

  insert into public.overtime_evidence (
    id, activity_id, entry_id, evidence_type, file_name, storage_path, mime_type,
    file_size_bytes, checksum, uploader_user_id, status,
    supersedes_evidence_id, revision_number, original_filename,
    original_mime_type, original_size_bytes, stored_size_bytes,
    stored_mime_type, sort_order
  ) values (
    v_evidence_id,
    p_activity_id,
    null,
    p_evidence_type,
    btrim(p_original_filename),
    'pelayanan-teknik/' || v_activity.up3_id::text || '/' ||
      v_activity.unit_id::text || '/' || v_activity.id::text || '/' ||
      p_evidence_type || '/' || v_evidence_id::text || '.' || v_extension,
    p_stored_mime_type,
    p_stored_size_bytes,
    lower(p_checksum),
    auth.uid(),
    'PENDING',
    p_supersedes_evidence_id,
    v_revision,
    btrim(p_original_filename),
    coalesce(nullif(btrim(p_original_mime_type), ''), 'application/octet-stream'),
    p_original_size_bytes,
    p_stored_size_bytes,
    p_stored_mime_type,
    p_sort_order
  )   returning * into v_result;
  return v_result;
end;
$function$;

-- Submit awal WORK: V2 memvalidasi Foto Briefing langsung ke baris scoped
-- peserta (entry_id), bukan fallback bersama. Tipe lain tetap efektif.
create or replace function public.submit_overtime_work_l3(p_activity_id uuid)
returns uuid
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_submission_number integer;
  v_as_of timestamptz := clock_timestamp();
  v_effective_submission_days integer;
  v_entry record;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_activity
  from public.overtime_activities activity
  where activity.id = p_activity_id
    and activity.deleted_at is null
    and public.auth_can_mutate_overtime_work_l3(
      activity.contract_id,
      activity.up3_id,
      activity.unit_id
    )
  for update;
  if not found then
    raise exception 'Overtime activity is not available to this account'
      using errcode = '42501';
  end if;
  if v_activity.type <> 'WORK' then
    raise exception 'Only Lembur Pekerjaan can be submitted via this path';
  end if;
  if v_activity.status <> 'DRAFT' then
    raise exception 'Only DRAFT work overtime can be submitted';
  end if;
  if v_activity.work_category not in ('ADMINISTRASI', 'GARDU', 'JTM', 'JTR', 'ROW') then
    raise exception 'Work category is not valid';
  end if;
  if btrim(coalesce(v_activity.description, '')) = '' then
    raise exception 'Keterangan pekerjaan wajib diisi';
  end if;
  if v_activity.work_category <> 'ADMINISTRASI' then
    if btrim(coalesce(v_activity.work_title, '')) = '' then
      raise exception 'Uraian pekerjaan wajib diisi';
    end if;
    if btrim(coalesce(v_activity.work_location, '')) = '' then
      raise exception 'Lokasi pekerjaan wajib diisi';
    end if;
  end if;
  if v_as_of > public.resolve_overtime_initial_deadline(
    v_activity.contract_id,
    v_activity.up3_id,
    v_activity.overtime_date,
    v_as_of
  ) then
    select config.effective_submission_days
    into v_effective_submission_days
    from public.resolve_overtime_initial_deadline_config(
      v_activity.contract_id,
      v_activity.up3_id,
      v_as_of
    ) config;
    raise exception 'Batas pengajuan telah lewat. Batas efektif H+% untuk Lembur Pekerjaan.',
      v_effective_submission_days;
  end if;
  if (select count(*) from public.overtime_entries
      where activity_id = p_activity_id) = 0 then
    raise exception 'At least one participant is required';
  end if;
  if v_activity.work_category = 'ADMINISTRASI'
     and (select count(*) from public.overtime_entries
          where activity_id = p_activity_id) <> 1 then
    raise exception 'Administrasi requires exactly one participant';
  end if;
  if exists (
    select 1
    from public.overtime_evidence
    where activity_id = p_activity_id
      and status in ('PENDING', 'DELETE_PENDING')
  ) then
    raise exception 'Resolve pending evidence operations before submission';
  end if;

  if coalesce(v_activity.evidence_mode, 'LEGACY_SHARED') = 'PARTICIPANT_V2' then
    for v_entry in select id, employee_name_snapshot from public.overtime_entries
      where activity_id = p_activity_id order by participant_started_at loop
      if v_activity.work_category = 'ADMINISTRASI' then
        select count(*) into v_count from public.list_overtime_entry_effective_evidence(p_activity_id, v_entry.id) where evidence_type = 'FOTO_SEBELUM';
        if v_count <> 1 then raise exception 'Peserta %: FOTO_SEBELUM belum lengkap', coalesce(v_entry.employee_name_snapshot, v_entry.id::text); end if;
        select count(*) into v_count from public.list_overtime_entry_effective_evidence(p_activity_id, v_entry.id) where evidence_type = 'FOTO_SESUDAH';
        if v_count <> 1 then raise exception 'Peserta %: FOTO_SESUDAH belum lengkap', coalesce(v_entry.employee_name_snapshot, v_entry.id::text); end if;
      else
        select count(*) into v_count from public.list_overtime_entry_effective_evidence(p_activity_id, v_entry.id) where evidence_type = 'SPK';
        if v_count <> 1 then raise exception 'Peserta %: SPK belum lengkap', coalesce(v_entry.employee_name_snapshot, v_entry.id::text); end if;
        select count(*) into v_count from public.overtime_evidence where activity_id = p_activity_id and entry_id = v_entry.id and evidence_type = 'FOTO_BRIEFING' and status = 'ACTIVE';
        if v_count < 1 then raise exception 'Peserta %: Foto Briefing Pekerjaan wajib diunggah per pegawai', coalesce(v_entry.employee_name_snapshot, v_entry.id::text); end if;
        select count(*) into v_count from public.list_overtime_entry_effective_evidence(p_activity_id, v_entry.id) where evidence_type = 'FOTO_PROSES';
        if v_count <> 1 then raise exception 'Peserta %: Foto Proses Pekerjaan belum lengkap', coalesce(v_entry.employee_name_snapshot, v_entry.id::text); end if;
        select count(*) into v_count from public.list_overtime_entry_effective_evidence(p_activity_id, v_entry.id) where evidence_type = 'FOTO_SELESAI';
        if v_count <> 1 then raise exception 'Peserta %: Foto Selesai Pekerjaan belum lengkap', coalesce(v_entry.employee_name_snapshot, v_entry.id::text); end if;
      end if;
    end loop;
  elsif v_activity.work_category = 'ADMINISTRASI' then
    if (select count(*) from public.overtime_evidence
        where activity_id = p_activity_id
          and evidence_type = 'FOTO_SEBELUM'
          and status = 'ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_SEBELUM';
    end if;
    if (select count(*) from public.overtime_evidence
        where activity_id = p_activity_id
          and evidence_type = 'FOTO_SESUDAH'
          and status = 'ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_SESUDAH';
    end if;
    if exists (
      select 1
      from public.overtime_evidence
      where activity_id = p_activity_id
        and status = 'ACTIVE'
        and evidence_type not in ('FOTO_SEBELUM', 'FOTO_SESUDAH')
    ) then
      raise exception 'ACTIVE evidence contains a type not required by Administrasi';
    end if;
  else
    if (select count(*) from public.overtime_evidence
        where activity_id = p_activity_id
          and evidence_type = 'SPK'
          and status = 'ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: SPK';
    end if;
    if (select count(*) from public.overtime_evidence
        where activity_id = p_activity_id
          and evidence_type = 'FOTO_BRIEFING'
          and status = 'ACTIVE') < 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_BRIEFING';
    end if;
    if (select count(*) from public.overtime_evidence
        where activity_id = p_activity_id
          and evidence_type = 'FOTO_PROSES'
          and status = 'ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_PROSES';
    end if;
    if (select count(*) from public.overtime_evidence
        where activity_id = p_activity_id
          and evidence_type = 'FOTO_SELESAI'
          and status = 'ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_SELESAI';
    end if;
    if exists (
      select 1
      from public.overtime_evidence
      where activity_id = p_activity_id
        and status = 'ACTIVE'
        and evidence_type not in (
          'SPK', 'FOTO_BRIEFING', 'FOTO_PROSES', 'FOTO_SELESAI'
        )
    ) then
      raise exception 'ACTIVE evidence contains a type not required by this work category';
    end if;
  end if;

  v_submission_number := v_activity.submission_count + 1;
  update public.overtime_activities
  set status = 'SUBMITTED',
      submitted_at = clock_timestamp(),
      submitted_by = auth.uid(),
      submission_count = v_submission_number,
      current_submission_number = v_submission_number,
      updated_by = auth.uid()
  where id = p_activity_id;
  update public.overtime_entries
  set approval_status = 'SUBMITTED',
      updated_by = auth.uid()
  where activity_id = p_activity_id
    and approval_status in ('DRAFT', 'CORRECTION_REQUIRED');
  insert into public.overtime_activity_history (
    activity_id,
    event,
    actor_user_id,
    submission_number,
    previous_status,
    new_status
  ) values (
    p_activity_id,
    'SUBMITTED',
    auth.uid(),
    v_submission_number,
    'DRAFT',
    'SUBMITTED'
  );
  return p_activity_id;
end;
$$;
