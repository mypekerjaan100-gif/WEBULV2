-- Lembur L5: Approval, Reject, Revision, History. Reuses L1-L4 foundations.
-- Preserves D+7 initial deadline. No new business table.
-- Statuses reuse existing DB enums: DRAFT, SUBMITTED, CORRECTION_REQUIRED, APPROVED, CLOSED.
-- Logical states derived via counts/deadlines for UI.

-- Allow save during revision (CORRECTION_REQUIRED) for both replacement and work.
create or replace function public.save_overtime_replacement_draft_l2(
  p_activity_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_type text,
  p_replaced_employee_id uuid,
  p_participant_employee_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_entry public.overtime_entries%rowtype;
  v_activity_id uuid;
  v_business_date date;
  v_period_month date;
  v_actual_minutes numeric;
  v_duration_hours numeric;
  v_multiplier_hours numeric;
  v_rate numeric(18,2);
  v_participant_name text;
  v_replaced_name text;
  v_description text;
  v_month_names text[] := array['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_type is null or p_type not in ('REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION') then raise exception 'L2 replacement type must be leave, sick, or permission'; end if;
  if p_replaced_employee_id is null or p_participant_employee_id is null or p_replaced_employee_id=p_participant_employee_id then raise exception 'Replaced and participant employees must be distinct'; end if;
  if p_started_at is null or p_ended_at is null or p_ended_at<=p_started_at then raise exception 'Overtime end must be after start'; end if;
  if p_ended_at - p_started_at < interval '1 minute' then raise exception 'Overtime duration must be at least one minute'; end if;
  if p_activity_id is not null then
    select * into v_activity from public.overtime_activities a where a.id=p_activity_id and public.auth_can_mutate_overtime_replacement_l2(a.contract_id,a.up3_id,a.unit_id) for update;
    if not found then raise exception 'Overtime activity is not available to this account' using errcode='42501'; end if;
    if v_activity.status not in ('DRAFT','CORRECTION_REQUIRED') then raise exception 'Only DRAFT or revision can be changed'; end if;
    if v_activity.status='CORRECTION_REQUIRED' and v_activity.revision_deadline_at is not null and clock_timestamp() > v_activity.revision_deadline_at then
      update public.overtime_activities set status='CLOSED', closure_reason='EXPIRED', closed_at=now(), closed_by=auth.uid(), updated_by=auth.uid() where id=p_activity_id;
      insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason) values (p_activity_id,'CLOSED',auth.uid(),v_activity.status,'CLOSED','Revision deadline expired');
      raise exception 'Revision deadline has expired';
    end if;
    if v_activity.type not in ('REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION') then raise exception 'The requested activity is not an L2 replacement'; end if;
    if (v_activity.contract_id,v_activity.up3_id,v_activity.unit_id) is distinct from (p_contract_id,p_up3_id,p_unit_id) then raise exception 'Overtime activity is not in the exact requested scope'; end if;
  end if;
  if not public.auth_can_mutate_overtime_replacement_l2(p_contract_id,p_up3_id,p_unit_id) then raise exception 'Replacement overtime scope is not mutable by this account' using errcode='42501'; end if;
  if p_activity_id is not null then
    select e.* into v_entry from public.overtime_entries e where e.activity_id=p_activity_id order by e.id limit 1 for update;
    if (select count(*) from public.overtime_entries e where e.activity_id=p_activity_id)>1 then raise exception 'Replacement overtime must have exactly one participant'; end if;
  end if;
  v_business_date:=(p_started_at at time zone 'Asia/Pontianak')::date; v_period_month:=date_trunc('month',p_started_at at time zone 'Asia/Pontianak')::date;
  if not public.overtime_employee_is_eligible_l2(p_replaced_employee_id,p_contract_id,p_up3_id,p_unit_id,v_business_date) then raise exception 'Replaced employee is not eligible in the exact scope/date'; end if;
  if not public.overtime_employee_is_eligible_l2(p_participant_employee_id,p_contract_id,p_up3_id,p_unit_id,v_business_date) then raise exception 'Participant employee is not eligible in the exact scope/date'; end if;
  select upper(e.name) into v_participant_name from public.employees e where e.id=p_participant_employee_id; select upper(e.name) into v_replaced_name from public.employees e where e.id=p_replaced_employee_id;
  select r.hourly_rate into v_rate from public.employee_hourly_rate_history r where r.employee_id=p_participant_employee_id and r.effective_from<=v_business_date and (r.effective_to is null or v_business_date<r.effective_to) order by r.effective_from desc limit 1;
  if v_rate is null then raise exception 'Participant hourly rate not found for overtime start date'; end if;
  v_actual_minutes:=extract(epoch from(p_ended_at-p_started_at))/60; v_duration_hours:=round(v_actual_minutes/60,4); v_multiplier_hours:=round(case when v_actual_minutes<=60 then v_actual_minutes*1.5/60 else 1.5+((v_actual_minutes-60)*2/60) end,4);
  v_description:=v_participant_name||' menggantikan '||v_replaced_name||' yang '||case p_type when 'REPLACEMENT_LEAVE' then 'cuti' when 'REPLACEMENT_SICK' then 'sakit' else 'izin' end||' pada '||extract(day from p_started_at at time zone 'Asia/Pontianak')::integer||' '||v_month_names[extract(month from p_started_at at time zone 'Asia/Pontianak')::integer]||' '||extract(year from p_started_at at time zone 'Asia/Pontianak')::integer||' pukul '||to_char(p_started_at at time zone 'Asia/Pontianak','HH24:MI')||'–'||to_char(p_ended_at at time zone 'Asia/Pontianak','HH24:MI')||'.';
  if v_entry.id is not null then delete from public.overtime_entries where id=v_entry.id; end if;
  if p_activity_id is null then insert into public.overtime_activities(contract_id,up3_id,unit_id,type,work_category,replaced_employee_id,description,started_at,ended_at,status,created_by,updated_by) values (p_contract_id,p_up3_id,p_unit_id,p_type,null,p_replaced_employee_id,v_description,p_started_at,p_ended_at,'DRAFT',auth.uid(),auth.uid()) returning id into v_activity_id;
  else update public.overtime_activities set type=p_type,work_category=null,replaced_employee_id=p_replaced_employee_id,description=v_description,started_at=p_started_at,ended_at=p_ended_at,updated_by=auth.uid() where id=p_activity_id returning id into v_activity_id; end if;
  insert into public.overtime_entries(activity_id,contract_id,up3_id,unit_id,employee_id,work_date,period_month,hours,description,employee_name_snapshot,hourly_rate_snapshot,calculated_amount_snapshot,participant_started_at,participant_ended_at,duration_hours_snapshot,multiplier_hours_snapshot,created_by,updated_by) values (v_activity_id,p_contract_id,p_up3_id,p_unit_id,p_participant_employee_id,v_business_date,v_period_month,round(v_duration_hours,2),v_description,v_participant_name,v_rate,round(v_rate*v_multiplier_hours,2),p_started_at,p_ended_at,v_duration_hours,v_multiplier_hours,auth.uid(),auth.uid());
  if p_activity_id is null then insert into public.overtime_activity_history(activity_id,event,actor_user_id,previous_status,new_status) values (v_activity_id,'CREATED',auth.uid(),null,'DRAFT');
  else insert into public.overtime_activity_history(activity_id,event,actor_user_id,previous_status,new_status,notes) values (v_activity_id, case when v_activity.status='CORRECTION_REQUIRED' then 'RESUBMITTED' else 'CREATED' end ,auth.uid(),v_activity.status, (case when v_activity.status='CORRECTION_REQUIRED' then v_activity.status else 'DRAFT' end), 'Revision updated');
  end if;
  return v_activity_id;
end;
$$;

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
  v_activity public.overtime_activities%rowtype; v_activity_id uuid; v_business_date date; v_period_month date; v_min_started timestamptz; v_max_ended timestamptz; v_count int; v_idx int; v_part jsonb; v_employee_id uuid; v_started timestamptz; v_ended timestamptz; v_rate numeric(18,2); v_actual_minutes numeric; v_duration numeric; v_multiplier numeric; v_name text; v_seen uuid[]; v_desc_trim text; v_title_trim text; v_location_trim text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_work_category is null or p_work_category not in ('ADMINISTRASI','GARDU','JTM','JTR') then raise exception 'Work category must be ADMINISTRASI, GARDU, JTM, or JTR'; end if;
  v_desc_trim:=btrim(coalesce(p_description,'')); if v_desc_trim='' then raise exception 'Keterangan pekerjaan wajib diisi'; end if;
  v_title_trim:=btrim(coalesce(p_work_title,'')); v_location_trim:=btrim(coalesce(p_work_location,''));
  if p_work_category='ADMINISTRASI' then if v_title_trim<>'' or v_location_trim<>'' then raise exception 'Administrasi tidak memerlukan uraian atau lokasi'; end if;
  elsif v_title_trim='' then raise exception 'Uraian pekerjaan wajib diisi';
  elsif v_location_trim='' then raise exception 'Lokasi pekerjaan wajib diisi'; end if;
  if p_participants is null or jsonb_typeof(p_participants)<>'array' then raise exception 'Participants must be a JSON array'; end if;
  v_count:=jsonb_array_length(p_participants); if v_count=0 then raise exception 'At least one participant is required'; end if;
  if p_work_category='ADMINISTRASI' and v_count<>1 then raise exception 'Administrasi requires exactly one participant'; end if;
  if p_activity_id is not null then
    select * into v_activity from public.overtime_activities a where a.id=p_activity_id and public.auth_can_mutate_overtime_work_l3(a.contract_id,a.up3_id,a.unit_id) for update;
    if not found then raise exception 'Overtime activity is not available to this account' using errcode='42501'; end if;
    if v_activity.status not in ('DRAFT','CORRECTION_REQUIRED') then raise exception 'Only DRAFT or revision can be changed'; end if;
    if v_activity.status='CORRECTION_REQUIRED' and v_activity.revision_deadline_at is not null and clock_timestamp() > v_activity.revision_deadline_at then
      update public.overtime_activities set status='CLOSED', closure_reason='EXPIRED', closed_at=now(), closed_by=auth.uid(), updated_by=auth.uid() where id=p_activity_id;
      insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason) values (p_activity_id,'CLOSED',auth.uid(),v_activity.status,'CLOSED','Revision deadline expired');
      raise exception 'Revision deadline has expired';
    end if;
    if v_activity.type<>'WORK' then raise exception 'The requested activity is not Lembur Pekerjaan'; end if;
    if (v_activity.contract_id,v_activity.up3_id,v_activity.unit_id) is distinct from (p_contract_id,p_up3_id,p_unit_id) then raise exception 'Overtime activity is not in the exact requested scope'; end if;
  end if;
  if not public.auth_can_mutate_overtime_work_l3(p_contract_id,p_up3_id,p_unit_id) then raise exception 'Work overtime scope is not mutable by this account' using errcode='42501'; end if;
  v_seen:=array[]::uuid[]; v_min_started:=null; v_max_ended:=null;
  for v_idx in 0..v_count-1 loop v_part:=p_participants->v_idx; v_employee_id:=nullif(btrim(v_part->>'employee_id'),'')::uuid; v_started:=nullif(btrim(v_part->>'started_at'),'')::timestamptz; v_ended:=nullif(btrim(v_part->>'ended_at'),'')::timestamptz; if v_employee_id is null or v_started is null or v_ended is null then raise exception 'Each participant requires employee, start, and end'; end if; if v_ended<=v_started then raise exception 'Participant end must be after start'; end if; if v_ended - v_started < interval '1 minute' then raise exception 'Participant duration must be at least one minute'; end if; if v_employee_id = any(v_seen) then raise exception 'Duplicate participant employee in same activity'; end if; v_seen:=array_append(v_seen,v_employee_id); if v_min_started is null or v_started < v_min_started then v_min_started:=v_started; end if; if v_max_ended is null or v_ended > v_max_ended then v_max_ended:=v_ended; end if; end loop;
  v_business_date:=(v_min_started at time zone 'Asia/Pontianak')::date; v_period_month:=date_trunc('month',v_min_started at time zone 'Asia/Pontianak')::date;
  for v_idx in 0..v_count-1 loop v_part:=p_participants->v_idx; v_employee_id:=(v_part->>'employee_id')::uuid; v_started:=(v_part->>'started_at')::timestamptz; if (v_started at time zone 'Asia/Pontianak')::date <> v_business_date then raise exception 'All participants must start on the same business date'; end if; if not public.overtime_employee_is_eligible_l2(v_employee_id,p_contract_id,p_up3_id,p_unit_id,(v_started at time zone 'Asia/Pontianak')::date) then raise exception 'Participant employee is not eligible in exact scope/date'; end if; end loop;
  if p_activity_id is not null then perform 1 from public.overtime_entries where activity_id=p_activity_id for update; delete from public.overtime_entries where activity_id=p_activity_id; end if;
  if p_activity_id is null then insert into public.overtime_activities(contract_id,up3_id,unit_id,type,work_category,replaced_employee_id,description,work_title,work_location,started_at,ended_at,status,created_by,updated_by) values (p_contract_id,p_up3_id,p_unit_id,'WORK',p_work_category,null,v_desc_trim,nullif(v_title_trim,''),nullif(v_location_trim,''),v_min_started,v_max_ended,'DRAFT',auth.uid(),auth.uid()) returning id into v_activity_id;
  else update public.overtime_activities set work_category=p_work_category,description=v_desc_trim,work_title=nullif(v_title_trim,''),work_location=nullif(v_location_trim,''),started_at=v_min_started,ended_at=v_max_ended,updated_by=auth.uid() where id=p_activity_id returning id into v_activity_id; end if;
  for v_idx in 0..v_count-1 loop v_part:=p_participants->v_idx; v_employee_id:=(v_part->>'employee_id')::uuid; v_started:=(v_part->>'started_at')::timestamptz; v_ended:=(v_part->>'ended_at')::timestamptz; v_business_date:=(v_started at time zone 'Asia/Pontianak')::date; v_period_month:=date_trunc('month',v_started at time zone 'Asia/Pontianak')::date; select upper(e.name) into v_name from public.employees e where e.id=v_employee_id; select r.hourly_rate into v_rate from public.employee_hourly_rate_history r where r.employee_id=v_employee_id and r.effective_from<=v_business_date and (r.effective_to is null or v_business_date<r.effective_to) order by r.effective_from desc limit 1; if v_rate is null then raise exception 'Hourly rate not found for participant start date'; end if; v_actual_minutes:=extract(epoch from(v_ended - v_started))/60; v_duration:=round(v_actual_minutes/60,4); v_multiplier:=round(case when v_actual_minutes<=60 then v_actual_minutes*1.5/60 else 1.5+((v_actual_minutes-60)*2/60) end,4); insert into public.overtime_entries(activity_id,contract_id,up3_id,unit_id,employee_id,work_date,period_month,hours,description,employee_name_snapshot,hourly_rate_snapshot,calculated_amount_snapshot,participant_started_at,participant_ended_at,duration_hours_snapshot,multiplier_hours_snapshot,created_by,updated_by) values (v_activity_id,p_contract_id,p_up3_id,p_unit_id,v_employee_id,v_business_date,v_period_month,round(v_duration,2),v_desc_trim,v_name,v_rate,round(v_rate*v_multiplier,2),v_started,v_ended,v_duration,v_multiplier,auth.uid(),auth.uid()); end loop;
  if p_activity_id is null then insert into public.overtime_activity_history(activity_id,event,actor_user_id,previous_status,new_status) values (v_activity_id,'CREATED',auth.uid(),null,'DRAFT');
  else insert into public.overtime_activity_history(activity_id,event,actor_user_id,previous_status,new_status,notes) values (v_activity_id,'RESUBMITTED',auth.uid(),v_activity.status,v_activity.status,'Revision updated');
  end if;
  return v_activity_id;
