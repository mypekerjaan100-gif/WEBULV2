-- Revisi satu peserta: tanggal baru berlaku untuk seluruh batch, jam dan
-- evidence hanya milik target. Server menurunkan jam peserta lain dari data
-- tersimpan (jam clock dipertahankan) sehingga client tidak dapat mengubah
-- peserta lain lewat jalur ini. Menolak batch dengan peserta APPROVED, dan
-- menolak pindah tanggal bila ada peserta SUBMITTED/CLOSED.
-- Status, jumlah penolakan, dan batas revisi tidak direset.

alter table public.overtime_activity_history
  drop constraint if exists overtime_activity_history_event_check;
alter table public.overtime_activity_history
  add constraint overtime_activity_history_event_check
  check (event in ('CREATED', 'SUBMITTED', 'REJECTED', 'RESUBMITTED', 'APPROVED', 'CLOSED', 'DELETED', 'REVISION_SAVED', 'UPDATED', 'CORRECTED', 'DATE_CORRECTED'));

-- Transisi tanggal atomik: trigger menunda cek tanggal/perioda hanya dalam
-- transaksi yang mengaktifkan flag transaction-local ini (sesi lain aman).
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
  if current_setting('overtime.date_transition', true) is distinct from 'on'
     and (new.work_date <> v_activity.overtime_date
       or new.period_month <> v_activity.period_month) then
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
        or (
          current_setting('overtime.date_transition', true) is distinct from 'on'
          and (entry.work_date <> v_overtime_date or entry.period_month <> v_period_month)
        )
      )
  ) then
    raise exception 'Activity time change would invalidate existing participants';
  end if;
  return new;
end;
$$;

