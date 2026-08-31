-- Require evidence metadata to reference a stored object.
create or replace function public.variable_evidence_object_exists(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $function$
  select exists(
    select 1
    from storage.objects object
    where object.bucket_id='variable-cost-evidence'
      and object.name=p_storage_path
  );
$function$;

revoke all on function public.variable_evidence_object_exists(text) from public,anon;
grant execute on function public.variable_evidence_object_exists(text) to authenticated;

drop policy if exists variable_evidence_insert on public.variable_cost_evidence;
create policy variable_evidence_insert on public.variable_cost_evidence
for insert to authenticated
with check(
  public.variable_evidence_object_exists(storage_path)
  and exists(
    select 1
    from public.variable_cost_entries entry
    where entry.id=variable_cost_entry_id
      and entry.status in ('DRAFT','REJECTED')
      and public.auth_can_mutate_variable_entry_scope(entry.contract_id,entry.up3_id,entry.unit_id)
  )
);

-- Permit cleanup of an authorized upload even when metadata insertion failed.
create or replace function public.auth_can_delete_variable_evidence_object(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $function$
  select public.auth_can_upload_variable_evidence_object(p_storage_path)
  or exists(
    select 1
    from public.variable_cost_evidence evidence
    join public.variable_cost_entries entry on entry.id=evidence.variable_cost_entry_id
    where evidence.storage_path=p_storage_path
      and entry.status in ('DRAFT','REJECTED')
      and public.auth_can_mutate_variable_entry_scope(entry.contract_id,entry.up3_id,entry.unit_id)
  );
$function$;

-- Submission requires both metadata and the corresponding storage object.
create or replace function public.submit_variable_cost_entry(p_entry_id uuid)
returns public.variable_cost_entries
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_row public.variable_cost_entries%rowtype;
  v_from_status text;
begin
  select * into v_row from public.variable_cost_entries where id=p_entry_id for update;
  if not found then raise exception 'entry not found'; end if;
  if not public.auth_can_mutate_variable_entry_scope(v_row.contract_id,v_row.up3_id,v_row.unit_id) then
    raise exception 'only own ULP can submit variable entry' using errcode='42501';
  end if;
  if v_row.status not in ('DRAFT','REJECTED') then raise exception 'only DRAFT/REJECTED can be submitted'; end if;
  if not exists(
    select 1
    from public.variable_cost_evidence evidence
    join storage.objects object
      on object.bucket_id='variable-cost-evidence'
      and object.name=evidence.storage_path
    where evidence.variable_cost_entry_id=p_entry_id
  ) then
    raise exception 'minimum 1 evidence required on submit';
  end if;
  v_from_status:=v_row.status;
  update public.variable_cost_entries
  set status='SUBMITTED',submitted_at=now(),submitted_by=auth.uid(),rejected_at=null,rejected_by=null,rejection_reason=null,updated_by=auth.uid()
  where id=p_entry_id
  returning * into v_row;
  insert into public.variable_cost_status_history(variable_cost_entry_id,from_status,to_status,changed_by)
  values(p_entry_id,v_from_status,'SUBMITTED',auth.uid());
  return v_row;
end;
$function$;

-- Keep same-status edits visible without duplicating submit/approve/reject history.
create or replace function public.audit_variable_cost_entry_edit()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
begin
  if new.status=old.status then
    insert into public.variable_cost_status_history(variable_cost_entry_id,from_status,to_status,changed_by)
    values(new.id,old.status,new.status,auth.uid());
  end if;
  return new;
end;
$function$;

drop trigger if exists audit_variable_cost_entry_edit on public.variable_cost_entries;
create trigger audit_variable_cost_entry_edit
after update on public.variable_cost_entries
for each row execute function public.audit_variable_cost_entry_edit();

revoke all on function public.auth_can_delete_variable_evidence_object(text) from public,anon;
revoke all on function public.submit_variable_cost_entry(uuid) from public,anon;
grant execute on function public.auth_can_delete_variable_evidence_object(text) to authenticated;
grant execute on function public.submit_variable_cost_entry(uuid) to authenticated;
notify pgrst,'reload schema';
