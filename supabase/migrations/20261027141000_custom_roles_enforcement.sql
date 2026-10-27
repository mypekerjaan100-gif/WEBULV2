-- Penegakan role custom: penugasan, baca operasional, dan edit per menu.

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
  v_is_custom boolean;
  v_role_level text;
begin
  v_actor := coalesce(p_actor_id, auth.uid());
  if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.auth_is_super_admin() and not exists (
    select 1 from public.system_role_memberships s
    join public.authorization_roles r on r.id=s.role_id
    where s.user_id=v_actor and s.status='ACTIVE' and r.code='SUPER_ADMIN'
      and s.effective_from <= current_date
      and (s.effective_to is null or s.effective_to > current_date)
  ) then
    if auth.uid() is null or auth.uid() <> v_actor then
      raise exception 'Only SUPER_ADMIN may set access' using errcode='42501';
    end if;
  end if;

  if not exists (select 1 from public.profiles where id=p_target_user_id) then
    raise exception 'Target user not found';
  end if;

  select role_namespace, id, is_custom, role_level
    into v_role_namespace, v_role_id, v_is_custom, v_role_level
  from public.authorization_roles where code=p_role;
  if v_role_namespace is null then raise exception 'Invalid role %', p_role; end if;
  if not coalesce((select is_active from public.authorization_roles where id=v_role_id), true) then
    raise exception 'Role tidak aktif';
  end if;

  if v_role_namespace = 'SYSTEM' then
    if p_role <> 'SUPER_ADMIN' then raise exception 'Invalid system role'; end if;
    if p_internal_unit_id is not null or p_contract_id is not null or p_up3_id is not null or p_unit_id is not null then
      raise exception 'SUPER_ADMIN must not have scope';
    end if;
  elsif v_role_namespace = 'ORGANIZATION' then
    if p_role not in ('TEAM_LEADER','MANAGER_UNIT','MANAGER_UP','ASMAN_OPERASI','ASMAN_KEUANGAN') then
      raise exception 'Invalid organization role';
    end if;
    if p_internal_unit_id is null then raise exception 'Organization role requires internal unit'; end if;
    if p_contract_id is not null or p_up3_id is not null or p_unit_id is not null then
      raise exception 'Organization role must not have contract scope';
    end if;
    if not exists (
      select 1 from public.internal_organization_units
      where id=p_internal_unit_id and status='ACTIVE'
        and type = case when p_role in ('TEAM_LEADER','MANAGER_UNIT') then 'UL' else 'UP' end
    ) then raise exception 'Invalid organization unit for role'; end if;
  elsif v_role_namespace = 'CONTRACT' then
    if not v_is_custom and p_role not in ('ADMIN_UP3','ADMIN_ULP') then
      raise exception 'Invalid contract role';
    end if;
    if v_is_custom and v_role_level is distinct from 'ULP' then
      raise exception 'Role custom hanya mendukung cakupan ULP';
    end if;
    if p_contract_id is null or p_up3_id is null then
      raise exception 'Contract role requires contract and UP3';
    end if;
    if p_internal_unit_id is not null then
      raise exception 'Contract role must not have organization unit';
    end if;
    if not exists (select 1 from public.contracts where id=p_contract_id and status='active') then
      raise exception 'Invalid contract';
    end if;
    if not exists (select 1 from public.organization_units where id=p_up3_id and type='UP3' and own_status='Aktif') then
      raise exception 'Invalid UP3';
    end if;
    if not exists (select 1 from public.contract_up3_scopes where contract_id=p_contract_id and up3_id=p_up3_id and status='Aktif') then
      raise exception 'Contract not scoped to UP3';
    end if;
    if (v_is_custom or p_role = 'ADMIN_ULP') and p_unit_id is null then
      raise exception 'Role requires ULP';
    end if;
    if p_role = 'ADMIN_UP3' and p_unit_id is not null then
      raise exception 'ADMIN_UP3 must not have unit';
    end if;
    if p_unit_id is not null and not exists (
      select 1 from public.organization_units
      where id=p_unit_id and type='ULP' and parent_id=p_up3_id and own_status='Aktif'
    ) then raise exception 'Invalid ULP for UP3'; end if;
  else
    raise exception 'Unsupported role namespace';
  end if;

  delete from public.system_role_memberships where user_id=p_target_user_id;
  delete from public.organization_memberships where user_id=p_target_user_id;
  delete from public.contract_memberships where user_id=p_target_user_id;

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
  values ('ROLE_ASSIGNED', v_actor, p_target_user_id, v_role_id, gen_random_uuid(),
    jsonb_build_object('role', p_role, 'internal_unit', p_internal_unit_id, 'contract', p_contract_id, 'up3', p_up3_id, 'unit', p_unit_id),
    jsonb_build_object('role', p_role));
  return v_new_id;
