-- Riwayat Lembur Pegawai pada Detail Lembur: pengajuan lain milik
-- pegawai (per peserta, semua jenis lembur, semua periode), hanya yang
-- pernah dikirim, diurut tanggal lembur terbaru, dengan pagination.
-- Read-only; hak akses mengikuti scope baca lembur akun pada SETIAP baris
-- (lintas unit tidak menambah hak lintas-UP3). Tanpa kolom finansial.

create or replace function public.list_overtime_employee_history_l5(
  p_entry_id uuid,
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  entry_id uuid,
  activity_id uuid,
  overtime_date date,
  type text,
  work_category text,
  work_title text,
  work_location text,
  description text,
  unit_id uuid,
  participant_started_at timestamptz,
  participant_ended_at timestamptz,
  duration_hours numeric,
  status text,
  approval_status text,
  rejection_count integer,
  revision_deadline_at timestamptz,
  closure_reason text,
  activity_closure_reason text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_entry public.overtime_entries%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_entry from public.overtime_entries where id = p_entry_id;
  if not found then
    raise exception 'Overtime participant not found';
  end if;
  select * into v_activity
  from public.overtime_activities
  where id = v_entry.activity_id and deleted_at is null;
  if not found then
    raise exception 'Overtime activity not found';
  end if;
  if not public.auth_can_read_overtime_evidence_scope(
    v_activity.contract_id,
    v_activity.up3_id,
    v_activity.unit_id
  ) then
    raise exception 'Not authorized to read this overtime scope' using errcode = '42501';
  end if;
  return query
  select
    e.id,
    a.id,
    a.overtime_date,
    a.type,
    a.work_category,
    a.work_title,
    a.work_location,
    a.description,
    a.unit_id,
    e.participant_started_at,
    e.participant_ended_at,
    e.duration_hours_snapshot,
    a.status,
    e.approval_status,
    e.rejection_count,
    e.revision_deadline_at,
    e.closure_reason,
    a.closure_reason,
    count(*) over ()
  from public.overtime_activities a
  join public.overtime_entries e on e.activity_id = a.id
  where a.contract_id = v_activity.contract_id
    and e.employee_id = v_entry.employee_id
    and a.id <> v_activity.id
    and a.deleted_at is null
    and a.submission_count > 0
    and public.auth_can_read_overtime_evidence_scope(
      a.contract_id,
      a.up3_id,
      a.unit_id
    )
  order by a.overtime_date desc, e.id desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.list_overtime_employee_history_l5(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.list_overtime_employee_history_l5(uuid, integer, integer) to authenticated;
