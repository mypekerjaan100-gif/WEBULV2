-- TEAM_LEADER >= ADMIN_UP3 within mapped operational scope
-- Keep canonical role = TEAM_LEADER, reuse capability via helper

create or replace function public.auth_is_team_leader_for_up3(p_contract_id uuid, p_up3_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public','pg_temp'
as $$
  select exists (
    select 1
    from public.organization_memberships m
    join public.internal_organization_units iou on iou.id = m.internal_org_unit_id
    join public.organization_contract_access oca on oca.internal_org_unit_id = iou.id
      and oca.status = 'ACTIVE'
      and oca.effective_from <= current_date
      and (oca.effective_to is null or current_date < oca.effective_to)
    where m.user_id = auth.uid()
      and m.status = 'ACTIVE'
      and m.effective_from <= current_date
      and (m.effective_to is null or current_date < m.effective_to)
      and iou.type = 'UL'
      and m.organization_role = 'TEAM_LEADER'
      and oca.contract_id = p_contract_id
      and oca.operational_up3_id = p_up3_id
  )
$$;

create or replace function public.auth_can_manage_up3_operations(p_contract_id uuid, p_up3_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public','pg_temp'
as $$
  select public.auth_is_super_admin()
  or exists (
    select 1 from public.contract_memberships cm
    where cm.user_id = auth.uid()
      and cm.status = 'ACTIVE'
      and cm.effective_from <= current_date
      and (cm.effective_to is null or cm.effective_to > current_date)
      and cm.contract_id = p_contract_id
      and cm.operational_up3_id = p_up3_id
      and cm.contract_role = 'ADMIN_UP3'
  )
  or public.auth_is_team_leader_for_up3(p_contract_id, p_up3_id)
$$;

-- Extend operational UP3 access to include TEAM_LEADER for read/management
create or replace function public.auth_can_access_operational_up3(p_contract_id uuid, p_up3_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public','pg_temp'
as $$
  select auth.uid() is not null
    and (
      exists (
        select 1
        from public.contract_memberships cm
        join public.contracts c on c.id = cm.contract_id and c.status = 'active'
        join public.contract_up3_scopes cus on cus.contract_id = cm.contract_id and cus.up3_id = cm.operational_up3_id and cus.status = 'Aktif'
        where cm.user_id = auth.uid()
          and cm.status = 'ACTIVE'
          and cm.effective_from <= current_date
          and (cm.effective_to is null or cm.effective_to > current_date)
          and cm.contract_id = p_contract_id
          and cm.operational_up3_id = p_up3_id
          and cm.contract_role in ('ADMIN_UP3', 'ADMIN_ULP')
      )
      or public.auth_is_team_leader_for_up3(p_contract_id, p_up3_id)
    )
$$;

-- Extend variable scope to TEAM_LEADER (any child ULP under mapped UP3)
create or replace function public.auth_can_access_operational_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public','pg_temp'
as $$
  select public.auth_can_access_operational_up3(p_contract_id, p_up3_id)
    and (
      exists (
        select 1
        from public.contract_memberships cm
        where cm.user_id = auth.uid()
          and cm.status = 'ACTIVE'
          and cm.effective_from <= current_date
          and (cm.effective_to is null or cm.effective_to > current_date)
          and cm.contract_id = p_contract_id
          and cm.operational_up3_id = p_up3_id
          and (
            (cm.contract_role = 'ADMIN_ULP' and cm.operational_unit_id = p_unit_id)
            or (cm.contract_role = 'ADMIN_UP3' and public.auth_can_access_operational_unit(p_unit_id))
          )
      )
      or public.auth_is_team_leader_for_up3(p_contract_id, p_up3_id)
    )
$$;

-- Update variable scope to also allow TEAM_LEADER
create or replace function public.auth_can_access_variable_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public','pg_temp'
as $$
  select public.auth_is_super_admin()
  or public.auth_can_access_operational_scope(p_contract_id, p_up3_id, p_unit_id)
  or public.auth_is_team_leader_for_up3(p_contract_id, p_up3_id)
$$;

-- Update approve/reject variable to allow TEAM_LEADER
create or replace function public.approve_variable_cost_entry(p_entry_id uuid)
returns variable_cost_entries
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.variable_cost_entries%rowtype;
begin
  select * into v_row from public.variable_cost_entries where id=p_entry_id for update;
  if not found then raise exception 'entry not found'; end if;
  if not (public.auth_is_super_admin() or public.auth_can_manage_up3_operations(v_row.contract_id, v_row.up3_id)) then raise exception 'only ADMIN_UP3 can approve'; end if;
  if v_row.status <> 'SUBMITTED' then raise exception 'only SUBMITTED can be approved'; end if;
  update public.variable_cost_entries set status='APPROVED', approved_at=now(), approved_by=auth.uid(), updated_by=auth.uid() where id=p_entry_id returning * into v_row;
  insert into public.variable_cost_status_history (variable_cost_entry_id, from_status, to_status, changed_by) values (p_entry_id, 'SUBMITTED', 'APPROVED', auth.uid());
  perform public.sync_variable_cost_month(v_row.contract_id, v_row.up3_id, v_row.unit_id, v_row.sla_version_id, v_row.indicator_id, date_trunc('month', v_row.work_date)::date);
  return v_row;
end;
$$;

create or replace function public.reject_variable_cost_entry(p_entry_id uuid, p_reason text)
returns variable_cost_entries
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.variable_cost_entries%rowtype;
begin
  if p_reason is null or btrim(p_reason)='' then raise exception 'rejection_reason required'; end if;
  select * into v_row from public.variable_cost_entries where id=p_entry_id for update;
  if not found then raise exception 'entry not found'; end if;
  if not (public.auth_is_super_admin() or public.auth_can_manage_up3_operations(v_row.contract_id, v_row.up3_id)) then raise exception 'only ADMIN_UP3 can reject'; end if;
  if v_row.status <> 'SUBMITTED' then raise exception 'only SUBMITTED can be rejected'; end if;
  update public.variable_cost_entries set status='REJECTED', rejected_at=now(), rejected_by=auth.uid(), rejection_reason=btrim(p_reason), updated_by=auth.uid() where id=p_entry_id returning * into v_row;
  insert into public.variable_cost_status_history (variable_cost_entry_id, from_status, to_status, changed_by, reason) values (p_entry_id, 'SUBMITTED', 'REJECTED', auth.uid(), btrim(p_reason));
  return v_row;
end;
$$;

create or replace function public.set_variable_target(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_sla_version_id uuid, p_indicator_id uuid, p_period_month date, p_target_value numeric)
returns sla_targets
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_row public.sla_targets%rowtype;
  v_month date;
  v_version_status text;
  v_period_start date;
  v_period_end date;
  v_point_code text;
  v_input_mode text;
  v_profile text;
begin
  if not (public.auth_is_super_admin() or public.auth_can_manage_up3_operations(p_contract_id, p_up3_id)) then raise exception 'only ADMIN_UP3 can set target'; end if;
  if not public.auth_can_access_variable_scope(p_contract_id, p_up3_id, p_unit_id) then raise exception 'access denied'; end if;
  if not exists (select 1 from public.organization_units where id = p_unit_id and type = 'ULP' and parent_id = p_up3_id) then raise exception 'unit_id must be a child ULP of up3_id'; end if;
  if p_target_value is null or p_target_value < 0 then raise exception 'target_value invalid'; end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;
  select status, period_start, period_end into v_version_status, v_period_start, v_period_end from public.sla_versions where id = p_sla_version_id and contract_id = p_contract_id and up3_id = p_up3_id;
  if v_version_status is distinct from 'ACTIVE' then raise exception 'target requires an ACTIVE SLA version in the same scope'; end if;
  if v_month < date_trunc('month', v_period_start::timestamp)::date or v_month > date_trunc('month', v_period_end::timestamp)::date then raise exception 'period_month is outside the SLA version period'; end if;
  select point_code, input_mode, variable_cost_profile into v_point_code, v_input_mode, v_profile from public.sla_indicators where id = p_indicator_id and sla_version_id = p_sla_version_id;
  if v_input_mode is distinct from 'VARIABLE_COST' or v_profile is distinct from 'STANDARD' or v_point_code not in ('2.1a','2.1b','2.1c','2.1d','3.1a','3.1b','3.2a','3.2b') then raise exception 'target is only available for standard Variable Cost indicators'; end if;
  insert into public.sla_targets (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month, target_scope, target_value, created_by, updated_by)
  values (p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id, v_month, 'ULP', p_target_value, auth.uid(), auth.uid())
  on conflict (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month) where target_scope = 'ULP' and unit_id is not null
  do update set target_value = excluded.target_value, updated_by = auth.uid() returning * into v_row;
  perform public.sync_variable_cost_month(p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id, v_month);
  return v_row;
end;
$$;

-- Feeders
create or replace function public.create_feeder_direct(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_name text, p_code text default null)
returns feeders
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.feeders%rowtype;
begin
  if not (public.auth_is_super_admin() or public.auth_can_manage_up3_operations(p_contract_id, p_up3_id)) then raise exception 'only ADMIN_UP3 or SUPER_ADMIN can create direct feeder'; end if;
  if not public.auth_can_access_variable_scope(p_contract_id, p_up3_id, p_unit_id) then raise exception 'access denied'; end if;
  insert into public.feeders (contract_id, up3_id, unit_id, name, code, status, proposed_by, proposed_at, reviewed_by, reviewed_at, created_by, updated_by) values (p_contract_id, p_up3_id, p_unit_id, btrim(p_name), nullif(btrim(p_code),''), 'ACTIVE', auth.uid(), now(), auth.uid(), now(), auth.uid(), auth.uid()) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.approve_feeder(p_feeder_id uuid)
returns feeders
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.feeders%rowtype;
begin
  select * into v_row from public.feeders where id=p_feeder_id for update;
  if not found then raise exception 'feeder not found'; end if;
  if not (public.auth_is_super_admin() or public.auth_can_manage_up3_operations(v_row.contract_id, v_row.up3_id)) then raise exception 'only ADMIN_UP3 can approve'; end if;
  if v_row.status <> 'PENDING' then raise exception 'only PENDING can be approved'; end if;
  update public.feeders set status='ACTIVE', reviewed_by=auth.uid(), reviewed_at=now(), updated_by=auth.uid(), rejection_reason=null where id=p_feeder_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.reject_feeder(p_feeder_id uuid, p_reason text)
returns feeders
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.feeders%rowtype;
begin
  if p_reason is null or btrim(p_reason)='' then raise exception 'rejection_reason required'; end if;
  select * into v_row from public.feeders where id=p_feeder_id for update;
  if not found then raise exception 'feeder not found'; end if;
  if not (public.auth_is_super_admin() or public.auth_can_manage_up3_operations(v_row.contract_id, v_row.up3_id)) then raise exception 'only ADMIN_UP3 can reject'; end if;
  if v_row.status <> 'PENDING' then raise exception 'only PENDING can be rejected'; end if;
  update public.feeders set status='REJECTED', reviewed_by=auth.uid(), reviewed_at=now(), updated_by=auth.uid(), rejection_reason=btrim(p_reason) where id=p_feeder_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.deactivate_feeder(p_feeder_id uuid)
returns feeders
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.feeders%rowtype;
begin
  select * into v_row from public.feeders where id=p_feeder_id for update;
  if not found then raise exception 'feeder not found'; end if;
  if not (public.auth_is_super_admin() or public.auth_can_manage_up3_operations(v_row.contract_id, v_row.up3_id)) then raise exception 'only ADMIN_UP3 can deactivate'; end if;
  if v_row.status <> 'ACTIVE' then raise exception 'only ACTIVE can be deactivated'; end if;
  update public.feeders set status='INACTIVE', updated_by=auth.uid() where id=p_feeder_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.activate_feeder(p_feeder_id uuid)
returns feeders
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.feeders%rowtype;
begin
  select * into v_row from public.feeders where id=p_feeder_id for update;
  if not found then raise exception 'feeder not found'; end if;
  if not (public.auth_is_super_admin() or public.auth_can_manage_up3_operations(v_row.contract_id, v_row.up3_id)) then raise exception 'only ADMIN_UP3 can activate'; end if;
  if v_row.status <> 'INACTIVE' then raise exception 'only INACTIVE can be activated'; end if;
  update public.feeders set status='ACTIVE', updated_by=auth.uid() where id=p_feeder_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.delete_feeder(p_feeder_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.feeders%rowtype;
begin
  select * into v_row from public.feeders where id=p_feeder_id for update;
  if not found then raise exception 'feeder not found'; end if;
  if not (public.auth_is_super_admin() or public.auth_can_manage_up3_operations(v_row.contract_id, v_row.up3_id)) then raise exception 'only ADMIN_UP3 can delete'; end if;
  if exists (select 1 from public.variable_cost_entries where feeder_id = p_feeder_id) then raise exception 'feeder already referenced, deactivate instead'; end if;
  delete from public.feeders where id=p_feeder_id;
end;
$$;

-- Lembur review
create or replace function public.auth_can_review_overtime_l5(p_contract_id uuid, p_up3_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public','pg_temp'
as $$
  select public.auth_is_super_admin()
  or public.auth_can_manage_up3_operations(p_contract_id, p_up3_id)
$$;

