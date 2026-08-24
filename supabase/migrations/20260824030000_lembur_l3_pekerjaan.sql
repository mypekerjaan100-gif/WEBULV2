-- Lembur L3: Pekerjaan (ADMINISTRASI / GARDU / JTM / JTR) with shared evidence.
-- Reuses overtime_activities, overtime_entries, overtime_evidence, history, private bucket.
-- No approval workflow, no rate exposure in read surface.

alter table public.overtime_activities
  add column if not exists work_title text,
  add column if not exists work_location text;

create or replace function public.auth_can_mutate_overtime_work_l3(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.auth_can_mutate_overtime_replacement_l2(p_contract_id, p_up3_id, p_unit_id)
$$;

comment on function public.auth_can_mutate_overtime_work_l3(uuid, uuid, uuid)
  is 'Internal L3 mutation gate: SUPER_ADMIN or exact-unit ADMIN_ULP only.';

create or replace function public.save_overtime_work_draft_l3(
  p_activity_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_work_category text,
  p_description text,
  p_work_title text,
  p_work_location text,
  p_participants jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_activity_id uuid;
  v_business_date date;
  v_period_month date;
  v_min_started timestamptz;
  v_max_ended timestamptz;
  v_count int;
  v_idx int;
  v_part jsonb;
  v_employee_id uuid;
  v_started timestamptz;
  v_ended timestamptz;
  v_rate numeric(18,2);
  v_actual_minutes numeric;
  v_duration numeric;
  v_multiplier numeric;
  v_name text;
  v_seen uuid[];
  v_desc_trim text;
  v_title_trim text;
  v_location_trim text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_work_category is null or p_work_category not in ('ADMINISTRASI','GARDU','JTM','JTR') then
    raise exception 'Work category must be ADMINISTRASI, GARDU, JTM, or JTR';
  end if;
  v_desc_trim := btrim(coalesce(p_description,''));
  if v_desc_trim = '' then
    raise exception 'Keterangan pekerjaan wajib diisi';
  end if;
  v_title_trim := btrim(coalesce(p_work_title,''));
  v_location_trim := btrim(coalesce(p_work_location,''));
  if p_work_category = 'ADMINISTRASI' then
    if v_title_trim <> '' or v_location_trim <> '' then
      raise exception 'Administrasi tidak memerlukan uraian atau lokasi';
    end if;
  else
    if v_title_trim = '' then raise exception 'Uraian pekerjaan wajib diisi'; end if;
    if v_location_trim = '' then raise exception 'Lokasi pekerjaan wajib diisi'; end if;
  end if;
  if p_participants is null or jsonb_typeof(p_participants) <> 'array' then
    raise exception 'Participants must be a JSON array';
  end if;
  v_count := jsonb_array_length(p_participants);
  if v_count = 0 then raise exception 'At least one participant is required'; end if;
  if p_work_category = 'ADMINISTRASI' and v_count <> 1 then
    raise exception 'Administrasi requires exactly one participant';
  end if;

  -- lock existing activity first
  if p_activity_id is not null then
    select * into v_activity from public.overtime_activities a
      where a.id = p_activity_id
        and public.auth_can_mutate_overtime_work_l3(a.contract_id, a.up3_id, a.unit_id)
      for update;
    if not found then
      raise exception 'Overtime activity is not available to this account' using errcode='42501';
    end if;
    if v_activity.status <> 'DRAFT' then raise exception 'Only DRAFT work overtime can be changed'; end if;
    if v_activity.type <> 'WORK' then raise exception 'The requested activity is not Lembur Pekerjaan'; end if;
    if (v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) is distinct from (p_contract_id, p_up3_id, p_unit_id) then
      raise exception 'Overtime activity is not in the exact requested scope';
    end if;
  end if;

  if not public.auth_can_mutate_overtime_work_l3(p_contract_id, p_up3_id, p_unit_id) then
    raise exception 'Work overtime scope is not mutable by this account' using errcode='42501';
  end if;

  -- parse participants, collect min/max and validate duplicates
  v_seen := array[]::uuid[];
  v_min_started := null; v_max_ended := null;
  for v_idx in 0..v_count-1 loop
    v_part := p_participants->v_idx;
    v_employee_id := nullif(btrim(v_part->>'employee_id'),'')::uuid;
    v_started := nullif(btrim(v_part->>'started_at'),'')::timestamptz;
    v_ended := nullif(btrim(v_part->>'ended_at'),'')::timestamptz;
    if v_employee_id is null or v_started is null or v_ended is null then
      raise exception 'Each participant requires employee, start, and end';
    end if;
    if v_ended <= v_started then raise exception 'Participant end must be after start'; end if;
    if v_ended - v_started < interval '1 minute' then raise exception 'Participant duration must be at least one minute'; end if;
    if v_employee_id = any(v_seen) then raise exception 'Duplicate participant employee in same activity'; end if;
    v_seen := array_append(v_seen, v_employee_id);
    if v_min_started is null or v_started < v_min_started then v_min_started := v_started; end if;
    if v_max_ended is null or v_ended > v_max_ended then v_max_ended := v_ended; end if;
  end loop;

  v_business_date := (v_min_started at time zone 'Asia/Pontianak')::date;
  v_period_month := date_trunc('month', v_min_started at time zone 'Asia/Pontianak')::date;

  -- validate eligibility and that all participants share same business date (to satisfy participant guard)
  for v_idx in 0..v_count-1 loop
    v_part := p_participants->v_idx;
    v_employee_id := (v_part->>'employee_id')::uuid;
    v_started := (v_part->>'started_at')::timestamptz;
    if (v_started at time zone 'Asia/Pontianak')::date <> v_business_date then
      raise exception 'All participants must start on the same business date';
    end if;
    if not public.overtime_employee_is_eligible_l2(v_employee_id, p_contract_id, p_up3_id, p_unit_id, (v_started at time zone 'Asia/Pontianak')::date) then
      raise exception 'Participant employee is not eligible in exact scope/date';
    end if;
  end loop;

  -- for updates, remove old entries after validation to allow L1 guard to validate new times
  if p_activity_id is not null then
    -- lock entries
    perform 1 from public.overtime_entries where activity_id = p_activity_id for update;
    delete from public.overtime_entries where activity_id = p_activity_id;
  end if;

  if p_activity_id is null then
    insert into public.overtime_activities(contract_id, up3_id, unit_id, type, work_category, replaced_employee_id, description, work_title, work_location, started_at, ended_at, status, created_by, updated_by)
    values (p_contract_id, p_up3_id, p_unit_id, 'WORK', p_work_category, null, v_desc_trim, nullif(v_title_trim,''), nullif(v_location_trim,''), v_min_started, v_max_ended, 'DRAFT', auth.uid(), auth.uid())
    returning id into v_activity_id;
  else
    update public.overtime_activities
    set work_category = p_work_category,
        description = v_desc_trim,
        work_title = nullif(v_title_trim,''),
        work_location = nullif(v_location_trim,''),
        started_at = v_min_started,
        ended_at = v_max_ended,
        updated_by = auth.uid()
    where id = p_activity_id
    returning id into v_activity_id;
  end if;

  -- insert participants with snapshots
  for v_idx in 0..v_count-1 loop
    v_part := p_participants->v_idx;
    v_employee_id := (v_part->>'employee_id')::uuid;
    v_started := (v_part->>'started_at')::timestamptz;
    v_ended := (v_part->>'ended_at')::timestamptz;
    v_business_date := (v_started at time zone 'Asia/Pontianak')::date;
    v_period_month := date_trunc('month', v_started at time zone 'Asia/Pontianak')::date;
    select upper(e.name) into v_name from public.employees e where e.id = v_employee_id;
    select r.hourly_rate into v_rate from public.employee_hourly_rate_history r
      where r.employee_id = v_employee_id and r.effective_from <= v_business_date and (r.effective_to is null or v_business_date < r.effective_to)
      order by r.effective_from desc limit 1;
    if v_rate is null then raise exception 'Hourly rate not found for participant start date'; end if;
    v_actual_minutes := extract(epoch from (v_ended - v_started))/60;
    v_duration := round(v_actual_minutes/60,4);
    v_multiplier := round(case when v_actual_minutes <=60 then v_actual_minutes*1.5/60 else 1.5+((v_actual_minutes-60)*2/60) end,4);
    insert into public.overtime_entries(activity_id, contract_id, up3_id, unit_id, employee_id, work_date, period_month, hours, description, employee_name_snapshot, hourly_rate_snapshot, calculated_amount_snapshot, participant_started_at, participant_ended_at, duration_hours_snapshot, multiplier_hours_snapshot, created_by, updated_by)
    values (v_activity_id, p_contract_id, p_up3_id, p_unit_id, v_employee_id, v_business_date, v_period_month, round(v_duration,2), v_desc_trim, v_name, v_rate, round(v_rate*v_multiplier,2), v_started, v_ended, v_duration, v_multiplier, auth.uid(), auth.uid());
  end loop;

  if p_activity_id is null then
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status)
    values (v_activity_id, 'CREATED', auth.uid(), null, 'DRAFT');
  end if;
  return v_activity_id;
end;
$$;

comment on function public.save_overtime_work_draft_l3(uuid, uuid, uuid, uuid, text, text, text, text, jsonb)
  is 'Creates or recalculates one DRAFT Lembur Pekerjaan activity with shared evidence and per-participant snapshots.';

create or replace function public.submit_overtime_work_l3(p_activity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_submission_number int;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_activity from public.overtime_activities a
    where a.id = p_activity_id and public.auth_can_mutate_overtime_work_l3(a.contract_id, a.up3_id, a.unit_id)
    for update;
  if not found then raise exception 'Overtime activity is not available to this account' using errcode='42501'; end if;
  if v_activity.type <> 'WORK' then raise exception 'Only Lembur Pekerjaan can be submitted via this path'; end if;
  if v_activity.status <> 'DRAFT' then raise exception 'Only DRAFT work overtime can be submitted'; end if;
  if v_activity.work_category not in ('ADMINISTRASI','GARDU','JTM','JTR') then raise exception 'Work category is not valid'; end if;
  if btrim(coalesce(v_activity.description,'')) = '' then raise exception 'Keterangan pekerjaan wajib diisi'; end if;
  if v_activity.work_category in ('GARDU','JTM','JTR') then
    if btrim(coalesce(v_activity.work_title,'')) = '' then raise exception 'Uraian pekerjaan wajib diisi'; end if;
    if btrim(coalesce(v_activity.work_location,'')) = '' then raise exception 'Lokasi pekerjaan wajib diisi'; end if;
  end if;
  if clock_timestamp() > (v_activity.submission_deadline + time '23:59:59.999999') at time zone 'Asia/Pontianak' then
    raise exception 'Work overtime submission deadline has passed';
  end if;
  if (select count(*) from public.overtime_entries where activity_id = p_activity_id) = 0 then
    raise exception 'At least one participant is required';
  end if;
  if v_activity.work_category = 'ADMINISTRASI' and (select count(*) from public.overtime_entries where activity_id = p_activity_id) <> 1 then
    raise exception 'Administrasi requires exactly one participant';
  end if;
  if exists (select 1 from public.overtime_evidence where activity_id = p_activity_id and status in ('PENDING','DELETE_PENDING')) then
    raise exception 'Resolve pending evidence operations before submission';
  end if;

  if v_activity.work_category = 'ADMINISTRASI' then
    if (select count(*) from public.overtime_evidence where activity_id = p_activity_id and evidence_type='FOTO_SEBELUM' and status='ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_SEBELUM';
    end if;
    if (select count(*) from public.overtime_evidence where activity_id = p_activity_id and evidence_type='FOTO_SESUDAH' and status='ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_SESUDAH';
    end if;
    if exists (select 1 from public.overtime_evidence where activity_id = p_activity_id and status='ACTIVE' and evidence_type not in ('FOTO_SEBELUM','FOTO_SESUDAH')) then
      raise exception 'ACTIVE evidence contains a type not required by Administrasi';
    end if;
  else
    if (select count(*) from public.overtime_evidence where activity_id = p_activity_id and evidence_type='SPK' and status='ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: SPK';
    end if;
    if (select count(*) from public.overtime_evidence where activity_id = p_activity_id and evidence_type='FOTO_BRIEFING' and status='ACTIVE') < 1 then
      raise exception 'At least one ACTIVE FOTO_BRIEFING is required';
    end if;
    if (select count(*) from public.overtime_evidence where activity_id = p_activity_id and evidence_type='FOTO_PROSES' and status='ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_PROSES';
    end if;
    if (select count(*) from public.overtime_evidence where activity_id = p_activity_id and evidence_type='FOTO_SELESAI' and status='ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_SELESAI';
    end if;
    if exists (select 1 from public.overtime_evidence where activity_id = p_activity_id and status='ACTIVE' and evidence_type not in ('SPK','FOTO_BRIEFING','FOTO_PROSES','FOTO_SELESAI')) then
      raise exception 'ACTIVE evidence contains a type not required by this work category';
    end if;
  end if;

  v_submission_number := v_activity.submission_count + 1;
  update public.overtime_activities set status='SUBMITTED', submitted_at=clock_timestamp(), submitted_by=auth.uid(), submission_count=v_submission_number, current_submission_number=v_submission_number, updated_by=auth.uid() where id = p_activity_id;
  insert into public.overtime_activity_history(activity_id, event, actor_user_id, submission_number, previous_status, new_status)
  values (p_activity_id, 'SUBMITTED', auth.uid(), v_submission_number, 'DRAFT','SUBMITTED');
  return p_activity_id;
end;
$$;

comment on function public.submit_overtime_work_l3(uuid)
  is 'Submits a complete DRAFT Lembur Pekerjaan through D+7 23:59 Asia/Pontianak.';

create or replace function public.list_overtime_work_l3(
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
  duration_hours numeric(10,4),
  total_amount numeric(18,2),
  submission_deadline_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_period_month is not null and p_period_month <> date_trunc('month', p_period_month::timestamp)::date then
    raise exception 'Period month must be the first day of a month';
  end if;
  return query
  select a.id, e.id, a.contract_id, a.up3_id, a.unit_id, a.period_month, a.overtime_date, a.work_category, a.work_title, a.work_location, a.description, a.status, e.employee_id, e.employee_name_snapshot, e.participant_started_at, e.participant_ended_at, e.duration_hours_snapshot, e.calculated_amount_snapshot, (a.submission_deadline + time '23:59:59.999999') at time zone 'Asia/Pontianak', a.created_at, a.updated_at
  from public.overtime_activities a
  join public.overtime_entries e on e.activity_id = a.id
  where a.contract_id = p_contract_id and a.up3_id = p_up3_id and a.type='WORK' and (p_unit_id is null or a.unit_id = p_unit_id) and (p_period_month is null or a.period_month = p_period_month)
    and public.auth_can_read_overtime_evidence_scope(a.contract_id, a.up3_id, a.unit_id)
  order by a.started_at desc, a.id, e.participant_started_at;
end;
$$;

comment on function public.list_overtime_work_l3(uuid, uuid, uuid, date)
  is 'Scope-safe Lembur Pekerjaan list per participant; exposes total but no rate or multiplier.';

revoke all on function public.auth_can_mutate_overtime_work_l3(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.save_overtime_work_draft_l3(uuid,uuid,uuid,uuid,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.submit_overtime_work_l3(uuid) from public, anon, authenticated;
revoke all on function public.list_overtime_work_l3(uuid,uuid,uuid,date) from public, anon, authenticated;
grant execute on function public.save_overtime_work_draft_l3(uuid,uuid,uuid,uuid,text,text,text,text,jsonb) to authenticated;
grant execute on function public.submit_overtime_work_l3(uuid) to authenticated;
grant execute on function public.list_overtime_work_l3(uuid,uuid,uuid,date) to authenticated;
