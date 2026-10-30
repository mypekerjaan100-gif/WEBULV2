-- Direct monthly totals replace the retired daily/approval and external-source workflows.
-- No legacy values are imported, changed, or deleted by this migration.
create table public.variable_cost_monthly_actuals (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  up3_id uuid not null references public.organization_units(id) on delete restrict,
  unit_id uuid not null references public.organization_units(id) on delete restrict,
  sla_version_id uuid not null references public.sla_versions(id) on delete restrict,
  indicator_id uuid not null, -- Tebang identifiers deliberately have no SLA FK.
  indicator_code text not null check (indicator_code in (
    '2.1a','2.1b','2.1c','2.1d','3.1a','3.1b','3.2a','3.2b','TEBANG_20_40_CM','TEBANG_40_60_CM'
  )),
  period_month date not null check (period_month = date_trunc('month', period_month::timestamp)::date),
  work_order numeric(18,4) check (work_order >= 0 and work_order < 1e14),
  realization numeric(18,4) check (realization >= 0 and realization < 1e14),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  unique (contract_id, up3_id, unit_id, period_month, indicator_code)
);
create index idx_variable_monthly_period on public.variable_cost_monthly_actuals (contract_id, up3_id, period_month, unit_id);
create index idx_variable_monthly_up3 on public.variable_cost_monthly_actuals (up3_id);
create index idx_variable_monthly_unit on public.variable_cost_monthly_actuals (unit_id);
create index idx_variable_monthly_version on public.variable_cost_monthly_actuals (sla_version_id);
create index idx_variable_monthly_creator on public.variable_cost_monthly_actuals (created_by);
create index idx_variable_monthly_updater on public.variable_cost_monthly_actuals (updated_by);

create table public.variable_cost_monthly_history (
  id uuid primary key default gen_random_uuid(),
  monthly_actual_id uuid not null references public.variable_cost_monthly_actuals(id) on delete restrict,
  contract_id uuid not null,
  up3_id uuid not null,
  unit_id uuid not null,
  period_month date not null,
  indicator_code text not null,
  old_work_order numeric(18,4),
  new_work_order numeric(18,4),
  old_realization numeric(18,4),
  new_realization numeric(18,4),
  revision integer not null,
  changed_at timestamptz not null default now(),
  changed_by uuid not null references auth.users(id),
  unique (monthly_actual_id, revision)
);
create index idx_variable_monthly_history_scope on public.variable_cost_monthly_history (contract_id, up3_id, unit_id, period_month, indicator_code, revision desc);
create index idx_variable_monthly_history_actor on public.variable_cost_monthly_history (changed_by);

alter table public.variable_cost_monthly_actuals enable row level security;
alter table public.variable_cost_monthly_history enable row level security;
create policy variable_monthly_read_scope on public.variable_cost_monthly_actuals for select to authenticated
  using (public.auth_can_access_variable_scope(contract_id, up3_id, unit_id));
create policy variable_monthly_history_read_scope on public.variable_cost_monthly_history for select to authenticated
  using (public.auth_can_access_variable_scope(contract_id, up3_id, unit_id));
revoke all on public.variable_cost_monthly_actuals, public.variable_cost_monthly_history from public, anon, authenticated;
grant select on public.variable_cost_monthly_actuals, public.variable_cost_monthly_history to authenticated;

-- Unlike operational management permissions, this gate only accepts the exact-unit ADMIN_ULP.
create or replace function public.auth_can_write_variable_monthly_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.contract_memberships m
    join public.contracts c on c.id=m.contract_id and c.status='active'
    join public.contract_up3_scopes scope on scope.contract_id=m.contract_id and scope.up3_id=m.operational_up3_id and scope.status='Aktif'
    join public.organization_units unit on unit.id=m.operational_unit_id and unit.parent_id=m.operational_up3_id and unit.type='ULP' and unit.own_status='Aktif'
    where m.user_id=auth.uid() and m.contract_role='ADMIN_ULP'
      and m.contract_id=p_contract_id and m.operational_up3_id=p_up3_id and m.operational_unit_id=p_unit_id
      and m.status='ACTIVE' and m.effective_from<=current_date and (m.effective_to is null or current_date<m.effective_to)
  );
