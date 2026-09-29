-- Configurable initial overtime submission deadlines per contract and UP3.
-- Revision deadlines remain governed by the existing D+3 workflow.

-- -----------------------------------------------------------------------------
-- Configuration and immutable audit history
-- -----------------------------------------------------------------------------
create table public.overtime_initial_deadline_configs (
  contract_id uuid not null,
  up3_id uuid not null,
  initial_submission_days integer not null default 7,
  temporary_submission_days integer,
  temporary_effective_until timestamptz,
  temporary_reason text,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  constraint overtime_initial_deadline_configs_pkey
    primary key (contract_id, up3_id),
  constraint overtime_initial_deadline_configs_scope_fk
    foreign key (contract_id, up3_id)
    references public.contract_up3_scopes(contract_id, up3_id),
  constraint overtime_initial_deadline_configs_initial_days_check
    check (initial_submission_days between 1 and 30),
  constraint overtime_initial_deadline_configs_temporary_days_check
    check (
      temporary_submission_days is null
      or temporary_submission_days between 1 and 30
    ),
  constraint overtime_initial_deadline_configs_temporary_fields_check
    check (
      (
        temporary_submission_days is null
        and temporary_effective_until is null
        and temporary_reason is null
      )
      or (
        temporary_submission_days is not null
        and temporary_effective_until is not null
        and nullif(btrim(temporary_reason), '') is not null
      )
    ),
  constraint overtime_initial_deadline_configs_revision_check
    check (revision >= 1)
);

create table public.overtime_initial_deadline_config_history (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null,
  up3_id uuid not null,
  old_initial_submission_days integer,
  new_initial_submission_days integer not null,
  old_temporary_submission_days integer,
  new_temporary_submission_days integer,
  old_temporary_effective_until timestamptz,
  new_temporary_effective_until timestamptz,
  old_temporary_reason text,
  new_temporary_reason text,
  old_revision integer,
  new_revision integer not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  constraint overtime_initial_deadline_config_history_config_fk
    foreign key (contract_id, up3_id)
    references public.overtime_initial_deadline_configs(contract_id, up3_id),
  constraint overtime_initial_deadline_config_history_old_days_check
    check (
      old_initial_submission_days is null
      or old_initial_submission_days between 1 and 30
    ),
  constraint overtime_initial_deadline_config_history_new_days_check
    check (new_initial_submission_days between 1 and 30),
  constraint overtime_initial_deadline_config_history_old_temporary_check
    check (
      (
        old_temporary_submission_days is null
        and old_temporary_effective_until is null
        and old_temporary_reason is null
      )
      or (
        old_temporary_submission_days is not null
        and old_temporary_submission_days between 1 and 30
        and old_temporary_effective_until is not null
        and nullif(btrim(old_temporary_reason), '') is not null
      )
    ),
  constraint overtime_initial_deadline_config_history_new_temporary_check
    check (
      (
        new_temporary_submission_days is null
        and new_temporary_effective_until is null
        and new_temporary_reason is null
      )
      or (
        new_temporary_submission_days is not null
        and new_temporary_submission_days between 1 and 30
        and new_temporary_effective_until is not null
        and nullif(btrim(new_temporary_reason), '') is not null
      )
    ),
  constraint overtime_initial_deadline_config_history_revision_check
    check (
      (old_revision is null or old_revision >= 1)
      and new_revision >= 1
    )
);

create index idx_overtime_initial_deadline_config_history_scope_changed
  on public.overtime_initial_deadline_config_history
  (contract_id, up3_id, changed_at desc);

create index idx_overtime_initial_deadline_config_history_actor_changed
  on public.overtime_initial_deadline_config_history
  (changed_by, changed_at desc);

alter table public.overtime_initial_deadline_configs enable row level security;
alter table public.overtime_initial_deadline_config_history enable row level security;

revoke all on table public.overtime_initial_deadline_configs
  from public, anon, authenticated;
revoke all on table public.overtime_initial_deadline_config_history
  from public, anon, authenticated;

