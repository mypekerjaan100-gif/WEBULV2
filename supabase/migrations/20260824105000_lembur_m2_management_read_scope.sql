-- M2: Canonical server-side management READ scope resolver.
-- Reuses M1 hierarchy/mapping foundation; no UI changes; no mutation authority.
-- Roles: TEAM_LEADER, MANAGER_UNIT (Unit Layanan level), MANAGER_UP, ASMAN_OPERASI, ASMAN_KEUANGAN (UP Kal1 level).

-- 1) Management read helper (UUID-based, no name matching, no frontend scope).
create or replace function public.auth_can_read_management_overtime_scope(
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
  select auth.uid() is not null and (
    -- Unit Layanan level: TEAM_LEADER / MANAGER_UNIT direct mapping
    exists (
      select 1
      from public.organization_memberships m
      join public.internal_organization_units iou
        on iou.id = m.internal_org_unit_id
      join public.organization_contract_access oca
        on oca.internal_org_unit_id = iou.id
       and oca.status = 'ACTIVE'
       and oca.effective_from <= current_date
       and (oca.effective_to is null or current_date < oca.effective_to)
      where m.user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.effective_from <= current_date
        and (m.effective_to is null or current_date < m.effective_to)
        and iou.type = 'UL'
        and m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT')
        and oca.contract_id = p_contract_id
        and oca.operational_up3_id = p_up3_id
        and (oca.operational_unit_id is null or oca.operational_unit_id = p_unit_id)
    )
    or
    -- UP Kal1 level: MANAGER_UP / ASMAN_* descendant mapping (only explicit mapped ULs)
    exists (
      select 1
      from public.organization_memberships m
      join public.internal_organization_units up
        on up.id = m.internal_org_unit_id
      join public.internal_organization_units child
        on child.parent_id = up.id
       and child.type = 'UL'
      join public.organization_contract_access oca
        on oca.internal_org_unit_id = child.id
       and oca.status = 'ACTIVE'
       and oca.effective_from <= current_date
       and (oca.effective_to is null or current_date < oca.effective_to)
      where m.user_id = auth.uid()
        and m.status = 'ACTIVE'
        and m.effective_from <= current_date
        and (m.effective_to is null or current_date < m.effective_to)
        and up.type = 'UP'
        and m.organization_role in ('MANAGER_UP', 'ASMAN_OPERASI', 'ASMAN_KEUANGAN')
        and oca.contract_id = p_contract_id
        and oca.operational_up3_id = p_up3_id
        and (oca.operational_unit_id is null or oca.operational_unit_id = p_unit_id)
    )
  )
$$;

revoke all on function public.auth_can_read_management_overtime_scope(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.auth_can_read_management_overtime_scope(uuid, uuid, uuid) to authenticated;

comment on function public.auth_can_read_management_overtime_scope(uuid, uuid, uuid)
  is 'M2 management READ scope: UUID-based. UL roles direct, UP roles via descendant UL mappings. No mutation authority. Unmapped UL yields no scope.';

-- 2) Rewire canonical Lembur read scope to include management helper.
-- Preserves SUPER_ADMIN / ADMIN_UP3/ULP via auth_can_manage_overtime_scope.
create or replace function public.auth_can_read_overtime_evidence_scope(
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
  select auth.uid() is not null and (
    public.auth_can_manage_overtime_scope(p_contract_id, p_up3_id, p_unit_id)
    or public.auth_can_read_management_overtime_scope(p_contract_id, p_up3_id, p_unit_id)
  )
$$;

revoke all on function public.auth_can_read_overtime_evidence_scope(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.auth_can_read_overtime_evidence_scope(uuid, uuid, uuid) to authenticated;

comment on function public.auth_can_read_overtime_evidence_scope(uuid, uuid, uuid)
  is 'Canonical Lembur READ scope: manage (SUPER_ADMIN/ADMIN_UP3/ADMIN_ULP) OR management read (TEAM_LEADER/MANAGER_UNIT/MANAGER_UP/ASMAN_* via UUID hierarchy).';

-- 3) Scope listing helper for future M4 UI filtering (read-only, no mutation).
create or replace function public.list_management_overtime_read_scopes()
returns table(
  contract_id uuid,
  operational_up3_id uuid,
  operational_unit_id uuid,
  internal_ul_id uuid,
  internal_up_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Direct UL scopes
  select oca.contract_id, oca.operational_up3_id, oca.operational_unit_id, iou.id as internal_ul_id, iou.parent_id as internal_up_id
  from public.organization_memberships m
  join public.internal_organization_units iou on iou.id = m.internal_org_unit_id
  join public.organization_contract_access oca
    on oca.internal_org_unit_id = iou.id
   and oca.status = 'ACTIVE'
   and oca.effective_from <= current_date
   and (oca.effective_to is null or current_date < oca.effective_to)
  where m.user_id = auth.uid()
    and m.status = 'ACTIVE'
    and m.effective_from <= current_date
    and (m.effective_to is null or current_date < m.effective_to)
    and iou.type = 'UL'
    and m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT')
  union
  -- Descendant UL scopes via UP membership
  select oca.contract_id, oca.operational_up3_id, oca.operational_unit_id, child.id as internal_ul_id, up.id as internal_up_id
  from public.organization_memberships m
  join public.internal_organization_units up on up.id = m.internal_org_unit_id
  join public.internal_organization_units child on child.parent_id = up.id and child.type = 'UL'
  join public.organization_contract_access oca
    on oca.internal_org_unit_id = child.id
   and oca.status = 'ACTIVE'
   and oca.effective_from <= current_date
   and (oca.effective_to is null or current_date < oca.effective_to)
  where m.user_id = auth.uid()
    and m.status = 'ACTIVE'
    and m.effective_from <= current_date
    and (m.effective_to is null or current_date < m.effective_to)
    and up.type = 'UP'
    and m.organization_role in ('MANAGER_UP', 'ASMAN_OPERASI', 'ASMAN_KEUANGAN')
$$;

revoke all on function public.list_management_overtime_read_scopes() from public, anon, authenticated;
grant execute on function public.list_management_overtime_read_scopes() to authenticated;

comment on function public.list_management_overtime_read_scopes()
  is 'Lists explicit UUID-based management read scopes for current user (UL direct + UP descendant). Unmapped UL contributes no rows. Read-only.';

-- 4) Financial detail read (hourly rate / 1.5x/2x / Total) - READ ONLY, scoped by canonical read helper.
create or replace function public.list_overtime_entry_financial_l5(
  p_activity_id uuid
)
returns table(
  entry_id uuid,
  employee_id uuid,
  employee_name_snapshot text,
  hourly_rate_snapshot numeric,
  duration_hours_snapshot numeric,
  multiplier_hours_snapshot numeric,
  calculated_amount_snapshot numeric,
  participant_started_at timestamptz,
  participant_ended_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_activity from public.overtime_activities where id = p_activity_id;
  if not found then
    raise exception 'Activity not found' using errcode = '42501';
  end if;
  if not public.auth_can_read_overtime_evidence_scope(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to read financial detail' using errcode = '42501';
  end if;
  return query
    select e.id, e.employee_id, e.employee_name_snapshot, e.hourly_rate_snapshot, e.duration_hours_snapshot, e.multiplier_hours_snapshot, e.calculated_amount_snapshot, e.participant_started_at, e.participant_ended_at
    from public.overtime_entries e
    where e.activity_id = p_activity_id
    order by e.participant_started_at, e.id;
end;
$$;

revoke all on function public.list_overtime_entry_financial_l5(uuid) from public, anon, authenticated;
grant execute on function public.list_overtime_entry_financial_l5(uuid) to authenticated;

comment on function public.list_overtime_entry_financial_l5(uuid)
  is 'M2 financial READ: hourly_rate / duration / multiplier / calculated_amount snapshots per entry, authorized by canonical Lembur read scope (manage OR management). Read-only.';

-- 5) Ensure existing Lembur read RPCs remain wired to the updated canonical helper.
-- They already call auth_can_read_overtime_evidence_scope; no signature change needed.
-- Re-assert grants for clarity (no behavior change).
grant execute on function public.list_overtime_replacements_l2(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.list_overtime_work_l3(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.get_overtime_detail_l5(uuid) to authenticated;
grant execute on function public.list_overtime_history_l5(uuid) to authenticated;
grant execute on function public.list_overtime_evidence(uuid, boolean) to authenticated;
grant execute on function public.get_overtime_evidence_preview_path(uuid) to authenticated;
