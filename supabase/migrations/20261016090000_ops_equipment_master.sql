-- TAHAP 1: Master Data Manajemen Alat & Kendaraan Operasional.
-- Master ULP dipakai ulang dari public.organization_units (tanpa tabel baru).
-- Tulis hanya lewat RPC (tanpa policy INSERT/UPDATE/DELETE).
-- Baca: SUPER_ADMIN atau membership kontrak aktif pada UP3 (semua role,
-- termasuk ADMIN_ULP read-only). Non-destruktif: nonaktif/arsip, tanpa DELETE.

create table if not exists public.ops_vehicle_types (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  up3_id uuid not null references public.organization_units(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint uq_ops_vehicle_types_code unique (contract_id, up3_id, code)
);

create table if not exists public.ops_vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  up3_id uuid not null references public.organization_units(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint uq_ops_vehicle_assignments_code unique (contract_id, up3_id, code)
);

create table if not exists public.ops_equipment_categories (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  up3_id uuid not null references public.organization_units(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint uq_ops_equipment_categories_code unique (contract_id, up3_id, code)
);

create table if not exists public.ops_equipment_items (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  up3_id uuid not null references public.organization_units(id) on delete cascade,
  code text not null,
  name text not null,
  category_id uuid not null references public.ops_equipment_categories(id) on delete restrict,
  unit text not null default 'unit',
  specification text,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint uq_ops_equipment_items_code unique (contract_id, up3_id, code)
);

create table if not exists public.ops_equipment_templates (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  up3_id uuid not null references public.organization_units(id) on delete cascade,
  template_code text not null,
  template_name text not null,
  vehicle_type_id uuid not null references public.ops_vehicle_types(id) on delete restrict,
  assignment_id uuid not null references public.ops_vehicle_assignments(id) on delete restrict,
  vehicle_variant text,
  version_number integer not null default 1,
  effective_from date not null default current_date,
  status text not null default 'Draft' check (status in ('Draft', 'Aktif', 'Diarsipkan')),
  description text,
  previous_version_id uuid references public.ops_equipment_templates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint uq_ops_equipment_templates_code unique (contract_id, up3_id, template_code)
);

-- Satu versi aktif per kombinasi jenis + penugasan + varian.
create unique index if not exists uq_ops_template_active_key
  on public.ops_equipment_templates (contract_id, up3_id, vehicle_type_id, assignment_id, coalesce(vehicle_variant, ''))
  where status = 'Aktif';

create table if not exists public.ops_equipment_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.ops_equipment_templates(id) on delete cascade,
  equipment_id uuid not null references public.ops_equipment_items(id) on delete restrict,
  required_qty integer not null default 0 check (required_qty >= 0),
  note text,
  sort_order integer not null default 0,
  constraint uq_ops_template_item unique (template_id, equipment_id)
);

create index if not exists ix_ops_equipment_items_category on public.ops_equipment_items (category_id);
create index if not exists ix_ops_templates_lookup on public.ops_equipment_templates (contract_id, up3_id, status);
create index if not exists ix_ops_template_items_template on public.ops_equipment_template_items (template_id);

-- Trigger audit dipasang hanya bila kolom revision sudah ada. Tahap 1 lokal
-- belum memiliki kolom revision; migrasi Tahap 2 menambahkannya lalu memasang
-- trigger ini (trg_ops_*_audit) secara idempoten. Dengan demikian replai dari
-- nol tetap aman pada urutan migrasi mana pun.
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
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_table and column_name = 'revision'
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.touch_audit_columns()',
        'trg_' || v_table || '_audit', v_table
      );
    end if;
  end loop;
end;
$$;

alter table public.ops_vehicle_types enable row level security;
alter table public.ops_vehicle_assignments enable row level security;
alter table public.ops_equipment_categories enable row level security;
alter table public.ops_equipment_items enable row level security;
alter table public.ops_equipment_templates enable row level security;
alter table public.ops_equipment_template_items enable row level security;

drop policy if exists ops_master_select on public.ops_vehicle_types;
drop policy if exists ops_master_select on public.ops_vehicle_assignments;
drop policy if exists ops_master_select on public.ops_equipment_categories;
drop policy if exists ops_master_select on public.ops_equipment_items;
drop policy if exists ops_master_select on public.ops_equipment_templates;
drop policy if exists ops_master_select on public.ops_equipment_template_items;

