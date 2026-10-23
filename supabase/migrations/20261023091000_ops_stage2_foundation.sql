-- TAHAP 2 fondasi (A): audit/revision tabel ops, snapshot metadata publikasi
-- template, dan penjaga konten terbitan. Non-destruktif dan aman direplai.
--
-- Catatan replai: seed 20261016090200 berjalan sebelum migrasi ini sehingga
-- template contoh berstatus Aktif dibuat tanpa snapshot (dibiarkan NULL dan
-- ditandai legacy oleh aplikasi; tidak ada label historis yang dikarang).

alter table public.ops_vehicle_types         add column if not exists revision integer not null default 1;
alter table public.ops_vehicle_assignments   add column if not exists revision integer not null default 1;
alter table public.ops_equipment_categories  add column if not exists revision integer not null default 1;
alter table public.ops_equipment_items       add column if not exists revision integer not null default 1;
alter table public.ops_equipment_templates   add column if not exists revision integer not null default 1;
alter table public.ops_equipment_template_items add column if not exists revision integer not null default 1;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'ops_vehicle_types', 'ops_vehicle_assignments', 'ops_equipment_categories',
    'ops_equipment_items', 'ops_equipment_templates'
  ] loop
    if not exists (
      select 1 from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table
        and tg.tgname = 'trg_' || v_table || '_audit'
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.touch_audit_columns()',
        'trg_' || v_table || '_audit', v_table
      );
    end if;
  end loop;
end;
$$;

-- Snapshot publikasi template: nama header dibekukan saat terbit.
alter table public.ops_equipment_templates
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid,
  add column if not exists vehicle_type_name text,
  add column if not exists assignment_name text;

-- Snapshot rincian alat: kode/nama/satuan/kategori dibekukan saat terbit.
alter table public.ops_equipment_template_items
  add column if not exists equipment_code text,
  add column if not exists equipment_name text,
  add column if not exists equipment_unit text,
  add column if not exists equipment_category_name text;

-- Normalisasi varian untuk pencocokan konflik terbitan (dihitung saat panggil).
create or replace function public.ops_normalize_variant(p_variant text)
returns text
language sql
immutable
as $function$
  select nullif(regexp_replace(btrim(upper(coalesce(p_variant, ''))), '\s+', ' ', 'g'), '')
$function$;

-- Penjaga konten template terbitan: header tetap, hanya transisi status yang
-- diizinkan (Aktif -> Diarsipkan). Draft bebas diubah.
create or replace function public.guard_ops_template_content()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status = 'Aktif' and (
      new.published_at is null
      or new.published_by is null
      or new.vehicle_type_name is null
      or new.assignment_name is null
    ) then
      raise exception 'Template Aktif wajib memiliki metadata publikasi';
    end if;
    return new;
  end if;

  if old.status = 'Draft' then
    return new;
  end if;

  if new.contract_id is distinct from old.contract_id
     or new.up3_id is distinct from old.up3_id
     or new.template_code is distinct from old.template_code
     or new.template_name is distinct from old.template_name
     or new.vehicle_type_id is distinct from old.vehicle_type_id
     or new.assignment_id is distinct from old.assignment_id
     or new.vehicle_variant is distinct from old.vehicle_variant
     or new.version_number is distinct from old.version_number
     or new.effective_from is distinct from old.effective_from
     or new.previous_version_id is distinct from old.previous_version_id
     or new.description is distinct from old.description then
    raise exception 'Konten template yang sudah terbit bersifat tetap. Duplikasi ke versi baru untuk perubahan.';
  end if;

  if old.status = 'Aktif' and new.status not in ('Aktif', 'Diarsipkan') then
    raise exception 'Status template terbit tidak valid';
  end if;
  if old.status = 'Diarsipkan' and new.status <> 'Diarsipkan' then
    raise exception 'Template arsip tidak dapat diaktifkan kembali';
  end if;
  if new.published_at is null or new.published_by is null
     or new.vehicle_type_name is null or new.assignment_name is null then
    raise exception 'Metadata publikasi template tidak boleh dihapus';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_ops_templates_content_guard on public.ops_equipment_templates;
create trigger trg_ops_templates_content_guard
  before insert or update on public.ops_equipment_templates
  for each row execute function public.guard_ops_template_content();

