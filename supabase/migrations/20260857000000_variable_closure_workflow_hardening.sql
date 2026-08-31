-- Final Variable closure: exact ULP mutations, canonical units/personnel, and accurate transitions.
create or replace function public.auth_can_mutate_variable_entry_scope(
  p_contract_id uuid,p_up3_id uuid,p_unit_id uuid
) returns boolean
language sql stable security definer set search_path=public,pg_temp
as $function$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists(
      select 1 from public.contract_memberships membership
      where membership.user_id=auth.uid() and membership.contract_role='ADMIN_ULP'
        and membership.contract_id=p_contract_id and membership.operational_up3_id=p_up3_id
        and membership.operational_unit_id=p_unit_id and membership.status='ACTIVE'
        and membership.effective_from<=current_date
        and (membership.effective_to is null or current_date<membership.effective_to)
    )
  );
$function$;

revoke all on function public.auth_can_mutate_variable_entry_scope(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.save_variable_cost_entry(
  p_entry_id uuid,p_contract_id uuid,p_up3_id uuid,p_unit_id uuid,p_sla_version_id uuid,
  p_indicator_id uuid,p_work_date date,p_feeder_id uuid,p_location_address text,
  p_work_order numeric,p_realization numeric,p_revenue_amount numeric,p_description text,p_employee_ids uuid[]
) returns public.variable_cost_entries
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_profile text;v_row public.variable_cost_entries%rowtype;v_existing public.variable_cost_entries%rowtype;
  v_feeder_status text;v_measurement_unit text;
begin
  if not public.auth_can_mutate_variable_entry_scope(p_contract_id,p_up3_id,p_unit_id) then raise exception 'only own ULP can save variable entry' using errcode='42501'; end if;
  if p_work_date is null then raise exception 'work_date is required'; end if;

  if public.is_tebang_variable_indicator(p_indicator_id) then
    v_profile:='STANDARD';v_measurement_unit:='batang';
  else
    select indicator.variable_cost_profile,indicator.measurement_unit into v_profile,v_measurement_unit
    from public.sla_indicators indicator
    where indicator.id=p_indicator_id and indicator.sla_version_id=p_sla_version_id and indicator.input_mode='VARIABLE_COST';
  end if;

  if v_profile='STANDARD' then
    if p_feeder_id is null then raise exception 'penyulang required for standard indicator'; end if;
    select status into v_feeder_status from public.feeders where id=p_feeder_id and contract_id=p_contract_id and up3_id=p_up3_id and unit_id=p_unit_id;
    if v_feeder_status is distinct from 'ACTIVE' then raise exception 'penyulang must be ACTIVE and belong to own ULP'; end if;
    if p_revenue_amount is not null then raise exception 'revenue_amount must be null for standard'; end if;
    if p_work_order is null or p_realization is null then raise exception 'WO and Realisasi required for standard'; end if;
    if v_measurement_unit is null then raise exception 'canonical measurement unit is unavailable'; end if;
  elsif v_profile='KONSTRUKSI' then
    if p_feeder_id is not null then raise exception 'penyulang must be null for Konstruksi'; end if;
    if p_work_order is not null or p_realization is not null then raise exception 'WO/Realisasi must be null for Konstruksi'; end if;
    if p_revenue_amount is null or p_revenue_amount<0 then raise exception 'revenue_amount required for Konstruksi'; end if;
  else
    raise exception 'unknown indicator profile';
  end if;

  if coalesce(cardinality(p_employee_ids),0)=0 then raise exception 'minimum 1 active employee from own ULP is required'; end if;
  if cardinality(p_employee_ids)<>(select count(distinct supplied.employee_id) from unnest(p_employee_ids) as supplied(employee_id)) then raise exception 'duplicate employee_id'; end if;
  if exists(
    select 1 from unnest(p_employee_ids) as supplied(employee_id)
    where not exists(
      select 1 from public.employee_unit_history unit_history
      where unit_history.employee_id=supplied.employee_id and unit_history.contract_id=p_contract_id
        and unit_history.up3_id=p_up3_id and unit_history.unit_id=p_unit_id
        and unit_history.effective_from<=p_work_date
        and (unit_history.effective_to is null or p_work_date<unit_history.effective_to)
    ) or not exists(
      select 1 from public.employee_status_history status_history
      where status_history.employee_id=supplied.employee_id and status_history.status='Aktif'
        and status_history.effective_from<=p_work_date
        and (status_history.effective_to is null or p_work_date<status_history.effective_to)
    )
  ) then raise exception 'employee must be active in the entry ULP on work_date'; end if;

  if p_entry_id is null then
    insert into public.variable_cost_entries(contract_id,up3_id,unit_id,sla_version_id,indicator_id,work_date,measurement_unit,feeder_id,location_address,work_order,realization,revenue_amount,description,status,created_by,updated_by)
    values(p_contract_id,p_up3_id,p_unit_id,p_sla_version_id,p_indicator_id,p_work_date,v_measurement_unit,p_feeder_id,nullif(btrim(p_location_address),''),p_work_order,p_realization,p_revenue_amount,nullif(btrim(p_description),''),'DRAFT',auth.uid(),auth.uid()) returning * into v_row;
    insert into public.variable_cost_status_history(variable_cost_entry_id,from_status,to_status,changed_by) values(v_row.id,null,'DRAFT',auth.uid());
  else
    select * into v_existing from public.variable_cost_entries where id=p_entry_id for update;
    if not found then raise exception 'entry not found'; end if;
    if v_existing.status not in ('DRAFT','REJECTED') then raise exception 'only DRAFT/REJECTED can be edited'; end if;
    if v_existing.contract_id is distinct from p_contract_id or v_existing.up3_id is distinct from p_up3_id or v_existing.unit_id is distinct from p_unit_id then raise exception 'scope immutable'; end if;
    update public.variable_cost_entries set feeder_id=p_feeder_id,location_address=nullif(btrim(p_location_address),''),work_order=p_work_order,realization=p_realization,revenue_amount=p_revenue_amount,description=nullif(btrim(p_description),''),work_date=p_work_date,measurement_unit=v_measurement_unit,sla_version_id=p_sla_version_id,indicator_id=p_indicator_id,updated_by=auth.uid() where id=p_entry_id returning * into v_row;
  end if;

  delete from public.variable_cost_entry_personnel where variable_cost_entry_id=v_row.id;
  insert into public.variable_cost_entry_personnel(variable_cost_entry_id,employee_id,created_by) select v_row.id,supplied.employee_id,auth.uid() from unnest(p_employee_ids) as supplied(employee_id);
  return v_row;
end;
$function$;

create or replace function public.submit_variable_cost_entry(p_entry_id uuid)
returns public.variable_cost_entries
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_row public.variable_cost_entries%rowtype;v_from_status text;
begin
  select * into v_row from public.variable_cost_entries where id=p_entry_id for update;
  if not found then raise exception 'entry not found'; end if;
  if not public.auth_can_mutate_variable_entry_scope(v_row.contract_id,v_row.up3_id,v_row.unit_id) then raise exception 'only own ULP can submit variable entry' using errcode='42501'; end if;
  if v_row.status not in ('DRAFT','REJECTED') then raise exception 'only DRAFT/REJECTED can be submitted'; end if;
  if not exists(select 1 from public.variable_cost_evidence where variable_cost_entry_id=p_entry_id) then raise exception 'minimum 1 evidence required on submit'; end if;
  v_from_status:=v_row.status;
  update public.variable_cost_entries set status='SUBMITTED',submitted_at=now(),submitted_by=auth.uid(),rejected_at=null,rejected_by=null,rejection_reason=null,updated_by=auth.uid() where id=p_entry_id returning * into v_row;
  insert into public.variable_cost_status_history(variable_cost_entry_id,from_status,to_status,changed_by) values(p_entry_id,v_from_status,'SUBMITTED',auth.uid());
  return v_row;
end;
$function$;

create or replace function public.get_variable_evidence_upload_path(p_entry_id uuid,p_file_name text)
returns text
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_row public.variable_cost_entries%rowtype;v_ext text;
begin
  select * into v_row from public.variable_cost_entries where id=p_entry_id;
  if not found then raise exception 'entry not found'; end if;
  if v_row.status not in ('DRAFT','REJECTED') or not public.auth_can_mutate_variable_entry_scope(v_row.contract_id,v_row.up3_id,v_row.unit_id) then raise exception 'only own ULP can upload evidence' using errcode='42501'; end if;
  v_ext:=lower(split_part(coalesce(nullif(btrim(p_file_name),''),'bin'),'.',-1));
  if v_ext='' or v_ext=lower(btrim(p_file_name)) or v_ext!~'^[a-z0-9]{1,10}$' then v_ext:='bin'; end if;
  return format('variable/%s/%s/%s/%s-%s.%s',v_row.contract_id,v_row.up3_id,v_row.unit_id,p_entry_id,gen_random_uuid(),v_ext);
end;
$function$;

create or replace function public.auth_can_upload_variable_evidence_object(p_storage_path text)
returns boolean
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_parts text[];v_contract uuid;v_up3 uuid;v_unit uuid;v_entry_id uuid;
begin
  if auth.uid() is null then return false; end if;
  v_parts:=string_to_array(p_storage_path,'/');
  if array_length(v_parts,1)<>5 or v_parts[1]<>'variable' then return false; end if;
  begin v_contract:=v_parts[2]::uuid;v_up3:=v_parts[3]::uuid;v_unit:=v_parts[4]::uuid;v_entry_id:=split_part(v_parts[5],'-',1)::uuid;exception when others then return false;end;
  return exists(select 1 from public.variable_cost_entries entry where entry.id=v_entry_id and entry.contract_id=v_contract and entry.up3_id=v_up3 and entry.unit_id=v_unit and entry.status in ('DRAFT','REJECTED') and public.auth_can_mutate_variable_entry_scope(entry.contract_id,entry.up3_id,entry.unit_id));
end;
$function$;

create or replace function public.auth_can_delete_variable_evidence_object(p_storage_path text)
returns boolean
language sql stable security definer set search_path=public,pg_temp
as $function$
  select exists(
    select 1 from public.variable_cost_evidence evidence
    join public.variable_cost_entries entry on entry.id=evidence.variable_cost_entry_id
    where evidence.storage_path=p_storage_path and entry.status in ('DRAFT','REJECTED')
      and public.auth_can_mutate_variable_entry_scope(entry.contract_id,entry.up3_id,entry.unit_id)
  );
$function$;

drop policy if exists variable_evidence_insert on public.variable_cost_evidence;
drop policy if exists variable_evidence_delete on public.variable_cost_evidence;
create policy variable_evidence_insert on public.variable_cost_evidence for insert to authenticated with check(
  exists(select 1 from public.variable_cost_entries entry where entry.id=variable_cost_entry_id and entry.status in ('DRAFT','REJECTED') and public.auth_can_mutate_variable_entry_scope(entry.contract_id,entry.up3_id,entry.unit_id))
);
create policy variable_evidence_delete on public.variable_cost_evidence for delete to authenticated using(
  exists(select 1 from public.variable_cost_entries entry where entry.id=variable_cost_entry_id and entry.status in ('DRAFT','REJECTED') and public.auth_can_mutate_variable_entry_scope(entry.contract_id,entry.up3_id,entry.unit_id))
);
grant select,insert,delete on public.variable_cost_evidence to authenticated;

update public.variable_cost_entries entry
set measurement_unit=coalesce(indicator.measurement_unit,case when public.is_tebang_variable_indicator(entry.indicator_id) then 'batang' end)
from public.sla_indicators indicator
where indicator.id=entry.indicator_id and entry.measurement_unit is null;

update public.variable_cost_entries set measurement_unit='batang'
where measurement_unit is null and public.is_tebang_variable_indicator(indicator_id);

update public.sla_entries entry
set measurement_unit=indicator.measurement_unit
from public.sla_indicators indicator
where indicator.id=entry.indicator_id and entry.measurement_unit is null
  and indicator.input_mode='VARIABLE_COST' and indicator.point_code in ('2.1a','2.1b','2.1c','2.1d','3.1a','3.1b','3.2a','3.2b');

revoke all on function public.save_variable_cost_entry(uuid,uuid,uuid,uuid,uuid,uuid,date,uuid,text,numeric,numeric,numeric,text,uuid[]) from public,anon;
revoke all on function public.submit_variable_cost_entry(uuid) from public,anon;
revoke all on function public.get_variable_evidence_upload_path(uuid,text) from public,anon;
revoke all on function public.auth_can_upload_variable_evidence_object(text) from public,anon;
revoke all on function public.auth_can_delete_variable_evidence_object(text) from public,anon;
grant execute on function public.save_variable_cost_entry(uuid,uuid,uuid,uuid,uuid,uuid,date,uuid,text,numeric,numeric,numeric,text,uuid[]) to authenticated;
grant execute on function public.submit_variable_cost_entry(uuid) to authenticated;
grant execute on function public.get_variable_evidence_upload_path(uuid,text) to authenticated;
grant execute on function public.auth_can_upload_variable_evidence_object(text) to authenticated;
grant execute on function public.auth_can_delete_variable_evidence_object(text) to authenticated;
notify pgrst,'reload schema';