create policy ops_master_select on public.ops_vehicle_types for select to authenticated
  using (public.auth_is_super_admin() or exists (
    select 1 from public.contract_memberships cm
    where cm.user_id = auth.uid() and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
      and cm.contract_id = ops_vehicle_types.contract_id and cm.operational_up3_id = ops_vehicle_types.up3_id));
create policy ops_master_select on public.ops_vehicle_assignments for select to authenticated
  using (public.auth_is_super_admin() or exists (
    select 1 from public.contract_memberships cm
    where cm.user_id = auth.uid() and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
      and cm.contract_id = ops_vehicle_assignments.contract_id and cm.operational_up3_id = ops_vehicle_assignments.up3_id));
create policy ops_master_select on public.ops_equipment_categories for select to authenticated
  using (public.auth_is_super_admin() or exists (
    select 1 from public.contract_memberships cm
    where cm.user_id = auth.uid() and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
      and cm.contract_id = ops_equipment_categories.contract_id and cm.operational_up3_id = ops_equipment_categories.up3_id));
create policy ops_master_select on public.ops_equipment_items for select to authenticated
  using (public.auth_is_super_admin() or exists (
    select 1 from public.contract_memberships cm
    where cm.user_id = auth.uid() and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
      and cm.contract_id = ops_equipment_items.contract_id and cm.operational_up3_id = ops_equipment_items.up3_id));
create policy ops_master_select on public.ops_equipment_templates for select to authenticated
  using (public.auth_is_super_admin() or exists (
    select 1 from public.contract_memberships cm
    where cm.user_id = auth.uid() and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
      and cm.contract_id = ops_equipment_templates.contract_id and cm.operational_up3_id = ops_equipment_templates.up3_id));
create policy ops_master_select on public.ops_equipment_template_items for select to authenticated
  using (exists (
    select 1 from public.ops_equipment_templates t
    where t.id = ops_equipment_template_items.template_id
      and (public.auth_is_super_admin() or exists (
        select 1 from public.contract_memberships cm
        where cm.user_id = auth.uid() and cm.status = 'ACTIVE'
          and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
          and cm.contract_id = t.contract_id and cm.operational_up3_id = t.up3_id))));

-- Penjaga tulis: SUPER_ADMIN atau ADMIN_UP3 aktif pada scope.
create or replace function public.ops_can_manage_master(p_contract_id uuid, p_up3_id uuid)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.contract_role = 'ADMIN_UP3' and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
    )
  )
$function$;

