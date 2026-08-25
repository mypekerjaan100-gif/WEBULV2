-- Variable V1 Foundation: Penyulang master, transaction grain, Konstruksi revenue, multi-petugas, evidence, workflow, approved-only aggregation
alter table public.sla_indicators add column if not exists variable_cost_profile text check (variable_cost_profile in ('STANDARD','KONSTRUKSI'));
create table if not exists public.feeders (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null,
  up3_id uuid not null references public.organization_units(id),
  unit_id uuid not null references public.organization_units(id),
  code text,
  name text not null check (char_length(btrim(name)) > 0),
  status text not null check (status in ('PENDING','ACTIVE','REJECTED','INACTIVE')),
  proposed_by uuid references auth.users(id),
  proposed_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  revision integer not null default 1,
  constraint feeders_scope_fk foreign key (contract_id, up3_id) references public.contract_up3_scopes(contract_id, up3_id)
);
create or replace function public.validate_feeder_scope() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_type text; v_parent uuid;
begin
  select type, parent_id into v_type, v_parent from public.organization_units where id = new.up3_id;
  if v_type is distinct from 'UP3' then raise exception 'feeders.up3_id must be UP3'; end if;
  select type, parent_id into v_type, v_parent from public.organization_units where id = new.unit_id;
  if v_type is distinct from 'ULP' or v_parent is distinct from new.up3_id then raise exception 'feeders.unit_id must be child ULP of up3_id'; end if;
  if new.status = 'REJECTED' and (new.rejection_reason is null or btrim(new.rejection_reason) = '') then raise exception 'rejection_reason required when REJECTED'; end if;
  return new;
end; $$;
drop trigger if exists trg_feeders_scope on public.feeders;
create trigger trg_feeders_scope before insert or update on public.feeders for each row execute function public.validate_feeder_scope();
drop trigger if exists trg_feeders_touch on public.feeders;
create trigger trg_feeders_touch before update on public.feeders for each row execute function public.touch_audit_columns();
create unique index if not exists uq_feeders_unit_name_active on public.feeders (unit_id, lower(btrim(name))) where status in ('PENDING','ACTIVE','INACTIVE');
create index if not exists idx_feeders_scope on public.feeders (contract_id, up3_id, unit_id, status);
create index if not exists idx_feeders_up3 on public.feeders (up3_id, unit_id);
alter table public.variable_cost_entries drop constraint if exists variable_cost_daily_business_key;
alter table public.variable_cost_entries add column if not exists feeder_id uuid references public.feeders(id);
alter table public.variable_cost_entries add column if not exists location_address text;
alter table public.variable_cost_entries add column if not exists description text;
alter table public.variable_cost_entries add column if not exists status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','APPROVED','REJECTED'));
alter table public.variable_cost_entries add column if not exists revenue_amount numeric(18,2) check (revenue_amount is null or revenue_amount >= 0);
alter table public.variable_cost_entries add column if not exists rejection_reason text;
alter table public.variable_cost_entries add column if not exists submitted_at timestamptz;
alter table public.variable_cost_entries add column if not exists submitted_by uuid references auth.users(id);
alter table public.variable_cost_entries add column if not exists approved_at timestamptz;
alter table public.variable_cost_entries add column if not exists approved_by uuid references auth.users(id);
alter table public.variable_cost_entries add column if not exists rejected_at timestamptz;
alter table public.variable_cost_entries add column if not exists rejected_by uuid references auth.users(id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname='variable_cost_work_order_nonnegative') then
    alter table public.variable_cost_entries add constraint variable_cost_work_order_nonnegative check (work_order is null or work_order >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='variable_cost_realization_nonnegative') then
    alter table public.variable_cost_entries add constraint variable_cost_realization_nonnegative check (realization is null or realization >= 0);
  end if;
