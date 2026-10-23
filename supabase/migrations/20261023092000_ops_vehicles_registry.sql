-- TAHAP 2 (B): Registrasi Kendaraan ULP & penetapan template kebutuhan.
-- Identitas kendaraan memakai UUID internal; nopol unik global lewat normalisasi
-- server. Akses baca: Super Admin, Admin UP3 pada UP3-nya, Admin ULP pada ULP-nya.
-- Tulis hanya lewat RPC; riwayat append-only dan hanya terbaca lewat RPC.
-- Tanpa hapus permanen: nonaktif wajib alasan, acuan memakai versi terbitan.

create or replace function public.ops_business_today()
returns date
language sql
stable
as $function$
  select (now() at time zone 'Asia/Pontianak')::date
$function$;

create table if not exists public.ops_vehicles (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  up3_id uuid not null references public.organization_units(id) on delete restrict,
  ulp_id uuid not null references public.organization_units(id) on delete restrict,
  plate_display text not null,
  plate_normalized text not null,
  brand text not null,
  notes text,
  status text not null default 'Aktif' check (status in ('Aktif', 'Tidak Aktif')),
  inactive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  revision integer not null default 1,
  constraint uq_ops_vehicles_plate unique (plate_normalized),
  constraint ck_ops_vehicles_inactive_reason check (
    (status = 'Aktif' and inactive_reason is null)
    or (status = 'Tidak Aktif' and btrim(coalesce(inactive_reason, '')) <> '')
  )
);

create index if not exists ix_ops_vehicles_scope on public.ops_vehicles (contract_id, up3_id, ulp_id);
create index if not exists ix_ops_vehicles_status on public.ops_vehicles (contract_id, up3_id, status);

create table if not exists public.ops_vehicle_template_assignments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.ops_vehicles(id) on delete cascade,
  template_id uuid not null references public.ops_equipment_templates(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  up3_id uuid not null references public.organization_units(id) on delete restrict,
  ulp_id uuid not null references public.organization_units(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint ck_ops_vta_interval check (effective_to is null or effective_from < effective_to)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ex_ops_vta_no_overlap') then
    alter table public.ops_vehicle_template_assignments
      add constraint ex_ops_vta_no_overlap
      exclude using gist (
        vehicle_id with =,
        daterange(effective_from, effective_to, '[)') with &&
      );
  end if;
end;
$$;

create index if not exists ix_ops_vta_vehicle on public.ops_vehicle_template_assignments (vehicle_id, effective_from desc);
create index if not exists ix_ops_vta_template on public.ops_vehicle_template_assignments (template_id);
create index if not exists ix_ops_vta_open on public.ops_vehicle_template_assignments (vehicle_id) where effective_to is null;

create table if not exists public.ops_vehicle_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.ops_vehicles(id) on delete cascade,
  contract_id uuid not null,
  up3_id uuid not null,
  ulp_id uuid,
  action text not null check (action in ('CREATED', 'UPDATED', 'ASSIGNED', 'STATUS_CHANGED', 'CORRECTED_ULP')),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  actor_role text,
  created_at timestamptz not null default now()
);

create index if not exists ix_ops_vehicle_history_vehicle on public.ops_vehicle_history (vehicle_id, created_at desc);

-- Validasi scope kendaraan + konsistensi normalisasi nopol di server.
create or replace function public.validate_ops_vehicle_scope()
returns trigger
language plpgsql
as $function$
declare
  v_type text;
  v_parent uuid;
begin
  select type, parent_id into v_type, v_parent
  from public.organization_units where id = new.ulp_id;
  if v_type is distinct from 'ULP' then
    raise exception 'Unit kendaraan harus bertipe ULP';
  end if;
  if v_parent is distinct from new.up3_id then
    raise exception 'ULP kendaraan tidak berada pada UP3 yang benar';
  end if;
  if not exists (
    select 1 from public.contract_up3_scopes s
    where s.contract_id = new.contract_id and s.up3_id = new.up3_id and s.status = 'Aktif'
  ) then
    raise exception 'UP3 tidak berada pada kontrak yang dipilih';
  end if;
  if new.plate_normalized <> regexp_replace(upper(regexp_replace(btrim(new.plate_display), '\s+', ' ', 'g')), '[^A-Z0-9]+', '', 'g') then
    raise exception 'Normalisasi nomor polisi tidak konsisten';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_ops_vehicles_scope on public.ops_vehicles;
create trigger trg_ops_vehicles_scope
  before insert or update on public.ops_vehicles
  for each row execute function public.validate_ops_vehicle_scope();

drop trigger if exists trg_ops_vehicles_touch on public.ops_vehicles;
create trigger trg_ops_vehicles_touch
  before update on public.ops_vehicles
  for each row execute function public.touch_audit_columns();

-- Predikat akses. Security definer agar dipakai konsisten oleh policy & RPC.
create or replace function public.ops_vehicle_scope_ok(p_contract_id uuid, p_up3_id uuid)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
        and cm.contract_role in ('ADMIN_UP3', 'ADMIN_ULP')
    )
  )