-- Simpan master sederhana (jenis, penugasan, kategori).
create or replace function public.ops_save_master(
  p_kind text, p_id uuid, p_contract_id uuid, p_up3_id uuid,
  p_code text, p_name text, p_description text, p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_kind not in ('vehicle_type', 'assignment', 'category') then raise exception 'Jenis master tidak dikenal'; end if;
  if not public.ops_can_manage_master(p_contract_id, p_up3_id) then
    raise exception 'Hanya Super Admin atau Admin UP3 yang dapat mengelola master' using errcode = '42501';
  end if;
  if v_code = '' then raise exception 'Kode wajib diisi'; end if;
  if v_name = '' then raise exception 'Nama wajib diisi'; end if;
  if p_kind = 'vehicle_type' then
    if p_id is null then
      insert into public.ops_vehicle_types(contract_id, up3_id, code, name, description, is_active, sort_order, created_by, updated_by)
      values (p_contract_id, p_up3_id, v_code, v_name, nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_is_active, true),
        coalesce((select max(sort_order) from public.ops_vehicle_types where contract_id = p_contract_id and up3_id = p_up3_id), 0) + 1,
        auth.uid(), auth.uid())
      returning row_to_json(ops_vehicle_types.*) into v_row;
    else
      update public.ops_vehicle_types set code = v_code, name = v_name,
        description = nullif(btrim(coalesce(p_description, '')), ''), is_active = coalesce(p_is_active, is_active), updated_by = auth.uid()
      where id = p_id and contract_id = p_contract_id and up3_id = p_up3_id
      returning row_to_json(ops_vehicle_types.*) into v_row;
      if v_row is null then raise exception 'Data master tidak ditemukan pada scope ini'; end if;
    end if;
  elsif p_kind = 'assignment' then
    if p_id is null then
      insert into public.ops_vehicle_assignments(contract_id, up3_id, code, name, description, is_active, sort_order, created_by, updated_by)
      values (p_contract_id, p_up3_id, v_code, v_name, nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_is_active, true),
        coalesce((select max(sort_order) from public.ops_vehicle_assignments where contract_id = p_contract_id and up3_id = p_up3_id), 0) + 1,
        auth.uid(), auth.uid())
      returning row_to_json(ops_vehicle_assignments.*) into v_row;
    else
      update public.ops_vehicle_assignments set code = v_code, name = v_name,
        description = nullif(btrim(coalesce(p_description, '')), ''), is_active = coalesce(p_is_active, is_active), updated_by = auth.uid()
      where id = p_id and contract_id = p_contract_id and up3_id = p_up3_id
      returning row_to_json(ops_vehicle_assignments.*) into v_row;
      if v_row is null then raise exception 'Data master tidak ditemukan pada scope ini'; end if;
    end if;
  else
    if p_id is null then
      insert into public.ops_equipment_categories(contract_id, up3_id, code, name, description, is_active, sort_order, created_by, updated_by)
      values (p_contract_id, p_up3_id, v_code, v_name, nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_is_active, true),
        coalesce((select max(sort_order) from public.ops_equipment_categories where contract_id = p_contract_id and up3_id = p_up3_id), 0) + 1,
        auth.uid(), auth.uid())
      returning row_to_json(ops_equipment_categories.*) into v_row;
    else
      update public.ops_equipment_categories set code = v_code, name = v_name,
        description = nullif(btrim(coalesce(p_description, '')), ''), is_active = coalesce(p_is_active, is_active), updated_by = auth.uid()
      where id = p_id and contract_id = p_contract_id and up3_id = p_up3_id
      returning row_to_json(ops_equipment_categories.*) into v_row;
      if v_row is null then raise exception 'Data master tidak ditemukan pada scope ini'; end if;
    end if;
  end if;
  return v_row;
exception when unique_violation then
  raise exception 'Kode sudah digunakan pada scope ini';
end;
$function$;

