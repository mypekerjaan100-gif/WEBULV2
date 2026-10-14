-- Restore bb12aef overtime functions without deleting existing history.

create or replace function public.validate_overtime_activity_participant()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
begin
  if new.activity_id is null then
    return new;
  end if;

  perform 1
  from public.overtime_activities
  where id = new.activity_id
  for update;

  select * into v_activity
  from public.overtime_activities
  where id = new.activity_id;
  if not found then
    raise exception 'Overtime activity not found';
  end if;
  if (new.contract_id, new.up3_id, new.unit_id) is distinct from
     (v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Participant scope must match overtime activity scope';
  end if;
  if new.participant_started_at < v_activity.started_at
     or new.participant_ended_at > v_activity.ended_at then
    raise exception 'Participant time must be inside overtime activity time';
  end if;
  if new.work_date <> v_activity.overtime_date
     or new.period_month <> v_activity.period_month then
    raise exception 'Participant date/period must follow activity start in Asia/Pontianak';
  end if;
  return new;
end;
$$;

create or replace function public.guard_overtime_activity_participants()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_overtime_date date := (new.started_at at time zone 'Asia/Pontianak')::date;
  v_period_month date := date_trunc(
    'month', new.started_at at time zone 'Asia/Pontianak'
  )::date;
begin
  if not exists (
    select 1 from public.overtime_entries entry where entry.activity_id = old.id
  ) then
    return new;
  end if;
  if (new.contract_id, new.up3_id, new.unit_id) is distinct from
     (old.contract_id, old.up3_id, old.unit_id) then
    raise exception 'Activity scope cannot change after participants exist';
  end if;
  if exists (
    select 1
    from public.overtime_entries entry
    where entry.activity_id = old.id
      and (
        entry.participant_started_at < new.started_at
        or entry.participant_ended_at > new.ended_at
        or entry.work_date <> v_overtime_date
        or entry.period_month <> v_period_month
      )
  ) then
    raise exception 'Activity time change would invalidate existing participants';
  end if;
  return new;
end;
$$;

create or replace function public.correct_approved_overtime_work_l6(
  p_activity_id uuid,
  p_overtime_date date,
  p_participants jsonb,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_activity public.overtime_activities%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_count int;
  v_idx int;
  v_part jsonb;
  v_entry_id uuid;
  v_started timestamptz;
  v_ended timestamptz;
  v_row public.overtime_entries%rowtype;
  v_business_date date;
  v_actual_minutes numeric;
  v_duration numeric;
  v_multiplier numeric;
  v_rate numeric(18,2);
  v_new_rate numeric(18,2);
  v_hours numeric;
  v_amount numeric(18,2);
  v_min_started timestamptz;
  v_max_ended timestamptz;
  v_old_min timestamptz;
  v_old_max timestamptz;
  v_changed int := 0;
  v_notes text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_activity_id is null then
    raise exception 'Overtime activity is required';
  end if;
  if v_reason = '' then
    raise exception 'Alasan koreksi wajib diisi';
  end if;
  if p_overtime_date is null then
    raise exception 'Tanggal lembur wajib diisi';
  end if;
  if p_participants is null or jsonb_typeof(p_participants) <> 'array' then
    raise exception 'Participants must be a JSON array';
  end if;
  v_count := jsonb_array_length(p_participants);
  if v_count = 0 then
    raise exception 'At least one participant is required';
  end if;

  select * into v_activity
  from public.overtime_activities
  where id = p_activity_id
  for update;
  if not found or v_activity.deleted_at is not null then
    raise exception 'Overtime activity is not available';
  end if;
  if v_activity.type <> 'WORK' then
    raise exception 'Hanya Lembur Pekerjaan yang dapat dikoreksi';
  end if;
  if v_activity.status <> 'APPROVED' then
    raise exception 'Hanya pengajuan yang sudah disetujui yang dapat dikoreksi';
  end if;
  if p_expected_updated_at is null
    or v_activity.updated_at is distinct from p_expected_updated_at then
    raise exception 'Data sudah berubah. Muat ulang daftar lembur lalu buka kembali koreksinya.';
  end if;

  if not public.auth_is_super_admin()
    and not exists (
      select 1 from public.contract_memberships cm
      where cm.user_id = auth.uid()
        and cm.contract_role = 'ADMIN_UP3'
        and cm.contract_id = v_activity.contract_id
        and cm.operational_up3_id = v_activity.up3_id
        and cm.status = 'ACTIVE'
        and cm.effective_from <= current_date
        and (cm.effective_to is null or current_date < cm.effective_to)
    ) then
    raise exception 'Hanya Super Admin atau Admin UP3 pada scope ini yang dapat mengoreksi data yang sudah disetujui' using errcode = '42501';
  end if;

  -- Seluruh peserta harus APPROVED (koreksi batch penuh).
  if (select count(*) from public.overtime_entries where activity_id = p_activity_id) <> v_count then
    raise exception 'Jumlah peserta tidak sesuai dengan data tersimpan';
  end if;
  if exists (
    select 1 from public.overtime_entries
    where activity_id = p_activity_id and approval_status <> 'APPROVED'
  ) then
    raise exception 'Koreksi ini hanya untuk pengajuan yang seluruh pesertanya sudah disetujui';
  end if;

  v_min_started := null;
  v_max_ended := null;
  for v_idx in 0..v_count - 1 loop
    v_part := p_participants -> v_idx;
    v_entry_id := nullif(btrim(v_part ->> 'entry_id'), '')::uuid;
    v_started := nullif(btrim(v_part ->> 'started_at'), '')::timestamptz;
    v_ended := nullif(btrim(v_part ->> 'ended_at'), '')::timestamptz;
    if v_entry_id is null or v_started is null or v_ended is null then
      raise exception 'Each participant requires entry, start, and end';
    end if;
    if v_ended <= v_started then
      raise exception 'Participant end must be after start';
    end if;
    if v_ended - v_started < interval '1 minute' then
      raise exception 'Participant duration must be at least one minute';
    end if;
    select * into v_row from public.overtime_entries
    where id = v_entry_id and activity_id = p_activity_id
    for update;
    if not found then
      raise exception 'Peserta tidak termasuk dalam pengajuan ini';
    end if;
    if (v_started at time zone 'Asia/Pontianak')::date <> p_overtime_date then
      raise exception 'Semua peserta harus mulai pada tanggal lembur yang dikoreksi';
    end if;
    if not public.overtime_employee_is_eligible_l2(
      v_row.employee_id, v_activity.contract_id, v_activity.up3_id, v_activity.unit_id,
      (v_started at time zone 'Asia/Pontianak')::date) then
      raise exception 'Pegawai tidak eligible pada tanggal koreksi: %', coalesce(v_row.employee_name_snapshot, v_row.employee_id::text);
    end if;
    if v_min_started is null or v_started < v_min_started then v_min_started := v_started; end if;
    if v_max_ended is null or v_ended > v_max_ended then v_max_ended := v_ended; end if;
  end loop;

  -- Perlebar envelope sementara agar trigger tidak menolak jam baru.
  select min(participant_started_at), max(participant_ended_at)
    into v_old_min, v_old_max
  from public.overtime_entries where activity_id = p_activity_id;
  update public.overtime_activities
  set started_at = least(v_old_min, v_min_started),
      ended_at = greatest(v_old_max, v_max_ended),
      updated_by = auth.uid()
  where id = p_activity_id;

  for v_idx in 0..v_count - 1 loop
    v_part := p_participants -> v_idx;
    v_entry_id := (v_part ->> 'entry_id')::uuid;
    v_started := (v_part ->> 'started_at')::timestamptz;
    v_ended := (v_part ->> 'ended_at')::timestamptz;
    select * into v_row from public.overtime_entries where id = v_entry_id;
    v_business_date := (v_started at time zone 'Asia/Pontianak')::date;
    if v_row.participant_started_at is not distinct from v_started
      and v_row.participant_ended_at is not distinct from v_ended then
      continue;
    end if;
    v_actual_minutes := extract(epoch from (v_ended - v_started)) / 60;
    v_duration := round(v_actual_minutes / 60, 4);
    v_multiplier := round(case when v_actual_minutes <= 60 then v_actual_minutes * 1.5 / 60 else 1.5 + ((v_actual_minutes - 60) * 2 / 60) end, 4);
    -- Tanggal sama: pertahankan tarif snapshot agar perubahan master rate
    -- tidak mengubah transaksi retroaktif. Tanggal berubah: pakai tarif
    -- efektif pada tanggal baru.
    if v_row.work_date is not distinct from v_business_date then
      v_new_rate := v_row.hourly_rate_snapshot;
    else
      select r.hourly_rate into v_new_rate
      from public.employee_hourly_rate_history r
      where r.employee_id = v_row.employee_id
        and r.effective_from <= v_business_date
        and (r.effective_to is null or v_business_date < r.effective_to)
      order by r.effective_from desc limit 1;
      if v_new_rate is null then
        raise exception 'Hourly rate not found for corrected date';
      end if;
    end if;
    v_hours := round(v_duration, 2);
    v_amount := round(v_new_rate * v_multiplier, 2);
    v_notes := 'Tanggal ' || v_row.work_date::text || '→' || v_business_date::text
      || '; jam ' || to_char(v_row.participant_started_at at time zone 'Asia/Pontianak', 'HH24:MI')
      || '–' || to_char(v_row.participant_ended_at at time zone 'Asia/Pontianak', 'HH24:MI')
      || '→' || to_char(v_started at time zone 'Asia/Pontianak', 'HH24:MI')
      || '–' || to_char(v_ended at time zone 'Asia/Pontianak', 'HH24:MI')
      || ' (' || v_row.hours::text || '→' || v_hours::text || ' jam)'
      || '; tarif Rp ' || trim(to_char(v_row.hourly_rate_snapshot, '999G999G999G990'))
      || '→Rp ' || trim(to_char(v_new_rate, '999G999G999G990'))
      || '; total Rp ' || trim(to_char(v_row.calculated_amount_snapshot, '999G999G999G990'))
      || '→Rp ' || trim(to_char(v_amount, '999G999G999G990')) || '.';
    update public.overtime_entries
    set work_date = v_business_date,
        period_month = date_trunc('month', v_started at time zone 'Asia/Pontianak')::date,
        hours = v_hours,
        participant_started_at = v_started,
        participant_ended_at = v_ended,
        duration_hours_snapshot = v_duration,
        multiplier_hours_snapshot = v_multiplier,
        hourly_rate_snapshot = v_new_rate,
        calculated_amount_snapshot = v_amount,
        updated_by = auth.uid()
    where id = v_entry_id;
    insert into public.overtime_activity_history(
      activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, notes
    ) values (
      p_activity_id, v_entry_id, 'CORRECTED', auth.uid(), 'APPROVED', 'APPROVED',
      v_reason, v_notes
    );
    v_changed := v_changed + 1;
  end loop;

  if v_changed = 0 then
    raise exception 'Tidak ada perubahan tanggal/jam.';
  end if;

  -- Ketatkan envelope ke hasil akhir; status harus tetap APPROVED.
  select min(participant_started_at), max(participant_ended_at)
    into v_min_started, v_max_ended
  from public.overtime_entries where activity_id = p_activity_id;
  update public.overtime_activities
  set started_at = v_min_started,
      ended_at = v_max_ended,
      updated_by = auth.uid()
  where id = p_activity_id;
  perform public.refresh_overtime_activity_review_status(p_activity_id);
  select * into v_activity from public.overtime_activities where id = p_activity_id;
  if v_activity.status <> 'APPROVED' then
    raise exception 'Koreksi dibatalkan: status agregat berubah.';
  end if;

  return p_activity_id;
end;
$function$;

revoke all on function public.correct_approved_overtime_work_l6(uuid, date, jsonb, text, timestamptz) from public, anon;
grant execute on function public.correct_approved_overtime_work_l6(uuid, date, jsonb, text, timestamptz) to authenticated;

comment on function public.correct_approved_overtime_work_l6(uuid, date, jsonb, text, timestamptz)
is 'Corrects date/time of fully-approved work overtime; SUPER_ADMIN or exact ADMIN_UP3; stays APPROVED with per-entry audit.';

drop function if exists public.correct_work_batch_date_l3(uuid,date,text,timestamptz);

do $$
declare
  v_date_corrected_count bigint;
begin
  lock table public.overtime_activity_history in access exclusive mode;
  select count(*) into v_date_corrected_count
  from public.overtime_activity_history
  where event = 'DATE_CORRECTED';

  alter table public.overtime_activity_history
    drop constraint if exists overtime_activity_history_event_check;

  if v_date_corrected_count > 0 then
    alter table public.overtime_activity_history
      add constraint overtime_activity_history_event_check
      check (event in ('CREATED', 'SUBMITTED', 'REJECTED', 'RESUBMITTED', 'APPROVED', 'CLOSED', 'DELETED', 'REVISION_SAVED', 'UPDATED', 'CORRECTED', 'DATE_CORRECTED'));
  else
    alter table public.overtime_activity_history
      add constraint overtime_activity_history_event_check
      check (event in ('CREATED', 'SUBMITTED', 'REJECTED', 'RESUBMITTED', 'APPROVED', 'CLOSED', 'DELETED', 'REVISION_SAVED', 'UPDATED', 'CORRECTED'));
  end if;
end;
$$;
