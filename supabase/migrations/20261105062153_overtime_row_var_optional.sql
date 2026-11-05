-- Make Var ROW optional without dropping its column, constraint, trigger, or
-- existing values. The deployed save function is patched only at known exact
-- source fragments so this migration fails closed if the active RPC differs.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_expected_replacements integer;
  v_actual_replacements integer;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.save_overtime_work_draft_l3(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid, integer, integer, integer, integer)'::regprocedure
  );

  -- Source files and already-deployed functions differ only in indentation
  -- of these old comments. Normalize that whitespace before exact matching.
  v_definition := replace(v_definition,
    E'\n  -- angka lain opsional dan tidak boleh negatif. Revisi data ROW lama yang',
    E'\n-- angka lain opsional dan tidak boleh negatif. Revisi data ROW lama yang');
  v_definition := replace(v_definition,
    E'\n  -- belum pernah terisi tidak dipaksa Var ROW karena inputnya terkunci',
    E'\n-- belum pernah terisi tidak dipaksa Var ROW karena inputnya terkunci');
  v_definition := replace(v_definition,
    E'\n  -- (keputusan: pertahankan data lama); nilai yang dikirim tetap divalidasi.',
    E'\n-- (keputusan: pertahankan data lama); nilai yang dikirim tetap divalidasi.');

  for v_old, v_new, v_expected_replacements in
    select old_text, new_text, expected_replacements
    from (values
      (
        $old$v_row public.overtime_entries%rowtype; v_eid uuid; v_row_status text;$old$,
        $new$v_row public.overtime_entries%rowtype; v_eid uuid; v_row_status text; v_row_var_span_count integer;$new$,
        1
      ),
      (
        $old$-- Volume pekerjaan ROW: pengajuan baru wajib Var ROW minimal 1; tiga
-- angka lain opsional dan tidak boleh negatif. Revisi data ROW lama yang
-- belum pernah terisi tidak dipaksa Var ROW karena inputnya terkunci
-- (keputusan: pertahankan data lama); nilai yang dikirim tetap divalidasi.
  if p_work_category = 'ROW' then
    if not (
      p_activity_id is not null
      and v_activity.status = 'CORRECTION_REQUIRED'
      and v_activity.row_var_span_count is null
    ) then
      if p_row_var_span_count is null then raise exception 'Jumlah gawang Var ROW wajib diisi'; end if;
    end if;
    if p_row_var_span_count is not null and p_row_var_span_count < 1 then raise exception 'Jumlah gawang Var ROW minimal 1'; end if;
    if p_row_pruning_span_count is not null and p_row_pruning_span_count < 0 then raise exception 'Jumlah gawang pangkas tidak boleh negatif'; end if;
    if p_row_felling_20_40_count is not null and p_row_felling_20_40_count < 0 then raise exception 'Jumlah tebang 20-40 cm tidak boleh negatif'; end if;
    if p_row_felling_41_60_count is not null and p_row_felling_41_60_count < 0 then raise exception 'Jumlah tebang 41-60 cm tidak boleh negatif'; end if;
  else
    if p_row_var_span_count is not null
      or p_row_pruning_span_count is not null
      or p_row_felling_20_40_count is not null
      or p_row_felling_41_60_count is not null then
      raise exception 'Volume pekerjaan ROW hanya berlaku untuk kategori ROW';
    end if;
  end if;$old$,
        $new$-- Var ROW tidak lagi wajib diinput. Pertahankan nilai yang sudah tersimpan;
  -- untuk draft baru, nilai ini opsional. Volume pangkas/tebang tetap divalidasi.
  if p_activity_id is null then
    v_row_var_span_count := p_row_var_span_count;
  else
    v_row_var_span_count := v_activity.row_var_span_count;
  end if;
  if p_work_category = 'ROW' then
    if v_row_var_span_count is not null and v_row_var_span_count < 0 then raise exception 'Jumlah gawang Var ROW tidak boleh negatif'; end if;
    if p_row_pruning_span_count is not null and p_row_pruning_span_count < 0 then raise exception 'Jumlah gawang pangkas tidak boleh negatif'; end if;
    if p_row_felling_20_40_count is not null and p_row_felling_20_40_count < 0 then raise exception 'Jumlah tebang 20-40 cm tidak boleh negatif'; end if;
    if p_row_felling_41_60_count is not null and p_row_felling_41_60_count < 0 then raise exception 'Jumlah tebang 41-60 cm tidak boleh negatif'; end if;
  else
    if p_row_var_span_count is not null
      or p_row_pruning_span_count is not null
      or p_row_felling_20_40_count is not null
      or p_row_felling_41_60_count is not null then
      raise exception 'Volume pekerjaan ROW hanya berlaku untuk kategori ROW';
    end if;
  end if;$new$,
        1
      ),
      (
        $old$or v_activity.row_var_span_count is distinct from p_row_var_span_count$old$,
        $new$or v_activity.row_var_span_count is distinct from v_row_var_span_count$new$,
        2
      ),
      (
        $old$row_var_span_count = p_row_var_span_count$old$,
        $new$row_var_span_count = v_row_var_span_count$new$,
        2
      ),
      (
        $old$nullif(v_location_trim, ''), p_row_var_span_count, p_row_pruning_span_count,$old$,
        $new$nullif(v_location_trim, ''), v_row_var_span_count, p_row_pruning_span_count,$new$,
        1
      )
    ) as replacements(old_text, new_text, expected_replacements)
  loop
    v_actual_replacements :=
      (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
    if v_actual_replacements <> v_expected_replacements then
      raise exception 'Unexpected save_overtime_work_draft_l3 source: expected % replacement(s), found %',
        v_expected_replacements, v_actual_replacements;
    end if;
    v_definition := replace(v_definition, v_old, v_new);
  end loop;

  execute v_definition;
end;
$migration$;

-- Submission checks all existing eligibility, deadline, and evidence rules;
-- only the Var ROW minimum requirement is removed.
do $migration$
declare
  v_definition text;
  v_old text := $old$if v_activity.work_category = 'ROW' then
    if v_activity.row_var_span_count is null or v_activity.row_var_span_count < 1 then
      raise exception 'Jumlah gawang Var ROW wajib diisi minimal 1';
    end if;
  end if;$old$;
  v_new text := $new$-- Var ROW is optional for new and historical ROW applications.$new$;
  v_actual_replacements integer;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.submit_overtime_work_l3(uuid)'::regprocedure
  );
  v_actual_replacements :=
    (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_actual_replacements <> 1 then
    raise exception 'Unexpected submit_overtime_work_l3 source: expected 1 Var ROW check, found %',
      v_actual_replacements;
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;
