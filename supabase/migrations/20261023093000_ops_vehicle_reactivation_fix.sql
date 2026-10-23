-- Perbaikan reaktivasi kendaraan: bila acuan hari-sama dihapus saat nonaktif,
-- jenis+penugasan dipulihkan dari riwayat acuan agar kendaraan bisa diaktifkan
-- kembali pada hari yang sama.

create or replace function public.ops_set_vehicle_status(
  p_vehicle_id uuid,
  p_status text,
  p_reason text,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v public.ops_vehicles%rowtype;
  v_status text := btrim(coalesce(p_status, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_today date := public.ops_business_today();
  v_open public.ops_vehicle_template_assignments%rowtype;
  v_type uuid;
  v_assignment uuid;
  v_template uuid;
  v_actor_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_status not in ('Aktif', 'Tidak Aktif') then raise exception 'Status kendaraan tidak dikenal'; end if;

  select * into v from public.ops_vehicles where id = p_vehicle_id for update;
  if not found then raise exception 'Kendaraan tidak ditemukan'; end if;
  if not public.ops_vehicle_can_manage(v.contract_id, v.up3_id, v.ulp_id) then
    raise exception 'Hanya Admin ULP pada unit ini yang dapat mengubah status kendaraan' using errcode = '42501';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v.revision then
    raise exception 'Data kendaraan sudah berubah. Muat ulang lalu coba lagi.';
  end if;
  if v.status = v_status then raise exception 'Status kendaraan tidak berubah'; end if;
  if v_reason is null then raise exception 'Alasan perubahan status wajib diisi'; end if;

  v_actor_role := public.ops_vehicle_actor_role(v.contract_id, v.up3_id, v.ulp_id);

  if v_status = 'Tidak Aktif' then
    update public.ops_vehicles
    set status = 'Tidak Aktif', inactive_reason = v_reason, updated_by = auth.uid()
    where id = v.id;

    select * into v_open
    from public.ops_vehicle_template_assignments
    where vehicle_id = v.id and effective_to is null
    order by effective_from desc, created_at desc
    limit 1;
    if found then
      if v_open.effective_from >= v_today then
        delete from public.ops_vehicle_template_assignments where id = v_open.id;
      else
        update public.ops_vehicle_template_assignments
        set effective_to = v_today
        where id = v_open.id;
      end if;
    end if;
  else
    select t.vehicle_type_id, t.assignment_id into v_type, v_assignment
    from public.ops_vehicle_template_assignments a
    join public.ops_equipment_templates t on t.id = a.template_id
    where a.vehicle_id = v.id
    order by a.effective_from desc, a.created_at desc
    limit 1;
    if v_type is null then
      select t.vehicle_type_id, t.assignment_id into v_type, v_assignment
      from public.ops_vehicle_history h
      join public.ops_equipment_templates t
        on t.id = coalesce((h.detail->>'to_template_id')::uuid, (h.detail->>'template_id')::uuid)
      where h.vehicle_id = v.id and h.action in ('ASSIGNED', 'CREATED')
      order by h.created_at desc
      limit 1;
    end if;
    if v_type is null then raise exception 'Kendaraan belum memiliki acuan template'; end if;

    select t.id into v_template
    from public.ops_equipment_templates t
    where t.contract_id = v.contract_id and t.up3_id = v.up3_id and t.status = 'Aktif'
      and t.vehicle_type_id = v_type and t.assignment_id = v_assignment
    order by t.version_number desc
    limit 1;
    if v_template is null then
      raise exception 'Tidak ada template Aktif untuk acuan kendaraan ini';
    end if;

    update public.ops_vehicles
    set status = 'Aktif', inactive_reason = null, updated_by = auth.uid()
    where id = v.id;

    if not exists (
      select 1 from public.ops_vehicle_template_assignments
      where vehicle_id = v.id and effective_to is null
    ) then
      insert into public.ops_vehicle_template_assignments(
        vehicle_id, template_id, contract_id, up3_id, ulp_id, effective_from, created_by
      )
      values (v.id, v_template, v.contract_id, v.up3_id, v.ulp_id, v_today, auth.uid());
    end if;
  end if;

  insert into public.ops_vehicle_history(vehicle_id, contract_id, up3_id, ulp_id, action, detail, actor_id, actor_role)
  values (
    v.id, v.contract_id, v.up3_id, v.ulp_id, 'STATUS_CHANGED',
    jsonb_build_object('from', v.status, 'to', v_status, 'reason', v_reason),
    auth.uid(), v_actor_role
  );

  return public.ops_get_vehicle(p_vehicle_id);
end;
$function$;
