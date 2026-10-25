-- Edit isi template Aktif secara terkontrol. Identitas dan status tetap;
-- laporan bulanan yang sudah tersimpan tetap memakai snapshot masing-masing.
create or replace function public.guard_ops_template_content()
returns trigger
language plpgsql
as $function$
declare
  v_active_edit boolean := coalesce(current_setting('ops.allow_active_template_edit', true), '') = 'on';
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
     or new.previous_version_id is distinct from old.previous_version_id then
    raise exception 'Konten template yang sudah terbit bersifat tetap. Duplikasi ke versi baru untuk perubahan.';
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

create or replace function public.guard_ops_template_item_content()
returns trigger
language plpgsql
as $function$
declare
  v_status text;
  v_active_edit boolean := coalesce(current_setting('ops.allow_active_template_edit', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    select status into v_status from public.ops_equipment_templates where id = old.template_id;
    if v_status is distinct from 'Draft'
       and not (v_status = 'Aktif' and v_active_edit) then
      raise exception 'Rincian alat template terbitan bersifat tetap';
    end if;
    return old;
  end if;

  select status into v_status from public.ops_equipment_templates where id = new.template_id;
  if v_status is null then
    raise exception 'Template rincian tidak ditemukan';
  end if;
  if v_status <> 'Draft' then
    if v_status = 'Aktif' and v_active_edit then
      if tg_op = 'UPDATE' and new.template_id is distinct from old.template_id then
        raise exception 'Edit template aktif tidak boleh memindahkan rincian alat';
      end if;
      return new;
    end if;
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
set search_path to public, pg_temp
as $function$
declare
  v_tpl public.ops_equipment_templates%rowtype;
  v_item jsonb;
  v_eq_id uuid;
  v_qty integer;
  v_sort integer := 0;
  v_existing_ids uuid[];
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

  perform set_config('ops.allow_active_template_edit', 'on', true);

  update public.ops_equipment_templates
  set description = nullif(btrim(coalesce(p_description, '')), ''),
      updated_by = auth.uid()
  where id = p_id;

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

  select row_to_json(t.*) into v_row from public.ops_equipment_templates t where t.id = p_id;
  return v_row;
end;
$function$;

revoke all on function public.ops_update_active_template(uuid, uuid, uuid, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ops_update_active_template(uuid, uuid, uuid, integer, text, jsonb)
  to authenticated;
