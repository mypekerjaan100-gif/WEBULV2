-- Allow ADMIN_ULP to edit Pengganti data returned for correction.
-- The active save_overtime_replacement_draft_l2 only accepted DRAFT, while the UI
-- allows "Lanjutkan Draft" for CORRECTION_REQUIRED and save_overtime_work_draft_l3
-- already accepts DRAFT/CORRECTION_REQUIRED. This mismatch caused:
-- "Only DRAFT replacement overtime can be changed" on valid revisions.
-- Revision saves keep activity/entry in CORRECTION_REQUIRED with rejection_count
-- and revision_deadline_at preserved; actual resubmission stays in resubmit_overtime_l5.

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
  v_is_revision boolean := false;
  v_carry_rejections integer := 0;
  v_carry_deadline timestamptz := null;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_type is null or p_type not in ('REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION') then raise exception 'L2 replacement type must be leave, sick, or permission'; end if;
  if p_replaced_employee_id is null or p_participant_employee_id is null or p_replaced_employee_id=p_participant_employee_id then raise exception 'Replaced and participant employees must be distinct'; end if;
  if p_started_at is null or p_ended_at is null or p_ended_at<=p_started_at then raise exception 'Overtime end must be after start'; end if;
  if p_ended_at-p_started_at<interval '1 minute' then raise exception 'Overtime duration must be at least one minute'; end if;
  if p_activity_id is not null then
    select * into v_activity from public.overtime_activities a where a.id=p_activity_id and public.auth_can_mutate_overtime_replacement_l2(a.contract_id,a.up3_id,a.unit_id) for update;
    if not found then raise exception 'Overtime activity is not available to this account' using errcode='42501'; end if;
    if v_activity.status not in ('DRAFT','CORRECTION_REQUIRED') then raise exception 'Only DRAFT or revision replacement overtime can be changed'; end if;
    if v_activity.status='CORRECTION_REQUIRED' and v_activity.revision_deadline_at is not null and clock_timestamp() > v_activity.revision_deadline_at then
      update public.overtime_activities set status='CLOSED', closure_reason='EXPIRED', closed_at=now(), closed_by=auth.uid(), updated_by=auth.uid() where id=p_activity_id;
      update public.overtime_entries set approval_status='CLOSED', revision_deadline_at=null, updated_by=auth.uid() where activity_id=p_activity_id and approval_status in ('DRAFT','SUBMITTED','CORRECTION_REQUIRED');
      insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason) values (p_activity_id,'CLOSED',auth.uid(),v_activity.status,'CLOSED','Revision deadline expired');
      raise exception 'Revision deadline has expired';
    end if;
    if v_activity.type not in ('REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION') then raise exception 'The requested activity is not an L2 replacement'; end if;
    if (v_activity.contract_id,v_activity.up3_id,v_activity.unit_id) is distinct from (p_contract_id,p_up3_id,p_unit_id) then raise exception 'Overtime activity is not in the exact requested scope'; end if;
    v_is_revision := (v_activity.status = 'CORRECTION_REQUIRED');
  end if;
  if not public.auth_can_mutate_overtime_replacement_l2(p_contract_id,p_up3_id,p_unit_id) then raise exception 'Replacement overtime scope is not mutable by this account' using errcode='42501'; end if;
  if p_activity_id is not null then
    select e.* into v_entry from public.overtime_entries e where e.activity_id=p_activity_id order by e.id limit 1 for update;
    if (select count(*) from public.overtime_entries e where e.activity_id=p_activity_id)>1 then raise exception 'Replacement overtime must have exactly one participant'; end if;
    if v_is_revision and v_entry.id is not null then
      v_carry_rejections := coalesce(v_entry.rejection_count, v_activity.rejection_count, 0);
      v_carry_deadline := coalesce(v_entry.revision_deadline_at, v_activity.revision_deadline_at);
    end if;
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
  insert into public.overtime_entries(activity_id,contract_id,up3_id,unit_id,employee_id,work_date,period_month,hours,description,employee_name_snapshot,hourly_rate_snapshot,calculated_amount_snapshot,participant_started_at,participant_ended_at,duration_hours_snapshot,multiplier_hours_snapshot,approval_status,rejection_count,revision_deadline_at,created_by,updated_by) values (v_activity_id,p_contract_id,p_up3_id,p_unit_id,p_participant_employee_id,v_business_date,v_period_month,round(v_duration_hours,2),v_description,v_participant_name,v_rate,round(v_rate*v_multiplier_hours,2),p_started_at,p_ended_at,v_duration_hours,v_multiplier_hours,case when v_is_revision then 'CORRECTION_REQUIRED' else 'DRAFT' end,case when v_is_revision then v_carry_rejections else 0 end,case when v_is_revision then v_carry_deadline else null end,auth.uid(),auth.uid());
  if p_activity_id is null then insert into public.overtime_activity_history(activity_id,event,actor_user_id,previous_status,new_status) values (v_activity_id,'CREATED',auth.uid(),null,'DRAFT');
  else insert into public.overtime_activity_history(activity_id,event,actor_user_id,previous_status,new_status,notes) values (v_activity_id, case when v_is_revision then 'RESUBMITTED' else 'CREATED' end, auth.uid(), v_activity.status, (case when v_is_revision then v_activity.status else 'DRAFT' end), 'Revision updated');
  end if;
  return v_activity_id;
end;
$$;

comment on function public.save_overtime_replacement_draft_l2(uuid, uuid, uuid, uuid, text, uuid, uuid, timestamptz, timestamptz)
  is 'Saves L2 replacement draft in DRAFT or CORRECTION_REQUIRED; revision saves preserve correction state until resubmit_overtime_l5.';
