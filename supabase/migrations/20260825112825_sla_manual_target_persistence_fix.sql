create or replace function public.guard_sla_structure_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare ov uuid; nv uuid; s text; v_is_manual boolean := false;
begin
 if tg_op='DELETE' then ov:=old.sla_version_id; elsif tg_op='INSERT' then nv:=new.sla_version_id; else ov:=old.sla_version_id; nv:=new.sla_version_id; end if;
 if ov is not null then
   select status into s from public.sla_versions where id=ov;
   if s='ARCHIVED' then raise exception 'ARCHIVED SLA structure and targets are immutable'; end if;
   if tg_table_name = 'sla_indicators' and tg_op != 'DELETE' then
     select (old.input_mode = 'MANUAL') into v_is_manual;
   elsif tg_table_name = 'sla_indicators' and tg_op = 'DELETE' then
     select (old.input_mode = 'MANUAL') into v_is_manual;
   end if;
   if s='ACTIVE' and public.sla_version_is_referenced(ov) and not v_is_manual then raise exception 'Referenced ACTIVE SLA structure and targets are immutable; create a Draft Revision/Addendum'; end if;
   if s='ACTIVE' and public.sla_version_is_referenced(ov) and v_is_manual then null; end if;
 end if;
 if nv is not null and nv is distinct from ov then
   select status into s from public.sla_versions where id=nv;
   if s='ARCHIVED' then raise exception 'ARCHIVED SLA structure and targets are immutable'; end if;
   if tg_table_name = 'sla_indicators' then
     select (new.input_mode = 'MANUAL') into v_is_manual;
   end if;
   if s='ACTIVE' and public.sla_version_is_referenced(nv) and not v_is_manual then raise exception 'Referenced ACTIVE SLA structure and targets are immutable; create a Draft Revision/Addendum'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end
$$;
insert into public.sla_indicators (id, sla_version_id, section_id, scope_id, legacy_key, point_code, criteria, performance_target, evidence, weight_type, weight, input_mode, sort_order)
values
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','A-1.1a','1.1a','Manual SLA A-1.1a','Manual','Manual','Prioritas 1',2,'MANUAL',9),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','A-1.1b','1.1b','Manual SLA A-1.1b','Manual','Manual','Prioritas 1',2,'MANUAL',10),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','A-1.2','1.2','Manual SLA A-1.2','Manual','Manual','Prioritas 1',2,'MANUAL',11),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','A-1.3','1.3','Manual SLA A-1.3','Manual','Manual','Prioritas 1',2,'MANUAL',12),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','A-1.4','1.4','Manual SLA A-1.4','Manual','Manual','Prioritas 1',2,'MANUAL',13),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','A-3.3','3.3','Manual SLA A-3.3','Manual','Manual','Prioritas 1',1,'MANUAL',14),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','A-3.4a','3.4a','Manual SLA A-3.4a','Manual','Manual','Prioritas 1',2,'MANUAL',15),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','A-3.4b','3.4b','Manual SLA A-3.4b','Manual','Manual','Prioritas 1',2,'MANUAL',16),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','A-3.5','3.5','Manual SLA A-3.5','Manual','Manual','Prioritas 1',1,'MANUAL',17),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','B-1.1','1.1','Manual SLA B-1.1','Manual','Manual','Prioritas 1',2,'MANUAL',18),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','B-1.2a','1.2a','Manual SLA B-1.2a','Manual','Manual','Prioritas 1',2,'MANUAL',19),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','B-1.2b','1.2b','Manual SLA B-1.2b','Manual','Manual','Prioritas 1',2,'MANUAL',20),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','B-1.3a','1.3a','Manual SLA B-1.3a','Manual','Manual','Prioritas 1',2,'MANUAL',21),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','B-1.3b','1.3b','Manual SLA B-1.3b','Manual','Manual','Prioritas 1',2,'MANUAL',22),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','B-1.4a','1.4a','Manual SLA B-1.4a','Manual','Manual','Prioritas 1',2,'MANUAL',23),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','B-1.4b','1.4b','Manual SLA B-1.4b','Manual','Manual','Prioritas 1',2,'MANUAL',24),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','B-1.5','1.5','Manual SLA B-1.5','Manual','Manual','Prioritas 1',2,'MANUAL',25),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','B-1.6','1.6','Manual SLA B-1.6','Manual','Manual','Prioritas 1',2,'MANUAL',26),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','B-1.7','1.7','Manual SLA B-1.7','Manual','Manual','Prioritas 1',2,'MANUAL',27),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','B-2.1','2.1','Manual SLA B-2.1','Manual','Manual','Prioritas 1',2,'MANUAL',28),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','C-1.1','1.1','Manual SLA C-1.1','Manual','Manual','Prioritas 1',2,'MANUAL',29),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','C-1.2','1.2','Manual SLA C-1.2','Manual','Manual','Prioritas 1',2,'MANUAL',30),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','C-1.3','1.3','Manual SLA C-1.3','Manual','Manual','Prioritas 1',2,'MANUAL',31),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','C-1.4','1.4','Manual SLA C-1.4','Manual','Manual','Prioritas 1',2,'MANUAL',32),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','C-1.5a','1.5a','Manual SLA C-1.5a','Manual','Manual','Prioritas 1',2,'MANUAL',33),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','C-1.5b','1.5b','Manual SLA C-1.5b','Manual','Manual','Prioritas 1',2,'MANUAL',34),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','C-1.6','1.6','Manual SLA C-1.6','Manual','Manual','Prioritas 1',2,'MANUAL',35),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','C-1.7a','1.7a','Manual SLA C-1.7a','Manual','Manual','Prioritas 1',2,'MANUAL',36),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','C-1.7b','1.7b','Manual SLA C-1.7b','Manual','Manual','Prioritas 1',2,'MANUAL',37),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','C-1.8','1.8','Manual SLA C-1.8','Manual','Manual','Prioritas 1',2,'MANUAL',38),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','C-1.9','1.9','Manual SLA C-1.9','Manual','Manual','Prioritas 1',2,'MANUAL',39),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','D-1.1','1.1','Manual SLA D-1.1','Manual','Manual','Prioritas 1',2,'MANUAL',40),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','D-1.2','1.2','Manual SLA D-1.2','Manual','Manual','Prioritas 1',2,'MANUAL',41),
  (gen_random_uuid(),'96a2b610-3a1a-4a90-9803-ec4f0e994878','9d25d64a-8011-41db-8a69-5c3a2bd8a284','e1597bad-2e56-4291-988f-0561d29ba5d0','D-1.3','1.3','Manual SLA D-1.3','Manual','Manual','Prioritas 1',2,'MANUAL',42)