end $$;
create index if not exists idx_variable_cost_feeder on public.variable_cost_entries (feeder_id) where feeder_id is not null;
create index if not exists idx_variable_cost_status on public.variable_cost_entries (status, work_date);
create index if not exists idx_variable_cost_indicator_status on public.variable_cost_entries (indicator_id, status);
create table if not exists public.variable_cost_entry_personnel (
  id uuid primary key default gen_random_uuid(),
  variable_cost_entry_id uuid not null references public.variable_cost_entries(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint uq_variable_personnel unique (variable_cost_entry_id, employee_id)
);
create index if not exists idx_variable_personnel_entry on public.variable_cost_entry_personnel (variable_cost_entry_id);
create index if not exists idx_variable_personnel_employee on public.variable_cost_entry_personnel (employee_id);
create table if not exists public.variable_cost_evidence (
  id uuid primary key default gen_random_uuid(),
  variable_cost_entry_id uuid not null references public.variable_cost_entries(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  category text,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_variable_evidence_entry on public.variable_cost_evidence (variable_cost_entry_id);
create table if not exists public.variable_cost_status_history (
  id uuid primary key default gen_random_uuid(),
  variable_cost_entry_id uuid not null references public.variable_cost_entries(id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  reason text
);
create index if not exists idx_variable_history_entry on public.variable_cost_status_history (variable_cost_entry_id, changed_at desc);
insert into storage.buckets (id, name, public) values ('variable-cost-evidence','variable-cost-evidence', false) on conflict (id) do nothing;
create or replace function public.sync_variable_cost_month(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_sla_version_id uuid, p_indicator_id uuid, p_period_month date)
returns void language plpgsql set search_path = public, pg_temp as $$
declare v_count bigint; v_unit text; v_target numeric(18,4); v_work_order numeric(18,4); v_realization numeric(18,4); v_profile text; v_achievement numeric(12,4); v_denominator numeric(18,4);
begin
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
end; $$;
alter table public.feeders enable row level security;
alter table public.variable_cost_entry_personnel enable row level security;
alter table public.variable_cost_evidence enable row level security;
alter table public.variable_cost_status_history enable row level security;
revoke all on public.feeders, public.variable_cost_entry_personnel, public.variable_cost_evidence, public.variable_cost_status_history from anon, authenticated;
create or replace function public.auth_can_access_variable_scope(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$ select public.auth_is_super_admin() or public.auth_can_access_operational_scope(p_contract_id, p_up3_id, p_unit_id) $$;
do $$ begin
  if not exists (select 1 from pg_policies where policyname='feeders_select_authenticated' and tablename='feeders') then
    create policy feeders_select_authenticated on public.feeders for select to authenticated using (public.auth_can_access_variable_scope(contract_id, up3_id, unit_id));
  end if;
  if not exists (select 1 from pg_policies where policyname='variable_entries_select_authenticated' and tablename='variable_cost_entries') then
    create policy variable_entries_select_authenticated on public.variable_cost_entries for select to authenticated using (public.auth_can_access_variable_scope(contract_id, up3_id, unit_id));
  end if;
  if not exists (select 1 from pg_policies where policyname='variable_personnel_select_authenticated' and tablename='variable_cost_entry_personnel') then
    create policy variable_personnel_select_authenticated on public.variable_cost_entry_personnel for select to authenticated using (exists (select 1 from public.variable_cost_entries e where e.id = variable_cost_entry_personnel.variable_cost_entry_id and public.auth_can_access_variable_scope(e.contract_id, e.up3_id, e.unit_id)));
  end if;
  if not exists (select 1 from pg_policies where policyname='variable_evidence_select_authenticated' and tablename='variable_cost_evidence') then
    create policy variable_evidence_select_authenticated on public.variable_cost_evidence for select to authenticated using (exists (select 1 from public.variable_cost_entries e where e.id = variable_cost_evidence.variable_cost_entry_id and public.auth_can_access_variable_scope(e.contract_id, e.up3_id, e.unit_id)));
  end if;
  if not exists (select 1 from pg_policies where policyname='variable_history_select_authenticated' and tablename='variable_cost_status_history') then
    create policy variable_history_select_authenticated on public.variable_cost_status_history for select to authenticated using (exists (select 1 from public.variable_cost_entries e where e.id = variable_cost_status_history.variable_cost_entry_id and public.auth_can_access_variable_scope(e.contract_id, e.up3_id, e.unit_id)));
  end if;
end $$;
grant select on public.feeders, public.variable_cost_entries, public.variable_cost_entry_personnel, public.variable_cost_evidence, public.variable_cost_status_history to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='sla_targets' and policyname='sla_targets_select_variable') then
    create policy sla_targets_select_variable on public.sla_targets for select to authenticated using (public.auth_can_access_variable_scope(contract_id, up3_id, coalesce(unit_id, up3_id)));
  end if;
  if not exists (select 1 from pg_policies where tablename='sla_entries' and policyname='sla_entries_select_variable') then
    create policy sla_entries_select_variable on public.sla_entries for select to authenticated using (public.auth_can_access_variable_scope(contract_id, up3_id, unit_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='sla_indicators' and policyname='sla_indicators_select_variable') then
    create policy sla_indicators_select_variable on public.sla_indicators for select to authenticated using (exists (select 1 from public.sla_versions v where v.id = sla_indicators.sla_version_id and public.auth_can_access_operational_up3(v.contract_id, v.up3_id)));
  end if;
  if not exists (select 1 from pg_policies where tablename='sla_versions' and policyname='sla_versions_select_variable') then
    create policy sla_versions_select_variable on public.sla_versions for select to authenticated using (public.auth_can_access_operational_up3(contract_id, up3_id) or public.auth_is_super_admin());
  end if;
end $$;
grant select on public.sla_targets, public.sla_entries, public.sla_indicators, public.sla_versions, public.sla_sections, public.sla_scopes to authenticated;
create or replace function public.create_feeder_proposal(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_name text, p_code text default null) returns public.feeders language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.feeders%rowtype; begin if not public.auth_can_access_variable_scope(p_contract_id, p_up3_id, p_unit_id) then raise exception 'access denied'; end if; if exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=p_contract_id and cm.operational_up3_id=p_up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to)) then raise exception 'ADMIN_UP3 must use direct create'; end if; insert into public.feeders (contract_id, up3_id, unit_id, name, code, status, proposed_by, proposed_at, created_by, updated_by) values (p_contract_id, p_up3_id, p_unit_id, btrim(p_name), nullif(btrim(p_code),''), 'PENDING', auth.uid(), now(), auth.uid(), auth.uid()) returning * into v_row; return v_row; end; $$;
create or replace function public.create_feeder_direct(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_name text, p_code text default null) returns public.feeders language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.feeders%rowtype; begin if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=p_contract_id and cm.operational_up3_id=p_up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then raise exception 'only ADMIN_UP3 or SUPER_ADMIN can create direct feeder'; end if; if not public.auth_can_access_variable_scope(p_contract_id, p_up3_id, p_unit_id) then raise exception 'access denied'; end if; insert into public.feeders (contract_id, up3_id, unit_id, name, code, status, proposed_by, proposed_at, reviewed_by, reviewed_at, created_by, updated_by) values (p_contract_id, p_up3_id, p_unit_id, btrim(p_name), nullif(btrim(p_code),''), 'ACTIVE', auth.uid(), now(), auth.uid(), now(), auth.uid(), auth.uid()) returning * into v_row; return v_row; end; $$;
create or replace function public.approve_feeder(p_feeder_id uuid) returns public.feeders language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.feeders%rowtype; begin select * into v_row from public.feeders where id=p_feeder_id for update; if not found then raise exception 'feeder not found'; end if; if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=v_row.contract_id and cm.operational_up3_id=v_row.up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then raise exception 'only ADMIN_UP3 can approve'; end if; if v_row.status <> 'PENDING' then raise exception 'only PENDING can be approved'; end if; update public.feeders set status='ACTIVE', reviewed_by=auth.uid(), reviewed_at=now(), updated_by=auth.uid(), rejection_reason=null where id=p_feeder_id returning * into v_row; return v_row; end; $$;
create or replace function public.reject_feeder(p_feeder_id uuid, p_reason text) returns public.feeders language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.feeders%rowtype; begin if p_reason is null or btrim(p_reason)='' then raise exception 'rejection_reason required'; end if; select * into v_row from public.feeders where id=p_feeder_id for update; if not found then raise exception 'feeder not found'; end if; if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=v_row.contract_id and cm.operational_up3_id=v_row.up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then raise exception 'only ADMIN_UP3 can reject'; end if; if v_row.status <> 'PENDING' then raise exception 'only PENDING can be rejected'; end if; update public.feeders set status='REJECTED', reviewed_by=auth.uid(), reviewed_at=now(), updated_by=auth.uid(), rejection_reason=btrim(p_reason) where id=p_feeder_id returning * into v_row; return v_row; end; $$;
create or replace function public.deactivate_feeder(p_feeder_id uuid) returns public.feeders language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.feeders%rowtype; begin select * into v_row from public.feeders where id=p_feeder_id for update; if not found then raise exception 'feeder not found'; end if; if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=v_row.contract_id and cm.operational_up3_id=v_row.up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then raise exception 'only ADMIN_UP3 can deactivate'; end if; if v_row.status <> 'ACTIVE' then raise exception 'only ACTIVE can be deactivated'; end if; update public.feeders set status='INACTIVE', updated_by=auth.uid() where id=p_feeder_id returning * into v_row; return v_row; end; $$;
create or replace function public.activate_feeder(p_feeder_id uuid) returns public.feeders language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.feeders%rowtype; begin select * into v_row from public.feeders where id=p_feeder_id for update; if not found then raise exception 'feeder not found'; end if; if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=v_row.contract_id and cm.operational_up3_id=v_row.up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then raise exception 'only ADMIN_UP3 can activate'; end if; if v_row.status <> 'INACTIVE' then raise exception 'only INACTIVE can be activated'; end if; update public.feeders set status='ACTIVE', updated_by=auth.uid() where id=p_feeder_id returning * into v_row; return v_row; end; $$;
create or replace function public.delete_feeder(p_feeder_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.feeders%rowtype; begin select * into v_row from public.feeders where id=p_feeder_id for update; if not found then raise exception 'feeder not found'; end if; if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=v_row.contract_id and cm.operational_up3_id=v_row.up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then raise exception 'only ADMIN_UP3 can delete'; end if; if exists (select 1 from public.variable_cost_entries where feeder_id = p_feeder_id) then raise exception 'feeder already referenced, deactivate instead'; end if; delete from public.feeders where id=p_feeder_id; end; $$;
create or replace function public.save_variable_cost_entry(p_entry_id uuid, p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_sla_version_id uuid, p_indicator_id uuid, p_work_date date, p_feeder_id uuid, p_location_address text, p_work_order numeric, p_realization numeric, p_revenue_amount numeric, p_description text, p_employee_ids uuid[]) returns public.variable_cost_entries language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile text; v_row public.variable_cost_entries%rowtype; v_existing public.variable_cost_entries%rowtype; v_feeder_status text;
begin
  if not public.auth_can_access_variable_scope(p_contract_id, p_up3_id, p_unit_id) then raise exception 'access denied'; end if;
  if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_ULP' and cm.contract_id=p_contract_id and cm.operational_up3_id=p_up3_id and cm.operational_unit_id=p_unit_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then raise exception 'only own ULP can save variable entry'; end if;
  select variable_cost_profile into v_profile from public.sla_indicators where id=p_indicator_id and sla_version_id=p_sla_version_id;
  if v_profile is null then v_profile := case when p_feeder_id is not null then 'STANDARD' else 'KONSTRUKSI' end; end if;
  if v_profile = 'STANDARD' then
    if p_feeder_id is null then raise exception 'penyulang required for standard indicator'; end if;
    select status into v_feeder_status from public.feeders where id=p_feeder_id;
    if v_feeder_status is distinct from 'ACTIVE' then raise exception 'penyulang must be ACTIVE'; end if;
    if p_revenue_amount is not null then raise exception 'revenue_amount must be null for standard'; end if;
    if p_work_order is null or p_realization is null then raise exception 'WO and Realisasi required for standard'; end if;
  elsif v_profile = 'KONSTRUKSI' then
    if p_feeder_id is not null then raise exception 'penyulang must be null for Konstruksi'; end if;
    if p_work_order is not null or p_realization is not null then raise exception 'WO/Realisasi must be null for Konstruksi'; end if;
    if p_revenue_amount is null or p_revenue_amount < 0 then raise exception 'revenue_amount required for Konstruksi'; end if;
  else raise exception 'unknown indicator profile'; end if;
  if p_entry_id is null then
    insert into public.variable_cost_entries (contract_id, up3_id, unit_id, sla_version_id, indicator_id, work_date, feeder_id, location_address, work_order, realization, revenue_amount, description, status, created_by, updated_by)
    values (p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id, p_work_date, p_feeder_id, nullif(btrim(p_location_address),''), p_work_order, p_realization, p_revenue_amount, nullif(btrim(p_description),''), 'DRAFT', auth.uid(), auth.uid()) returning * into v_row;
  else
    select * into v_existing from public.variable_cost_entries where id=p_entry_id for update;
    if not found then raise exception 'entry not found'; end if;
    if v_existing.status not in ('DRAFT','REJECTED') then raise exception 'only DRAFT/REJECTED can be edited'; end if;
    if v_existing.contract_id is distinct from p_contract_id or v_existing.up3_id is distinct from p_up3_id or v_existing.unit_id is distinct from p_unit_id then raise exception 'scope immutable'; end if;
    update public.variable_cost_entries set feeder_id=p_feeder_id, location_address=nullif(btrim(p_location_address),''), work_order=p_work_order, realization=p_realization, revenue_amount=p_revenue_amount, description=nullif(btrim(p_description),''), work_date=p_work_date, sla_version_id=p_sla_version_id, indicator_id=p_indicator_id, updated_by=auth.uid() where id=p_entry_id returning * into v_row;
  end if;
  if p_employee_ids is not null and array_length(p_employee_ids,1) > 0 then
    delete from public.variable_cost_entry_personnel where variable_cost_entry_id = v_row.id;
    insert into public.variable_cost_entry_personnel (variable_cost_entry_id, employee_id, created_by) select v_row.id, eid, auth.uid() from unnest(p_employee_ids) eid on conflict do nothing;
  end if;
  insert into public.variable_cost_status_history (variable_cost_entry_id, from_status, to_status, changed_by) values (v_row.id, v_existing.status, v_row.status, auth.uid());
  return v_row;
end; $$;
create or replace function public.submit_variable_cost_entry(p_entry_id uuid) returns public.variable_cost_entries language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.variable_cost_entries%rowtype; begin select * into v_row from public.variable_cost_entries where id=p_entry_id for update; if not found then raise exception 'entry not found'; end if; if not public.auth_can_access_variable_scope(v_row.contract_id, v_row.up3_id, v_row.unit_id) then raise exception 'access denied'; end if; if v_row.status not in ('DRAFT','REJECTED') then raise exception 'only DRAFT/REJECTED can be submitted'; end if; if not exists (select 1 from public.variable_cost_evidence where variable_cost_entry_id=p_entry_id) then raise exception 'minimum 1 evidence required on submit'; end if; update public.variable_cost_entries set status='SUBMITTED', submitted_at=now(), submitted_by=auth.uid(), rejected_at=null, rejected_by=null, rejection_reason=null, updated_by=auth.uid() where id=p_entry_id returning * into v_row; insert into public.variable_cost_status_history (variable_cost_entry_id, from_status, to_status, changed_by) values (p_entry_id, 'DRAFT', 'SUBMITTED', auth.uid()); return v_row; end; $$;
create or replace function public.approve_variable_cost_entry(p_entry_id uuid) returns public.variable_cost_entries language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.variable_cost_entries%rowtype; begin select * into v_row from public.variable_cost_entries where id=p_entry_id for update; if not found then raise exception 'entry not found'; end if; if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=v_row.contract_id and cm.operational_up3_id=v_row.up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then raise exception 'only ADMIN_UP3 can approve'; end if; if v_row.status <> 'SUBMITTED' then raise exception 'only SUBMITTED can be approved'; end if; update public.variable_cost_entries set status='APPROVED', approved_at=now(), approved_by=auth.uid(), updated_by=auth.uid() where id=p_entry_id returning * into v_row; insert into public.variable_cost_status_history (variable_cost_entry_id, from_status, to_status, changed_by) values (p_entry_id, 'SUBMITTED', 'APPROVED', auth.uid()); perform public.sync_variable_cost_month(v_row.contract_id, v_row.up3_id, v_row.unit_id, v_row.sla_version_id, v_row.indicator_id, date_trunc('month', v_row.work_date)::date); return v_row; end; $$;
create or replace function public.reject_variable_cost_entry(p_entry_id uuid, p_reason text) returns public.variable_cost_entries language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.variable_cost_entries%rowtype; begin if p_reason is null or btrim(p_reason)='' then raise exception 'rejection_reason required'; end if; select * into v_row from public.variable_cost_entries where id=p_entry_id for update; if not found then raise exception 'entry not found'; end if; if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=v_row.contract_id and cm.operational_up3_id=v_row.up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then raise exception 'only ADMIN_UP3 can reject'; end if; if v_row.status <> 'SUBMITTED' then raise exception 'only SUBMITTED can be rejected'; end if; update public.variable_cost_entries set status='REJECTED', rejected_at=now(), rejected_by=auth.uid(), rejection_reason=btrim(p_reason), updated_by=auth.uid() where id=p_entry_id returning * into v_row; insert into public.variable_cost_status_history (variable_cost_entry_id, from_status, to_status, changed_by, reason) values (p_entry_id, 'SUBMITTED', 'REJECTED', auth.uid(), btrim(p_reason)); return v_row; end; $$;
create or replace function public.set_variable_target(p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_sla_version_id uuid, p_indicator_id uuid, p_period_month date, p_target_value numeric) returns public.sla_targets language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.sla_targets%rowtype; begin if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=p_contract_id and cm.operational_up3_id=p_up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then raise exception 'only ADMIN_UP3 can set target'; end if; if not public.auth_can_access_variable_scope(p_contract_id, p_up3_id, p_unit_id) then raise exception 'access denied'; end if; if p_target_value is null or p_target_value < 0 then raise exception 'target_value invalid'; end if; insert into public.sla_targets (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month, target_scope, target_value, created_by, updated_by) values (p_contract_id, p_up3_id, p_unit_id, p_sla_version_id, p_indicator_id, date_trunc('month', p_period_month::timestamp)::date, 'ULP', p_target_value, auth.uid(), auth.uid()) on conflict (contract_id, up3_id, unit_id, sla_version_id, indicator_id, period_month) where target_scope='ULP' and unit_id is not null do update set target_value=excluded.target_value, updated_by=auth.uid() returning * into v_row; return v_row; end; $$;
create or replace function public.get_variable_evidence_upload_path(p_entry_id uuid, p_file_name text) returns text language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.variable_cost_entries%rowtype; v_ext text; v_path text; begin select * into v_row from public.variable_cost_entries where id=p_entry_id; if not found then raise exception 'entry not found'; end if; if not public.auth_can_access_variable_scope(v_row.contract_id, v_row.up3_id, v_row.unit_id) then raise exception 'access denied'; end if; v_ext := lower(split_part(p_file_name, '.', -1)); v_path := format('variable/%s/%s/%s/%s-%s.%s', v_row.contract_id, v_row.up3_id, v_row.unit_id, p_entry_id, gen_random_uuid(), v_ext); return v_path; end; $$;
revoke execute on function public.create_feeder_proposal(uuid,uuid,uuid,text,text) from public, anon;
revoke execute on function public.create_feeder_direct(uuid,uuid,uuid,text,text) from public, anon;
revoke execute on function public.approve_feeder(uuid) from public, anon;
revoke execute on function public.reject_feeder(uuid,text) from public, anon;
revoke execute on function public.deactivate_feeder(uuid) from public, anon;
revoke execute on function public.activate_feeder(uuid) from public, anon;
revoke execute on function public.delete_feeder(uuid) from public, anon;
revoke execute on function public.submit_variable_cost_entry(uuid) from public, anon;
revoke execute on function public.approve_variable_cost_entry(uuid) from public, anon;
revoke execute on function public.reject_variable_cost_entry(uuid,text) from public, anon;
revoke execute on function public.set_variable_target(uuid,uuid,uuid,uuid,uuid,date,numeric) from public, anon;
revoke execute on function public.get_variable_evidence_upload_path(uuid,text) from public, anon;
grant execute on function public.create_feeder_proposal(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.create_feeder_direct(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.approve_feeder(uuid) to authenticated;
grant execute on function public.reject_feeder(uuid,text) to authenticated;
grant execute on function public.deactivate_feeder(uuid) to authenticated;
grant execute on function public.activate_feeder(uuid) to authenticated;
grant execute on function public.delete_feeder(uuid) to authenticated;
grant execute on function public.submit_variable_cost_entry(uuid) to authenticated;

grant execute on function public.approve_variable_cost_entry(uuid) to authenticated;
grant execute on function public.reject_variable_cost_entry(uuid,text) to authenticated;
grant execute on function public.set_variable_target(uuid,uuid,uuid,uuid,uuid,date,numeric) to authenticated;
grant execute on function public.get_variable_evidence_upload_path(uuid,text) to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='variable_evidence_select') then
    create policy variable_evidence_select on storage.objects for select to authenticated using (bucket_id='variable-cost-evidence' and public.auth_can_access_variable_scope((string_to_array(name,'/'))[2]::uuid, (string_to_array(name,'/'))[3]::uuid, (string_to_array(name,'/'))[4]::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='variable_evidence_insert') then
    create policy variable_evidence_insert on storage.objects for insert to authenticated with check (bucket_id='variable-cost-evidence');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='variable_evidence_delete') then
    create policy variable_evidence_delete on storage.objects for delete to authenticated using (bucket_id='variable-cost-evidence');
  end if;
end $$;
