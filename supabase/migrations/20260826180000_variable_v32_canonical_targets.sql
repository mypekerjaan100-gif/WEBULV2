-- Monthly operational targets remain in sla_targets and are shared by Variable Cost and SLA.
create or replace function public.guard_sla_target_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_version_id uuid;
  v_new_version_id uuid;
  v_status text;
  v_is_variable_standard boolean;
begin
  if tg_op = 'DELETE' then
    v_old_version_id := old.sla_version_id;
  elsif tg_op = 'INSERT' then
    v_new_version_id := new.sla_version_id;
  else
    v_old_version_id := old.sla_version_id;
    v_new_version_id := new.sla_version_id;
  end if;

  if v_old_version_id is not null then
    select status into v_status from public.sla_versions where id = v_old_version_id;
    if v_status = 'ARCHIVED' then raise exception 'ARCHIVED SLA targets are immutable'; end if;
    select old.target_scope = 'ULP' and exists (
      select 1 from public.sla_indicators i
      where i.id = old.indicator_id and i.sla_version_id = old.sla_version_id
        and i.input_mode = 'VARIABLE_COST' and i.variable_cost_profile = 'STANDARD'
        and i.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1a','3.1b','3.2a','3.2b')
    ) into v_is_variable_standard;
    if v_status = 'ACTIVE' and public.sla_version_is_referenced(v_old_version_id) and not v_is_variable_standard then
      raise exception 'Referenced ACTIVE SLA structure and targets are immutable; create a Draft Revision/Addendum';
    end if;
  end if;

  if v_new_version_id is not null then
    select status into v_status from public.sla_versions where id = v_new_version_id;
    if v_status = 'ARCHIVED' then raise exception 'ARCHIVED SLA targets are immutable'; end if;
    select new.target_scope = 'ULP' and exists (
      select 1 from public.sla_indicators i
      where i.id = new.indicator_id and i.sla_version_id = new.sla_version_id
        and i.input_mode = 'VARIABLE_COST' and i.variable_cost_profile = 'STANDARD'
        and i.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1a','3.1b','3.2a','3.2b')
    ) into v_is_variable_standard;
    if v_status = 'ACTIVE' and public.sla_version_is_referenced(v_new_version_id) and not v_is_variable_standard then
      raise exception 'Referenced ACTIVE SLA structure and targets are immutable; create a Draft Revision/Addendum';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_sla_targets_mutability on public.sla_targets;
create trigger trg_sla_targets_mutability
  before insert or update or delete on public.sla_targets
  for each row execute function public.guard_sla_target_mutation();

create or replace function public.set_variable_target(
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
  v_point_code text;
  v_input_mode text;
  v_profile text;
begin
  if not (
    public.auth_is_super_admin()
    or exists (
      select 1
      from public.contract_memberships cm
      where cm.user_id = auth.uid()
        and cm.contract_role = 'ADMIN_UP3'
        and cm.contract_id = p_contract_id
        and cm.operational_up3_id = p_up3_id
        and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date
        and (cm.effective_to is null or current_date < cm.effective_to)
    )
  ) then
    raise exception 'only ADMIN_UP3 can set target';
  end if;

  if not public.auth_can_access_variable_scope(p_contract_id, p_up3_id, p_unit_id) then
    raise exception 'access denied';
  end if;
  if not exists (
    select 1 from public.organization_units
    where id = p_unit_id and type = 'ULP' and parent_id = p_up3_id
  ) then
    raise exception 'unit_id must be a child ULP of up3_id';
  end if;
  if p_target_value is null or p_target_value < 0 then
    raise exception 'target_value invalid';
  end if;

  v_month := date_trunc('month', p_period_month::timestamp)::date;
  select status, period_start, period_end
    into v_version_status, v_period_start, v_period_end
  from public.sla_versions
  where id = p_sla_version_id
    and contract_id = p_contract_id
    and up3_id = p_up3_id;

  if v_version_status is distinct from 'ACTIVE' then
    raise exception 'target requires an ACTIVE SLA version in the same scope';
  end if;
  if v_month < date_trunc('month', v_period_start::timestamp)::date
     or v_month > date_trunc('month', v_period_end::timestamp)::date then
    raise exception 'period_month is outside the SLA version period';
  end if;

  select point_code, input_mode, variable_cost_profile
    into v_point_code, v_input_mode, v_profile
  from public.sla_indicators
  where id = p_indicator_id
    and sla_version_id = p_sla_version_id;

  if v_input_mode is distinct from 'VARIABLE_COST'
     or v_profile is distinct from 'STANDARD'
     or v_point_code not in ('2.1a','2.1b','2.1c','2.1d','3.1a','3.1b','3.2a','3.2b') then
    raise exception 'target is only available for standard Variable Cost indicators';
  end if;

  insert into public.sla_targets (
    contract_id, up3_id, unit_id, sla_version_id, indicator_id,
    period_month, target_scope, target_value, created_by, updated_by
  ) values (
    p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id,
    v_month, 'ULP', p_target_value, auth.uid(), auth.uid()
  )
  on conflict (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month)
    where target_scope = 'ULP' and unit_id is not null
  do update set target_value = excluded.target_value, updated_by = auth.uid()
  returning * into v_row;

  perform public.sync_variable_cost_month(
    p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id, v_month
  );
  return v_row;
end;
$$;

revoke execute on function public.set_variable_target(uuid,uuid,uuid,uuid,uuid,date,numeric) from public, anon;
grant execute on function public.set_variable_target(uuid,uuid,uuid,uuid,uuid,date,numeric) to authenticated;
