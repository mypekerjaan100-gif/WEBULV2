-- Add ROW to the existing Lembur Pekerjaan category path.

alter table public.overtime_activities
  drop constraint overtime_activities_work_category_check;

alter table public.overtime_activities
  add constraint overtime_activities_work_category_check
  check (work_category in ('ADMINISTRASI', 'GARDU', 'JTM', 'JTR', 'ROW'));

create or replace function public.guard_overtime_replacement_type_evidence_l2()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.type,new.work_category) is distinct from (old.type,old.work_category)
     and exists (select 1 from public.overtime_evidence evidence
       where evidence.activity_id=old.id and evidence.status in ('ACTIVE','PENDING','DELETE_PENDING')
       and not ((new.type='REPLACEMENT_LEAVE' and evidence.evidence_type='FORM_CUTI')
         or (new.type='REPLACEMENT_SICK' and evidence.evidence_type in ('FORM_SAKIT','SURAT_SAKIT'))
         or (new.type='REPLACEMENT_PERMISSION' and evidence.evidence_type in ('FORM_IZIN','SURAT_IZIN'))
         or (new.type='WORK' and new.work_category='ADMINISTRASI' and evidence.evidence_type in ('FOTO_SEBELUM','FOTO_SESUDAH'))
         or (new.type='WORK' and new.work_category in ('GARDU','JTM','JTR','ROW') and evidence.evidence_type in ('SPK','FOTO_BRIEFING','FOTO_PROSES','FOTO_SELESAI')))) then
    raise exception 'Overtime type change would invalidate existing evidence';
  end if;
  return new;
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
declare v_activity public.overtime_activities%rowtype; v_activity_id uuid; v_business_date date; v_period_month date; v_min_started timestamptz; v_max_ended timestamptz; v_count int; v_idx int; v_part jsonb; v_employee_id uuid; v_started timestamptz; v_ended timestamptz; v_rate numeric(18,2); v_actual_minutes numeric; v_duration numeric; v_multiplier numeric; v_name text; v_seen uuid[]; v_desc_trim text; v_title_trim text; v_location_trim text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_work_category is null or p_work_category not in ('ADMINISTRASI','GARDU','JTM','JTR','ROW') then raise exception 'Work category must be ADMINISTRASI, GARDU, JTM, JTR, or ROW'; end if;
 v_desc_trim:=btrim(coalesce(p_description,'')); if v_desc_trim='' then raise exception 'Keterangan pekerjaan wajib diisi'; end if;
 v_title_trim:=btrim(coalesce(p_work_title,'')); v_location_trim:=btrim(coalesce(p_work_location,''));
 if p_work_category='ADMINISTRASI' then if v_title_trim<>'' or v_location_trim<>'' then raise exception 'Administrasi tidak memerlukan uraian atau lokasi'; end if;
 else if v_title_trim='' then raise exception 'Uraian pekerjaan wajib diisi'; end if; if v_location_trim='' then raise exception 'Lokasi pekerjaan wajib diisi'; end if; end if;
 if p_participants is null or jsonb_typeof(p_participants)<>'array' then raise exception 'Participants must be a JSON array'; end if;
 v_count:=jsonb_array_length(p_participants); if v_count=0 then raise exception 'At least one participant is required'; end if;
 if p_work_category='ADMINISTRASI' and v_count<>1 then raise exception 'Administrasi requires exactly one participant'; end if;
 if p_activity_id is not null then select * into v_activity from public.overtime_activities a where a.id=p_activity_id and public.auth_can_mutate_overtime_work_l3(a.contract_id,a.up3_id,a.unit_id) for update; if not found then raise exception 'Overtime activity is not available to this account' using errcode='42501'; end if; if v_activity.status<>'DRAFT' then raise exception 'Only DRAFT work overtime can be changed'; end if; if v_activity.type<>'WORK' then raise exception 'The requested activity is not Lembur Pekerjaan'; end if; if (v_activity.contract_id,v_activity.up3_id,v_activity.unit_id) is distinct from (p_contract_id,p_up3_id,p_unit_id) then raise exception 'Overtime activity is not in the exact requested scope'; end if; end if;
 if not public.auth_can_mutate_overtime_work_l3(p_contract_id,p_up3_id,p_unit_id) then raise exception 'Work overtime scope is not mutable by this account' using errcode='42501'; end if;
 v_seen:=array[]::uuid[]; v_min_started:=null; v_max_ended:=null;
 for v_idx in 0..v_count-1 loop v_part:=p_participants->v_idx; v_employee_id:=nullif(btrim(v_part->>'employee_id'),'')::uuid; v_started:=nullif(btrim(v_part->>'started_at'),'')::timestamptz; v_ended:=nullif(btrim(v_part->>'ended_at'),'')::timestamptz; if v_employee_id is null or v_started is null or v_ended is null then raise exception 'Each participant requires employee, start, and end'; end if; if v_ended<=v_started then raise exception 'Participant end must be after start'; end if; if v_ended - v_started < interval '1 minute' then raise exception 'Participant duration must be at least one minute'; end if; if v_employee_id = any(v_seen) then raise exception 'Duplicate participant employee in same activity'; end if; v_seen:=array_append(v_seen,v_employee_id); if v_min_started is null or v_started < v_min_started then v_min_started:=v_started; end if; if v_max_ended is null or v_ended > v_max_ended then v_max_ended:=v_ended; end if; end loop;
 v_business_date:=(v_min_started at time zone 'Asia/Pontianak')::date; v_period_month:=date_trunc('month',v_min_started at time zone 'Asia/Pontianak')::date;
 for v_idx in 0..v_count-1 loop v_part:=p_participants->v_idx; v_employee_id:=(v_part->>'employee_id')::uuid; v_started:=(v_part->>'started_at')::timestamptz; if (v_started at time zone 'Asia/Pontianak')::date <> v_business_date then raise exception 'All participants must start on the same business date'; end if; if not public.overtime_employee_is_eligible_l2(v_employee_id,p_contract_id,p_up3_id,p_unit_id,(v_started at time zone 'Asia/Pontianak')::date) then raise exception 'Participant employee is not eligible in exact scope/date'; end if; end loop;
 if p_activity_id is not null then perform 1 from public.overtime_entries where activity_id=p_activity_id for update; delete from public.overtime_entries where activity_id=p_activity_id; end if;
 if p_activity_id is null then insert into public.overtime_activities(contract_id,up3_id,unit_id,type,work_category,replaced_employee_id,description,work_title,work_location,started_at,ended_at,status,created_by,updated_by) values (p_contract_id,p_up3_id,p_unit_id,'WORK',p_work_category,null,v_desc_trim,nullif(v_title_trim,''),nullif(v_location_trim,''),v_min_started,v_max_ended,'DRAFT',auth.uid(),auth.uid()) returning id into v_activity_id; else update public.overtime_activities set work_category=p_work_category,description=v_desc_trim,work_title=nullif(v_title_trim,''),work_location=nullif(v_location_trim,''),started_at=v_min_started,ended_at=v_max_ended,updated_by=auth.uid() where id=p_activity_id returning id into v_activity_id; end if;
 for v_idx in 0..v_count-1 loop v_part:=p_participants->v_idx; v_employee_id:=(v_part->>'employee_id')::uuid; v_started:=(v_part->>'started_at')::timestamptz; v_ended:=(v_part->>'ended_at')::timestamptz; v_business_date:=(v_started at time zone 'Asia/Pontianak')::date; v_period_month:=date_trunc('month',v_started at time zone 'Asia/Pontianak')::date; select upper(e.name) into v_name from public.employees e where e.id=v_employee_id; select r.hourly_rate into v_rate from public.employee_hourly_rate_history r where r.employee_id=v_employee_id and r.effective_from<=v_business_date and (r.effective_to is null or v_business_date<r.effective_to) order by r.effective_from desc limit 1; if v_rate is null then raise exception 'Hourly rate not found for participant start date'; end if; v_actual_minutes:=extract(epoch from(v_ended - v_started))/60; v_duration:=round(v_actual_minutes/60,4); v_multiplier:=round(case when v_actual_minutes<=60 then v_actual_minutes*1.5/60 else 1.5+((v_actual_minutes-60)*2/60) end,4); insert into public.overtime_entries(activity_id,contract_id,up3_id,unit_id,employee_id,work_date,period_month,hours,description,employee_name_snapshot,hourly_rate_snapshot,calculated_amount_snapshot,participant_started_at,participant_ended_at,duration_hours_snapshot,multiplier_hours_snapshot,created_by,updated_by) values (v_activity_id,p_contract_id,p_up3_id,p_unit_id,v_employee_id,v_business_date,v_period_month,round(v_duration,2),v_desc_trim,v_name,v_rate,round(v_rate*v_multiplier,2),v_started,v_ended,v_duration,v_multiplier,auth.uid(),auth.uid()); end loop;
 if p_activity_id is null then insert into public.overtime_activity_history(activity_id,event,actor_user_id,previous_status,new_status) values (v_activity_id,'CREATED',auth.uid(),null,'DRAFT'); end if; return v_activity_id;