-- Simpan katalog peralatan.
create or replace function public.ops_save_equipment(
  p_id uuid, p_contract_id uuid, p_up3_id uuid,
  p_code text, p_name text, p_category_id uuid, p_unit text,
  p_specification text, p_description text, p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_unit text := btrim(coalesce(p_unit, 'unit'));
  v_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.ops_can_manage_master(p_contract_id, p_up3_id) then
    raise exception 'Hanya Super Admin atau Admin UP3 yang dapat mengelola master' using errcode = '42501';
  end if;
  if v_code = '' then raise exception 'Kode alat wajib diisi'; end if;
  if v_name = '' then raise exception 'Nama alat wajib diisi'; end if;
  if p_category_id is null then raise exception 'Kategori wajib dipilih'; end if;
  if not exists (select 1 from public.ops_equipment_categories
    where id = p_category_id and contract_id = p_contract_id and up3_id = p_up3_id) then
    raise exception 'Kategori berada di luar scope ini';
  end if;
  if p_id is null then
    insert into public.ops_equipment_items(contract_id, up3_id, code, name, category_id, unit, specification, description, is_active, sort_order, created_by, updated_by)
    values (p_contract_id, p_up3_id, v_code, v_name, p_category_id, v_unit,
      nullif(btrim(coalesce(p_specification, '')), ''), nullif(btrim(coalesce(p_description, '')), ''),
      coalesce(p_is_active, true),
      coalesce((select max(sort_order) from public.ops_equipment_items where contract_id = p_contract_id and up3_id = p_up3_id), 0) + 1,
      auth.uid(), auth.uid())
    returning row_to_json(ops_equipment_items.*) into v_row;
  else
    update public.ops_equipment_items set code = v_code, name = v_name, category_id = p_category_id, unit = v_unit,
      specification = nullif(btrim(coalesce(p_specification, '')), ''),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      is_active = coalesce(p_is_active, is_active), updated_by = auth.uid()
    where id = p_id and contract_id = p_contract_id and up3_id = p_up3_id
    returning row_to_json(ops_equipment_items.*) into v_row;
    if v_row is null then raise exception 'Alat tidak ditemukan pada scope ini'; end if;
  end if;
  return v_row;
exception when unique_violation then
  raise exception 'Kode alat sudah digunakan pada scope ini';
end;
$function$;

-- Simpan draft template + detail (hanya status Draft yang dapat diubah).
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
    insert into public.ops_equipment_template_items(template_id, equipment_id, required_qty, note, sort_order)
    values (v_id, v_eq_id, v_qty, nullif(btrim(coalesce(v_item ->> 'note', '')), ''), v_sort)
    on conflict (template_id, equipment_id) do update
      set required_qty = excluded.required_qty, note = excluded.note, sort_order = excluded.sort_order;
  end loop;

  select row_to_json(t.*) into v_row from public.ops_equipment_templates t where t.id = v_id;
  return v_row;
end;
$function$;

-- Terbitkan draft: wajib item > 0 semua; tolak bila bentrok aktif.
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
  if exists (select 1 from public.ops_equipment_templates
    where id <> p_template_id and status = 'Aktif'
      and contract_id = v_tpl.contract_id and up3_id = v_tpl.up3_id
      and vehicle_type_id = v_tpl.vehicle_type_id and assignment_id = v_tpl.assignment_id
      and coalesce(vehicle_variant, '') = coalesce(v_tpl.vehicle_variant, '')) then
    raise exception 'Sudah ada template Aktif untuk kombinasi jenis, penugasan, dan varian ini';
  end if;
  update public.ops_equipment_templates
  set status = 'Aktif', updated_by = auth.uid()
  where id = p_template_id
  returning row_to_json(ops_equipment_templates.*) into v_row;
  return v_row;
end;
$function$;

-- Arsipkan template aktif.
create or replace function public.ops_archive_template(p_template_id uuid)
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
    raise exception 'Hanya Super Admin atau Admin UP3 yang dapat mengarsipkan template' using errcode = '42501';
  end if;
  if v_tpl.status <> 'Aktif' then raise exception 'Hanya template Aktif yang dapat diarsipkan'; end if;
  update public.ops_equipment_templates
  set status = 'Diarsipkan', updated_by = auth.uid()
  where id = p_template_id
  returning row_to_json(ops_equipment_templates.*) into v_row;
  return v_row;
end;
$function$;

-- Duplikasi template menjadi Draft versi berikutnya (template terbitan tidak ditimpa).
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
  insert into public.ops_equipment_template_items(template_id, equipment_id, required_qty, note, sort_order)
  select v_id, equipment_id, required_qty, note, sort_order
  from public.ops_equipment_template_items where template_id = p_template_id;
  select row_to_json(t.*) into v_row from public.ops_equipment_templates t where t.id = v_id;
  return v_row;
exception when unique_violation then
  raise exception 'Gagal membuat kode template unik, coba lagi';
end;
$function$;

revoke all on function public.ops_can_manage_master(uuid, uuid) from public, anon;
revoke all on function public.ops_save_master(text, uuid, uuid, uuid, text, text, text, boolean) from public, anon;
revoke all on function public.ops_save_equipment(uuid, uuid, uuid, text, text, uuid, text, text, text, boolean) from public, anon;
revoke all on function public.ops_save_template_draft(uuid, uuid, uuid, text, uuid, uuid, text, date, text, jsonb) from public, anon;
revoke all on function public.ops_publish_template(uuid) from public, anon;
revoke all on function public.ops_archive_template(uuid) from public, anon;
revoke all on function public.ops_duplicate_template(uuid) from public, anon;
grant execute on function public.ops_can_manage_master(uuid, uuid) to authenticated;
grant execute on function public.ops_save_master(text, uuid, uuid, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.ops_save_equipment(uuid, uuid, uuid, text, text, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.ops_save_template_draft(uuid, uuid, uuid, text, uuid, uuid, text, date, text, jsonb) to authenticated;
grant execute on function public.ops_publish_template(uuid) to authenticated;
grant execute on function public.ops_archive_template(uuid) to authenticated;
grant execute on function public.ops_duplicate_template(uuid) to authenticated;
