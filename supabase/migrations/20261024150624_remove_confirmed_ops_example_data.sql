-- User-confirmed removal of ALT001-ALT010, their example template and vehicle 1234.
-- Unrelated catalog, organization, imported data and monthly reports are preserved.
set local lock_timeout = '5s';

do $$
declare
  v_template public.ops_equipment_templates;
  v_vehicle public.ops_vehicles;
  v_equipment uuid[];
  v_count integer;
begin
  lock table public.ops_equipment_items, public.ops_equipment_templates,
    public.ops_equipment_template_items, public.ops_vehicles,
    public.ops_vehicle_template_assignments, public.ops_vehicle_history,
    public.ops_prescribed_vehicles, public.ops_vehicle_monthly_reports,
    public.ops_ulp_templates, public.ops_ulp_condition_reports
    in share row exclusive mode;

  select t.* into v_template from public.ops_equipment_templates t
  where t.template_code = 'TMP-R2-PG001-V1' and t.template_name = 'Roda 2 — Koordinator'
    and exists (select 1 from public.ops_vehicle_template_assignments a
      join public.ops_vehicles v on v.id = a.vehicle_id
      where a.template_id = t.id and v.contract_id = t.contract_id and v.up3_id = t.up3_id
        and v.plate_normalized = '1234' and v.brand = 'contoh');
  if not found then
    if exists (select 1 from public.ops_equipment_templates where template_code = 'TMP-R2-PG001-V1') then
      raise exception 'Example data changed; review before removing';
    end if;
    return;
  end if;

  select v.* into strict v_vehicle from public.ops_vehicles v
  where v.contract_id = v_template.contract_id and v.up3_id = v_template.up3_id
    and v.plate_normalized = '1234' and v.brand = 'contoh';

  with expected(code, name) as (values
    ('ALT001', 'Strainging Device/Ratchet Puller 2 ton + comelong'),
    ('ALT002', 'Voltage Detector full range TR - TM'),
    ('ALT003', 'Pengupas Kabel isolasi JTR JTM'),
    ('ALT004', 'Telescopic hotstick 20 kV 10,5 Meter'),
    ('ALT005', 'Telescopic hotstick 20 kV 1,5 Meter'),
    ('ALT006', 'Groundcluster'),
    ('ALT007', 'Tang Ampere (AVO Meter)'),
    ('ALT008', 'Telescopic hotstick 20 kV 10,5 Meter'),
    ('ALT009', 'Tangga Fiber ( 2 section ladder ) 9,6 mtr'),
    ('ALT010', 'Groundcluster')
  )
  select array_agg(i.id) into v_equipment from public.ops_equipment_items i
    join expected e on e.code = i.code and e.name = i.name
  where i.contract_id = v_template.contract_id and i.up3_id = v_template.up3_id
    and i.age_months is null;
  if cardinality(v_equipment) is distinct from 10 then
    raise exception 'Expected ten unchanged example equipment records; removal aborted';
  end if;

  if exists (select 1 from public.ops_equipment_template_items
      where equipment_id = any(v_equipment) and template_id <> v_template.id)
    or exists (select 1 from public.ops_equipment_templates where previous_version_id = v_template.id)
    or exists (select 1 from public.ops_vehicle_template_assignments
      where (template_id = v_template.id and vehicle_id <> v_vehicle.id)
        or (vehicle_id = v_vehicle.id and template_id <> v_template.id))
    or exists (select 1 from public.ops_prescribed_vehicles
      where template_id = v_template.id or legacy_vehicle_id = v_vehicle.id)
    or exists (select 1 from public.ops_vehicle_monthly_reports
      where contract_id = v_template.contract_id and up3_id = v_template.up3_id)
    or exists (select 1 from public.ops_ulp_condition_reports
      where contract_id = v_template.contract_id and up3_id = v_template.up3_id)
    or exists (select 1 from public.ops_ulp_templates t
      cross join lateral jsonb_array_elements(t.items) item
      where item ->> 'source_id' in (select id::text from unnest(v_equipment) id)) then
    raise exception 'Example data has additional dependencies; removal aborted';
  end if;
  if (select count(*) from public.ops_equipment_template_items where template_id = v_template.id) <> 6
    or exists (select 1 from public.ops_equipment_template_items
      where template_id = v_template.id and not (equipment_id = any(v_equipment))) then
    raise exception 'Example template contents changed; removal aborted';
  end if;

  delete from public.ops_vehicle_history where vehicle_id = v_vehicle.id;
  delete from public.ops_vehicle_template_assignments where vehicle_id = v_vehicle.id and template_id = v_template.id;
  delete from public.ops_vehicles where id = v_vehicle.id;

  alter table public.ops_equipment_template_items disable trigger trg_ops_template_items_content_guard;
  delete from public.ops_equipment_template_items where template_id = v_template.id;
  delete from public.ops_equipment_templates where id = v_template.id;
  delete from public.ops_equipment_items where id = any(v_equipment);
  get diagnostics v_count = row_count;
  if v_count <> 10 then raise exception 'Unexpected removal count'; end if;
  alter table public.ops_equipment_template_items enable trigger trg_ops_template_items_content_guard;
end;
$$;