$$;
revoke all on function public.auth_can_write_variable_monthly_scope(uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.validate_variable_monthly_actual()
returns trigger language plpgsql set search_path = '' as $$
declare v_indicator_id uuid;
begin
  if not public.auth_can_write_variable_monthly_scope(new.contract_id,new.up3_id,new.unit_id) then
    raise exception 'Hanya Admin ULP yang dapat mengubah input bulanan unitnya sendiri' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (new.id,new.contract_id,new.up3_id,new.unit_id,new.period_month,new.sla_version_id,new.indicator_code,new.indicator_id)
    is distinct from (old.id,old.contract_id,old.up3_id,old.unit_id,old.period_month,old.sla_version_id,old.indicator_code,old.indicator_id) then
    raise exception 'Monthly input identity is immutable';
  end if;
  if not exists (
    select 1 from public.sla_versions v where v.id=new.sla_version_id and v.contract_id=new.contract_id and v.up3_id=new.up3_id
      and v.status='ACTIVE' and new.period_month between date_trunc('month',v.period_start::timestamp)::date and v.period_end
  ) then raise exception 'Input bulanan memerlukan versi SLA aktif pada periode dan scope yang sama'; end if;
  if new.indicator_code='TEBANG_20_40_CM' then v_indicator_id:='7e5b0214-f394-4f1e-86ad-2040d1972040'::uuid;
  elsif new.indicator_code='TEBANG_40_60_CM' then v_indicator_id:='b612e8c7-68b6-4ed7-9bba-4060d1974060'::uuid;
  else
    select i.id into v_indicator_id from public.sla_indicators i
    where i.sla_version_id=new.sla_version_id and i.point_code=new.indicator_code
      and i.legacy_key='A-'||new.indicator_code and i.input_mode='VARIABLE_COST' and i.variable_cost_profile='STANDARD';
  end if;
  if v_indicator_id is null or new.indicator_id is distinct from v_indicator_id then raise exception 'Indikator input bulanan tidak valid'; end if;
  if tg_op='UPDATE' then
    if (new.work_order,new.realization) is not distinct from (old.work_order,old.realization) then return null; end if;
    new.revision:=old.revision+1;
    new.created_at:=old.created_at; new.created_by:=old.created_by;
  else
    new.revision:=1; new.created_at:=now(); new.created_by:=auth.uid();
  end if;
  new.updated_at:=now(); new.updated_by:=auth.uid();
  return new;
end;
$$;
revoke all on function public.validate_variable_monthly_actual() from public, anon, authenticated;
create trigger trg_variable_monthly_validate before insert or update on public.variable_cost_monthly_actuals
  for each row execute function public.validate_variable_monthly_actual();

-- This canonical synchronizer now reads monthly totals only. Retired rows can never overwrite them.
create or replace function public.sync_variable_cost_month(
  p_contract_id uuid,p_up3_id uuid,p_unit_id uuid,p_sla_version_id uuid,p_indicator_id uuid,p_period_month date
) returns void language plpgsql set search_path = '' as $$
declare
  v_row public.variable_cost_monthly_actuals%rowtype;
  v_target numeric; v_unit text; v_achievement numeric;
begin
  -- Tebang is financial/recap only; Konstruksi keeps its existing nominal monthly workflow.
  select i.measurement_unit into v_unit from public.sla_indicators i
  where i.id=p_indicator_id and i.sla_version_id=p_sla_version_id
    and i.input_mode='VARIABLE_COST' and i.variable_cost_profile='STANDARD'
    and (i.legacy_key,i.point_code) in (('A-2.1a','2.1a'),('A-2.1b','2.1b'),('A-2.1c','2.1c'),('A-2.1d','2.1d'),('A-3.1a','3.1a'),('A-3.1b','3.1b'),('A-3.2a','3.2a'),('A-3.2b','3.2b'));
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',p_contract_id,p_up3_id,p_unit_id,p_sla_version_id,p_indicator_id,p_period_month),0));
  select * into v_row from public.variable_cost_monthly_actuals a
  where a.contract_id=p_contract_id and a.up3_id=p_up3_id and a.unit_id=p_unit_id
    and a.sla_version_id=p_sla_version_id and a.indicator_id=p_indicator_id and a.period_month=p_period_month;
  if not found or (v_row.work_order is null and v_row.realization is null) then
    delete from public.sla_entries where contract_id=p_contract_id and up3_id=p_up3_id and unit_id=p_unit_id
      and sla_version_id=p_sla_version_id and indicator_id=p_indicator_id and period_month=p_period_month and source_type='VARIABLE_COST_AGGREGATE';
    return;
  end if;
  select t.target_value into v_target from public.sla_targets t
  where t.contract_id=p_contract_id and t.up3_id=p_up3_id and t.unit_id=p_unit_id and t.sla_version_id=p_sla_version_id
    and t.indicator_id=p_indicator_id and t.period_month=p_period_month and t.target_scope='ULP';
  if v_target>0 and v_row.work_order>0 and v_row.realization is not null then
    v_achievement:=v_row.realization/least(v_target,v_row.work_order)*100;
  end if;
  insert into public.sla_entries(contract_id,up3_id,unit_id,sla_version_id,indicator_id,period_month,source_type,measurement_unit,target_value,work_order,realization,achievement,penalty_value,created_by,updated_by)
  values(p_contract_id,p_up3_id,p_unit_id,p_sla_version_id,p_indicator_id,p_period_month,'VARIABLE_COST_AGGREGATE',v_unit,v_target,v_row.work_order,v_row.realization,v_achievement,null,auth.uid(),auth.uid())
  on conflict(contract_id,up3_id,unit_id,sla_version_id,indicator_id,period_month) do update
  set source_type=excluded.source_type,measurement_unit=excluded.measurement_unit,target_value=excluded.target_value,
    work_order=excluded.work_order,realization=excluded.realization,achievement=excluded.achievement,penalty_value=null,updated_by=auth.uid();
end;
$$;
revoke all on function public.sync_variable_cost_month(uuid,uuid,uuid,uuid,uuid,date) from public, anon, authenticated;

create or replace function public.audit_sync_variable_monthly_actual()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.variable_cost_monthly_history(monthly_actual_id,contract_id,up3_id,unit_id,period_month,indicator_code,old_work_order,new_work_order,old_realization,new_realization,revision,changed_by)
  values(new.id,new.contract_id,new.up3_id,new.unit_id,new.period_month,new.indicator_code,
    case when tg_op='UPDATE' then old.work_order end,new.work_order,
    case when tg_op='UPDATE' then old.realization end,new.realization,new.revision,auth.uid());
  perform public.sync_variable_cost_month(new.contract_id,new.up3_id,new.unit_id,new.sla_version_id,new.indicator_id,new.period_month);
  return new;
end;
$$;
revoke all on function public.audit_sync_variable_monthly_actual() from public, anon, authenticated;
create trigger trg_variable_monthly_audit_sync after insert or update on public.variable_cost_monthly_actuals
  for each row execute function public.audit_sync_variable_monthly_actual();

-- Also keep SLA current when a target is edited through any authorized target workflow.
create or replace function public.sync_variable_monthly_target()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then
    if old.unit_id is not null then perform public.sync_variable_cost_month(old.contract_id,old.up3_id,old.unit_id,old.sla_version_id,old.indicator_id,old.period_month); end if;
    return old;
  end if;
  if new.unit_id is not null then perform public.sync_variable_cost_month(new.contract_id,new.up3_id,new.unit_id,new.sla_version_id,new.indicator_id,new.period_month); end if;
  return new;
end;
$$;
revoke all on function public.sync_variable_monthly_target() from public, anon, authenticated;
create trigger trg_variable_monthly_target_sync after insert or update or delete on public.sla_targets
  for each row execute function public.sync_variable_monthly_target();

create or replace function public.list_variable_monthly_actuals(p_contract_id uuid,p_up3_id uuid,p_period_month date,p_unit_id uuid default null)
returns setof public.variable_cost_monthly_actuals language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_period_month is null or p_period_month<>date_trunc('month',p_period_month::timestamp)::date then raise exception 'period_month must be first day of month'; end if;
  if not exists(select 1 from public.organization_units u where u.type='ULP' and u.parent_id=p_up3_id
    and (p_unit_id is null or u.id=p_unit_id) and public.auth_can_access_variable_scope(p_contract_id,p_up3_id,u.id)) then
    raise exception 'Not authorized to read monthly Variable input in this scope' using errcode='42501';
  end if;
  return query select a.* from public.variable_cost_monthly_actuals a where a.contract_id=p_contract_id and a.up3_id=p_up3_id
    and a.period_month=p_period_month and (p_unit_id is null or a.unit_id=p_unit_id)
    and public.auth_can_access_variable_scope(a.contract_id,a.up3_id,a.unit_id) order by a.unit_id,a.indicator_code;
end;
$$;

-- One atomic batch, with optimistic revisions to prevent another session's edits being lost.
create or replace function public.save_variable_monthly_actuals(
  p_contract_id uuid,p_up3_id uuid,p_unit_id uuid,p_sla_version_id uuid,p_period_month date,p_values jsonb
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_value jsonb; v_code text; v_indicator_id uuid; v_wo numeric; v_real numeric; v_expected integer;
  v_existing public.variable_cost_monthly_actuals%rowtype; v_changed integer:=0; v_affected integer;
begin
  if not public.auth_can_write_variable_monthly_scope(p_contract_id,p_up3_id,p_unit_id) then
    raise exception 'Hanya Admin ULP yang dapat mengubah input bulanan unitnya sendiri' using errcode='42501';
  end if;
  if p_period_month is null or p_period_month<>date_trunc('month',p_period_month::timestamp)::date then raise exception 'period_month must be first day of month'; end if;
  if not exists(select 1 from public.sla_versions v where v.id=p_sla_version_id and v.contract_id=p_contract_id and v.up3_id=p_up3_id
    and v.status='ACTIVE' and p_period_month between date_trunc('month',v.period_start::timestamp)::date and v.period_end) then
    raise exception 'Tidak ada versi SLA aktif untuk periode ini';
  end if;
  if jsonb_typeof(p_values) is distinct from 'array' then raise exception 'values must be an array'; end if;
  if jsonb_array_length(p_values) not between 1 and 10 then raise exception 'values must contain 1 to 10 indicators'; end if;
  if (select count(distinct item->>'indicator_code') from jsonb_array_elements(p_values) item)<>jsonb_array_length(p_values) then raise exception 'Duplicate or missing indicator_code'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','variable-monthly',p_contract_id,p_up3_id,p_unit_id,p_period_month),0));
  for v_value in select value from jsonb_array_elements(p_values) order by value->>'indicator_code' loop
    v_code:=v_value->>'indicator_code'; v_indicator_id:=null;
    if v_code='TEBANG_20_40_CM' then v_indicator_id:='7e5b0214-f394-4f1e-86ad-2040d1972040'::uuid;
    elsif v_code='TEBANG_40_60_CM' then v_indicator_id:='b612e8c7-68b6-4ed7-9bba-4060d1974060'::uuid;
    elsif v_code in ('2.1a','2.1b','2.1c','2.1d','3.1a','3.1b','3.2a','3.2b') then
      select i.id into v_indicator_id from public.sla_indicators i where i.sla_version_id=p_sla_version_id and i.point_code=v_code
        and i.legacy_key='A-'||v_code and i.input_mode='VARIABLE_COST' and i.variable_cost_profile='STANDARD';
    end if;
    if v_indicator_id is null then raise exception 'Indikator input bulanan tidak valid: %',v_code; end if;
    if not (v_value ?& array['work_order','realization','expected_revision'])
      or jsonb_typeof(v_value->'work_order') not in ('number','null') or jsonb_typeof(v_value->'realization') not in ('number','null')
      or jsonb_typeof(v_value->'expected_revision') is distinct from 'number' then raise exception 'WO, realisasi, dan revision wajib dikirim dengan tipe yang benar'; end if;
    v_wo:=(v_value->>'work_order')::numeric; v_real:=(v_value->>'realization')::numeric;
    if v_wo<0 or v_wo>=1e14 or v_real<0 or v_real>=1e14 or trunc(v_wo,4)<>v_wo or trunc(v_real,4)<>v_real then raise exception 'WO dan realisasi harus angka nol atau lebih, maksimal 4 angka desimal'; end if;
    if (v_value->>'expected_revision')!~'^[0-9]+$' then raise exception 'expected_revision must be a non-negative integer'; end if;
    v_expected:=(v_value->>'expected_revision')::integer;
    select * into v_existing from public.variable_cost_monthly_actuals a where a.contract_id=p_contract_id and a.up3_id=p_up3_id
      and a.unit_id=p_unit_id and a.period_month=p_period_month and a.indicator_code=v_code for update;
    if coalesce(v_existing.revision,0)<>v_expected then
      raise exception 'Data % telah diubah oleh sesi lain. Muat ulang sebelum menyimpan kembali.',v_code using errcode='40001';
    end if;
    if v_existing.id is not null then
      if v_existing.sla_version_id<>p_sla_version_id or v_existing.indicator_id<>v_indicator_id then raise exception 'Versi input tersimpan berbeda. Hubungi Admin untuk memeriksa konfigurasi SLA.'; end if;
      update public.variable_cost_monthly_actuals set work_order=v_wo,realization=v_real where id=v_existing.id
        and (work_order,realization) is distinct from (v_wo,v_real);
    elsif v_wo is not null or v_real is not null then
      insert into public.variable_cost_monthly_actuals(contract_id,up3_id,unit_id,sla_version_id,indicator_id,indicator_code,period_month,work_order,realization,created_by,updated_by)
      values(p_contract_id,p_up3_id,p_unit_id,p_sla_version_id,v_indicator_id,v_code,p_period_month,v_wo,v_real,auth.uid(),auth.uid());
    else continue;
    end if;
    get diagnostics v_affected=row_count; v_changed:=v_changed+v_affected;
  end loop;
  return v_changed;
end;
$$;
revoke all on function public.list_variable_monthly_actuals(uuid,uuid,date,uuid) from public,anon,authenticated;
revoke all on function public.save_variable_monthly_actuals(uuid,uuid,uuid,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.list_variable_monthly_actuals(uuid,uuid,date,uuid) to authenticated;
grant execute on function public.save_variable_monthly_actuals(uuid,uuid,uuid,uuid,date,jsonb) to authenticated;

-- Freeze the retired mutation surface; all source rows/evidence remain available for authorized audit reads.
revoke insert,update,delete on public.variable_cost_entries,public.variable_cost_manual_wo,public.feeders,
  public.variable_cost_entry_personnel,public.variable_cost_evidence,public.variable_cost_status_history from public,anon,authenticated;
revoke all on function public.save_variable_cost_entry(uuid,uuid,uuid,uuid,uuid,uuid,date,uuid,text,numeric,numeric,numeric,text,uuid[]) from public,anon,authenticated;
revoke all on function public.submit_variable_cost_entry(uuid),public.approve_variable_cost_entry(uuid),public.reject_variable_cost_entry(uuid,text) from public,anon,authenticated;
revoke all on function public.set_variable_manual_wo(uuid,uuid,uuid,date,text,numeric) from public,anon,authenticated;
revoke all on function public.create_feeder_proposal(uuid,uuid,uuid,text,text),public.create_feeder_direct(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.approve_feeder(uuid),public.reject_feeder(uuid,text),public.deactivate_feeder(uuid),public.activate_feeder(uuid),public.delete_feeder(uuid) from public,anon,authenticated;
revoke all on function public.get_variable_evidence_upload_path(uuid,text) from public,anon,authenticated;

comment on table public.variable_cost_monthly_actuals is 'Direct monthly WO/realization per exact ULP. NULL is not entered; zero is valid. No evidence or approval.';
comment on table public.variable_cost_monthly_history is 'Append-only revisions of monthly input, including clearing a value back to NULL.';
comment on function public.sync_variable_cost_month(uuid,uuid,uuid,uuid,uuid,date) is 'Synchronizes only the eight canonical STANDARD indicators from direct monthly totals; never reads retired transactions.';

-- One canonical financial source for recap, both dashboards, and every month of their trends.
-- Missing actuals remain NULL. Retired daily entries and manual WO are never joined.
create or replace function public.list_variable_actual_revenue(p_contract_id uuid,p_up3_id uuid,p_period_month date,p_unit_id uuid default null)
returns table(source_type text,unit_id uuid,indicator_id uuid,entry_id uuid,work_date date,realization numeric,unit_price numeric,price_effective_from date,revenue_amount numeric,price_missing boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_month date; v_end date;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_month:=date_trunc('month',p_period_month::timestamp)::date;
  if v_month is null then raise exception 'period_month is required'; end if;
  v_end:=(v_month+interval '1 month - 1 day')::date;
  if p_unit_id is null then
    if not public.auth_can_manage_up3_operations(p_contract_id,p_up3_id) then raise exception 'Not authorized to read Variable revenue in this UP3' using errcode='42501'; end if;
  elsif not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id,p_up3_id,p_unit_id) then raise exception 'Not authorized to read Variable revenue in this scope' using errcode='42501'; end if;
  return query
  with versions as (
    select v.id from public.sla_versions v where v.contract_id=p_contract_id and v.up3_id=p_up3_id and v.status='ACTIVE' and v_month between v.period_start and v.period_end
  ), allowed_units as (
    select u.id from public.organization_units u where u.parent_id=p_up3_id and u.type='ULP' and u.own_status='Aktif'
      and (p_unit_id is null or u.id=p_unit_id) and public.auth_can_manage_pelayanan_teknik_scope(p_contract_id,p_up3_id,u.id)
  ), eligible as (
    select i.id,i.point_code from public.sla_indicators i join versions v on v.id=i.sla_version_id
    where i.input_mode='VARIABLE_COST' and i.variable_cost_profile='STANDARD' and i.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1b','3.2a','3.2b')
    union all select '7e5b0214-f394-4f1e-86ad-2040d1972040'::uuid,'TEBANG_20_40_CM' where exists(select 1 from versions)
    union all select 'b612e8c7-68b6-4ed7-9bba-4060d1974060'::uuid,'TEBANG_40_60_CM' where exists(select 1 from versions)
  )
  select 'UNIT_RATE'::text,u.id,i.id,a.id,v_month,a.realization,price.unit_price,price.effective_from,
    a.realization*price.unit_price,a.realization is not null and price.unit_price is null
  from allowed_units u cross join eligible i
  left join public.variable_cost_monthly_actuals a on a.contract_id=p_contract_id and a.up3_id=p_up3_id
    and a.unit_id=u.id and a.period_month=v_month and a.indicator_code=i.point_code
  left join lateral (
    select p.unit_price,p.effective_from from public.variable_unit_prices p where p.contract_id=p_contract_id
      and p.operational_up3_id=p_up3_id and p.indicator_id=i.id and p.effective_from<=v_end
    order by p.effective_from desc limit 1
  ) price on true
  union all
  select 'KONSTRUKSI'::text,u.id,i.id,null::uuid,v_month,null::numeric,null::numeric,null::date,a.amount_rp,false
  from allowed_units u cross join public.sla_indicators i join versions v on v.id=i.sla_version_id
  left join public.variable_cost_konstruksi_monthly_amounts a on a.contract_id=p_contract_id and a.up3_id=p_up3_id and a.unit_id=u.id and a.period_month=v_month
  where i.point_code='3.1c' and i.input_mode='VARIABLE_COST' and i.variable_cost_profile='KONSTRUKSI';
end;
$$;
revoke all on function public.list_variable_actual_revenue(uuid,uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.list_variable_actual_revenue(uuid,uuid,date,uuid) to authenticated,service_role;

create or replace function public.get_variable_financial_dashboard(p_contract_id uuid,p_up3_id uuid,p_period_month date,p_unit_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_month date; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_month:=date_trunc('month',p_period_month::timestamp)::date;
  if v_month is null then raise exception 'period_month is required'; end if;
  if p_unit_id is null then
    if not public.auth_can_manage_up3_operations(p_contract_id,p_up3_id) then raise exception 'Not authorized to read Financial Dashboard in this UP3' using errcode='42501'; end if;
  elsif not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id,p_up3_id,p_unit_id) then raise exception 'Not authorized to read Financial Dashboard in this scope' using errcode='42501'; end if;
  if not exists(select 1 from public.sla_versions v where v.contract_id=p_contract_id and v.up3_id=p_up3_id and v.status='ACTIVE' and v_month between v.period_start and v.period_end) then raise exception 'No active SLA version for this period'; end if;
  if not (select count(*)=7 and count(distinct i.point_code)=7 from public.sla_indicators i join public.sla_versions v on v.id=i.sla_version_id
    where v.contract_id=p_contract_id and v.up3_id=p_up3_id and v.status='ACTIVE' and v_month between v.period_start and v.period_end
      and i.input_mode='VARIABLE_COST' and i.variable_cost_profile='STANDARD' and i.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1b','3.2a','3.2b')) then raise exception 'Canonical priced indicator registry is incomplete for this period'; end if;
  if not exists(select 1 from public.sla_indicators i join public.sla_versions v on v.id=i.sla_version_id
    where v.contract_id=p_contract_id and v.up3_id=p_up3_id and v.status='ACTIVE' and v_month between v.period_start and v.period_end
      and i.point_code='3.1c' and i.input_mode='VARIABLE_COST' and i.variable_cost_profile='KONSTRUKSI') then raise exception 'Canonical Konstruksi indicator is unavailable for this period'; end if;
  with raw as (
    select a.*,case when a.source_type='KONSTRUKSI' then '3.1c'
      when a.indicator_id='7e5b0214-f394-4f1e-86ad-2040d1972040'::uuid then 'TEBANG_20_40_CM'
      when a.indicator_id='b612e8c7-68b6-4ed7-9bba-4060d1974060'::uuid then 'TEBANG_40_60_CM' else i.point_code end indicator_code
    from public.list_variable_actual_revenue(p_contract_id,p_up3_id,v_month,p_unit_id) a left join public.sla_indicators i on i.id=a.indicator_id
  ), cells as (
    select r.unit_id,r.indicator_id,r.indicator_code,r.source_type,
      case r.indicator_code when '2.1a' then 'Inspeksi SUTM Tier 1' when '2.1b' then 'Inspeksi SUTM Tier 2' when '2.1c' then 'Inspeksi Gardu/Keypoint Tier 1' when '2.1d' then 'Inspeksi Gardu/Keypoint Tier 2' when '3.1b' then 'ROW Var' when '3.2a' then 'Pengukuran Gardu' when '3.2b' then 'Pemeliharaan Gardu' when 'TEBANG_20_40_CM' then 'Tebang 20-40 cm' when 'TEBANG_40_60_CM' then 'Tebang 40-60 cm' when '3.1c' then 'Konstruksi' end indicator_name,
      case r.indicator_code when '2.1a' then 1 when '2.1b' then 2 when '2.1c' then 3 when '2.1d' then 4 when '3.1b' then 5 when '3.2a' then 6 when '3.2b' then 7 when 'TEBANG_20_40_CM' then 8 when 'TEBANG_40_60_CM' then 9 else 10 end sort_order,
      case when r.source_type='KONSTRUKSI' then kt.target_rp else t.target_amount end target_amount,
      case when r.source_type='KONSTRUKSI' then kt.target_rp is null else t.target_amount is null end target_missing,
      coalesce(r.revenue_amount,0) actual_amount,
      case when r.source_type='KONSTRUKSI' then r.revenue_amount is null else r.realization is null end actual_missing,
      case when r.price_missing then 1 else 0 end missing_price_count,
      case when r.source_type='UNIT_RATE' and r.realization is not null then array[r.indicator_id] else array[]::uuid[] end actual_indicator_ids
    from raw r
    left join public.variable_revenue_targets t on t.contract_id=p_contract_id and t.operational_up3_id=p_up3_id and t.operational_unit_id=r.unit_id and t.indicator_id=r.indicator_id and t.period_month=v_month
    left join public.variable_cost_konstruksi_monthly_targets kt on kt.contract_id=p_contract_id and kt.up3_id=p_up3_id and kt.unit_id=r.unit_id and kt.period_month=v_month
  ), calculated as (
    select c.*,case when not c.target_missing and not c.actual_missing and c.missing_price_count=0 then c.actual_amount-c.target_amount end difference_amount,
      case when not c.target_missing and not c.actual_missing and c.missing_price_count=0 and c.target_amount>0 then c.actual_amount/c.target_amount*100 end achievement_percent from cells c
  ), totals as (
    select c.unit_id,c.indicator_id,c.indicator_code,c.indicator_name,c.source_type,c.sort_order,
      grouping(c.unit_id) unit_group,grouping(c.indicator_id) indicator_group,
      coalesce(sum(c.target_amount),0) target_amount,coalesce(sum(c.actual_amount),0) actual_amount,
      count(*) filter(where not c.target_missing) configured_target_count,count(*) filter(where c.target_missing) missing_target_count,
      count(*) filter(where not c.actual_missing) configured_actual_count,count(*) filter(where c.actual_missing) missing_actual_count,
      coalesce(sum(c.missing_price_count),0) missing_price_count
    from calculated c group by grouping sets((),(c.unit_id),(c.indicator_id,c.indicator_code,c.indicator_name,c.source_type,c.sort_order))
  ), finalized as (
    select t.*,case when t.missing_target_count=0 and t.missing_actual_count=0 and t.missing_price_count=0 then t.actual_amount-t.target_amount end difference_amount,
      case when t.missing_target_count=0 and t.missing_actual_count=0 and t.missing_price_count=0 and t.target_amount>0 then t.actual_amount/t.target_amount*100 end achievement_percent from totals t
  )
  select jsonb_build_object('period_month',v_month,
    'summary',coalesce((select to_jsonb(f) from finalized f where f.unit_group=1 and f.indicator_group=1),'{}'::jsonb),
    'units',coalesce((select jsonb_agg(to_jsonb(f) order by f.unit_id) from finalized f where f.unit_group=0),'[]'::jsonb),
    'indicators',coalesce((select jsonb_agg(to_jsonb(f) order by f.sort_order) from finalized f where f.indicator_group=0),'[]'::jsonb),
    'cells',coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order,c.unit_id) from calculated c),'[]'::jsonb)) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_variable_financial_dashboard(uuid,uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.get_variable_financial_dashboard(uuid,uuid,date,uuid) to authenticated,service_role;

create or replace function public.get_variable_financial_trend(p_contract_id uuid,p_up3_id uuid,p_end_period_month date,p_unit_id uuid default null,p_month_count integer default 6)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_end date; v_month date; v_summary jsonb; v_months jsonb:='[]'; v_offset integer; v_required integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_month_count not in (6,12) then raise exception 'month_count must be 6 or 12'; end if;
  v_end:=date_trunc('month',p_end_period_month::timestamp)::date;
  if v_end is null then raise exception 'end_period_month is required'; end if;
  if p_unit_id is null then
    if not public.auth_can_manage_up3_operations(p_contract_id,p_up3_id) then raise exception 'Not authorized to read Financial Trend in this UP3' using errcode='42501'; end if;
  elsif not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id,p_up3_id,p_unit_id) then raise exception 'Not authorized to read Financial Trend in this scope' using errcode='42501'; end if;
  for v_offset in 0..p_month_count-1 loop
    v_month:=(v_end-make_interval(months=>p_month_count-1-v_offset))::date;
    if exists(select 1 from public.sla_versions v where v.contract_id=p_contract_id and v.up3_id=p_up3_id and v.status='ACTIVE' and v_month between v.period_start and v.period_end) then
      v_summary:=public.get_variable_financial_dashboard(p_contract_id,p_up3_id,v_month,p_unit_id)->'summary';
      v_required:=(v_summary->>'configured_target_count')::integer+(v_summary->>'missing_target_count')::integer;
      v_months:=v_months||jsonb_build_array(v_summary||jsonb_build_object(
        'period_month',v_month,'required_target_count',v_required,
        'target_complete',v_required>0 and (v_summary->>'missing_target_count')::integer=0,
        'actual_complete',v_required>0 and (v_summary->>'missing_actual_count')::integer=0,
        'has_data',(v_summary->>'configured_target_count')::integer>0 or (v_summary->>'configured_actual_count')::integer>0));
    else
      v_months:=v_months||jsonb_build_array(jsonb_build_object('period_month',v_month,'target_amount',0,'actual_amount',0,'difference_amount',null,'achievement_percent',null,
        'configured_target_count',0,'required_target_count',0,'missing_target_count',0,'missing_actual_count',0,'missing_price_count',0,'target_complete',false,'actual_complete',false,'has_data',false));
    end if;
  end loop;
  return jsonb_build_object('end_period_month',v_end,'month_count',p_month_count,'months',v_months);
end;
$$;

-- Preserve the existing strict financial-analysis authorization and approved/non-deleted cost rules.
revoke all on function public.get_variable_financial_trend(uuid,uuid,date,uuid,integer) from public,anon,authenticated;
grant execute on function public.get_variable_financial_trend(uuid,uuid,date,uuid,integer) to authenticated,service_role;

create or replace function public.get_financial_comparison_dashboard(p_contract_id uuid,p_up3_id uuid,p_period_month date,p_unit_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_month date; v_financial jsonb; v_revenue jsonb; v_cost jsonb; v_revenue_total numeric; v_cost_total numeric; v_missing_actual integer; v_missing_price integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not (public.auth_is_super_admin() or public.auth_has_financial_analysis_scope(p_contract_id,p_up3_id,p_unit_id)) then
    raise exception 'Not authorized to read Financial Comparison in this scope' using errcode='42501';
  end if;
  v_month:=date_trunc('month',p_period_month::timestamp)::date;
  if v_month is null then raise exception 'period_month is required'; end if;
  v_financial:=public.get_variable_financial_dashboard(p_contract_id,p_up3_id,v_month,p_unit_id);
  select coalesce(jsonb_agg(jsonb_build_object('indicator_code',i->>'indicator_code','indicator_name',i->>'indicator_name',
    'sort_order',i->'sort_order','amount',i->'actual_amount','missing_price_count',i->'missing_price_count',
    'missing_actual_count',i->'missing_actual_count','configured_actual_count',i->'configured_actual_count','revenue_eligible',true) order by (i->>'sort_order')::integer),'[]'::jsonb)
  into v_revenue from jsonb_array_elements(v_financial->'indicators') i;
  with raw as (
    select a.id activity_id,case when a.type='WORK' then a.work_category else a.type end cost_code,e.calculated_amount_snapshot amount
    from public.overtime_activities a join public.overtime_entries e on e.activity_id=a.id
    where a.contract_id=p_contract_id and a.up3_id=p_up3_id and a.period_month=v_month
      and a.status='APPROVED' and a.deleted_at is null and e.approval_status='APPROVED'
      and (p_unit_id is null or a.unit_id=p_unit_id) and public.auth_can_manage_pelayanan_teknik_scope(p_contract_id,p_up3_id,a.unit_id)
  ), grouped as (
    select cost_code,sum(amount) amount,count(distinct activity_id) activity_count,count(*) entry_count from raw where cost_code is not null group by cost_code
  ), mapped as (
    select g.*,case cost_code when 'ADMINISTRASI' then 'Administrasi' when 'GARDU' then 'Gardu' when 'JTM' then 'JTM' when 'JTR' then 'JTR' when 'ROW' then 'ROW' when 'REPLACEMENT_LEAVE' then 'Pengganti Cuti' when 'REPLACEMENT_SICK' then 'Pengganti Sakit' when 'REPLACEMENT_PERMISSION' then 'Pengganti Izin' else cost_code end cost_label,
      case cost_code when 'ADMINISTRASI' then 1 when 'GARDU' then 2 when 'JTM' then 3 when 'JTR' then 4 when 'ROW' then 5 when 'REPLACEMENT_LEAVE' then 6 when 'REPLACEMENT_SICK' then 7 when 'REPLACEMENT_PERMISSION' then 8 else 99 end sort_order from grouped g
  ) select coalesce(jsonb_agg(to_jsonb(m) order by sort_order),'[]'::jsonb),coalesce(sum(amount),0) into v_cost,v_cost_total from mapped m;
  v_revenue_total:=(v_financial->'summary'->>'actual_amount')::numeric;
  v_missing_actual:=(v_financial->'summary'->>'missing_actual_count')::integer;
  v_missing_price:=(v_financial->'summary'->>'missing_price_count')::integer;
  return jsonb_build_object('period_month',v_month,'summary',jsonb_build_object(
    'revenue_amount',v_revenue_total,'cost_amount',v_cost_total,'missing_actual_count',v_missing_actual,'missing_price_count',v_missing_price,
    'margin_amount',case when v_missing_actual=0 and v_missing_price=0 then v_revenue_total-v_cost_total end,
    'margin_percent',case when v_missing_actual=0 and v_missing_price=0 and v_revenue_total>0 then (v_revenue_total-v_cost_total)/v_revenue_total*100 end,
    'cost_ratio_percent',case when v_missing_actual=0 and v_missing_price=0 and v_revenue_total>0 then v_cost_total/v_revenue_total*100 end),
    'revenue_components',v_revenue,'revenue_eligible_components',v_revenue,'cost_components',v_cost,
    'has_data',(v_financial->'summary'->>'configured_actual_count')::integer>0 or jsonb_array_length(v_cost)>0);
end;
$$;
revoke all on function public.get_financial_comparison_dashboard(uuid,uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.get_financial_comparison_dashboard(uuid,uuid,date,uuid) to authenticated,service_role;
comment on function public.list_variable_actual_revenue(uuid,uuid,date,uuid) is 'Monthly realization times price effective at period end, plus nominal Konstruksi. Missing realization stays NULL; ROW Fix is not billable; no legacy fallback.';
notify pgrst,'reload schema';