create or replace function public.audit_overtime_initial_deadline_config()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.overtime_initial_deadline_config_history (
    contract_id,
    up3_id,
    old_initial_submission_days,
    new_initial_submission_days,
    old_temporary_submission_days,
    new_temporary_submission_days,
    old_temporary_effective_until,
    new_temporary_effective_until,
    old_temporary_reason,
    new_temporary_reason,
    old_revision,
    new_revision,
    changed_by,
    changed_at
  ) values (
    new.contract_id,
    new.up3_id,
    case when tg_op = 'UPDATE' then old.initial_submission_days end,
    new.initial_submission_days,
    case when tg_op = 'UPDATE' then old.temporary_submission_days end,
    new.temporary_submission_days,
    case when tg_op = 'UPDATE' then old.temporary_effective_until end,
    new.temporary_effective_until,
    case when tg_op = 'UPDATE' then old.temporary_reason end,
    new.temporary_reason,
    case when tg_op = 'UPDATE' then old.revision end,
    new.revision,
    new.updated_by,
    new.updated_at
  );
  return new;
end;
$$;

create trigger trg_overtime_initial_deadline_config_audit
  after insert or update on public.overtime_initial_deadline_configs
  for each row execute function public.audit_overtime_initial_deadline_config();

create or replace function public.reject_overtime_initial_deadline_history_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'overtime_initial_deadline_config_history is append-only'
    using errcode = '42501';
end;
$$;

create trigger trg_overtime_initial_deadline_config_history_append_only
  before update or delete on public.overtime_initial_deadline_config_history
  for each row execute function public.reject_overtime_initial_deadline_history_mutation();

revoke all on function public.audit_overtime_initial_deadline_config()
  from public, anon, authenticated;
revoke all on function public.reject_overtime_initial_deadline_history_mutation()
  from public, anon, authenticated;

comment on table public.overtime_initial_deadline_configs
  is 'Per-contract/UP3 initial overtime deadline configuration. Missing rows resolve to 7 days.';
comment on table public.overtime_initial_deadline_config_history
  is 'Immutable old/new audit snapshots for initial overtime deadline configuration changes.';

-- -----------------------------------------------------------------------------
-- Canonical internal resolvers
-- -----------------------------------------------------------------------------
create or replace function public.resolve_overtime_initial_deadline_config(
  p_contract_id uuid,
  p_up3_id uuid,
  p_as_of timestamptz default statement_timestamp()
)
returns table (
  config_exists boolean,
  initial_submission_days integer,
  temporary_submission_days integer,
  temporary_effective_until timestamptz,
  temporary_reason text,
  temporary_is_active boolean,
  effective_submission_days integer,
  updated_by uuid,
  updated_at timestamptz,
  revision integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    config.contract_id is not null,
    coalesce(config.initial_submission_days, 7),
    config.temporary_submission_days,
    config.temporary_effective_until,
    config.temporary_reason,
    coalesce(
      config.temporary_submission_days is not null
      and p_as_of <= config.temporary_effective_until,
      false
    ),
    case
      when config.temporary_submission_days is not null
       and p_as_of <= config.temporary_effective_until
        then config.temporary_submission_days
      else coalesce(config.initial_submission_days, 7)
    end,
    config.updated_by,
    config.updated_at,
    config.revision
  from (values (true)) as singleton(seed)
  left join public.overtime_initial_deadline_configs config
    on config.contract_id = p_contract_id
   and config.up3_id = p_up3_id
$$;

create or replace function public.resolve_overtime_initial_deadline(
  p_contract_id uuid,
  p_up3_id uuid,
  p_overtime_date date,
  p_as_of timestamptz default statement_timestamp()
)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
    p_overtime_date
    + config.effective_submission_days
    + time '23:59:59.999999'
  ) at time zone 'Asia/Pontianak'
  from public.resolve_overtime_initial_deadline_config(
    p_contract_id,
    p_up3_id,
    p_as_of
  ) config
$$;