-- Penjaga rincian alat: hanya draft yang boleh berubah; pada template terbitan
-- perubahan dibatasi pada pengisian kolom snapshot (dipakai saat publikasi).
create or replace function public.guard_ops_template_item_content()
returns trigger
language plpgsql
as $function$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    select status into v_status from public.ops_equipment_templates where id = old.template_id;
    if v_status is distinct from 'Draft' then
      raise exception 'Rincian alat template terbitan bersifat tetap';
    end if;
    return old;
  end if;

  select status into v_status from public.ops_equipment_templates where id = new.template_id;
  if v_status is null then
    raise exception 'Template rincian tidak ditemukan';
  end if;
  if v_status <> 'Draft' then
    if tg_op = 'INSERT' then
      raise exception 'Rincian alat template terbitan bersifat tetap';
    end if;
    if new.template_id is distinct from old.template_id
       or new.equipment_id is distinct from old.equipment_id
       or new.required_qty is distinct from old.required_qty
       or new.note is distinct from old.note
       or new.sort_order is distinct from old.sort_order then
      raise exception 'Rincian alat template terbitan bersifat tetap';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_ops_template_items_content_guard on public.ops_equipment_template_items;
create trigger trg_ops_template_items_content_guard
  before insert or update or delete on public.ops_equipment_template_items
  for each row execute function public.guard_ops_template_item_content();