create or replace function public.save_overtime_work_revision_l3(
  p_activity_id uuid,
  p_revision_entry_id uuid,
  p_overtime_date date,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_expected_updated_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_activity public.overtime_activities%rowtype;
  v_target public.overtime_entries%rowtype;
  v_sib public.overtime_entries%rowtype;
  v_date_changed boolean;
  v_start_tod time;
  v_end_tod time;
  v_overnight boolean;
  v_sib_started timestamptz;
  v_sib_ended timestamptz;
  v_actual_minutes numeric;
  v_duration numeric;
  v_multiplier numeric;
  v_rate numeric(18,2);
  v_hours numeric;
  v_amount numeric(18,2);
  v_min_started timestamptz;
  v_max_ended timestamptz;
  v_old_min timestamptz;
  v_old_max timestamptz;
  v_final_date date;
  v_final_period date;
  v_target_name text;
  v_notes text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_activity_id is null or p_revision_entry_id is null then
    raise exception 'Overtime activity and revision target are required';
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
  if p_ended_at - p_started_at < interval '1 minute' then
    raise exception 'Durasi lembur minimal satu menit';
  end if;
  if (p_started_at at time zone 'Asia/Pontianak')::date <> p_overtime_date then
    raise exception 'Jam mulai harus berada pada tanggal lembur';
  end if;

  select * into v_activity
  from public.overtime_activities
  where id = p_activity_id
  for update;
  if not found or v_activity.deleted_at is not null then
    raise exception 'Overtime activity is not available';
  end if;
  if v_activity.type <> 'WORK' then
    raise exception 'Hanya Lembur Pekerjaan yang dapat direvisi';
  end if;
  if v_activity.status not in ('DRAFT', 'CORRECTION_REQUIRED') then
    raise exception 'Hanya draft atau revisi yang dapat disimpan';
  end if;
  if p_expected_updated_at is null
    or v_activity.updated_at is distinct from p_expected_updated_at then
    raise exception 'Data sudah berubah. Muat ulang daftar lembur lalu buka kembali revisinya.';
  end if;
  if not public.auth_can_mutate_overtime_work_l3(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Hanya pemilik data pada ULP sendiri yang dapat merevisi' using errcode = '42501';
  end if;

  select * into v_target from public.overtime_entries
  where id = p_revision_entry_id and activity_id = p_activity_id
  for update;
  if not found then
    raise exception 'Peserta revisi tidak termasuk dalam pengajuan ini';
  end if;
  if v_target.approval_status <> 'CORRECTION_REQUIRED' then
    raise exception 'Hanya peserta yang ditolak dapat direvisi';
  end if;
  if v_activity.status = 'CORRECTION_REQUIRED'
    and v_activity.revision_deadline_at is not null
    and clock_timestamp() > v_activity.revision_deadline_at then
    update public.overtime_activities set status = 'CLOSED', closure_reason = 'EXPIRED',
      closed_at = clock_timestamp(), closed_by = auth.uid(), updated_by = auth.uid()
    where id = p_activity_id;
    update public.overtime_entries set approval_status = 'CLOSED', revision_deadline_at = null, updated_by = auth.uid()
    where activity_id = p_activity_id and approval_status in ('DRAFT', 'SUBMITTED', 'CORRECTION_REQUIRED');
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason)
    values (p_activity_id, 'CLOSED', auth.uid(), v_activity.status, 'CLOSED', 'Revision deadline expired');
    raise exception 'Batas revisi telah lewat. Transaksi Lembur sudah kedaluwarsa.';
  end if;
  if v_target.revision_deadline_at is not null and clock_timestamp() > v_target.revision_deadline_at then
    perform public.refresh_overtime_activity_review_status(p_activity_id);
    raise exception 'Batas revisi peserta telah lewat';
  end if;

  -- Peserta lain tidak boleh APPROVED; pindah tanggal butuh semuanya
  -- DRAFT/CORRECTION_REQUIRED.
  if exists (select 1 from public.overtime_entries
    where activity_id = p_activity_id and id <> p_revision_entry_id
      and approval_status = 'APPROVED') then
    raise exception 'Sebagian peserta sudah disetujui sehingga pengajuan tidak dapat direvisi di sini';
  end if;
  v_date_changed := v_activity.overtime_date is distinct from p_overtime_date;
  if v_date_changed and exists (select 1 from public.overtime_entries
    where activity_id = p_activity_id and id <> p_revision_entry_id
      and approval_status not in ('DRAFT', 'CORRECTION_REQUIRED')) then
    raise exception 'Tanggal batch hanya dapat diubah selama seluruh peserta lain masih draft atau revisi';
  end if;

  -- Tarif target mengikuti tanggal baru; tanggal sama memakai snapshot.
  if v_target.work_date is distinct from p_overtime_date then
    select r.hourly_rate into v_rate
    from public.employee_hourly_rate_history r
    where r.employee_id = v_target.employee_id
      and r.effective_from <= p_overtime_date
      and (r.effective_to is null or p_overtime_date < r.effective_to)
    order by r.effective_from desc limit 1;
    if v_rate is null then
      raise exception 'Tarif tidak ditemukan untuk tanggal revisi';
    end if;
  else
    v_rate := v_target.hourly_rate_snapshot;
  end if;
  if not public.overtime_employee_is_eligible_l2(
    v_target.employee_id, v_activity.contract_id, v_activity.up3_id, v_activity.unit_id, p_overtime_date) then
    raise exception 'Pegawai tidak eligible pada tanggal revisi';
  end if;
  v_actual_minutes := extract(epoch from (p_ended_at - p_started_at)) / 60;
  v_duration := round(v_actual_minutes / 60, 4);
  v_multiplier := round(case when v_actual_minutes <= 60 then v_actual_minutes * 1.5 / 60 else 1.5 + ((v_actual_minutes - 60) * 2 / 60) end, 4);
  v_hours := round(v_duration, 2);
  v_amount := round(v_rate * v_multiplier, 2);
  v_min_started := p_started_at;
  v_max_ended := p_ended_at;

  -- Validasi peserta lain dahulu (gagal di sini = rollback total).
  if v_date_changed then
    for v_sib in select * from public.overtime_entries
      where activity_id = p_activity_id and id <> p_revision_entry_id for update loop
      v_start_tod := (v_sib.participant_started_at at time zone 'Asia/Pontianak')::time;
      v_end_tod := (v_sib.participant_ended_at at time zone 'Asia/Pontianak')::time;
      v_overnight := (v_sib.participant_ended_at at time zone 'Asia/Pontianak')::date
        > (v_sib.participant_started_at at time zone 'Asia/Pontianak')::date;
      v_sib_started := (p_overtime_date::text || ' ' || v_start_tod::text || '+07')::timestamptz;
      v_sib_ended := (((p_overtime_date + case when v_overnight then 1 else 0 end)::text)
        || ' ' || v_end_tod::text || '+07')::timestamptz;
      if v_sib_ended <= v_sib_started then
        raise exception 'Durasi peserta % tidak valid pada tanggal baru', coalesce(v_sib.employee_name_snapshot, v_sib.employee_id::text);
      end if;
      if not public.overtime_employee_is_eligible_l2(
        v_sib.employee_id, v_activity.contract_id, v_activity.up3_id, v_activity.unit_id, p_overtime_date) then
        raise exception 'Pegawai tidak eligible pada tanggal baru: %', coalesce(v_sib.employee_name_snapshot, v_sib.employee_id::text);
      end if;
      if v_sib_started < v_min_started then v_min_started := v_sib_started; end if;
      if v_sib_ended > v_max_ended then v_max_ended := v_sib_ended; end if;
    end loop;
  end if;

  -- Transisi tanggal atomik (transaction-local) sebelum pelebaran envelope.
  perform set_config('overtime.date_transition', 'on', true);

  select min(participant_started_at), max(participant_ended_at)
    into v_old_min, v_old_max
  from public.overtime_entries where activity_id = p_activity_id;
  update public.overtime_activities
  set started_at = least(v_old_min, v_min_started),
      ended_at = greatest(v_old_max, v_max_ended),
      updated_by = auth.uid()
  where id = p_activity_id;

  v_target_name := coalesce(v_target.employee_name_snapshot, v_target.employee_id::text);
  v_notes := 'Tanggal ' || v_target.work_date::text || '→' || p_overtime_date::text
    || '; jam ' || to_char(v_target.participant_started_at at time zone 'Asia/Pontianak', 'HH24:MI')
    || '–' || to_char(v_target.participant_ended_at at time zone 'Asia/Pontianak', 'HH24:MI')
    || '→' || to_char(p_started_at at time zone 'Asia/Pontianak', 'HH24:MI')
    || '–' || to_char(p_ended_at at time zone 'Asia/Pontianak', 'HH24:MI')
    || ' (' || v_target.hours::text || '→' || v_hours::text || ' jam)'
    || '; total Rp ' || trim(to_char(v_target.calculated_amount_snapshot, '999G999G999G990'))
    || '→Rp ' || trim(to_char(v_amount, '999G999G999G990')) || '.';
  update public.overtime_entries
  set work_date = p_overtime_date,
      period_month = date_trunc('month', p_started_at at time zone 'Asia/Pontianak')::date,
      hours = v_hours,
      participant_started_at = p_started_at,
      participant_ended_at = p_ended_at,
      duration_hours_snapshot = v_duration,
      multiplier_hours_snapshot = v_multiplier,
      hourly_rate_snapshot = v_rate,
      calculated_amount_snapshot = v_amount,
      updated_by = auth.uid()
  where id = p_revision_entry_id;
  insert into public.overtime_activity_history(
    activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, notes
  ) values (
    p_activity_id, p_revision_entry_id, 'REVISION_SAVED', auth.uid(),
    v_activity.status, v_activity.status, 'Peserta: ' || v_target_name, v_notes
  );

  if v_date_changed then
    for v_sib in select * from public.overtime_entries
      where activity_id = p_activity_id and id <> p_revision_entry_id loop
      v_start_tod := (v_sib.participant_started_at at time zone 'Asia/Pontianak')::time;
      v_end_tod := (v_sib.participant_ended_at at time zone 'Asia/Pontianak')::time;
      v_overnight := (v_sib.participant_ended_at at time zone 'Asia/Pontianak')::date
        > (v_sib.participant_started_at at time zone 'Asia/Pontianak')::date;
      v_sib_started := (p_overtime_date::text || ' ' || v_start_tod::text || '+07')::timestamptz;
      v_sib_ended := (((p_overtime_date + case when v_overnight then 1 else 0 end)::text)
        || ' ' || v_end_tod::text || '+07')::timestamptz;
      v_actual_minutes := extract(epoch from (v_sib_ended - v_sib_started)) / 60;
      v_duration := round(v_actual_minutes / 60, 4);
      v_multiplier := round(case when v_actual_minutes <= 60 then v_actual_minutes * 1.5 / 60 else 1.5 + ((v_actual_minutes - 60) * 2 / 60) end, 4);
      select r.hourly_rate into v_rate
      from public.employee_hourly_rate_history r
      where r.employee_id = v_sib.employee_id
        and r.effective_from <= p_overtime_date
        and (r.effective_to is null or p_overtime_date < r.effective_to)
      order by r.effective_from desc limit 1;
      v_hours := round(v_duration, 2);
      v_amount := round(v_rate * v_multiplier, 2);
      update public.overtime_entries
      set work_date = p_overtime_date,
          period_month = date_trunc('month', v_sib_started at time zone 'Asia/Pontianak')::date,
          hours = v_hours,
          participant_started_at = v_sib_started,
          participant_ended_at = v_sib_ended,
          duration_hours_snapshot = v_duration,
          multiplier_hours_snapshot = v_multiplier,
          hourly_rate_snapshot = v_rate,
          calculated_amount_snapshot = v_amount,
          updated_by = auth.uid()
      where id = v_sib.id;
      insert into public.overtime_activity_history(
        activity_id, entry_id, event, actor_user_id, previous_status, new_status, reason, notes
      ) values (
        p_activity_id, v_sib.id, 'DATE_CORRECTED', auth.uid(),
        v_activity.status, v_activity.status,
        'Tanggal batch diubah melalui revisi ' || v_target_name,
        'Tanggal ' || v_sib.work_date::text || '→' || p_overtime_date::text
          || '; jam tetap ' || to_char(v_sib_started at time zone 'Asia/Pontianak', 'HH24:MI')
          || '–' || to_char(v_sib_ended at time zone 'Asia/Pontianak', 'HH24:MI')
          || '; total Rp ' || trim(to_char(v_sib.calculated_amount_snapshot, '999G999G999G990'))
          || '→Rp ' || trim(to_char(v_amount, '999G999G999G990')) || '.'
      );
    end loop;
  end if;

  select min(participant_started_at), max(participant_ended_at)
    into v_min_started, v_max_ended
  from public.overtime_entries where activity_id = p_activity_id;
  update public.overtime_activities
  set started_at = v_min_started,
      ended_at = v_max_ended,
      updated_by = auth.uid()
  where id = p_activity_id;
  perform public.refresh_overtime_activity_review_status(p_activity_id);

  -- Tegaskan keadaan akhir (pengganti pemeriksaan tanggal trigger).
  select overtime_date, period_month into v_final_date, v_final_period
  from public.overtime_activities where id = p_activity_id;
  if v_final_date <> p_overtime_date then
    raise exception 'Revisi dibatalkan: tanggal akhir tidak sesuai.';
  end if;
  if exists (select 1 from public.overtime_entries
    where activity_id = p_activity_id
      and (work_date <> v_final_date or period_month <> v_final_period
        or participant_started_at < v_min_started or participant_ended_at > v_max_ended)) then
    raise exception 'Revisi dibatalkan: hasil akhir tidak konsisten.';
  end if;
  select * into v_activity from public.overtime_activities where id = p_activity_id;
  if v_activity.status not in ('DRAFT', 'CORRECTION_REQUIRED') then
    raise exception 'Revisi dibatalkan: status agregat berubah.';
  end if;

  return p_activity_id;
end;
$function$;

revoke all on function public.save_overtime_work_revision_l3(uuid, uuid, date, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.save_overtime_work_revision_l3(uuid, uuid, date, timestamptz, timestamptz, timestamptz) to authenticated;

comment on function public.save_overtime_work_revision_l3(uuid, uuid, date, timestamptz, timestamptz, timestamptz)
is 'Saves one rejected participant revision; a changed date moves the whole batch atomically with sibling clock times preserved.';
