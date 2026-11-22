-- Daily odometer ledger and monthly BBM worksheet. Writes are serialized per vehicle.
create schema if not exists bbm_private;
revoke all on schema bbm_private from public;
grant usage on schema bbm_private to authenticated;

create function bbm_private.can_access(p_vehicle uuid, p_write boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.ops_prescribed_vehicles v
    where v.id=p_vehicle and (
      (not p_write and public.auth_is_super_admin())
      or exists (
        select 1 from public.contract_memberships m
        where m.user_id=auth.uid() and m.contract_id=v.contract_id
          and m.operational_up3_id=v.up3_id and m.status='ACTIVE'
          and m.effective_from<=current_date and (m.effective_to is null or m.effective_to>current_date)
          and ((m.contract_role='ADMIN_ULP' and m.operational_unit_id=v.ulp_id)
            or (not p_write and m.contract_role='ADMIN_UP3'))
      )
    )
  );
$$;
revoke all on function bbm_private.can_access(uuid,boolean) from public;
grant execute on function bbm_private.can_access(uuid,boolean) to authenticated;

create table public.bbm_vehicle_ledgers (
  vehicle_id uuid primary key references public.ops_prescribed_vehicles(id),
  initial_odometer numeric(12,1) not null check(initial_odometer>=0 and initial_odometer<100000000),
  revision integer not null default 1,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table public.bbm_daily_records (
  vehicle_id uuid not null references public.bbm_vehicle_ledgers(vehicle_id),
  record_date date not null,
  end_odometer numeric(12,1) not null check(end_odometer>=0 and end_odometer<100000000),
  odometer_photo text not null,
  purchases jsonb not null default '[]' check(jsonb_typeof(purchases)='array' and jsonb_array_length(purchases)<=10),
  primary key(vehicle_id,record_date)
);
create table public.bbm_monthly_details (
  vehicle_id uuid not null references public.bbm_vehicle_ledgers(vehicle_id),
  month date not null check(extract(day from month)=1),
  details jsonb not null default '{}' check(jsonb_typeof(details)='object'),
  primary key(vehicle_id,month)
);
alter table public.bbm_vehicle_ledgers enable row level security;
alter table public.bbm_daily_records enable row level security;
alter table public.bbm_monthly_details enable row level security;
revoke all on public.bbm_vehicle_ledgers,public.bbm_daily_records,public.bbm_monthly_details from anon,authenticated;
grant select on public.bbm_vehicle_ledgers,public.bbm_daily_records,public.bbm_monthly_details to authenticated;
create policy bbm_ledger_read on public.bbm_vehicle_ledgers for select to authenticated using(bbm_private.can_access(vehicle_id));
create policy bbm_daily_read on public.bbm_daily_records for select to authenticated using(bbm_private.can_access(vehicle_id));
create policy bbm_details_read on public.bbm_monthly_details for select to authenticated using(bbm_private.can_access(vehicle_id));
create index bbm_ledger_actor on public.bbm_vehicle_ledgers(updated_by);

create function public.ops_list_bbm_vehicles(p_contract_id uuid,p_up3_id uuid,p_month date)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',v.id,'ulp_id',v.ulp_id,'label',v.label,'plate_display',v.plate_display,
   'can_write',bbm_private.can_access(v.id,true)) order by v.ulp_id,v.plate_display),'[]')
 from public.ops_prescribed_vehicles v
 where v.contract_id=p_contract_id and v.up3_id=p_up3_id
   and v.effective_month<=p_month and (v.end_month is null or v.end_month>p_month)
   and bbm_private.can_access(v.id);