$function$;

create or replace function public.ops_vehicle_can_access(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
        and (
          cm.contract_role = 'ADMIN_UP3'
          or (cm.contract_role = 'ADMIN_ULP' and cm.operational_unit_id = p_ulp_id)
        )
    )
  )
$function$;

create or replace function public.ops_vehicle_can_manage(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid)
returns boolean
language sql
stable security definer
set search_path to public, pg_temp
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.contract_role = 'ADMIN_ULP' and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
        and cm.operational_unit_id = p_ulp_id
    )
  )
$function$;

create or replace function public.ops_vehicle_actor_role(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid)
returns text
language sql
stable security definer
set search_path to public, pg_temp
as $function$
  select case
    when public.auth_is_super_admin() then 'SUPER_ADMIN'
    when exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.contract_role = 'ADMIN_ULP' and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
        and cm.operational_unit_id = p_ulp_id
    ) then 'ADMIN_ULP'
    when exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.contract_role = 'ADMIN_UP3' and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
    ) then 'ADMIN_UP3'
    else 'USER'
  end
$function$;

-- Daftar kendaraan + total untuk pagination server-side.
create or replace function public.ops_list_vehicles(
  p_contract_id uuid,
  p_up3_id uuid,
  p_ulp_id uuid default null,
  p_search text default null,
  p_status text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to public, pg_temp
as $function$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := btrim(coalesce(p_search, ''));
  v_search_norm text := regexp_replace(upper(btrim(coalesce(p_search, ''))), '[^A-Z0-9]+', '', 'g');
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_is_sa boolean := public.auth_is_super_admin();
  v_is_up3 boolean;
  v_ulp uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_status is not null and v_status not in ('Aktif', 'Tidak Aktif') then
    raise exception 'Status filter tidak dikenal';
  end if;

  v_is_up3 := exists (
    select 1 from public.contract_memberships cm
    where cm.user_id = auth.uid() and cm.contract_role = 'ADMIN_UP3' and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
      and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
  );
  select cm.operational_unit_id into v_ulp
  from public.contract_memberships cm
  where cm.user_id = auth.uid() and cm.contract_role = 'ADMIN_ULP' and cm.status = 'ACTIVE'
    and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)
    and cm.contract_id = p_contract_id and cm.operational_up3_id = p_up3_id
  limit 1;

  if not (v_is_sa or v_is_up3 or v_ulp is not null) then
    raise exception 'Akun tidak memiliki akses kendaraan pada scope ini' using errcode = '42501';
  end if;
  if p_ulp_id is not null and not (v_is_sa or v_is_up3 or p_ulp_id = v_ulp) then
    raise exception 'ULP di luar akses akun' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', coalesce(max(total_count), 0),
    'rows', coalesce(jsonb_agg(row_json order by sort_plate), '[]'::jsonb)
  ) into v_result
  from (
    select
      count(*) over() as total_count,
      jsonb_build_object(
        'id', v.id,
        'contract_id', v.contract_id,
        'up3_id', v.up3_id,
        'ulp_id', v.ulp_id,
        'ulp_key', u.legacy_key,
        'plate_display', v.plate_display,
        'plate_normalized', v.plate_normalized,
        'brand', v.brand,
        'notes', v.notes,
        'status', v.status,
        'inactive_reason', v.inactive_reason,
        'revision', v.revision,
        'created_at', v.created_at,
        'updated_at', v.updated_at,
        'assignment_id', ca.id,
        'template_id', ca.template_id,
        'template_code', ca.template_code,
        'template_name', ca.template_name,
        'vehicle_type_name', coalesce(ca.vehicle_type_name, vt.name),
        'assignment_name', coalesce(ca.assignment_name, va.name),
        'vehicle_variant', ca.vehicle_variant,
        'template_legacy', case when ca.id is null then null else ca.published_at is null end,
        'effective_from', ca.effective_from
      ) as row_json,
      v.plate_display as sort_plate
    from public.ops_vehicles v
    join public.organization_units u on u.id = v.ulp_id
    left join lateral (
      select a.id, a.template_id, a.effective_from,
             t.template_code, t.template_name, t.vehicle_type_name, t.assignment_name,
             t.vehicle_variant, t.published_at, t.vehicle_type_id, t.assignment_id
      from public.ops_vehicle_template_assignments a
      join public.ops_equipment_templates t on t.id = a.template_id
      where a.vehicle_id = v.id and a.effective_to is null
      order by a.effective_from desc, a.created_at desc
      limit 1
    ) ca on true
    left join public.ops_vehicle_types vt on vt.id = ca.vehicle_type_id
    left join public.ops_vehicle_assignments va on va.id = ca.assignment_id
    where v.contract_id = p_contract_id and v.up3_id = p_up3_id
      and (p_ulp_id is null or v.ulp_id = p_ulp_id)
      and (v_is_sa or v_is_up3 or v.ulp_id = v_ulp)
      and (v_status is null or v.status = v_status)
      and (
        v_search = ''
        or v.plate_display ilike '%' || v_search || '%'
        or v.brand ilike '%' || v_search || '%'
        or (v_search_norm <> '' and v.plate_normalized like '%' || v_search_norm || '%')
      )
    order by v.plate_display
    limit v_limit offset v_offset
  ) rows;

  return coalesce(v_result, jsonb_build_object('total', 0, 'rows', '[]'::jsonb));
