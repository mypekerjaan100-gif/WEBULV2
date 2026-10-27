-- Role custom dasar: pembuatan role oleh Super Admin, akses per menu
-- (tidak ada / lihat / lihat & edit), khusus kontrak Pelayanan Teknik dan
-- cakupan ULP. Master & Pengaturan belum dibuka untuk role custom.

alter table public.authorization_roles
  add column if not exists description text not null default '',
  add column if not exists is_custom boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists role_level text,
  add column if not exists menu_access jsonb not null default '{}'::jsonb,
  add column if not exists revision integer not null default 1,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

alter table public.authorization_roles drop constraint if exists authorization_roles_role_level_check;
alter table public.authorization_roles
  add constraint authorization_roles_role_level_check
  check (role_level is null or role_level in ('ULP', 'UP3', 'UL', 'UP'));

alter table public.authorization_audit_events drop constraint if exists authorization_audit_events_event_type_check;
alter table public.authorization_audit_events add constraint authorization_audit_events_event_type_check
check (event_type = any (array[
  'SYSTEM_ROLE_ASSIGNED','SYSTEM_ROLE_REVOKED','OVERRIDE_USED','VIEW_AS_STARTED','VIEW_AS_ENDED',
  'USER_INVITED','USER_ACTIVATED','USER_DISABLED','USER_ENABLED','ROLE_ASSIGNED','ROLE_REVOKED',
  'MEMBERSHIP_ADDED','MEMBERSHIP_REMOVED','SUPER_ADMIN_ASSIGNED','SUPER_ADMIN_REVOKED',
  'ROLE_CREATED','ROLE_UPDATED','ROLE_STATUS_CHANGED'
]));

update public.authorization_roles
set role_level = case
  when code in ('TEAM_LEADER', 'MANAGER_UNIT') then 'UL'
  when code in ('MANAGER_UP', 'ASMAN_OPERASI', 'ASMAN_KEUANGAN') then 'UP'
  else role_level
end,
updated_at = now()
where role_namespace = 'ORGANIZATION'
  and role_level is null;

insert into public.authorization_permissions (code, description)
values
  ('alat.read', 'Read equipment and vehicle condition records'),
  ('alat.manage', 'Edit equipment and vehicle condition records')
on conflict (code) do nothing;

-- Validasi role kontrak: role bawaan atau role custom aktif dengan level ULP.
create or replace function public.validate_contract_membership_role()
returns trigger
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare
  v_custom boolean;
  v_active boolean;
  v_level text;
begin
  if new.contract_role in ('ADMIN_UP3', 'ADMIN_ULP') then
    if new.contract_role = 'ADMIN_UP3' and new.operational_unit_id is not null then
      raise exception 'ADMIN_UP3 must not have operational unit';
    end if;
    if new.contract_role = 'ADMIN_ULP' and new.operational_unit_id is null then
      raise exception 'ADMIN_ULP requires operational unit';
    end if;
    return new;
  end if;

  select is_custom, is_active, role_level
    into v_custom, v_active, v_level
  from public.authorization_roles
  where code = new.contract_role and role_namespace = 'CONTRACT';
  if not found or not v_custom or not v_active or v_level is distinct from 'ULP' then
    raise exception 'Invalid contract role';
  end if;
  if new.operational_unit_id is null then
    raise exception 'Custom ULP role requires operational unit';
  end if;
  if not exists (
    select 1 from public.organization_units u
    where u.id = new.operational_unit_id
      and u.type = 'ULP' and u.parent_id = new.operational_up3_id
      and u.own_status = 'Aktif'
  ) then
    raise exception 'Invalid ULP for role scope';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_contract_membership_role on public.contract_memberships;
create trigger trg_validate_contract_membership_role
  before insert or update of contract_role, operational_up3_id, operational_unit_id
  on public.contract_memberships
  for each row execute function public.validate_contract_membership_role();

alter table public.contract_memberships drop constraint if exists contract_memberships_contract_role_check;
alter table public.contract_memberships drop constraint if exists contract_memberships_role_scope;

-- Pemeriksaan izin role custom pada scope kontrak/UP3/ULP yang sama.
create or replace function public.auth_custom_has_permission(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path to public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.contract_memberships cm
    join public.authorization_roles r
      on r.code = cm.contract_role
     and r.role_namespace = 'CONTRACT'
     and r.is_custom and r.is_active
    join public.authorization_role_permissions rp on rp.role_id = r.id
    join public.authorization_permissions p on p.id = rp.permission_id
    where cm.user_id = auth.uid()
      and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date
      and (cm.effective_to is null or current_date < cm.effective_to)
      and cm.contract_id = p_contract_id
      and cm.operational_up3_id = p_up3_id
      and (p_unit_id is null or cm.operational_unit_id = p_unit_id)
      and p.code = p_permission
      and r.role_level = 'ULP'
  )
