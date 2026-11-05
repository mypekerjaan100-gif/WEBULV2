-- Require a positive pruning span count for ROW drafts and submissions.
-- Legacy correction revisions may keep their existing NULL/zero snapshot so
-- the locked volume fields do not block the established revision workflow.
do $migration$
declare
  v_definition text;
  v_old text := $old$-- Var ROW tidak lagi wajib diinput. Pertahankan nilai yang sudah tersimpan;
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
  end if;$old$;
  v_new text := $new$-- Var ROW tetap opsional dan nilai tersimpan tetap dipertahankan.
  -- Jumlah pangkas wajib positif, kecuali revisi lama yang mempertahankan
  -- persis nilai historis saat volume pekerjaan terkunci.
  if p_activity_id is null then
    v_row_var_span_count := p_row_var_span_count;
  else
    v_row_var_span_count := v_activity.row_var_span_count;
  end if;
  if p_work_category = 'ROW' then
    if p_row_pruning_span_count is null or p_row_pruning_span_count < 1 then
      if not (
        p_activity_id is not null
        and v_activity.status = 'CORRECTION_REQUIRED'
        and p_row_pruning_span_count is not distinct from v_activity.row_pruning_span_count
      ) then
        raise exception 'Jumlah gawang pangkas wajib diisi minimal 1';
      end if;
    end if;
    if v_row_var_span_count is not null and v_row_var_span_count < 0 then raise exception 'Jumlah gawang Var ROW tidak boleh negatif'; end if;
    if p_row_felling_20_40_count is not null and p_row_felling_20_40_count < 0 then raise exception 'Jumlah tebang 20-40 cm tidak boleh negatif'; end if;
    if p_row_felling_41_60_count is not null and p_row_felling_41_60_count < 0 then raise exception 'Jumlah tebang 41-60 cm tidak boleh negatif'; end if;
  else
    if p_row_var_span_count is not null
      or p_row_pruning_span_count is not null
      or p_row_felling_20_40_count is not null
      or p_row_felling_41_60_count is not null then
      raise exception 'Volume pekerjaan ROW hanya berlaku untuk kategori ROW';
    end if;
  end if;$new$;
  v_actual_replacements integer;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.save_overtime_work_draft_l3(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid, integer, integer, integer, integer)'::regprocedure
  );
  v_actual_replacements :=
    (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_actual_replacements <> 1 then
    raise exception 'Unexpected save_overtime_work_draft_l3 source: expected 1 ROW validation block, found %',
      v_actual_replacements;
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_old text := $old$-- Var ROW is optional for new and historical ROW applications.$old$;
  v_new text := $new$-- Var ROW remains optional for new and historical ROW applications.
  if v_activity.work_category = 'ROW' then
    if v_activity.row_pruning_span_count is null or v_activity.row_pruning_span_count < 1 then
      raise exception 'Jumlah gawang pangkas wajib diisi minimal 1';
    end if;
  end if;$new$;
  v_actual_replacements integer;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.submit_overtime_work_l3(uuid)'::regprocedure
  );
  v_actual_replacements :=
    (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_actual_replacements <> 1 then
    raise exception 'Unexpected submit_overtime_work_l3 source: expected 1 optional-Var-ROW marker, found %',
      v_actual_replacements;
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;
