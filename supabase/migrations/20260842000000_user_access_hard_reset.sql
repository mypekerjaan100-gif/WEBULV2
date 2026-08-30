-- One account = 0 or 1 access record. Hard reset: DELETE old, INSERT one.

create or replace function public.admin_set_user_access(
  p_target_user_id uuid,
  p_role text,
  p_internal_unit_id uuid default null,
  p_contract_id uuid default null,
  p_up3_id uuid default null,
  p_unit_id uuid default null,
  p_actor_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_actor uuid;
  v_new_id uuid;
  v_role_namespace text;
  v_role_id uuid;
begin
  v_actor := coalesce(p_actor_id, auth.uid());
  if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.auth_is_super_admin() and not exists (select 1 from public.system_role_memberships s join public.authorization_roles r on r.id=s.role_id where s.user_id=v_actor and s.status='ACTIVE' and r.code='SUPER_ADMIN' and s.effective_from <= current_date and (s.effective_to is null or s.effective_to > current_date)) then
    -- fallback check via service role context: allow service_role to bypass for Edge Function
    if auth.uid() is null or auth.uid() <> v_actor then
      raise exception 'Only SUPER_ADMIN may set access' using errcode='42501';
    end if;
  end if;

  -- validate target user exists and is not disabled
  if not exists (select 1 from public.profiles where id=p_target_user_id) then raise exception 'Target user not found'; end if;

  -- determine namespace and validate role/scope
  select role_namespace, id into v_role_namespace, v_role_id from public.authorization_roles where code=p_role;
  if v_role_namespace is null then raise exception 'Invalid role %', p_role; end if;

  if v_role_namespace = 'SYSTEM' then
    if p_role <> 'SUPER_ADMIN' then raise exception 'Invalid system role'; end if;
    if p_internal_unit_id is not null or p_contract_id is not null or p_up3_id is not null or p_unit_id is not null then raise exception 'SUPER_ADMIN must not have scope'; end if;
  elsif v_role_namespace = 'ORGANIZATION' then
    if p_role not in ('TEAM_LEADER','MANAGER_UNIT','MANAGER_UP','ASMAN_OPERASI','ASMAN_KEUANGAN') then raise exception 'Invalid organization role'; end if;
    if p_internal_unit_id is null then raise exception 'Organization role requires internal unit'; end if;
    if p_contract_id is not null or p_up3_id is not null or p_unit_id is not null then raise exception 'Organization role must not have contract scope'; end if;
    -- validate unit exists and matches role level
    if not exists (select 1 from public.internal_organization_units where id=p_internal_unit_id and status='ACTIVE' and type = case when p_role in ('TEAM_LEADER','MANAGER_UNIT') then 'UL' else 'UP' end) then raise exception 'Invalid organization unit for role'; end if;
  elsif v_role_namespace = 'CONTRACT' then
    if p_role not in ('ADMIN_UP3','ADMIN_ULP') then raise exception 'Invalid contract role'; end if;
    if p_contract_id is null or p_up3_id is null then raise exception 'Contract role requires contract and UP3'; end if;
    if p_internal_unit_id is not null then raise exception 'Contract role must not have organization unit'; end if;
    if not exists (select 1 from public.contracts where id=p_contract_id and status='active') then raise exception 'Invalid contract'; end if;
    if not exists (select 1 from public.organization_units where id=p_up3_id and type='UP3' and own_status='Aktif') then raise exception 'Invalid UP3'; end if;
    if not exists (select 1 from public.contract_up3_scopes where contract_id=p_contract_id and up3_id=p_up3_id and status='Aktif') then raise exception 'Contract not scoped to UP3'; end if;
    if p_role = 'ADMIN_UP3' and p_unit_id is not null then raise exception 'ADMIN_UP3 must not have unit'; end if;
    if p_role = 'ADMIN_ULP' and p_unit_id is null then raise exception 'ADMIN_ULP requires unit'; end if;
    if p_unit_id is not null and not exists (select 1 from public.organization_units where id=p_unit_id and type='ULP' and parent_id=p_up3_id and own_status='Aktif') then raise exception 'Invalid ULP for UP3'; end if;
  else
    raise exception 'Unsupported role namespace';
  end if;

  -- atomic hard reset: delete all existing access for user (do not preserve as INACTIVE history)
  delete from public.system_role_memberships where user_id=p_target_user_id;
  delete from public.organization_memberships where user_id=p_target_user_id;
  delete from public.contract_memberships where user_id=p_target_user_id;

  -- insert exactly one new assignment
  if v_role_namespace = 'SYSTEM' then
    insert into public.system_role_memberships (user_id, role_id, status, effective_from, created_by, updated_by)
    values (p_target_user_id, v_role_id, 'ACTIVE', current_date, v_actor, v_actor) returning id into v_new_id;
  elsif v_role_namespace = 'ORGANIZATION' then
    insert into public.organization_memberships (user_id, internal_org_unit_id, organization_role, status, effective_from, created_by, updated_by)
    values (p_target_user_id, p_internal_unit_id, p_role, 'ACTIVE', current_date, v_actor, v_actor) returning id into v_new_id;
  elsif v_role_namespace = 'CONTRACT' then
    insert into public.contract_memberships (user_id, contract_id, contract_role, operational_up3_id, operational_unit_id, status, effective_from, created_by, updated_by)
    values (p_target_user_id, p_contract_id, p_role, p_up3_id, p_unit_id, 'ACTIVE', current_date, v_actor, v_actor) returning id into v_new_id;
  end if;

  insert into public.authorization_audit_events (event_type, actor_user_id, target_user_id, target_role_id, request_id, after_state, metadata)
  values ('ROLE_ASSIGNED', v_actor, p_target_user_id, v_role_id, gen_random_uuid(), jsonb_build_object('role', p_role, 'internal_unit', p_internal_unit_id, 'contract', p_contract_id, 'up3', p_up3_id, 'unit', p_unit_id), jsonb_build_object('role', p_role));

  return v_new_id;
end;
$function$;

create or replace function public.admin_delete_user_access(p_target_user_id uuid, p_actor_id uuid default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public','pg_temp'
as $function$
declare v_actor uuid;
begin
  v_actor := coalesce(p_actor_id, auth.uid());
  if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.auth_is_super_admin() and not exists (select 1 from public.system_role_memberships s join public.authorization_roles r on r.id=s.role_id where s.user_id=v_actor and s.status='ACTIVE' and r.code='SUPER_ADMIN') then
    if auth.uid() is null or auth.uid() <> v_actor then raise exception 'Only SUPER_ADMIN may delete access' using errcode='42501'; end if;
  end if;
  delete from public.system_role_memberships where user_id=p_target_user_id;
  delete from public.organization_memberships where user_id=p_target_user_id;
  delete from public.contract_memberships where user_id=p_target_user_id;
  insert into public.authorization_audit_events (event_type, actor_user_id, target_user_id, request_id, after_state, metadata)
  values ('ROLE_REVOKED', v_actor, p_target_user_id, gen_random_uuid(), jsonb_build_object('status','NO_ACCESS'), jsonb_build_object('deleted_user_id', p_target_user_id));
end;
$function$;

-- Update legacy replace functions to use hard-reset semantics (DELETE, not INACTIVE) for backward compatibility
create or replace function public.admin_replace_organization_access(p_target_user_id uuid, p_internal_unit_id uuid, p_org_role text, p_actor_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public','pg_temp'
as $function$
begin
  return public.admin_set_user_access(p_target_user_id, p_org_role, p_internal_unit_id, null, null, null, p_actor_id);
end;
$function$;

create or replace function public.admin_replace_contract_access(p_target_user_id uuid, p_contract_id uuid, p_contract_role text, p_up3_id uuid, p_unit_id uuid, p_actor_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public','pg_temp'
as $function$
begin
  return public.admin_set_user_access(p_target_user_id, p_contract_role, null, p_contract_id, p_up3_id, p_unit_id, p_actor_id);
end;
$function$;

create or replace function public.admin_revoke_user_access(p_target_user_id uuid, p_actor_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public','pg_temp'
as $function$
begin
  perform public.admin_delete_user_access(p_target_user_id, p_actor_id);
end;
$function$;

revoke all on function public.admin_set_user_access(uuid,text,uuid,uuid,uuid,uuid,uuid) from public, anon;
revoke all on function public.admin_delete_user_access(uuid,uuid) from public, anon;
grant execute on function public.admin_set_user_access(uuid,text,uuid,uuid,uuid,uuid,uuid) to authenticated, service_role;
grant execute on function public.admin_delete_user_access(uuid,uuid) to authenticated, service_role;