end;
$function$;

create or replace function public.ops_get_vehicle(p_vehicle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to public, pg_temp
as $function$
declare
  v public.ops_vehicles%rowtype;
  v_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v from public.ops_vehicles where id = p_vehicle_id;
  if not found then raise exception 'Kendaraan tidak ditemukan'; end if;
  if not public.ops_vehicle_can_access(v.contract_id, v.up3_id, v.ulp_id) then
    raise exception 'Akun tidak memiliki akses kendaraan ini' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', v.id,
    'contract_id', v.contract_id,
    'up3_id', v.up3_id,
    'ulp_id', v.ulp_id,
    'ulp_key', (select u.legacy_key from public.organization_units u where u.id = v.ulp_id),
    'plate_display', v.plate_display,
    'plate_normalized', v.plate_normalized,
    'brand', v.brand,
    'notes', v.notes,
    'status', v.status,
    'inactive_reason', v.inactive_reason,
    'revision', v.revision,
    'created_at', v.created_at,
    'updated_at', v.updated_at,
    'assignment', (
      select jsonb_build_object(
        'id', a.id,
        'template_id', a.template_id,
        'template_code', t.template_code,
        'template_name', t.template_name,
        'vehicle_type_id', t.vehicle_type_id,
        'vehicle_type_name', coalesce(t.vehicle_type_name, vt.name),
        'assignment_id', t.assignment_id,
        'assignment_name', coalesce(t.assignment_name, va.name),
        'vehicle_variant', t.vehicle_variant,
        'template_legacy', t.published_at is null,
        'effective_from', a.effective_from,
        'items_count', (select count(*) from public.ops_equipment_template_items ti where ti.template_id = t.id)
      )
      from public.ops_vehicle_template_assignments a
      join public.ops_equipment_templates t on t.id = a.template_id
      left join public.ops_vehicle_types vt on vt.id = t.vehicle_type_id
      left join public.ops_vehicle_assignments va on va.id = t.assignment_id
      where a.vehicle_id = v.id and a.effective_to is null
      order by a.effective_from desc, a.created_at desc
      limit 1
    )
  ) into v_row;
  return v_row;
