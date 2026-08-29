-- Canonical management operational authority through explicit UUID mappings.

create or replace function public.auth_has_management_operational_scope(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.organization_memberships m
    join public.internal_organization_units assigned
      on assigned.id = m.internal_org_unit_id
     and assigned.status = 'ACTIVE'
    join public.internal_organization_units mapped_ul
      on mapped_ul.status = 'ACTIVE'
     and mapped_ul.type = 'UL'
     and (
       (m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT') and assigned.type = 'UL' and mapped_ul.id = assigned.id)
       or
       (m.organization_role in ('MANAGER_UP', 'ASMAN_OPERASI', 'ASMAN_KEUANGAN') and assigned.type = 'UP' and mapped_ul.parent_id = assigned.id)
     )
    join public.organization_contract_access oca
      on oca.internal_org_unit_id = mapped_ul.id
     and oca.status = 'ACTIVE'
     and oca.effective_from <= current_date
     and (oca.effective_to is null or current_date < oca.effective_to)
    where m.user_id = auth.uid()
      and m.status = 'ACTIVE'
      and m.effective_from <= current_date
      and (m.effective_to is null or current_date < m.effective_to)
      and m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT', 'MANAGER_UP', 'ASMAN_OPERASI', 'ASMAN_KEUANGAN')
      and oca.contract_id = p_contract_id
      and oca.operational_up3_id = p_up3_id
      and (
        p_unit_id is null
        or oca.operational_unit_id is null
        or oca.operational_unit_id = p_unit_id
      )
      and (
        p_unit_id is null
        or exists (
          select 1
          from public.organization_units ou
          where ou.id = p_unit_id
            and ou.type = 'ULP'
            and ou.parent_id = p_up3_id
            and ou.own_status = 'Aktif'
        )
      )
  )
$$;

revoke all on function public.auth_has_management_operational_scope(uuid, uuid, uuid) from public, anon;
grant execute on function public.auth_has_management_operational_scope(uuid, uuid, uuid) to authenticated;

create or replace function public.auth_can_manage_up3_operations(p_contract_id uuid, p_up3_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.auth_is_super_admin()
  or exists (
    select 1
    from public.contract_memberships cm
    where cm.user_id = auth.uid()
      and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date
      and (cm.effective_to is null or current_date < cm.effective_to)
      and cm.contract_id = p_contract_id
      and cm.operational_up3_id = p_up3_id
      and cm.contract_role = 'ADMIN_UP3'
  )
  or public.auth_has_management_operational_scope(p_contract_id, p_up3_id, null)
$$;

create or replace function public.auth_can_manage_pelayanan_teknik_scope(
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
  select public.auth_is_super_admin()
  or exists (
    select 1
    from public.contract_memberships cm
    where cm.user_id = auth.uid()
      and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date
      and (cm.effective_to is null or current_date < cm.effective_to)
      and cm.contract_id = p_contract_id
      and cm.operational_up3_id = p_up3_id
      and cm.contract_role = 'ADMIN_UP3'
  )
  or public.auth_has_management_operational_scope(p_contract_id, p_up3_id, p_unit_id)
$$;

revoke all on function public.auth_can_manage_pelayanan_teknik_scope(uuid, uuid, uuid) from public, anon;
grant execute on function public.auth_can_manage_pelayanan_teknik_scope(uuid, uuid, uuid) to authenticated;

create or replace function public.auth_can_access_operational_up3(p_contract_id uuid, p_up3_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
  )
$$;

create or replace function public.auth_can_access_operational_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
  )
$$;

create or replace function public.auth_can_access_variable_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.auth_is_super_admin()
  or public.auth_can_access_operational_scope(p_contract_id, p_up3_id, p_unit_id)
$$;

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
  select public.auth_has_management_operational_scope(p_contract_id, p_up3_id, p_unit_id)
$$;

create or replace function public.list_management_operational_scopes()
returns table(
  contract_id uuid,
  contract_code text,
  operational_up3_id uuid,
  operational_unit_id uuid,
  internal_ul_id uuid,
  internal_ul_name text,
  internal_up_id uuid,
  internal_up_name text,
  organization_role text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct
    oca.contract_id,
    c.code,
    oca.operational_up3_id,
    oca.operational_unit_id,
    mapped_ul.id,
    mapped_ul.name,
    parent_up.id,
    parent_up.name,
    m.organization_role
  from public.organization_memberships m
  join public.internal_organization_units assigned
    on assigned.id = m.internal_org_unit_id
   and assigned.status = 'ACTIVE'
  join public.internal_organization_units mapped_ul
    on mapped_ul.status = 'ACTIVE'
   and mapped_ul.type = 'UL'
   and (
     (m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT') and assigned.type = 'UL' and mapped_ul.id = assigned.id)
     or
     (m.organization_role in ('MANAGER_UP', 'ASMAN_OPERASI', 'ASMAN_KEUANGAN') and assigned.type = 'UP' and mapped_ul.parent_id = assigned.id)
   )
  join public.internal_organization_units parent_up
    on parent_up.id = mapped_ul.parent_id
   and parent_up.type = 'UP'
   and parent_up.status = 'ACTIVE'
  join public.organization_contract_access oca
    on oca.internal_org_unit_id = mapped_ul.id
   and oca.status = 'ACTIVE'
   and oca.effective_from <= current_date
   and (oca.effective_to is null or current_date < oca.effective_to)
  join public.contracts c on c.id = oca.contract_id and c.status = 'active'
  where m.user_id = auth.uid()
    and m.status = 'ACTIVE'
    and m.effective_from <= current_date
    and (m.effective_to is null or current_date < m.effective_to)
    and m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT', 'MANAGER_UP', 'ASMAN_OPERASI', 'ASMAN_KEUANGAN')
$$;

revoke all on function public.list_management_operational_scopes() from public, anon;
grant execute on function public.list_management_operational_scopes() to authenticated;

drop policy if exists "organization_contract_access_select_authenticated" on public.organization_contract_access;
revoke select on public.organization_contract_access from authenticated;

create or replace function public.set_manual_sla_target(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_sla_version_id uuid,
  p_indicator_id uuid,
  p_period_month date,
  p_target_value numeric
)
returns public.sla_targets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.sla_targets%rowtype;
  v_month date;
  v_version_status text;
  v_period_start date;
  v_period_end date;
  v_input_mode text;
  v_point_code text;
begin
  if not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, p_unit_id) then
    raise exception 'not authorized to set manual SLA target';
  end if;
  if not exists (select 1 from public.organization_units where id = p_unit_id and type = 'ULP' and parent_id = p_up3_id) then raise exception 'unit_id must be a child ULP of up3_id'; end if;
  if p_target_value is null or p_target_value < 0 then raise exception 'target_value invalid'; end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;
  select status, period_start, period_end into v_version_status, v_period_start, v_period_end
  from public.sla_versions where id = p_sla_version_id and contract_id = p_contract_id and up3_id = p_up3_id;
  if v_version_status is distinct from 'ACTIVE' then raise exception 'manual target requires an ACTIVE SLA version in the same scope'; end if;
  if v_month < date_trunc('month', v_period_start::timestamp)::date or v_month > date_trunc('month', v_period_end::timestamp)::date then raise exception 'period_month is outside the SLA version period'; end if;
  select input_mode, point_code into v_input_mode, v_point_code from public.sla_indicators where id = p_indicator_id and sla_version_id = p_sla_version_id;
  if v_input_mode is null then raise exception 'indicator not found in version'; end if;
  if v_input_mode = 'VARIABLE_COST' and v_point_code in ('2.1a','2.1b','2.1c','2.1d','3.1a','3.1b','3.2a','3.2b') then raise exception 'Variable-linked target is read-only in SLA; manage via Variable Cost'; end if;
  if v_point_code = '3.1c' then raise exception 'Konstruksi target not allowed in SLA'; end if;
  if v_input_mode != 'MANUAL' then raise exception 'manual target requires MANUAL indicator'; end if;
  insert into public.sla_targets (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month, target_scope, target_value, created_by, updated_by)
  values (p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id, v_month, 'ULP', p_target_value, auth.uid(), auth.uid())
  on conflict (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month) where target_scope='ULP' and unit_id is not null
  do update set target_value = excluded.target_value, updated_by = auth.uid() returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.auth_can_review_overtime_l5(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, p_unit_id)
$$;

revoke all on function public.auth_can_review_overtime_l5(uuid, uuid, uuid) from public, anon;
grant execute on function public.auth_can_review_overtime_l5(uuid, uuid, uuid) to authenticated;

create or replace function public.approve_overtime_l5(p_activity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_activity public.overtime_activities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_activity from public.overtime_activities where id=p_activity_id for update;
  if not found then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then raise exception 'Not authorized to approve in this UP3' using errcode='42501'; end if;
  if v_activity.status <> 'SUBMITTED' then raise exception 'Only submitted overtime can be approved'; end if;
  update public.overtime_activities set status='APPROVED', approved_at=clock_timestamp(), approved_by=auth.uid(), updated_by=auth.uid(), closed_at=null, closure_reason=null where id=p_activity_id;
  insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status) values (p_activity_id,'APPROVED',auth.uid(),v_activity.status,'APPROVED');
  return p_activity_id;
end;
$$;

create or replace function public.reject_overtime_l5(p_activity_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_activity public.overtime_activities%rowtype; v_reason text; v_deadline timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_reason:=btrim(coalesce(p_reason,''));
  if v_reason='' then raise exception 'Reject reason is required'; end if;
  select * into v_activity from public.overtime_activities where id=p_activity_id for update;
  if not found then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then raise exception 'Not authorized to reject in this UP3' using errcode='42501'; end if;
  if v_activity.status <> 'SUBMITTED' then raise exception 'Only submitted overtime can be rejected'; end if;
  if v_activity.rejection_count >= 3 then raise exception 'Maximum rejections reached'; end if;
  v_deadline := ((now() at time zone 'Asia/Pontianak')::date + 3 + time '23:59:59.999999') at time zone 'Asia/Pontianak';
  if v_activity.rejection_count = 0 then
    update public.overtime_activities set status='CORRECTION_REQUIRED', rejection_count=1, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), revision_deadline_at=v_deadline, updated_by=auth.uid() where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number) values (p_activity_id,'REJECTED',auth.uid(),v_activity.status,'CORRECTION_REQUIRED',v_reason,1);
  elsif v_activity.rejection_count = 1 then
    update public.overtime_activities set status='CORRECTION_REQUIRED', rejection_count=2, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), revision_deadline_at=v_deadline, updated_by=auth.uid() where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number) values (p_activity_id,'REJECTED',auth.uid(),v_activity.status,'CORRECTION_REQUIRED',v_reason,2);
  else
    update public.overtime_activities set status='CLOSED', closure_reason='FINAL_REJECTED', rejection_count=3, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), closed_at=clock_timestamp(), closed_by=auth.uid(), updated_by=auth.uid(), revision_deadline_at=null where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number) values (p_activity_id,'CLOSED',auth.uid(),v_activity.status,'CLOSED',v_reason,3);
  end if;
  return p_activity_id;
end;
$$;

-- Existing Variable Cost and feeder RPCs call the two-argument capability.
-- Explicit Unit Layanan mappings resolve to an operational UP3 and therefore its child ULPs.
