-- Perbaikan isolasi per peserta Lembur Pekerjaan.
-- 1. Aggregator status: draft murni (semua entry DRAFT) tetap DRAFT,
--    tidak lagi jatuh ke APPROVED.
-- 2. Save draft in-place V2: saat revisi hanya entry CORRECTION_REQUIRED
--    yang ditulis ulang (peserta lain tidak disentuh), deadline revisi
--    dicek per entry target, envelope waktu diperlebar dulu baru
--    diketatkan, dan data pekerjaan bersama dikunci selama revisi.
--    Simpanan draft awal tetap memperbarui metadata.
-- 3. List WORK mengembalikan status/jumlah tolak/batas revisi per entry
--    agar tabel tidak memakai status batch untuk semua peserta.

-- 1. Aggregator: tangani DRAFT eksplisit.
create or replace function public.refresh_overtime_activity_review_status(p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare
  v_total int;
  v_draft int;
  v_correction int;
  v_submitted int;
  v_approved int;
  v_closed int;
  v_max_rejections int;
  v_max_deadline timestamptz;
begin
  select count(*),
    count(*) filter (where approval_status = 'DRAFT'),
    count(*) filter (where approval_status = 'CORRECTION_REQUIRED'),
    count(*) filter (where approval_status = 'SUBMITTED'),
    count(*) filter (where approval_status = 'APPROVED'),
    count(*) filter (where approval_status = 'CLOSED'),
    coalesce(max(rejection_count), 0),
    max(revision_deadline_at) filter (where approval_status in ('SUBMITTED', 'CORRECTION_REQUIRED'))
  into v_total, v_draft, v_correction, v_submitted, v_approved, v_closed, v_max_rejections, v_max_deadline
  from public.overtime_entries
  where activity_id = p_activity_id;

  if v_total = 0 then return; end if;

  if v_draft = v_total then
    update public.overtime_activities
    set status = 'DRAFT',
        rejection_count = v_max_rejections,
        revision_deadline_at = null,
        updated_by = auth.uid()
    where id = p_activity_id;
  elsif v_correction > 0 or v_submitted > 0 then
    update public.overtime_activities
    set status = case when v_correction > 0 then 'CORRECTION_REQUIRED' else 'SUBMITTED' end,
        rejection_count = v_max_rejections,
        revision_deadline_at = v_max_deadline,
        updated_by = auth.uid()
    where id = p_activity_id;
  elsif v_approved = v_total then
    update public.overtime_activities
    set status = 'APPROVED',
        rejection_count = v_max_rejections,
        revision_deadline_at = null,
        closed_at = null,
        closure_reason = null,
        updated_by = auth.uid()
    where id = p_activity_id;
  elsif v_closed = v_total then
    update public.overtime_activities
    set status = 'CLOSED',
        closure_reason = 'FINAL_REJECTED',
        rejection_count = v_max_rejections,
        revision_deadline_at = null,
        closed_at = clock_timestamp(),
        closed_by = auth.uid(),
        updated_by = auth.uid()
    where id = p_activity_id;
  else
    -- Mix of APPROVED and CLOSED entries: payable entries stand, activity reads APPROVED.
    update public.overtime_activities
    set status = 'APPROVED',
        rejection_count = v_max_rejections,
        revision_deadline_at = null,
        updated_by = auth.uid()
    where id = p_activity_id;
  end if;
end;
$$;

-- 2. Save draft in-place: revisi hanya menyentuh entry target.
create or replace function public.save_overtime_work_draft_l3(p_activity_id uuid, p_contract_id uuid, p_up3_id uuid, p_unit_id uuid, p_work_category text, p_description text, p_work_title text, p_work_location text, p_participants jsonb)
returns uuid
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_activity public.overtime_activities%rowtype; v_activity_id uuid; v_business_date date; v_period_month date;
  v_min_started timestamptz; v_max_ended timestamptz; v_count int; v_idx int; v_part jsonb;
  v_employee_id uuid; v_started timestamptz; v_ended timestamptz; v_rate numeric(18,2);
  v_actual_minutes numeric; v_duration numeric; v_multiplier numeric; v_name text; v_seen uuid[];
  v_desc_trim text; v_title_trim text; v_location_trim text;
  v_carry_status text; v_carry_rejections int; v_carry_deadline timestamptz;
  v_has_approved boolean := false;
  v_existing_ids uuid[]; v_payload_ids uuid[];
  v_times timestamptz[]; v_ends timestamptz[];
  v_is_v2 boolean := false;
  v_row public.overtime_entries%rowtype; v_eid uuid; v_row_status text;
  v_row_started timestamptz; v_row_ended timestamptz;
  v_is_revision boolean := false;
  v_old_min timestamptz; v_old_max timestamptz; v_cover_min timestamptz; v_cover_max timestamptz;
  v_row_deadline timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_work_category is null or p_work_category not in ('ADMINISTRASI','GARDU','JTM','JTR','ROW') then raise exception 'Work category must be ADMINISTRASI, GARDU, JTM, JTR, or ROW'; end if;
  v_desc_trim := btrim(coalesce(p_description, ''));
  if v_desc_trim = '' then raise exception 'Keterangan pekerjaan wajib diisi'; end if;
  v_title_trim := btrim(coalesce(p_work_title, '')); v_location_trim := btrim(coalesce(p_work_location, ''));
  if p_work_category = 'ADMINISTRASI' then
    if v_title_trim <> '' or v_location_trim <> '' then raise exception 'Administrasi tidak memerlukan uraian atau lokasi'; end if;
  else
    if v_title_trim = '' then raise exception 'Uraian pekerjaan wajib diisi'; end if;
    if v_location_trim = '' then raise exception 'Lokasi pekerjaan wajib diisi'; end if;
  end if;
  if p_participants is null or jsonb_typeof(p_participants) <> 'array' then raise exception 'Participants must be a JSON array'; end if;
  v_count := jsonb_array_length(p_participants);
  if v_count = 0 then raise exception 'At least one participant is required'; end if;
  if p_work_category = 'ADMINISTRASI' and v_count <> 1 then raise exception 'Administrasi requires exactly one participant'; end if;
  if p_activity_id is not null then
    select * into v_activity from public.overtime_activities a where a.id = p_activity_id and public.auth_can_mutate_overtime_work_l3(a.contract_id, a.up3_id, a.unit_id) for update;
    if not found then raise exception 'Overtime activity is not available to this account' using errcode = '42501'; end if;
    if v_activity.status not in ('DRAFT','CORRECTION_REQUIRED') then raise exception 'Only DRAFT or revision work overtime can be changed'; end if;
    if v_activity.status = 'CORRECTION_REQUIRED' and v_activity.revision_deadline_at is not null and clock_timestamp() > v_activity.revision_deadline_at then
      update public.overtime_activities set status = 'CLOSED', closure_reason = 'EXPIRED', closed_at = clock_timestamp(), closed_by = auth.uid(), updated_by = auth.uid() where id = p_activity_id;
      update public.overtime_entries set approval_status = 'CLOSED', revision_deadline_at = null, updated_by = auth.uid() where activity_id = p_activity_id and approval_status in ('DRAFT','SUBMITTED','CORRECTION_REQUIRED');
      insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason) values (p_activity_id, 'CLOSED', auth.uid(), v_activity.status, 'CLOSED', 'Revision deadline expired');
      raise exception 'Revision deadline has expired';
    end if;
    if v_activity.type <> 'WORK' then raise exception 'The requested activity is not Lembur Pekerjaan'; end if;
    if (v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) is distinct from (p_contract_id, p_up3_id, p_unit_id) then raise exception 'Overtime activity is not in the exact requested scope'; end if;
    select exists (select 1 from public.overtime_entries where activity_id = p_activity_id and approval_status = 'APPROVED') into v_has_approved;
    v_is_v2 := coalesce(v_activity.evidence_mode, 'LEGACY_SHARED') = 'PARTICIPANT_V2';
  else
    v_is_v2 := true;
  end if;
  if not public.auth_can_mutate_overtime_work_l3(p_contract_id, p_up3_id, p_unit_id) then raise exception 'Work overtime scope is not mutable by this account' using errcode = '42501'; end if;
  v_seen := array[]::uuid[]; v_min_started := null; v_max_ended := null;
  v_payload_ids := array[]::uuid[]; v_times := array[]::timestamptz[]; v_ends := array[]::timestamptz[];
  for v_idx in 0..v_count - 1 loop
    v_part := p_participants -> v_idx;
    v_employee_id := nullif(btrim(v_part ->> 'employee_id'), '')::uuid;
    v_started := nullif(btrim(v_part ->> 'started_at'), '')::timestamptz;
    v_ended := nullif(btrim(v_part ->> 'ended_at'), '')::timestamptz;
    if v_employee_id is null or v_started is null or v_ended is null then raise exception 'Each participant requires employee, start, and end'; end if;
    if v_ended <= v_started then raise exception 'Participant end must be after start'; end if;
    if v_ended - v_started < interval '1 minute' then raise exception 'Participant duration must be at least one minute'; end if;
    if v_employee_id = any(v_seen) then raise exception 'Duplicate participant employee in same activity'; end if;
    v_seen := array_append(v_seen, v_employee_id);
    v_payload_ids := array_append(v_payload_ids, v_employee_id);
    v_times := array_append(v_times, v_started);
    v_ends := array_append(v_ends, v_ended);
    if v_min_started is null or v_started < v_min_started then v_min_started := v_started; end if;
    if v_max_ended is null or v_ended > v_max_ended then v_max_ended := v_ended; end if;
  end loop;
  v_business_date := (v_min_started at time zone 'Asia/Pontianak')::date;
  v_period_month := date_trunc('month', v_min_started at time zone 'Asia/Pontianak')::date;
  for v_idx in 0..v_count - 1 loop
    v_part := p_participants -> v_idx;
    v_employee_id := (v_part ->> 'employee_id')::uuid;
    v_started := (v_part ->> 'started_at')::timestamptz;
    if (v_started at time zone 'Asia/Pontianak')::date <> v_business_date then raise exception 'All participants must start on the same business date'; end if;
    if not public.overtime_employee_is_eligible_l2(v_employee_id, p_contract_id, p_up3_id, p_unit_id, (v_started at time zone 'Asia/Pontianak')::date) then raise exception 'Participant employee is not eligible in exact scope/date'; end if;
  end loop;

  -- In-place update: entry ID permanen (wajib untuk V2 agar evidence per
  -- peserta tidak hilang; legacy hanya saat ada peserta APPROVED).
  if p_activity_id is not null and (v_has_approved or v_is_v2) then
    v_is_revision := v_activity.status = 'CORRECTION_REQUIRED';
    if v_has_approved then
      if v_activity.work_category is distinct from p_work_category
        or coalesce(v_activity.description,'') is distinct from v_desc_trim
        or coalesce(v_activity.work_title,'') is distinct from nullif(v_title_trim,'')
        or coalesce(v_activity.work_location,'') is distinct from nullif(v_location_trim,'') then
        raise exception 'Aktivitas memiliki peserta yang sudah disetujui sehingga data pekerjaan tidak dapat diubah. Hanya jam peserta revisi dan evidence yang dapat diperbaiki.' using errcode = '22023';
      end if;
      select array_agg(employee_id order by employee_id) into v_existing_ids from public.overtime_entries where activity_id = p_activity_id;
      if (select array_agg(x order by x) from unnest(v_payload_ids) x) is distinct from (select array_agg(x order by x) from unnest(v_existing_ids) x) then
        raise exception 'Peserta tidak boleh ditambah/dihapus setelah sebagian disetujui.' using errcode = '22023';
      end if;
    elsif v_is_v2 and v_is_revision then
      -- Revisi V2: data pekerjaan bersama dikunci agar peserta yang sudah
      -- diajukan/disetujui tidak ikut berubah. Hanya jam entry yang ditolak
      -- dan evidence yang boleh diperbaiki.
      if v_activity.work_category is distinct from p_work_category
        or coalesce(v_activity.description,'') is distinct from v_desc_trim
        or coalesce(v_activity.work_title,'') is distinct from nullif(v_title_trim,'')
        or coalesce(v_activity.work_location,'') is distinct from nullif(v_location_trim,'') then
        raise exception 'Data pekerjaan dikunci selama revisi. Hanya jam peserta yang ditolak dan evidence yang dapat diperbaiki.' using errcode = '22023';
      end if;
      select array_agg(employee_id order by employee_id) into v_existing_ids from public.overtime_entries where activity_id = p_activity_id;
      if (select array_agg(x order by x) from unnest(v_payload_ids) x) is distinct from (select array_agg(x order by x) from unnest(v_existing_ids) x) then
        raise exception 'Peserta tidak boleh ditambah/dihapus selama revisi. Selesaikan revisi peserta yang ditolak.' using errcode = '22023';
      end if;
    end if;
    -- Jam peserta APPROVED tidak boleh berubah; V2 juga mengunci SUBMITTED.
    for v_idx in 0..v_count - 1 loop
      v_employee_id := v_payload_ids[v_idx + 1]; v_started := v_times[v_idx + 1]; v_ended := v_ends[v_idx + 1];
      select approval_status, participant_started_at, participant_ended_at
        into v_row_status, v_row_started, v_row_ended
      from public.overtime_entries where activity_id = p_activity_id and employee_id = v_employee_id;
      if found and v_row_status = 'APPROVED'
        and (v_row_started is distinct from v_started or v_row_ended is distinct from v_ended) then
        raise exception 'Jam peserta yang sudah disetujui tidak dapat diubah.' using errcode = '22023';
      end if;
      if found and v_is_v2 and v_row_status = 'SUBMITTED'
        and (v_row_started is distinct from v_started or v_row_ended is distinct from v_ended) then
        raise exception 'Jam peserta yang sudah diajukan tidak dapat diubah selama revisi peserta lain.' using errcode = '22023';
      end if;
    end loop;
    -- Perlebar envelope sementara (gabungan lama + baru) agar trigger tidak
    -- menolak koreksi jam yang valid (mis. memperpendek durasi).
    select min(participant_started_at), max(participant_ended_at) into v_old_min, v_old_max
    from public.overtime_entries where activity_id = p_activity_id;
    v_cover_min := least(v_old_min, v_min_started);
    v_cover_max := greatest(v_old_max, v_max_ended);
    update public.overtime_activities set started_at = v_cover_min, ended_at = v_cover_max, updated_by = auth.uid() where id = p_activity_id returning id into v_activity_id;
    for v_idx in 0..v_count - 1 loop
      v_employee_id := v_payload_ids[v_idx + 1]; v_started := v_times[v_idx + 1]; v_ended := v_ends[v_idx + 1];
      v_business_date := (v_started at time zone 'Asia/Pontianak')::date;
      v_period_month := date_trunc('month', v_started at time zone 'Asia/Pontianak')::date;
      select upper(e.name) into v_name from public.employees e where e.id = v_employee_id;
      select r.hourly_rate into v_rate from public.employee_hourly_rate_history r where r.employee_id = v_employee_id and r.effective_from <= v_business_date and (r.effective_to is null or v_business_date < r.effective_to) order by r.effective_from desc limit 1;
      if v_rate is null then raise exception 'Hourly rate not found for participant start date'; end if;
      v_actual_minutes := extract(epoch from (v_ended - v_started)) / 60;
      v_duration := round(v_actual_minutes / 60, 4);
      v_multiplier := round(case when v_actual_minutes <= 60 then v_actual_minutes * 1.5 / 60 else 1.5 + ((v_actual_minutes - 60) * 2 / 60) end, 4);
      select id, approval_status, revision_deadline_at into v_eid, v_row_status, v_row_deadline from public.overtime_entries where activity_id = p_activity_id and employee_id = v_employee_id;
      if found then
        -- Revisi V2: peserta selain target tidak ditulis ulang sama sekali.
        if v_is_v2 and v_is_revision and v_row_status <> 'CORRECTION_REQUIRED' then
          continue;
        end if;
        -- Batas revisi dicek per entry target sebelum datanya diubah.
        if v_is_v2 and v_is_revision and v_row_status = 'CORRECTION_REQUIRED'
          and v_row_deadline is not null and clock_timestamp() > v_row_deadline then
          perform public.refresh_overtime_activity_review_status(v_activity_id);
          raise exception 'Batas revisi peserta telah lewat';
        end if;
        -- V2 tidak pernah menghitung ulang snapshot finansial peserta APPROVED.
        if v_row_status = 'APPROVED' and not v_is_v2 then
          update public.overtime_entries set
            work_date = v_business_date, period_month = v_period_month, hours = round(v_duration, 2),
            description = v_desc_trim, employee_name_snapshot = v_name, hourly_rate_snapshot = v_rate,
            calculated_amount_snapshot = round(v_rate * v_multiplier, 2),
            participant_started_at = v_started, participant_ended_at = v_ended,
            duration_hours_snapshot = v_duration, multiplier_hours_snapshot = v_multiplier,
            updated_by = auth.uid()
          where id = v_eid;
        elsif v_row_status = 'APPROVED' then
          update public.overtime_entries set
            work_date = v_business_date, period_month = v_period_month, hours = round(v_duration, 2),
            description = v_desc_trim, employee_name_snapshot = v_name,
            participant_started_at = v_started, participant_ended_at = v_ended,
            duration_hours_snapshot = v_duration, multiplier_hours_snapshot = v_multiplier,
            updated_by = auth.uid()
          where id = v_eid;
        else
          update public.overtime_entries set
            work_date = v_business_date, period_month = v_period_month, hours = round(v_duration, 2),
            description = v_desc_trim, employee_name_snapshot = v_name, hourly_rate_snapshot = v_rate,
            calculated_amount_snapshot = round(v_rate * v_multiplier, 2),
            participant_started_at = v_started, participant_ended_at = v_ended,
            duration_hours_snapshot = v_duration, multiplier_hours_snapshot = v_multiplier,
            updated_by = auth.uid()
          where id = v_eid;
        end if;
      else
        if v_activity.status <> 'DRAFT' then
          raise exception 'Peserta baru hanya dapat ditambah pada draft awal.' using errcode = '22023';
        end if;
        insert into public.overtime_entries(activity_id, contract_id, up3_id, unit_id, employee_id, work_date, period_month, hours, description, employee_name_snapshot, hourly_rate_snapshot, calculated_amount_snapshot, participant_started_at, participant_ended_at, duration_hours_snapshot, multiplier_hours_snapshot, approval_status, rejection_count, revision_deadline_at, created_by, updated_by)
        values (v_activity_id, p_contract_id, p_up3_id, p_unit_id, v_employee_id, v_business_date, v_period_month, round(v_duration, 2), v_desc_trim, v_name, v_rate, round(v_rate * v_multiplier, 2), v_started, v_ended, v_duration, v_multiplier, 'DRAFT', 0, null, auth.uid(), auth.uid());
      end if;
    end loop;
    -- Hapus peserta yang dikeluarkan (V2 DRAFT saja, tanpa evidence).
    if v_is_v2 and not v_has_approved and v_activity.status = 'DRAFT' then
      for v_row in select * from public.overtime_entries where activity_id = p_activity_id and employee_id <> all(v_payload_ids) loop
        if exists (select 1 from public.overtime_evidence where entry_id = v_row.id and status <> 'DELETED') then
          raise exception 'Peserta memiliki evidence. Hapus evidence peserta tersebut dahulu sebelum mengeluarkan peserta.' using errcode = '22023';
        end if;
        delete from public.overtime_entries where id = v_row.id;
      end loop;
    end if;
    -- Ketatkan envelope ke hasil akhir + simpan metadata pada draft awal.
    select min(participant_started_at), max(participant_ended_at) into v_min_started, v_max_ended
    from public.overtime_entries where activity_id = p_activity_id;
    if v_activity.status = 'DRAFT' then
      update public.overtime_activities set started_at = v_min_started, ended_at = v_max_ended,
        work_category = p_work_category, description = v_desc_trim,
        work_title = nullif(v_title_trim, ''), work_location = nullif(v_location_trim, ''),
        updated_by = auth.uid() where id = p_activity_id;
    else
      update public.overtime_activities set started_at = v_min_started, ended_at = v_max_ended,
        updated_by = auth.uid() where id = p_activity_id;
    end if;
    perform public.refresh_overtime_activity_review_status(v_activity_id);
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, notes)
    values (v_activity_id, 'RESUBMITTED', auth.uid(), v_activity.status, v_activity.status, 'Revision updated');
    return v_activity_id;
  end if;

  if p_activity_id is not null then
    create temp table tmp_overtime_entry_carry on commit drop as select employee_id, approval_status, rejection_count, revision_deadline_at from public.overtime_entries where activity_id = p_activity_id;
    perform 1 from public.overtime_entries where activity_id = p_activity_id for update;
    delete from public.overtime_entries where activity_id = p_activity_id;
  end if;
  if p_activity_id is null then
    insert into public.overtime_activities(contract_id, up3_id, unit_id, type, work_category, replaced_employee_id, description, work_title, work_location, started_at, ended_at, status, evidence_mode, created_by, updated_by)
    values (p_contract_id, p_up3_id, p_unit_id, 'WORK', p_work_category, null, v_desc_trim, nullif(v_title_trim, ''), nullif(v_location_trim, ''), v_min_started, v_max_ended, 'DRAFT', 'PARTICIPANT_V2', auth.uid(), auth.uid()) returning id into v_activity_id;
  else
    update public.overtime_activities set work_category = p_work_category, description = v_desc_trim, work_title = nullif(v_title_trim, ''), work_location = nullif(v_location_trim, ''), started_at = v_min_started, ended_at = v_max_ended, updated_by = auth.uid() where id = p_activity_id returning id into v_activity_id;
  end if;
  for v_idx in 0..v_count - 1 loop
    v_part := p_participants -> v_idx; v_employee_id := (v_part ->> 'employee_id')::uuid;
    v_started := (v_part ->> 'started_at')::timestamptz; v_ended := (v_part ->> 'ended_at')::timestamptz;
    v_business_date := (v_started at time zone 'Asia/Pontianak')::date; v_period_month := date_trunc('month', v_started at time zone 'Asia/Pontianak')::date;
    select upper(e.name) into v_name from public.employees e where e.id = v_employee_id;
    select r.hourly_rate into v_rate from public.employee_hourly_rate_history r where r.employee_id = v_employee_id and r.effective_from <= v_business_date and (r.effective_to is null or v_business_date < r.effective_to) order by r.effective_from desc limit 1;
    if v_rate is null then raise exception 'Hourly rate not found for participant start date'; end if;
    v_actual_minutes := extract(epoch from (v_ended - v_started)) / 60; v_duration := round(v_actual_minutes / 60, 4);
    v_multiplier := round(case when v_actual_minutes <= 60 then v_actual_minutes * 1.5 / 60 else 1.5 + ((v_actual_minutes - 60) * 2 / 60) end, 4);
    v_carry_status := 'DRAFT'; v_carry_rejections := 0; v_carry_deadline := null;
    if p_activity_id is not null then
      select c.approval_status, c.rejection_count, c.revision_deadline_at into v_carry_status, v_carry_rejections, v_carry_deadline from tmp_overtime_entry_carry c where c.employee_id = v_employee_id limit 1;
      if not found then v_carry_status := 'DRAFT'; v_carry_rejections := 0; v_carry_deadline := null; end if;
    end if;
    insert into public.overtime_entries(activity_id, contract_id, up3_id, unit_id, employee_id, work_date, period_month, hours, description, employee_name_snapshot, hourly_rate_snapshot, calculated_amount_snapshot, participant_started_at, participant_ended_at, duration_hours_snapshot, multiplier_hours_snapshot, approval_status, rejection_count, revision_deadline_at, created_by, updated_by)
    values (v_activity_id, p_contract_id, p_up3_id, p_unit_id, v_employee_id, v_business_date, v_period_month, round(v_duration, 2), v_desc_trim, v_name, v_rate, round(v_rate * v_multiplier, 2), v_started, v_ended, v_duration, v_multiplier, v_carry_status, v_carry_rejections, v_carry_deadline, auth.uid(), auth.uid());
  end loop;
  if p_activity_id is null then
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status) values (v_activity_id, 'CREATED', auth.uid(), null, 'DRAFT');
  elsif v_activity.status = 'CORRECTION_REQUIRED' then
    perform public.refresh_overtime_activity_review_status(v_activity_id);
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, notes) values (v_activity_id, 'RESUBMITTED', auth.uid(), v_activity.status, v_activity.status, 'Revision updated');
  end if;
  return v_activity_id;
