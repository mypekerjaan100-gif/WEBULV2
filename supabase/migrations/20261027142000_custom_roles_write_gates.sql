-- Penjagaan tulis untuk role custom: edit menu tidak otomatis membuka
-- persetujuan, master, atau aksi khusus Admin.

create or replace function public.save_manual_sla_entry(
  p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_sla_version_id uuid,
  p_indicator_id uuid, p_period_month date, p_measurement_unit text,
  p_work_order numeric, p_realization numeric, p_achievement numeric
)
returns public.sla_entries
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.sla_entries%rowtype;
  v_month date;
  v_period_start date;
  v_period_end date;
  v_indicator public.sla_indicators%rowtype;
  v_target numeric(18,4);
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid() and cm.contract_role = 'ADMIN_ULP'
        and cm.contract_id = p_contract_id
        and cm.operational_up3_id = p_up3_id
        and cm.operational_unit_id = p_unit_id
        and cm.status = 'ACTIVE' and cm.effective_from <= current_date
        and (cm.effective_to is null or current_date < cm.effective_to)
    )
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'sla.manage')
  ) then
    raise exception 'Only SUPER_ADMIN, exact-unit ADMIN_ULP, or custom SLA editor may save manual SLA input' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.organization_units ou
    where ou.id = p_unit_id and ou.type = 'ULP'
      and ou.parent_id = p_up3_id and ou.own_status = 'Aktif'
  ) then raise exception 'unit_id must be an active child ULP of up3_id'; end if;

  if p_period_month is null then raise exception 'period_month is required'; end if;
  if p_work_order is null or p_work_order < 0
     or p_realization is null or p_realization < 0
     or p_achievement is null or p_achievement < 0 then
    raise exception 'work_order, realization, and achievement must be nonnegative';
  end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;

  select v.period_start, v.period_end into v_period_start, v_period_end
  from public.sla_versions v
  where v.id = p_sla_version_id and v.contract_id = p_contract_id
    and v.up3_id = p_up3_id and v.status = 'ACTIVE';
  if not found then raise exception 'Manual SLA input requires the ACTIVE version in the exact scope'; end if;
  if v_month < date_trunc('month', v_period_start::timestamp)::date
     or v_month > date_trunc('month', v_period_end::timestamp)::date then
    raise exception 'period_month is outside the SLA version period';
  end if;

  select * into v_indicator from public.sla_indicators
  where id = p_indicator_id and sla_version_id = p_sla_version_id;
  if not found then raise exception 'indicator not found in version'; end if;
  if not (
    v_indicator.input_mode = 'MANUAL'
    or (v_indicator.legacy_key = 'A-3.1c' and v_indicator.point_code = '3.1c'
        and v_indicator.input_mode = 'VARIABLE_COST'
        and v_indicator.variable_cost_profile = 'KONSTRUKSI')
  ) then raise exception 'indicator is linked to Variable Cost and cannot be entered manually'; end if;

  if v_indicator.input_mode = 'MANUAL' then
    select t.target_value into v_target from public.sla_targets t
    where t.contract_id = p_contract_id and t.up3_id = p_up3_id
      and t.unit_id = p_unit_id and t.sla_version_id = p_sla_version_id
      and t.indicator_id = p_indicator_id and t.period_month = v_month
      and t.target_scope = 'ULP';
  end if;

  insert into public.sla_entries (
    contract_id, up3_id, unit_id, sla_version_id, indicator_id,
    period_month, source_type, measurement_unit, target_value,
    work_order, realization, achievement, penalty_value, created_by, updated_by
  ) values (
    p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id,
    v_month, 'MANUAL', nullif(btrim(p_measurement_unit), ''), v_target,
    p_work_order, p_realization, p_achievement, null, auth.uid(), auth.uid()
  )
  on conflict (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month)
  do update set source_type = 'MANUAL',
    measurement_unit = excluded.measurement_unit,
    target_value = excluded.target_value,
    work_order = excluded.work_order,
    realization = excluded.realization,
    achievement = excluded.achievement,
    penalty_value = null,
    updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.set_manual_sla_target(
  p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_sla_version_id uuid,
  p_indicator_id uuid, p_period_month date, p_target_value numeric
)
returns public.sla_targets
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.sla_targets%rowtype;
  v_month date;
  v_version_status text;
  v_period_start date;
  v_period_end date;
  v_input_mode text;
  v_point_code text;
