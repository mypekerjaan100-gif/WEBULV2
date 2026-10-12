-- Participant-scoped evidence overrides for mixed APPROVED + CORRECTION_REQUIRED.
-- Existing rows stay shared (entry_id IS NULL). A rejected participant can
-- create entry-scoped replacements without changing evidence shown to
-- already-approved participants. Effective evidence per participant is:
-- scoped ACTIVE rows when present, otherwise shared ACTIVE rows.

alter table public.overtime_evidence
  add column if not exists entry_id uuid;

create unique index if not exists uq_overtime_entries_id_activity
  on public.overtime_entries (id, activity_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_overtime_evidence_entry_activity'
  ) then
    alter table public.overtime_evidence
      add constraint fk_overtime_evidence_entry_activity
      foreign key (entry_id, activity_id)
      references public.overtime_entries (id, activity_id)
      on delete cascade;
  end if;
end;
$$;

create index if not exists idx_overtime_evidence_entry
  on public.overtime_evidence (entry_id)
  where entry_id is not null;

drop index if exists public.uq_overtime_evidence_single_active_slot;

create unique index if not exists uq_overtime_evidence_shared_single_active
  on public.overtime_evidence (activity_id, evidence_type)
  where status = 'ACTIVE' and entry_id is null and evidence_type <> 'FOTO_BRIEFING';

create unique index if not exists uq_overtime_evidence_scoped_single_active
  on public.overtime_evidence (activity_id, entry_id, evidence_type)
  where status = 'ACTIVE' and entry_id is not null and evidence_type <> 'FOTO_BRIEFING';

-- Entry-scoped manage check: only a CORRECTION_REQUIRED participant within
-- deadline and exact mutation scope may manage its own override evidence.
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
      and activity.status = 'CORRECTION_REQUIRED'
      and entry.approval_status = 'CORRECTION_REQUIRED'
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
  is 'Entry evidence is manageable only for a CORRECTION_REQUIRED participant within revision deadline and exact ULP scope.';

-- Shared prepare: restrict slot checks to shared rows only.
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
  ) returning * into v_result;
  return v_result;
end;
$function$;

