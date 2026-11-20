-- Filter before selecting the latest inspection: older months remain accessible.
create or replace function public.ops_get_vehicle_last_inspections(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_month date
) returns jsonb
language plpgsql stable security definer
set search_path to public, pg_temp
as $$
declare v_result jsonb;
begin
  if p_month is null or not isfinite(p_month) or extract(day from p_month) <> 1 then
    raise exception 'Periode harus tanggal pertama bulan' using errcode = '22023';
  end if;
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  if not public.ops_vehicle_can_read_inspections(p_contract_id, p_up3_id, p_ulp_id) then
    raise exception 'Tidak berwenang melihat inspeksi kendaraan pada ULP ini' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg((to_jsonb(v) - 'created_at') ||
    jsonb_build_object('inspected_by_name', p.display_name) order by v.slot_id), '[]'::jsonb)
  into v_result
  from (
    select distinct on (slot_id) id, slot_id, period_month, inspected_at,
      condition, note, photo_paths, inspected_by, created_at
    from public.ops_vehicle_inspections
    where contract_id = p_contract_id and up3_id = p_up3_id and ulp_id = p_ulp_id
      and period_month = p_month
    order by slot_id, inspected_at desc, created_at desc, id desc
  ) v
  left join public.profiles p on p.id = v.inspected_by;
  return v_result;
end;
$$;
revoke all on function public.ops_get_vehicle_last_inspections(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.ops_get_vehicle_last_inspections(uuid, uuid, uuid, date) to authenticated, service_role;