end;
$function$;

-- 3. List WORK: kembalikan kolom review per entry.
drop function if exists public.list_overtime_work_l3(uuid, uuid, uuid, date);
create function public.list_overtime_work_l3(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid default null,
  p_period_month date default null
)
returns table (
  activity_id uuid,
  entry_id uuid,
  contract_id uuid,
  up3_id uuid,
  unit_id uuid,
  period_month date,
  overtime_date date,
  work_category text,
  work_title text,
  work_location text,
  description text,
  status text,
  participant_employee_id uuid,
  participant_name text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_hours numeric,
  total_amount numeric,
  submission_deadline_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  rejection_count integer,
  revision_deadline_at timestamptz,
  closure_reason text,
  evidence_mode text,
  entry_approval_status text,
  entry_rejection_count integer,
  entry_revision_deadline_at timestamptz
)
language plpgsql
stable
security definer
set search_path to public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_period_month is not null
     and p_period_month <> date_trunc('month', p_period_month::timestamp)::date then
    raise exception 'Period month must be the first day of a month';
  end if;
  return query
  select
    activity.id,
    entry.id,
    activity.contract_id,
    activity.up3_id,
    activity.unit_id,
    activity.period_month,
    activity.overtime_date,
    activity.work_category,
    activity.work_title,
    activity.work_location,
    activity.description,
    activity.status,
    entry.employee_id,
    entry.employee_name_snapshot,
    entry.participant_started_at,
    entry.participant_ended_at,
    entry.duration_hours_snapshot,
    entry.calculated_amount_snapshot,
    public.resolve_overtime_initial_deadline(
      activity.contract_id,
      activity.up3_id,
      activity.overtime_date,
      statement_timestamp()
    ),
    activity.created_at,
    activity.updated_at,
    activity.rejection_count,
    activity.revision_deadline_at,
    activity.closure_reason,
    coalesce(activity.evidence_mode, 'LEGACY_SHARED'),
    entry.approval_status,
    entry.rejection_count,
    entry.revision_deadline_at
  from public.overtime_activities activity
  join public.overtime_entries entry on entry.activity_id = activity.id
  where activity.contract_id = p_contract_id
    and activity.up3_id = p_up3_id
    and activity.type = 'WORK'
    and activity.deleted_at is null
    and (p_unit_id is null or activity.unit_id = p_unit_id)
    and (p_period_month is null or activity.period_month = p_period_month)
    and public.auth_can_read_overtime_evidence_scope(
      activity.contract_id,
      activity.up3_id,
      activity.unit_id
    )
  order by activity.started_at desc, activity.id, entry.participant_started_at;
end;
$$;