end;
$function$;

create or replace function public.auth_can_access_operational_up3(p_contract_id uuid, p_up3_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.contract_memberships cm
      join public.contracts c on c.id = cm.contract_id and c.status = 'active'
      join public.contract_up3_scopes cus on cus.contract_id = cm.contract_id and cus.up3_id = cm.operational_up3_id and cus.status = 'Aktif'
      where cm.user_id = auth.uid()
        and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date
        and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id
        and cm.operational_up3_id = p_up3_id
        and cm.contract_role in ('ADMIN_UP3', 'ADMIN_ULP')
    )
    or public.auth_has_management_operational_scope(p_contract_id, p_up3_id, null)
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, null, 'sla.read')
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, null, 'variable_cost.read')
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, null, 'overtime.read')
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, null, 'alat.read')
  )
$function$;

create or replace function public.auth_can_access_operational_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select public.auth_can_access_operational_up3(p_contract_id, p_up3_id) and (
    exists (
      select 1
      from public.contract_memberships cm
      where cm.user_id = auth.uid()
        and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date
        and (cm.effective_to is null or current_date < cm.effective_to)
        and cm.contract_id = p_contract_id
        and cm.operational_up3_id = p_up3_id
        and (
          (cm.contract_role = 'ADMIN_ULP' and cm.operational_unit_id = p_unit_id)
          or (cm.contract_role = 'ADMIN_UP3' and public.auth_can_access_operational_unit(p_unit_id))
        )
    )
    or public.auth_has_management_operational_scope(p_contract_id, p_up3_id, p_unit_id)
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'sla.read')
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'variable_cost.read')
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'overtime.read')
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'alat.read')
  )
$function$;

create or replace function public.auth_can_access_variable_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select public.auth_is_super_admin()
  or public.auth_can_access_operational_scope(p_contract_id, p_up3_id, p_unit_id)
  or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'variable_cost.read')
  or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'sla.read')
$function$;

create or replace function public.auth_can_read_overtime_evidence_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select public.auth_can_manage_overtime_scope(p_contract_id, p_up3_id, p_unit_id)
  or public.auth_can_read_management_overtime_scope(p_contract_id, p_up3_id, p_unit_id)
  or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'overtime.read')
$function$;

create or replace function public.auth_can_manage_overtime_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and exists (
    select 1
    from public.contracts c
    join public.contract_up3_scopes scope on scope.contract_id = c.id and scope.up3_id = p_up3_id and scope.status = 'Aktif'
    join public.organization_units target_unit on target_unit.id = p_unit_id and target_unit.own_status = 'Aktif'
      and (target_unit.id = p_up3_id or (target_unit.type = 'ULP' and target_unit.parent_id = p_up3_id))
    where c.id = p_contract_id and c.status = 'active'
      and (
        public.auth_is_super_admin()
        or exists (
          select 1 from public.contract_memberships membership
          where membership.user_id = auth.uid()
            and membership.status = 'ACTIVE'
            and membership.effective_from <= current_date
            and (membership.effective_to is null or current_date < membership.effective_to)
            and membership.contract_id = p_contract_id
            and membership.operational_up3_id = p_up3_id
            and (
              (membership.contract_role = 'ADMIN_UP3' and membership.operational_unit_id is null)
              or (membership.contract_role = 'ADMIN_ULP' and membership.operational_unit_id = p_unit_id)
            )
        )
        or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'overtime.manage')
      )
  )
