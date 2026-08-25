-- Fix Variable evidence upload RPC missing in schema cache
create or replace function public.get_variable_evidence_upload_path(p_entry_id uuid, p_file_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.variable_cost_entries%rowtype;
  v_ext text;
  v_path text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.variable_cost_entries where id = p_entry_id;
  if not found then raise exception 'entry not found'; end if;
  if not public.auth_can_access_variable_scope(v_row.contract_id, v_row.up3_id, v_row.unit_id) then
    raise exception 'access denied';
  end if;
  v_ext := lower(split_part(coalesce(nullif(btrim(p_file_name), ''), 'bin'), '.', -1));
  if v_ext = '' or v_ext = lower(btrim(p_file_name)) then v_ext := 'bin'; end if;
  if v_ext !~ '^[a-z0-9]{1,10}$' then v_ext := 'bin'; end if;
  v_path := format('variable/%s/%s/%s/%s-%s.%s', v_row.contract_id, v_row.up3_id, v_row.unit_id, p_entry_id, gen_random_uuid(), v_ext);
  return v_path;
end;
$$;
revoke execute on function public.get_variable_evidence_upload_path(uuid, text) from public, anon;
grant execute on function public.get_variable_evidence_upload_path(uuid, text) to authenticated;
notify pgrst, 'reload schema';
