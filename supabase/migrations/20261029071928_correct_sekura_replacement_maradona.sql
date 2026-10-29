-- User-approved one-off correction: MARADONA replaces TEGUH WAHYUDI on leave,
-- ULP Sekura, 26 October 2026, 00:00-08:00 Asia/Pontianak.
-- Resolve generated IDs by business keys. Do not alter approvals, time, amount,
-- evidence, old history, permissions, or triggers. Any mismatch aborts atomically.
do $correction$
declare
  v_key constant text := 'correct_sekura_replacement_maradona_20261026';
  v_date constant date := date '2026-10-26';
  v_old_description constant text := 'LILIK WAHYUNI menggantikan TEGUH WAHYUDI yang cuti pada 26 Oktober 2026 pukul 00:00–08:00.';
  v_new_description constant text := 'MARADONA menggantikan TEGUH WAHYUDI yang cuti pada 26 Oktober 2026 pukul 00:00–08:00.';
  v_before_activity public.overtime_activities%rowtype;
  v_after_activity public.overtime_activities%rowtype;
  v_before_entry public.overtime_entries%rowtype;
  v_after_entry public.overtime_entries%rowtype;
  v_employee_id uuid;
  v_employee_name text;
  v_rate numeric;
  v_amount numeric;
  v_evidence jsonb;
  v_history jsonb;
  v_audit_id uuid;
  v_count integer;
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '15s', true);
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  -- STRICT refuses missing/ambiguous targets instead of guessing another record.
  select a.* into strict v_before_activity
  from public.overtime_activities a
  join public.overtime_entries e on e.activity_id = a.id
  join public.employees original on original.id = e.employee_id
  join public.employees replaced on replaced.id = a.replaced_employee_id
  join public.contracts c on c.id = a.contract_id
  join public.organization_units up3 on up3.id = a.up3_id
  join public.organization_units ulp on ulp.id = a.unit_id
  where c.code = 'pelayanan-teknik'
    and up3.legacy_key = 'up3' and ulp.legacy_key = 'ulp-6'
    and ulp.parent_id = up3.id and ulp.type = 'ULP'
    and original.nip = '7919002SKW' and original.name = 'LILIK WAHYUNI'
    and replaced.nip = '01210543PTK' and replaced.name = 'TEGUH WAHYUDI'
    and a.type = 'REPLACEMENT_LEAVE' and a.deleted_at is null
    and a.overtime_date = v_date and e.work_date = v_date
    and a.started_at = timestamptz '2026-10-26 00:00:00+07'
    and a.ended_at = timestamptz '2026-10-26 08:00:00+07'
  for update of a;

  -- A replacement must have exactly one participant; lock the existing entry.
  select * into strict v_before_entry
  from public.overtime_entries
  where activity_id = v_before_activity.id
  for update;
  if v_before_activity.status is distinct from 'APPROVED'
    or v_before_entry.approval_status is distinct from 'APPROVED'
    or v_before_activity.revision <> 3 or v_before_entry.revision <> 2
    or v_before_activity.description is distinct from v_old_description
    or v_before_entry.description is distinct from v_old_description
    or v_before_entry.employee_name_snapshot is distinct from 'LILIK WAHYUNI'
    or v_before_entry.participant_started_at is distinct from v_before_activity.started_at
    or v_before_entry.participant_ended_at is distinct from v_before_activity.ended_at
    or v_before_entry.hours <> 8 or v_before_entry.duration_hours_snapshot is distinct from 8::numeric
    or v_before_entry.multiplier_hours_snapshot is distinct from 15.5::numeric
    or v_before_entry.hourly_rate_snapshot <> 21399
    or v_before_entry.calculated_amount_snapshot <> 331684.50 then
    raise exception 'Expected approved Sekura replacement changed; correction aborted';
  end if;

  select id, name into strict v_employee_id, v_employee_name
  from public.employees
  where nip = '8819008SKW' and name = 'MARADONA'
  for update;
  if not public.overtime_employee_is_eligible_l2(
    v_employee_id, v_before_activity.contract_id, v_before_activity.up3_id,
    v_before_activity.unit_id, v_date
  ) or v_employee_id = v_before_activity.replaced_employee_id then
    raise exception 'MARADONA is not eligible in the exact Sekura scope/date';
  end if;
  if exists (
    select 1 from public.overtime_entries e
    join public.overtime_activities a on a.id = e.activity_id
    where e.employee_id = v_employee_id and e.id <> v_before_entry.id
      and a.deleted_at is null
      and (e.work_date = v_date
        or (e.participant_started_at < v_before_entry.participant_ended_at
          and e.participant_ended_at > v_before_entry.participant_started_at))
  ) then
    raise exception 'MARADONA already has overtime on this date or overlapping time';
  end if;

  select hourly_rate into v_rate
  from public.employee_hourly_rate_history
  where employee_id = v_employee_id and effective_from <= v_date
    and (effective_to is null or v_date < effective_to)
  order by effective_from desc limit 1 for share;
  v_amount := round(v_rate * v_before_entry.multiplier_hours_snapshot, 2);
  if v_rate is distinct from v_before_entry.hourly_rate_snapshot
    or v_amount is distinct from v_before_entry.calculated_amount_snapshot then
    raise exception 'Rate/amount differs from the approved correction; review required';
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) into v_evidence
  from public.overtime_evidence e where activity_id = v_before_activity.id;
  if (select count(*) from public.overtime_evidence
      where activity_id = v_before_activity.id and status = 'ACTIVE' and evidence_type = 'FORM_CUTI') <> 1 then
    raise exception 'Expected one active FORM_CUTI; correction aborted';
  end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.id), '[]'::jsonb) into v_history
  from public.overtime_activity_history h where activity_id = v_before_activity.id;

  -- This is database maintenance, not an impersonated application-user action.
  -- auth.uid() is null for maintenance; preserve the real approved_by/approved_at.
  update public.overtime_activities
  set description = v_new_description, updated_by = auth.uid()
  where id = v_before_activity.id and revision = v_before_activity.revision
  returning * into v_after_activity;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'Must update exactly one activity'; end if;

  update public.overtime_entries
  set employee_id = v_employee_id, employee_name_snapshot = v_employee_name,
      description = v_new_description, hourly_rate_snapshot = v_rate,
      calculated_amount_snapshot = v_amount, updated_by = auth.uid()
  where id = v_before_entry.id and revision = v_before_entry.revision
  returning * into v_after_entry;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'Must update exactly one entry'; end if;

  insert into public.overtime_activity_history (
    activity_id, entry_id, event, actor_user_id, previous_status, new_status,
    submission_number, rejection_number, reason, notes
  ) values (
    v_before_activity.id, v_before_entry.id, 'CORRECTED', auth.uid(), 'APPROVED', 'APPROVED',
    v_before_activity.current_submission_number, v_before_activity.rejection_count,
    'Permintaan pengguna: koreksi pengganti cuti TEGUH WAHYUDI pada 26 Oktober 2026 di ULP Sekura, dari LILIK WAHYUNI menjadi MARADONA.',
    'Pegawai pengganti dikoreksi; tanggal 26 Oktober 2026, jam 00:00–08:00, nominal Rp331.684,50, status disetujui dan Form Cuti tetap.'
      || E'\n' || jsonb_build_object(
        'maintenance_key', v_key, 'database_role', current_user,
        'authenticated_user_id', auth.uid(), 'execution', 'User-authorized database maintenance; not an authenticated application-user action',
        'before', jsonb_build_object('employee_id', v_before_entry.employee_id, 'employee_name', v_before_entry.employee_name_snapshot,
          'description', v_before_entry.description, 'hourly_rate', v_before_entry.hourly_rate_snapshot, 'amount', v_before_entry.calculated_amount_snapshot),
        'after', jsonb_build_object('employee_id', v_employee_id, 'employee_name', v_employee_name,
          'description', v_new_description, 'hourly_rate', v_rate, 'amount', v_amount)
      )::text
  ) returning id into v_audit_id;

  -- Whole-row comparisons explicitly preserve approval actors/timestamps,
  -- submission fields, scope, time, period, rates, and all other financial data.
  if (to_jsonb(v_after_activity) - array['description','updated_by','updated_at','revision'])
      is distinct from (to_jsonb(v_before_activity) - array['description','updated_by','updated_at','revision'])
    or (to_jsonb(v_after_entry) - array['employee_id','employee_name_snapshot','description','updated_by','updated_at','revision'])
      is distinct from (to_jsonb(v_before_entry) - array['employee_id','employee_name_snapshot','description','updated_by','updated_at','revision'])
    or v_after_activity.revision <> v_before_activity.revision + 1
    or v_after_entry.revision <> v_before_entry.revision + 1 then
    raise exception 'Unrelated fields or approval data changed; correction aborted';
  end if;
  if v_evidence is distinct from (
    select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb)
    from public.overtime_evidence e where activity_id = v_before_activity.id
  ) or v_history is distinct from (
    select coalesce(jsonb_agg(to_jsonb(h) order by h.id), '[]'::jsonb)
    from public.overtime_activity_history h where activity_id = v_before_activity.id and id <> v_audit_id
  ) then
    raise exception 'Evidence or original audit history changed; correction aborted';
  end if;
end;
$correction$;