revoke all on function public.resolve_overtime_initial_deadline_config(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.resolve_overtime_initial_deadline(uuid, uuid, date, timestamptz)
  from public, anon, authenticated;

comment on function public.resolve_overtime_initial_deadline_config(uuid, uuid, timestamptz)
  is 'Canonical stable resolver for normal, temporary, and effective initial submission days; defaults to 7 days when no config row exists.';
comment on function public.resolve_overtime_initial_deadline(uuid, uuid, date, timestamptz)
  is 'Canonical stable resolver for the effective initial deadline at 23:59:59.999999 Asia/Pontianak.';

-- -----------------------------------------------------------------------------
-- Scope-safe read and SUPER_ADMIN-only mutation RPCs
-- -----------------------------------------------------------------------------
create or replace function public.get_overtime_initial_deadline_config(
  p_contract_id uuid,
  p_up3_id uuid,
  p_overtime_date date
)
returns table (
  contract_id uuid,
  up3_id uuid,
  config_exists boolean,
  initial_submission_days integer,
  temporary_submission_days integer,
  temporary_effective_until timestamptz,
  temporary_reason text,
  temporary_is_active boolean,
  effective_submission_days integer,
  overtime_date date,
  effective_deadline_date date,
  effective_deadline_at timestamptz,
  as_of timestamptz,
  updated_by uuid,
  updated_at timestamptz,
  revision integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_as_of timestamptz := statement_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_overtime_date is null then
    raise exception 'Overtime date is required' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.contract_up3_scopes scope
    join public.organization_units target_unit
      on target_unit.id = scope.up3_id
      or (
        target_unit.type = 'ULP'
        and target_unit.parent_id = scope.up3_id
      )
    where scope.contract_id = p_contract_id
      and scope.up3_id = p_up3_id
      and public.auth_can_read_overtime_evidence_scope(
        p_contract_id,
        p_up3_id,
        target_unit.id
      )
  ) then
    raise exception 'Overtime deadline configuration is not available to this account'
      using errcode = '42501';
  end if;

  return query
  select
    p_contract_id,
    p_up3_id,
    config.config_exists,
    config.initial_submission_days,
    config.temporary_submission_days,
    config.temporary_effective_until,
    config.temporary_reason,
    config.temporary_is_active,
    config.effective_submission_days,
    p_overtime_date,
    p_overtime_date + config.effective_submission_days,
    public.resolve_overtime_initial_deadline(
      p_contract_id,
      p_up3_id,
      p_overtime_date,
      v_as_of
    ),
    v_as_of,
    config.updated_by,
    config.updated_at,
    config.revision
  from public.resolve_overtime_initial_deadline_config(
    p_contract_id,
    p_up3_id,
    v_as_of
  ) config;
end;
$$;

create or replace function public.set_overtime_initial_deadline_config(
  p_contract_id uuid,
  p_up3_id uuid,
  p_initial_submission_days integer,
  p_temporary_submission_days integer default null,
  p_temporary_effective_until timestamptz default null,
  p_temporary_reason text default null
)
returns public.overtime_initial_deadline_configs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_changed_at timestamptz;
  v_config public.overtime_initial_deadline_configs%rowtype;
  v_temporary_reason text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.auth_is_super_admin() then
    raise exception 'Hanya SUPER_ADMIN yang dapat mengubah pengaturan deadline Lembur'
      using errcode = '42501';
  end if;
  if p_initial_submission_days is null
     or p_initial_submission_days not between 1 and 30 then
    raise exception 'Batas pengajuan normal wajib antara 1 sampai 30 hari'
      using errcode = '22023';
  end if;
  if (
    p_temporary_submission_days is null
    and p_temporary_effective_until is null
    and p_temporary_reason is null
  ) then
    v_temporary_reason := null;
  elsif p_temporary_submission_days is null
     or p_temporary_effective_until is null
     or nullif(btrim(p_temporary_reason), '') is null then
    raise exception 'Batas, masa berlaku, dan alasan toleransi sementara wajib diisi lengkap'
      using errcode = '22023';
  else
    v_temporary_reason := btrim(p_temporary_reason);
  end if;
  if p_temporary_submission_days is not null
     and p_temporary_submission_days not between 1 and 30 then
    raise exception 'Batas pengajuan sementara wajib antara 1 sampai 30 hari'
      using errcode = '22023';
  end if;

  perform 1
  from public.contract_up3_scopes scope
  where scope.contract_id = p_contract_id
    and scope.up3_id = p_up3_id
  for update;
  if not found then
    raise exception 'Kontrak dan UP3 tidak terhubung'
      using errcode = '22023';
  end if;

  v_changed_at := clock_timestamp();
  if p_temporary_effective_until is not null
     and p_temporary_effective_until <= v_changed_at then
    raise exception 'Masa berlaku toleransi sementara harus berada di masa depan'
      using errcode = '22023';
  end if;

  insert into public.overtime_initial_deadline_configs as current_config (
    contract_id,
    up3_id,
    initial_submission_days,
    temporary_submission_days,
    temporary_effective_until,
    temporary_reason,
    updated_by,
    updated_at,
    revision
  ) values (
    p_contract_id,
    p_up3_id,
    p_initial_submission_days,
    p_temporary_submission_days,
    p_temporary_effective_until,
    v_temporary_reason,
    auth.uid(),
    v_changed_at,
    1
  )
  on conflict (contract_id, up3_id) do update
  set initial_submission_days = excluded.initial_submission_days,
      temporary_submission_days = excluded.temporary_submission_days,
      temporary_effective_until = excluded.temporary_effective_until,
      temporary_reason = excluded.temporary_reason,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at,
      revision = current_config.revision + 1
  returning * into v_config;

  return v_config;
end;
$$;

revoke all on function public.get_overtime_initial_deadline_config(uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.set_overtime_initial_deadline_config(uuid, uuid, integer, integer, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.get_overtime_initial_deadline_config(uuid, uuid, date)
  to authenticated;
grant execute on function public.set_overtime_initial_deadline_config(uuid, uuid, integer, integer, timestamptz, text)
  to authenticated;

comment on function public.get_overtime_initial_deadline_config(uuid, uuid, date)
  is 'Returns scope-safe current config, effective day count, and effective initial deadline for an authenticated overtime reader.';
comment on function public.set_overtime_initial_deadline_config(uuid, uuid, integer, integer, timestamptz, text)
  is 'SUPER_ADMIN-only audited upsert for normal and optional temporary initial overtime deadline configuration.';

-- -----------------------------------------------------------------------------
-- Existing deadline-dependent server paths
-- -----------------------------------------------------------------------------
create or replace function public.sync_overtime_activity_business_dates()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_effective_submission_days integer;
begin
  new.overtime_date := (new.started_at at time zone 'Asia/Pontianak')::date;
  new.period_month := date_trunc(
    'month',
    new.started_at at time zone 'Asia/Pontianak'
  )::date;
  select config.effective_submission_days
  into v_effective_submission_days
  from public.resolve_overtime_initial_deadline_config(
    new.contract_id,
    new.up3_id,
    clock_timestamp()
  ) config;
  new.submission_deadline := new.overtime_date + v_effective_submission_days;
  return new;
end;
$$;

create or replace function public.enforce_overtime_initial_deadline_l6()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_as_of timestamptz := clock_timestamp();
  v_deadline timestamptz;
  v_effective_submission_days integer;
begin
  if tg_op = 'UPDATE'
     and old.status = 'DRAFT'
     and coalesce(old.submission_count, 0) = 0
     and new.status <> 'CLOSED' then
    select config.effective_submission_days
    into v_effective_submission_days
    from public.resolve_overtime_initial_deadline_config(
      old.contract_id,
      old.up3_id,
      v_as_of
    ) config;
    v_deadline := public.resolve_overtime_initial_deadline(
      old.contract_id,
      old.up3_id,
      old.overtime_date,
      v_as_of
    );
    if v_as_of > v_deadline then
      raise exception 'Batas pengajuan telah lewat. Batas efektif H+%. Draft Lembur sudah kedaluwarsa.',
        v_effective_submission_days;
    end if;
  end if;

  if new.status = 'DRAFT' and coalesce(new.submission_count, 0) = 0 then
    select config.effective_submission_days
    into v_effective_submission_days
    from public.resolve_overtime_initial_deadline_config(
      new.contract_id,
      new.up3_id,
      v_as_of
    ) config;
    v_deadline := public.resolve_overtime_initial_deadline(
      new.contract_id,
      new.up3_id,
      new.overtime_date,
      v_as_of
    );
    if v_as_of > v_deadline then
      raise exception 'Batas pengajuan telah lewat. Pilih tanggal lembur yang masih berada dalam batas H+%.',
        v_effective_submission_days;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_overtime_evidence_initial_deadline_l6()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_as_of timestamptz := clock_timestamp();
  v_effective_submission_days integer;
begin
  select * into v_activity
  from public.overtime_activities
  where id = new.activity_id;

  if v_activity.status = 'DRAFT'
     and coalesce(v_activity.submission_count, 0) = 0
     and v_as_of > public.resolve_overtime_initial_deadline(
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
    raise exception 'Batas pengajuan telah lewat. Batas efektif H+%. Evidence tidak dapat disimpan untuk Draft yang kedaluwarsa.',
      v_effective_submission_days;
  end if;
  return new;
end;
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
      and activity.deleted_at is null
      and (
        (
          activity.status = 'DRAFT'
          and coalesce(activity.submission_count, 0) = 0
          and statement_timestamp() <= public.resolve_overtime_initial_deadline(
            activity.contract_id,
            activity.up3_id,
            activity.overtime_date,
            statement_timestamp()
          )
        )
        or (
          activity.status = 'CORRECTION_REQUIRED'
          and activity.revision_deadline_at is not null
          and clock_timestamp() <= activity.revision_deadline_at
        )
      )
      and public.auth_can_manage_overtime_evidence_scope(
        activity.contract_id,
        activity.up3_id,
        activity.unit_id
      )
  )
$$;

-- Keep the established evidence lifecycle intact while allowing the existing
-- ROW category to use the same field-work evidence set as GARDU/JTM/JTR.
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

create or replace function public.expire_overtime_initial_drafts_l6(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_as_of timestamptz := clock_timestamp();
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  with expired as (
    update public.overtime_activities activity
    set status = 'CLOSED',
        closure_reason = 'EXPIRED',
        closed_at = clock_timestamp(),
        closed_by = auth.uid(),
        updated_by = auth.uid()
    where activity.contract_id = p_contract_id
      and activity.up3_id = p_up3_id
      and (p_unit_id is null or activity.unit_id = p_unit_id)
      and activity.status = 'DRAFT'
      and activity.deleted_at is null
      and coalesce(activity.submission_count, 0) = 0
      and v_as_of > public.resolve_overtime_initial_deadline(
        activity.contract_id,
        activity.up3_id,
        activity.overtime_date,
        v_as_of
      )
      and public.auth_can_manage_overtime_scope(
        activity.contract_id,
        activity.up3_id,
        activity.unit_id
      )
    returning
      activity.id,
      activity.contract_id,
      activity.up3_id
  ), history as (
    insert into public.overtime_activity_history (
      activity_id,
      event,
      actor_user_id,
      previous_status,
      new_status,
      reason
    )
    select
      expired.id,
      'CLOSED',
      auth.uid(),
      'DRAFT',
      'CLOSED',
      format(
        'Batas pengajuan awal H+%s telah lewat',
        config.effective_submission_days
      )
    from expired
    cross join lateral public.resolve_overtime_initial_deadline_config(
      expired.contract_id,
      expired.up3_id,
      v_as_of
    ) config
    returning 1
  )
  select count(*) into v_count from history;

  return v_count;
end;
$$;

create or replace function public.expire_overtime_initial_drafts_l5(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.expire_overtime_initial_drafts_l6(
    p_contract_id,
    p_up3_id,
    p_unit_id
  );
end;
$$;

create or replace function public.submit_overtime_replacement_l2(
  p_activity_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_required_types text[];
  v_required_type text;
  v_submission_number integer;
  v_as_of timestamptz := clock_timestamp();
  v_effective_submission_days integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_activity
  from public.overtime_activities activity
  where activity.id = p_activity_id
    and activity.deleted_at is null
    and public.auth_can_mutate_overtime_replacement_l2(
      activity.contract_id, activity.up3_id, activity.unit_id
    )
  for update;
  if not found then
    raise exception 'Overtime activity is not available to this account'
      using errcode = '42501';
  end if;
  if v_activity.type not in (
    'REPLACEMENT_LEAVE', 'REPLACEMENT_SICK', 'REPLACEMENT_PERMISSION'
  ) then
    raise exception 'Only L2 replacement overtime can be submitted';
  end if;
  if v_activity.status <> 'DRAFT' then
    raise exception 'Only DRAFT replacement overtime can be submitted';
  end if;
  if not public.auth_can_mutate_overtime_replacement_l2(
    v_activity.contract_id, v_activity.up3_id, v_activity.unit_id
  ) then
    raise exception 'Replacement overtime scope is not mutable by this account'
      using errcode = '42501';
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
    raise exception 'Batas pengajuan telah lewat. Batas efektif H+% untuk Lembur Pengganti.',
      v_effective_submission_days;
  end if;
  if (select count(*) from public.overtime_entries entry
      where entry.activity_id = p_activity_id) <> 1 then
    raise exception 'Replacement overtime must have exactly one participant';
  end if;
  if exists (
    select 1 from public.overtime_evidence evidence
    where evidence.activity_id = p_activity_id
      and evidence.status in ('PENDING', 'DELETE_PENDING')
  ) then
    raise exception 'Resolve pending evidence operations before submission';
  end if;

  v_required_types := case v_activity.type
    when 'REPLACEMENT_LEAVE' then array['FORM_CUTI']::text[]
    when 'REPLACEMENT_SICK' then array['FORM_SAKIT', 'SURAT_SAKIT']::text[]
    else array['FORM_IZIN', 'SURAT_IZIN']::text[]
  end;
  foreach v_required_type in array v_required_types loop
    if (select count(*) from public.overtime_evidence evidence
        where evidence.activity_id = p_activity_id
          and evidence.evidence_type = v_required_type
          and evidence.status = 'ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: %',
        v_required_type;
    end if;
  end loop;
  if exists (
    select 1 from public.overtime_evidence evidence
    where evidence.activity_id = p_activity_id
      and evidence.status = 'ACTIVE'
      and not (evidence.evidence_type = any(v_required_types))
  ) then
    raise exception 'ACTIVE evidence contains a type not required by this replacement';
  end if;

  v_submission_number := v_activity.submission_count + 1;
  update public.overtime_activities
  set status = 'SUBMITTED',
      submitted_at = now(),
      submitted_by = auth.uid(),
      submission_count = v_submission_number,
      current_submission_number = v_submission_number,
      updated_by = auth.uid()
  where id = p_activity_id;

  insert into public.overtime_activity_history (
    activity_id, event, actor_user_id, submission_number,
    previous_status, new_status
  ) values (
    p_activity_id, 'SUBMITTED', auth.uid(), v_submission_number,
    'DRAFT', 'SUBMITTED'
  );
  return p_activity_id;
end;
$$;

create or replace function public.submit_overtime_work_l3(p_activity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_submission_number integer;
  v_as_of timestamptz := clock_timestamp();
  v_effective_submission_days integer;
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

  if v_activity.work_category = 'ADMINISTRASI' then
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
      raise exception 'At least one ACTIVE FOTO_BRIEFING is required';
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

create or replace function public.list_overtime_replacements_l2(
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
  type text,
  participant_employee_id uuid,
  participant_name text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_hours numeric,
  total_amount numeric,
  description text,
  status text,
  submission_deadline_at timestamptz,
  replaced_employee_id uuid,
  replaced_employee_name text,
  submitted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  rejection_count integer,
  revision_deadline_at timestamptz,
  closure_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
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
    activity.type,
    entry.employee_id,
    entry.employee_name_snapshot,
    entry.participant_started_at,
    entry.participant_ended_at,
    entry.duration_hours_snapshot,
    entry.calculated_amount_snapshot,
    activity.description,
    activity.status,
    public.resolve_overtime_initial_deadline(
      activity.contract_id,
      activity.up3_id,
      activity.overtime_date,
      statement_timestamp()
    ),
    activity.replaced_employee_id,
    replaced_employee.name,
    activity.submitted_at,
    activity.created_at,
    activity.updated_at,
    activity.rejection_count,
    activity.revision_deadline_at,
    activity.closure_reason
  from public.overtime_activities activity
  join public.overtime_entries entry on entry.activity_id = activity.id
  join public.employees replaced_employee
    on replaced_employee.id = activity.replaced_employee_id
  where activity.contract_id = p_contract_id
    and activity.up3_id = p_up3_id
    and activity.type in (
      'REPLACEMENT_LEAVE', 'REPLACEMENT_SICK', 'REPLACEMENT_PERMISSION'
    )
    and activity.deleted_at is null
    and (p_unit_id is null or activity.unit_id = p_unit_id)
    and (p_period_month is null or activity.period_month = p_period_month)
    and public.auth_can_read_overtime_evidence_scope(
      activity.contract_id,
      activity.up3_id,
      activity.unit_id
    )
  order by activity.started_at desc, activity.id;
end;
$$;

create or replace function public.list_overtime_work_l3(
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
  closure_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
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
    activity.closure_reason
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

-- Match the existing API access surface: internal trigger/resolver functions are
-- private, while the established authenticated RPCs retain their prior grants.
revoke all on function public.sync_overtime_activity_business_dates()
  from public, anon, authenticated;
revoke all on function public.enforce_overtime_initial_deadline_l6()
  from public, anon, authenticated;
revoke all on function public.enforce_overtime_evidence_initial_deadline_l6()
  from public, anon, authenticated;
revoke all on function public.auth_can_manage_overtime_activity_evidence(uuid)
  from public, anon, authenticated;
revoke all on function public.prepare_overtime_evidence_upload(uuid, text, text, text, bigint, bigint, text, text, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.expire_overtime_initial_drafts_l6(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.expire_overtime_initial_drafts_l5(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.submit_overtime_replacement_l2(uuid)
  from public, anon, authenticated;
revoke all on function public.submit_overtime_work_l3(uuid)
  from public, anon, authenticated;
revoke all on function public.list_overtime_replacements_l2(uuid, uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.list_overtime_work_l3(uuid, uuid, uuid, date)
  from public, anon, authenticated;

grant execute on function public.auth_can_manage_overtime_activity_evidence(uuid)
  to authenticated;
grant execute on function public.prepare_overtime_evidence_upload(uuid, text, text, text, bigint, bigint, text, text, integer, uuid)
  to authenticated;
grant execute on function public.expire_overtime_initial_drafts_l6(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.expire_overtime_initial_drafts_l5(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.submit_overtime_replacement_l2(uuid)
  to authenticated;
grant execute on function public.submit_overtime_work_l3(uuid)
  to authenticated;
grant execute on function public.list_overtime_replacements_l2(uuid, uuid, uuid, date)
  to authenticated;
grant execute on function public.list_overtime_work_l3(uuid, uuid, uuid, date)
  to authenticated;

comment on function public.auth_can_manage_overtime_activity_evidence(uuid)
  is 'Allows private evidence mutation inside the effective initial deadline or the unchanged revision D+3 deadline.';
comment on function public.prepare_overtime_evidence_upload(uuid, text, text, text, bigint, bigint, text, text, integer, uuid)
  is 'Prepares private overtime evidence for all eight categories, including the existing ROW field-work category.';
comment on function public.expire_overtime_initial_drafts_l6(uuid, uuid, uuid)
  is 'Closes never-submitted DRAFT overtime after its effective initial deadline in caller MANAGE scope; soft-deleted and non-DRAFT rows are excluded.';
comment on function public.expire_overtime_initial_drafts_l5(uuid, uuid, uuid)
  is 'Alias to expire_overtime_initial_drafts_l6 with identical MANAGE-scope authorization.';
comment on function public.submit_overtime_replacement_l2(uuid)
  is 'Submits a complete DRAFT L2 replacement within its effective initial deadline.';
comment on function public.submit_overtime_work_l3(uuid)
  is 'Submits a complete ROW-capable DRAFT Lembur Pekerjaan within its effective initial deadline.';
comment on function public.list_overtime_replacements_l2(uuid, uuid, uuid, date)
  is 'Soft-delete-aware, scope-safe L2 replacement list with a dynamically resolved initial deadline.';
comment on function public.list_overtime_work_l3(uuid, uuid, uuid, date)
  is 'Soft-delete-aware, scope-safe Lembur Pekerjaan list with a dynamically resolved initial deadline.';