end;
$function$;

-- Kandidat acuan: kendaraan baru bebas memilih template Aktif pada scope;
-- kendaraan yang sudah punya acuan hanya boleh pindah pada jenis+penugasan sama.
create or replace function public.ops_list_vehicle_template_candidates(
  p_vehicle_id uuid default null,
  p_contract_id uuid default null,
  p_up3_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to public, pg_temp
as $function$
declare
  v public.ops_vehicles%rowtype;
  v_contract uuid;
  v_up3 uuid;
  v_type uuid;
  v_assignment uuid;
  v_has_header boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  if p_vehicle_id is not null then
    select * into v from public.ops_vehicles where id = p_vehicle_id;
    if not found then raise exception 'Kendaraan tidak ditemukan'; end if;
    if not public.ops_vehicle_can_access(v.contract_id, v.up3_id, v.ulp_id) then
      raise exception 'Akun tidak memiliki akses kendaraan ini' using errcode = '42501';
    end if;
    v_contract := v.contract_id;
    v_up3 := v.up3_id;
    select t.vehicle_type_id, t.assignment_id into v_type, v_assignment
    from public.ops_vehicle_template_assignments a
    join public.ops_equipment_templates t on t.id = a.template_id
    where a.vehicle_id = p_vehicle_id and a.effective_to is null
    order by a.effective_from desc, a.created_at desc
    limit 1;
    v_has_header := found;
  else
    if p_contract_id is null or p_up3_id is null then
      raise exception 'Scope kontrak dan UP3 wajib diisi';
    end if;
    if not public.ops_vehicle_scope_ok(p_contract_id, p_up3_id) then
      raise exception 'Akun tidak memiliki akses pada scope ini' using errcode = '42501';
    end if;
    v_contract := p_contract_id;
    v_up3 := p_up3_id;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'template_code', t.template_code,
      'template_name', t.template_name,
      'version_number', t.version_number,
      'vehicle_variant', t.vehicle_variant,
      'vehicle_type_id', t.vehicle_type_id,
      'vehicle_type_name', coalesce(t.vehicle_type_name, vt.name),
      'assignment_id', t.assignment_id,
      'assignment_name', coalesce(t.assignment_name, va.name),
      'template_legacy', t.published_at is null,
      'effective_from', t.effective_from,
      'items_count', (select count(*) from public.ops_equipment_template_items ti where ti.template_id = t.id)
    ) order by coalesce(t.vehicle_type_name, vt.name), coalesce(t.assignment_name, va.name),
               t.vehicle_variant, t.version_number desc)
    from public.ops_equipment_templates t
    join public.ops_vehicle_types vt on vt.id = t.vehicle_type_id
    join public.ops_vehicle_assignments va on va.id = t.assignment_id
    where t.contract_id = v_contract and t.up3_id = v_up3 and t.status = 'Aktif'
      and (not v_has_header or (t.vehicle_type_id = v_type and t.assignment_id = v_assignment))
  ), '[]'::jsonb);
end;
$function$;

-- Rincian alat acuan: snapshot terbitan bila ada; fallback katalog + penanda legacy.
create or replace function public.ops_list_template_items_for_vehicle(p_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to public, pg_temp
as $function$
declare
  v_tpl public.ops_equipment_templates%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_tpl from public.ops_equipment_templates where id = p_template_id;
  if not found then raise exception 'Template tidak ditemukan'; end if;
  if not public.ops_can_read_master(v_tpl.contract_id, v_tpl.up3_id) then
    raise exception 'Akun tidak memiliki akses template ini' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'equipment_id', ti.equipment_id,
      'equipment_code', coalesce(ti.equipment_code, i.code),
      'equipment_name', coalesce(ti.equipment_name, i.name),
      'equipment_unit', coalesce(ti.equipment_unit, i.unit),
      'category_name', coalesce(ti.equipment_category_name, c.name),
      'required_qty', ti.required_qty,
      'note', ti.note,
      'sort_order', ti.sort_order,
      'legacy_metadata', ti.equipment_name is null,
      'is_active', coalesce(i.is_active, true)
    ) order by ti.sort_order, coalesce(ti.equipment_name, i.name))
    from public.ops_equipment_template_items ti
    left join public.ops_equipment_items i on i.id = ti.equipment_id
    left join public.ops_equipment_categories c on c.id = i.category_id
    where ti.template_id = p_template_id
  ), '[]'::jsonb);
