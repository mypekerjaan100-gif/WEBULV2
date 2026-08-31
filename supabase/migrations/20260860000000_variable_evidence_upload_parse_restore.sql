-- Preserve UUID-aware path parsing while enforcing exact-ULP mutation scope.
create or replace function public.auth_can_upload_variable_evidence_object(p_storage_path text)
returns boolean
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_parts text[];
  v_contract uuid;
  v_up3 uuid;
  v_unit uuid;
  v_entry_id uuid;
begin
  if auth.uid() is null then return false; end if;
  v_parts:=string_to_array(p_storage_path,'/');
  if array_length(v_parts,1)<>5 or v_parts[1]<>'variable' then return false; end if;
  begin
    v_contract:=v_parts[2]::uuid;
    v_up3:=v_parts[3]::uuid;
    v_unit:=v_parts[4]::uuid;
    v_entry_id:=substring(v_parts[5] from 1 for 36)::uuid;
  exception when others then
    return false;
  end;
  return exists(
    select 1
    from public.variable_cost_entries entry
    where entry.id=v_entry_id
      and entry.contract_id=v_contract
      and entry.up3_id=v_up3
      and entry.unit_id=v_unit
      and entry.status in ('DRAFT','REJECTED')
      and public.auth_can_mutate_variable_entry_scope(entry.contract_id,entry.up3_id,entry.unit_id)
  );
end;
$function$;

revoke all on function public.auth_can_upload_variable_evidence_object(text) from public,anon;
grant execute on function public.auth_can_upload_variable_evidence_object(text) to authenticated;
notify pgrst,'reload schema';
