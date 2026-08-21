-- AUTH-F4A: Employee Read RLS + authorization helpers
-- Enables authenticated employee reads for SUPER_ADMIN and future scoped roles

-- ============================================================================
-- 1. SECURITY DEFINER AUTHORIZATION HELPERS
-- ============================================================================

-- Check if current user has SUPER_ADMIN system role
create or replace function public.auth_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.system_role_memberships srm
    join public.authorization_roles r on r.id = srm.role_id
    where srm.user_id = auth.uid()
      and srm.status = 'ACTIVE'
      and r.role_namespace = 'SYSTEM'
      and r.code = 'SUPER_ADMIN'
      and (srm.effective_to is null or srm.effective_to >= current_date)
      and srm.effective_from <= current_date
  )
$$;

-- Check if current user has a specific permission
create or replace function public.auth_has_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.system_role_memberships srm
    join public.authorization_roles r on r.id = srm.role_id
    join public.authorization_role_permissions arp on arp.role_id = r.id
    join public.authorization_permissions p on p.id = arp.permission_id
    where srm.user_id = auth.uid()
      and srm.status = 'ACTIVE'
      and p.code = p_code
      and (srm.effective_to is null or srm.effective_to >= current_date)
      and srm.effective_from <= current_date
  )
  or exists (
    select 1
    from public.contract_memberships cm
    join public.authorization_roles r on r.code = cm.contract_role and r.role_namespace = 'CONTRACT'
    join public.authorization_role_permissions arp on arp.role_id = r.id
    join public.authorization_permissions p on p.id = arp.permission_id
    where cm.user_id = auth.uid()
      and cm.status = 'ACTIVE'
      and p.code = p_code
      and (cm.effective_to is null or cm.effective_to >= current_date)
      and cm.effective_from <= current_date
  )
  or exists (
    select 1
    from public.organization_memberships om
    join public.authorization_roles r on r.code = om.organization_role and r.role_namespace = 'ORGANIZATION'
    join public.authorization_role_permissions arp on arp.role_id = r.id
    join public.authorization_permissions p on p.id = arp.permission_id
    where om.user_id = auth.uid()
      and om.status = 'ACTIVE'
      and p.code = p_code
      and (om.effective_to is null or om.effective_to >= current_date)
      and om.effective_from <= current_date
  )
$$;

-- Revoke execute from anon/authenticated ( SECURITY DEFINER already protects )
revoke execute on function public.auth_is_super_admin() from public, anon, authenticated;
revoke execute on function public.auth_has_permission(text) from public, anon, authenticated;

-- Grant execute to service_role for admin tooling
grant execute on function public.auth_is_super_admin() to service_role;
grant execute on function public.auth_has_permission(text) to service_role;

-- ============================================================================
-- 2. EMPLOYEE TABLES - SELECT RLS POLICIES
-- SUPER_ADMIN reads all. Non-SUPER_ADMIN scoped roles read via permission.
-- Anon: DENIED (RLS enabled, no broad policies).
-- ============================================================================

-- employees
create policy "employee_select_auth" on public.employees
  for select to authenticated
  using (
    public.auth_has_permission('employee.read')
  );

-- employee_unit_history
create policy "employee_unit_history_select_auth" on public.employee_unit_history
  for select to authenticated
  using (
    public.auth_has_permission('employee.read')
  );

-- employee_position_history
create policy "employee_position_history_select_auth" on public.employee_position_history
  for select to authenticated
  using (
    public.auth_has_permission('employee.read')
  );

-- employee_status_history
create policy "employee_status_history_select_auth" on public.employee_status_history
  for select to authenticated
  using (
    public.auth_has_permission('employee.read')
  );

-- employee_work_location_history
create policy "employee_work_location_history_select_auth" on public.employee_work_location_history
  for select to authenticated
  using (
    public.auth_has_permission('employee.read')
  );

-- employee_hourly_rate_history
create policy "employee_hourly_rate_history_select_auth" on public.employee_hourly_rate_history
  for select to authenticated
  using (
    public.auth_has_permission('employee.read')
  );

-- ============================================================================
-- 3. REFERENCE TABLES - SELECT RLS POLICIES
-- Reference data readable by all authenticated users.
-- ============================================================================

-- organization_units
create policy "organization_units_select_auth" on public.organization_units
  for select to authenticated
  using (true);

-- positions
create policy "positions_select_auth" on public.positions
  for select to authenticated
  using (true);

-- locations
create policy "locations_select_auth" on public.locations
  for select to authenticated
  using (true);

-- contracts
create policy "contracts_select_auth" on public.contracts
  for select to authenticated
  using (true);

-- contract_up3_scopes
create policy "contract_up3_scopes_select_auth" on public.contract_up3_scopes
  for select to authenticated
  using (true);

-- ============================================================================
-- 4. NO INSERT/UPDATE/DELETE POLICIES
-- F4A is read-only. Write operations remain local prototype only.
-- ============================================================================