end;
$function$;

-- Simpan kendaraan (registrasi/identitas/acuan) secara atomik.
create or replace function public.ops_save_vehicle(
  p_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_ulp_id uuid,
  p_expected_revision integer,
  p_plate text,
  p_brand text,
  p_notes text,
  p_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_plate_display text := regexp_replace(btrim(coalesce(p_plate, '')), '\s+', ' ', 'g');
  v_plate_norm text;
  v_brand text := btrim(coalesce(p_brand, ''));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_tpl public.ops_equipment_templates%rowtype;
  v_vehicle public.ops_vehicles%rowtype;
  v_today date := public.ops_business_today();
  v_open public.ops_vehicle_template_assignments%rowtype;
  v_cur_tpl public.ops_equipment_templates%rowtype;
  v_has_open boolean := false;
  v_new_id uuid;
  v_actor_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  v_plate_norm := regexp_replace(upper(v_plate_display), '[^A-Z0-9]+', '', 'g');
  if v_plate_display = '' then raise exception 'Nomor polisi wajib diisi'; end if;
  if char_length(v_plate_norm) < 2 or char_length(v_plate_norm) > 12 then
    raise exception 'Nomor polisi tidak valid';
  end if;
  if v_brand = '' then raise exception 'Tipe/Merek kendaraan wajib diisi'; end if;
  if p_template_id is null then raise exception 'Acuan template wajib dipilih'; end if;

  select * into v_tpl from public.ops_equipment_templates where id = p_template_id;
  if not found then raise exception 'Template acuan tidak ditemukan'; end if;

  if p_id is null then
    if not public.ops_vehicle_can_manage(p_contract_id, p_up3_id, p_ulp_id) then
      raise exception 'Hanya Admin ULP pada unit ini yang dapat mendaftarkan kendaraan' using errcode = '42501';
    end if;
    if v_tpl.status <> 'Aktif' or v_tpl.contract_id <> p_contract_id or v_tpl.up3_id <> p_up3_id then
      raise exception 'Template acuan tidak aktif pada scope ini';
    end if;
    if not exists (
      select 1 from public.organization_units
      where id = p_ulp_id and type = 'ULP' and parent_id = p_up3_id
    ) then
      raise exception 'ULP kendaraan tidak valid';
    end if;

    begin
      insert into public.ops_vehicles(
        contract_id, up3_id, ulp_id, plate_display, plate_normalized,
        brand, notes, status, created_by, updated_by
      )
      values (
        p_contract_id, p_up3_id, p_ulp_id, v_plate_display, v_plate_norm,
        v_brand, v_notes, 'Aktif', auth.uid(), auth.uid()
      )
      returning id into v_new_id;
    exception when unique_violation then
      raise exception 'Nomor polisi sudah terdaftar';
    end;

    insert into public.ops_vehicle_template_assignments(
      vehicle_id, template_id, contract_id, up3_id, ulp_id, effective_from, created_by
    )
    values (v_new_id, p_template_id, p_contract_id, p_up3_id, p_ulp_id, v_today, auth.uid());

    v_actor_role := public.ops_vehicle_actor_role(p_contract_id, p_up3_id, p_ulp_id);
    insert into public.ops_vehicle_history(vehicle_id, contract_id, up3_id, ulp_id, action, detail, actor_id, actor_role)
    values (
      v_new_id, p_contract_id, p_up3_id, p_ulp_id, 'CREATED',
      jsonb_build_object(
        'plate', v_plate_display,
        'brand', v_brand,
        'template_id', p_template_id,
        'template_code', v_tpl.template_code,
        'effective_from', v_today
      ),
      auth.uid(), v_actor_role
    );

    return public.ops_get_vehicle(v_new_id);
  end if;

  select * into v_vehicle from public.ops_vehicles where id = p_id for update;
  if not found then raise exception 'Kendaraan tidak ditemukan'; end if;
  if v_vehicle.contract_id <> p_contract_id or v_vehicle.up3_id <> p_up3_id then
    raise exception 'Scope kendaraan tidak sesuai';
  end if;
  if not public.ops_vehicle_can_manage(v_vehicle.contract_id, v_vehicle.up3_id, v_vehicle.ulp_id) then
    raise exception 'Hanya Admin ULP pada unit ini yang dapat mengubah kendaraan' using errcode = '42501';
  end if;
  if v_vehicle.status <> 'Aktif' then
    raise exception 'Kendaraan tidak aktif tidak dapat diubah';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_vehicle.revision then
    raise exception 'Data kendaraan sudah berubah. Muat ulang lalu coba lagi.';
  end if;
  if v_tpl.status <> 'Aktif'
     or v_tpl.contract_id <> v_vehicle.contract_id
     or v_tpl.up3_id <> v_vehicle.up3_id then
    raise exception 'Template acuan tidak aktif pada scope ini';
  end if;

  v_actor_role := public.ops_vehicle_actor_role(v_vehicle.contract_id, v_vehicle.up3_id, v_vehicle.ulp_id);

  select * into v_open
  from public.ops_vehicle_template_assignments
  where vehicle_id = p_id and effective_to is null
  order by effective_from desc, created_at desc
  limit 1;
  v_has_open := found;
  if v_has_open then
    select * into v_cur_tpl
    from public.ops_equipment_templates where id = v_open.template_id;
  end if;

  if v_plate_display is distinct from v_vehicle.plate_display
     or v_plate_norm is distinct from v_vehicle.plate_normalized
     or v_brand is distinct from v_vehicle.brand
     or v_notes is distinct from v_vehicle.notes then
    begin
      update public.ops_vehicles
      set plate_display = v_plate_display,
          plate_normalized = v_plate_norm,
          brand = v_brand,
          notes = v_notes,
          updated_by = auth.uid()
      where id = p_id;
    exception when unique_violation then
      raise exception 'Nomor polisi sudah terdaftar';
    end;

    insert into public.ops_vehicle_history(vehicle_id, contract_id, up3_id, ulp_id, action, detail, actor_id, actor_role)
    values (
      p_id, v_vehicle.contract_id, v_vehicle.up3_id, v_vehicle.ulp_id, 'UPDATED',
      jsonb_build_object(
        'plate_display', jsonb_build_object('from', v_vehicle.plate_display, 'to', v_plate_display),
        'brand', jsonb_build_object('from', v_vehicle.brand, 'to', v_brand)
      ),
      auth.uid(), v_actor_role
    );
  end if;

  if not v_has_open or v_open.template_id is distinct from p_template_id then
    if v_has_open and (
      v_tpl.vehicle_type_id is distinct from v_cur_tpl.vehicle_type_id
      or v_tpl.assignment_id is distinct from v_cur_tpl.assignment_id
    ) then
      raise exception 'Acuan baru harus memiliki jenis kendaraan dan penugasan yang sama dengan acuan saat ini';
    end if;

    if v_has_open and v_open.effective_from >= v_today then
      update public.ops_vehicle_template_assignments
      set template_id = p_template_id,
          ulp_id = v_vehicle.ulp_id
      where id = v_open.id;

      insert into public.ops_vehicle_history(vehicle_id, contract_id, up3_id, ulp_id, action, detail, actor_id, actor_role)
      values (
        p_id, v_vehicle.contract_id, v_vehicle.up3_id, v_vehicle.ulp_id, 'ASSIGNED',
        jsonb_build_object(
          'mode', 'KOREKSI_HARI_SAMA',
          'from_template_id', v_open.template_id,
          'to_template_id', p_template_id,
          'effective_from', v_open.effective_from
        ),
        auth.uid(), v_actor_role
      );
    else
      if v_has_open then
        update public.ops_vehicle_template_assignments
        set effective_to = v_today
        where id = v_open.id;
      end if;

      insert into public.ops_vehicle_template_assignments(
        vehicle_id, template_id, contract_id, up3_id, ulp_id, effective_from, created_by
      )
      values (p_id, p_template_id, v_vehicle.contract_id, v_vehicle.up3_id, v_vehicle.ulp_id, v_today, auth.uid());

      insert into public.ops_vehicle_history(vehicle_id, contract_id, up3_id, ulp_id, action, detail, actor_id, actor_role)
      values (
        p_id, v_vehicle.contract_id, v_vehicle.up3_id, v_vehicle.ulp_id, 'ASSIGNED',
        jsonb_build_object(
          'mode', case when v_has_open then 'GANTI' else 'TETAPKAN' end,
          'from_template_id', case when v_has_open then v_open.template_id else null end,
          'to_template_id', p_template_id,
          'effective_from', v_today
        ),
        auth.uid(), v_actor_role
      );
    end if;
  end if;

  return public.ops_get_vehicle(p_id);
end;
$function$;

-- Ubah status kendaraan; nonaktif menutup acuan berjalan, aktif kembali
-- memakai template Aktif terbaru pada jenis+penugasan yang sama.
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

-- Koreksi ULP kendaraan (salah unit saat registrasi). Wajib alasan + audit.
create or replace function public.ops_correct_vehicle_ulp(
  p_vehicle_id uuid,
  p_new_ulp_id uuid,
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
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_type text;
  v_parent uuid;
  v_actor_role text;
  v_ulp_key text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_new_ulp_id is null then raise exception 'ULP tujuan wajib dipilih'; end if;
  if v_reason is null then raise exception 'Alasan koreksi ULP wajib diisi'; end if;

  select * into v from public.ops_vehicles where id = p_vehicle_id for update;
  if not found then raise exception 'Kendaraan tidak ditemukan'; end if;
  if not public.ops_vehicle_can_manage(v.contract_id, v.up3_id, v.ulp_id) then
    raise exception 'Hanya Admin ULP asal atau Super Admin yang dapat mengoreksi ULP' using errcode = '42501';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v.revision then
    raise exception 'Data kendaraan sudah berubah. Muat ulang lalu coba lagi.';
  end if;
  if p_new_ulp_id = v.ulp_id then raise exception 'ULP kendaraan sudah sama'; end if;

  select type, parent_id into v_type, v_parent
  from public.organization_units where id = p_new_ulp_id;
  if v_type is distinct from 'ULP' or v_parent is distinct from v.up3_id then
    raise exception 'ULP tujuan tidak valid pada UP3 ini';
  end if;

  v_actor_role := public.ops_vehicle_actor_role(v.contract_id, v.up3_id, v.ulp_id);

  update public.ops_vehicles
  set ulp_id = p_new_ulp_id, updated_by = auth.uid()
  where id = v.id;

  update public.ops_vehicle_template_assignments
  set ulp_id = p_new_ulp_id
  where vehicle_id = v.id and effective_to is null;

  select legacy_key into v_ulp_key from public.organization_units where id = v.ulp_id;

  insert into public.ops_vehicle_history(vehicle_id, contract_id, up3_id, ulp_id, action, detail, actor_id, actor_role)
  values (
    v.id, v.contract_id, v.up3_id, p_new_ulp_id, 'CORRECTED_ULP',
    jsonb_build_object(
      'from_ulp_id', v.ulp_id,
      'from_ulp_key', v_ulp_key,
      'to_ulp_id', p_new_ulp_id,
      'reason', v_reason
    ),
    auth.uid(), v_actor_role
  );

  return jsonb_build_object(
    'id', v.id,
    'ulp_id', p_new_ulp_id,
    'revision', v.revision + 1
  );
end;
$function$;

create or replace function public.ops_list_vehicle_history(
  p_vehicle_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to public, pg_temp
as $function$
declare
  v public.ops_vehicles%rowtype;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v from public.ops_vehicles where id = p_vehicle_id;
  if not found then raise exception 'Kendaraan tidak ditemukan'; end if;
  if not public.ops_vehicle_can_access(v.contract_id, v.up3_id, v.ulp_id) then
    raise exception 'Akun tidak memiliki akses kendaraan ini' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', h.id,
      'action', h.action,
      'detail', h.detail,
      'actor_id', h.actor_id,
      'actor_role', h.actor_role,
      'created_at', h.created_at
    ) order by h.created_at desc)
    from (
      select *
      from public.ops_vehicle_history
      where vehicle_id = p_vehicle_id
      order by created_at desc
      limit v_limit offset v_offset
    ) h
  ), '[]'::jsonb);
