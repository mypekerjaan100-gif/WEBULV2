-- Enable the two canonical Tebang indicators in the existing Variable workflow without SLA mapping.
create or replace function public.is_tebang_variable_indicator(p_indicator_id uuid)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_indicator_id in (
    '7e5b0214-f394-4f1e-86ad-2040d1972040'::uuid,
    'b612e8c7-68b6-4ed7-9bba-4060d1974060'::uuid
  );
$$;

alter table public.variable_cost_entries
  drop constraint if exists variable_cost_indicator_version_fk;

create or replace function public.validate_variable_cost_indicator()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_status text;
begin
  if public.is_tebang_variable_indicator(new.indicator_id) then
    v_mode := 'VARIABLE_COST';
  else
    select input_mode into v_mode
    from public.sla_indicators
    where id = new.indicator_id and sla_version_id = new.sla_version_id;
  end if;

  if v_mode is distinct from 'VARIABLE_COST' then
    raise exception 'indicator is not a Variable Cost indicator';
  end if;

  select status into v_status from public.sla_versions where id = new.sla_version_id;
  if v_status is distinct from 'ACTIVE' then
    raise exception 'Variable Cost entries require an ACTIVE SLA version';
  end if;
  return new;
end;
$$;

create or replace function public.sync_variable_cost_month(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_sla_version_id uuid,
  p_indicator_id uuid,
  p_period_month date
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count bigint;
  v_unit text;
  v_target numeric(18,4);
  v_work_order numeric(18,4);
  v_realization numeric(18,4);
  v_profile text;
  v_achievement numeric(12,4);
  v_denominator numeric(18,4);
begin
  -- Tebang is Variable-only. Its approved aggregate must never enter SLA.
  if public.is_tebang_variable_indicator(p_indicator_id) then return; end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':', p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id, p_period_month), 0));
  select variable_cost_profile into v_profile from public.sla_indicators where id = p_indicator_id and sla_version_id = p_sla_version_id;
  if v_profile = 'KONSTRUKSI' then
    select count(*), min(measurement_unit), sum(coalesce(revenue_amount,0)) into v_count, v_unit, v_realization
    from public.variable_cost_entries where contract_id = p_contract_id and up3_id = p_up3_id and unit_id = p_unit_id and sla_version_id = p_sla_version_id and indicator_id = p_indicator_id and work_date >= p_period_month and work_date < (p_period_month + interval '1 month')::date and status = 'APPROVED';
    if v_count = 0 then
      delete from public.sla_entries where contract_id = p_contract_id and up3_id = p_up3_id and unit_id = p_unit_id and sla_version_id = p_sla_version_id and indicator_id = p_indicator_id and period_month = p_period_month and source_type = 'VARIABLE_COST_AGGREGATE'; return;
    end if;
    select target_value into v_target from public.sla_targets where contract_id = p_contract_id and up3_id = p_up3_id and unit_id = p_unit_id and sla_version_id = p_sla_version_id and indicator_id = p_indicator_id and period_month = p_period_month and target_scope='ULP';
    insert into public.sla_entries (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month, source_type, measurement_unit, target_value, work_order, realization, achievement, penalty_value)
    values (p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id, p_period_month, 'VARIABLE_COST_AGGREGATE', v_unit, v_target, null, v_realization, null, null)
    on conflict (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month) do update set source_type='VARIABLE_COST_AGGREGATE', measurement_unit=excluded.measurement_unit, target_value=excluded.target_value, work_order=null, realization=excluded.realization, achievement=null, penalty_value=null;
    return;
  end if;
  select count(*), min(measurement_unit), sum(coalesce(work_order,0)), sum(coalesce(realization,0)) into v_count, v_unit, v_work_order, v_realization
  from public.variable_cost_entries where contract_id = p_contract_id and up3_id = p_up3_id and unit_id = p_unit_id and sla_version_id = p_sla_version_id and indicator_id = p_indicator_id and work_date >= p_period_month and work_date < (p_period_month + interval '1 month')::date and status = 'APPROVED';
  if v_count = 0 then
    delete from public.sla_entries where contract_id = p_contract_id and up3_id = p_up3_id and unit_id = p_unit_id and sla_version_id = p_sla_version_id and indicator_id = p_indicator_id and period_month = p_period_month and source_type = 'VARIABLE_COST_AGGREGATE'; return;
  end if;
  select target_value into v_target from public.sla_targets where contract_id = p_contract_id and up3_id = p_up3_id and unit_id = p_unit_id and sla_version_id = p_sla_version_id and indicator_id = p_indicator_id and period_month = p_period_month and target_scope='ULP';
  if v_target is not null and v_target > 0 and v_work_order is not null and v_work_order > 0 then v_denominator := least(v_target, v_work_order); else v_denominator := null; end if;
  if v_denominator is not null and v_denominator > 0 and v_realization is not null then v_achievement := (v_realization / v_denominator * 100)::numeric(12,4); else v_achievement := null; end if;
  insert into public.sla_entries (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month, source_type, measurement_unit, target_value, work_order, realization, achievement, penalty_value)
  values (p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id, p_period_month, 'VARIABLE_COST_AGGREGATE', v_unit, v_target, v_work_order, v_realization, v_achievement, null)
  on conflict (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month) do update set source_type='VARIABLE_COST_AGGREGATE', measurement_unit=excluded.measurement_unit, target_value=excluded.target_value, work_order=excluded.work_order, realization=excluded.realization, achievement=excluded.achievement, penalty_value=null;