end;
$$;

-- Helper to check ADMIN_UP3 can review (approve/reject) in own UP3
create or replace function public.auth_can_review_overtime_l5(p_contract_id uuid, p_up3_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    public.auth_is_super_admin()
    or exists (
      select 1 from public.contract_memberships m
      where m.user_id=auth.uid() and m.contract_role='ADMIN_UP3' and m.status='ACTIVE'
        and m.effective_from<=current_date and (m.effective_to is null or current_date < m.effective_to)
        and m.contract_id=p_contract_id and m.operational_up3_id=p_up3_id and m.operational_unit_id is null
    )
  )
$$;

create or replace function public.approve_overtime_l5(p_activity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_activity public.overtime_activities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_activity from public.overtime_activities where id=p_activity_id for update;
  if not found then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id) then raise exception 'Not authorized to approve in this UP3' using errcode='42501'; end if;
  if v_activity.status not in ('SUBMITTED') then
    -- also allow resubmitted statuses which are stored as SUBMITTED with different counts, but we treat any SUBMITTED as approvable
    raise exception 'Only submitted overtime can be approved';
  end if;
  -- check expiry for revision resubmits? If it was resubmitted, deadline already checked on resubmit, so approve can proceed
  update public.overtime_activities set status='APPROVED', approved_at=clock_timestamp(), approved_by=auth.uid(), updated_by=auth.uid(), closed_at=null, closure_reason=null where id=p_activity_id;
  insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status) values (p_activity_id,'APPROVED',auth.uid(),v_activity.status,'APPROVED');
  return p_activity_id;