$$;

create or replace function public.auth_is_custom_contract_role(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.contract_memberships cm
    join public.authorization_roles r
      on r.code = cm.contract_role
     and r.role_namespace = 'CONTRACT'
     and r.is_custom and r.is_active
    where cm.user_id = auth.uid()
      and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date
      and (cm.effective_to is null or current_date < cm.effective_to)
      and cm.contract_id = p_contract_id
      and cm.operational_up3_id = p_up3_id
      and (p_unit_id is null or cm.operational_unit_id = p_unit_id)
  )
$$;

-- Daftar role custom + pemakaian.
create or replace function public.list_custom_roles()
returns table (
  id uuid,
  code text,
  display_name text,
  description text,
  scope_level text,
  is_active boolean,
  revision integer,
  menu_access jsonb,
  assigned_users bigint
)
language plpgsql
stable
security definer
set search_path to public, pg_temp
as $$
begin
  if not public.auth_is_super_admin() then
    raise exception 'Only SUPER_ADMIN may manage roles' using errcode = '42501';
  end if;
  return query
  select r.id, r.code, r.display_name, r.description, r.role_level,
         r.is_active, r.revision, r.menu_access,
         (select count(*) from public.contract_memberships cm
           where cm.contract_role = r.code and cm.status = 'ACTIVE'
             and cm.effective_from <= current_date
             and (cm.effective_to is null or current_date < cm.effective_to))
  from public.authorization_roles r
  where r.role_namespace = 'CONTRACT' and r.is_custom
  order by r.is_active desc, r.display_name;
end;
$$;

