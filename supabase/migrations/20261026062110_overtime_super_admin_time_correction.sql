set local lock_timeout = '5s';

create or replace function public.sync_overtime_activity_business_dates()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_effective_submission_days integer;
begin
  if tg_op = 'UPDATE'
     and current_setting('overtime.time_correction_activity', true) = old.id::text
     and public.auth_is_super_admin() then
    new.overtime_date := old.overtime_date;
    new.period_month := old.period_month;
    new.submission_deadline := old.submission_deadline;
    return new;
  end if;

  new.overtime_date := (new.started_at at time zone 'Asia/Pontianak')::date;
  new.period_month := date_trunc(
    'month',
    new.started_at at time zone 'Asia/Pontianak'
  )::date;
  select config.effective_submission_days
  into v_effective_submission_days
  from public.resolve_overtime_initial_deadline_config(
    new.contract_id,
    new.up3_id,
    clock_timestamp()
  ) config;
  new.submission_deadline := new.overtime_date + v_effective_submission_days;
  return new;
end;
$$;

create or replace function public.enforce_overtime_initial_deadline_l6()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_as_of timestamptz := clock_timestamp();
  v_deadline timestamptz;
  v_effective_submission_days integer;
begin
  if tg_op = 'UPDATE'
     and current_setting('overtime.time_correction_activity', true) = old.id::text
     and public.auth_is_super_admin()
     and new.status is not distinct from old.status
     and new.submission_count is not distinct from old.submission_count then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'DRAFT'
     and coalesce(old.submission_count, 0) = 0
     and new.status <> 'CLOSED' then
    select config.effective_submission_days
    into v_effective_submission_days
    from public.resolve_overtime_initial_deadline_config(
      old.contract_id,
      old.up3_id,
      v_as_of
    ) config;
    v_deadline := public.resolve_overtime_initial_deadline(
      old.contract_id,
      old.up3_id,
      old.overtime_date,
      v_as_of
    );
    if v_as_of > v_deadline then
      raise exception 'Batas pengajuan telah lewat. Batas efektif H+%. Draft Lembur sudah kedaluwarsa.',
        v_effective_submission_days;
    end if;
  end if;

  if new.status = 'DRAFT' and coalesce(new.submission_count, 0) = 0 then
    select config.effective_submission_days
    into v_effective_submission_days
    from public.resolve_overtime_initial_deadline_config(
      new.contract_id,
      new.up3_id,
      v_as_of
    ) config;
    v_deadline := public.resolve_overtime_initial_deadline(
      new.contract_id,
      new.up3_id,
      new.overtime_date,
      v_as_of
    );
    if v_as_of > v_deadline then
      raise exception 'Batas pengajuan telah lewat. Pilih tanggal lembur yang masih berada dalam batas H+%.',
        v_effective_submission_days;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.correct_overtime_entry_times_super_admin_l6(
  p_activity_id uuid,
  p_entry_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_activity public.overtime_activities%rowtype;
  v_entry public.overtime_entries%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_month_names text[] := array['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  v_type_word text;
  v_participant_name text;
  v_replaced_name text;
  v_old_description text;
  v_new_description text;
  v_new_activity_description text;
  v_new_entry_description text;
  v_actual_minutes numeric;
  v_duration numeric;
  v_multiplier numeric;
  v_hours numeric;
  v_amount numeric;
  v_old_activity_status text;
  v_old_entry_status text;
  v_after_activity_status text;
  v_after_entry_status text;
  v_min_started timestamptz;
  v_max_ended timestamptz;
  v_notes text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.auth_is_super_admin() then
    raise exception 'Hanya Super Admin yang dapat mengoreksi jam dan nominal Lembur' using errcode = '42501';
  end if;
  if p_activity_id is null or p_entry_id is null then
    raise exception 'Pengajuan dan peserta wajib dipilih';
  end if;
  if v_reason = '' then
    raise exception 'Alasan koreksi wajib diisi';
  end if;
  if p_started_at is null or p_ended_at is null then
    raise exception 'Jam mulai dan jam selesai wajib diisi';
  end if;
  if p_expected_updated_at is null then
    raise exception 'Token perubahan wajib dikirim';
  end if;

  select * into v_activity
  from public.overtime_activities
  where id = p_activity_id
  for update;
  if not found or v_activity.deleted_at is not null then
    raise exception 'Pengajuan Lembur tidak tersedia';
  end if;
  if v_activity.updated_at is distinct from p_expected_updated_at then
    raise exception 'Data sudah berubah. Muat ulang daftar Lembur lalu buka kembali koreksinya.' using errcode = '40001';
  end if;
  if v_activity.type not in ('WORK','REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION') then
    raise exception 'Jenis Lembur tidak didukung';
  end if;

  select * into v_entry
  from public.overtime_entries
  where id = p_entry_id and activity_id = p_activity_id
  for update;
  if not found then
    raise exception 'Peserta tidak termasuk dalam pengajuan ini';
  end if;
  if v_entry.participant_started_at is null or v_entry.participant_ended_at is null then
    raise exception 'Jam peserta tersimpan belum lengkap';
  end if;
  if p_ended_at <= p_started_at then
    raise exception 'Jam selesai harus setelah jam mulai';
  end if;
  v_actual_minutes := extract(epoch from (p_ended_at - p_started_at)) / 60;
  if v_actual_minutes < 1 then
    raise exception 'Durasi peserta minimal satu menit';
  end if;
  if v_actual_minutes >= 1440 then
    raise exception 'Durasi peserta harus kurang dari 24 jam';
  end if;
  if (p_started_at at time zone 'Asia/Pontianak')::date is distinct from v_entry.work_date
     or (p_started_at at time zone 'Asia/Pontianak')::date is distinct from v_activity.overtime_date then
    raise exception 'Koreksi ini hanya boleh mengubah jam pada tanggal Lembur yang sama';
  end if;
  if v_entry.participant_started_at is not distinct from p_started_at
     and v_entry.participant_ended_at is not distinct from p_ended_at then
    raise exception 'Jam mulai dan jam selesai belum berubah';
  end if;
  if v_activity.type <> 'WORK'
     and (select count(*) from public.overtime_entries where activity_id = p_activity_id) <> 1 then
    raise exception 'Lembur pengganti harus memiliki tepat satu peserta';
  end if;

  v_duration := round(v_actual_minutes / 60, 4);
  v_multiplier := round(
    case when v_actual_minutes <= 60
      then v_actual_minutes * 1.5 / 60
      else 1.5 + ((v_actual_minutes - 60) * 2 / 60)
    end,
    4
  );
  v_hours := round(v_duration, 2);
  v_amount := round(v_entry.hourly_rate_snapshot * v_multiplier, 2);
  v_old_activity_status := v_activity.status;
  v_old_entry_status := v_entry.approval_status;
  v_new_activity_description := v_activity.description;
  v_new_entry_description := v_entry.description;

  if v_activity.type <> 'WORK' then
    v_participant_name := upper(coalesce(v_entry.employee_name_snapshot, ''));
    select upper(e.name) into v_replaced_name
    from public.employees e
    where e.id = v_activity.replaced_employee_id;
    v_type_word := case v_activity.type
      when 'REPLACEMENT_LEAVE' then 'cuti'
      when 'REPLACEMENT_SICK' then 'sakit'
      else 'izin'
    end;
    if v_participant_name <> '' and v_replaced_name is not null then
      v_old_description := v_participant_name
        || ' menggantikan ' || v_replaced_name || ' yang ' || v_type_word
        || ' pada ' || extract(day from v_entry.participant_started_at at time zone 'Asia/Pontianak')::integer
        || ' ' || v_month_names[extract(month from v_entry.participant_started_at at time zone 'Asia/Pontianak')::integer]
        || ' ' || extract(year from v_entry.participant_started_at at time zone 'Asia/Pontianak')::integer
        || ' pukul ' || to_char(v_entry.participant_started_at at time zone 'Asia/Pontianak', 'HH24:MI')
        || '–' || to_char(v_entry.participant_ended_at at time zone 'Asia/Pontianak', 'HH24:MI') || '.';
      v_new_description := v_participant_name
        || ' menggantikan ' || v_replaced_name || ' yang ' || v_type_word
        || ' pada ' || extract(day from p_started_at at time zone 'Asia/Pontianak')::integer
        || ' ' || v_month_names[extract(month from p_started_at at time zone 'Asia/Pontianak')::integer]
        || ' ' || extract(year from p_started_at at time zone 'Asia/Pontianak')::integer
        || ' pukul ' || to_char(p_started_at at time zone 'Asia/Pontianak', 'HH24:MI')
        || '–' || to_char(p_ended_at at time zone 'Asia/Pontianak', 'HH24:MI') || '.';
      if v_activity.description = v_old_description then
        v_new_activity_description := v_new_description;
      end if;
      if v_entry.description = v_old_description then
        v_new_entry_description := v_new_description;
      end if;
    end if;
  end if;

  perform set_config('overtime.time_correction_activity', p_activity_id::text, true);

  update public.overtime_activities
  set started_at = least(v_activity.started_at, p_started_at),
      ended_at = greatest(v_activity.ended_at, p_ended_at),
      description = v_new_activity_description,
      updated_by = auth.uid()
  where id = p_activity_id;

  update public.overtime_entries
  set participant_started_at = p_started_at,
      participant_ended_at = p_ended_at,
      duration_hours_snapshot = v_duration,
      multiplier_hours_snapshot = v_multiplier,
      hours = v_hours,
      calculated_amount_snapshot = v_amount,
      description = v_new_entry_description,
      updated_by = auth.uid()
  where id = p_entry_id;

  select min(participant_started_at), max(participant_ended_at)
  into v_min_started, v_max_ended
  from public.overtime_entries
  where activity_id = p_activity_id;

  update public.overtime_activities
  set started_at = v_min_started,
      ended_at = v_max_ended,
      updated_by = auth.uid()
  where id = p_activity_id;

  perform set_config('overtime.time_correction_activity', '', true);

  select status into v_after_activity_status
  from public.overtime_activities where id = p_activity_id;
  select approval_status into v_after_entry_status
  from public.overtime_entries where id = p_entry_id;
  if v_after_activity_status is distinct from v_old_activity_status
     or v_after_entry_status is distinct from v_old_entry_status then
    raise exception 'Koreksi dibatalkan: status pengajuan tidak boleh berubah';
  end if;

  v_notes := 'Jam ' || to_char(v_entry.participant_started_at at time zone 'Asia/Pontianak', 'HH24:MI')
    || '–' || to_char(v_entry.participant_ended_at at time zone 'Asia/Pontianak', 'HH24:MI')
    || '→' || to_char(p_started_at at time zone 'Asia/Pontianak', 'HH24:MI')
    || '–' || to_char(p_ended_at at time zone 'Asia/Pontianak', 'HH24:MI')
    || '; durasi ' || v_entry.duration_hours_snapshot::text || '→' || v_duration::text || ' jam'
    || '; tarif Rp ' || trim(to_char(v_entry.hourly_rate_snapshot, '999G999G999G990'))
    || '; total Rp ' || trim(to_char(v_entry.calculated_amount_snapshot, '999G999G999G990'))
    || '→Rp ' || trim(to_char(v_amount, '999G999G999G990'))
    || '; status ' || v_entry.approval_status || ' tetap.';

  insert into public.overtime_activity_history(
    activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, notes
  ) values (
    p_activity_id, p_entry_id, 'CORRECTED', auth.uid(), v_old_entry_status, v_after_entry_status, v_reason, v_notes
  );

  return jsonb_build_object(
    'activity_id', p_activity_id,
    'entry_id', p_entry_id,
    'status', v_after_entry_status,
    'activity_status', v_after_activity_status,
    'previous_started_at', v_entry.participant_started_at,
    'previous_ended_at', v_entry.participant_ended_at,
    'started_at', p_started_at,
    'ended_at', p_ended_at,
    'previous_duration_hours', v_entry.duration_hours_snapshot,
    'duration_hours', v_duration,
    'previous_multiplier_hours', v_entry.multiplier_hours_snapshot,
    'multiplier_hours', v_multiplier,
    'hourly_rate', v_entry.hourly_rate_snapshot,
    'previous_amount', v_entry.calculated_amount_snapshot,
    'amount', v_amount
  );
end;
$function$;

revoke all on function public.correct_overtime_entry_times_super_admin_l6(uuid, uuid, timestamptz, timestamptz, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.correct_overtime_entry_times_super_admin_l6(uuid, uuid, timestamptz, timestamptz, text, timestamptz)
  to authenticated;
