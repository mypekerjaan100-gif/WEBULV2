-- Katalog alat: kolom umur (bulan), simpan v2 dengan kode otomatis, dan impor
-- CSV/Excel per scope kontrak + UP3. RPC lama public.ops_save_equipment(...)
-- sengaja tidak diubah/dihapus agar frontend lama tetap kompatibel.
-- Tulis hanya lewat RPC (tanpa direct grant).

alter table public.ops_equipment_items add column if not exists age_months integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ops_equipment_items'::regclass
      and conname = 'ops_equipment_items_age_months_check'
  ) then
    alter table public.ops_equipment_items
      add constraint ops_equipment_items_age_months_check
      check (age_months is null or age_months >= 0);
  end if;
end;
$$;

-- ALT- + 10 karakter heksadesimal acak (huruf besar). Hanya untuk RPC.
create or replace function private.ops_equipment_auto_code()
returns text language sql volatile set search_path to public, pg_temp
as $function$
  select 'ALT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$function$;

-- Simpan katalog v2. Kode kosong saat insert dibuat otomatis dan unik per
-- scope; kode kosong saat update dipertahankan (tidak pernah diregenerasi).
create or replace function public.ops_save_equipment_v2(
  p_id uuid, p_contract_id uuid, p_up3_id uuid,
  p_code text, p_name text, p_category_id uuid, p_unit text,
  p_specification text, p_description text, p_is_active boolean,
  p_age_months integer
)
returns jsonb language plpgsql security definer set search_path to public, pg_temp
as $function$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_auto boolean := btrim(coalesce(p_code, '')) = '';
  v_name text := btrim(coalesce(p_name, ''));
  v_unit text := btrim(coalesce(p_unit, ''));
  v_attempt integer := 0; v_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.ops_can_manage_master(p_contract_id, p_up3_id) then
    raise exception 'Hanya Super Admin atau Admin UP3 yang dapat mengelola master' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'Nama alat wajib diisi'; end if;
  if p_category_id is null then raise exception 'Kategori wajib dipilih'; end if;
  if p_age_months is not null and p_age_months < 0 then raise exception 'Umur alat tidak boleh negatif'; end if;
  if v_unit = '' then v_unit := 'unit'; end if;
  if not exists (
    select 1 from public.ops_equipment_categories
    where id = p_category_id and contract_id = p_contract_id and up3_id = p_up3_id
  ) then raise exception 'Kategori berada di luar scope ini'; end if;

  if p_id is null then
    loop
      v_attempt := v_attempt + 1;
      if v_auto then v_code := private.ops_equipment_auto_code(); end if;
      begin
        insert into public.ops_equipment_items(
          contract_id, up3_id, code, name, category_id, unit, specification,
          description, is_active, sort_order, age_months, created_by, updated_by
        )
        values (
          p_contract_id, p_up3_id, v_code, v_name, p_category_id, v_unit,
          nullif(btrim(coalesce(p_specification, '')), ''),
          nullif(btrim(coalesce(p_description, '')), ''),
          coalesce(p_is_active, true),
          coalesce((select max(sort_order) from public.ops_equipment_items
            where contract_id = p_contract_id and up3_id = p_up3_id), 0) + 1,
          p_age_months, auth.uid(), auth.uid()
        )
        returning row_to_json(ops_equipment_items.*) into v_row;
        exit;
      exception when unique_violation then
        if not v_auto or v_attempt >= 5 then
          raise exception 'Kode alat sudah digunakan pada scope ini';
        end if;
      end;
    end loop;
  else
    update public.ops_equipment_items
    set code = case when v_code = '' then code else v_code end,
        name = v_name, category_id = p_category_id, unit = v_unit,
        specification = nullif(btrim(coalesce(p_specification, '')), ''),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        is_active = coalesce(p_is_active, is_active),
        age_months = p_age_months, updated_by = auth.uid()
    where id = p_id and contract_id = p_contract_id and up3_id = p_up3_id
    returning row_to_json(ops_equipment_items.*) into v_row;
    if v_row is null then raise exception 'Alat tidak ditemukan pada scope ini'; end if;
  end if;
  return v_row;
exception when unique_violation then
  raise exception 'Kode alat sudah digunakan pada scope ini';
end;
$function$;

