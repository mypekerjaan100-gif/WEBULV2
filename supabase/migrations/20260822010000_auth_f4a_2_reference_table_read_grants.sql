-- AUTH-F4A.2: Restore authenticated reference-table reads before RLS evaluation.

grant select on table public.contracts to authenticated;
grant select on table public.contract_up3_scopes to authenticated;
grant select on table public.organization_units to authenticated;
grant select on table public.organization_name_history to authenticated;

revoke select on table public.contracts from anon, public;
revoke select on table public.contract_up3_scopes from anon, public;
revoke select on table public.organization_units from anon, public;
revoke select on table public.organization_name_history from anon, public;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_name_history'
      and policyname = 'organization_name_history_select_auth'
  ) then
    create policy organization_name_history_select_auth
      on public.organization_name_history
      for select
      to authenticated
      using (public.auth_has_permission('organization.read'));
  end if;
end
$$;