$function$;

create or replace function public.auth_can_mutate_overtime_replacement_l2(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and public.auth_can_manage_overtime_scope(p_contract_id, p_up3_id, p_unit_id)
   and exists(select 1 from public.organization_units u where u.id = p_unit_id and u.own_status = 'Aktif' and ((u.type = 'ULP' and u.parent_id = p_up3_id) or (u.type = 'UP3' and u.id = p_up3_id)))
   and (
     public.auth_is_super_admin()
     or exists(select 1 from public.contract_memberships m where m.user_id = auth.uid() and m.contract_role = 'ADMIN_ULP' and m.status = 'ACTIVE' and m.effective_from <= current_date and (m.effective_to is null or current_date < m.effective_to) and m.contract_id = p_contract_id and m.operational_up3_id = p_up3_id and m.operational_unit_id = p_unit_id)
     or (p_unit_id = p_up3_id and exists(select 1 from public.contract_memberships m where m.user_id = auth.uid() and m.contract_role = 'ADMIN_UP3' and m.operational_unit_id is null and m.status = 'ACTIVE' and m.effective_from <= current_date and (m.effective_to is null or current_date < m.effective_to) and m.contract_id = p_contract_id and m.operational_up3_id = p_up3_id))
     or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'overtime.manage')
   )
$function$;

create or replace function public.auth_can_mutate_variable_entry_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists(
      select 1 from public.contract_memberships membership
      where membership.user_id=auth.uid()
        and membership.contract_role='ADMIN_ULP'
        and membership.contract_id=p_contract_id
        and membership.operational_up3_id=p_up3_id
        and membership.operational_unit_id=p_unit_id
        and membership.status='ACTIVE'
        and membership.effective_from<=current_date
        and (membership.effective_to is null or current_date<membership.effective_to)
    )
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'variable_cost.manage')
  )
$function$;

create or replace function public.ops_vehicle_can_access(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid)
returns boolean
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
        and (cm.contract_role = 'ADMIN_UP3' or (cm.contract_role = 'ADMIN_ULP' and cm.operational_unit_id = p_ulp_id))
    )
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_ulp_id, 'alat.read')
  )
$function$;

create or replace function public.ops_vehicle_can_manage(p_contract_id uuid, p_up3_id uuid, p_ulp_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
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
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_ulp_id, 'alat.manage')
  )
$function$;

create or replace function public.auth_has_financial_analysis_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null and (
    (
      public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'finance.read')
      and (p_unit_id is not null or not public.auth_is_custom_contract_role(p_contract_id, p_up3_id, null))
    )
    or exists (
      select 1
      from public.organization_memberships m
      join public.internal_organization_units assigned on assigned.id = m.internal_org_unit_id and assigned.status = 'ACTIVE'
      join public.internal_organization_units mapped_ul on mapped_ul.status = 'ACTIVE' and mapped_ul.type = 'UL'
        and (
          (m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT') and assigned.type = 'UL' and mapped_ul.id = assigned.id)
          or (m.organization_role = 'MANAGER_UP' and assigned.type = 'UP' and mapped_ul.parent_id = assigned.id)
        )
      join public.organization_contract_access oca on oca.internal_org_unit_id = mapped_ul.id
        and oca.status = 'ACTIVE' and oca.effective_from <= current_date
        and (oca.effective_to is null or current_date < oca.effective_to)
      where m.user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.effective_from <= current_date
        and (m.effective_to is null or current_date < m.effective_to)
        and m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT', 'MANAGER_UP')
        and oca.contract_id = p_contract_id
        and oca.operational_up3_id = p_up3_id
        and (p_unit_id is null or oca.operational_unit_id is null or oca.operational_unit_id = p_unit_id)
        and (p_unit_id is null or exists (
          select 1 from public.organization_units ou
          where ou.id = p_unit_id and ou.type = 'ULP' and ou.parent_id = p_up3_id and ou.own_status = 'Aktif'
        ))
    )
  )
$function$;
