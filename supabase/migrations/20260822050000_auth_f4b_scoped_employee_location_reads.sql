-- AUTH-F4B: Add contract-membership-scoped read access for operational users.
-- Existing SUPER_ADMIN policies remain in place; these policies are additive.

create or replace function public.auth_can_access_operational_up3(
  p_contract_id uuid,
  p_up3_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.contract_memberships cm
      join public.contracts c
        on c.id = cm.contract_id
       and c.status = 'active'
      join public.contract_up3_scopes cus
        on cus.contract_id = cm.contract_id
       and cus.up3_id = cm.operational_up3_id
       and cus.status = 'Aktif'
      where cm.user_id = auth.uid()
        and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date
        and (cm.effective_to is null or cm.effective_to > current_date)
        and cm.contract_id = p_contract_id
        and cm.operational_up3_id = p_up3_id
        and cm.contract_role in ('ADMIN_UP3', 'ADMIN_ULP')
    )
$$;

create or replace function public.auth_can_access_operational_unit(
  p_target_unit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.contract_memberships cm
      where cm.user_id = auth.uid()
        and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date
        and (cm.effective_to is null or cm.effective_to > current_date)
        and (
          (cm.contract_role = 'ADMIN_ULP'
            and cm.operational_unit_id = p_target_unit_id)
          or
          (cm.contract_role = 'ADMIN_UP3'
            and (
              p_target_unit_id = cm.operational_up3_id
              or exists (
                select 1
                from public.organization_units ou
                where ou.id = p_target_unit_id
                  and ou.type = 'ULP'
                  and ou.parent_id = cm.operational_up3_id
              )
            ))
        )
    )
$$;

create or replace function public.auth_can_access_operational_scope(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.auth_can_access_operational_up3(p_contract_id, p_up3_id)
    and exists (
      select 1
      from public.contract_memberships cm
      where cm.user_id = auth.uid()
        and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date
        and (cm.effective_to is null or cm.effective_to > current_date)
        and cm.contract_id = p_contract_id
        and cm.operational_up3_id = p_up3_id
        and (
          (cm.contract_role = 'ADMIN_ULP'
            and cm.operational_unit_id = p_unit_id)
          or
          (cm.contract_role = 'ADMIN_UP3'
            and public.auth_can_access_operational_unit(p_unit_id))
        )
    )
$$;

create or replace function public.auth_can_read_employee(
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.employee_unit_history euh
      where euh.employee_id = p_employee_id
        and euh.effective_from <= current_date
        and (euh.effective_to is null or euh.effective_to > current_date)
        and public.auth_can_access_operational_scope(
          euh.contract_id,
          euh.up3_id,
          euh.unit_id
        )
    )
$$;

create or replace function public.auth_can_read_location(
  p_location_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.locations l
      where l.id = p_location_id
        and public.auth_can_access_operational_scope(
          l.contract_id,
          l.up3_id,
          l.unit_id
        )
    )
$$;

revoke all on function public.auth_can_access_operational_up3(uuid, uuid) from public, anon;
revoke all on function public.auth_can_access_operational_unit(uuid) from public, anon;
revoke all on function public.auth_can_access_operational_scope(uuid, uuid, uuid) from public, anon;
revoke all on function public.auth_can_read_employee(uuid) from public, anon;
revoke all on function public.auth_can_read_location(uuid) from public, anon;
grant execute on function public.auth_can_access_operational_up3(uuid, uuid) to authenticated;
grant execute on function public.auth_can_access_operational_unit(uuid) to authenticated;
grant execute on function public.auth_can_access_operational_scope(uuid, uuid, uuid) to authenticated;
grant execute on function public.auth_can_read_employee(uuid) to authenticated;
grant execute on function public.auth_can_read_location(uuid) to authenticated;

create policy employees_select_contract_scope
  on public.employees
  for select
  to authenticated
  using (public.auth_can_read_employee(id));

create policy employee_unit_history_select_contract_scope
  on public.employee_unit_history
  for select
  to authenticated
  using (
    public.auth_can_read_employee(employee_id)
    and public.auth_can_access_operational_scope(contract_id, up3_id, unit_id)
  );

create policy employee_position_history_select_contract_scope
  on public.employee_position_history
  for select
  to authenticated
  using (public.auth_can_read_employee(employee_id));

create policy employee_status_history_select_contract_scope
  on public.employee_status_history
  for select
  to authenticated
  using (public.auth_can_read_employee(employee_id));

create policy employee_work_location_history_select_contract_scope
  on public.employee_work_location_history
  for select
  to authenticated
  using (public.auth_can_read_employee(employee_id));

create policy employee_hourly_rate_history_select_contract_scope
  on public.employee_hourly_rate_history
  for select
  to authenticated
  using (public.auth_can_read_employee(employee_id));

create policy positions_select_contract_scope
  on public.positions
  for select
  to authenticated
  using (public.auth_can_access_operational_up3(contract_id, up3_id));

create policy locations_select_contract_scope
  on public.locations
  for select
  to authenticated
  using (public.auth_can_access_operational_scope(contract_id, up3_id, unit_id));

create policy location_name_history_select_contract_scope
  on public.location_name_history
  for select
  to authenticated
  using (public.auth_can_read_location(location_id));

-- The shared repository requests this RPC for every authenticated session.
-- Non-super users receive no bank/account values, preserving the existing
-- sensitive-field boundary while allowing their permitted non-sensitive reads.
create or replace function public.employee_sensitive_fields()
returns table (
  employee_id uuid,
  bank text,
  account_number text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authorized to read sensitive employee fields'
      using errcode = '42501';
  end if;

  if not public.auth_is_super_admin() then
    return;
  end if;

  return query
    select e.id, e.bank, e.account_number
    from public.employees e
    order by e.id;
end;
$$;
