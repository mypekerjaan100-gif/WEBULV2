-- Fix parsing of entry_id in storage path (UUID contains dashes, split_part failed)
create or replace function public.auth_can_upload_variable_evidence_object(p_storage_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_parts text[];
  v_contract uuid;
  v_up3 uuid;
  v_unit uuid;
  v_entry_id uuid;
  v_filename text;
begin
  if auth.uid() is null then return false; end if;
  v_parts := string_to_array(p_storage_path, '/');
  if array_length(v_parts, 1) != 5 then return false; end if;
  if v_parts[1] != 'variable' then return false; end if;
  begin
    v_contract := v_parts[2]::uuid;
    v_up3 := v_parts[3]::uuid;
    v_unit := v_parts[4]::uuid;
    v_filename := v_parts[5];
    v_entry_id := substring(v_filename from 1 for 36)::uuid;
  exception when others then
    return false;
  end;
  return exists (
    select 1 from public.variable_cost_entries e
    where e.id = v_entry_id
      and e.contract_id = v_contract
      and e.up3_id = v_up3
      and e.unit_id = v_unit
      and e.status in ('DRAFT','REJECTED')
      and public.auth_can_access_variable_scope(e.contract_id, e.up3_id, e.unit_id)
  );
end;
$$;

create or replace function public.auth_can_read_variable_evidence_object(p_storage_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry_id uuid;
  v_filename text;
  v_parts text[];
begin
  if auth.uid() is null then return false; end if;
  if exists (
    select 1 from public.variable_cost_evidence ev
    join public.variable_cost_entries e on e.id = ev.variable_cost_entry_id
    where ev.storage_path = p_storage_path
      and public.auth_can_access_variable_scope(e.contract_id, e.up3_id, e.unit_id)
  ) then return true; end if;
  v_parts := string_to_array(p_storage_path, '/');
  if array_length(v_parts, 1) = 5 and v_parts[1] = 'variable' then
    begin
      v_filename := v_parts[5];
      v_entry_id := substring(v_filename from 1 for 36)::uuid;
      return exists (
        select 1 from public.variable_cost_entries e
        where e.id = v_entry_id
          and public.auth_can_access_variable_scope(e.contract_id, e.up3_id, e.unit_id)
      );
    exception when others then
      return false;
    end;
  end if;
  return false;
end;
$$;
notify pgrst, 'reload schema';
