-- Lembur Pekerjaan model evidence per peserta (PARTICIPANT_V2).
-- Aktivitas lama tetap LEGACY_SHARED (fallback shared, tanpa perubahan destruktif).
-- Pengganti Cuti/Sakit/Izin tidak berubah (satu peserta, shared).

alter table public.overtime_activities
  add column if not exists evidence_mode text not null default 'LEGACY_SHARED';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'oa_evidence_mode_check') then
    alter table public.overtime_activities
      add constraint oa_evidence_mode_check
      check (evidence_mode in ('LEGACY_SHARED', 'PARTICIPANT_V2'));
  end if;
end;
$$;

-- Tutup celah list history: wajib autentikasi + scope baca aktivitas.
create or replace function public.list_overtime_history_l5(p_activity_id uuid)
returns setof public.overtime_activity_history
language plpgsql
stable security definer
set search_path to public, pg_temp
as $function$
declare v_activity public.overtime_activities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_activity from public.overtime_activities where id = p_activity_id;
  if not found then raise exception 'Overtime activity not found'; end if;
  if v_activity.deleted_at is not null
    then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_read_overtime_evidence_scope(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Overtime history is not readable by this account' using errcode = '42501';
  end if;
  return query select * from public.overtime_activity_history h
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
  order by h.occurred_at;
end;
$function$;

-- Entry manage check: V2 memperbolehkan entry DRAFT (upload awal per peserta),
-- legacy tetap hanya CORRECTION_REQUIRED.
create or replace function public.auth_can_manage_overtime_entry_evidence(p_activity_id uuid, p_entry_id uuid)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $function$
  select exists (
    select 1
    from public.overtime_activities activity
    join public.overtime_entries entry
      on entry.id = p_entry_id
     and entry.activity_id = activity.id
     and entry.activity_id = p_activity_id
    where activity.id = p_activity_id
      and activity.deleted_at is null
      and (
        (
          activity.status = 'CORRECTION_REQUIRED'
          and entry.approval_status = 'CORRECTION_REQUIRED'
        )
        or (
          activity.type = 'WORK'
          and coalesce(activity.evidence_mode, 'LEGACY_SHARED') = 'PARTICIPANT_V2'
          and activity.status in ('DRAFT', 'CORRECTION_REQUIRED')
          and entry.approval_status in ('DRAFT', 'CORRECTION_REQUIRED')
        )
      )
      and (entry.revision_deadline_at is null or clock_timestamp() <= entry.revision_deadline_at)
      and (activity.revision_deadline_at is null or clock_timestamp() <= activity.revision_deadline_at)
      and public.auth_can_manage_overtime_evidence_scope(
        activity.contract_id,
        activity.up3_id,
        activity.unit_id
      )
  )
$function$;

comment on function public.auth_can_manage_overtime_entry_evidence(uuid, uuid)
  is 'Entry evidence manageable for CORRECTION_REQUIRED participant; V2 WORK also allows DRAFT entries for initial per-participant upload.';

-- Shared prepare menolak aktivitas WORK PARTICIPANT_V2: evidence wajib per peserta.
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
    raise exception 'Lembur Pekerjaan model baru wajib memakai evidence per peserta (entry_id).'
      using errcode = '22023';
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

-- Save WORK: aktivitas baru selalu PARTICIPANT_V2; V2 memakai update in-place
-- (entry ID permanen) agar evidence per peserta tidak hilang. Legacy tanpa
-- approval tetap memakai path delete/recreate lama.
create or replace function public.save_overtime_work_draft_l3(p_activity_id uuid, p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_work_category text, p_description text, p_work_title text, p_work_location text, p_participants jsonb)
returns uuid
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_activity public.overtime_activities%rowtype; v_activity_id uuid; v_business_date date; v_period_month date;
  v_min_started timestamptz; v_max_ended timestamptz; v_count int; v_idx int; v_part jsonb;
  v_employee_id uuid; v_started timestamptz; v_ended timestamptz; v_rate numeric(18,2);
  v_actual_minutes numeric; v_duration numeric; v_multiplier numeric; v_name text; v_seen uuid[];
  v_desc_trim text; v_title_trim text; v_location_trim text;
  v_carry_status text; v_carry_rejections int; v_carry_deadline timestamptz;
  v_has_approved boolean := false;
  v_existing_ids uuid[]; v_payload_ids uuid[];
  v_times timestamptz[]; v_ends timestamptz[];
  v_is_v2 boolean := false;
  v_row public.overtime_entries%rowtype; v_eid uuid; v_row_status text;
  v_row_started timestamptz; v_row_ended timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_work_category is null or p_work_category not in ('ADMINISTRASI','GARDU','JTM','JTR','ROW') then raise exception 'Work category must be ADMINISTRASI, GARDU, JTM, JTR, or ROW'; end if;
  v_desc_trim := btrim(coalesce(p_description, ''));
  if v_desc_trim = '' then raise exception 'Keterangan pekerjaan wajib diisi'; end if;
  v_title_trim := btrim(coalesce(p_work_title, '')); v_location_trim := btrim(coalesce(p_work_location, ''));
  if p_work_category = 'ADMINISTRASI' then
    if v_title_trim <> '' or v_location_trim <> '' then raise exception 'Administrasi tidak memerlukan uraian atau lokasi'; end if;
  else
    if v_title_trim = '' then raise exception 'Uraian pekerjaan wajib diisi'; end if;
    if v_location_trim = '' then raise exception 'Lokasi pekerjaan wajib diisi'; end if;
  end if;
  if p_participants is null or jsonb_typeof(p_participants) <> 'array' then raise exception 'Participants must be a JSON array'; end if;
  v_count := jsonb_array_length(p_participants);
  if v_count = 0 then raise exception 'At least one participant is required'; end if;
  if p_work_category = 'ADMINISTRASI' and v_count <> 1 then raise exception 'Administrasi requires exactly one participant'; end if;
  if p_activity_id is not null then
    select * into v_activity from public.overtime_activities a where a.id = p_activity_id and public.auth_can_mutate_overtime_work_l3(a.contract_id, a.up3_id, a.unit_id) for update;
    if not found then raise exception 'Overtime activity is not available to this account' using errcode = '42501'; end if;
    if v_activity.status not in ('DRAFT','CORRECTION_REQUIRED') then raise exception 'Only DRAFT or revision work overtime can be changed'; end if;
    if v_activity.status = 'CORRECTION_REQUIRED' and v_activity.revision_deadline_at is not null and clock_timestamp() > v_activity.revision_deadline_at then
      update public.overtime_activities set status = 'CLOSED', closure_reason = 'EXPIRED', closed_at = clock_timestamp(), closed_by = auth.uid(), updated_by = auth.uid() where id = p_activity_id;
      update public.overtime_entries set approval_status = 'CLOSED', revision_deadline_at = null, updated_by = auth.uid() where activity_id = p_activity_id and approval_status in ('DRAFT','SUBMITTED','CORRECTION_REQUIRED');
      insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason) values (p_activity_id, 'CLOSED', auth.uid(), v_activity.status, 'CLOSED', 'Revision deadline expired');
      raise exception 'Revision deadline has expired';
    end if;
    if v_activity.type <> 'WORK' then raise exception 'The requested activity is not Lembur Pekerjaan'; end if;
    if (v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) is distinct from (p_contract_id, p_up3_id, p_unit_id) then raise exception 'Overtime activity is not in the exact requested scope'; end if;
    select exists (select 1 from public.overtime_entries where activity_id = p_activity_id and approval_status = 'APPROVED') into v_has_approved;
    v_is_v2 := coalesce(v_activity.evidence_mode, 'LEGACY_SHARED') = 'PARTICIPANT_V2';
  else
    v_is_v2 := true;
  end if;
  if not public.auth_can_mutate_overtime_work_l3(p_contract_id, p_up3_id, p_unit_id) then raise exception 'Work overtime scope is not mutable by this account' using errcode = '42501'; end if;
  v_seen := array[]::uuid[]; v_min_started := null; v_max_ended := null;
  v_payload_ids := array[]::uuid[]; v_times := array[]::timestamptz[]; v_ends := array[]::timestamptz[];
  for v_idx in 0..v_count - 1 loop
    v_part := p_participants -> v_idx;
    v_employee_id := nullif(btrim(v_part ->> 'employee_id'), '')::uuid;
    v_started := nullif(btrim(v_part ->> 'started_at'), '')::timestamptz;
    v_ended := nullif(btrim(v_part ->> 'ended_at'), '')::timestamptz;
    if v_employee_id is null or v_started is null or v_ended is null then raise exception 'Each participant requires employee, start, and end'; end if;
    if v_ended <= v_started then raise exception 'Participant end must be after start'; end if;
    if v_ended - v_started < interval '1 minute' then raise exception 'Participant duration must be at least one minute'; end if;
    if v_employee_id = any(v_seen) then raise exception 'Duplicate participant employee in same activity'; end if;
    v_seen := array_append(v_seen, v_employee_id);
    v_payload_ids := array_append(v_payload_ids, v_employee_id);
    v_times := array_append(v_times, v_started);
    v_ends := array_append(v_ends, v_ended);
    if v_min_started is null or v_started < v_min_started then v_min_started := v_started; end if;
    if v_max_ended is null or v_ended > v_max_ended then v_max_ended := v_ended; end if;
  end loop;
  v_business_date := (v_min_started at time zone 'Asia/Pontianak')::date;
  v_period_month := date_trunc('month', v_min_started at time zone 'Asia/Pontianak')::date;
  for v_idx in 0..v_count - 1 loop
    v_part := p_participants -> v_idx;
    v_employee_id := (v_part ->> 'employee_id')::uuid;
    v_started := (v_part ->> 'started_at')::timestamptz;
    if (v_started at time zone 'Asia/Pontianak')::date <> v_business_date then raise exception 'All participants must start on the same business date'; end if;
    if not public.overtime_employee_is_eligible_l2(v_employee_id, p_contract_id, p_up3_id, p_unit_id, (v_started at time zone 'Asia/Pontianak')::date) then raise exception 'Participant employee is not eligible in exact scope/date'; end if;
  end loop;

  -- In-place update: entry ID permanen (wajib untuk V2 agar evidence per
  -- peserta tidak hilang; legacy hanya saat ada peserta APPROVED).
  if p_activity_id is not null and (v_has_approved or v_is_v2) then
    if v_has_approved then
      if v_activity.work_category is distinct from p_work_category
        or coalesce(v_activity.description,'') is distinct from v_desc_trim
        or coalesce(v_activity.work_title,'') is distinct from nullif(v_title_trim,'')
        or coalesce(v_activity.work_location,'') is distinct from nullif(v_location_trim,'') then
        raise exception 'Aktivitas memiliki peserta yang sudah disetujui sehingga data pekerjaan tidak dapat diubah. Hanya jam peserta revisi dan evidence yang dapat diperbaiki.' using errcode = '22023';
      end if;
      select array_agg(employee_id order by employee_id) into v_existing_ids from public.overtime_entries where activity_id = p_activity_id;
      if (select array_agg(x order by x) from unnest(v_payload_ids) x) is distinct from (select array_agg(x order by x) from unnest(v_existing_ids) x) then
        raise exception 'Peserta tidak boleh ditambah/dihapus setelah sebagian disetujui.' using errcode = '22023';
      end if;
    elsif v_is_v2 and v_activity.status = 'CORRECTION_REQUIRED' then
      select array_agg(employee_id order by employee_id) into v_existing_ids from public.overtime_entries where activity_id = p_activity_id;
      if (select array_agg(x order by x) from unnest(v_payload_ids) x) is distinct from (select array_agg(x order by x) from unnest(v_existing_ids) x) then
        raise exception 'Peserta tidak boleh ditambah/dihapus selama revisi. Selesaikan revisi peserta yang ditolak.' using errcode = '22023';
      end if;
    end if;
    -- Jam peserta APPROVED tidak boleh berubah; V2 juga mengunci SUBMITTED.
    for v_idx in 0..v_count - 1 loop
      v_employee_id := v_payload_ids[v_idx + 1]; v_started := v_times[v_idx + 1]; v_ended := v_ends[v_idx + 1];
      select approval_status, participant_started_at, participant_ended_at
        into v_row_status, v_row_started, v_row_ended
      from public.overtime_entries where activity_id = p_activity_id and employee_id = v_employee_id;
      if found and v_row_status = 'APPROVED'
        and (v_row_started is distinct from v_started or v_row_ended is distinct from v_ended) then
        raise exception 'Jam peserta yang sudah disetujui tidak dapat diubah.' using errcode = '22023';
      end if;
      if found and v_is_v2 and v_row_status = 'SUBMITTED'
        and (v_row_started is distinct from v_started or v_row_ended is distinct from v_ended) then
        raise exception 'Jam peserta yang sudah diajukan tidak dapat diubah selama revisi peserta lain.' using errcode = '22023';
      end if;
    end loop;
    update public.overtime_activities set started_at = v_min_started, ended_at = v_max_ended, updated_by = auth.uid() where id = p_activity_id returning id into v_activity_id;
    for v_idx in 0..v_count - 1 loop
      v_employee_id := v_payload_ids[v_idx + 1]; v_started := v_times[v_idx + 1]; v_ended := v_ends[v_idx + 1];
      v_business_date := (v_started at time zone 'Asia/Pontianak')::date;
      v_period_month := date_trunc('month', v_started at time zone 'Asia/Pontianak')::date;
      select upper(e.name) into v_name from public.employees e where e.id = v_employee_id;
      select r.hourly_rate into v_rate from public.employee_hourly_rate_history r where r.employee_id = v_employee_id and r.effective_from <= v_business_date and (r.effective_to is null or v_business_date < r.effective_to) order by r.effective_from desc limit 1;
      if v_rate is null then raise exception 'Hourly rate not found for participant start date'; end if;
      v_actual_minutes := extract(epoch from (v_ended - v_started)) / 60;
      v_duration := round(v_actual_minutes / 60, 4);
      v_multiplier := round(case when v_actual_minutes <= 60 then v_actual_minutes * 1.5 / 60 else 1.5 + ((v_actual_minutes - 60) * 2 / 60) end, 4);
      select id, approval_status into v_eid, v_row_status from public.overtime_entries where activity_id = p_activity_id and employee_id = v_employee_id;
      if found then
        -- V2 tidak pernah menghitung ulang snapshot finansial peserta APPROVED.
        if v_row_status = 'APPROVED' and not v_is_v2 then
          update public.overtime_entries set
            work_date = v_business_date, period_month = v_period_month, hours = round(v_duration, 2),
            description = v_desc_trim, employee_name_snapshot = v_name, hourly_rate_snapshot = v_rate,
            calculated_amount_snapshot = round(v_rate * v_multiplier, 2),
            participant_started_at = v_started, participant_ended_at = v_ended,
            duration_hours_snapshot = v_duration, multiplier_hours_snapshot = v_multiplier,
            updated_by = auth.uid()
          where id = v_eid;
        elsif v_row_status = 'APPROVED' then
          update public.overtime_entries set
            work_date = v_business_date, period_month = v_period_month, hours = round(v_duration, 2),
            description = v_desc_trim, employee_name_snapshot = v_name,
            participant_started_at = v_started, participant_ended_at = v_ended,
            duration_hours_snapshot = v_duration, multiplier_hours_snapshot = v_multiplier,
            updated_by = auth.uid()
          where id = v_eid;
        else
          update public.overtime_entries set
            work_date = v_business_date, period_month = v_period_month, hours = round(v_duration, 2),
            description = v_desc_trim, employee_name_snapshot = v_name, hourly_rate_snapshot = v_rate,
            calculated_amount_snapshot = round(v_rate * v_multiplier, 2),
            participant_started_at = v_started, participant_ended_at = v_ended,
            duration_hours_snapshot = v_duration, multiplier_hours_snapshot = v_multiplier,
            updated_by = auth.uid()
          where id = v_eid;
        end if;
      else
        if v_activity.status <> 'DRAFT' then
          raise exception 'Peserta baru hanya dapat ditambah pada draft awal.' using errcode = '22023';
        end if;
        insert into public.overtime_entries(activity_id, contract_id, up3_id, unit_id, employee_id, work_date, period_month, hours, description, employee_name_snapshot, hourly_rate_snapshot, calculated_amount_snapshot, participant_started_at, participant_ended_at, duration_hours_snapshot, multiplier_hours_snapshot, approval_status, rejection_count, revision_deadline_at, created_by, updated_by)
        values (v_activity_id, p_contract_id, p_up3_id, p_unit_id, v_employee_id, v_business_date, v_period_month, round(v_duration, 2), v_desc_trim, v_name, v_rate, round(v_rate * v_multiplier, 2), v_started, v_ended, v_duration, v_multiplier, 'DRAFT', 0, null, auth.uid(), auth.uid());
      end if;
    end loop;
    -- Hapus peserta yang dikeluarkan (V2 DRAFT saja, tanpa evidence).
    if v_is_v2 and not v_has_approved and v_activity.status = 'DRAFT' then
      for v_row in select * from public.overtime_entries where activity_id = p_activity_id and employee_id <> all(v_payload_ids) loop
        if exists (select 1 from public.overtime_evidence where entry_id = v_row.id and status <> 'DELETED') then
          raise exception 'Peserta memiliki evidence. Hapus evidence peserta tersebut dahulu sebelum mengeluarkan peserta.' using errcode = '22023';
        end if;
        delete from public.overtime_entries where id = v_row.id;
      end loop;
    end if;
    perform public.refresh_overtime_activity_review_status(v_activity_id);
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, notes)
    values (v_activity_id, 'RESUBMITTED', auth.uid(), v_activity.status, v_activity.status, 'Revision updated');
    return v_activity_id;
  end if;

  if p_activity_id is not null then
    create temp table tmp_overtime_entry_carry on commit drop as select employee_id, approval_status, rejection_count, revision_deadline_at from public.overtime_entries where activity_id = p_activity_id;
    perform 1 from public.overtime_entries where activity_id = p_activity_id for update;
    delete from public.overtime_entries where activity_id = p_activity_id;
  end if;
  if p_activity_id is null then
    insert into public.overtime_activities(contract_id, up3_id, unit_id, type, work_category, replaced_employee_id, description, work_title, work_location, started_at, ended_at, status, evidence_mode, created_by, updated_by)
    values (p_contract_id, p_up3_id, p_unit_id, 'WORK', p_work_category, null, v_desc_trim, nullif(v_title_trim, ''), nullif(v_location_trim, ''), v_min_started, v_max_ended, 'DRAFT', 'PARTICIPANT_V2', auth.uid(), auth.uid()) returning id into v_activity_id;
  else
    update public.overtime_activities set work_category = p_work_category, description = v_desc_trim, work_title = nullif(v_title_trim, ''), work_location = nullif(v_location_trim, ''), started_at = v_min_started, ended_at = v_max_ended, updated_by = auth.uid() where id = p_activity_id returning id into v_activity_id;
  end if;
  for v_idx in 0..v_count - 1 loop
    v_part := p_participants -> v_idx; v_employee_id := (v_part ->> 'employee_id')::uuid;
    v_started := (v_part ->> 'started_at')::timestamptz; v_ended := (v_part ->> 'ended_at')::timestamptz;
    v_business_date := (v_started at time zone 'Asia/Pontianak')::date; v_period_month := date_trunc('month', v_started at time zone 'Asia/Pontianak')::date;
    select upper(e.name) into v_name from public.employees e where e.id = v_employee_id;
    select r.hourly_rate into v_rate from public.employee_hourly_rate_history r where r.employee_id = v_employee_id and r.effective_from <= v_business_date and (r.effective_to is null or v_business_date < r.effective_to) order by r.effective_from desc limit 1;
    if v_rate is null then raise exception 'Hourly rate not found for participant start date'; end if;
    v_actual_minutes := extract(epoch from (v_ended - v_started)) / 60; v_duration := round(v_actual_minutes / 60, 4);
    v_multiplier := round(case when v_actual_minutes <= 60 then v_actual_minutes * 1.5 / 60 else 1.5 + ((v_actual_minutes - 60) * 2 / 60) end, 4);
    v_carry_status := 'DRAFT'; v_carry_rejections := 0; v_carry_deadline := null;
    if p_activity_id is not null then
      select c.approval_status, c.rejection_count, c.revision_deadline_at into v_carry_status, v_carry_rejections, v_carry_deadline from tmp_overtime_entry_carry c where c.employee_id = v_employee_id limit 1;
      if not found then v_carry_status := 'DRAFT'; v_carry_rejections := 0; v_carry_deadline := null; end if;
    end if;
    insert into public.overtime_entries(activity_id, contract_id, up3_id, unit_id, employee_id, work_date, period_month, hours, description, employee_name_snapshot, hourly_rate_snapshot, calculated_amount_snapshot, participant_started_at, participant_ended_at, duration_hours_snapshot, multiplier_hours_snapshot, approval_status, rejection_count, revision_deadline_at, created_by, updated_by)
    values (v_activity_id, p_contract_id, p_up3_id, p_unit_id, v_employee_id, v_business_date, v_period_month, round(v_duration, 2), v_desc_trim, v_name, v_rate, round(v_rate * v_multiplier, 2), v_started, v_ended, v_duration, v_multiplier, v_carry_status, v_carry_rejections, v_carry_deadline, auth.uid(), auth.uid());
  end loop;
  if p_activity_id is null then
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status) values (v_activity_id, 'CREATED', auth.uid(), null, 'DRAFT');
  elsif v_activity.status = 'CORRECTION_REQUIRED' then
    perform public.refresh_overtime_activity_review_status(v_activity_id);
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, notes) values (v_activity_id, 'RESUBMITTED', auth.uid(), v_activity.status, v_activity.status, 'Revision updated');
  end if;
  return v_activity_id;