end;
$$;

create or replace function public.submit_overtime_work_l3(p_activity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_activity public.overtime_activities%rowtype; v_submission_number int;
begin if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if; select * into v_activity from public.overtime_activities a where a.id=p_activity_id and public.auth_can_mutate_overtime_work_l3(a.contract_id,a.up3_id,a.unit_id) for update; if not found then raise exception 'Overtime activity is not available to this account' using errcode='42501'; end if; if v_activity.type<>'WORK' then raise exception 'Only Lembur Pekerjaan can be submitted via this path'; end if; if v_activity.status<>'DRAFT' then raise exception 'Only DRAFT work overtime can be submitted'; end if; if v_activity.work_category not in ('ADMINISTRASI','GARDU','JTM','JTR','ROW') then raise exception 'Work category is not valid'; end if; if btrim(coalesce(v_activity.description,''))='' then raise exception 'Keterangan pekerjaan wajib diisi'; end if; if v_activity.work_category<>'ADMINISTRASI' then if btrim(coalesce(v_activity.work_title,''))='' then raise exception 'Uraian pekerjaan wajib diisi'; end if; if btrim(coalesce(v_activity.work_location,''))='' then raise exception 'Lokasi pekerjaan wajib diisi'; end if; end if; if clock_timestamp() > (v_activity.submission_deadline + time '23:59:59.999999') at time zone 'Asia/Pontianak' then raise exception 'Work overtime submission deadline has passed'; end if; if (select count(*) from public.overtime_entries where activity_id=p_activity_id)=0 then raise exception 'At least one participant is required'; end if; if v_activity.work_category='ADMINISTRASI' and (select count(*) from public.overtime_entries where activity_id=p_activity_id)<>1 then raise exception 'Administrasi requires exactly one participant'; end if; if exists(select 1 from public.overtime_evidence where activity_id=p_activity_id and status in ('PENDING','DELETE_PENDING')) then raise exception 'Resolve pending evidence operations before submission'; end if;
 if v_activity.work_category='ADMINISTRASI' then if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_SEBELUM' and status='ACTIVE')<>1 then raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_SEBELUM'; end if; if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_SESUDAH' and status='ACTIVE')<>1 then raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_SESUDAH'; end if; if exists(select 1 from public.overtime_evidence where activity_id=p_activity_id and status='ACTIVE' and evidence_type not in ('FOTO_SEBELUM','FOTO_SESUDAH')) then raise exception 'ACTIVE evidence contains a type not required by Administrasi'; end if;
 else if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='SPK' and status='ACTIVE')<>1 then raise exception 'Required ACTIVE evidence is missing or duplicated: SPK'; end if; if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_BRIEFING' and status='ACTIVE')<1 then raise exception 'At least one ACTIVE FOTO_BRIEFING is required'; end if; if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_PROSES' and status='ACTIVE')<>1 then raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_PROSES'; end if; if (select count(*) from public.overtime_evidence where activity_id=p_activity_id and evidence_type='FOTO_SELESAI' and status='ACTIVE')<>1 then raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_SELESAI'; end if; if exists(select 1 from public.overtime_evidence where activity_id=p_activity_id and status='ACTIVE' and evidence_type not in ('SPK','FOTO_BRIEFING','FOTO_PROSES','FOTO_SELESAI')) then raise exception 'ACTIVE evidence contains a type not required by this work category'; end if; end if;
 v_submission_number:=v_activity.submission_count+1; update public.overtime_activities set status='SUBMITTED',submitted_at=clock_timestamp(),submitted_by=auth.uid(),submission_count=v_submission_number,current_submission_number=v_submission_number,updated_by=auth.uid() where id=p_activity_id; insert into public.overtime_activity_history(activity_id,event,actor_user_id,submission_number,previous_status,new_status) values (p_activity_id,'SUBMITTED',auth.uid(),v_submission_number,'DRAFT','SUBMITTED'); return p_activity_id;
end;
$$;