-- Draft: snapshot diambil dari katalog saat penyimpanan (refresh tiap simpan).
create or replace function public.ops_save_template_draft(
  p_id uuid, p_contract_id uuid, p_up3_id uuid,
  p_template_name text, p_vehicle_type_id uuid, p_assignment_id uuid,
  p_vehicle_variant text, p_effective_from date, p_description text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_name text := btrim(coalesce(p_template_name, ''));
  v_variant text := nullif(btrim(coalesce(p_vehicle_variant, '')), '');
  v_id uuid;
  v_version int;
  v_code text;
  v_base text;
  v_suffix int := 0;
  v_item jsonb;
  v_eq_id uuid;
  v_qty int;
  v_sort int := 0;
  v_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.ops_can_manage_master(p_contract_id, p_up3_id) then
    raise exception 'Hanya Super Admin atau Admin UP3 yang dapat mengelola template' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'Nama template wajib diisi'; end if;
  if p_vehicle_type_id is null then raise exception 'Jenis kendaraan wajib dipilih'; end if;
  if p_assignment_id is null then raise exception 'Penugasan wajib dipilih'; end if;
  if not exists (select 1 from public.ops_vehicle_types where id = p_vehicle_type_id and contract_id = p_contract_id and up3_id = p_up3_id and is_active) then
    raise exception 'Jenis kendaraan tidak aktif pada scope ini';
  end if;
  if not exists (select 1 from public.ops_vehicle_assignments where id = p_assignment_id and contract_id = p_contract_id and up3_id = p_up3_id and is_active) then
    raise exception 'Penugasan tidak aktif pada scope ini';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Template membutuhkan minimal satu alat';
  end if;

  if p_id is null then
    select coalesce(max(version_number), 0) + 1 into v_version
    from public.ops_equipment_templates
    where contract_id = p_contract_id and up3_id = p_up3_id
      and vehicle_type_id = p_vehicle_type_id and assignment_id = p_assignment_id
      and coalesce(vehicle_variant, '') = coalesce(v_variant, '');
    select upper('TMP-' || t.code || '-' || a.code
      || case when v_variant is null then '' else '-' || regexp_replace(upper(v_variant), '[^A-Z0-9]+', '', 'g') end
      || '-V' || v_version::text)
    into v_base
    from public.ops_vehicle_types t, public.ops_vehicle_assignments a
    where t.id = p_vehicle_type_id and a.id = p_assignment_id;
    v_code := v_base;
    while exists (select 1 from public.ops_equipment_templates
      where contract_id = p_contract_id and up3_id = p_up3_id and template_code = v_code) loop
      v_suffix := v_suffix + 1;
      v_code := v_base || '-' || v_suffix::text;
    end loop;
    insert into public.ops_equipment_templates(contract_id, up3_id, template_code, template_name, vehicle_type_id, assignment_id,
      vehicle_variant, version_number, effective_from, status, description, created_by, updated_by)
    values (p_contract_id, p_up3_id, v_code, v_name, p_vehicle_type_id, p_assignment_id, v_variant,
      v_version, coalesce(p_effective_from, current_date), 'Draft',
      nullif(btrim(coalesce(p_description, '')), ''), auth.uid(), auth.uid())
    returning id into v_id;
  else
    select id into v_id from public.ops_equipment_templates
    where id = p_id and contract_id = p_contract_id and up3_id = p_up3_id and status = 'Draft'
    for update;
    if not found then raise exception 'Hanya template Draft yang dapat diubah'; end if;
    update public.ops_equipment_templates
    set template_name = v_name, vehicle_type_id = p_vehicle_type_id, assignment_id = p_assignment_id,
        vehicle_variant = v_variant, effective_from = coalesce(p_effective_from, effective_from),
        description = nullif(btrim(coalesce(p_description, '')), ''), updated_by = auth.uid()
    where id = v_id;
    delete from public.ops_equipment_template_items where template_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_eq_id := nullif(btrim(v_item ->> 'equipment_id'), '')::uuid;
    v_qty := coalesce(nullif(btrim(v_item ->> 'required_qty'), '')::int, 0);
    if v_eq_id is null then raise exception 'Setiap baris membutuhkan alat dari katalog'; end if;
    if v_qty < 0 then raise exception 'Jumlah kebutuhan tidak boleh negatif'; end if;
    if not exists (select 1 from public.ops_equipment_items
      where id = v_eq_id and contract_id = p_contract_id and up3_id = p_up3_id and is_active) then
      raise exception 'Alat tidak aktif pada scope ini';
    end if;
    v_sort := v_sort + 1;
    insert into public.ops_equipment_template_items(
      template_id, equipment_id, required_qty, note, sort_order,
      equipment_code, equipment_name, equipment_unit, equipment_category_name
    )
    select v_id, i.id, v_qty, nullif(btrim(coalesce(v_item ->> 'note', '')), ''), v_sort,
      i.code, i.name, i.unit, c.name
    from public.ops_equipment_items i
    left join public.ops_equipment_categories c on c.id = i.category_id
    where i.id = v_eq_id
    on conflict (template_id, equipment_id) do update
      set required_qty = excluded.required_qty,
          note = excluded.note,
          sort_order = excluded.sort_order,
          equipment_code = excluded.equipment_code,
          equipment_name = excluded.equipment_name,
          equipment_unit = excluded.equipment_unit,
          equipment_category_name = excluded.equipment_category_name;
  end loop;

  select row_to_json(t.*) into v_row from public.ops_equipment_templates t where t.id = v_id;
  return v_row;
end;
$function$;

-- Terbitkan draft: cek konflik varian ternormalisasi, lalu bekukan snapshot.
create or replace function public.ops_publish_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_tpl public.ops_equipment_templates%rowtype;
  v_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_tpl from public.ops_equipment_templates where id = p_template_id for update;
  if not found then raise exception 'Template tidak ditemukan'; end if;
  if not public.ops_can_manage_master(v_tpl.contract_id, v_tpl.up3_id) then
    raise exception 'Hanya Super Admin atau Admin UP3 yang dapat menerbitkan template' using errcode = '42501';
  end if;
  if v_tpl.status <> 'Draft' then raise exception 'Hanya template Draft yang dapat diterbitkan'; end if;
  if not exists (select 1 from public.ops_equipment_template_items where template_id = p_template_id) then
    raise exception 'Template membutuhkan minimal satu alat';
  end if;
  if exists (select 1 from public.ops_equipment_template_items
    where template_id = p_template_id and required_qty <= 0) then
    raise exception 'Setiap alat wajib memiliki Jumlah Kebutuhan lebih dari 0 saat publikasi';
  end if;
  if exists (
    select 1 from public.ops_equipment_templates t
    where t.id <> p_template_id and t.status = 'Aktif'
      and t.contract_id = v_tpl.contract_id and t.up3_id = v_tpl.up3_id
      and t.vehicle_type_id = v_tpl.vehicle_type_id and t.assignment_id = v_tpl.assignment_id
      and coalesce(public.ops_normalize_variant(t.vehicle_variant), '')
          = coalesce(public.ops_normalize_variant(v_tpl.vehicle_variant), '')
  ) then
    raise exception 'Sudah ada template Aktif untuk kombinasi jenis, penugasan, dan varian ini';
  end if;

  update public.ops_equipment_templates t
  set status = 'Aktif',
      published_at = now(),
      published_by = auth.uid(),
      vehicle_type_name = (select vt.name from public.ops_vehicle_types vt where vt.id = t.vehicle_type_id),
      assignment_name = (select va.name from public.ops_vehicle_assignments va where va.id = t.assignment_id),
      updated_by = auth.uid()
  where t.id = p_template_id
  returning row_to_json(t.*) into v_row;

  update public.ops_equipment_template_items ti
  set equipment_code = i.code,
      equipment_name = i.name,
      equipment_unit = i.unit,
      equipment_category_name = c.name
  from public.ops_equipment_items i
  left join public.ops_equipment_categories c on c.id = i.category_id
  where ti.template_id = p_template_id and i.id = ti.equipment_id;

  return v_row;
end;
$function$;

-- Duplikasi: bawa snapshot sumber bila ada (draft akan menyegarkan saat simpan
-- dan dibekukan ulang saat publikasi).
create or replace function public.ops_duplicate_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_src public.ops_equipment_templates%rowtype;
  v_id uuid;
  v_version int;
  v_code text;
  v_base text;
  v_suffix int := 0;
  v_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_src from public.ops_equipment_templates where id = p_template_id;
  if not found then raise exception 'Template tidak ditemukan'; end if;
  if not public.ops_can_manage_master(v_src.contract_id, v_src.up3_id) then
    raise exception 'Hanya Super Admin atau Admin UP3 yang dapat menduplikasi template' using errcode = '42501';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_version
  from public.ops_equipment_templates
  where contract_id = v_src.contract_id and up3_id = v_src.up3_id
    and vehicle_type_id = v_src.vehicle_type_id and assignment_id = v_src.assignment_id
    and coalesce(vehicle_variant, '') = coalesce(v_src.vehicle_variant, '');
  v_base := regexp_replace(v_src.template_code, '-V[0-9]+(-[0-9]+)?$', '') || '-V' || v_version::text;
  v_code := v_base;
  while exists (select 1 from public.ops_equipment_templates
    where contract_id = v_src.contract_id and up3_id = v_src.up3_id and template_code = v_code) loop
    v_suffix := v_suffix + 1;
    v_code := v_base || '-' || v_suffix::text;
  end loop;
  insert into public.ops_equipment_templates(contract_id, up3_id, template_code, template_name, vehicle_type_id, assignment_id,
    vehicle_variant, version_number, effective_from, status, description, previous_version_id, created_by, updated_by)
  values (v_src.contract_id, v_src.up3_id, v_code, v_src.template_name, v_src.vehicle_type_id, v_src.assignment_id,
    v_src.vehicle_variant, v_version, current_date, 'Draft', v_src.description, v_src.id, auth.uid(), auth.uid())
  returning id into v_id;
  insert into public.ops_equipment_template_items(
    template_id, equipment_id, required_qty, note, sort_order,
    equipment_code, equipment_name, equipment_unit, equipment_category_name
  )
  select v_id, equipment_id, required_qty, note, sort_order,
    equipment_code, equipment_name, equipment_unit, equipment_category_name
  from public.ops_equipment_template_items where template_id = p_template_id;
  select row_to_json(t.*) into v_row from public.ops_equipment_templates t where t.id = v_id;
  return v_row;
exception when unique_violation then
  raise exception 'Gagal membuat kode template unik, coba lagi';
end;
$function$;

revoke all on function public.ops_normalize_variant(text) from public, anon;
revoke all on function public.ops_save_template_draft(uuid, uuid, uuid, text, uuid, uuid, text, date, text, jsonb) from public, anon;
revoke all on function public.ops_publish_template(uuid) from public, anon;
revoke all on function public.ops_duplicate_template(uuid) from public, anon;
grant execute on function public.ops_normalize_variant(text) to authenticated;
grant execute on function public.ops_save_template_draft(uuid, uuid, uuid, text, uuid, uuid, text, date, text, jsonb) to authenticated;
grant execute on function public.ops_publish_template(uuid) to authenticated;
grant execute on function public.ops_duplicate_template(uuid) to authenticated;