-- Scoped prepare: first override keeps shared ACTIVE (supersedes must be null
-- or a scoped row for the same entry); later scoped replacements supersede
-- the previous scoped row only.
create or replace function public.prepare_overtime_entry_evidence_upload(p_activity_id uuid, p_entry_id uuid, p_evidence_type text, p_original_filename text, p_original_mime_type text, p_original_size_bytes bigint, p_stored_size_bytes bigint, p_stored_mime_type text, p_checksum text default null, p_sort_order integer default 0, p_supersedes_evidence_id uuid default null)
returns public.overtime_evidence
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_activity public.overtime_activities%rowtype;
  v_entry public.overtime_entries%rowtype;
  v_existing public.overtime_evidence%rowtype;
  v_result public.overtime_evidence%rowtype;
  v_evidence_id uuid := gen_random_uuid();
  v_extension text;
  v_revision integer := 1;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_entry_id is null then
    raise exception 'Participant evidence target is required' using errcode = '22023';
  end if;
  select * into v_activity from public.overtime_activities where id = p_activity_id for update;
  if not found then
    raise exception 'Overtime activity not found';
  end if;
  select * into v_entry from public.overtime_entries where id = p_entry_id and activity_id = p_activity_id for update;
  if not found then
    raise exception 'Participant is not part of this activity' using errcode = '22023';
  end if;
  if not public.auth_can_manage_overtime_entry_evidence(p_activity_id, p_entry_id) then
    raise exception 'Evidence peserta ini tidak dapat diubah oleh akun ini. Hanya peserta CORRECTION_REQUIRED dalam batas revisi dan scope ULP yang sama.'
      using errcode = '42501';
  end if;
  if btrim(coalesce(p_original_filename, '')) = '' then
    raise exception 'Original filename is required';
  end if;
  if p_original_size_bytes is null or p_original_size_bytes <= 0 then
    raise exception 'Original file size must be positive';
  end if;
  if p_stored_size_bytes is null or p_stored_size_bytes <= 0 or p_stored_size_bytes > 1048576 then
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
  if p_evidence_type in ('FOTO_SEBELUM','FOTO_SESUDAH','FOTO_BRIEFING','FOTO_PROSES','FOTO_SELESAI')
    and p_stored_mime_type not in ('image/jpeg','image/webp') then
    raise exception 'Photo evidence must be JPEG or WebP';
  end if;
  if not (
    (v_activity.type = 'REPLACEMENT_LEAVE' and p_evidence_type = 'FORM_CUTI')
    or (v_activity.type = 'REPLACEMENT_SICK' and p_evidence_type in ('FORM_SAKIT','SURAT_SAKIT'))
    or (v_activity.type = 'REPLACEMENT_PERMISSION' and p_evidence_type in ('FORM_IZIN','SURAT_IZIN'))
    or (v_activity.type = 'WORK' and v_activity.work_category = 'ADMINISTRASI' and p_evidence_type in ('FOTO_SEBELUM','FOTO_SESUDAH'))
    or (v_activity.type = 'WORK' and v_activity.work_category in ('GARDU','JTM','JTR','ROW') and p_evidence_type in ('SPK','FOTO_BRIEFING','FOTO_PROSES','FOTO_SELESAI'))
  ) then
    raise exception 'Evidence type is not valid for this overtime activity';
  end if;

  if p_supersedes_evidence_id is not null then
    select * into v_existing from public.overtime_evidence
    where id = p_supersedes_evidence_id
      and activity_id = p_activity_id
      and entry_id = p_entry_id
      and evidence_type = p_evidence_type
      and status = 'ACTIVE'
    for update;
    if not found then
      raise exception 'Active participant evidence to replace was not found';
    end if;
    if exists (
      select 1 from public.overtime_evidence
      where activity_id = p_activity_id
        and entry_id = p_entry_id
        and evidence_type = p_evidence_type
        and status in ('PENDING','DELETE_PENDING')
    ) then
      raise exception 'Another evidence operation is already pending for this participant slot';
    end if;
    v_revision := v_existing.revision_number + 1;
  elsif p_evidence_type <> 'FOTO_BRIEFING' and exists (
    select 1 from public.overtime_evidence
    where activity_id = p_activity_id
      and entry_id = p_entry_id
      and evidence_type = p_evidence_type
      and status in ('PENDING','ACTIVE','DELETE_PENDING')
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
    v_evidence_id, p_activity_id, p_entry_id, p_evidence_type,
    btrim(p_original_filename),
    'pelayanan-teknik/' || v_activity.up3_id::text || '/' || v_activity.unit_id::text || '/' || v_activity.id::text || '/' || p_evidence_type || '/' || v_evidence_id::text || '.' || v_extension,
    p_stored_mime_type, p_stored_size_bytes, lower(p_checksum), auth.uid(), 'PENDING',
    p_supersedes_evidence_id, v_revision, btrim(p_original_filename),
    coalesce(nullif(btrim(p_original_mime_type),''),'application/octet-stream'),
    p_original_size_bytes, p_stored_size_bytes, p_stored_mime_type, p_sort_order
  ) returning * into v_result;
  return v_result;
end;
$function$;

-- Lifecycle RPCs now branch on entry scope.
create or replace function public.finalize_overtime_evidence_upload(p_evidence_id uuid)
returns public.overtime_evidence
language plpgsql
security definer
set search_path to public, storage, pg_temp
as $function$
declare
  v_evidence public.overtime_evidence%rowtype;
  v_result public.overtime_evidence%rowtype;
  v_size bigint;
  v_mime text;
  v_can boolean;