end;
$function$;

alter table public.ops_vehicles enable row level security;
alter table public.ops_vehicle_template_assignments enable row level security;
alter table public.ops_vehicle_history enable row level security;

drop policy if exists ops_vehicle_select on public.ops_vehicles;
create policy ops_vehicle_select on public.ops_vehicles for select to authenticated
  using (public.ops_vehicle_can_access(contract_id, up3_id, ulp_id));

drop policy if exists ops_vehicle_assignment_select on public.ops_vehicle_template_assignments;
create policy ops_vehicle_assignment_select on public.ops_vehicle_template_assignments for select to authenticated
  using (public.ops_vehicle_can_access(contract_id, up3_id, ulp_id));

-- Riwayat sengaja tanpa policy SELECT: hanya RPC security definer.

revoke all on public.ops_vehicles from anon, authenticated;
grant select on public.ops_vehicles to authenticated;
revoke all on public.ops_vehicle_template_assignments from anon, authenticated;
grant select on public.ops_vehicle_template_assignments to authenticated;
revoke all on public.ops_vehicle_history from anon, authenticated;

revoke all on function public.ops_business_today() from public, anon;
revoke all on function public.ops_vehicle_scope_ok(uuid, uuid) from public, anon;
revoke all on function public.ops_vehicle_can_access(uuid, uuid, uuid) from public, anon;
revoke all on function public.ops_vehicle_can_manage(uuid, uuid, uuid) from public, anon;
revoke all on function public.ops_vehicle_actor_role(uuid, uuid, uuid) from public, anon;
revoke all on function public.ops_list_vehicles(uuid, uuid, uuid, text, text, integer, integer) from public, anon;
revoke all on function public.ops_get_vehicle(uuid) from public, anon;
revoke all on function public.ops_list_vehicle_template_candidates(uuid, uuid, uuid) from public, anon;
revoke all on function public.ops_list_template_items_for_vehicle(uuid) from public, anon;
revoke all on function public.ops_save_vehicle(uuid, uuid, uuid, uuid, integer, text, text, text, uuid) from public, anon;
revoke all on function public.ops_set_vehicle_status(uuid, text, text, integer) from public, anon;
revoke all on function public.ops_correct_vehicle_ulp(uuid, uuid, text, integer) from public, anon;
revoke all on function public.ops_list_vehicle_history(uuid, integer, integer) from public, anon;

grant execute on function public.ops_vehicle_can_access(uuid, uuid, uuid) to authenticated;
grant execute on function public.ops_list_vehicles(uuid, uuid, uuid, text, text, integer, integer) to authenticated;
grant execute on function public.ops_get_vehicle(uuid) to authenticated;
grant execute on function public.ops_list_vehicle_template_candidates(uuid, uuid, uuid) to authenticated;
grant execute on function public.ops_list_template_items_for_vehicle(uuid) to authenticated;
grant execute on function public.ops_save_vehicle(uuid, uuid, uuid, uuid, integer, text, text, text, uuid) to authenticated;
grant execute on function public.ops_set_vehicle_status(uuid, text, text, integer) to authenticated;
grant execute on function public.ops_correct_vehicle_ulp(uuid, uuid, text, integer) to authenticated;
grant execute on function public.ops_list_vehicle_history(uuid, integer, integer) to authenticated;
