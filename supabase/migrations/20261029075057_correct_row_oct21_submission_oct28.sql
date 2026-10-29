-- User-approved, one-off maintenance: three ROW activities, nine participants.
-- Work remains 21 October 2026. Effective submission is 28 October 2026,
-- one second after each activity's last completed data/evidence operation.
-- Keep old CLOSED/EXPIRED history; append reconstructed SUBMITTED + CORRECTED.
-- No trigger/permission/deadline configuration changes and no user impersonation.
do $correction$
declare
  v_key constant text := 'correct_row_oct21_submission_oct28_2026';
  v_work_date constant date := date '2026-10-21';
  v_target record;
  v_before public.overtime_activities%rowtype;
  v_after public.overtime_activities%rowtype;
  v_entries_before jsonb;
  v_entries_after jsonb;
  v_participants jsonb;
  v_evidence jsonb;
  v_history jsonb;
  v_last_complete_at timestamptz;
  v_deadline timestamptz;
  v_submitted_history_id uuid;
  v_correction_history_id uuid;
  v_count integer;
  v_activities_updated integer := 0;
  v_entries_updated integer := 0;
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '15s', true);
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  if auth.uid() is not null then
    raise exception 'Run as database maintenance, not an impersonated application user';
  end if;

  for v_target in
    select * from (values
      ('Keraban', 'Row Gabungan',
        E'Row Gabungan Di Arah Keraban\n( Masih Menunggu ttd SPK pegawai )',
        timestamptz '2026-10-21 09:30:00+07', timestamptz '2026-10-21 15:30:00+07',
        timestamptz '2026-10-28 09:54:17.843285+07', 27, 8, 3, 4, 11.5::numeric,
        '366c7b882593030ffc5f2d920b7785ee',
        '[{"nip":"7219009SKW","name":"SUYONO","rate":21399,"amount":246088.50},{"nip":"02251680PTK","name":"IRFAN","rate":20836,"amount":239614},{"nip":"7519004SKW","name":"MOH KHAI RONI","rate":21399,"amount":246088.50}]'::jsonb),
      ('Ds.Jambu', 'Row Gabungn',
        E'Row Gabungan Di Ds.Jambu\n( SPK Masih Nunggu ttd Pengawai )',
        timestamptz '2026-10-21 08:30:00+07', timestamptz '2026-10-21 15:30:00+07',
        timestamptz '2026-10-28 10:17:29.056268+07', 25, 5, 2, 3, 13.5::numeric,
        '8be9c9f4b5b56bb4073122ead49a5b45',
        '[{"nip":"7919004SKW","name":"JAPIRIN","rate":21399,"amount":288886.50},{"nip":"8119006SKW","name":"JUARDI","rate":21399,"amount":288886.50},{"nip":"7219007SKW","name":"SAM AN","rate":21399,"amount":288886.50}]'::jsonb),
      ('Ds.Sasak Dalam', 'Row Gabungan',
        E'Row Gabungan Di Ds.Sasak Dalam\n( Masih Nunggu ttd SPK Pegawai )',
        timestamptz '2026-10-21 09:30:00+07', timestamptz '2026-10-21 13:00:00+07',
        timestamptz '2026-10-28 10:28:53.589259+07', 21, 2, 1, 2, 6.5::numeric,
        '6a554d4e7a724cb40bae5b3fe79d8276',
        '[{"nip":"8419009SKW","name":"HENDRI","rate":21399,"amount":139093.50},{"nip":"8319002SKW","name":"SUKARDI","rate":21399,"amount":139093.50},{"nip":"01251674PTK","name":"THYAS PRATAMA","rate":20836,"amount":135434}]'::jsonb)
    ) as targets(location, title, description, started_at, ended_at, submitted_at,
      volume, activity_revision, entry_revision, history_count, multiplier,
      evidence_fingerprint, participants)
    order by targets.location
  loop
    -- Resolve generated IDs from exact business keys. STRICT rejects ambiguity.
    select a.* into strict v_before
    from public.overtime_activities a
    join public.contracts c on c.id = a.contract_id
    join public.organization_units up3 on up3.id = a.up3_id
    join public.organization_units ulp on ulp.id = a.unit_id
    where c.code = 'pelayanan-teknik'
      and up3.legacy_key = 'up3' and ulp.legacy_key = 'ulp-5'
      and ulp.type = 'ULP' and ulp.parent_id = up3.id
      and a.type = 'WORK' and a.work_category = 'ROW' and a.deleted_at is null
      and a.overtime_date = v_work_date and a.work_location = v_target.location
      and a.work_title = v_target.title
      and a.started_at = v_target.started_at and a.ended_at = v_target.ended_at
    for update of a;

    if v_before.status is distinct from 'CLOSED'
      or v_before.closure_reason is distinct from 'EXPIRED'
      or v_before.revision is distinct from v_target.activity_revision
      or v_before.evidence_mode is distinct from 'PARTICIPANT_V2'
      or v_before.description is distinct from v_target.description
      or v_before.row_var_span_count is distinct from v_target.volume
      or v_before.row_pruning_span_count is distinct from v_target.volume
      or v_before.row_felling_20_40_count is not null
      or v_before.row_felling_41_60_count is not null
      or v_before.period_month is distinct from date '2026-10-01'
      or v_before.submission_deadline is distinct from date '2026-10-28'
      or v_before.submission_count is distinct from 0
      or v_before.current_submission_number is distinct from 0
      or v_before.submitted_at is not null or v_before.submitted_by is not null
      or v_before.last_resubmitted_at is not null or v_before.last_resubmitted_by is not null
      or v_before.rejection_count is distinct from 0
      or v_before.last_rejection_at is not null or v_before.last_rejected_by is not null
      or v_before.approved_at is not null or v_before.approved_by is not null
      or v_before.revision_deadline_at is not null
      or (v_before.closed_at at time zone 'Asia/Pontianak')::date is distinct from date '2026-10-29'
      or v_before.closed_by is null then
      raise exception 'Expected unsubmitted CLOSED/EXPIRED ROW changed at %', v_target.location;
    end if;

    -- Parent lock also serializes participant inserts; lock existing children.
    perform 1 from public.overtime_entries where activity_id = v_before.id order by id for update;
    perform 1 from public.overtime_evidence where activity_id = v_before.id order by id for share;
    perform 1 from public.overtime_activity_history where activity_id = v_before.id order by id for share;
    select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb)
    into v_entries_before from public.overtime_entries e where e.activity_id = v_before.id;
    if jsonb_array_length(v_entries_before) <> 3 or exists (
      select 1 from public.overtime_entries e where e.activity_id = v_before.id and (
        e.approval_status is distinct from 'DRAFT'
        or e.revision is distinct from v_target.entry_revision
        or e.closure_reason is not null or e.rejection_count is distinct from 0
        or e.revision_deadline_at is not null
        or e.work_date is distinct from v_work_date
        or e.period_month is distinct from v_before.period_month
        or e.description is distinct from v_before.description
        or e.participant_started_at is distinct from v_target.started_at
        or e.participant_ended_at is distinct from v_target.ended_at
        or e.hours is distinct from extract(epoch from (v_target.ended_at - v_target.started_at)) / 3600
        or e.duration_hours_snapshot is distinct from e.hours
        or e.multiplier_hours_snapshot is distinct from v_target.multiplier
      )
    ) then
      raise exception 'Expected three untouched DRAFT participants changed at %', v_target.location;
    end if;
    select jsonb_agg(jsonb_build_object('nip', emp.nip, 'name', e.employee_name_snapshot,
      'rate', e.hourly_rate_snapshot, 'amount', e.calculated_amount_snapshot) order by emp.nip)
    into v_participants
    from public.overtime_entries e join public.employees emp on emp.id = e.employee_id
    where e.activity_id = v_before.id;
    if v_participants is distinct from (
      select jsonb_agg(p order by p->>'nip') from jsonb_array_elements(v_target.participants) p
    ) then
      raise exception 'Participant identity/rate/amount changed at %', v_target.location;
    end if;

    select coalesce(jsonb_agg(to_jsonb(ev) order by ev.id), '[]'::jsonb)
    into v_evidence from public.overtime_evidence ev where ev.activity_id = v_before.id;
    if md5(v_evidence::text) is distinct from v_target.evidence_fingerprint
      or exists (select 1 from public.overtime_evidence
        where activity_id = v_before.id and status in ('PENDING', 'DELETE_PENDING'))
      or (select count(*) from public.overtime_evidence
        where activity_id = v_before.id and status = 'ACTIVE') <> 6
      or exists (
        select required.kind from (values ('SPK'), ('FOTO_PROSES'), ('FOTO_SELESAI')) required(kind)
        where (select count(*) from public.overtime_evidence ev
          where ev.activity_id = v_before.id and ev.entry_id is null
            and ev.evidence_type = required.kind and ev.status = 'ACTIVE') <> 1
      ) or exists (
        select 1 from public.overtime_entries e where e.activity_id = v_before.id
          and (select count(*) from public.overtime_evidence ev
            where ev.activity_id = v_before.id and ev.entry_id = e.id
              and ev.evidence_type = 'FOTO_BRIEFING' and ev.status = 'ACTIVE') <> 1
      ) or exists (
        select 1 from public.overtime_evidence ev
        where ev.activity_id = v_before.id and ev.status = 'ACTIVE' and not exists (
          select 1 from storage.objects o where o.bucket_id = 'overtime-evidence' and o.name = ev.storage_path
        )
      ) then
      raise exception 'ROW evidence incomplete, pending, missing from Storage, or changed at %', v_target.location;
    end if;

    select coalesce(jsonb_agg(to_jsonb(h) order by h.id), '[]'::jsonb)
    into v_history from public.overtime_activity_history h where h.activity_id = v_before.id;
    if jsonb_array_length(v_history) <> v_target.history_count
      or (select count(*) from public.overtime_activity_history h
        where h.activity_id = v_before.id and h.event = 'CLOSED'
          and h.previous_status = 'DRAFT' and h.new_status = 'CLOSED'
          and h.reason = 'Batas pengajuan awal H+7 telah lewat') <> 1
      or exists (select 1 from public.overtime_activity_history h
        where h.activity_id = v_before.id and h.event not in ('CREATED', 'UPDATED', 'CLOSED')) then
      raise exception 'Expected never-submitted expired draft history changed at %', v_target.location;
    end if;
    select greatest(
      (select max(e.updated_at) from public.overtime_entries e where e.activity_id = v_before.id),
      (select max(ev.uploaded_at) from public.overtime_evidence ev where ev.activity_id = v_before.id and ev.status = 'ACTIVE'),
      (select max(h.occurred_at) from public.overtime_activity_history h where h.activity_id = v_before.id and h.event in ('CREATED', 'UPDATED'))
    ) into v_last_complete_at;
    v_deadline := public.resolve_overtime_initial_deadline(
      v_before.contract_id, v_before.up3_id, v_work_date, v_target.submitted_at);
    if v_target.submitted_at is distinct from v_last_complete_at + interval '1 second'
      or (v_target.submitted_at at time zone 'Asia/Pontianak')::date is distinct from date '2026-10-28'
      or v_target.submitted_at < v_before.created_at
      or v_deadline is null or v_target.submitted_at > v_deadline then
      raise exception 'Agreed effective submission time is no longer valid at %', v_target.location;
    end if;

    -- CLOSED -> SUBMITTED is one maintenance correction, never a reopened DRAFT.
    -- Keep every guard enabled and retain the original deadline/work dates.
    update public.overtime_activities
    set status = 'SUBMITTED', submitted_at = v_target.submitted_at,
        submitted_by = auth.uid(), submission_count = 1, current_submission_number = 1,
        closure_reason = null, closed_at = null, closed_by = null, updated_by = auth.uid()
    where id = v_before.id and revision = v_before.revision
      and status = 'CLOSED' and closure_reason = 'EXPIRED' and submission_count = 0
    returning * into v_after;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception 'Must correct exactly one activity at %', v_target.location; end if;
    v_activities_updated := v_activities_updated + v_count;

    update public.overtime_entries
    set approval_status = 'SUBMITTED', updated_by = auth.uid()
    where activity_id = v_before.id and approval_status = 'DRAFT' and revision = v_target.entry_revision;
    get diagnostics v_count = row_count;
    if v_count <> 3 then raise exception 'Must submit exactly three participants at %', v_target.location; end if;
    v_entries_updated := v_entries_updated + v_count;
    select jsonb_agg(to_jsonb(e) order by e.id)
    into v_entries_after from public.overtime_entries e where e.activity_id = v_before.id;

    if (to_jsonb(v_after) - array['status','submitted_at','submitted_by','submission_count',
        'current_submission_number','closure_reason','closed_at','closed_by','updated_at','updated_by','revision'])
      is distinct from (to_jsonb(v_before) - array['status','submitted_at','submitted_by','submission_count',
        'current_submission_number','closure_reason','closed_at','closed_by','updated_at','updated_by','revision'])
      or v_after.status is distinct from 'SUBMITTED' or v_after.submitted_at is distinct from v_target.submitted_at
      or v_after.submitted_by is not null or v_after.updated_by is not null
      or v_after.submission_count <> 1 or v_after.current_submission_number <> 1
      or v_after.closed_at is not null or v_after.closed_by is not null or v_after.closure_reason is not null
      or v_after.revision <> v_before.revision + 1
      or jsonb_array_length(v_entries_after) <> 3 or exists (
        select 1 from jsonb_array_elements(v_entries_before) old_entry
        left join jsonb_array_elements(v_entries_after) new_entry on new_entry->>'id' = old_entry->>'id'
        where (new_entry - array['approval_status','updated_at','updated_by','revision'])
          is distinct from (old_entry - array['approval_status','updated_at','updated_by','revision'])
          or new_entry->>'approval_status' is distinct from 'SUBMITTED'
          or new_entry->>'updated_by' is not null
          or (new_entry->>'revision')::integer is distinct from (old_entry->>'revision')::integer + 1
      ) then
      raise exception 'Unrelated work/participant/financial data changed at %; entire correction aborted', v_target.location;
    end if;

    -- occurred_at is the user-approved effective date; created_at stays NOW.
    -- No claim is made that the original creator clicked Submit on that date.
    insert into public.overtime_activity_history (
      activity_id, event, actor_user_id, previous_status, new_status,
      submission_number, occurred_at, reason, notes
    ) values (
      v_before.id, 'SUBMITTED', auth.uid(), 'DRAFT', 'SUBMITTED', 1, v_target.submitted_at,
      'Permintaan pengguna: tanggal efektif pengajuan ROW 21 Oktober ditetapkan 28 Oktober 2026.',
      'Pengajuan efektif direkonstruksi melalui koreksi database, bukan bukti aksi klik Ajukan oleh pengguna. Waktu mengikuti data/evidence lengkap +1 detik; waktu pencatatan aktual tetap tersimpan.'
        || E'\n' || jsonb_build_object('maintenance_key', v_key, 'database_role', current_user,
          'execution', 'User-authorized database maintenance; not an authenticated application-user action',
          'recorded_at', now(), 'last_complete_at', v_last_complete_at,
          'effective_submitted_at', v_target.submitted_at, 'original_creator_id', v_before.created_by)::text
    ) returning id into v_submitted_history_id;
    insert into public.overtime_activity_history (
      activity_id, event, actor_user_id, previous_status, new_status,
      submission_number, occurred_at, reason, notes
    ) values (
      v_before.id, 'CORRECTED', auth.uid(), 'CLOSED', 'SUBMITTED', 1, clock_timestamp(),
      'Koreksi satu kali sesuai permintaan pengguna: pulihkan pengajuan efektif 28 Oktober 2026; pembukuan kedaluwarsa lama tetap di riwayat.',
      'Tanggal pekerjaan 21 Oktober, peserta, jam, nominal, volume ROW, keterangan dan evidence tetap. Penanda CLOSED/EXPIRED dibersihkan; audit penutupan asli tidak diubah.'
        || E'\n' || jsonb_build_object('maintenance_key', v_key, 'database_role', current_user,
          'execution', 'User-authorized database maintenance; not an authenticated application-user action',
          'before', jsonb_build_object('activity', to_jsonb(v_before), 'entries', v_entries_before),
          'after', jsonb_build_object('activity', to_jsonb(v_after), 'entries', v_entries_after),
          'evidence_fingerprint', md5(v_evidence::text))::text
    ) returning id into v_correction_history_id;

    if v_evidence is distinct from (
      select coalesce(jsonb_agg(to_jsonb(ev) order by ev.id), '[]'::jsonb)
      from public.overtime_evidence ev where ev.activity_id = v_before.id
    ) or v_history is distinct from (
      select coalesce(jsonb_agg(to_jsonb(h) order by h.id), '[]'::jsonb)
      from public.overtime_activity_history h where h.activity_id = v_before.id
        and h.id not in (v_submitted_history_id, v_correction_history_id)
    ) or (select count(*) from public.overtime_activity_history where activity_id = v_before.id) <> v_target.history_count + 2 then
      raise exception 'Evidence or original history changed at %; entire correction aborted', v_target.location;
    end if;
  end loop;

  if v_activities_updated <> 3 or v_entries_updated <> 9 then
    raise exception 'Must correct exactly three activities and nine participants atomically';
  end if;
end;
$correction$;
