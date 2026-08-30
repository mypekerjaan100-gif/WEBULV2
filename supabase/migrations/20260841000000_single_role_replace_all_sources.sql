-- Ensure single active access across all canonical sources: system, organization, contract
create or replace function public.admin_replace_organization_access(p_target_user_id uuid, p_internal_unit_id uuid, p_org_role text, p_actor_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public','pg_temp'
as $function$
declare v_new_id uuid;
begin
  update public.system_role_memberships
    set status='INACTIVE', effective_to = greatest(current_date + 1, effective_from + 1), updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  update public.contract_memberships
    set status='INACTIVE', effective_to = greatest(current_date + 1, effective_from + 1), updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  update public.organization_memberships
    set status='INACTIVE', effective_to = greatest(current_date + 1, effective_from + 1), updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  insert into public.organization_memberships (user_id, internal_org_unit_id, organization_role, status, effective_from, created_by, updated_by)
  values (p_target_user_id, p_internal_unit_id, p_org_role, 'ACTIVE', current_date, p_actor_id, p_actor_id)
  returning id into v_new_id;
  insert into public.authorization_audit_events (event_type, actor_user_id, target_user_id, target_role_id, request_id, after_state, metadata)
  values ('ROLE_ASSIGNED', p_actor_id, p_target_user_id, (select id from public.authorization_roles where role_namespace='ORGANIZATION' and code=p_org_role), gen_random_uuid(), jsonb_build_object('internal_org_unit_id', p_internal_unit_id, 'organization_role', p_org_role), jsonb_build_object('internal_org_unit_id', p_internal_unit_id, 'organization_role', p_org_role));
  return v_new_id;
end;
$function$;

create or replace function public.admin_replace_contract_access(p_target_user_id uuid, p_contract_id uuid, p_contract_role text, p_up3_id uuid, p_unit_id uuid, p_actor_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public','pg_temp'
as $function$
declare v_new_id uuid;
begin
  update public.system_role_memberships
    set status='INACTIVE', effective_to = greatest(current_date + 1, effective_from + 1), updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  update public.contract_memberships
    set status='INACTIVE', effective_to = greatest(current_date + 1, effective_from + 1), updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  update public.organization_memberships
    set status='INACTIVE', effective_to = greatest(current_date + 1, effective_from + 1), updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  insert into public.contract_memberships (user_id, contract_id, contract_role, operational_up3_id, operational_unit_id, status, effective_from, created_by, updated_by)
  values (p_target_user_id, p_contract_id, p_contract_role, p_up3_id, p_unit_id, 'ACTIVE', current_date, p_actor_id, p_actor_id)
  returning id into v_new_id;
  insert into public.authorization_audit_events (event_type, actor_user_id, target_user_id, target_role_id, request_id, after_state, metadata)
  values ('ROLE_ASSIGNED', p_actor_id, p_target_user_id, (select id from public.authorization_roles where role_namespace='CONTRACT' and code=p_contract_role), gen_random_uuid(), jsonb_build_object('contract_id', p_contract_id, 'contract_role', p_contract_role, 'operational_up3_id', p_up3_id, 'operational_unit_id', p_unit_id), jsonb_build_object('contract_id', p_contract_id, 'contract_role', p_contract_role));
  return v_new_id;
end;
$function$;

create or replace function public.admin_revoke_user_access(p_target_user_id uuid, p_actor_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public','pg_temp'
as $function$
begin
  update public.system_role_memberships
    set status='INACTIVE', effective_to = greatest(current_date + 1, effective_from + 1), updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  update public.contract_memberships
    set status='INACTIVE', effective_to = greatest(current_date + 1, effective_from + 1), updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  update public.organization_memberships
    set status='INACTIVE', effective_to = greatest(current_date + 1, effective_from + 1), updated_by=p_actor_id
    where user_id=p_target_user_id and status='ACTIVE';
  insert into public.authorization_audit_events (event_type, actor_user_id, target_user_id, request_id, after_state, metadata)
  values ('ROLE_REVOKED', p_actor_id, p_target_user_id, gen_random_uuid(), jsonb_build_object('status','INACTIVE'), jsonb_build_object('revoked_user_id', p_target_user_id));
end;
$function$;