end;
$function$;

-- Daftar peserta + mode evidence untuk UI per peserta.
create or replace function public.list_overtime_activity_entries(p_activity_id uuid)
returns table (
  entry_id uuid,
  employee_id uuid,
  employee_name text,
  approval_status text,
  started_at timestamptz,
  ended_at timestamptz,
  activity_evidence_mode text
)
language plpgsql
stable security definer
set search_path to public, pg_temp
as $function$
declare v_activity public.overtime_activities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_activity from public.overtime_activities where id = p_activity_id;
  if not found or v_activity.deleted_at is not null then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_read_overtime_evidence_scope(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Overtime activity is not readable by this account' using errcode = '42501';
  end if;
  return query select entry.id, entry.employee_id, entry.employee_name_snapshot,
    entry.approval_status, entry.participant_started_at, entry.participant_ended_at,
    coalesce(v_activity.evidence_mode, 'LEGACY_SHARED')
  from public.overtime_entries entry
  where entry.activity_id = p_activity_id
  order by entry.participant_started_at, entry.employee_name_snapshot;
end;
$function$;

-- Resubmit per peserta: pending check hanya untuk entry sendiri (V2),
-- legacy tetap memblokir bila ada operasi shared yang pending.
create or replace function public.resubmit_overtime_entry_l5(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_activity public.overtime_activities%rowtype; v_entry public.overtime_entries%rowtype;
  v_count int;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_entry from public.overtime_entries where id = p_entry_id for update;
  if not found then raise exception 'Overtime participant not found'; end if;
  select * into v_activity from public.overtime_activities where id = v_entry.activity_id for update;
  if not found then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_mutate_overtime_replacement_l2(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id)
     and not public.auth_can_mutate_overtime_work_l3(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to resubmit' using errcode = '42501';
  end if;
  if v_activity.status <> 'CORRECTION_REQUIRED' then raise exception 'Only revision can be resubmitted'; end if;
  if v_entry.approval_status <> 'CORRECTION_REQUIRED' then raise exception 'Only the rejected participant can be resubmitted'; end if;
  if v_entry.revision_deadline_at is not null and clock_timestamp() > v_entry.revision_deadline_at then
    perform public.refresh_overtime_activity_review_status(v_activity.id);
    raise exception 'Revision deadline has expired';
  end if;
  if v_activity.revision_deadline_at is not null and clock_timestamp() > v_activity.revision_deadline_at then
    perform public.refresh_overtime_activity_review_status(v_activity.id);
    raise exception 'Revision deadline has expired';
  end if;
  if exists (select 1 from public.overtime_evidence
    where activity_id = v_activity.id and status in ('PENDING','DELETE_PENDING')
      and (entry_id is null or entry_id = v_entry.id)) then
    raise exception 'Resolve pending evidence before resubmit';
  end if;

  -- Effective evidence validation for this participant.
  if v_activity.type = 'REPLACEMENT_LEAVE' then
    select count(*) into v_count from public.list_overtime_entry_effective_evidence(v_activity.id, v_entry.id) where evidence_type = 'FORM_CUTI';
    if v_count <> 1 then raise exception 'Required ACTIVE evidence missing: FORM_CUTI'; end if;
  elsif v_activity.type = 'REPLACEMENT_SICK' then
    select count(*) into v_count from public.list_overtime_entry_effective_evidence(v_activity.id, v_entry.id) where evidence_type = 'FORM_SAKIT';
    if v_count <> 1 then raise exception 'Missing FORM_SAKIT'; end if;
    select count(*) into v_count from public.list_overtime_entry_effective_evidence(v_activity.id, v_entry.id) where evidence_type = 'SURAT_SAKIT';
    if v_count <> 1 then raise exception 'Missing SURAT_SAKIT'; end if;
  elsif v_activity.type = 'REPLACEMENT_PERMISSION' then
    select count(*) into v_count from public.list_overtime_entry_effective_evidence(v_activity.id, v_entry.id) where evidence_type = 'FORM_IZIN';
    if v_count <> 1 then raise exception 'Missing FORM_IZIN'; end if;
    select count(*) into v_count from public.list_overtime_entry_effective_evidence(v_activity.id, v_entry.id) where evidence_type = 'SURAT_IZIN';
    if v_count <> 1 then raise exception 'Missing SURAT_IZIN'; end if;
  elsif v_activity.type = 'WORK' and v_activity.work_category = 'ADMINISTRASI' then
    select count(*) into v_count from public.list_overtime_entry_effective_evidence(v_activity.id, v_entry.id) where evidence_type = 'FOTO_SEBELUM';
    if v_count <> 1 then raise exception 'Missing FOTO_SEBELUM'; end if;
    select count(*) into v_count from public.list_overtime_entry_effective_evidence(v_activity.id, v_entry.id) where evidence_type = 'FOTO_SESUDAH';
    if v_count <> 1 then raise exception 'Missing FOTO_SESUDAH'; end if;
  elsif v_activity.type = 'WORK' then
    select count(*) into v_count from public.list_overtime_entry_effective_evidence(v_activity.id, v_entry.id) where evidence_type = 'SPK';
    if v_count <> 1 then raise exception 'Missing SPK'; end if;
    select count(*) into v_count from public.list_overtime_entry_effective_evidence(v_activity.id, v_entry.id) where evidence_type = 'FOTO_BRIEFING';
    if v_count < 1 then raise exception 'Missing FOTO_BRIEFING'; end if;
    select count(*) into v_count from public.list_overtime_entry_effective_evidence(v_activity.id, v_entry.id) where evidence_type = 'FOTO_PROSES';
    if v_count <> 1 then raise exception 'Missing FOTO_PROSES'; end if;
    select count(*) into v_count from public.list_overtime_entry_effective_evidence(v_activity.id, v_entry.id) where evidence_type = 'FOTO_SELESAI';
    if v_count <> 1 then raise exception 'Missing FOTO_SELESAI'; end if;
  end if;

  update public.overtime_entries set approval_status = 'SUBMITTED', revision_deadline_at = null, updated_by = auth.uid()
  where id = v_entry.id;
  perform public.refresh_overtime_activity_review_status(v_activity.id);
  insert into public.overtime_activity_history(activity_id, entry_id, event, actor_user_id, previous_status, new_status, notes)
  values (v_activity.id, v_entry.id, 'RESUBMITTED', auth.uid(), 'CORRECTION_REQUIRED', 'SUBMITTED', 'Peserta: ' || v_entry.employee_name_snapshot);
  return v_entry.id;
end;
$function$;

-- Activity-level resubmit ditolak untuk WORK V2 multi-peserta revisi:
-- gunakan resubmit per peserta agar peserta lain tidak ikut berubah.
create or replace function public.resubmit_overtime_l5(p_activity_id uuid)
returns uuid
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_activity public.overtime_activities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_activity from public.overtime_activities where id=p_activity_id for update;
  if not found then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_mutate_overtime_replacement_l2(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id)
     and not public.auth_can_mutate_overtime_work_l3(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to resubmit' using errcode = '42501';
  end if;
  if v_activity.status <> 'CORRECTION_REQUIRED' then raise exception 'Only revision can be resubmitted'; end if;
  if v_activity.type = 'WORK'
    and coalesce(v_activity.evidence_mode, 'LEGACY_SHARED') = 'PARTICIPANT_V2'
    and (select count(*) from public.overtime_entries
      where activity_id = p_activity_id and approval_status = 'CORRECTION_REQUIRED') >= 1
    and (select count(*) from public.overtime_entries where activity_id = p_activity_id) > 1 then
    raise exception 'Gunakan resubmit per peserta untuk Lembur Pekerjaan multi-peserta.';
  end if;
  if v_activity.revision_deadline_at is not null and clock_timestamp() > v_activity.revision_deadline_at then
    update public.overtime_activities set status='CLOSED', closure_reason='EXPIRED', closed_at=clock_timestamp(), closed_by=auth.uid(), updated_by=auth.uid() where id=p_activity_id;
    update public.overtime_entries set approval_status='CLOSED', revision_deadline_at=null, updated_by=auth.uid()
    where activity_id=p_activity_id and approval_status in ('DRAFT', 'SUBMITTED', 'CORRECTION_REQUIRED');
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason) values (p_activity_id,'CLOSED',auth.uid(),v_activity.status,'CLOSED','Revision deadline expired');
    raise exception 'Revision deadline has expired';
  end if;
  if v_activity.type in ('REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION') and (select count(*) from public.overtime_entries where activity_id=p_activity_id) <>1 then raise exception 'Replacement must have exactly one participant'; end if;
  if v_activity.type not in ('REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION') and (select count(*) from public.overtime_entries where activity_id=p_activity_id)=0 then raise exception 'At least one participant required'; end if;
  if exists (select 1 from public.overtime_evidence where activity_id=p_activity_id and status in ('PENDING','DELETE_PENDING')) then raise exception 'Resolve pending evidence before resubmit'; end if;
  if v_activity.type='REPLACEMENT_LEAVE' then
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FORM_CUTI' and status='ACTIVE')<>1 then raise exception 'Required ACTIVE evidence missing: FORM_CUTI'; end if;
  elsif v_activity.type='REPLACEMENT_SICK' then
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FORM_SAKIT' and status='ACTIVE')<>1 then raise exception 'Missing FORM_SAKIT'; end if;
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='SURAT_SAKIT' and status='ACTIVE')<>1 then raise exception 'Missing SURAT_SAKIT'; end if;
  elsif v_activity.type='REPLACEMENT_PERMISSION' then
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FORM_IZIN' and status='ACTIVE')<>1 then raise exception 'Missing FORM_IZIN'; end if;
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='SURAT_IZIN' and status='ACTIVE')<>1 then raise exception 'Missing SURAT_IZIN'; end if;
  elsif v_activity.type='WORK' and v_activity.work_category='ADMINISTRASI' then
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_SEBELUM' and status='ACTIVE')<>1 then raise exception 'Missing FOTO_SEBELUM'; end if;
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_SESUDAH' and status='ACTIVE')<>1 then raise exception 'Missing FOTO_SESUDAH'; end if;
  elsif v_activity.type='WORK' then
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='SPK' and status='ACTIVE')<>1 then raise exception 'Missing SPK'; end if;
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_BRIEFING' and status='ACTIVE')<1 then raise exception 'Missing FOTO_BRIEFING'; end if;
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_PROSES' and status='ACTIVE')<>1 then raise exception 'Missing FOTO_PROSES'; end if;
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_SELESAI' and status='ACTIVE')<>1 then raise exception 'Missing FOTO_SELESAI'; end if;
  end if;
  update public.overtime_activities set status='SUBMITTED', submission_count = submission_count+1, current_submission_number = current_submission_number+1, last_resubmitted_at=clock_timestamp(), last_resubmitted_by=auth.uid(), updated_by=auth.uid(), revision_deadline_at=null where id=p_activity_id;
  update public.overtime_entries set approval_status='SUBMITTED', revision_deadline_at=null, updated_by=auth.uid()
  where activity_id=p_activity_id and approval_status in ('DRAFT', 'CORRECTION_REQUIRED');
  insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, submission_number) values (p_activity_id,'RESUBMITTED',auth.uid(),v_activity.status,'SUBMITTED', v_activity.submission_count+1);
  return p_activity_id;
