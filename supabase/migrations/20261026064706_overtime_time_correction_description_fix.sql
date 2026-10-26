do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'correct_overtime_entry_times_super_admin_l6';
  if v_def is null then
    raise exception 'RPC koreksi jam Super Admin tidak ditemukan';
  end if;
  if position('if v_activity.description = v_old_description then' in v_def) = 0
     or position('if v_entry.description = v_old_description then' in v_def) = 0 then
    raise exception 'Pola pembaruan deskripsi pengganti tidak ditemukan';
  end if;
  v_def := replace(v_def, 'if v_activity.description = v_old_description then', 'if true then');
  v_def := replace(v_def, 'if v_entry.description = v_old_description then', 'if true then');
  execute v_def;
end;
$$;