end;
$$;

create or replace function public.save_variable_cost_entry(
  p_entry_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_sla_version_id uuid,
  p_indicator_id uuid,
  p_work_date date,
  p_feeder_id uuid,
  p_location_address text,
  p_work_order numeric,
  p_realization numeric,
  p_revenue_amount numeric,
  p_description text,
  p_employee_ids uuid[]
)
returns public.variable_cost_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile text;
  v_row public.variable_cost_entries%rowtype;
  v_existing public.variable_cost_entries%rowtype;
  v_feeder_status text;
  v_measurement_unit text;
begin
  if not public.auth_can_access_variable_scope(p_contract_id, p_up3_id, p_unit_id) then raise exception 'access denied'; end if;
  if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_ULP' and cm.contract_id=p_contract_id and cm.operational_up3_id=p_up3_id and cm.operational_unit_id=p_unit_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then raise exception 'only own ULP can save variable entry'; end if;

  if public.is_tebang_variable_indicator(p_indicator_id) then
    v_profile := 'STANDARD';
    v_measurement_unit := 'batang';
  else
    select variable_cost_profile into v_profile from public.sla_indicators where id=p_indicator_id and sla_version_id=p_sla_version_id;
  end if;

  if v_profile = 'STANDARD' then
    if p_feeder_id is null then raise exception 'penyulang required for standard indicator'; end if;
    select status into v_feeder_status from public.feeders where id=p_feeder_id and contract_id=p_contract_id and up3_id=p_up3_id and unit_id=p_unit_id;
    if v_feeder_status is distinct from 'ACTIVE' then raise exception 'penyulang must be ACTIVE and belong to own ULP'; end if;
    if p_revenue_amount is not null then raise exception 'revenue_amount must be null for standard'; end if;
    if p_work_order is null or p_realization is null then raise exception 'WO and Realisasi required for standard'; end if;
  elsif v_profile = 'KONSTRUKSI' then
    if p_feeder_id is not null then raise exception 'penyulang must be null for Konstruksi'; end if;
    if p_work_order is not null or p_realization is not null then raise exception 'WO/Realisasi must be null for Konstruksi'; end if;
    if p_revenue_amount is null or p_revenue_amount < 0 then raise exception 'revenue_amount required for Konstruksi'; end if;
  else raise exception 'unknown indicator profile'; end if;

  if p_entry_id is null then
    insert into public.variable_cost_entries (contract_id, up3_id, unit_id, sla_version_id, indicator_id, work_date, measurement_unit, feeder_id, location_address, work_order, realization, revenue_amount, description, status, created_by, updated_by)
    values (p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id, p_work_date, v_measurement_unit, p_feeder_id, nullif(btrim(p_location_address),''), p_work_order, p_realization, p_revenue_amount, nullif(btrim(p_description),''), 'DRAFT', auth.uid(), auth.uid()) returning * into v_row;
  else
    select * into v_existing from public.variable_cost_entries where id=p_entry_id for update;
    if not found then raise exception 'entry not found'; end if;
    if v_existing.status not in ('DRAFT','REJECTED') then raise exception 'only DRAFT/REJECTED can be edited'; end if;
    if v_existing.contract_id is distinct from p_contract_id or v_existing.up3_id is distinct from p_up3_id or v_existing.unit_id is distinct from p_unit_id then raise exception 'scope immutable'; end if;
    update public.variable_cost_entries set feeder_id=p_feeder_id, location_address=nullif(btrim(p_location_address),''), work_order=p_work_order, realization=p_realization, revenue_amount=p_revenue_amount, description=nullif(btrim(p_description),''), work_date=p_work_date, measurement_unit=coalesce(v_measurement_unit, measurement_unit), sla_version_id=p_sla_version_id, indicator_id=p_indicator_id, updated_by=auth.uid() where id=p_entry_id returning * into v_row;
  end if;
  if p_employee_ids is not null and array_length(p_employee_ids,1) > 0 then
    delete from public.variable_cost_entry_personnel where variable_cost_entry_id = v_row.id;
    insert into public.variable_cost_entry_personnel (variable_cost_entry_id, employee_id, created_by) select v_row.id, eid, auth.uid() from unnest(p_employee_ids) eid on conflict do nothing;
  end if;
  insert into public.variable_cost_status_history (variable_cost_entry_id, from_status, to_status, changed_by) values (v_row.id, v_existing.status, v_row.status, auth.uid());
  return v_row;
end;
$$;

revoke execute on function public.save_variable_cost_entry(uuid,uuid,uuid,uuid,uuid,uuid,date,uuid,text,numeric,numeric,numeric,text,uuid[]) from public, anon;
grant execute on function public.save_variable_cost_entry(uuid,uuid,uuid,uuid,uuid,uuid,date,uuid,text,numeric,numeric,numeric,text,uuid[]) to authenticated;
notify pgrst, 'reload schema';
