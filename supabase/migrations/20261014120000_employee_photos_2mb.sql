-- Raise employee photo limit from 512 KB to 2 MB (compressed WebP result).
-- Idempotent delta for databases where 20261013120000/20261013121000 already applied.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'ep_stored_size_limit') then
    alter table public.employee_photos drop constraint ep_stored_size_limit;
  end if;
end;
$$;

alter table public.employee_photos
  add constraint ep_stored_size_limit
  check (stored_size_bytes is null or (stored_size_bytes > 0 and stored_size_bytes <= 2097152));

update storage.buckets
set file_size_limit = 2097152
where id = 'employee-photos';

create or replace function public.prepare_employee_photo_upload(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_employee_id uuid default null, p_original_filename text default null, p_original_mime_type text default null, p_original_size_bytes bigint default null, p_stored_size_bytes bigint default null, p_stored_mime_type text default 'image/webp', p_checksum text default null, p_supersedes_photo_id uuid default null)
returns public.employee_photos
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_result public.employee_photos%rowtype; v_photo_id uuid := gen_random_uuid();
  v_old public.employee_photos%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.auth_can_submit_employee_scope(p_contract_id, p_up3_id, p_unit_id) then
    raise exception 'Tidak berhak mengunggah foto untuk unit ini' using errcode='42501';
  end if;
  if btrim(coalesce(p_original_filename,'')) = '' then raise exception 'Nama file asli wajib diisi' using errcode='22023'; end if;
  if p_original_size_bytes is null or p_original_size_bytes <= 0 then raise exception 'Ukuran file asli tidak valid' using errcode='22023'; end if;
  if p_stored_size_bytes is null or p_stored_size_bytes <= 0 or p_stored_size_bytes > 2097152 then
    raise exception 'Foto hasil kompresi maksimal 2 MB' using errcode='22023';
  end if;
  if coalesce(p_stored_mime_type,'') <> 'image/webp' then raise exception 'Foto harus WebP' using errcode='22023'; end if;
  if p_checksum is not null and p_checksum !~ '^[0-9a-fA-F]{64}$' then raise exception 'Checksum harus SHA-256 hex' using errcode='22023'; end if;
  if p_employee_id is not null and not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception 'Pegawai tidak ditemukan' using errcode='22023';
  end if;
  if p_supersedes_photo_id is not null then
    select * into v_old from public.employee_photos where id = p_supersedes_photo_id for update;
    if not found or v_old.status <> 'ACTIVE' then raise exception 'Foto aktif yang diganti tidak ditemukan' using errcode='22023'; end if;
    if p_employee_id is null or v_old.employee_id is distinct from p_employee_id then
      raise exception 'Foto pengganti harus untuk pegawai yang sama' using errcode='22023';
    end if;
    if (v_old.contract_id, v_old.up3_id) is distinct from (p_contract_id, p_up3_id) then
      raise exception 'Foto pengganti di luar scope' using errcode='42501';
    end if;
  end if;
  insert into public.employee_photos (id, employee_id, contract_id, up3_id, unit_id, storage_path, original_filename, original_mime_type, original_size_bytes, stored_mime_type, stored_size_bytes, checksum, status, supersedes_photo_id, uploader_user_id)
  values (v_photo_id, p_employee_id, p_contract_id, p_up3_id, p_unit_id,
    'employees/' || p_contract_id::text || '/' || p_up3_id::text || '/' || p_unit_id::text || '/' || v_photo_id::text || '.webp',
    btrim(p_original_filename), coalesce(nullif(btrim(p_original_mime_type),''),'application/octet-stream'),
    p_original_size_bytes, 'image/webp', p_stored_size_bytes, lower(p_checksum), 'PENDING', p_supersedes_photo_id, auth.uid())
  returning * into v_result;
  return v_result;
end;
$function$;

create or replace function public.finalize_employee_photo_upload(p_photo_id uuid)
returns public.employee_photos
language plpgsql
security definer
set search_path to public, storage, pg_temp
as $function$
declare v_photo public.employee_photos%rowtype; v_result public.employee_photos%rowtype; v_size bigint; v_mime text;
begin
  select * into v_photo from public.employee_photos where id = p_photo_id and status in ('PENDING','STAGED') for update;
  if not found then raise exception 'Foto tidak dapat difinalisasi oleh akun ini' using errcode='42501'; end if;
  if v_photo.uploader_user_id is distinct from auth.uid()
    and not public.auth_can_manage_employee_scope(v_photo.contract_id, v_photo.up3_id) then
    raise exception 'Foto tidak dapat difinalisasi oleh akun ini' using errcode='42501';
  end if;
  if not public.auth_can_submit_employee_scope(v_photo.contract_id, v_photo.up3_id, v_photo.unit_id)
    and not public.auth_can_manage_employee_scope(v_photo.contract_id, v_photo.up3_id) then
    raise exception 'Foto tidak dapat difinalisasi oleh akun ini' using errcode='42501';
  end if;
  if v_photo.status = 'STAGED' then return v_photo; end if;
  select (object.metadata->>'size')::bigint, coalesce(object.metadata->>'mimetype','image/webp')
    into v_size, v_mime from storage.objects object
  where object.bucket_id='employee-photos' and object.name=v_photo.storage_path;
  if not found then raise exception 'Objek Storage foto tidak ditemukan'; end if;
  if v_size is null or v_size <= 0 or v_size > 2097152 then raise exception 'Foto melebihi 2 MB'; end if;
  if v_mime is distinct from 'image/webp' then raise exception 'MIME foto harus image/webp'; end if;
  update public.employee_photos set status='STAGED', stored_size_bytes=v_size, stored_mime_type=v_mime, uploaded_at=now()
  where id=p_photo_id returning * into v_result;
  return v_result;
end;
$function$;
