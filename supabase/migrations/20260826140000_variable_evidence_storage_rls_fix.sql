-- Fix Variable evidence Storage RLS - was missing (caused "new row violates row-level security policy" on storage.objects INSERT)
-- Create helper functions and scoped policies for private bucket variable-cost-evidence

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
  -- expected: variable/{contract}/{up3}/{unit}/{entry}-{rand}.{ext}
  if array_length(v_parts, 1) != 5 then return false; end if;
  if v_parts[1] != 'variable' then return false; end if;
  begin
    v_contract := v_parts[2]::uuid;
    v_up3 := v_parts[3]::uuid;
    v_unit := v_parts[4]::uuid;
    v_filename := v_parts[5];
    v_entry_id := split_part(v_filename, '-', 1)::uuid;
  exception when others then
    return false;
  end;
  -- ensure entry exists and path scope matches entry scope, and user can access entry and entry is mutable
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
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.variable_cost_evidence ev
    join public.variable_cost_entries e on e.id = ev.variable_cost_entry_id
    where ev.storage_path = p_storage_path
      and public.auth_can_access_variable_scope(e.contract_id, e.up3_id, e.unit_id)
  )
  or exists (
    -- allow read if the path's entry is accessible even before metadata (for upload verification)
    select 1 from public.variable_cost_entries e
    where e.id::text = split_part(split_part(p_storage_path, '/', 5), '-', 1)
      and public.auth_can_access_variable_scope(e.contract_id, e.up3_id, e.unit_id)
  )
$$;

create or replace function public.auth_can_delete_variable_evidence_object(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.auth_can_read_variable_evidence_object(p_storage_path)
$$;

-- Recreate storage policies for variable bucket (scoped)
drop policy if exists "variable_evidence_select" on storage.objects;
drop policy if exists "variable_evidence_insert" on storage.objects;
drop policy if exists "variable_evidence_delete" on storage.objects;
drop policy if exists "variable_evidence_object_select" on storage.objects;
drop policy if exists "variable_evidence_object_insert" on storage.objects;
drop policy if exists "variable_evidence_object_delete" on storage.objects;

create policy variable_evidence_object_select on storage.objects for select to authenticated
  using (bucket_id = 'variable-cost-evidence' and public.auth_can_read_variable_evidence_object(name));

create policy variable_evidence_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'variable-cost-evidence' and public.auth_can_upload_variable_evidence_object(name));

create policy variable_evidence_object_delete on storage.objects for delete to authenticated
  using (bucket_id = 'variable-cost-evidence' and public.auth_can_delete_variable_evidence_object(name));

-- Ensure variable_cost_evidence metadata RLS is correct (already exists, but ensure insert uses scoped check)
-- Keep existing policies: variable_evidence_select_authenticated, variable_evidence_insert etc. Ensure they remain.

-- Grant execute
revoke execute on function public.auth_can_upload_variable_evidence_object(text) from public, anon;
revoke execute on function public.auth_can_read_variable_evidence_object(text) from public, anon;
revoke execute on function public.auth_can_delete_variable_evidence_object(text) from public, anon;
grant execute on function public.auth_can_upload_variable_evidence_object(text) to authenticated;
grant execute on function public.auth_can_read_variable_evidence_object(text) to authenticated;
grant execute on function public.auth_can_delete_variable_evidence_object(text) to authenticated;

notify pgrst, 'reload schema';