on conflict (sla_version_id, legacy_key) do nothing;
create or replace function public.guard_sla_target_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_version_id uuid;
  v_new_version_id uuid;
  v_status text;
  v_old_is_mutable boolean := false;
  v_new_is_mutable boolean := false;
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
    select (
      old.target_scope = 'ULP' and old.unit_id is not null and exists (
        select 1 from public.sla_indicators i
        where i.id = old.indicator_id and i.sla_version_id = old.sla_version_id
          and (
            (i.input_mode = 'VARIABLE_COST' and i.variable_cost_profile = 'STANDARD' and i.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1a','3.1b','3.2a','3.2b'))
            or (i.input_mode = 'MANUAL')
          )
      )
    ) into v_old_is_mutable;
    if v_status = 'ACTIVE' and public.sla_version_is_referenced(v_old_version_id) and not v_old_is_mutable then
      raise exception 'Referenced ACTIVE SLA structure and targets are immutable; create a Draft Revision/Addendum';
    end if;
    if tg_op = 'UPDATE' and v_old_is_mutable then
      if old.contract_id is distinct from new.contract_id
         or old.up3_id is distinct from new.up3_id
         or old.unit_id is distinct from new.unit_id
         or old.sla_version_id is distinct from new.sla_version_id
         or old.indicator_id is distinct from new.indicator_id
         or old.period_month is distinct from new.period_month
         or old.target_scope is distinct from new.target_scope then
        raise exception 'Referenced ACTIVE ULP target identity is immutable';
      end if;
    end if;
  end if;
  if v_new_version_id is not null then
    select status into v_status from public.sla_versions where id = v_new_version_id;
    if v_status = 'ARCHIVED' then raise exception 'ARCHIVED SLA targets are immutable'; end if;
    select (
      new.target_scope = 'ULP' and new.unit_id is not null and exists (
        select 1 from public.sla_indicators i
        where i.id = new.indicator_id and i.sla_version_id = new.sla_version_id
          and (
            (i.input_mode = 'VARIABLE_COST' and i.variable_cost_profile = 'STANDARD' and i.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1a','3.1b','3.2a','3.2b'))
            or (i.input_mode = 'MANUAL')
          )
      )
    ) into v_new_is_mutable;
    if v_status = 'ACTIVE' and public.sla_version_is_referenced(v_new_version_id) and not v_new_is_mutable then
      raise exception 'Referenced ACTIVE SLA structure and targets are immutable; create a Draft Revision/Addendum';
    end if;
  end if;
  if tg_op = 'DELETE' then
    if v_old_is_mutable and public.sla_version_is_referenced(v_old_version_id) then
      return old;
    end if;
    return old;
  end if;
  return new;
end;
$$;
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
  if not (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid()
        and cm.contract_role = 'ADMIN_UP3'
        and cm.contract_id = p_contract_id
        and cm.operational_up3_id = p_up3_id
        and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date
        and (cm.effective_to is null or current_date < cm.effective_to)
    )
  ) then raise exception 'only ADMIN_UP3 can set manual SLA target'; end if;
  if not public.auth_can_access_variable_scope(p_contract_id, p_up3_id, p_unit_id) then raise exception 'access denied'; end if;
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
revoke execute on function public.set_manual_sla_target(uuid,uuid,uuid,uuid,uuid,date,numeric) from public, anon;
grant execute on function public.set_manual_sla_target(uuid,uuid,uuid,uuid,uuid,date,numeric) to authenticated;
