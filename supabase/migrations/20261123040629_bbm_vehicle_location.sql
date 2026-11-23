-- Tampilkan lokasi penempatan kendaraan (Kantor ULP / Kantor Jaga) pada pemilih BBM.
-- Sumber lokasi sama dengan data Alat & Kendaraan: ops_prescribed_vehicles.location_id.
-- Nama mengikuti riwayat nama lokasi yang berlaku hari ini.
create or replace function public.ops_list_bbm_vehicles(p_contract_id uuid,p_up3_id uuid,p_month date)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',v.id,'ulp_id',v.ulp_id,'label',v.label,'plate_display',v.plate_display,
   'location_id',v.location_id,'location_name',ln.name,'location_type',l.type,
   'can_write',bbm_private.can_access(v.id,true)) order by v.ulp_id,v.plate_display),'[]')
 from public.ops_prescribed_vehicles v
 left join public.locations l on l.id=v.location_id and l.contract_id=v.contract_id and l.up3_id=v.up3_id
 left join lateral (
   select h.name from public.location_name_history h
   where h.location_id=v.location_id and h.effective_from<=public.ops_business_today()
     and (h.effective_to is null or h.effective_to>public.ops_business_today())
   order by h.effective_from desc limit 1
 ) ln on true
 where v.contract_id=p_contract_id and v.up3_id=p_up3_id
   and v.effective_month<=p_month and (v.end_month is null or v.end_month>p_month)
   and bbm_private.can_access(v.id);
$$;
revoke all on function public.ops_list_bbm_vehicles(uuid,uuid,date) from public,anon;
grant execute on function public.ops_list_bbm_vehicles(uuid,uuid,date) to authenticated;