-- Impor katalog (maks 1000 baris) dalam satu transaksi. Baris baru memakai
-- kode otomatis; existing_id hanya memperbarui age_months. Duplikat identitas
-- (nama+kategori+satuan, dinormalisasi) dalam payload dilewati.
create or replace function public.ops_import_equipment(
  p_contract_id uuid, p_up3_id uuid, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path to public, pg_temp
as $function$
declare
  v_item jsonb; v_bad_keys text; v_name text; v_unit text;
  v_category_text text; v_category_id uuid; v_category_active boolean;
  v_existing_id uuid; v_age jsonb; v_age_num numeric; v_age_months integer;
  v_key text; v_seen text[] := '{}'; v_sort integer; v_code text;
  v_attempt integer; v_inserted integer := 0; v_updated integer := 0;
  v_skipped integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.ops_can_manage_master(p_contract_id, p_up3_id) then
    raise exception 'Hanya Super Admin atau Admin UP3 yang dapat mengimpor katalog' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Data impor harus berupa array'; end if;
  if jsonb_array_length(p_items) > 1000 then raise exception 'Maksimal 1000 baris per impor'; end if;

  select coalesce(max(sort_order), 0) into v_sort
  from public.ops_equipment_items
  where contract_id = p_contract_id and up3_id = p_up3_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Setiap baris impor harus berupa objek'; end if;
    select string_agg(k, ', ') into v_bad_keys
    from jsonb_object_keys(v_item) as k
    where k not in ('existing_id', 'name', 'unit', 'category_id', 'age_months');
    if v_bad_keys is not null then raise exception 'Kolom tidak dikenal: %', v_bad_keys; end if;
    if not (v_item ? 'name') or not (v_item ? 'unit') or not (v_item ? 'category_id') then
      raise exception 'Setiap baris wajib memiliki name, unit, dan category_id';
    end if;

    v_name := btrim(coalesce(v_item ->> 'name', ''));
    v_unit := btrim(coalesce(v_item ->> 'unit', ''));
    if char_length(v_name) not between 1 and 200 then raise exception 'Nama alat wajib 1-200 karakter'; end if;
    if char_length(v_unit) not between 1 and 50 then raise exception 'Satuan wajib 1-50 karakter'; end if;

    v_category_text := nullif(btrim(coalesce(v_item ->> 'category_id', '')), '');
    if v_category_text is null
      or v_category_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'category_id tidak valid';
    end if;
    v_category_id := v_category_text::uuid;

    if v_item ? 'existing_id' and jsonb_typeof(v_item -> 'existing_id') <> 'null' then
      if jsonb_typeof(v_item -> 'existing_id') <> 'string'
        or btrim(v_item ->> 'existing_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'existing_id tidak valid';
      end if;
      v_existing_id := btrim(v_item ->> 'existing_id')::uuid;
    else
      v_existing_id := null;
    end if;

    v_age := v_item -> 'age_months';
    if v_age is null or jsonb_typeof(v_age) = 'null' then
      v_age_months := null;
    else
      if jsonb_typeof(v_age) <> 'number' then raise exception 'age_months harus bilangan bulat atau null'; end if;
      v_age_num := (v_age #>> '{}')::numeric;
      if v_age_num < 0 or v_age_num > 2147483647 or v_age_num <> trunc(v_age_num) then
        raise exception 'age_months harus bilangan bulat 0-2147483647 atau null';
      end if;
      v_age_months := v_age_num::integer;
    end if;

    select c.is_active into v_category_active
    from public.ops_equipment_categories c
    where c.id = v_category_id and c.contract_id = p_contract_id and c.up3_id = p_up3_id;
    if not found then raise exception 'Kategori berada di luar scope ini'; end if;
    if v_existing_id is null and not v_category_active then
      raise exception 'Kategori tidak aktif pada scope ini';
    end if;

    if v_existing_id is not null then
      update public.ops_equipment_items
      set age_months = v_age_months, updated_by = auth.uid()
      where id = v_existing_id and contract_id = p_contract_id and up3_id = p_up3_id;
      if not found then raise exception 'Alat tidak ditemukan pada scope ini'; end if;
      v_updated := v_updated + 1;
      continue;
    end if;

    v_key := lower(btrim(v_name)) || '|' || v_category_id::text || '|' || lower(btrim(v_unit));
    if v_key = any(v_seen) then v_skipped := v_skipped + 1; continue; end if;
    v_seen := array_append(v_seen, v_key);

    v_attempt := 0;
    loop
      v_attempt := v_attempt + 1;
      v_code := private.ops_equipment_auto_code();
      begin
        insert into public.ops_equipment_items(
          contract_id, up3_id, code, name, category_id, unit,
          specification, description, is_active, sort_order, age_months,
          created_by, updated_by
        )
        values (
          p_contract_id, p_up3_id, v_code, v_name, v_category_id, v_unit,
          null, null, true, v_sort + 1, v_age_months, auth.uid(), auth.uid()
        );
        v_sort := v_sort + 1;
        v_inserted := v_inserted + 1;
        exit;
      exception when unique_violation then
        if v_attempt >= 5 then raise exception 'Gagal membuat kode alat unik, coba lagi'; end if;
      end;
    end loop;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
end;
$function$;

revoke all on function private.ops_equipment_auto_code() from public, anon, authenticated, service_role;
revoke all on function public.ops_save_equipment_v2(uuid, uuid, uuid, text, text, uuid, text, text, text, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function public.ops_import_equipment(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ops_save_equipment_v2(uuid, uuid, uuid, text, text, uuid, text, text, text, boolean, integer) to authenticated;
grant execute on function public.ops_import_equipment(uuid, uuid, jsonb) to authenticated;
