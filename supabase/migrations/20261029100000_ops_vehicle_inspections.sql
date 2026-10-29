-- Inspeksi kendaraan pertanggal/jam: riwayat terpisah (append-only) per slot
-- kendaraan yang ditetapkan (ops_prescribed_vehicles). Fitur ini tidak menyentuh
-- inspeksi alat, rekap Baik/Rusak bulanan, maupun bucket bukti alat.
--
-- Wajib 4 foto satu slot masing-masing: samping kanan, samping kiri,
-- tampak depan, tampak belakang; setiap foto maksimal 500 KB setelah kompresi
-- (dicek ulang oleh RPC dari metadata berkas penyimpanan).

-- Objek foto: tepat 4 kunci slot, tiap kunci berisi tepat satu path foto.
create or replace function public.ops_vehicle_inspection_photos_object_valid(p_paths jsonb)
returns boolean
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $$
declare
  v_keys constant text[] := array['SIDE_RIGHT', 'SIDE_LEFT', 'FRONT', 'REAR'];
  v_key text;
  v_path text;
begin
  if jsonb_typeof(p_paths) is distinct from 'object' then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(p_paths) k) <> 4 then
    return false;
  end if;
  foreach v_key in array v_keys loop
    v_path := btrim(p_paths ->> v_key);
    if v_path is null or v_path = '' or v_path like '%..%' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create table if not exists public.ops_vehicle_inspections (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.ops_prescribed_vehicles(id) on delete restrict,
  contract_id uuid not null,
  up3_id uuid not null,
  ulp_id uuid not null references public.organization_units(id) on delete restrict,
  period_month date not null check (isfinite(period_month) and extract(day from period_month) = 1),
  inspected_at timestamptz not null,
  condition text not null check (condition in ('GOOD', 'DAMAGED')),
  note text not null default '' check (length(note) <= 2000),
  photo_paths jsonb not null check (public.ops_vehicle_inspection_photos_object_valid(photo_paths)),
  inspected_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (contract_id, up3_id) references public.contract_up3_scopes(contract_id, up3_id) on delete restrict
);

create index if not exists ops_vehicle_inspections_slot
  on public.ops_vehicle_inspections(slot_id, inspected_at desc);
create index if not exists ops_vehicle_inspections_scope
  on public.ops_vehicle_inspections(contract_id, up3_id, ulp_id, period_month);

alter table public.ops_vehicle_inspections enable row level security;
revoke all on table public.ops_vehicle_inspections from public, anon, authenticated, service_role;

-- Append-only: riwayat inspeksi kendaraan tidak boleh diedit atau dihapus.
create or replace function public.ops_vehicle_inspections_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  raise exception 'Vehicle inspections are append-only';
end;
$$;

drop trigger if exists trg_ops_vehicle_inspections_guard on public.ops_vehicle_inspections;
create trigger trg_ops_vehicle_inspections_guard
  before update or delete on public.ops_vehicle_inspections
  for each row execute function public.ops_vehicle_inspections_guard();

-- Gate baca: Super Admin, Admin UP3/Admin ULP pada scope, role custom dengan
-- alat.read, dan manajemen. Gate tulis: Super Admin atau role custom alat.inspect
-- (petugas K3), tepat pada ULP penugasannya.
create or replace function public.ops_vehicle_can_read_inspections(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
        and (cm.contract_role = 'ADMIN_UP3'
          or (cm.contract_role = 'ADMIN_ULP' and cm.operational_unit_id = p_ulp_id))
    )
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_ulp_id, 'alat.read')
    or public.auth_has_management_operational_scope(p_contract_id, p_up3_id, p_ulp_id)
  )
$function$;

create or replace function public.ops_vehicle_can_submit_inspection(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_ulp_id, 'alat.inspect')
  )
$function$;

-- Bucket tersendiri untuk bukti inspeksi kendaraan (privat, 5 MB, foto saja).
-- Batas garis keras 500 KB per foto ditegakkan oleh ops_validate_vehicle_photo_paths.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ops-vehicle-inspections', 'ops-vehicle-inspections', false, 5242880, array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.ops_vehicle_can_read_evidence_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((
    select public.ops_vehicle_can_read_inspections(p.contract_id, p.up3_id, p.ulp_id)
    from public.ops_tool_evidence_parts(p_name) p
    limit 1
  ), false)
