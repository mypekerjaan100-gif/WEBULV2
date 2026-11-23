-- Execute migration + this file within BEGIN / ROLLBACK only.
create function pg_temp.bbm_expect_failure(command text, expected text) returns void language plpgsql as $$
declare message text;
begin
 begin execute command; exception when others then
   get stacked diagnostics message=message_text;
   if position(expected in message)=0 then raise exception 'Unexpected: %, expected %',message,expected; end if;
   return;
 end;
 raise exception 'Expected failure: %',command;
end $$;

do $$
declare v public.ops_prescribed_vehicles; actor uuid; outsider uuid; k3 uuid; up3 uuid; p date;
begin
 select s.* into v from public.ops_prescribed_vehicles s where s.plate_display is not null
   and s.effective_month<=date_trunc('month',current_date)::date
   and (s.end_month is null or s.end_month>date_trunc('month',current_date)::date)
   and exists(select 1 from public.contract_memberships m where m.operational_unit_id=s.ulp_id and m.contract_role='ADMIN_ULP' and m.status='ACTIVE') limit 1;
 select user_id into actor from public.contract_memberships where operational_unit_id=v.ulp_id and contract_role='ADMIN_ULP' and status='ACTIVE' limit 1;
 select user_id into outsider from public.contract_memberships where operational_unit_id<>v.ulp_id and contract_role='ADMIN_ULP' and status='ACTIVE' limit 1;
 select user_id into k3 from public.contract_memberships where contract_role like 'CUSTOM_%' and status='ACTIVE' limit 1;
 select user_id into up3 from public.contract_memberships where contract_role='ADMIN_UP3' and operational_up3_id=v.up3_id and contract_id=v.contract_id and status='ACTIVE' limit 1;
 if actor is null or outsider is null or k3 is null then raise exception 'Missing BBM fixtures'; end if;
 perform set_config('bbm.test.vehicle',v.id::text,true);
 perform set_config('bbm.test.actor',actor::text,true);
 perform set_config('bbm.test.outsider',outsider::text,true);
 p:=date_trunc('month',current_date)::date;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if not bbm_private.can_access(v.id,true) then raise exception 'Own ULP denied'; end if;
  if v.location_id is not null and not exists (
    select 1 from jsonb_array_elements(public.ops_list_bbm_vehicles(v.contract_id,v.up3_id,p)) e
    where (e->>'id')::uuid=v.id and e->>'location_id'=v.location_id::text and nullif(e->>'location_name','') is not null
  ) then raise exception 'Vehicle placement location missing from BBM list'; end if;
 if bbm_private.photo_access(gen_random_uuid()||'/2026-11-01/odometer/'||gen_random_uuid()||'.jpg',true) then raise exception 'Foreign storage allowed'; end if;
 perform pg_temp.bbm_expect_failure(format('select public.ops_save_bbm_sheet(%L,%L,0,100,%L::jsonb,''{}'')',v.id,p,
  jsonb_build_array(jsonb_build_object('date',p,'end',120,'photo','missing','purchases','[]'::jsonb))), 'Foto');
 if exists(select 1 from public.bbm_vehicle_ledgers where vehicle_id=v.id) then raise exception 'Failed save left data'; end if;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 if bbm_private.can_access(v.id) then raise exception 'Foreign ULP can read'; end if;
 perform pg_temp.bbm_expect_failure(format('select public.ops_get_bbm_sheet(%L,%L)',v.id,p),'Tidak berwenang');
 perform set_config('request.jwt.claim.sub',k3::text,true);
 if bbm_private.can_access(v.id) then raise exception 'Custom role can read'; end if;
 if up3 is not null then
   perform set_config('request.jwt.claim.sub',up3::text,true);
   if not bbm_private.can_access(v.id) or bbm_private.can_access(v.id,true) then raise exception 'UP3 rights incorrect'; end if;
 end if;
 if has_function_privilege('anon','public.ops_save_bbm_sheet(uuid,date,integer,numeric,jsonb,jsonb)','EXECUTE')
   or has_table_privilege('authenticated','public.bbm_daily_records','INSERT') then raise exception 'Write ACL exposed'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 if bbm_private.can_access(v.id) then raise exception 'Anonymous can read'; end if;