begin
  select * into v_evidence from public.overtime_evidence where id = p_evidence_id and status in ('PENDING','ACTIVE') for update;
  if not found then
    raise exception 'Pending evidence is not finalizable by this account' using errcode = '42501';
  end if;
  if v_evidence.entry_id is null then
    v_can := public.auth_can_manage_overtime_activity_evidence(v_evidence.activity_id);
  else
    v_can := public.auth_can_manage_overtime_entry_evidence(v_evidence.activity_id, v_evidence.entry_id);
  end if;
  if not v_can then
    raise exception 'Pending evidence is not finalizable by this account' using errcode = '42501';
  end if;
  if v_evidence.status = 'ACTIVE' then return v_evidence; end if;
  select (object.metadata ->> 'size')::bigint, coalesce(object.metadata ->> 'mimetype', v_evidence.stored_mime_type)
    into v_size, v_mime from storage.objects object
  where object.bucket_id = 'overtime-evidence' and object.name = v_evidence.storage_path;
  if not found then raise exception 'Uploaded Storage object was not found'; end if;
  if v_size is null or v_size <= 0 or v_size > 1048576 then raise exception 'Stored evidence exceeds the 1 MB hard limit'; end if;
  if v_mime is distinct from v_evidence.stored_mime_type then raise exception 'Stored evidence MIME type does not match prepared metadata'; end if;
  if v_evidence.supersedes_evidence_id is not null then
    update public.overtime_evidence set status = 'SUPERSEDED'
    where id = v_evidence.supersedes_evidence_id and status = 'ACTIVE'
      and ((v_evidence.entry_id is null and entry_id is null) or (entry_id = v_evidence.entry_id));
  end if;
  update public.overtime_evidence set status = 'ACTIVE', stored_size_bytes = v_size,
    file_size_bytes = v_size, stored_mime_type = v_mime, mime_type = v_mime, uploaded_at = now()
  where id = p_evidence_id returning * into v_result;
  return v_result;
end;
$function$;

create or replace function public.cancel_overtime_evidence_upload(p_evidence_id uuid)
returns void
language plpgsql
security definer
set search_path to public, storage, pg_temp
as $function$
declare v_evidence public.overtime_evidence%rowtype; v_can boolean;
begin
  select * into v_evidence from public.overtime_evidence where id = p_evidence_id and status = 'PENDING' for update;
  if not found then raise exception 'Pending evidence is not cancellable by this account' using errcode = '42501'; end if;
  if v_evidence.entry_id is null then v_can := public.auth_can_manage_overtime_activity_evidence(v_evidence.activity_id);
  else v_can := public.auth_can_manage_overtime_entry_evidence(v_evidence.activity_id, v_evidence.entry_id); end if;
  if not v_can then raise exception 'Pending evidence is not cancellable by this account' using errcode = '42501'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'overtime-evidence' and name = v_evidence.storage_path) then
    raise exception 'Remove the Storage object before cancelling metadata';
  end if;
  delete from public.overtime_evidence where id = p_evidence_id;
end;
$function$;

create or replace function public.begin_overtime_evidence_delete(p_evidence_id uuid)
returns text
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_evidence public.overtime_evidence%rowtype; v_activity_id uuid; v_can boolean;
begin
  select activity_id into v_activity_id from public.overtime_evidence where id = p_evidence_id and status in ('ACTIVE','DELETE_PENDING');
  if not found then raise exception 'Evidence is not deletable by this account' using errcode = '42501'; end if;
  perform 1 from public.overtime_activities where id = v_activity_id for update;
  select * into v_evidence from public.overtime_evidence where id = p_evidence_id and status in ('ACTIVE','DELETE_PENDING') for update;
  if not found then raise exception 'Evidence is not deletable by this account' using errcode = '42501'; end if;
  -- Shared fallback evidence for an approved participant must never be deleted.
  if v_evidence.entry_id is null and exists (
    select 1 from public.overtime_entries entry
    where entry.activity_id = v_evidence.activity_id and entry.approval_status = 'APPROVED'
  ) then
    raise exception 'Evidence bersama tidak dapat dihapus karena sebagian peserta sudah disetujui. Ganti dengan evidence khusus peserta revisi.' using errcode = '22023';
  end if;
  if v_evidence.entry_id is null then v_can := public.auth_can_manage_overtime_activity_evidence(v_evidence.activity_id);
  else v_can := public.auth_can_manage_overtime_entry_evidence(v_evidence.activity_id, v_evidence.entry_id); end if;
  if not v_can then raise exception 'Evidence is not deletable by this account' using errcode = '42501'; end if;
  if v_evidence.status = 'ACTIVE' then update public.overtime_evidence set status = 'DELETE_PENDING' where id = p_evidence_id; end if;
  return v_evidence.storage_path;
