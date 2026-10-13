-- Admin ULP dapat langsung mengedit pegawai dalam ULP sendiri tanpa approval.
-- Tambah pegawai tetap Pending; transfer antar-ULP tetap dilarang dan hanya Admin UP3.
-- Setiap edit langsung tetap dicatat di employee_change_requests (Approved, aktor Admin ULP).

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
