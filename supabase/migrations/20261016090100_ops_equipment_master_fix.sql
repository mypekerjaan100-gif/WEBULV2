-- Perbaikan variabel return ops_save_template_draft (jsonb vs text).
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
