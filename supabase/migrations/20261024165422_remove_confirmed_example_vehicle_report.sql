-- User-confirmed removal of example prescribed vehicle CONTOH 1234 and its Oct 2026 report.
-- Template, ULP, organization, other vehicles and reports are preserved.
do $$
declare
  v_slot public.ops_prescribed_vehicles;
  v_report public.ops_vehicle_monthly_reports;
  v_deleted integer;
begin
  lock table public.ops_prescribed_vehicles, public.ops_prescribed_vehicle_history,
    public.ops_vehicle_monthly_reports, public.ops_vehicle_monthly_history
    in share row exclusive mode;

  select s.* into v_slot from public.ops_prescribed_vehicles s
  where s.id = 'cd9b957e-3912-4de5-8fb0-42e797c1b446'
    and s.contract_id = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'
    and s.up3_id = '3215235c-c194-43a1-84d2-25c767c75d7a'
    and s.ulp_id = '666b6ea4-f53d-47f7-b73e-88f2e93f7e56'
    and s.plate_normalized = 'CONTOH1234'
    and s.label = 'Roda 2 - Koordinator'
    and s.legacy_vehicle_id is null
  for update;
  if not found then
    raise exception 'Example prescribed vehicle no longer matches; removal aborted';
  end if;

  select r.* into v_report from public.ops_vehicle_monthly_reports r
  where r.id = 'cdf65199-0314-40b7-abf6-a9a49bae446b'
    and r.contract_id = v_slot.contract_id and r.up3_id = v_slot.up3_id
    and r.ulp_id = v_slot.ulp_id and r.period_month = '2026-10-01'
  for update;
  if not found then
    raise exception 'Expected October 2026 report no longer matches; removal aborted';
  end if;

  if jsonb_array_length(v_report.vehicles) <> 1
    or not (v_report.vehicles @> jsonb_build_array(jsonb_build_object('id', v_slot.id)))
    or exists (
      select 1 from jsonb_array_elements(v_report.items) item
      where coalesce(item ->> 'vehicle_id', '') <> v_slot.id::text
    ) then
    raise exception 'Report contains additional vehicles; removal aborted';
  end if;

  if exists (
    select 1 from public.ops_vehicle_monthly_reports r
    where r.contract_id = v_slot.contract_id and r.up3_id = v_slot.up3_id
      and r.ulp_id = v_slot.ulp_id and r.id <> v_report.id
      and r.vehicles @> jsonb_build_array(jsonb_build_object('id', v_slot.id))
  ) then
    raise exception 'Vehicle is referenced by another report; removal aborted';
  end if;

  if exists (select 1 from public.ops_prescribed_vehicles s
    where s.id <> v_slot.id and s.plate_normalized = v_slot.plate_normalized) then
    raise exception 'Plate is referenced by another slot; removal aborted';
  end if;

  alter table public.ops_vehicle_monthly_history disable trigger ops_vehicle_monthly_history_guard;
  alter table public.ops_vehicle_monthly_reports disable trigger ops_vehicle_monthly_guard;
  alter table public.ops_prescribed_vehicle_history disable trigger ops_prescribed_history_guard;
  alter table public.ops_prescribed_vehicles disable trigger ops_prescribed_guard;

  delete from public.ops_vehicle_monthly_history where report_id = v_report.id;
  delete from public.ops_vehicle_monthly_reports where id = v_report.id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then raise exception 'Report removal count was %; expected 1', v_deleted; end if;

  delete from public.ops_prescribed_vehicle_history where slot_id = v_slot.id;
  delete from public.ops_prescribed_vehicles where id = v_slot.id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then raise exception 'Vehicle removal count was %; expected 1', v_deleted; end if;

  alter table public.ops_prescribed_vehicles enable trigger ops_prescribed_guard;
  alter table public.ops_prescribed_vehicle_history enable trigger ops_prescribed_history_guard;
  alter table public.ops_vehicle_monthly_reports enable trigger ops_vehicle_monthly_guard;
  alter table public.ops_vehicle_monthly_history enable trigger ops_vehicle_monthly_history_guard;
end;
$$;
