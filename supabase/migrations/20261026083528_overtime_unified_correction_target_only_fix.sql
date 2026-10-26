do $$
declare
  v_def text;
  v_old text := '  for v_participant in select value from jsonb_array_elements(v_plan -> ''participants'') loop
    update public.overtime_entries';
  v_new text := '  for v_participant in select value from jsonb_array_elements(v_plan -> ''participants'') loop
    if not v_date_changed and not (v_participant ->> ''is_target'')::boolean then
      continue;
    end if;
    update public.overtime_entries';
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'correct_overtime_entry_super_admin_l7';
  if v_def is null then
    raise exception 'RPC koreksi Lembur terpadu tidak ditemukan';
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'Pola loop koreksi Lembur tidak ditemukan';
  end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end;
$$;
