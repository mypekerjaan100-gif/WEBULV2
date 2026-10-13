-- Employee photos: private bucket, metadata lifecycle, per-employee active photo.
-- Existing employees without a photo keep working (placeholder in UI).
-- New manual adds require a staged photo; edits require one only when no active photo exists.

create table if not exists public.employee_photos (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  change_request_id uuid references public.employee_change_requests(id) on delete set null,
  contract_id uuid not null,
  up3_id uuid not null,
  unit_id uuid not null,
  storage_path text not null,
  original_filename text not null,
  original_mime_type text not null,
  original_size_bytes bigint,
  stored_mime_type text not null default 'image/webp',
  stored_size_bytes bigint,
  checksum text,
  status text not null default 'PENDING'
    check (status in ('PENDING','STAGED','ACTIVE','SUPERSEDED','DELETE_PENDING','DELETED','ABANDONED')),
  supersedes_photo_id uuid references public.employee_photos(id) on delete set null,
  uploader_user_id uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ep_storage_path_unique unique (storage_path),
  constraint ep_original_size_nonneg check (original_size_bytes is null or original_size_bytes >= 0),
  constraint ep_stored_size_limit check (stored_size_bytes is null or (stored_size_bytes > 0 and stored_size_bytes <= 524288)),
  constraint ep_stored_mime_webp check (stored_mime_type = 'image/webp'),
  constraint ep_checksum_hex check (checksum is null or checksum ~ '^[0-9a-fA-F]{64}$'),
  constraint ep_supersedes_distinct check (supersedes_photo_id is null or supersedes_photo_id <> id),
  constraint ep_active_requires_employee check (status <> 'ACTIVE' or employee_id is not null)
);

create unique index if not exists uq_employee_photos_one_active
  on public.employee_photos (employee_id)
  where status = 'ACTIVE';

create index if not exists idx_employee_photos_employee
  on public.employee_photos (employee_id)
  where employee_id is not null;

create index if not exists idx_employee_photos_request
  on public.employee_photos (change_request_id)
  where change_request_id is not null;

create index if not exists idx_employee_photos_storage_auth
  on public.employee_photos (storage_path, status, uploader_user_id);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'touch_audit_columns') then
    if not exists (select 1 from pg_trigger where tgname = 'trg_employee_photos_touch') then
      create trigger trg_employee_photos_touch
        before update on public.employee_photos
        for each row execute function public.touch_audit_columns();
    end if;
  end if;
end;
$$;

alter table public.employee_photos enable row level security;
revoke all on public.employee_photos from public, anon, authenticated;

-- Read scope: exact ULP / UP3 submit scope or operational UP3 access (management).
create or replace function public.auth_can_read_employee_photo(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $function$
  select auth.uid() is not null and (
    public.auth_can_submit_employee_scope(p_contract_id, p_up3_id, p_unit_id)
    or public.auth_can_access_operational_up3(p_contract_id, p_up3_id)
  )
$function$;

comment on function public.auth_can_read_employee_photo(uuid, uuid, uuid)
  is 'Employee photo readable in exact ULP/UP3 submit scope or operational UP3 access.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-photos', 'employee-photos', false, 524288, array['image/webp']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.auth_can_upload_employee_photo_object(p_storage_path text)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $$
  select exists (
    select 1 from public.employee_photos photo
    where photo.storage_path = p_storage_path
      and photo.status = 'PENDING'
      and photo.uploader_user_id = auth.uid()
      and public.auth_can_submit_employee_scope(photo.contract_id, photo.up3_id, photo.unit_id)
  )
$$;

create or replace function public.auth_can_read_employee_photo_object(p_storage_path text)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $$
  select exists (
    select 1 from public.employee_photos photo
    where photo.storage_path = p_storage_path
      and photo.status in ('ACTIVE','SUPERSEDED')
      and public.auth_can_read_employee_photo(photo.contract_id, photo.up3_id, photo.unit_id)
  ) or exists (
    select 1 from public.employee_photos photo
    where photo.storage_path = p_storage_path
      and photo.status in ('PENDING','STAGED','DELETE_PENDING')
      and (
        photo.uploader_user_id = auth.uid()
        or public.auth_can_manage_employee_scope(photo.contract_id, photo.up3_id)
      )
  )
$$;

create or replace function public.auth_can_delete_employee_photo_object(p_storage_path text)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $$
  select exists (
    select 1 from public.employee_photos photo
    where photo.storage_path = p_storage_path
      and photo.status in ('PENDING','DELETE_PENDING')
      and (
        (photo.uploader_user_id = auth.uid()
          and public.auth_can_submit_employee_scope(photo.contract_id, photo.up3_id, photo.unit_id))
        or public.auth_can_manage_employee_scope(photo.contract_id, photo.up3_id)
      )
  )
$$;

drop policy if exists employee_photo_object_insert on storage.objects;
drop policy if exists employee_photo_object_select on storage.objects;
drop policy if exists employee_photo_object_delete on storage.objects;

create policy employee_photo_object_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'employee-photos'
    and public.auth_can_upload_employee_photo_object(name)
  );

create policy employee_photo_object_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'employee-photos'
    and public.auth_can_read_employee_photo_object(name)
  );

create policy employee_photo_object_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'employee-photos'
    and public.auth_can_delete_employee_photo_object(name)
  );

revoke all on function public.auth_can_read_employee_photo(uuid, uuid, uuid) from public, anon;
grant execute on function public.auth_can_read_employee_photo(uuid, uuid, uuid) to authenticated;
revoke all on function public.auth_can_upload_employee_photo_object(text) from public, anon;
grant execute on function public.auth_can_upload_employee_photo_object(text) to authenticated;
revoke all on function public.auth_can_read_employee_photo_object(text) from public, anon;
grant execute on function public.auth_can_read_employee_photo_object(text) to authenticated;
revoke all on function public.auth_can_delete_employee_photo_object(text) from public, anon;
grant execute on function public.auth_can_delete_employee_photo_object(text) to authenticated;
