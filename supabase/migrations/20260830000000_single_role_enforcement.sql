-- Single-role enforcement: 1 account = 1 active operational/management role
create or replace function public.enforce_single_active_access()
returns trigger
language plpgsql
as $$
declare
  v_count int;
begin
  if new.status is distinct from 'ACTIVE' then
    return new;
  end if;

  -- Count other ACTIVE memberships across all operational tables
  if tg_table_name = 'contract_memberships' then
    select
      (select count(*) from public.contract_memberships where user_id = new.user_id and status='ACTIVE' and id <> new.id)
    + (select count(*) from public.organization_memberships where user_id = new.user_id and status='ACTIVE')
    + (select count(*) from public.system_role_memberships where user_id = new.user_id and status='ACTIVE')
    into v_count;
  elsif tg_table_name = 'organization_memberships' then
    select
      (select count(*) from public.contract_memberships where user_id = new.user_id and status='ACTIVE')
    + (select count(*) from public.organization_memberships where user_id = new.user_id and status='ACTIVE' and id <> new.id)
    + (select count(*) from public.system_role_memberships where user_id = new.user_id and status='ACTIVE')
    into v_count;
  elsif tg_table_name = 'system_role_memberships' then
    select
      (select count(*) from public.contract_memberships where user_id = new.user_id and status='ACTIVE')
    + (select count(*) from public.organization_memberships where user_id = new.user_id and status='ACTIVE')
    + (select count(*) from public.system_role_memberships where user_id = new.user_id and status='ACTIVE' and id <> new.id)
    into v_count;
  else
    v_count := 0;
  end if;

  if v_count > 0 then
    raise exception 'single-role violation: user already has an active role' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_single_active_contract on public.contract_memberships;
create trigger trg_enforce_single_active_contract
before insert or update of status on public.contract_memberships
for each row execute function public.enforce_single_active_access();

drop trigger if exists trg_enforce_single_active_org on public.organization_memberships;
create trigger trg_enforce_single_active_org
before insert or update of status on public.organization_memberships
for each row execute function public.enforce_single_active_access();

drop trigger if exists trg_enforce_single_active_system on public.system_role_memberships;
create trigger trg_enforce_single_active_system
before insert or update of status on public.system_role_memberships
for each row execute function public.enforce_single_active_access();

-- Atomic helpers for SUPER_ADMIN operations
create or replace function public.admin_revoke_user_access(p_target_user_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.contract_memberships
    set status='INACTIVE', effective_to=current_date, updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  update public.organization_memberships
    set status='INACTIVE', effective_to=current_date, updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  -- Do not auto-revoke SUPER_ADMIN via this helper unless explicitly requested; keep system role separate
  -- But single-role counts it, so revoke it as well when revoking all operational access
  -- Keep SUPER_ADMIN intact to avoid locking out last super admin; caller decides

  insert into public.authorization_audit_events (event_type, actor_user_id, target_user_id, request_id, after_state, metadata)
  values ('ROLE_REVOKED', p_actor_id, p_target_user_id, gen_random_uuid(), jsonb_build_object('status','INACTIVE'), jsonb_build_object('revoked_user_id', p_target_user_id));
end;
$$;

create or replace function public.admin_deactivate_user(p_target_user_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_revoke_user_access(p_target_user_id, p_actor_id);
  update public.profiles set status='DISABLED' where id=p_target_user_id;
  insert into public.authorization_audit_events (event_type, actor_user_id, target_user_id, request_id, after_state, metadata)
  values ('USER_DISABLED', p_actor_id, p_target_user_id, gen_random_uuid(), jsonb_build_object('status','DISABLED'), jsonb_build_object('deactivated_user_id', p_target_user_id));
end;
$$;

create or replace function public.admin_replace_contract_access(
  p_target_user_id uuid,
  p_contract_id uuid,
  p_contract_role text,
  p_up3_id uuid,
  p_unit_id uuid,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_id uuid;
begin
  -- Revoke existing operational access atomically
  update public.contract_memberships
    set status='INACTIVE', effective_to=current_date, updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  update public.organization_memberships
    set status='INACTIVE', effective_to=current_date, updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';

  insert into public.contract_memberships (user_id, contract_id, contract_role, operational_up3_id, operational_unit_id, status, effective_from, created_by, updated_by)
  values (p_target_user_id, p_contract_id, p_contract_role, p_up3_id, p_unit_id, 'ACTIVE', current_date, p_actor_id, p_actor_id)
  returning id into v_new_id;

  insert into public.authorization_audit_events (event_type, actor_user_id, target_user_id, target_role_id, request_id, after_state, metadata)
  values ('ROLE_ASSIGNED', p_actor_id, p_target_user_id, (select id from public.authorization_roles where role_namespace='CONTRACT' and code=p_contract_role), gen_random_uuid(), jsonb_build_object('contract_id', p_contract_id, 'contract_role', p_contract_role, 'operational_up3_id', p_up3_id, 'operational_unit_id', p_unit_id), jsonb_build_object('contract_id', p_contract_id, 'contract_role', p_contract_role));

  return v_new_id;
end;
$$;

create or replace function public.admin_replace_organization_access(
  p_target_user_id uuid,
  p_internal_unit_id uuid,
  p_org_role text,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_id uuid;
begin
  update public.contract_memberships
    set status='INACTIVE', effective_to=current_date, updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  update public.organization_memberships
    set status='INACTIVE', effective_to=current_date, updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';

  insert into public.organization_memberships (user_id, internal_org_unit_id, organization_role, status, effective_from, created_by, updated_by)
  values (p_target_user_id, p_internal_unit_id, p_org_role, 'ACTIVE', current_date, p_actor_id, p_actor_id)
  returning id into v_new_id;

  insert into public.authorization_audit_events (event_type, actor_user_id, target_user_id, target_role_id, request_id, after_state, metadata)
  values ('ROLE_ASSIGNED', p_actor_id, p_target_user_id, (select id from public.authorization_roles where role_namespace='ORGANIZATION' and code=p_org_role), gen_random_uuid(), jsonb_build_object('internal_org_unit_id', p_internal_unit_id, 'organization_role', p_org_role), jsonb_build_object('internal_org_unit_id', p_internal_unit_id, 'organization_role', p_org_role));

  return v_new_id;
end;
$$;

revoke execute on function public.admin_revoke_user_access(uuid, uuid) from public, anon;
revoke execute on function public.admin_deactivate_user(uuid, uuid) from public, anon;
revoke execute on function public.admin_replace_contract_access(uuid, uuid, text, uuid, uuid, uuid) from public, anon;
revoke execute on function public.admin_replace_organization_access(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.admin_revoke_user_access(uuid, uuid) to authenticated;
grant execute on function public.admin_deactivate_user(uuid, uuid) to authenticated;
grant execute on function public.admin_replace_contract_access(uuid, uuid, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.admin_replace_organization_access(uuid, uuid, text, uuid) to authenticated;
