-- Jejak perbaikan insert history submit_overtime_work_l3 (sinkron dengan live).
-- Aman dijalankan ulang: hanya mengeksekusi bila pola yang rusak ditemukan.
do $$
declare v_def text; v_fixed text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'submit_overtime_work_l3';
  if v_def is null then raise exception 'submit_overtime_work_l3 not found'; end if;
  v_fixed := regexp_replace(v_def,
    'auth\.uid\(\),\s+''DRAFT'',\s+''SUBMITTED''',
    'auth.uid(),v_submission_number,''DRAFT'',''SUBMITTED''');
  if v_fixed <> v_def then execute v_fixed; end if;
end;
$$;