end;
$$;

create or replace function public.reject_overtime_l5(p_activity_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_activity public.overtime_activities%rowtype; v_reason text; v_deadline timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_reason:=btrim(coalesce(p_reason,''));
  if v_reason='' then raise exception 'Reject reason is required'; end if;
  select * into v_activity from public.overtime_activities where id=p_activity_id for update;
  if not found then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id) then raise exception 'Not authorized to reject in this UP3' using errcode='42501'; end if;
  if v_activity.status not in ('SUBMITTED') then raise exception 'Only submitted overtime can be rejected'; end if;
  if v_activity.rejection_count >= 3 then raise exception 'Maximum rejections reached'; end if;
  v_deadline := (now()::date + 3) + time '23:59:59.999999';
  -- convert to timestamptz in Pontianak, but we store as timestamptz at 23:59 Pontianak
  v_deadline := ( (now() at time zone 'Asia/Pontianak')::date + 3 + time '23:59:59.999999') at time zone 'Asia/Pontianak';
  if v_activity.rejection_count = 0 then
    update public.overtime_activities set status='CORRECTION_REQUIRED', rejection_count=1, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), revision_deadline_at=v_deadline, updated_by=auth.uid() where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number) values (p_activity_id,'REJECTED',auth.uid(),v_activity.status,'CORRECTION_REQUIRED',v_reason,1);
  elsif v_activity.rejection_count = 1 then
    update public.overtime_activities set status='CORRECTION_REQUIRED', rejection_count=2, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), revision_deadline_at=v_deadline, updated_by=auth.uid() where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number) values (p_activity_id,'REJECTED',auth.uid(),v_activity.status,'CORRECTION_REQUIRED',v_reason,2);
  else -- third rejection
    update public.overtime_activities set status='CLOSED', closure_reason='FINAL_REJECTED', rejection_count=3, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), closed_at=clock_timestamp(), closed_by=auth.uid(), updated_by=auth.uid(), revision_deadline_at=null where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number) values (p_activity_id,'CLOSED',auth.uid(),v_activity.status,'CLOSED',v_reason,3);
  end if;
  return p_activity_id;
