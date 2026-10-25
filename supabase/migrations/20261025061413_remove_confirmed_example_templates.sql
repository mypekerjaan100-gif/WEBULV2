set local lock_timeout = '5s';

do $$
declare
  v_template_ids uuid[] := array[
    'b1181a7a-aa36-493a-bde6-dfc3c6e26f7a'::uuid,
    'f8933aa5-ecbc-4f82-8fc9-286dbf48e839'::uuid
  ];
  v_slot_ids uuid[] := array[
    '41511e14-eb57-49b8-b40e-454679263a64'::uuid,
    '82001b62-15f8-4180-82ed-c869186b7690'::uuid
  ];
  v_report_id uuid := 'f6f25e29-a0df-4c1f-a530-bdb8b6eb3314'::uuid;
  v_template_count integer;
  v_slot_count integer;
  v_report_count integer;
  v_report_history integer;
  v_slot_history integer;
  v_deleted integer;
begin
  lock table public.ops_equipment_templates, public.ops_equipment_template_items,
    public.ops_prescribed_vehicles, public.ops_prescribed_vehicle_history,
    public.ops_vehicle_monthly_reports, public.ops_vehicle_monthly_history
    in share row exclusive mode;

  select count(*) into v_template_count
  from public.ops_equipment_templates
  where id = any(v_template_ids);
  if v_template_count = 0 then
    return;
  end if;
  if v_template_count <> 2 then
    raise exception 'Expected two example templates; removal aborted';
  end if;

  if (select count(*) from public.ops_equipment_templates
      where id = any(v_template_ids)
        and (
          (id = v_template_ids[1] and template_name = 'contoh 1'
            and template_code = 'TMP-R2-PG001-HONDALISTRIKPOLITRON-V1' and status = 'Aktif')
          or
          (id = v_template_ids[2] and template_name = 'contoh 2'
            and template_code = 'TMP-R2-PG002-HONDALISTRIKPOLITRON-V1' and status = 'Aktif')
        )) <> 2 then
    raise exception 'Example template identity changed; removal aborted';
  end if;

  if exists (select 1 from public.ops_vehicle_template_assignments
      where template_id = any(v_template_ids))
    or exists (select 1 from public.ops_equipment_templates
      where previous_version_id = any(v_template_ids))
    or exists (select 1 from public.ops_vehicle_history
      where detail::text like '%b1181a7a-aa36-493a-bde6-dfc3c6e26f7a%'
         or detail::text like '%f8933aa5-ecbc-4f82-8fc9-286dbf48e839%') then
    raise exception 'Example templates have additional dependencies; removal aborted';
  end if;

  select count(*) into v_slot_count
  from public.ops_prescribed_vehicles
  where id = any(v_slot_ids)
    and contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'
    and up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'
    and ulp_id = '666b6ea4-f53d-47f7-b73e-88f2e93f7e56'
    and template_id = any(v_template_ids)
    and legacy_vehicle_id is null;
  if v_slot_count not in (0, 2) then
    raise exception 'Expected two example prescribed vehicles; removal aborted';
  end if;
  if v_slot_count <> (select count(*) from public.ops_prescribed_vehicles where template_id = any(v_template_ids)) then
    raise exception 'Other prescribed vehicles use the example templates; removal aborted';
  end if;

  if v_slot_count = 2 then
    if exists (select 1 from public.ops_prescribed_vehicles
        where template_id = any(v_template_ids)
          and id <> all(v_slot_ids)) then
      raise exception 'Unexpected prescribed vehicles remain; removal aborted';
    end if;
    if exists (select 1 from public.ops_prescribed_vehicles
        where id not in ('41511e14-eb57-49b8-b40e-454679263a64','82001b62-15f8-4180-82ed-c869186b7690')
          and plate_normalized in ('CONTOH321','CONTOH123')) then
      raise exception 'Example plate is referenced by another slot; removal aborted';
    end if;
    if exists (select 1 from public.ops_vehicle_monthly_reports r
        where r.id <> v_report_id
          and (r.vehicles @> jsonb_build_array(jsonb_build_object('id', v_slot_ids[1]))
            or r.vehicles @> jsonb_build_array(jsonb_build_object('id', v_slot_ids[2])))) then
      raise exception 'Example vehicles are referenced by another report; removal aborted';
    end if;
  end if;

  select count(*) into v_report_count
  from public.ops_vehicle_monthly_reports
  where id = v_report_id
    and contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'
    and up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'
    and ulp_id = '666b6ea4-f53d-47f7-b73e-88f2e93f7e56'
    and period_month = '2026-10-01';
  if v_report_count = 1 then
    if (select jsonb_array_length(vehicles) from public.ops_vehicle_monthly_reports where id = v_report_id) <> 2
      or exists (
        select 1 from public.ops_vehicle_monthly_reports r
        cross join lateral jsonb_array_elements(r.vehicles) vehicle
        where r.id = v_report_id and (vehicle ->> 'id')::uuid <> all(v_slot_ids)
      )
      or exists (
        select 1 from public.ops_vehicle_monthly_reports r
        cross join lateral jsonb_array_elements(r.items) item
        where r.id = v_report_id and (item ->> 'vehicle_id')::uuid <> all(v_slot_ids)
      ) then
      raise exception 'October report contains additional vehicles; removal aborted';
    end if;
  elsif v_report_count > 1 then
    raise exception 'Multiple matching reports; removal aborted';
  end if;

  select count(*) into v_report_history
  from public.ops_vehicle_monthly_history
  where report_id = v_report_id;
  select count(*) into v_slot_history
  from public.ops_prescribed_vehicle_history
  where slot_id = any(v_slot_ids);

  alter table public.ops_vehicle_monthly_history disable trigger ops_vehicle_monthly_history_guard;
  alter table public.ops_vehicle_monthly_reports disable trigger ops_vehicle_monthly_guard;
  alter table public.ops_prescribed_vehicle_history disable trigger ops_prescribed_history_guard;
  alter table public.ops_prescribed_vehicles disable trigger ops_prescribed_guard;
  alter table public.ops_equipment_template_items disable trigger trg_ops_template_items_content_guard;

  if v_slot_count = 2 then
    delete from public.ops_prescribed_vehicle_history where slot_id = any(v_slot_ids);
    get diagnostics v_deleted = row_count;
    if v_deleted <> v_slot_history then
      raise exception 'Prescribed history removal count was %; expected %', v_deleted, v_slot_history;
    end if;

    delete from public.ops_prescribed_vehicles where id = any(v_slot_ids);
    get diagnostics v_deleted = row_count;
    if v_deleted <> 2 then
      raise exception 'Prescribed vehicle removal count was %; expected 2', v_deleted;
    end if;
  end if;

  if v_report_count = 1 then
    delete from public.ops_vehicle_monthly_history where report_id = v_report_id;
    get diagnostics v_deleted = row_count;
    if v_deleted <> v_report_history then
      raise exception 'Report history removal count was %; expected %', v_deleted, v_report_history;
    end if;

    delete from public.ops_vehicle_monthly_reports where id = v_report_id;
    get diagnostics v_deleted = row_count;
    if v_deleted <> 1 then
      raise exception 'Report removal count was %; expected 1', v_deleted;
    end if;
  end if;

  delete from public.ops_equipment_template_items where template_id = any(v_template_ids);
  delete from public.ops_equipment_templates
  where id = any(v_template_ids)
    and template_name in ('contoh 1','contoh 2');
  get diagnostics v_deleted = row_count;
  if v_deleted <> 2 then
    raise exception 'Template removal count was %; expected 2', v_deleted;
  end if;

  alter table public.ops_equipment_template_items enable trigger trg_ops_template_items_content_guard;
  alter table public.ops_prescribed_vehicles enable trigger ops_prescribed_guard;
  alter table public.ops_prescribed_vehicle_history enable trigger ops_prescribed_history_guard;
  alter table public.ops_vehicle_monthly_reports enable trigger ops_vehicle_monthly_guard;
  alter table public.ops_vehicle_monthly_history enable trigger ops_vehicle_monthly_history_guard;
end;
$$;
