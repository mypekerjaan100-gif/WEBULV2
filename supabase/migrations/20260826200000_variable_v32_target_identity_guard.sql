-- Final hardening for deployed V3.2: target identity/history remains immutable.
create or replace function public.guard_sla_target_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_version_id uuid;
  v_new_version_id uuid;
  v_status text;
  v_old_is_variable_standard boolean := false;
  v_new_is_variable_standard boolean := false;
  v_identity_unchanged boolean := false;
begin
  if tg_op = 'DELETE' then
    v_old_version_id := old.sla_version_id;
  elsif tg_op = 'INSERT' then
    v_new_version_id := new.sla_version_id;
  else
    v_old_version_id := old.sla_version_id;
    v_new_version_id := new.sla_version_id;
    v_identity_unchanged := old.contract_id is not distinct from new.contract_id
      and old.up3_id is not distinct from new.up3_id
      and old.unit_id is not distinct from new.unit_id
      and old.sla_version_id is not distinct from new.sla_version_id
      and old.indicator_id is not distinct from new.indicator_id
      and old.period_month is not distinct from new.period_month
      and old.target_scope is not distinct from new.target_scope;
  end if;

  if v_old_version_id is not null then
    select status into v_status from public.sla_versions where id = v_old_version_id;
    if v_status = 'ARCHIVED' then raise exception 'ARCHIVED SLA targets are immutable'; end if;
    select old.target_scope = 'ULP' and exists (
      select 1 from public.sla_indicators i
      where i.id = old.indicator_id and i.sla_version_id = old.sla_version_id
        and i.input_mode = 'VARIABLE_COST' and i.variable_cost_profile = 'STANDARD'
        and i.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1a','3.1b','3.2a','3.2b')
    ) into v_old_is_variable_standard;
    if v_status = 'ACTIVE' and public.sla_version_is_referenced(v_old_version_id)
       and not (tg_op = 'UPDATE' and v_identity_unchanged and v_old_is_variable_standard) then
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
    ) into v_new_is_variable_standard;
    if v_status = 'ACTIVE' and public.sla_version_is_referenced(v_new_version_id)
       and not ((tg_op = 'INSERT' and v_new_is_variable_standard)
         or (tg_op = 'UPDATE' and v_identity_unchanged and v_old_is_variable_standard and v_new_is_variable_standard)) then
      raise exception 'Referenced ACTIVE SLA structure and targets are immutable; create a Draft Revision/Addendum';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
