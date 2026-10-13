-- Master Jabatan tersimpan di database (sebelumnya prototype state lokal).
-- save_position_l1: tambah/ubah posisi; SUPER_ADMIN penuh, ADMIN_UP3/ULP
-- hanya scope operasionalnya (auth_can_access_operational_up3).
-- Tulis langsung ke tabel tetap dilarang (tanpa policy INSERT/UPDATE).
-- Sekaligus menambah "Petugas Variabel Inspeksi" yang belum ada di DB.

create or replace function public.save_position_l1(
  p_position_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_name text,
  p_description text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_status text := coalesce(p_status, 'Aktif');
  v_row public.positions%rowtype;
  v_legacy text;
  v_order int;
  v_attempt int := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Nama jabatan wajib diisi';
  end if;
  if v_status not in ('Aktif', 'Nonaktif') then
    raise exception 'Status jabatan harus Aktif atau Nonaktif';
  end if;
  if p_contract_id is null or p_up3_id is null then
    raise exception 'Scope kontrak/UP3 wajib diisi';
  end if;
  if not public.auth_is_super_admin()
    and not public.auth_can_access_operational_up3(p_contract_id, p_up3_id) then
    raise exception 'Anda tidak memiliki akses kelola jabatan pada scope ini' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contracts where id = p_contract_id) then
    raise exception 'Kontrak tidak ditemukan';
  end if;
  if not exists (select 1 from public.organization_units where id = p_up3_id and type = 'UP3') then
    raise exception 'UP3 tidak ditemukan';
  end if;

  if p_position_id is not null then
    select * into v_row from public.positions where id = p_position_id for update;
    if not found then
      raise exception 'Jabatan tidak ditemukan';
    end if;
    if (v_row.contract_id, v_row.up3_id) is distinct from (p_contract_id, p_up3_id) then
      raise exception 'Jabatan berada di luar scope yang diminta';
    end if;
    if exists (
      select 1 from public.positions
      where contract_id = p_contract_id and up3_id = p_up3_id
        and id <> p_position_id and lower(name) = lower(v_name)
    ) then
      raise exception 'Nama jabatan sudah digunakan pada scope ini';
    end if;
    update public.positions
    set name = v_name,
        description = v_description,
        status = v_status,
        updated_at = clock_timestamp(),
        updated_by = auth.uid()
    where id = p_position_id
    returning * into v_row;
  else
    if exists (
      select 1 from public.positions
      where contract_id = p_contract_id and up3_id = p_up3_id
        and lower(name) = lower(v_name)
    ) then
      raise exception 'Nama jabatan sudah digunakan pada scope ini';
    end if;
    select coalesce(max(sort_order), 0) + 1 into v_order
    from public.positions where contract_id = p_contract_id and up3_id = p_up3_id;
    loop
      v_attempt := v_attempt + 1;
      v_legacy := 'pos-' || substr(md5(v_name || '|' || p_contract_id::text || '|' || p_up3_id::text || '|' || v_attempt::text), 1, 8);
      exit when not exists (
        select 1 from public.positions
        where contract_id = p_contract_id and up3_id = p_up3_id and legacy_key = v_legacy
      );
      if v_attempt > 20 then
        raise exception 'Gagal membuat kode jabatan unik';
      end if;
    end loop;
    insert into public.positions(contract_id, up3_id, legacy_key, name, description, status, sort_order, created_by, updated_by)
    values (p_contract_id, p_up3_id, v_legacy, v_name, v_description, v_status, v_order, auth.uid(), auth.uid())
    returning * into v_row;
  end if;

  return row_to_json(v_row);
end;
$function$;

revoke all on function public.save_position_l1(uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.save_position_l1(uuid, uuid, uuid, text, text, text) to authenticated;

comment on function public.save_position_l1(uuid, uuid, uuid, text, text, text)
is 'Master Jabatan write: SUPER_ADMIN full; UP3/ULP admins only within their operational scope.';

-- Data: Petugas Variabel Inspeksi (scope sama seperti Variable ROW/HARDUKON).
insert into public.positions(contract_id, up3_id, legacy_key, name, description, status, sort_order)
select
  'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid,
  '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid,
  'jab-petugas-var-inspeksi',
  'Petugas Variabel Inspeksi',
  null,
  'Aktif',
  coalesce((select max(sort_order) from public.positions where contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid and up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid), 0) + 1
where not exists (
  select 1 from public.positions
  where contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'::uuid
    and up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'::uuid
    and lower(name) = lower('Petugas Variabel Inspeksi')
);
