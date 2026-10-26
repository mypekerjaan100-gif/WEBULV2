set local lock_timeout = '5s';

create or replace function public.guard_ops_template_content()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_active_edit boolean := coalesce(current_setting('ops.allow_active_template_edit', true), '') = 'on';
  v_name_is_editable boolean;
  v_type_name text;
  v_assignment_name text;
begin
  if tg_op = 'INSERT' then
    v_name_is_editable := true;
  else
    v_name_is_editable := old.status = 'Draft' or (old.status = 'Aktif' and v_active_edit);
  end if;

  if v_name_is_editable then
    select nullif(btrim(v.name), ''), nullif(btrim(a.name), '')
    into v_type_name, v_assignment_name
    from public.ops_vehicle_types v
    join public.ops_vehicle_assignments a
      on a.id = new.assignment_id
      and a.contract_id = new.contract_id and a.up3_id = new.up3_id
    where v.id = new.vehicle_type_id
      and v.contract_id = new.contract_id and v.up3_id = new.up3_id;
    if not found or v_type_name is null or v_assignment_name is null then
      raise exception 'Jenis kendaraan dan penugasan diperlukan untuk nama template otomatis';
    end if;
    new.template_name := concat_ws(' - ', v_type_name, v_assignment_name, nullif(btrim(new.vehicle_variant), ''));
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'Aktif' and (
      new.published_at is null or new.published_by is null
      or new.vehicle_type_name is null or new.assignment_name is null
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
     or new.vehicle_type_id is distinct from old.vehicle_type_id
     or new.assignment_id is distinct from old.assignment_id
     or new.vehicle_variant is distinct from old.vehicle_variant
     or new.version_number is distinct from old.version_number
     or new.effective_from is distinct from old.effective_from
     or new.previous_version_id is distinct from old.previous_version_id then
    raise exception 'Identitas template yang sudah terbit bersifat tetap. Duplikasi ke versi baru untuk perubahan.';
  end if;

  if new.template_name is distinct from old.template_name
     and not (old.status = 'Aktif' and v_active_edit) then
    raise exception 'Nama template terbit hanya dapat diperbarui otomatis melalui penyimpanan template Aktif';
  end if;
  if new.description is distinct from old.description
     and not (old.status = 'Aktif' and v_active_edit) then
    raise exception 'Konten template yang sudah terbit bersifat tetap. Duplikasi ke versi baru untuk perubahan.';
  end if;
  if old.status = 'Aktif' and v_active_edit and new.status <> 'Aktif' then
    raise exception 'Edit template aktif tidak boleh mengubah status';
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

create or replace function public.ops_update_active_template(
  p_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_expected_revision integer,
  p_description text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tpl public.ops_equipment_templates%rowtype;
  v_item jsonb;
  v_eq_id uuid;
  v_qty integer;
  v_sort integer := 0;
  v_existing_ids uuid[];
  v_items_unchanged boolean;
  v_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_id is null then raise exception 'Template wajib dipilih'; end if;
  if not public.ops_can_manage_master(p_contract_id, p_up3_id) then
    raise exception 'Hanya Super Admin atau Admin UP3 yang dapat mengubah template' using errcode = '42501';
  end if;

  select * into v_tpl
  from public.ops_equipment_templates
  where id = p_id
  for update;
  if not found then raise exception 'Template tidak ditemukan'; end if;
  if v_tpl.contract_id is distinct from p_contract_id or v_tpl.up3_id is distinct from p_up3_id then
    raise exception 'Template berada di luar scope organisasi';
  end if;
  if v_tpl.status <> 'Aktif' then
    raise exception 'Hanya template Aktif yang dapat diperbarui melalui jalur ini';
  end if;
  if p_expected_revision is null or v_tpl.revision <> p_expected_revision then
    raise exception 'Template telah diubah pengguna lain. Muat ulang lalu coba lagi.' using errcode = '40001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Template membutuhkan minimal satu alat';
  end if;
  if (select count(*) from jsonb_array_elements(p_items))
     <> (select count(distinct nullif(btrim(value ->> 'equipment_id'), '')) from jsonb_array_elements(p_items)) then
    raise exception 'Setiap alat hanya boleh muncul satu kali';
  end if;

  select coalesce(array_agg(equipment_id), array[]::uuid[]) into v_existing_ids
  from public.ops_equipment_template_items
  where template_id = p_id;

  select
    (select jsonb_agg(jsonb_build_object(
      'equipment_id', nullif(btrim(value ->> 'equipment_id'), '')::uuid,
      'required_qty', coalesce(nullif(btrim(value ->> 'required_qty'), '')::integer, 0),
      'note', nullif(btrim(coalesce(value ->> 'note', '')), '')
    ) order by nullif(btrim(value ->> 'equipment_id'), '')::uuid)
    from jsonb_array_elements(p_items))
    is not distinct from
    (select jsonb_agg(jsonb_build_object(
      'equipment_id', ti.equipment_id,
      'required_qty', ti.required_qty,
      'note', nullif(btrim(coalesce(ti.note, '')), '')
    ) order by ti.equipment_id)
    from public.ops_equipment_template_items ti where ti.template_id = p_id)
  into v_items_unchanged;

  perform set_config('ops.allow_active_template_edit', 'on', true);

  update public.ops_equipment_templates
  set description = nullif(btrim(coalesce(p_description, '')), ''),
      updated_by = auth.uid()
  where id = p_id;

  -- Header-only edits preserve item IDs and their existing price snapshots.
  if not v_items_unchanged then
    delete from public.ops_equipment_template_items where template_id = p_id;

    for v_item in select * from jsonb_array_elements(p_items) loop
      v_eq_id := nullif(btrim(v_item ->> 'equipment_id'), '')::uuid;
      v_qty := coalesce(nullif(btrim(v_item ->> 'required_qty'), '')::integer, 0);
      if v_eq_id is null then raise exception 'Setiap baris membutuhkan alat dari katalog'; end if;
      if v_qty <= 0 then raise exception 'Setiap Jumlah Kebutuhan harus lebih dari 0'; end if;
      if not exists (select 1 from public.ops_equipment_items
        where id = v_eq_id and contract_id = p_contract_id and up3_id = p_up3_id and is_active)
        and not (v_eq_id = any(v_existing_ids)) then
        raise exception 'Alat tidak aktif pada scope ini';
      end if;
      v_sort := v_sort + 1;
      insert into public.ops_equipment_template_items(
        template_id, equipment_id, required_qty, note, sort_order,
        equipment_code, equipment_name, equipment_unit, equipment_category_name
      )
      select p_id, i.id, v_qty, nullif(btrim(coalesce(v_item ->> 'note', '')), ''), v_sort,
        i.code, i.name, i.unit, c.name
      from public.ops_equipment_items i
      left join public.ops_equipment_categories c on c.id = i.category_id
      where i.id = v_eq_id;
    end loop;
  end if;

  select row_to_json(t.*) into v_row from public.ops_equipment_templates t where t.id = p_id;
  return v_row;
end;
$function$;

do $$
declare
  v_template public.ops_equipment_templates%rowtype;
  v_expected_name text;
  v_items_before jsonb;
  v_items_after jsonb;
  v_header_after jsonb;
  v_previous_setting text := current_setting('ops.allow_active_template_edit', true);
begin
  select t.* into v_template
  from public.ops_equipment_templates t
  join public.contracts c on c.id = t.contract_id
  join public.organization_units u on u.id = t.up3_id
  where c.code = 'pelayanan-teknik' and u.legacy_key = 'up3' and u.type = 'UP3'
    and t.template_code = 'TMP-R4-PG003-TERIOS-V1'
  for update of t;
  if not found then return; end if;
  if v_template.status <> 'Aktif' or btrim(v_template.vehicle_variant) is distinct from 'Terios' then
    raise exception 'Template Terios berubah; koreksi nama dibatalkan';
  end if;

  select concat_ws(' - ', btrim(v.name), btrim(a.name), nullif(btrim(v_template.vehicle_variant), ''))
  into v_expected_name
  from public.ops_vehicle_types v
  join public.ops_vehicle_assignments a on a.id = v_template.assignment_id
    and a.contract_id = v_template.contract_id and a.up3_id = v_template.up3_id
  where v.id = v_template.vehicle_type_id
    and v.contract_id = v_template.contract_id and v.up3_id = v_template.up3_id
    and v.code = 'R4' and a.code = 'PG003';
  if not found then raise exception 'Konteks kendaraan template Terios tidak sesuai'; end if;
  if v_template.template_name = v_expected_name then return; end if;
  if v_template.template_name <> 'Pelayanan Teknik' then
    raise exception 'Nama template Terios telah berubah; koreksi dibatalkan';
  end if;

  select coalesce(jsonb_agg(to_jsonb(ti) order by ti.id), '[]'::jsonb) into v_items_before
  from public.ops_equipment_template_items ti where ti.template_id = v_template.id;

  perform set_config('ops.allow_active_template_edit', 'on', true);
  update public.ops_equipment_templates
  set template_name = v_expected_name, updated_by = auth.uid()
  where id = v_template.id;
  perform set_config('ops.allow_active_template_edit', coalesce(v_previous_setting, ''), true);

  select to_jsonb(t) into v_header_after
  from public.ops_equipment_templates t where t.id = v_template.id;
  if v_header_after ->> 'template_name' is distinct from v_expected_name
    or (v_header_after - array['template_name', 'revision', 'updated_at', 'updated_by'])
      is distinct from (to_jsonb(v_template) - array['template_name', 'revision', 'updated_at', 'updated_by']) then
    raise exception 'Koreksi nama tidak boleh mengubah identitas atau isi header template';
  end if;

  select coalesce(jsonb_agg(to_jsonb(ti) order by ti.id), '[]'::jsonb) into v_items_after
  from public.ops_equipment_template_items ti where ti.template_id = v_template.id;
  if v_items_after is distinct from v_items_before then
    raise exception 'Koreksi nama tidak boleh mengubah alat, jumlah, atau harga';
  end if;
end;
$$;
