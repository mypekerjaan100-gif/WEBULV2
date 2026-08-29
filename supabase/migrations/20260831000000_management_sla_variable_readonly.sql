-- Management read-only for SLA and Variable Cost via existing management scope resolver
-- TEAM_LEADER / MANAGER_UNIT -> UL -> UP3 mapping, MANAGER_UP / ASMAN_* -> UP -> UL -> UP3
-- No mutation, only SELECT

-- Helper to check management read scope already exists: auth_can_read_management_overtime_scope
-- Reuse it for SLA/Variable; it checks organization_contract_access mapping.

-- SLA entries (variable aggregate and manual)
drop policy if exists "sla_entries_select_management" on public.sla_entries;
create policy "sla_entries_select_management" on public.sla_entries for select to authenticated using (
  public.auth_can_read_management_overtime_scope(contract_id, up3_id, unit_id)
  or public.auth_can_read_management_overtime_scope(contract_id, up3_id, null)
);

-- SLA targets (ULP targets)
drop policy if exists "sla_targets_select_management" on public.sla_targets;
create policy "sla_targets_select_management" on public.sla_targets for select to authenticated using (
  public.auth_can_read_management_overtime_scope(contract_id, up3_id, coalesce(unit_id, up3_id))
  or public.auth_can_read_management_overtime_scope(contract_id, up3_id, null)
);

-- SLA indicators (via version)
drop policy if exists "sla_indicators_select_management" on public.sla_indicators;
create policy "sla_indicators_select_management" on public.sla_indicators for select to authenticated using (
  exists (
    select 1 from public.sla_versions v
    where v.id = sla_indicators.sla_version_id
      and public.auth_can_read_management_overtime_scope(v.contract_id, v.up3_id, null)
  )
);

-- SLA versions
drop policy if exists "sla_versions_select_management" on public.sla_versions;
create policy "sla_versions_select_management" on public.sla_versions for select to authenticated using (
  public.auth_can_read_management_overtime_scope(contract_id, up3_id, null)
);

-- Variable cost entries
drop policy if exists "variable_entries_select_management" on public.variable_cost_entries;
create policy "variable_entries_select_management" on public.variable_cost_entries for select to authenticated using (
  public.auth_can_read_management_overtime_scope(contract_id, up3_id, unit_id)
);

-- Variable cost entry personnel (join via entry)
drop policy if exists "variable_personnel_select_management" on public.variable_cost_entry_personnel;
create policy "variable_personnel_select_management" on public.variable_cost_entry_personnel for select to authenticated using (
  exists (
    select 1 from public.variable_cost_entries e
    where e.id = variable_cost_entry_personnel.variable_cost_entry_id
      and public.auth_can_read_management_overtime_scope(e.contract_id, e.up3_id, e.unit_id)
  )
);

-- Variable cost evidence metadata
drop policy if exists "variable_evidence_select_management" on public.variable_cost_evidence;
create policy "variable_evidence_select_management" on public.variable_cost_evidence for select to authenticated using (
  exists (
    select 1 from public.variable_cost_entries e
    where e.id = variable_cost_evidence.variable_cost_entry_id
      and public.auth_can_read_management_overtime_scope(e.contract_id, e.up3_id, e.unit_id)
  )
);

-- Feeders
drop policy if exists "feeders_select_management" on public.feeders;
create policy "feeders_select_management" on public.feeders for select to authenticated using (
  public.auth_can_read_management_overtime_scope(contract_id, up3_id, unit_id)
  or public.auth_can_read_management_overtime_scope(contract_id, up3_id, null)
);

-- Variable cost status history (for detail)
drop policy if exists "variable_status_history_select_management" on public.variable_cost_status_history;
create policy "variable_status_history_select_management" on public.variable_cost_status_history for select to authenticated using (
  exists (
    select 1 from public.variable_cost_entries e
    where e.id = variable_cost_status_history.variable_cost_entry_id
      and public.auth_can_read_management_overtime_scope(e.contract_id, e.up3_id, e.unit_id)
  )
);

-- Storage evidence read for management (reuse existing function but add management check)
-- auth_can_read_variable_evidence_object already checks variable scope; extend to also allow management
create or replace function public.auth_can_read_variable_evidence_object(p_storage_path text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_entry_id uuid;
  v_filename text;
  v_parts text[];
begin
  if auth.uid() is null then return false; end if;
  if exists (
    select 1 from public.variable_cost_evidence ev
    join public.variable_cost_entries e on e.id = ev.variable_cost_entry_id
    where ev.storage_path = p_storage_path
      and (public.auth_can_access_variable_scope(e.contract_id, e.up3_id, e.unit_id)
        or public.auth_can_read_management_overtime_scope(e.contract_id, e.up3_id, e.unit_id))
  ) then return true; end if;
  v_parts := string_to_array(p_storage_path, '/');
  if array_length(v_parts, 1) = 5 and v_parts[1] = 'variable' then
    begin
      v_filename := v_parts[5];
      v_entry_id := substring(v_filename from 1 for 36)::uuid;
      return exists (
        select 1 from public.variable_cost_entries e
        where e.id = v_entry_id
          and (public.auth_can_access_variable_scope(e.contract_id, e.up3_id, e.unit_id)
            or public.auth_can_read_management_overtime_scope(e.contract_id, e.up3_id, e.unit_id))
      );
    exception when others then
      return false;
    end;
  end if;
  return false;
end;
$$;