end;
$$;

create or replace function public.resubmit_overtime_l5(p_activity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_activity public.overtime_activities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_activity from public.overtime_activities where id=p_activity_id for update;
  if not found then raise exception 'Overtime activity not found'; end if;
  -- only owner ULP can resubmit
  if not public.auth_can_mutate_overtime_replacement_l2(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id)
     and not public.auth_can_mutate_overtime_work_l3(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to resubmit' using errcode='42501';
  end if;
  if v_activity.status <> 'CORRECTION_REQUIRED' then raise exception 'Only revision can be resubmitted'; end if;
  if v_activity.revision_deadline_at is not null and clock_timestamp() > v_activity.revision_deadline_at then
    update public.overtime_activities set status='CLOSED', closure_reason='EXPIRED', closed_at=clock_timestamp(), closed_by=auth.uid(), updated_by=auth.uid() where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason) values (p_activity_id,'CLOSED',auth.uid(),v_activity.status,'CLOSED','Revision deadline expired');
    raise exception 'Revision deadline has expired';
  end if;
  -- validate evidence and participants are complete for resubmit
  if v_activity.type in ('REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION') and (select count(*) from public.overtime_entries where activity_id=p_activity_id) <>1 then raise exception 'Replacement must have exactly one participant'; end if;
  if v_activity.type not in ('REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION') and (select count(*) from public.overtime_entries where activity_id=p_activity_id)=0 then raise exception 'At least one participant required'; end if;
  if exists (select 1 from public.overtime_evidence where activity_id=p_activity_id and status in ('PENDING','DELETE_PENDING')) then raise exception 'Resolve pending evidence before resubmit'; end if;
  if v_activity.type='REPLACEMENT_LEAVE' then
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FORM_CUTI' and status='ACTIVE')<>1 then raise exception 'Required ACTIVE evidence missing: FORM_CUTI'; end if;
  elsif v_activity.type='REPLACEMENT_SICK' then
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FORM_SAKIT' and status='ACTIVE')<>1 then raise exception 'Missing FORM_SAKIT'; end if;
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='SURAT_SAKIT' and status='ACTIVE')<>1 then raise exception 'Missing SURAT_SAKIT'; end if;
  elsif v_activity.type='REPLACEMENT_PERMISSION' then
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FORM_IZIN' and status='ACTIVE')<>1 then raise exception 'Missing FORM_IZIN'; end if;
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='SURAT_IZIN' and status='ACTIVE')<>1 then raise exception 'Missing SURAT_IZIN'; end if;
  elsif v_activity.type='WORK' and v_activity.work_category='ADMINISTRASI' then
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_SEBELUM' and status='ACTIVE')<>1 then raise exception 'Missing FOTO_SEBELUM'; end if;
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_SESUDAH' and status='ACTIVE')<>1 then raise exception 'Missing FOTO_SESUDAH'; end if;
  elsif v_activity.type='WORK' then
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='SPK' and status='ACTIVE')<>1 then raise exception 'Missing SPK'; end if;
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_BRIEFING' and status='ACTIVE')<1 then raise exception 'Missing FOTO_BRIEFING'; end if;
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_PROSES' and status='ACTIVE')<>1 then raise exception 'Missing FOTO_PROSES'; end if;
    if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_SELESAI' and status='ACTIVE')<>1 then raise exception 'Missing FOTO_SELESAI'; end if;
  end if;
  update public.overtime_activities set status='SUBMITTED', submission_count = submission_count+1, current_submission_number = current_submission_number+1, last_resubmitted_at=clock_timestamp(), last_resubmitted_by=auth.uid(), updated_by=auth.uid(), revision_deadline_at=null where id=p_activity_id;
  insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, submission_number) values (p_activity_id,'RESUBMITTED',auth.uid(),v_activity.status,'SUBMITTED', v_activity.submission_count+1);
  return p_activity_id;