end;
$function$;

create or replace function public.cancel_overtime_evidence_delete(p_evidence_id uuid)
returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_row public.overtime_evidence%rowtype;
begin
  select * into v_row from public.overtime_evidence where id = p_evidence_id and status = 'DELETE_PENDING';
  if not found then raise exception 'Evidence deletion is not cancellable by this account' using errcode = '42501'; end if;
  if v_row.entry_id is null then
    if not public.auth_can_manage_overtime_activity_evidence(v_row.activity_id) then
      raise exception 'Evidence deletion is not cancellable by this account' using errcode = '42501';
    end if;
  else
    if not public.auth_can_manage_overtime_entry_evidence(v_row.activity_id, v_row.entry_id) then
      raise exception 'Evidence deletion is not cancellable by this account' using errcode = '42501';
    end if;
  end if;
  update public.overtime_evidence set status = 'ACTIVE' where id = p_evidence_id;
end;
$function$;

create or replace function public.finalize_overtime_evidence_delete(p_evidence_id uuid)
returns void
language plpgsql
security definer
set search_path to public, storage, pg_temp
as $function$
declare v_evidence public.overtime_evidence%rowtype; v_can boolean;
begin
  select * into v_evidence from public.overtime_evidence where id = p_evidence_id and status in ('DELETE_PENDING','DELETED') for update;
  if not found then raise exception 'Evidence deletion is not finalizable by this account' using errcode = '42501'; end if;
  if v_evidence.entry_id is null then v_can := public.auth_can_manage_overtime_activity_evidence(v_evidence.activity_id);
  else v_can := public.auth_can_manage_overtime_entry_evidence(v_evidence.activity_id, v_evidence.entry_id); end if;
  if not v_can then raise exception 'Evidence deletion is not finalizable by this account' using errcode = '42501'; end if;
  if v_evidence.status = 'DELETED' then return; end if;
  if exists (select 1 from storage.objects where bucket_id = 'overtime-evidence' and name = v_evidence.storage_path) then
    raise exception 'Storage object still exists';
  end if;
  update public.overtime_evidence set status = 'DELETED' where id = p_evidence_id;
end;
$function$;

create or replace function public.get_overtime_evidence_lifecycle(p_evidence_id uuid)
returns public.overtime_evidence
language plpgsql
stable security definer
set search_path to public, pg_temp
as $function$
declare v_evidence public.overtime_evidence%rowtype;
begin
  select * into v_evidence from public.overtime_evidence where id = p_evidence_id;
  if not found then raise exception 'Evidence lifecycle is not manageable by this account' using errcode = '42501'; end if;
  if v_evidence.entry_id is null then
    if not public.auth_can_manage_overtime_activity_evidence(v_evidence.activity_id) then
      raise exception 'Evidence lifecycle is not manageable by this account' using errcode = '42501';
    end if;
  else
    if not public.auth_can_manage_overtime_entry_evidence(v_evidence.activity_id, v_evidence.entry_id) then
      raise exception 'Evidence lifecycle is not manageable by this account' using errcode = '42501';
    end if;
  end if;
  return v_evidence;
end;
$function$;

create or replace function public.auth_can_upload_overtime_evidence_object(p_storage_path text)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $$
  select exists (
    select 1 from public.overtime_evidence evidence
    where evidence.storage_path = p_storage_path
      and evidence.status = 'PENDING'
      and evidence.uploader_user_id = auth.uid()
      and (
        (evidence.entry_id is null and public.auth_can_manage_overtime_activity_evidence(evidence.activity_id))
        or (evidence.entry_id is not null and public.auth_can_manage_overtime_entry_evidence(evidence.activity_id, evidence.entry_id))
      )
  )