end $$;
-- Positive ledger tests use a transaction-local photo validator stub; no Storage objects are created.
-- Real missing-photo rejection and scoped Storage predicates were tested above.
create or replace function bbm_private.check_photo(p_path text,p_vehicle uuid,p_date date,p_kind text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_path <> p_vehicle||'/'||p_date||'/'||p_kind||'/fixture.jpg' then raise exception 'Invalid test photo'; end if;
end $$;
do $$
declare v uuid:=current_setting('bbm.test.vehicle')::uuid; actor uuid:=current_setting('bbm.test.actor')::uuid;
 p date:=date_trunc('month',current_date)::date; r jsonb; r2 jsonb; result jsonb; purchase jsonb;
begin
 perform set_config('request.jwt.claim.sub',actor::text,true);
 r:=jsonb_build_object('date',p,'end',120,'photo',v||'/'||p||'/odometer/fixture.jpg','purchases','[]'::jsonb);
 result:=public.ops_save_bbm_sheet(v,p,0,100,jsonb_build_array(r),'{"inspector_name":"rollback"}');
 if result->>'revision'<>'1' or result->>'initial_odometer'<>'100.0' then raise exception 'First save failed: %',result; end if;
 purchase:=jsonb_build_object('fuel','Pertalite','liters',5,'price',10000,'photo',v||'/'||(p+1)||'/receipt/fixture.jpg');
 r2:=jsonb_build_object('date',p+1,'end',160,'photo',v||'/'||(p+1)||'/odometer/fixture.jpg','purchases',jsonb_build_array(purchase,purchase));
 perform public.ops_save_bbm_sheet(v,p,1,100,jsonb_build_array(r,r2),'{}');
 perform pg_temp.bbm_expect_failure(format('select public.ops_save_bbm_sheet(%L,%L,1,100,%L,''{}'')',v,p,jsonb_build_array(r,r2)),'Laporan berubah');
 perform pg_temp.bbm_expect_failure(format('select public.ops_save_bbm_sheet(%L,%L,2,100,%L,''{}'')',v,p,jsonb_build_array(r||'{"end":170}',r2)),'Odometer mundur');
 perform pg_temp.bbm_expect_failure(format('select public.ops_save_bbm_sheet(%L,%L,2,100,%L,''{}'')',v,p,jsonb_build_array(r)),'tidak boleh dihapus');
 perform pg_temp.bbm_expect_failure(format('select public.ops_save_bbm_sheet(%L,%L,2,100,%L,''{}'')',v,p,jsonb_build_array(r,r)),'tidak boleh dihapus');
 result:=public.ops_save_bbm_sheet(v,p,2,100,jsonb_build_array(r||'{"end":130}',r2),'{}');
 if result->>'revision'<>'3' then raise exception 'Correction revision failed'; end if;
 result:=public.ops_get_bbm_sheet(v,(p+interval '1 month')::date);
 if result->'previous'->>'end'<>'160.0' then raise exception 'Cross month carryover failed'; end if;
end $$;
set local role authenticated;
do $$
declare v uuid:=current_setting('bbm.test.vehicle')::uuid;
begin
 perform set_config('request.jwt.claim.sub',current_setting('bbm.test.actor'),true);
 if (select count(*) from public.bbm_daily_records where vehicle_id=v)<>2 then raise exception 'RLS hides own rows'; end if;
 perform set_config('request.jwt.claim.sub',current_setting('bbm.test.outsider'),true);
 if exists(select 1 from public.bbm_daily_records where vehicle_id=v) then raise exception 'RLS exposes foreign rows'; end if;
end $$;
reset role;
select 'BBM rollback checks passed: scope, photos, ACL, duplicates, revisions, corrections, chronology and carryover (positive photo paths stubbed)' result;