end;
$$;

-- Submit awal WORK: V2 memvalidasi evidence efektif per peserta.
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
        select count(*) into v_count from public.list_overtime_entry_effective_evidence(p_activity_id, v_entry.id) where evidence_type = 'FOTO_BRIEFING';
        if v_count < 1 then raise exception 'Peserta %: Foto Briefing Pekerjaan belum lengkap', coalesce(v_entry.employee_name_snapshot, v_entry.id::text); end if;
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

-- List WORK + evidence_mode agar UI tahu LEGACY_SHARED vs PARTICIPANT_V2.
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
  evidence_mode text
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
    coalesce(activity.evidence_mode, 'LEGACY_SHARED')
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

-- Versi ringan untuk polling sinkron lintas role (tanpa memuat seluruh baris).
create or replace function public.get_overtime_sync_version(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid default null, p_period_month date default null)
returns table (version timestamptz, activity_count bigint, submitted_count bigint)
language plpgsql
stable security definer
set search_path to public, pg_temp
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return query
  with scoped as (
    select activity.id, activity.status, activity.updated_at
    from public.overtime_activities activity
    where activity.contract_id = p_contract_id
      and activity.up3_id = p_up3_id
      and activity.deleted_at is null
      and (p_unit_id is null or activity.unit_id = p_unit_id)
      and (p_period_month is null or activity.period_month = p_period_month)
      and public.auth_can_read_overtime_evidence_scope(activity.contract_id, activity.up3_id, activity.unit_id)
  )
  select max(greatest(
      (select max(e.updated_at) from public.overtime_entries e where e.activity_id = scoped.id),
      (select max(v.updated_at) from public.overtime_evidence v where v.activity_id = scoped.id),
      scoped.updated_at
    )),
    count(*),
    count(*) filter (where scoped.status = 'SUBMITTED' or scoped.status = 'CORRECTION_REQUIRED')
  from scoped;
end;
$function$;

revoke all on function public.list_overtime_history_l5(uuid) from public, anon, authenticated;
grant execute on function public.list_overtime_history_l5(uuid) to authenticated;
revoke all on function public.list_overtime_activity_entries(uuid) from public, anon, authenticated;
grant execute on function public.list_overtime_activity_entries(uuid) to authenticated;
revoke all on function public.resubmit_overtime_entry_l5(uuid) from public, anon, authenticated;
grant execute on function public.resubmit_overtime_entry_l5(uuid) to authenticated;
revoke all on function public.resubmit_overtime_l5(uuid) from public, anon, authenticated;
grant execute on function public.resubmit_overtime_l5(uuid) to authenticated;
revoke all on function public.submit_overtime_work_l3(uuid) from public, anon, authenticated;
grant execute on function public.submit_overtime_work_l3(uuid) to authenticated;
revoke all on function public.list_overtime_work_l3(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.list_overtime_work_l3(uuid, uuid, uuid, date) to authenticated;
revoke all on function public.get_overtime_sync_version(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.get_overtime_sync_version(uuid, uuid, uuid, date) to authenticated;
