-- Lembur L1: activity time foundation and private evidence storage.
-- Existing overtime activity, participant, evidence, and history tables are reused.

-- -----------------------------------------------------------------------------
-- Activity business dates and participant integrity
-- -----------------------------------------------------------------------------
alter table public.overtime_activities
  add column overtime_date date,
  add column period_month date,
  add column submission_deadline date,
  add column revision_deadline_at timestamptz,
  add column closure_reason text;

alter table public.overtime_activities
  add constraint oa_closure_reason_check
  check (closure_reason is null or closure_reason in ('FINAL_REJECTED', 'EXPIRED'));

alter table public.overtime_activities
  drop constraint oa_max_two_rejections;
alter table public.overtime_activities
  add constraint oa_max_three_rejections check (rejection_count <= 3);

create or replace function public.sync_overtime_activity_business_dates()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.overtime_date := (new.started_at at time zone 'Asia/Pontianak')::date;
  new.period_month := date_trunc(
    'month',
    new.started_at at time zone 'Asia/Pontianak'
  )::date;
  new.submission_deadline := new.overtime_date + 7;
  return new;
end;
$$;

create trigger trg_overtime_activity_business_dates
  before insert or update of started_at on public.overtime_activities
  for each row execute function public.sync_overtime_activity_business_dates();

update public.overtime_activities
set started_at = started_at;

alter table public.overtime_activities
  alter column overtime_date set not null,
  alter column period_month set not null,
  alter column submission_deadline set not null;

create unique index uq_overtime_activity_employee
  on public.overtime_entries (activity_id, employee_id)
  where activity_id is not null;