$$;
create function public.ops_get_bbm_sheet(p_vehicle_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not bbm_private.can_access(p_vehicle_id) then raise exception 'Tidak berwenang membaca laporan BBM' using errcode='42501'; end if;
 if p_month is null or extract(day from p_month)<>1 then raise exception 'Periode tidak valid'; end if;
 select jsonb_build_object(
  'revision',coalesce((select revision from public.bbm_vehicle_ledgers where vehicle_id=p_vehicle_id),0),
  'initial_odometer',(select initial_odometer from public.bbm_vehicle_ledgers where vehicle_id=p_vehicle_id),
  'previous',(select jsonb_build_object('date',record_date,'end',end_odometer) from public.bbm_daily_records where vehicle_id=p_vehicle_id and record_date<p_month order by record_date desc limit 1),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('date',record_date,'end',end_odometer,'photo',odometer_photo,'purchases',purchases) order by record_date) from public.bbm_daily_records where vehicle_id=p_vehicle_id and record_date>=p_month and record_date<p_month+interval '1 month'),'[]'),
  'details',coalesce((select details from public.bbm_monthly_details where vehicle_id=p_vehicle_id and month=p_month),'{}'),
  'can_write',bbm_private.can_access(p_vehicle_id,true)
 ) into result;
 return result;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bbm-evidence','bbm-evidence',false,512000,array['image/jpeg','image/png','image/webp']);

create function bbm_private.photo_access(p_name text,p_write boolean)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v uuid;
begin
 if p_name !~ '^[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}-[0-9]{2}/(odometer|receipt)/[0-9a-f-]{36}\.(jpg|png|webp)$' then return false; end if;
 v:=split_part(p_name,'/',1)::uuid;
 return bbm_private.can_access(v,p_write);
exception when invalid_text_representation then return false;
end $$;
revoke all on function bbm_private.photo_access(text,boolean) from public;
grant execute on function bbm_private.photo_access(text,boolean) to authenticated;
create policy bbm_photo_read on storage.objects for select to authenticated
 using(bucket_id='bbm-evidence' and bbm_private.photo_access(name,false));
create policy bbm_photo_upload on storage.objects for insert to authenticated
 with check(bucket_id='bbm-evidence' and bbm_private.photo_access(name,true));
-- Immutable uploaded objects; replacements always get a new name.

