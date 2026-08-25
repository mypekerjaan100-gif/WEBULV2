-- Super admins can operate the UP3 approval workflow and need the same canonical indicator metadata.
drop policy if exists sla_indicators_select_variable on public.sla_indicators;
create policy sla_indicators_select_variable
  on public.sla_indicators
  for select
  to authenticated
  using (
    public.auth_is_super_admin()
    or exists (
      select 1
      from public.sla_versions v
      where v.id = sla_indicators.sla_version_id
        and public.auth_can_access_operational_up3(v.contract_id, v.up3_id)
    )
  );
