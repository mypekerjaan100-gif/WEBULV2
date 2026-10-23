-- Guard volume ROW: angka yang sudah terisi tidak boleh dikembalikan nihil
-- lewat jalur mana pun (termasuk payload API langsung). Nilai boleh dikoreksi
-- ke angka lain; yang dilarang hanya memusnahkan dengan NULL.
-- Aman dipasang kapan saja: web lama tidak pernah mengirim angka volume
-- (kolom ROW lama memang NULL sehingga guard tidak picu).
-- Sudah diterapkan ke DB produksi; file ini mirror catatan migrasi.

drop trigger if exists overtime_activities_row_volume_guard on public.overtime_activities;
drop function if exists public.overtime_activities_row_volume_guard();

create or replace function public.overtime_activities_row_volume_guard()
returns trigger
language plpgsql
as $function$
begin
  if (old.row_var_span_count is not null and new.row_var_span_count is null)
    or (old.row_pruning_span_count is not null and new.row_pruning_span_count is null)
    or (old.row_felling_20_40_count is not null and new.row_felling_20_40_count is null)
    or (old.row_felling_41_60_count is not null and new.row_felling_41_60_count is null) then
    raise exception 'Volume pekerjaan ROW tidak boleh dikosongkan setelah terisi';
  end if;
  return new;
end;
$function$;

create trigger overtime_activities_row_volume_guard
  before update on public.overtime_activities
  for each row
  execute function public.overtime_activities_row_volume_guard();