create function bbm_private.check_photo(p_path text,p_vehicle uuid,p_date date,p_kind text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_path is null or p_path not like p_vehicle::text||'/'||p_date::text||'/'||p_kind||'/%'
   or not exists(select 1 from storage.objects where bucket_id='bbm-evidence' and name=p_path
     and (metadata->>'size')::bigint between 1 and 512000
     and metadata->>'mimetype' in ('image/jpeg','image/png','image/webp'))
 then raise exception 'Foto % tanggal % wajib diunggah (maksimal 500 KB)',p_kind,p_date; end if;
end $$;
revoke all on function bbm_private.check_photo(text,uuid,date,text) from public;

create function public.ops_save_bbm_sheet(p_vehicle_id uuid,p_month date,p_expected_revision integer,
 p_initial_odometer numeric,p_rows jsonb,p_details jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.ops_prescribed_vehicles; l public.bbm_vehicle_ledgers; r jsonb; b jsonb; d date;
 e numeric; liters numeric; price numeric; seq record; prior numeric;
begin
 if not bbm_private.can_access(p_vehicle_id,true) then raise exception 'Hanya Admin ULP dapat mengisi laporan ULP sendiri' using errcode='42501'; end if;
 select * into v from public.ops_prescribed_vehicles where id=p_vehicle_id for update;
 if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1
   or p_month<v.effective_month or (v.end_month is not null and p_month>=v.end_month)
   or p_month>date_trunc('month',now() at time zone 'Asia/Pontianak')::date
   or nullif(trim(v.plate_display),'') is null then raise exception 'Periode atau nopol kendaraan tidak valid'; end if;
 select * into l from public.bbm_vehicle_ledgers where vehicle_id=p_vehicle_id;
 if p_expected_revision is distinct from coalesce(l.revision,0) then raise exception 'Laporan berubah. Muat ulang sebelum menyimpan.' using errcode='40001'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>31
   or p_details is null or jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>20000
 then raise exception 'Format laporan tidak valid'; end if;
 if l.vehicle_id is null then
   if p_initial_odometer is null or p_initial_odometer<0 or p_initial_odometer>=100000000 or jsonb_array_length(p_rows)=0 then raise exception 'Isi stand awal pertama dan catatan harian'; end if;
   insert into public.bbm_vehicle_ledgers(vehicle_id,initial_odometer,updated_by)
   values(p_vehicle_id,p_initial_odometer,auth.uid()) returning * into l;
 end if;
 -- Existing dates cannot silently disappear when another tab or user edits the sheet.
 if exists(select 1 from public.bbm_daily_records x where x.vehicle_id=p_vehicle_id
   and x.record_date>=p_month and x.record_date<p_month+interval '1 month'
   and not exists(select 1 from jsonb_array_elements(p_rows) y where (y->>'date')::date=x.record_date))
 then raise exception 'Catatan tersimpan tidak boleh dihapus; koreksi nilainya'; end if;
 if (select count(*)<>count(distinct x->>'date') from jsonb_array_elements(p_rows) x) then raise exception 'Tanggal ganda'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
   d:=(r->>'date')::date; e:=(r->>'end')::numeric;
   if d is null or d<p_month or d>=p_month+interval '1 month' or d>(now() at time zone 'Asia/Pontianak')::date
     or e is null or e<0 or e>=100000000 or e<>round(e,1)
     or jsonb_typeof(r->'purchases') is distinct from 'array' or jsonb_array_length(r->'purchases')>10
   then raise exception 'Catatan harian tidak valid'; end if;
   perform bbm_private.check_photo(r->>'photo',p_vehicle_id,d,'odometer');
   for b in select value from jsonb_array_elements(r->'purchases') loop
     liters:=(b->>'liters')::numeric; price:=(b->>'price')::numeric;
     if liters is null or liters<=0 or liters>10000 or liters<>round(liters,3)
       or price is null or price<=0 or price>1000000 or price<>round(price,2)
       or coalesce(b->>'fuel','') not in ('Pertalite','Pertamax','Pertamax Turbo','Solar','Dexlite','Pertamina Dex','Premium')
       or length(coalesce(b->>'place',''))>200
     then raise exception 'Jenis BBM, liter, atau harga satuan tidak valid pada %',d; end if;
     perform bbm_private.check_photo(b->>'photo',p_vehicle_id,d,'receipt');
   end loop;
   insert into public.bbm_daily_records(vehicle_id,record_date,end_odometer,odometer_photo,purchases)
   values(p_vehicle_id,d,e,r->>'photo',r->'purchases')
   on conflict(vehicle_id,record_date) do update set end_odometer=excluded.end_odometer,
     odometer_photo=excluded.odometer_photo,purchases=excluded.purchases;
 end loop;
 prior:=l.initial_odometer;
 for seq in select record_date,end_odometer from public.bbm_daily_records where vehicle_id=p_vehicle_id order by record_date loop
   if seq.end_odometer<prior then raise exception 'Odometer mundur pada %. Periksa catatan sebelumnya/berikutnya.',seq.record_date; end if;
   prior:=seq.end_odometer;
 end loop;
 insert into public.bbm_monthly_details(vehicle_id,month,details) values(p_vehicle_id,p_month,p_details)
 on conflict(vehicle_id,month) do update set details=excluded.details;
 update public.bbm_vehicle_ledgers set revision=coalesce(p_expected_revision,0)+1,updated_at=now(),updated_by=auth.uid() where vehicle_id=p_vehicle_id;
 return public.ops_get_bbm_sheet(p_vehicle_id,p_month);
end $$;
revoke all on function public.ops_list_bbm_vehicles(uuid,uuid,date) from public,anon;
revoke all on function public.ops_get_bbm_sheet(uuid,date) from public,anon;
revoke all on function public.ops_save_bbm_sheet(uuid,date,integer,numeric,jsonb,jsonb) from public,anon;
grant execute on function public.ops_list_bbm_vehicles(uuid,uuid,date),public.ops_get_bbm_sheet(uuid,date),public.ops_save_bbm_sheet(uuid,date,integer,numeric,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
