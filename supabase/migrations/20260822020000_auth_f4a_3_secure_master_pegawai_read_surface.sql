-- AUTH-F4A.3: Bootstrap-safe Master Pegawai read surface for SUPER_ADMIN.

-- Reference tables are readable only when the authenticated session is SUPER_ADMIN.
drop policy if exists locations_select_auth on public.locations;
create policy locations_select_super_admin
  on public.locations
  for select
  to authenticated
  using (public.auth_is_super_admin());

drop policy if exists positions_select_auth on public.positions;
create policy positions_select_super_admin
  on public.positions
  for select
  to authenticated
  using (public.auth_is_super_admin());

grant select on table public.locations to authenticated;
grant select on table public.positions to authenticated;
revoke select on table public.locations from anon, public;
revoke select on table public.positions from anon, public;

-- Employee rows are bootstrap-restricted to SUPER_ADMIN.
drop policy if exists employee_select_auth on public.employees;
create policy employee_select_super_admin
  on public.employees
  for select
  to authenticated
  using (public.auth_is_super_admin());

-- Do not expose bank/account_number through the normal employee table query.
revoke select on table public.employees from authenticated, anon, public;
grant select (
  id,
  nip,
  name,
  birth_date,
  source_position,
  retirement_date_override,
  pension_override_reason,
  created_at
) on public.employees to authenticated;
revoke select (bank, account_number) on public.employees from authenticated, anon, public;

-- Employee history reads use the same bootstrap SUPER_ADMIN authority.
drop policy if exists employee_unit_history_select_auth on public.employee_unit_history;
create policy employee_unit_history_select_super_admin
  on public.employee_unit_history
  for select
  to authenticated
  using (public.auth_is_super_admin());

drop policy if exists employee_position_history_select_auth on public.employee_position_history;
create policy employee_position_history_select_super_admin
  on public.employee_position_history
  for select
  to authenticated
  using (public.auth_is_super_admin());

drop policy if exists employee_status_history_select_auth on public.employee_status_history;
create policy employee_status_history_select_super_admin
  on public.employee_status_history
  for select
  to authenticated
  using (public.auth_is_super_admin());

drop policy if exists employee_work_location_history_select_auth on public.employee_work_location_history;
create policy employee_work_location_history_select_super_admin
  on public.employee_work_location_history
  for select
  to authenticated
  using (public.auth_is_super_admin());

drop policy if exists employee_hourly_rate_history_select_auth on public.employee_hourly_rate_history;
create policy employee_hourly_rate_history_select_super_admin
  on public.employee_hourly_rate_history
  for select
  to authenticated
  using (public.auth_is_super_admin());

grant select on table public.employee_unit_history to authenticated;
grant select on table public.employee_position_history to authenticated;
grant select on table public.employee_status_history to authenticated;
grant select on table public.employee_work_location_history to authenticated;
grant select on table public.employee_hourly_rate_history to authenticated;

revoke select on table public.employee_unit_history from anon, public;
revoke select on table public.employee_position_history from anon, public;
revoke select on table public.employee_status_history from anon, public;
revoke select on table public.employee_work_location_history from anon, public;
revoke select on table public.employee_hourly_rate_history from anon, public;

-- Sensitive employee fields are available only through this SUPER_ADMIN RPC.
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
  if auth.uid() is null or not public.auth_is_super_admin() then
    raise exception 'Not authorized to read sensitive employee fields'
      using errcode = '42501';
  end if;

  return query
    select e.id, e.bank, e.account_number
    from public.employees e
    order by e.id;
end;
$$;

revoke all on function public.employee_sensitive_fields() from public, anon;
grant execute on function public.employee_sensitive_fields() to authenticated;