-- Simpan role custom (buat/ubah) beserta izin menu.
create or replace function public.save_custom_role(
  p_role_id uuid,
  p_code text,
  p_display_name text,
  p_description text,
  p_scope_level text,
  p_menu_access jsonb,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_level text := upper(btrim(coalesce(p_scope_level, 'ULP')));
  v_role public.authorization_roles%rowtype;
  v_key text;
  v_value text;
  v_permission text;
  v_before jsonb;
  v_read text;
  v_edit text;
begin
  if not public.auth_is_super_admin() then
    raise exception 'Only SUPER_ADMIN may manage roles' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'Nama role wajib diisi'; end if;
  if v_level <> 'ULP' then raise exception 'Role custom tahap ini hanya mendukung cakupan ULP'; end if;
  if p_menu_access is null or jsonb_typeof(p_menu_access) <> 'object' then
    raise exception 'Menu akses tidak valid';
  end if;
  if v_code not like 'CUSTOM\_%' escape '\' then v_code := 'CUSTOM_' || v_code; end if;
  if v_code !~ '^CUSTOM_[A-Z0-9_]{2,60}$' then raise exception 'Kode role tidak valid'; end if;

  if p_role_id is null then
    if exists (select 1 from public.authorization_roles where code = v_code) then
      raise exception 'Kode role sudah digunakan';
    end if;
    insert into public.authorization_roles (
      role_namespace, code, display_name, description, is_custom, is_active,
      role_level, menu_access, revision, created_by, updated_by, updated_at
    ) values (
      'CONTRACT', v_code, v_name, v_desc, true, true,
      v_level, p_menu_access, 1, auth.uid(), auth.uid(), now()
    ) returning * into v_role;
  else
    select * into v_role from public.authorization_roles
    where id = p_role_id and role_namespace = 'CONTRACT' and is_custom
    for update;
    if not found then raise exception 'Role custom tidak ditemukan'; end if;
    if p_expected_revision is null or v_role.revision <> p_expected_revision then
      raise exception 'Role telah berubah; muat ulang data' using errcode = '40001';
    end if;
    v_before := jsonb_build_object('display_name', v_role.display_name, 'menu_access', v_role.menu_access, 'is_active', v_role.is_active);
    update public.authorization_roles
      set display_name = v_name, description = v_desc, role_level = v_level,
          menu_access = p_menu_access, revision = revision + 1,
          updated_by = auth.uid(), updated_at = now()
      where id = v_role.id
      returning * into v_role;
  end if;

  delete from public.authorization_role_permissions where role_id = v_role.id;
  for v_key, v_value in select key, value from jsonb_each_text(p_menu_access) loop
    if v_key not in ('sla', 'variable_cost', 'lembur', 'alat_kendaraan', 'analisis_finansial') then
      raise exception 'Menu tidak dikenal: %', v_key;
    end if;
    if v_value not in ('none', 'read', 'edit') then
      raise exception 'Tingkat akses tidak valid untuk %', v_key;
    end if;
    if v_key = 'analisis_finansial' and v_value = 'edit' then
      raise exception 'Analisis Finansial hanya mendukung akses lihat';
    end if;
    v_read := case v_key
      when 'sla' then 'sla.read'
      when 'variable_cost' then 'variable_cost.read'
      when 'lembur' then 'overtime.read'
      when 'alat_kendaraan' then 'alat.read'
      when 'analisis_finansial' then 'finance.read'
    end;
    v_edit := case v_key
      when 'sla' then 'sla.manage'
      when 'variable_cost' then 'variable_cost.manage'
      when 'lembur' then 'overtime.manage'
      when 'alat_kendaraan' then 'alat.manage'
      else null
    end;
    if v_value <> 'none' then
      insert into public.authorization_role_permissions (role_id, permission_id)
      select v_role.id, p.id from public.authorization_permissions p where p.code = v_read
      on conflict do nothing;
    end if;
    if v_value = 'edit' then
      insert into public.authorization_role_permissions (role_id, permission_id)
      select v_role.id, p.id from public.authorization_permissions p where p.code = v_edit
      on conflict do nothing;
    end if;
  end loop;

  insert into public.authorization_audit_events (
    event_type, actor_user_id, target_role_id, request_id, before_state, after_state, metadata
  ) values (
    case when p_role_id is null then 'ROLE_CREATED' else 'ROLE_UPDATED' end,
    auth.uid(), v_role.id, gen_random_uuid(),
    v_before,
    jsonb_build_object('display_name', v_role.display_name, 'menu_access', v_role.menu_access, 'is_active', v_role.is_active),
    jsonb_build_object('role_code', v_role.code, 'revision', v_role.revision)
  );

  return jsonb_build_object(
    'id', v_role.id, 'code', v_role.code, 'display_name', v_role.display_name,
    'description', v_role.description, 'scope_level', v_role.role_level,
    'is_active', v_role.is_active, 'revision', v_role.revision,
    'menu_access', v_role.menu_access
  );
end;
$$;

create or replace function public.set_custom_role_active(
  p_role_id uuid,
  p_is_active boolean,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare
  v_role public.authorization_roles%rowtype;
  v_assigned bigint;
begin
  if not public.auth_is_super_admin() then
    raise exception 'Only SUPER_ADMIN may manage roles' using errcode = '42501';
  end if;
  select * into v_role from public.authorization_roles
  where id = p_role_id and role_namespace = 'CONTRACT' and is_custom
  for update;
  if not found then raise exception 'Role custom tidak ditemukan'; end if;
  if p_expected_revision is null or v_role.revision <> p_expected_revision then
    raise exception 'Role telah berubah; muat ulang data' using errcode = '40001';
  end if;
  select count(*) into v_assigned from public.contract_memberships
  where contract_role = v_role.code and status = 'ACTIVE'
    and effective_from <= current_date and (effective_to is null or current_date < effective_to);
  if not p_is_active and v_assigned > 0 then
    raise exception 'Role masih digunakan oleh % akun; pindahkan akun terlebih dahulu', v_assigned;
  end if;
  update public.authorization_roles
    set is_active = p_is_active, revision = revision + 1,
        updated_by = auth.uid(), updated_at = now()
    where id = v_role.id returning * into v_role;
  insert into public.authorization_audit_events (
    event_type, actor_user_id, target_role_id, request_id, after_state, metadata
  ) values (
    'ROLE_STATUS_CHANGED', auth.uid(), v_role.id, gen_random_uuid(),
    jsonb_build_object('is_active', v_role.is_active),
    jsonb_build_object('role_code', v_role.code)
  );
  return jsonb_build_object('id', v_role.id, 'is_active', v_role.is_active, 'revision', v_role.revision);
end;
$$;

revoke all on function public.list_custom_roles() from public, anon, authenticated, service_role;
revoke all on function public.save_custom_role(uuid,text,text,text,text,jsonb,integer) from public, anon, authenticated, service_role;
revoke all on function public.set_custom_role_active(uuid,boolean,integer) from public, anon, authenticated, service_role;
grant execute on function public.list_custom_roles() to authenticated;
grant execute on function public.save_custom_role(uuid,text,text,text,text,jsonb,integer) to authenticated;
grant execute on function public.set_custom_role_active(uuid,boolean,integer) to authenticated;