$function$;

create or replace function public.ops_vehicle_can_upload_evidence_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((
    select public.ops_vehicle_can_submit_inspection(p.contract_id, p.up3_id, p.ulp_id)
    from public.ops_tool_evidence_parts(p_name) p
    limit 1
  ), false)
$function$;

drop policy if exists ops_vehicle_inspection_select on storage.objects;
drop policy if exists ops_vehicle_inspection_insert on storage.objects;
create policy ops_vehicle_inspection_select
  on storage.objects for select to authenticated
  using (bucket_id = 'ops-vehicle-inspections' and public.ops_vehicle_can_read_evidence_object(name));
create policy ops_vehicle_inspection_insert
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ops-vehicle-inspections' and public.ops_vehicle_can_upload_evidence_object(name));

-- Validasi foto per slot: tepat 4 kunci wajib, path milik ULP + kendaraan ini,
-- nama berkas memulai kunci slot, ada di penyimpanan, dan ukurannya <= 500 KB.
create or replace function public.ops_validate_vehicle_photo_paths(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid, p_vehicle_id uuid, p_paths jsonb
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_keys constant text[] := array['SIDE_RIGHT', 'SIDE_LEFT', 'FRONT', 'REAR'];
  v_key text;
  v_path text;
  v_prefix text;
  v_size text;
begin
  if not public.ops_vehicle_inspection_photos_object_valid(p_paths) then
    raise exception 'Foto inspeksi wajib 4: samping kanan, samping kiri, tampak depan, tampak belakang';
  end if;
  v_prefix := p_contract_id::text || '/' || p_up3_id::text || '/' || p_ulp_id::text || '/' || p_vehicle_id::text || '/';
  foreach v_key in array v_keys loop
    v_path := btrim(p_paths ->> v_key);
    if v_path is null or v_path = '' or v_path like '%..%' or v_path not like v_prefix || v_key || '-%' then
      raise exception 'Slot foto % harus satu foto milik ULP dan kendaraan ini', v_key;
    end if;
    select (o.metadata ->> 'size') into v_size
    from storage.objects o
    where o.bucket_id = 'ops-vehicle-inspections' and o.name = v_path;
    if not found then
      raise exception 'Foto % tidak ditemukan di penyimpanan', v_key;
    end if;
    if v_size is null or (v_size)::bigint > 512000 then
      raise exception 'Foto % melebihi batas 500 KB setelah kompresi', v_key;
    end if;
  end loop;
end;
$$;

-- Simpan satu inspeksi kendaraan. Riwayat append-only; rekap Baik/Rusak
-- bulanan tidak tersentuh.
create or replace function public.ops_submit_vehicle_inspection(
  p_slot_id uuid,
  p_inspected_at timestamptz,
  p_condition text,
  p_note text,
  p_photo_paths jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  s public.ops_prescribed_vehicles;
  v_inspection public.ops_vehicle_inspections;
  v_condition text := upper(btrim(coalesce(p_condition, '')));
  v_note text := btrim(coalesce(p_note, ''));
  v_month date;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_inspected_at is null then raise exception 'Tanggal dan waktu inspeksi wajib diisi'; end if;
  if p_inspected_at > now() then raise exception 'Waktu inspeksi tidak boleh melewati waktu sekarang'; end if;
  if v_condition not in ('GOOD', 'DAMAGED') then raise exception 'Kondisi kendaraan harus Baik atau Rusak'; end if;
  if length(v_note) > 2000 then raise exception 'Catatan inspeksi maksimal 2000 karakter'; end if;

  select * into s from public.ops_prescribed_vehicles where id = p_slot_id for update;
  if not found then raise exception 'Kendaraan tidak ditemukan'; end if;
  if not public.ops_vehicle_can_submit_inspection(s.contract_id, s.up3_id, s.ulp_id) then
    raise exception 'Hanya petugas inspeksi pada ULP ini yang dapat menginspeksi kendaraan' using errcode = '42501';
  end if;

  v_month := date_trunc('month', (p_inspected_at at time zone 'Asia/Pontianak'))::date;
  if not (s.effective_month <= v_month and (s.end_month is null or v_month < s.end_month)) then
    raise exception 'Kendaraan ini tidak aktif pada periode inspeksi; gunakan kendaraan penugasan yang sedang berjalan';
  end if;

  perform public.ops_validate_vehicle_photo_paths(s.contract_id, s.up3_id, s.ulp_id, s.id, p_photo_paths);

  insert into public.ops_vehicle_inspections (
    slot_id, contract_id, up3_id, ulp_id, period_month, inspected_at,
    condition, note, photo_paths, inspected_by
  ) values (
    s.id, s.contract_id, s.up3_id, s.ulp_id, v_month, p_inspected_at,
    v_condition, v_note, p_photo_paths, auth.uid()
  ) returning * into v_inspection;

  return jsonb_build_object(
    'inspection', to_jsonb(v_inspection) - 'created_at',
    'inspected_by_name', (select p.display_name from public.profiles p where p.id = auth.uid())
  );
end;
$$;

-- Keterangan inspeksi terakhir tiap kendaraan dalam ULP (termasuk
-- "belum diinspeksi" yang dilayani UI saat id tidak ada di hasil).
create or replace function public.ops_get_vehicle_last_inspections(
  p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_result jsonb;
begin
  if p_ulp_id is null then raise exception 'ULP is required'; end if;
  if not public.ops_vehicle_can_read_inspections(p_contract_id, p_up3_id, p_ulp_id) then
    raise exception 'Tidak berwenang melihat inspeksi kendaraan pada ULP ini' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'slot_id', v.slot_id,
    'period_month', v.period_month,
    'inspected_at', v.inspected_at,
    'condition', v.condition,
    'note', v.note,
    'photo_paths', v.photo_paths,
    'inspected_by', v.inspected_by,
    'inspected_by_name', p.display_name
  ) order by v.slot_id), '[]'::jsonb)
  into v_result
  from (
    select distinct on (slot_id) slot_id, contract_id, up3_id, ulp_id, period_month,
      inspected_at, "condition", note, photo_paths, inspected_by, created_at
    from public.ops_vehicle_inspections
    where contract_id = p_contract_id and up3_id = p_up3_id and ulp_id = p_ulp_id
    order by slot_id, inspected_at desc, created_at desc
  ) v
  left join public.profiles p on p.id = v.inspected_by;
  return v_result;