create or replace function public.validate_overtime_activity_participant()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
begin
  if new.activity_id is null then
    return new;
  end if;

  perform 1
  from public.overtime_activities
  where id = new.activity_id
  for update;

  select * into v_activity
  from public.overtime_activities
  where id = new.activity_id;
  if not found then
    raise exception 'Overtime activity not found';
  end if;
  if (new.contract_id, new.up3_id, new.unit_id) is distinct from
     (v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Participant scope must match overtime activity scope';
  end if;
  if new.participant_started_at < v_activity.started_at
     or new.participant_ended_at > v_activity.ended_at then
    raise exception 'Participant time must be inside overtime activity time';
  end if;
  if new.work_date <> v_activity.overtime_date
     or new.period_month <> v_activity.period_month then
    raise exception 'Participant date/period must follow activity start in Asia/Pontianak';
  end if;
  return new;
end;
$$;

create trigger trg_overtime_activity_participant_validate
  before insert or update on public.overtime_entries
  for each row execute function public.validate_overtime_activity_participant();

create or replace function public.guard_overtime_activity_participants()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_overtime_date date := (new.started_at at time zone 'Asia/Pontianak')::date;
  v_period_month date := date_trunc(
    'month', new.started_at at time zone 'Asia/Pontianak'
  )::date;
begin
  if not exists (
    select 1 from public.overtime_entries entry where entry.activity_id = old.id
  ) then
    return new;
  end if;
  if (new.contract_id, new.up3_id, new.unit_id) is distinct from
     (old.contract_id, old.up3_id, old.unit_id) then
    raise exception 'Activity scope cannot change after participants exist';
  end if;
  if exists (
    select 1
    from public.overtime_entries entry
    where entry.activity_id = old.id
      and (
        entry.participant_started_at < new.started_at
        or entry.participant_ended_at > new.ended_at
        or entry.work_date <> v_overtime_date
        or entry.period_month <> v_period_month
      )
  ) then
    raise exception 'Activity time change would invalidate existing participants';
  end if;
  return new;
end;
$$;

create trigger trg_overtime_activity_participant_guard
  before update of contract_id, up3_id, unit_id, started_at, ended_at
  on public.overtime_activities
  for each row execute function public.guard_overtime_activity_participants();

create or replace function public.guard_overtime_activity_evidence_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status in ('DRAFT', 'CORRECTION_REQUIRED')
     and new.status not in ('DRAFT', 'CORRECTION_REQUIRED')
     and exists (
       select 1
       from public.overtime_evidence evidence
       where evidence.activity_id = old.id
         and evidence.status in ('PENDING', 'DELETE_PENDING')
     ) then
    raise exception 'Resolve pending evidence operations before changing activity status';
  end if;
  return new;
end;
$$;

create trigger trg_overtime_activity_evidence_transition_guard
  before update of status on public.overtime_activities
  for each row execute function public.guard_overtime_activity_evidence_transition();

revoke execute on function public.sync_overtime_activity_business_dates()
  from public, anon, authenticated;
revoke execute on function public.validate_overtime_activity_participant()
  from public, anon, authenticated;
revoke execute on function public.guard_overtime_activity_participants()
  from public, anon, authenticated;
revoke execute on function public.guard_overtime_activity_evidence_transition()
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Evidence metadata
-- -----------------------------------------------------------------------------
alter table public.overtime_evidence
  add column original_filename text,
  add column original_mime_type text,
  add column original_size_bytes bigint,
  add column stored_size_bytes bigint,
  add column stored_mime_type text,
  add column sort_order integer not null default 0;

update public.overtime_evidence
set original_filename = file_name,
    original_mime_type = coalesce(mime_type, 'application/octet-stream'),
    original_size_bytes = file_size_bytes,
    stored_size_bytes = file_size_bytes,
    stored_mime_type = coalesce(mime_type, 'application/octet-stream');

alter table public.overtime_evidence
  alter column original_filename set not null,
  alter column original_mime_type set not null,
  alter column stored_mime_type set not null,
  add constraint ev_original_size_nonnegative check (
    original_size_bytes is null or original_size_bytes >= 0
  ),
  add constraint ev_stored_size_limit check (
    stored_size_bytes is null
    or (stored_size_bytes > 0 and stored_size_bytes <= 1048576)
  ),
  add constraint ev_sort_order_nonnegative check (sort_order >= 0),
  add constraint ev_evidence_type_check check (evidence_type in (
    'FORM_CUTI',
    'FORM_SAKIT',
    'SURAT_SAKIT',
    'FORM_IZIN',
    'SURAT_IZIN',
    'FOTO_SEBELUM',
    'FOTO_SESUDAH',
    'SPK',
    'FOTO_BRIEFING',
    'FOTO_PROSES',
    'FOTO_SELESAI'
  ));

alter table public.overtime_evidence
  drop constraint overtime_evidence_status_check,
  drop constraint ev_superseded_has_reference;
alter table public.overtime_evidence
  add constraint overtime_evidence_status_check check (status in (
    'PENDING', 'ACTIVE', 'SUPERSEDED', 'DELETE_PENDING', 'DELETED'
  )),
  add constraint ev_supersedes_distinct check (
    supersedes_evidence_id is null or supersedes_evidence_id <> id
  );

create unique index uq_overtime_evidence_single_active_slot
  on public.overtime_evidence (activity_id, evidence_type)
  where status = 'ACTIVE' and evidence_type <> 'FOTO_BRIEFING';

create index idx_overtime_evidence_storage_authorization
  on public.overtime_evidence (storage_path, status, uploader_user_id);

-- -----------------------------------------------------------------------------
-- Scope authorization. Operational roles use contract memberships. Existing
-- TEAM_LEADER/MANAGER_UNIT organization memberships are read-only when assigned.
-- -----------------------------------------------------------------------------
create or replace function public.auth_can_read_overtime_evidence_scope(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    public.auth_can_manage_overtime_scope(p_contract_id, p_up3_id, p_unit_id)
    or exists (
      select 1
      from public.organization_memberships membership
      join public.organization_contract_access access
        on access.internal_org_unit_id = membership.internal_org_unit_id
       and access.status = 'ACTIVE'
       and access.effective_from <= current_date
       and (access.effective_to is null or current_date < access.effective_to)
      where membership.user_id = auth.uid()
        and membership.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT')
        and membership.status = 'ACTIVE'
        and membership.effective_from <= current_date
        and (membership.effective_to is null or current_date < membership.effective_to)
        and access.contract_id = p_contract_id
        and access.operational_up3_id = p_up3_id
        and (access.operational_unit_id is null or access.operational_unit_id = p_unit_id)
    )
  )
$$;

create or replace function public.auth_can_manage_overtime_evidence_scope(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists (
      select 1
      from public.contract_memberships membership
      join public.contracts contract
        on contract.id = membership.contract_id
       and contract.status = 'active'
      join public.contract_up3_scopes scope
        on scope.contract_id = membership.contract_id
       and scope.up3_id = membership.operational_up3_id
       and scope.status = 'Aktif'
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
$$;

create or replace function public.auth_can_manage_overtime_activity_evidence(
  p_activity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.overtime_activities activity
    where activity.id = p_activity_id
      and activity.status in ('DRAFT', 'CORRECTION_REQUIRED')
      and public.auth_can_manage_overtime_evidence_scope(
        activity.contract_id,
        activity.up3_id,
        activity.unit_id
      )
  )
$$;

create or replace function public.auth_can_read_overtime_evidence_object(
  p_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.overtime_evidence evidence
    join public.overtime_activities activity on activity.id = evidence.activity_id
    where evidence.storage_path = p_storage_path
      and (
        (
          evidence.status in ('ACTIVE', 'SUPERSEDED')
          and public.auth_can_read_overtime_evidence_scope(
            activity.contract_id,
            activity.up3_id,
            activity.unit_id
          )
        )
        or (
          evidence.status in ('PENDING', 'DELETE_PENDING')
          and public.auth_can_manage_overtime_activity_evidence(evidence.activity_id)
        )
      )
  )
$$;

create or replace function public.auth_can_upload_overtime_evidence_object(
  p_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.overtime_evidence evidence
    where evidence.storage_path = p_storage_path
      and evidence.status = 'PENDING'
      and evidence.uploader_user_id = auth.uid()
      and public.auth_can_manage_overtime_activity_evidence(evidence.activity_id)
  )
$$;

create or replace function public.auth_can_delete_overtime_evidence_object(
  p_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.overtime_evidence evidence
    where evidence.storage_path = p_storage_path
      and evidence.status in ('PENDING', 'DELETE_PENDING')
      and public.auth_can_manage_overtime_activity_evidence(evidence.activity_id)
  )
$$;

-- -----------------------------------------------------------------------------
-- Evidence lifecycle RPCs
-- -----------------------------------------------------------------------------
create or replace function public.prepare_overtime_evidence_upload(
  p_activity_id uuid,
  p_evidence_type text,
  p_original_filename text,
  p_original_mime_type text,
  p_original_size_bytes bigint,
  p_stored_size_bytes bigint,
  p_stored_mime_type text,
  p_checksum text default null,
  p_sort_order integer default 0,
  p_supersedes_evidence_id uuid default null
)
returns public.overtime_evidence
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    or (v_activity.type = 'WORK' and v_activity.work_category in ('GARDU', 'JTM', 'JTR')
      and p_evidence_type in ('SPK', 'FOTO_BRIEFING', 'FOTO_PROSES', 'FOTO_SELESAI'))
  ) then
    raise exception 'Evidence type is not valid for this overtime activity';
  end if;

  if p_supersedes_evidence_id is not null then
    select * into v_existing
    from public.overtime_evidence
    where id = p_supersedes_evidence_id
      and activity_id = p_activity_id
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
        and evidence_type = p_evidence_type
        and status in ('PENDING', 'DELETE_PENDING')
    ) then
      raise exception 'Another evidence operation is already pending for this slot';
    end if;
    v_revision := v_existing.revision_number + 1;
  elsif p_evidence_type <> 'FOTO_BRIEFING' and exists (
    select 1 from public.overtime_evidence
    where activity_id = p_activity_id
      and evidence_type = p_evidence_type
      and status in ('PENDING', 'ACTIVE', 'DELETE_PENDING')
  ) then
    raise exception 'Evidence slot already exists; use replacement flow';
  end if;

  insert into public.overtime_evidence (
    id, activity_id, evidence_type, file_name, storage_path, mime_type,
    file_size_bytes, checksum, uploader_user_id, status,
    supersedes_evidence_id, revision_number, original_filename,
    original_mime_type, original_size_bytes, stored_size_bytes,
    stored_mime_type, sort_order
  ) values (
    v_evidence_id,
    p_activity_id,
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
$$;

create or replace function public.finalize_overtime_evidence_upload(
  p_evidence_id uuid
)
returns public.overtime_evidence
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_evidence public.overtime_evidence%rowtype;
  v_result public.overtime_evidence%rowtype;
  v_size bigint;
  v_mime text;
begin
  select * into v_evidence
  from public.overtime_evidence
  where id = p_evidence_id and status in ('PENDING', 'ACTIVE')
  for update;
  if not found or not public.auth_can_manage_overtime_activity_evidence(v_evidence.activity_id) then
    raise exception 'Pending evidence is not finalizable by this account'
      using errcode = '42501';
  end if;
  if v_evidence.status = 'ACTIVE' then
    return v_evidence;
  end if;

  select (object.metadata ->> 'size')::bigint,
         coalesce(object.metadata ->> 'mimetype', v_evidence.stored_mime_type)
    into v_size, v_mime
  from storage.objects object
  where object.bucket_id = 'overtime-evidence'
    and object.name = v_evidence.storage_path;
  if not found then
    raise exception 'Uploaded Storage object was not found';
  end if;
  if v_size is null or v_size <= 0 or v_size > 1048576 then
    raise exception 'Stored evidence exceeds the 1 MB hard limit';
  end if;
  if v_mime is distinct from v_evidence.stored_mime_type then
    raise exception 'Stored evidence MIME type does not match prepared metadata';
  end if;

  if v_evidence.supersedes_evidence_id is not null then
    update public.overtime_evidence
    set status = 'SUPERSEDED'
    where id = v_evidence.supersedes_evidence_id and status = 'ACTIVE';
  end if;
  update public.overtime_evidence
  set status = 'ACTIVE',
      stored_size_bytes = v_size,
      file_size_bytes = v_size,
      stored_mime_type = v_mime,
      mime_type = v_mime,
      uploaded_at = now()
  where id = p_evidence_id
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.cancel_overtime_evidence_upload(
  p_evidence_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_evidence public.overtime_evidence%rowtype;
begin
  select * into v_evidence
  from public.overtime_evidence
  where id = p_evidence_id and status = 'PENDING'
  for update;
  if not found or not public.auth_can_manage_overtime_activity_evidence(v_evidence.activity_id) then
    raise exception 'Pending evidence is not cancellable by this account'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'overtime-evidence' and name = v_evidence.storage_path
  ) then
    raise exception 'Remove the Storage object before cancelling metadata';
  end if;
  delete from public.overtime_evidence where id = p_evidence_id;
end;
$$;

create or replace function public.begin_overtime_evidence_delete(
  p_evidence_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_evidence public.overtime_evidence%rowtype;
  v_activity_id uuid;
begin
  select activity_id into v_activity_id
  from public.overtime_evidence
  where id = p_evidence_id
    and status in ('ACTIVE', 'DELETE_PENDING');
  if not found then
    raise exception 'Evidence is not deletable by this account' using errcode = '42501';
  end if;
  perform 1
  from public.overtime_activities
  where id = v_activity_id
  for update;
  select * into v_evidence
  from public.overtime_evidence
  where id = p_evidence_id and status in ('ACTIVE', 'DELETE_PENDING')
  for update;
  if not found or not public.auth_can_manage_overtime_activity_evidence(v_evidence.activity_id) then
    raise exception 'Evidence is not deletable by this account' using errcode = '42501';
  end if;
  if v_evidence.status = 'ACTIVE' then
    update public.overtime_evidence set status = 'DELETE_PENDING' where id = p_evidence_id;
  end if;
  return v_evidence.storage_path;
end;
$$;

create or replace function public.cancel_overtime_evidence_delete(
  p_evidence_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.overtime_evidence evidence
  set status = 'ACTIVE'
  where evidence.id = p_evidence_id
    and evidence.status = 'DELETE_PENDING'
    and public.auth_can_manage_overtime_activity_evidence(evidence.activity_id);
  if not found then
    raise exception 'Evidence deletion is not cancellable by this account'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.finalize_overtime_evidence_delete(
  p_evidence_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_evidence public.overtime_evidence%rowtype;
begin
  select * into v_evidence
  from public.overtime_evidence
  where id = p_evidence_id and status in ('DELETE_PENDING', 'DELETED')
  for update;
  if not found or not public.auth_can_manage_overtime_activity_evidence(v_evidence.activity_id) then
    raise exception 'Evidence deletion is not finalizable by this account'
      using errcode = '42501';
  end if;
  if v_evidence.status = 'DELETED' then
    return;
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'overtime-evidence' and name = v_evidence.storage_path
  ) then
    raise exception 'Storage object still exists';
  end if;
  update public.overtime_evidence set status = 'DELETED' where id = p_evidence_id;
end;
$$;

create or replace function public.list_overtime_evidence(
  p_activity_id uuid,
  p_include_history boolean default false
)
returns setof public.overtime_evidence
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
begin
  select * into v_activity from public.overtime_activities where id = p_activity_id;
  if not found or not public.auth_can_read_overtime_evidence_scope(
    v_activity.contract_id, v_activity.up3_id, v_activity.unit_id
  ) then
    raise exception 'Overtime evidence is not readable by this account'
      using errcode = '42501';
  end if;
  return query
    select evidence.*
    from public.overtime_evidence evidence
    where evidence.activity_id = p_activity_id
      and (
        (not p_include_history and evidence.status = 'ACTIVE')
        or (p_include_history and evidence.status in (
          'PENDING', 'ACTIVE', 'SUPERSEDED', 'DELETE_PENDING', 'DELETED'
        ))
      )
    order by evidence.evidence_type, evidence.sort_order, evidence.uploaded_at;
end;
$$;

create or replace function public.get_overtime_evidence_lifecycle(
  p_evidence_id uuid
)
returns public.overtime_evidence
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_evidence public.overtime_evidence%rowtype;
begin
  select * into v_evidence
  from public.overtime_evidence
  where id = p_evidence_id;
  if not found or not public.auth_can_manage_overtime_activity_evidence(v_evidence.activity_id) then
    raise exception 'Evidence lifecycle is not manageable by this account'
      using errcode = '42501';
  end if;
  return v_evidence;
end;
$$;

create or replace function public.get_overtime_evidence_preview_path(
  p_evidence_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_path text;
begin
  select evidence.storage_path into v_path
  from public.overtime_evidence evidence
  join public.overtime_activities activity on activity.id = evidence.activity_id
  where evidence.id = p_evidence_id
    and evidence.status in ('ACTIVE', 'SUPERSEDED')
    and public.auth_can_read_overtime_evidence_scope(
      activity.contract_id, activity.up3_id, activity.unit_id
    );
  if v_path is null then
    raise exception 'Overtime evidence is not readable by this account'
      using errcode = '42501';
  end if;
  return v_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- Private bucket and Storage object policies
-- -----------------------------------------------------------------------------
insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'overtime-evidence',
  'overtime-evidence',
  false,
  1048576,
  array[
    'image/jpeg',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists overtime_evidence_object_insert on storage.objects;
drop policy if exists overtime_evidence_object_select on storage.objects;
drop policy if exists overtime_evidence_object_delete on storage.objects;

create policy overtime_evidence_object_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'overtime-evidence'
    and public.auth_can_upload_overtime_evidence_object(name)
  );

create policy overtime_evidence_object_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'overtime-evidence'
    and public.auth_can_read_overtime_evidence_object(name)
  );

create policy overtime_evidence_object_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'overtime-evidence'
    and public.auth_can_delete_overtime_evidence_object(name)
  );

revoke all on function public.auth_can_read_overtime_evidence_scope(uuid, uuid, uuid)
  from public, anon;
revoke all on function public.auth_can_manage_overtime_evidence_scope(uuid, uuid, uuid)
  from public, anon;
revoke all on function public.auth_can_manage_overtime_activity_evidence(uuid)
  from public, anon;
revoke all on function public.auth_can_read_overtime_evidence_object(text)
  from public, anon;
revoke all on function public.auth_can_upload_overtime_evidence_object(text)
  from public, anon;
revoke all on function public.auth_can_delete_overtime_evidence_object(text)
  from public, anon;

grant execute on function public.auth_can_read_overtime_evidence_scope(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.auth_can_manage_overtime_evidence_scope(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.auth_can_manage_overtime_activity_evidence(uuid)
  to authenticated;
grant execute on function public.auth_can_read_overtime_evidence_object(text)
  to authenticated;
grant execute on function public.auth_can_upload_overtime_evidence_object(text)
  to authenticated;
grant execute on function public.auth_can_delete_overtime_evidence_object(text)
  to authenticated;

revoke all on function public.prepare_overtime_evidence_upload(
  uuid, text, text, text, bigint, bigint, text, text, integer, uuid
) from public, anon;
revoke all on function public.finalize_overtime_evidence_upload(uuid) from public, anon;
revoke all on function public.cancel_overtime_evidence_upload(uuid) from public, anon;
revoke all on function public.begin_overtime_evidence_delete(uuid) from public, anon;
revoke all on function public.cancel_overtime_evidence_delete(uuid) from public, anon;
revoke all on function public.finalize_overtime_evidence_delete(uuid) from public, anon;
revoke all on function public.list_overtime_evidence(uuid, boolean) from public, anon;
revoke all on function public.get_overtime_evidence_lifecycle(uuid) from public, anon;
revoke all on function public.get_overtime_evidence_preview_path(uuid) from public, anon;

grant execute on function public.prepare_overtime_evidence_upload(
  uuid, text, text, text, bigint, bigint, text, text, integer, uuid
) to authenticated;
grant execute on function public.finalize_overtime_evidence_upload(uuid) to authenticated;
grant execute on function public.cancel_overtime_evidence_upload(uuid) to authenticated;
grant execute on function public.begin_overtime_evidence_delete(uuid) to authenticated;
grant execute on function public.cancel_overtime_evidence_delete(uuid) to authenticated;
grant execute on function public.finalize_overtime_evidence_delete(uuid) to authenticated;
grant execute on function public.list_overtime_evidence(uuid, boolean) to authenticated;
grant execute on function public.get_overtime_evidence_lifecycle(uuid) to authenticated;
grant execute on function public.get_overtime_evidence_preview_path(uuid) to authenticated;