$$;

create or replace function public.auth_can_delete_overtime_evidence_object(p_storage_path text)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $$
  select exists (
    select 1 from public.overtime_evidence evidence
    where evidence.storage_path = p_storage_path
      and evidence.status in ('PENDING', 'DELETE_PENDING')
      and (
        (evidence.entry_id is null and public.auth_can_manage_overtime_activity_evidence(evidence.activity_id))
        or (evidence.entry_id is not null and public.auth_can_manage_overtime_entry_evidence(evidence.activity_id, evidence.entry_id))
      )
  )
$$;

-- Effective evidence per participant: scoped ACTIVE rows override shared.
create or replace function public.list_overtime_entry_effective_evidence(p_activity_id uuid, p_entry_id uuid, p_include_history boolean default false)
returns setof public.overtime_evidence
language plpgsql
stable security definer
set search_path to public, pg_temp
as $function$
declare v_activity public.overtime_activities%rowtype;
begin
  select * into v_activity from public.overtime_activities where id = p_activity_id;
  if not found or not public.auth_can_read_overtime_evidence_scope(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Overtime evidence is not readable by this account' using errcode = '42501';
  end if;
  if p_entry_id is not null and not exists (
    select 1 from public.overtime_entries where id = p_entry_id and activity_id = p_activity_id
  ) then
    raise exception 'Participant is not part of this activity' using errcode = '22023';
  end if;
  if p_include_history then
    return query select evidence.* from public.overtime_evidence evidence
    where evidence.activity_id = p_activity_id
      and (evidence.entry_id is null or evidence.entry_id = p_entry_id)
      and evidence.status in ('PENDING','ACTIVE','SUPERSEDED','DELETE_PENDING','DELETED')
    order by evidence.evidence_type, evidence.sort_order, evidence.uploaded_at;
    return;
  end if;
  if p_entry_id is null then
    return query select evidence.* from public.overtime_evidence evidence
    where evidence.activity_id = p_activity_id and evidence.entry_id is null and evidence.status = 'ACTIVE'
    order by evidence.evidence_type, evidence.sort_order, evidence.uploaded_at;
    return;
  end if;
  return query select evidence.* from public.overtime_evidence evidence
  where evidence.activity_id = p_activity_id
    and evidence.status = 'ACTIVE'
    and (
      evidence.entry_id = p_entry_id
      or (
        evidence.entry_id is null
        and not exists (
          select 1 from public.overtime_evidence scoped
          where scoped.activity_id = p_activity_id
            and scoped.entry_id = p_entry_id
            and scoped.evidence_type = evidence.evidence_type
            and scoped.status = 'ACTIVE'
        )
      )
    )
  order by evidence.evidence_type, evidence.sort_order, evidence.uploaded_at;
end;
$function$;

-- Per-participant resubmit: only the corrected entry returns to SUBMITTED.
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
  if exists (select 1 from public.overtime_evidence where activity_id = v_activity.id and status in ('PENDING','DELETE_PENDING')) then
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

-- Preserve entry IDs when any participant is APPROVED so scoped evidence survives.
-- Without approvals the legacy delete/recreate path is kept for compatibility.
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

  -- Approved-aware in-place update: keep entry IDs so scoped evidence survives.
  if p_activity_id is not null and v_has_approved then
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
    -- Approved rows must keep exact times.
    for v_idx in 0..v_count - 1 loop
      v_employee_id := v_payload_ids[v_idx + 1]; v_started := v_times[v_idx + 1]; v_ended := v_ends[v_idx + 1];
      perform 1 from public.overtime_entries where activity_id = p_activity_id and employee_id = v_employee_id and approval_status = 'APPROVED'
        and participant_started_at = v_started and participant_ended_at = v_ended;
      if exists (select 1 from public.overtime_entries where activity_id = p_activity_id and employee_id = v_employee_id and approval_status = 'APPROVED')
        and not found then
        raise exception 'Jam peserta yang sudah disetujui tidak dapat diubah.' using errcode = '22023';
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
      update public.overtime_entries set
        work_date = v_business_date, period_month = v_period_month, hours = round(v_duration, 2),
        description = v_desc_trim, employee_name_snapshot = v_name, hourly_rate_snapshot = v_rate,
        calculated_amount_snapshot = round(v_rate * v_multiplier, 2),
        participant_started_at = v_started, participant_ended_at = v_ended,
        duration_hours_snapshot = v_duration, multiplier_hours_snapshot = v_multiplier,
        updated_by = auth.uid()
      where activity_id = p_activity_id and employee_id = v_employee_id;
    end loop;
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
    insert into public.overtime_activities(contract_id, up3_id, unit_id, type, work_category, replaced_employee_id, description, work_title, work_location, started_at, ended_at, status, created_by, updated_by)
    values (p_contract_id, p_up3_id, p_unit_id, 'WORK', p_work_category, null, v_desc_trim, nullif(v_title_trim, ''), nullif(v_location_trim, ''), v_min_started, v_max_ended, 'DRAFT', auth.uid(), auth.uid()) returning id into v_activity_id;
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

revoke all on function public.auth_can_manage_overtime_entry_evidence(uuid, uuid) from public, anon;
grant execute on function public.auth_can_manage_overtime_entry_evidence(uuid, uuid) to authenticated;
revoke all on function public.prepare_overtime_entry_evidence_upload(uuid, uuid, text, text, text, bigint, bigint, text, text, integer, uuid) from public, anon;
grant execute on function public.prepare_overtime_entry_evidence_upload(uuid, uuid, text, text, text, bigint, bigint, text, text, integer, uuid) to authenticated;
revoke all on function public.list_overtime_entry_effective_evidence(uuid, uuid, boolean) from public, anon;
grant execute on function public.list_overtime_entry_effective_evidence(uuid, uuid, boolean) to authenticated;
revoke all on function public.resubmit_overtime_entry_l5(uuid) from public, anon;
grant execute on function public.resubmit_overtime_entry_l5(uuid) to authenticated;

comment on function public.auth_can_manage_overtime_entry_evidence(uuid, uuid)
  is 'Entry evidence manageable for CORRECTION_REQUIRED participant in scope/deadline.';
comment on function public.list_overtime_entry_effective_evidence(uuid, uuid, boolean)
  is 'Effective evidence per participant: scoped ACTIVE override else shared ACTIVE.';
comment on function public.resubmit_overtime_entry_l5(uuid)
  is 'Resubmit only the corrected participant; approved siblings unchanged.';

-- Shared list returns only shared ACTIVE rows; scoped rows are read via effective list.
create or replace function public.list_overtime_evidence(p_activity_id uuid, p_include_history boolean default false)
returns setof public.overtime_evidence
language plpgsql
stable security definer
set search_path to public, pg_temp
as $function$
declare v_activity public.overtime_activities%rowtype;
begin
  select * into v_activity from public.overtime_activities where id = p_activity_id;
  if not found or not public.auth_can_read_overtime_evidence_scope(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Overtime evidence is not readable by this account' using errcode = '42501';
  end if;
  if p_include_history then
    return query select evidence.* from public.overtime_evidence evidence
    where evidence.activity_id = p_activity_id
      and evidence.status in ('PENDING','ACTIVE','SUPERSEDED','DELETE_PENDING','DELETED')
    order by evidence.evidence_type, evidence.sort_order, evidence.uploaded_at;
    return;
  end if;
  return query select evidence.* from public.overtime_evidence evidence
  where evidence.activity_id = p_activity_id
    and evidence.entry_id is null
    and evidence.status = 'ACTIVE'
  order by evidence.evidence_type, evidence.sort_order, evidence.uploaded_at;
end;
$function$;
