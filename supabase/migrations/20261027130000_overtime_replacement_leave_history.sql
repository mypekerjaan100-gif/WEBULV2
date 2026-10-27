-- Riwayat Cuti pada Detail Lembur Pengganti Cuti.
-- Menampilkan pengajuan REPLACEMENT_LEAVE lain untuk pegawai yang digantikan
-- (lintas periode), hanya yang pernah dikirim, beserta metadata Form Cuti.
-- Read-only; scope baca dicek per baris dan pengajuan yang sedang dibuka
-- dikecualikan. Tidak mengekspos nominal, tarif, atau saldo cuti.

create or replace function public.list_overtime_replacement_leave_history(
  p_entry_id uuid,
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  activity_id uuid,
  overtime_date date,
  status text,
  unit_id uuid,
  participant_employee_id uuid,
  participant_name text,
  replaced_employee_id uuid,
  replaced_employee_name text,
  description text,
  started_at timestamptz,
  ended_at timestamptz,
  rejection_count integer,
  closure_reason text,
  form_evidence jsonb,
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
  if v_activity.type <> 'REPLACEMENT_LEAVE' or v_activity.replaced_employee_id is null then
    raise exception 'Not a replacement leave activity' using errcode = '22023';
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
    a.id,
    a.overtime_date,
    a.status,
    a.unit_id,
    participant.employee_id,
    participant.employee_name,
    a.replaced_employee_id,
    coalesce(replaced_employee.name, 'Pegawai yang digantikan'),
    a.description,
    a.started_at,
    a.ended_at,
    a.rejection_count,
    a.closure_reason,
    coalesce(evidence.form_evidence, '[]'::jsonb),
    count(*) over ()
  from public.overtime_activities a
  join lateral (
    select e.employee_id, e.employee_name_snapshot as employee_name
    from public.overtime_entries e
    where e.activity_id = a.id
    order by e.id
    limit 1
  ) participant on true
  left join public.employees replaced_employee on replaced_employee.id = a.replaced_employee_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', ev.id,
      'activityId', ev.activity_id,
      'entryId', ev.entry_id,
      'evidenceType', ev.evidence_type,
      'originalFilename', ev.original_filename,
      'originalMimeType', ev.original_mime_type,
      'storedSizeBytes', ev.stored_size_bytes,
      'uploadedAt', ev.uploaded_at
    ) order by ev.uploaded_at desc, ev.id) as form_evidence
    from public.overtime_evidence ev
    where ev.activity_id = a.id
      and ev.status = 'ACTIVE'
      and ev.evidence_type = 'FORM_CUTI'
  ) evidence on true
  where a.contract_id = v_activity.contract_id
    and a.type = 'REPLACEMENT_LEAVE'
    and a.replaced_employee_id = v_activity.replaced_employee_id
    and a.id <> v_activity.id
    and a.deleted_at is null
    and a.submission_count > 0
    and public.auth_can_read_overtime_evidence_scope(
      a.contract_id,
      a.up3_id,
      a.unit_id
    )
  order by a.overtime_date desc, a.id desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.list_overtime_replacement_leave_history(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_overtime_replacement_leave_history(uuid, integer, integer)
  to authenticated;