begin
  if not (
    public.auth_can_manage_pelayanan_teknik_scope(p_contract_id, p_up3_id, p_unit_id)
    or public.auth_custom_has_permission(p_contract_id, p_up3_id, p_unit_id, 'sla.manage')
  ) then
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
$function$;

create or replace function public.set_variable_manual_wo(
  p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_period_month date,
  p_indicator_code text, p_wo_value numeric
)
returns public.variable_cost_manual_wo
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_month date;
  v_existing public.variable_cost_manual_wo%rowtype;
  v_result public.variable_cost_manual_wo%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not (
    public.auth_can_access_variable_scope(p_contract_id, p_up3_id, p_unit_id)
    and (
      not public.auth_is_custom_contract_role(p_contract_id, p_up3_id, p_unit_id)
      or public.auth_can_mutate_variable_entry_scope(p_contract_id, p_up3_id, p_unit_id)
    )
  ) then raise exception 'Not authorized to set WO in this scope' using errcode = '42501'; end if;
  if p_indicator_code is null or btrim(p_indicator_code) = '' then raise exception 'indicator_code wajib diisi'; end if;
  if p_wo_value is null or p_wo_value < 0 then raise exception 'wo_value must be greater than or equal to zero'; end if;
  v_month := date_trunc('month', p_period_month::timestamp)::date;
  if not exists (select 1 from public.organization_units unit where unit.id=p_unit_id and unit.type='ULP' and unit.parent_id=p_up3_id and unit.own_status='Aktif') then raise exception 'unit_id must be an active child ULP of up3_id'; end if;

  select * into v_existing from public.variable_cost_manual_wo
  where contract_id=p_contract_id and up3_id=p_up3_id and unit_id=p_unit_id and period_month=v_month and indicator_code=btrim(p_indicator_code)
  for update;
  if found then
    if v_existing.wo_value=p_wo_value then return v_existing; end if;
    update public.variable_cost_manual_wo set wo_value=p_wo_value, updated_by=auth.uid() where id=v_existing.id returning * into v_result;
  else
    insert into public.variable_cost_manual_wo(contract_id,up3_id,unit_id,period_month,indicator_code,wo_value,created_by,updated_by)
    values(p_contract_id,p_up3_id,p_unit_id,v_month,btrim(p_indicator_code),p_wo_value,auth.uid(),auth.uid()) returning * into v_result;
  end if;
  return v_result;
end;
$function$;

create or replace function public.create_feeder_proposal(
  p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_name text, p_code text default null
)
returns public.feeders
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_row public.feeders%rowtype;
begin
  if not (
    public.auth_can_access_variable_scope(p_contract_id, p_up3_id, p_unit_id)
    and (
      not public.auth_is_custom_contract_role(p_contract_id, p_up3_id, p_unit_id)
      or public.auth_can_mutate_variable_entry_scope(p_contract_id, p_up3_id, p_unit_id)
    )
  ) then raise exception 'access denied'; end if;
  if exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=p_contract_id and cm.operational_up3_id=p_up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)) then raise exception 'ADMIN_UP3 must use direct create'; end if;
  insert into public.feeders (contract_id, up3_id, unit_id, name, code, status, proposed_by, proposed_at, created_by, updated_by)
  values (p_contract_id, p_up3_id, p_unit_id, btrim(p_name), nullif(btrim(p_code),''), 'PENDING', auth.uid(), now(), auth.uid(), auth.uid())
  returning * into v_row;
  return v_row;
end;
$function$;
