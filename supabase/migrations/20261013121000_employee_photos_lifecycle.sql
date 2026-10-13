-- Employee photo lifecycle RPCs and approval integration.
-- Applies to table/bucket from 20261013120000_employee_photos.sql.
-- Flow: prepare (PENDING) -> upload -> finalize (STAGED) -> submit/approve (ACTIVE).
-- ULP staged photos activate only on Admin UP3 approval; rejection abandons them.

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

create or replace function public.cancel_employee_photo_upload(p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path to public, storage, pg_temp
as $function$
declare v_photo public.employee_photos%rowtype;
begin
  select * into v_photo from public.employee_photos where id=p_photo_id and status='PENDING' for update;
  if not found then raise exception 'Foto tidak dapat dibatalkan oleh akun ini' using errcode='42501'; end if;
  if v_photo.uploader_user_id is distinct from auth.uid()
    and not public.auth_can_manage_employee_scope(v_photo.contract_id, v_photo.up3_id) then
    raise exception 'Foto tidak dapat dibatalkan oleh akun ini' using errcode='42501';
  end if;
  if exists (select 1 from storage.objects where bucket_id='employee-photos' and name=v_photo.storage_path) then
    raise exception 'Hapus objek Storage sebelum membatalkan metadata';
  end if;
  delete from public.employee_photos where id=p_photo_id;
end;
$function$;

create or replace function public.list_employee_photos(p_employee_ids uuid[])
returns setof public.employee_photos
language plpgsql
stable security definer
set search_path to public, pg_temp
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_employee_ids is null or array_length(p_employee_ids,1) is null then return; end if;
  return query select photo.* from public.employee_photos photo
  where photo.employee_id = any(p_employee_ids)
    and photo.status in ('ACTIVE','STAGED','SUPERSEDED')
    and (
      (photo.status='ACTIVE' and public.auth_can_read_employee_photo(photo.contract_id, photo.up3_id, photo.unit_id))
      or (photo.status='STAGED' and (
        photo.uploader_user_id = auth.uid()
        or public.auth_can_manage_employee_scope(photo.contract_id, photo.up3_id)
      ))
      or (photo.status='SUPERSEDED' and public.auth_can_read_employee_photo(photo.contract_id, photo.up3_id, photo.unit_id))
    )
  order by photo.employee_id, photo.status, photo.uploaded_at desc;
end;
$function$;

create or replace function public.get_employee_photo_preview_path(p_photo_id uuid)
returns text
language plpgsql
stable security definer
set search_path to public, pg_temp
as $function$
declare v_path text;
begin
  select photo.storage_path into v_path from public.employee_photos photo
  where photo.id = p_photo_id
    and (
      (photo.status in ('ACTIVE','SUPERSEDED') and public.auth_can_read_employee_photo(photo.contract_id, photo.up3_id, photo.unit_id))
      or (photo.status in ('PENDING','STAGED','DELETE_PENDING') and (
        photo.uploader_user_id = auth.uid()
        or public.auth_can_manage_employee_scope(photo.contract_id, photo.up3_id)
      ))
    );
  if v_path is null then raise exception 'Foto pegawai tidak dapat dibaca oleh akun ini' using errcode='42501'; end if;
  return v_path;
end;
$function$;

create or replace function public.begin_employee_photo_delete(p_photo_id uuid)
returns text
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_photo public.employee_photos%rowtype;
begin
  select * into v_photo from public.employee_photos where id=p_photo_id and status in ('ACTIVE','STAGED','ABANDONED','SUPERSEDED','DELETE_PENDING') for update;
  if not found then raise exception 'Foto tidak dapat dihapus oleh akun ini' using errcode='42501'; end if;
  if v_photo.status='ACTIVE' then
    raise exception 'Foto aktif tidak dapat dihapus tanpa foto pengganti' using errcode='22023';
  end if;
  if v_photo.uploader_user_id is distinct from auth.uid()
    and not public.auth_can_manage_employee_scope(v_photo.contract_id, v_photo.up3_id) then
    raise exception 'Foto tidak dapat dihapus oleh akun ini' using errcode='42501';
  end if;
  if not public.auth_can_submit_employee_scope(v_photo.contract_id, v_photo.up3_id, v_photo.unit_id)
    and not public.auth_can_manage_employee_scope(v_photo.contract_id, v_photo.up3_id) then
    raise exception 'Foto tidak dapat dihapus oleh akun ini' using errcode='42501';
  end if;
  if v_photo.status <> 'DELETE_PENDING' then
    update public.employee_photos set status='DELETE_PENDING' where id=p_photo_id;
  end if;
  return v_photo.storage_path;
end;
$function$;

create or replace function public.cancel_employee_photo_delete(p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_photo public.employee_photos%rowtype;
begin
  select * into v_photo from public.employee_photos where id=p_photo_id and status='DELETE_PENDING';
  if not found then raise exception 'Penghapusan foto tidak dapat dibatalkan' using errcode='42501'; end if;
  if v_photo.uploader_user_id is distinct from auth.uid()
    and not public.auth_can_manage_employee_scope(v_photo.contract_id, v_photo.up3_id) then
    raise exception 'Penghapusan foto tidak dapat dibatalkan' using errcode='42501';
  end if;
  update public.employee_photos
  set status = case when v_photo.change_request_id is not null then 'STAGED'::text when v_photo.employee_id is not null then 'STAGED'::text else 'PENDING'::text end
  where id=p_photo_id;
end;
$function$;

create or replace function public.finalize_employee_photo_delete(p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path to public, storage, pg_temp
as $function$
declare v_photo public.employee_photos%rowtype;
begin
  select * into v_photo from public.employee_photos where id=p_photo_id and status in ('DELETE_PENDING','DELETED') for update;
  if not found then raise exception 'Penghapusan foto tidak dapat difinalisasi' using errcode='42501'; end if;
  if v_photo.uploader_user_id is distinct from auth.uid()
    and not public.auth_can_manage_employee_scope(v_photo.contract_id, v_photo.up3_id) then
    raise exception 'Penghapusan foto tidak dapat difinalisasi' using errcode='42501';
  end if;
  if v_photo.status='DELETED' then return; end if;
  if exists (select 1 from storage.objects where bucket_id='employee-photos' and name=v_photo.storage_path) then
    raise exception 'Objek Storage masih ada';
  end if;
  update public.employee_photos set status='DELETED' where id=p_photo_id;
end;
$function$;

revoke all on function public.prepare_employee_photo_upload(uuid,uuid,uuid,uuid,text,text,bigint,bigint,text,text,uuid) from public, anon;
grant execute on function public.prepare_employee_photo_upload(uuid,uuid,uuid,uuid,text,text,bigint,bigint,text,text,uuid) to authenticated;
revoke all on function public.finalize_employee_photo_upload(uuid) from public, anon;
grant execute on function public.finalize_employee_photo_upload(uuid) to authenticated;
revoke all on function public.cancel_employee_photo_upload(uuid) from public, anon;
grant execute on function public.cancel_employee_photo_upload(uuid) to authenticated;
revoke all on function public.list_employee_photos(uuid[]) from public, anon;
grant execute on function public.list_employee_photos(uuid[]) to authenticated;
revoke all on function public.get_employee_photo_preview_path(uuid) from public, anon;
grant execute on function public.get_employee_photo_preview_path(uuid) to authenticated;
revoke all on function public.begin_employee_photo_delete(uuid) from public, anon;
grant execute on function public.begin_employee_photo_delete(uuid) to authenticated;
revoke all on function public.cancel_employee_photo_delete(uuid) from public, anon;
grant execute on function public.cancel_employee_photo_delete(uuid) to authenticated;
revoke all on function public.finalize_employee_photo_delete(uuid) from public, anon;
grant execute on function public.finalize_employee_photo_delete(uuid) to authenticated;

-- Photo-aware submit/approve/reject (preserves v_emp scope fix).
create or replace function public.submit_employee_change_request(p_request_type text, p_employee_id uuid, p_contract_id uuid, p_up3_id uuid, p_source_unit_id uuid, p_target_unit_id uuid, p_proposed jsonb, p_old_snapshot jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to public, pg_temp
as $function$
declare v_id uuid; v_is_manager boolean; v_target uuid; v_emp uuid;
  v_photo_id uuid; v_photo public.employee_photos%rowtype; v_old_photo uuid;
  v_proposed_unit uuid; v_snapshot jsonb; v_live_bank text; v_live_acct text; v_live_rate numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_request_type not in ('add','edit') then raise exception 'Tipe request tidak valid' using errcode='22023'; end if;
  if p_request_type='edit' and p_employee_id is null then raise exception 'Edit membutuhkan employee_id' using errcode='22023'; end if;
  if p_request_type='add' and p_employee_id is not null then raise exception 'Add tidak boleh punya employee_id' using errcode='22023'; end if;
  v_target := coalesce(p_target_unit_id, nullif(p_proposed->>'unit_id','')::uuid);
  if v_target is null then raise exception 'Unit target wajib diisi' using errcode='22023'; end if;
  if not public.auth_can_submit_employee_scope(p_contract_id, p_up3_id, v_target) then raise exception 'Tidak berhak mengajukan untuk unit ini' using errcode='42501'; end if;
  -- Unit usulan harus konsisten dengan unit target agar validasi scope tidak bisa dilewati.
  begin
    v_proposed_unit := nullif(p_proposed->>'unit_id','')::uuid;
  exception when others then
    raise exception 'Unit usulan tidak valid' using errcode='22023';
  end;
  if v_proposed_unit is distinct from v_target then
    raise exception 'Unit usulan tidak konsisten dengan unit target' using errcode='22023';
  end if;
  if not public.auth_is_super_admin() and exists (select 1 from public.contract_memberships where user_id=auth.uid() and contract_role='ADMIN_ULP' and status='ACTIVE') then
    if p_request_type='edit' then
      if not exists (select 1 from public.employee_unit_history where employee_id=p_employee_id and effective_to is null and unit_id=v_target and contract_id=p_contract_id and up3_id=p_up3_id) then
        raise exception 'Admin ULP hanya boleh mengedit unit sendiri; transfer antar-ULP oleh Admin UP3' using errcode='42501';
      end if;
      if p_source_unit_id is distinct from v_target then raise exception 'Admin ULP tidak boleh pindah unit' using errcode='42501'; end if;
    end if;
  end if;
  begin
    v_photo_id := nullif(p_proposed->>'photo_asset_id','')::uuid;
  exception when others then
    raise exception 'Foto pegawai tidak valid' using errcode='22023';
  end;
  if p_request_type = 'add' and v_photo_id is null then
    raise exception 'Foto pegawai wajib diunggah untuk pegawai baru' using errcode='22023';
  end if;
  if v_photo_id is not null then
    select * into v_photo from public.employee_photos where id = v_photo_id for update;
    if not found or v_photo.status <> 'STAGED' then raise exception 'Foto pegawai belum siap. Selesaikan upload foto dahulu.' using errcode='22023'; end if;
    if (v_photo.contract_id, v_photo.up3_id) is distinct from (p_contract_id, p_up3_id) then raise exception 'Foto di luar scope' using errcode='42501'; end if;
    if v_photo.uploader_user_id is distinct from auth.uid() then raise exception 'Foto harus diunggah oleh akun ini' using errcode='42501'; end if;
    if p_request_type = 'edit' and v_photo.employee_id is not null and v_photo.employee_id is distinct from p_employee_id then
      raise exception 'Foto untuk pegawai yang berbeda' using errcode='22023';
    end if;
  elsif p_request_type = 'edit' then
    select id into v_old_photo from public.employee_photos where employee_id = p_employee_id and status = 'ACTIVE' limit 1;
    if not found then raise exception 'Foto pegawai wajib diunggah karena pegawai ini belum memiliki foto' using errcode='22023'; end if;
  end if;
  v_is_manager := public.auth_can_manage_employee_scope(p_contract_id, p_up3_id);
  if v_is_manager then
    begin
      v_emp := private.apply_employee_snapshot(case when p_request_type='add' then null else p_employee_id end, p_contract_id, p_up3_id, p_proposed, current_date);
    exception when others then raise; end;
    if v_photo_id is not null then
      update public.employee_photos set status='SUPERSEDED'
      where employee_id = v_emp and status='ACTIVE' and id <> v_photo_id;
      update public.employee_photos set employee_id=v_emp, change_request_id=null,
        contract_id=p_contract_id, up3_id=p_up3_id, unit_id=v_target,
        status='ACTIVE', uploaded_at=now()
      where id=v_photo_id;
    else
      update public.employee_photos set contract_id=p_contract_id, up3_id=p_up3_id, unit_id=v_target
      where employee_id=v_emp and status='ACTIVE';
    end if;
    insert into public.employee_change_requests (employee_id, contract_id, up3_id, request_type, source_unit_id, target_unit_id, old_snapshot, proposed_snapshot, status, created_by_actor, decided_by, decided_at, created_by, updated_by)
    values (case when p_request_type='add' then v_emp else p_employee_id end, p_contract_id, p_up3_id, p_request_type, p_source_unit_id, v_target, p_old_snapshot, p_proposed, 'Approved', 'Admin UP3', 'Admin UP3', current_date, auth.uid(), auth.uid())
    returning id into v_id;
  elsif p_request_type = 'edit'
    and not public.auth_is_super_admin()
    and exists (select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.contract_role = 'ADMIN_ULP'
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
        and cm.operational_unit_id = v_target and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date
        and (cm.effective_to is null or current_date < cm.effective_to))
  then
    -- Edit langsung Admin ULP dalam unit sendiri: tanpa approval, tetap diaudit.
    if not exists (select 1 from public.employee_unit_history where employee_id=p_employee_id and effective_to is null and unit_id=v_target and contract_id=p_contract_id and up3_id=p_up3_id) then
      raise exception 'Admin ULP hanya boleh mengedit pegawai unit sendiri' using errcode='42501';
    end if;
    if p_source_unit_id is distinct from v_target then raise exception 'Admin ULP tidak boleh pindah unit' using errcode='42501'; end if;
    -- Pertahankan bank/rekening/tarif valid bila snapshot berisi nilai kosong.
    v_snapshot := p_proposed;
    select e.bank, e.account_number into v_live_bank, v_live_acct
    from public.employees e where e.id = p_employee_id;
    select h.hourly_rate into v_live_rate
    from public.employee_hourly_rate_history h
    where h.employee_id = p_employee_id and h.effective_to is null
    order by h.effective_from desc limit 1;
    if coalesce(nullif(btrim(coalesce(v_snapshot->>'bank','')),''),'') = '' and coalesce(v_live_bank,'') <> '' then
      v_snapshot := jsonb_set(v_snapshot, '{bank}', to_jsonb(v_live_bank));
    end if;
    if coalesce(nullif(btrim(coalesce(v_snapshot->>'account_number','')),''),'') = '' and coalesce(v_live_acct,'') <> '' then
      v_snapshot := jsonb_set(v_snapshot, '{account_number}', to_jsonb(v_live_acct));
    end if;
    if coalesce(nullif(v_snapshot->>'hourly_rate','')::numeric, 0) = 0 and coalesce(v_live_rate, 0) <> 0 then
      v_snapshot := jsonb_set(v_snapshot, '{hourly_rate}', to_jsonb(v_live_rate));
    end if;
    begin
      v_emp := private.apply_employee_snapshot(p_employee_id, p_contract_id, p_up3_id, v_snapshot, current_date);
    exception when others then raise; end;
    if v_photo_id is not null then
      update public.employee_photos set status='SUPERSEDED'
      where employee_id = v_emp and status='ACTIVE' and id <> v_photo_id;
      update public.employee_photos set employee_id=v_emp, change_request_id=null,
        contract_id=p_contract_id, up3_id=p_up3_id, unit_id=v_target,
        status='ACTIVE', uploaded_at=now()
      where id=v_photo_id;
    else
      update public.employee_photos set contract_id=p_contract_id, up3_id=p_up3_id, unit_id=v_target
      where employee_id=v_emp and status='ACTIVE';
    end if;
    insert into public.employee_change_requests (employee_id, contract_id, up3_id, request_type, source_unit_id, target_unit_id, old_snapshot, proposed_snapshot, status, created_by_actor, decided_by, decided_at, created_by, updated_by)
    values (p_employee_id, p_contract_id, p_up3_id, p_request_type, p_source_unit_id, v_target, p_old_snapshot, v_snapshot, 'Approved', 'Admin ULP', 'Admin ULP', current_date, auth.uid(), auth.uid())
    returning id into v_id;
  else
    insert into public.employee_change_requests (employee_id, contract_id, up3_id, request_type, source_unit_id, target_unit_id, old_snapshot, proposed_snapshot, status, created_by_actor, created_by)
    values (p_employee_id, p_contract_id, p_up3_id, p_request_type, p_source_unit_id, v_target, p_old_snapshot, p_proposed, 'Pending', 'Admin ULP', auth.uid())
    returning id into v_id;
    if v_photo_id is not null then
      update public.employee_photos set change_request_id=v_id, employee_id=p_employee_id,
        contract_id=p_contract_id, up3_id=p_up3_id, unit_id=v_target
      where id=v_photo_id;
    end if;
  end if;
  return v_id;
end;
$function$;

create or replace function public.approve_employee_change_request(p_request_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to public, pg_temp
as $function$
declare r record; v_emp uuid; v_pid uuid;
  v_snapshot jsonb; v_live_bank text; v_live_acct text; v_live_rate numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into r from public.employee_change_requests where id=p_request_id for update;
  if not found then raise exception 'Request tidak ditemukan' using errcode='22023'; end if;
  if r.status <> 'Pending' then raise exception 'Request sudah diputuskan' using errcode='22023'; end if;
  if not public.auth_can_manage_employee_scope(r.contract_id, r.up3_id) then raise exception 'Hanya Admin UP3/Super Admin yang boleh approve' using errcode='42501'; end if;
  v_snapshot := r.proposed_snapshot;
  -- Pengajuan Admin ULP yang tidak melihat/mengubah data finansial tidak boleh
  -- menghapus bank/rekening/tarif valid dengan nilai kosong (mis. edit foto/tgl lahir).
  if r.request_type = 'edit' and r.employee_id is not null and coalesce(r.created_by_actor,'') = 'Admin ULP' then
    select e.bank, e.account_number into v_live_bank, v_live_acct
    from public.employees e where e.id = r.employee_id;
    select h.hourly_rate into v_live_rate
    from public.employee_hourly_rate_history h
    where h.employee_id = r.employee_id and h.effective_to is null
    order by h.effective_from desc limit 1;
    if coalesce(nullif(btrim(coalesce(v_snapshot->>'bank','')),''),'') = '' and coalesce(v_live_bank,'') <> '' then
      v_snapshot := jsonb_set(v_snapshot, '{bank}', to_jsonb(v_live_bank));
    end if;
    if coalesce(nullif(btrim(coalesce(v_snapshot->>'account_number','')),''),'') = '' and coalesce(v_live_acct,'') <> '' then
      v_snapshot := jsonb_set(v_snapshot, '{account_number}', to_jsonb(v_live_acct));
    end if;
    if coalesce(nullif(v_snapshot->>'hourly_rate','')::numeric, 0) = 0 and coalesce(v_live_rate, 0) <> 0 then
      v_snapshot := jsonb_set(v_snapshot, '{hourly_rate}', to_jsonb(v_live_rate));
    end if;
  end if;
  v_emp := private.apply_employee_snapshot(case when r.request_type='add' then null else r.employee_id end, r.contract_id, r.up3_id, v_snapshot, current_date);
  select id into v_pid from public.employee_photos
  where change_request_id = p_request_id and status='STAGED'
  order by created_at desc limit 1;
  if found then
    update public.employee_photos set status='SUPERSEDED'
    where employee_id = v_emp and status='ACTIVE' and id <> v_pid;
    update public.employee_photos set employee_id=v_emp, status='ACTIVE', uploaded_at=now()
    where id=v_pid;
    update public.employee_photos set status='ABANDONED'
    where change_request_id = p_request_id and status='STAGED' and id <> v_pid;
  else
    update public.employee_photos set contract_id=r.contract_id, up3_id=r.up3_id,
      unit_id=coalesce(r.target_unit_id, (select unit_id from public.employee_unit_history where employee_id=v_emp and effective_to is null limit 1))
    where employee_id=v_emp and status='ACTIVE';
  end if;
  update public.employee_change_requests set status='Approved', employee_id=coalesce(r.employee_id, v_emp), decided_by='Admin UP3', decided_at=current_date, updated_by=auth.uid(), updated_at=now() where id=p_request_id;
  return v_emp;
end;
$function$;

create or replace function public.reject_employee_change_request(p_request_id uuid, p_note text)
 returns boolean
 language plpgsql
 security definer
 set search_path to public, pg_temp
as $function$
declare r record;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'Catatan wajib untuk Reject' using errcode='22023'; end if;
  select * into r from public.employee_change_requests where id=p_request_id for update;
  if not found then raise exception 'Request tidak ditemukan' using errcode='22023'; end if;
  if r.status <> 'Pending' then raise exception 'Request sudah diputuskan' using errcode='22023'; end if;
  if not public.auth_can_manage_employee_scope(r.contract_id, r.up3_id) then raise exception 'Hanya Admin UP3/Super Admin yang boleh reject' using errcode='42501'; end if;
  update public.employee_change_requests set status='Rejected', note=p_note, decided_by='Admin UP3', decided_at=current_date, updated_by=auth.uid(), updated_at=now() where id=p_request_id;
  update public.employee_photos set status='ABANDONED' where change_request_id=p_request_id and status='STAGED';
  return true;
end;
$function$;