end;
$$;

create or replace function public.list_overtime_history_l5(p_activity_id uuid)
returns setof public.overtime_activity_history
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_activity public.overtime_activities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_activity from public.overtime_activities where id=p_activity_id;
  if not found then raise exception 'Activity not found'; end if;
  if not public.auth_can_read_overtime_evidence_scope(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to read history' using errcode='42501';
  end if;
  return query select * from public.overtime_activity_history where activity_id=p_activity_id order by occurred_at, created_at;
end;
$$;

create or replace function public.get_overtime_detail_l5(p_activity_id uuid)
returns table (
  activity_id uuid,
  contract_id uuid,
  up3_id uuid,
  unit_id uuid,
  type text,
  work_category text,
  work_title text,
  work_location text,
  description text,
  status text,
  rejection_count int,
  submission_count int,
  revision_deadline_at timestamptz,
  last_rejection_at timestamptz,
  closure_reason text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_activity public.overtime_activities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_activity from public.overtime_activities where id=p_activity_id;
  if not found then raise exception 'Activity not found'; end if;
  if not public.auth_can_read_overtime_evidence_scope(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return query select v_activity.id, v_activity.contract_id, v_activity.up3_id, v_activity.unit_id, v_activity.type, v_activity.work_category, v_activity.work_title, v_activity.work_location, v_activity.description, v_activity.status, v_activity.rejection_count, v_activity.submission_count, v_activity.revision_deadline_at, v_activity.last_rejection_at, v_activity.closure_reason, v_activity.created_at, v_activity.updated_at;
end;
$$;

revoke all on function public.auth_can_review_overtime_l5(uuid, uuid) from public, anon, authenticated;
revoke all on function public.approve_overtime_l5(uuid) from public, anon, authenticated;
revoke all on function public.reject_overtime_l5(uuid, text) from public, anon, authenticated;
revoke all on function public.resubmit_overtime_l5(uuid) from public, anon, authenticated;
revoke all on function public.list_overtime_history_l5(uuid) from public, anon, authenticated;
revoke all on function public.get_overtime_detail_l5(uuid) from public, anon, authenticated;
grant execute on function public.approve_overtime_l5(uuid) to authenticated;
grant execute on function public.reject_overtime_l5(uuid, text) to authenticated;
grant execute on function public.resubmit_overtime_l5(uuid) to authenticated;
grant execute on function public.list_overtime_history_l5(uuid) to authenticated;
grant execute on function public.get_overtime_detail_l5(uuid) to authenticated;