end;
$$;

-- RPC/gate helper hanya untuk user masuk; anon tidak boleh memanggil langsung,
-- mengikuti proteksi RPC inspeksi alat. Cabut juga grant default PUBLIC
-- (mas-if-nya `from anon` saja tidak cukup) lalu beri grant eksplisit.
revoke execute on function public.ops_vehicle_can_read_inspections(uuid, uuid, uuid) from public, anon;
revoke execute on function public.ops_vehicle_can_submit_inspection(uuid, uuid, uuid) from public, anon;
revoke execute on function public.ops_vehicle_can_read_evidence_object(text) from public, anon;
revoke execute on function public.ops_vehicle_can_upload_evidence_object(text) from public, anon;
revoke execute on function public.ops_validate_vehicle_photo_paths(uuid, uuid, uuid, uuid, jsonb) from public, anon;
revoke execute on function public.ops_submit_vehicle_inspection(uuid, timestamptz, text, text, jsonb) from public, anon;
revoke execute on function public.ops_get_vehicle_last_inspections(uuid, uuid, uuid) from public, anon;

grant execute on function public.ops_vehicle_can_read_inspections(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.ops_vehicle_can_submit_inspection(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.ops_vehicle_can_read_evidence_object(text) to authenticated, service_role;
grant execute on function public.ops_vehicle_can_upload_evidence_object(text) to authenticated, service_role;
grant execute on function public.ops_validate_vehicle_photo_paths(uuid, uuid, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.ops_submit_vehicle_inspection(uuid, timestamptz, text, text, jsonb) to authenticated, service_role;
grant execute on function public.ops_get_vehicle_last_inspections(uuid, uuid, uuid) to authenticated, service_role;
