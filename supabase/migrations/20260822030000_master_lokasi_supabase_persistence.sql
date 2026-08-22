-- Master Lokasi: SUPER_ADMIN bootstrap read/write surface.

grant select on table public.location_name_history to authenticated;
revoke select on table public.location_name_history from anon, public;

drop policy if exists location_name_history_select_super_admin
  on public.location_name_history;
create policy location_name_history_select_super_admin
  on public.location_name_history
  for select
  to authenticated
  using (public.auth_is_super_admin());

create or replace function public.create_kantor_jaga(
  p_contract_id uuid,
  p_unit_id uuid,
  p_name text,
  p_effective_from date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_location_id uuid := gen_random_uuid();
  v_up3_id uuid;
  v_unit_type text;
  v_unit_status text;
  v_name text := btrim(p_name);
begin
  if auth.uid() is null or not public.auth_is_super_admin() then
    raise exception 'Not authorized to create Kantor Jaga' using errcode = '42501';
  end if;
  if v_name = '' or p_effective_from is null then
    raise exception 'Name and effective date are required' using errcode = '22023';
  end if;

  select ou.parent_id, ou.type, ou.own_status
    into v_up3_id, v_unit_type, v_unit_status
    from public.organization_units ou
   where ou.id = p_unit_id;
  if v_unit_type is distinct from 'ULP' or v_up3_id is null or v_unit_status <> 'Aktif' then
    raise exception 'Kantor Jaga must belong to an active ULP' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.contract_up3_scopes scope
    where scope.contract_id = p_contract_id
      and scope.up3_id = v_up3_id
      and scope.status = 'Aktif'
  ) then
    raise exception 'ULP is outside the active contract scope' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.locations location
    join public.location_name_history history
      on history.location_id = location.id and history.effective_to is null
    where location.contract_id = p_contract_id
      and location.unit_id = p_unit_id
      and location.type = 'KANTOR_JAGA'
      and lower(history.name) = lower(v_name)
  ) then
    raise exception 'Kantor Jaga with this name already exists in the unit'
      using errcode = '23505';
  end if;

  insert into public.locations (
    id, legacy_key, contract_id, up3_id, unit_id, type, own_status,
    created_by, updated_by
  ) values (
    v_location_id,
    'loc-kj-' || replace(v_location_id::text, '-', ''),
    p_contract_id,
    v_up3_id,
    p_unit_id,
    'KANTOR_JAGA',
    'Aktif',
    auth.uid(),
    auth.uid()
  );

  insert into public.location_name_history (
    location_id, name, effective_from, created_by
  ) values (
    v_location_id, v_name, p_effective_from, auth.uid()
  );

  return v_location_id;
end;
$$;

create or replace function public.rename_kantor_jaga(
  p_location_id uuid,
  p_name text,
  p_effective_from date
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(p_name);
  v_type text;
  v_current_id uuid;
  v_current_from date;
begin
  if auth.uid() is null or not public.auth_is_super_admin() then
    raise exception 'Not authorized to rename Kantor Jaga' using errcode = '42501';
  end if;
  if v_name = '' or p_effective_from is null then
    raise exception 'Name and effective date are required' using errcode = '22023';
  end if;

  select location.type into v_type
    from public.locations location
   where location.id = p_location_id
   for update;
  if v_type is null then
    raise exception 'Location not found' using errcode = 'P0002';
  end if;
  if v_type <> 'KANTOR_JAGA' then
    raise exception 'UNIT_OFFICE names cannot be changed manually' using errcode = '42501';
  end if;

  select history.id, history.effective_from
    into v_current_id, v_current_from
    from public.location_name_history history
   where history.location_id = p_location_id
     and history.effective_to is null
   for update;

  if v_current_id is null then
    insert into public.location_name_history (
      location_id, name, effective_from, created_by
    ) values (
      p_location_id, v_name, p_effective_from, auth.uid()
    );
  elsif p_effective_from < v_current_from then
    raise exception 'Effective date cannot precede the current name period'
      using errcode = '22023';
  elsif p_effective_from = v_current_from then
    update public.location_name_history
       set name = v_name
     where id = v_current_id;
  else
    update public.location_name_history
       set effective_to = p_effective_from
     where id = v_current_id;
    insert into public.location_name_history (
      location_id, name, effective_from, created_by
    ) values (
      p_location_id, v_name, p_effective_from, auth.uid()
    );
  end if;

  update public.locations
     set updated_by = auth.uid()
   where id = p_location_id;
  return true;
end;
$$;

create or replace function public.set_kantor_jaga_status(
  p_location_id uuid,
  p_own_status text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.auth_is_super_admin() then
    raise exception 'Not authorized to change Kantor Jaga status' using errcode = '42501';
  end if;
  if p_own_status not in ('Aktif', 'Nonaktif') then
    raise exception 'Invalid location status' using errcode = '22023';
  end if;

  update public.locations
     set own_status = p_own_status,
         updated_by = auth.uid()
   where id = p_location_id
     and type = 'KANTOR_JAGA';
  if not found then
    raise exception 'Kantor Jaga not found' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

create or replace function public.delete_kantor_jaga(p_location_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
begin
  if auth.uid() is null or not public.auth_is_super_admin() then
    raise exception 'Not authorized to delete Kantor Jaga' using errcode = '42501';
  end if;

  select location.type into v_type
    from public.locations location
   where location.id = p_location_id
   for update;
  if v_type is null then
    raise exception 'Location not found' using errcode = 'P0002';
  end if;
  if v_type <> 'KANTOR_JAGA' then
    raise exception 'UNIT_OFFICE cannot be deleted' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.employee_work_location_history history
    where history.location_id = p_location_id
  ) then
    raise exception 'Location is referenced by employee history' using errcode = '23503';
  end if;

  delete from public.locations where id = p_location_id;
  return true;
end;
$$;

revoke all on function public.create_kantor_jaga(uuid, uuid, text, date) from public, anon;
revoke all on function public.rename_kantor_jaga(uuid, text, date) from public, anon;
revoke all on function public.set_kantor_jaga_status(uuid, text) from public, anon;
revoke all on function public.delete_kantor_jaga(uuid) from public, anon;

grant execute on function public.create_kantor_jaga(uuid, uuid, text, date) to authenticated;
grant execute on function public.rename_kantor_jaga(uuid, text, date) to authenticated;
grant execute on function public.set_kantor_jaga_status(uuid, text) to authenticated;
grant execute on function public.delete_kantor_jaga(uuid) to authenticated;
