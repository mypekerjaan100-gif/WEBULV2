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
     and current_setting('overtime.time_correction_recalc_dates', true) is distinct from 'on'
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

create or replace function public.correct_overtime_entry_super_admin_l7(
  p_activity_id uuid,
  p_entry_id uuid,
  p_overtime_date date,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_reason text,
  p_expected_updated_at timestamptz,
  p_apply boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_apply boolean := coalesce(p_apply, false);
  v_activity public.overtime_activities%rowtype;
  v_target public.overtime_entries%rowtype;
  v_row public.overtime_entries%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_date_changed boolean;
  v_target_changed boolean := false;
  v_participant jsonb;
  v_plan jsonb := '[]'::jsonb;
  v_target_plan jsonb;
  v_new_started timestamptz;
  v_new_ended timestamptz;
  v_new_rate numeric(18,2);
  v_actual_minutes numeric;
  v_duration numeric;
  v_multiplier numeric;
  v_hours numeric;
  v_amount numeric;
  v_new_description text;
  v_new_activity_description text;
  v_target_description text;
  v_month_names text[] := array['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  v_participant_name text;
  v_replaced_name text;
  v_type_word text;
  v_min_started timestamptz;
  v_max_ended timestamptz;
  v_notes text;
  v_after_status text;
  v_after_activity_status text;
  v_prev_date_transition text := current_setting('overtime.date_transition', true);
  v_prev_recalc text := current_setting('overtime.time_correction_recalc_dates', true);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.auth_is_super_admin() then
    raise exception 'Hanya Super Admin yang dapat mengoreksi Lembur' using errcode = '42501';
  end if;
  if p_activity_id is null or p_entry_id is null then
    raise exception 'Pengajuan dan peserta wajib dipilih';
  end if;
  if p_expected_updated_at is null then
    raise exception 'Token perubahan wajib dikirim';
  end if;
  if p_overtime_date is null then
    raise exception 'Tanggal lembur wajib diisi';
  end if;
  if p_started_at is null or p_ended_at is null then
    raise exception 'Jam mulai dan jam selesai wajib diisi';
  end if;
  if p_ended_at <= p_started_at then
    raise exception 'Jam selesai harus setelah jam mulai';
  end if;
  if (p_started_at at time zone 'Asia/Pontianak')::date is distinct from p_overtime_date then
    raise exception 'Jam mulai harus berada pada tanggal Lembur yang dipilih';
  end if;
  if (p_ended_at at time zone 'Asia/Pontianak')::date < p_overtime_date then
    raise exception 'Jam selesai tidak boleh sebelum tanggal Lembur';
  end if;
  if p_ended_at - p_started_at < interval '1 minute'
     or p_ended_at - p_started_at >= interval '24 hours' then
    raise exception 'Durasi peserta harus antara satu menit dan kurang dari 24 jam';
  end if;
  if v_apply and v_reason = '' then
    raise exception 'Alasan koreksi wajib diisi';
  end if;

  if v_apply then
    select * into v_activity
    from public.overtime_activities
    where id = p_activity_id
    for update;
  else
    select * into v_activity
    from public.overtime_activities
    where id = p_activity_id;
  end if;
  if not found or v_activity.deleted_at is not null then
    raise exception 'Pengajuan Lembur tidak tersedia';
  end if;
  if v_activity.updated_at is distinct from p_expected_updated_at then
    raise exception 'Data sudah berubah. Muat ulang daftar Lembur lalu buka kembali koreksinya.' using errcode = '40001';
  end if;
  if v_activity.type not in ('WORK','REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION') then
    raise exception 'Jenis Lembur tidak didukung';
  end if;
  if v_apply then
    perform 1
    from public.overtime_entries
    where activity_id = p_activity_id
    order by id
    for update;
  end if;

  select * into v_target
  from public.overtime_entries
  where id = p_entry_id and activity_id = p_activity_id;
  if not found then
    raise exception 'Peserta tidak termasuk dalam pengajuan ini';
  end if;
  if v_activity.type <> 'WORK'
     and (select count(*) from public.overtime_entries where activity_id = p_activity_id) <> 1 then
    raise exception 'Lembur pengganti harus memiliki tepat satu peserta';
  end if;
  if v_activity.type <> 'WORK' then
    select upper(e.name) into v_replaced_name
    from public.employees e
    where e.id = v_activity.replaced_employee_id;
    v_type_word := case v_activity.type
      when 'REPLACEMENT_LEAVE' then 'cuti'
      when 'REPLACEMENT_SICK' then 'sakit'
      else 'izin'
    end;
  end if;

  v_date_changed := p_overtime_date is distinct from v_activity.overtime_date;
  v_new_activity_description := v_activity.description;
  v_target_changed := v_date_changed
    or v_target.participant_started_at is distinct from p_started_at
    or v_target.participant_ended_at is distinct from p_ended_at;

  for v_row in
    select * from public.overtime_entries
    where activity_id = p_activity_id
    order by id
  loop
    if v_row.id = p_entry_id then
      v_new_started := p_started_at;
      v_new_ended := p_ended_at;
    else
      if v_row.participant_started_at is null or v_row.participant_ended_at is null then
        raise exception 'Jam peserta lain belum lengkap: %', coalesce(v_row.employee_name_snapshot, v_row.id::text);
      end if;
      v_new_started := (
        p_overtime_date
        + ((v_row.participant_started_at at time zone 'Asia/Pontianak')::time)
      ) at time zone 'Asia/Pontianak';
      v_new_ended := v_new_started + (v_row.participant_ended_at - v_row.participant_started_at);
    end if;

    if v_new_ended <= v_new_started then
      raise exception 'Jam selesai peserta harus setelah jam mulai: %', coalesce(v_row.employee_name_snapshot, v_row.id::text);
    end if;
    if v_new_ended - v_new_started < interval '1 minute'
       or v_new_ended - v_new_started >= interval '24 hours' then
      raise exception 'Durasi peserta harus antara satu menit dan kurang dari 24 jam: %', coalesce(v_row.employee_name_snapshot, v_row.id::text);
    end if;
    if (v_new_started at time zone 'Asia/Pontianak')::date is distinct from p_overtime_date then
      raise exception 'Semua peserta harus mulai pada tanggal Lembur yang dipilih';
    end if;

    if v_date_changed then
      if not public.overtime_employee_is_eligible_l2(
        v_row.employee_id, v_activity.contract_id, v_activity.up3_id, v_activity.unit_id, p_overtime_date
      ) then
        raise exception 'Pegawai tidak eligible pada tanggal koreksi: %', coalesce(v_row.employee_name_snapshot, v_row.employee_id::text);
      end if;
      if v_activity.type <> 'WORK'
         and not public.overtime_employee_is_eligible_l2(
           v_activity.replaced_employee_id, v_activity.contract_id, v_activity.up3_id, v_activity.unit_id, p_overtime_date
         ) then
        raise exception 'Pegawai pengganti tidak eligible pada tanggal koreksi';
      end if;
      select r.hourly_rate into v_new_rate
      from public.employee_hourly_rate_history r
      where r.employee_id = v_row.employee_id
        and r.effective_from <= p_overtime_date
        and (r.effective_to is null or p_overtime_date < r.effective_to)
      order by r.effective_from desc limit 1;
      if v_new_rate is null then
        raise exception 'Tarif historis tidak ditemukan untuk % pada tanggal koreksi', coalesce(v_row.employee_name_snapshot, v_row.employee_id::text);
      end if;
    else
      v_new_rate := v_row.hourly_rate_snapshot;
    end if;

    v_actual_minutes := extract(epoch from (v_new_ended - v_new_started)) / 60;
    v_duration := round(v_actual_minutes / 60, 4);
    v_multiplier := round(
      case when v_actual_minutes <= 60
        then v_actual_minutes * 1.5 / 60
        else 1.5 + ((v_actual_minutes - 60) * 2 / 60)
      end,
      4
    );
    v_hours := round(v_duration, 2);
    v_amount := round(v_new_rate * v_multiplier, 2);
    v_new_description := v_row.description;

    if v_row.id = p_entry_id and v_activity.type <> 'WORK' then
      v_participant_name := upper(coalesce(v_row.employee_name_snapshot, ''));
      if v_participant_name <> '' and v_replaced_name is not null then
        v_new_description := v_participant_name
          || ' menggantikan ' || v_replaced_name || ' yang ' || v_type_word
          || ' pada ' || extract(day from v_new_started at time zone 'Asia/Pontianak')::integer
          || ' ' || v_month_names[extract(month from v_new_started at time zone 'Asia/Pontianak')::integer]
          || ' ' || extract(year from v_new_started at time zone 'Asia/Pontianak')::integer
          || ' pukul ' || to_char(v_new_started at time zone 'Asia/Pontianak', 'HH24:MI')
          || '–' || to_char(v_new_ended at time zone 'Asia/Pontianak', 'HH24:MI') || '.';
        v_new_activity_description := v_new_description;
      end if;
    end if;
    if v_row.id = p_entry_id then
      v_target_description := v_new_description;
    end if;

    v_participant := jsonb_build_object(
      'entry_id', v_row.id,
      'employee_id', v_row.employee_id,
      'participant_name', v_row.employee_name_snapshot,
      'previous_status', v_row.approval_status,
      'status', v_row.approval_status,
      'previous_date', v_row.work_date,
      'date', p_overtime_date,
      'previous_started_at', v_row.participant_started_at,
      'started_at', v_new_started,
      'previous_ended_at', v_row.participant_ended_at,
      'ended_at', v_new_ended,
      'previous_rate', v_row.hourly_rate_snapshot,
      'rate', v_new_rate,
      'previous_duration_hours', v_row.duration_hours_snapshot,
      'duration_hours', v_duration,
      'previous_multiplier_hours', v_row.multiplier_hours_snapshot,
      'multiplier_hours', v_multiplier,
      'previous_amount', v_row.calculated_amount_snapshot,
      'amount', v_amount,
      'new_description', v_new_description,
      'is_target', v_row.id = p_entry_id
    );
    v_plan := v_plan || jsonb_build_array(v_participant);
    if v_row.id = p_entry_id then v_target_plan := v_participant; end if;
    if v_min_started is null or v_new_started < v_min_started then v_min_started := v_new_started; end if;
    if v_max_ended is null or v_new_ended > v_max_ended then v_max_ended := v_new_ended; end if;
  end loop;

  if v_target_plan is null then
    raise exception 'Peserta target tidak ditemukan dalam pengajuan';
  end if;

  v_plan := jsonb_build_object(
    'activity_id', v_activity.id,
    'activity_type', v_activity.type,
    'activity_status', v_activity.status,
    'entry_id', p_entry_id,
    'previous_date', v_activity.overtime_date,
    'date', p_overtime_date,
    'date_changed', v_date_changed,
    'target_changed', v_target_changed,
    'participants', v_plan,
    'target', v_target_plan
  );

  if not v_apply then
    return v_plan || jsonb_build_object('applied', false);
  end if;
  if not v_target_changed then
    raise exception 'Tanggal dan jam peserta belum berubah';
  end if;

  perform set_config('overtime.time_correction_activity', p_activity_id::text, true);
  if v_date_changed then
    perform set_config('overtime.time_correction_recalc_dates', 'on', true);
    perform set_config('overtime.date_transition', 'on', true);
  end if;

  update public.overtime_activities
  set started_at = least(v_activity.started_at, v_min_started),
      ended_at = greatest(v_activity.ended_at, v_max_ended),
      description = v_new_activity_description,
      updated_by = auth.uid()
  where id = p_activity_id;

  for v_participant in select value from jsonb_array_elements(v_plan -> 'participants') loop
    update public.overtime_entries
    set work_date = p_overtime_date,
        period_month = date_trunc('month', p_overtime_date::timestamp)::date,
        participant_started_at = (v_participant ->> 'started_at')::timestamptz,
        participant_ended_at = (v_participant ->> 'ended_at')::timestamptz,
        duration_hours_snapshot = (v_participant ->> 'duration_hours')::numeric,
        multiplier_hours_snapshot = (v_participant ->> 'multiplier_hours')::numeric,
        hours = round((v_participant ->> 'duration_hours')::numeric, 2),
        hourly_rate_snapshot = (v_participant ->> 'rate')::numeric,
        calculated_amount_snapshot = (v_participant ->> 'amount')::numeric,
        description = v_participant ->> 'new_description',
        updated_by = auth.uid()
    where id = (v_participant ->> 'entry_id')::uuid
    returning approval_status into v_after_status;
    if v_after_status is distinct from (v_participant ->> 'previous_status') then
      raise exception 'Koreksi dibatalkan: status peserta tidak boleh berubah';
    end if;

    v_notes := case when (v_participant ->> 'is_target')::boolean
      then 'Jam '
        || to_char((v_participant ->> 'previous_started_at')::timestamptz at time zone 'Asia/Pontianak', 'HH24:MI')
        || '–' || to_char((v_participant ->> 'previous_ended_at')::timestamptz at time zone 'Asia/Pontianak', 'HH24:MI')
        || '→' || to_char((v_participant ->> 'started_at')::timestamptz at time zone 'Asia/Pontianak', 'HH24:MI')
        || '–' || to_char((v_participant ->> 'ended_at')::timestamptz at time zone 'Asia/Pontianak', 'HH24:MI')
        || '; tanggal ' || (v_participant ->> 'previous_date') || '→' || p_overtime_date::text
      else 'Tanggal pengajuan ' || (v_participant ->> 'previous_date') || '→' || p_overtime_date::text
        || '; jam tetap '
        || to_char((v_participant ->> 'started_at')::timestamptz at time zone 'Asia/Pontianak', 'HH24:MI')
        || '–' || to_char((v_participant ->> 'ended_at')::timestamptz at time zone 'Asia/Pontianak', 'HH24:MI')
      end
      || '; tarif Rp ' || trim(to_char((v_participant ->> 'previous_rate')::numeric, '999G999G999G990'))
      || '→Rp ' || trim(to_char((v_participant ->> 'rate')::numeric, '999G999G999G990'))
      || '; total Rp ' || trim(to_char((v_participant ->> 'previous_amount')::numeric, '999G999G999G990'))
      || '→Rp ' || trim(to_char((v_participant ->> 'amount')::numeric, '999G999G999G990'))
      || '; status ' || (v_participant ->> 'status') || ' tetap.';

    insert into public.overtime_activity_history(
      activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, notes
    ) values (
      p_activity_id,
      (v_participant ->> 'entry_id')::uuid,
      case when (v_participant ->> 'is_target')::boolean then 'CORRECTED' else 'DATE_CORRECTED' end,
      auth.uid(),
      v_participant ->> 'previous_status',
      v_participant ->> 'status',
      v_reason,
      v_notes
    );
  end loop;

  update public.overtime_activities
  set started_at = v_min_started,
      ended_at = v_max_ended,
      description = v_new_activity_description,
      updated_by = auth.uid()
  where id = p_activity_id;

  perform set_config('overtime.time_correction_activity', '', true);
  perform set_config('overtime.time_correction_recalc_dates', coalesce(v_prev_recalc, ''), true);
  perform set_config('overtime.date_transition', coalesce(v_prev_date_transition, ''), true);

  select status, overtime_date, period_month into v_after_activity_status, v_activity.overtime_date, v_activity.period_month
  from public.overtime_activities where id = p_activity_id;
  if v_after_activity_status is distinct from v_activity.status then
    raise exception 'Koreksi dibatalkan: status pengajuan tidak boleh berubah';
  end if;
  if v_activity.overtime_date is distinct from p_overtime_date
     or v_activity.period_month is distinct from date_trunc('month', p_overtime_date::timestamp)::date then
    raise exception 'Koreksi dibatalkan: tanggal/periode pengajuan tidak konsisten';
  end if;

  return v_plan || jsonb_build_object(
    'applied', true,
    'activity_status', v_after_activity_status,
    'date', v_activity.overtime_date,
    'period_month', v_activity.period_month
  );
end;
$function$;

revoke all on function public.correct_overtime_entry_times_super_admin_l6(uuid, uuid, timestamptz, timestamptz, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.correct_approved_overtime_work_l6(uuid, date, jsonb, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.correct_overtime_entry_super_admin_l7(uuid, uuid, date, timestamptz, timestamptz, text, timestamptz, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.correct_overtime_entry_super_admin_l7(uuid, uuid, date, timestamptz, timestamptz, text, timestamptz, boolean)
  to authenticated;
