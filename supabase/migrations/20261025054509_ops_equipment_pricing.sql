alter table public.ops_equipment_items add column if not exists bpp_amount numeric(18,2);
alter table public.ops_equipment_items add column if not exists monthly_cost numeric(18,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ops_equipment_items'::regclass
      and conname = 'ops_equipment_items_bpp_amount_check'
  ) then
    alter table public.ops_equipment_items
      add constraint ops_equipment_items_bpp_amount_check
      check (bpp_amount is null or bpp_amount >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ops_equipment_items'::regclass
      and conname = 'ops_equipment_items_monthly_cost_check'
  ) then
    alter table public.ops_equipment_items
      add constraint ops_equipment_items_monthly_cost_check
      check (monthly_cost is null or monthly_cost >= 0);
  end if;
end;
$$;

create or replace function public.ops_save_equipment_v3(
  p_id uuid, p_contract_id uuid, p_up3_id uuid,
  p_code text, p_name text, p_category_id uuid, p_unit text,
  p_specification text, p_description text, p_is_active boolean,
  p_age_months integer, p_bpp_amount numeric, p_monthly_cost numeric
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
  if p_age_months is not null and p_age_months < 0 then raise exception 'Masa manfaat tidak boleh negatif'; end if;
  if p_bpp_amount is not null and p_bpp_amount < 0 then raise exception 'BPP tidak boleh negatif'; end if;
  if p_monthly_cost is not null and p_monthly_cost < 0 then raise exception 'Biaya bulanan tidak boleh negatif'; end if;
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
          description, is_active, sort_order, age_months, bpp_amount, monthly_cost,
          created_by, updated_by
        )
        values (
          p_contract_id, p_up3_id, v_code, v_name, p_category_id, v_unit,
          nullif(btrim(coalesce(p_specification, '')), ''),
          nullif(btrim(coalesce(p_description, '')), ''),
          coalesce(p_is_active, true),
          coalesce((select max(sort_order) from public.ops_equipment_items
            where contract_id = p_contract_id and up3_id = p_up3_id), 0) + 1,
          p_age_months, round(p_bpp_amount, 2), round(p_monthly_cost, 2), auth.uid(), auth.uid()
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
        age_months = p_age_months,
        bpp_amount = round(p_bpp_amount, 2),
        monthly_cost = round(p_monthly_cost, 2),
        updated_by = auth.uid()
    where id = p_id and contract_id = p_contract_id and up3_id = p_up3_id
    returning row_to_json(ops_equipment_items.*) into v_row;
    if v_row is null then raise exception 'Alat tidak ditemukan pada scope ini'; end if;
  end if;
  return v_row;
exception when unique_violation then
  raise exception 'Kode alat sudah digunakan pada scope ini';
end;
$function$;

create or replace function public.ops_import_equipment_v2(
  p_contract_id uuid, p_up3_id uuid, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path to public, pg_temp
as $function$
declare
  v_item jsonb; v_bad_keys text; v_name text; v_unit text;
  v_category_text text; v_category_id uuid; v_category_active boolean;
  v_existing_id uuid; v_age jsonb; v_age_num numeric; v_age_months integer;
  v_bpp jsonb; v_bpp_num numeric; v_bpp_amount numeric;
  v_monthly jsonb; v_monthly_num numeric; v_monthly_cost numeric;
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
    where k not in ('existing_id', 'name', 'unit', 'category_id', 'age_months', 'bpp_amount', 'monthly_cost');
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

    v_bpp := v_item -> 'bpp_amount';
    if v_bpp is null or jsonb_typeof(v_bpp) = 'null' then
      v_bpp_amount := null;
    else
      if jsonb_typeof(v_bpp) <> 'number' then raise exception 'bpp_amount harus angka atau null'; end if;
      v_bpp_num := (v_bpp #>> '{}')::numeric;
      if v_bpp_num < 0 or v_bpp_num > 9999999999999999.99 then
        raise exception 'bpp_amount harus angka nonnegatif';
      end if;
      v_bpp_amount := round(v_bpp_num, 2);
    end if;

    v_monthly := v_item -> 'monthly_cost';
    if v_monthly is null or jsonb_typeof(v_monthly) = 'null' then
      v_monthly_cost := null;
    else
      if jsonb_typeof(v_monthly) <> 'number' then raise exception 'monthly_cost harus angka atau null'; end if;
      v_monthly_num := (v_monthly #>> '{}')::numeric;
      if v_monthly_num < 0 or v_monthly_num > 9999999999999999.99 then
        raise exception 'monthly_cost harus angka nonnegatif';
      end if;
      v_monthly_cost := round(v_monthly_num, 2);
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
      set age_months = coalesce(v_age_months, age_months),
          bpp_amount = coalesce(v_bpp_amount, bpp_amount),
          monthly_cost = coalesce(v_monthly_cost, monthly_cost),
          updated_by = auth.uid()
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
          bpp_amount, monthly_cost, created_by, updated_by
        )
        values (
          p_contract_id, p_up3_id, v_code, v_name, v_category_id, v_unit,
          null, null, true, v_sort + 1, v_age_months,
          v_bpp_amount, v_monthly_cost, auth.uid(), auth.uid()
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

revoke all on function public.ops_save_equipment_v3(uuid, uuid, uuid, text, text, uuid, text, text, text, boolean, integer, numeric, numeric) from public, anon, authenticated, service_role;
revoke all on function public.ops_import_equipment_v2(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ops_save_equipment_v3(uuid, uuid, uuid, text, text, uuid, text, text, text, boolean, integer, numeric, numeric) to authenticated;
grant execute on function public.ops_import_equipment_v2(uuid, uuid, jsonb) to authenticated;
