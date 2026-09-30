-- Overtime entry-level approval for multi-participant WORK (JTM/JTR/GARDU/ROW).
-- One form stays one activity, but each participant (entry) now carries its own
-- review state. Activity status is derived from its entries:
--   any CORRECTION_REQUIRED/SUBMITTED entry -> CORRECTION_REQUIRED / SUBMITTED
--   all APPROVED                              -> APPROVED
--   all CLOSED                                -> CLOSED (FINAL_REJECTED)
--   mix APPROVED + CLOSED                     -> APPROVED
-- Legacy activity-level approve/reject RPCs are preserved and now mirror their
-- transitions onto open entries so both paths stay consistent.

alter table public.overtime_entries
  add column if not exists approval_status text not null default 'DRAFT'
    check (approval_status in ('DRAFT', 'SUBMITTED', 'CORRECTION_REQUIRED', 'APPROVED', 'CLOSED')),
  add column if not exists rejection_count integer not null default 0,
  add column if not exists revision_deadline_at timestamptz;

-- Backfill legacy activity-level review state onto entries.
update public.overtime_entries e
set approval_status = a.status,
    rejection_count = coalesce(a.rejection_count, 0),
    revision_deadline_at = a.revision_deadline_at
from public.overtime_activities a
where e.activity_id = a.id;

create index if not exists idx_overtime_entries_activity_review
  on public.overtime_entries (activity_id, approval_status);

-- Recomputes activity review status from its entries.
create or replace function public.refresh_overtime_activity_review_status(p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total int;
  v_correction int;
  v_submitted int;
  v_approved int;
  v_closed int;
  v_max_rejections int;
  v_max_deadline timestamptz;
begin
  select count(*),
    count(*) filter (where approval_status = 'CORRECTION_REQUIRED'),
    count(*) filter (where approval_status = 'SUBMITTED'),
    count(*) filter (where approval_status = 'APPROVED'),
    count(*) filter (where approval_status = 'CLOSED'),
    coalesce(max(rejection_count), 0),
    max(revision_deadline_at) filter (where approval_status in ('SUBMITTED', 'CORRECTION_REQUIRED'))
  into v_total, v_correction, v_submitted, v_approved, v_closed, v_max_rejections, v_max_deadline
  from public.overtime_entries
  where activity_id = p_activity_id;

  if v_total = 0 then return; end if;

  if v_correction > 0 or v_submitted > 0 then
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

-- Approve a single participant entry.
create or replace function public.approve_overtime_entry_l5(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.overtime_entries%rowtype;
  v_activity public.overtime_activities%rowtype;
  v_prev_activity_status text;
  v_after public.overtime_activities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_entry from public.overtime_entries where id = p_entry_id for update;
  if not found then raise exception 'Overtime participant not found'; end if;
  select * into v_activity from public.overtime_activities where id = v_entry.activity_id and deleted_at is null for update;
  if not found then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to approve in this UP3' using errcode = '42501';
  end if;
  if v_entry.approval_status <> 'SUBMITTED' then
    raise exception 'Only submitted overtime entries can be approved';
  end if;

  update public.overtime_entries
  set approval_status = 'APPROVED',
      revision_deadline_at = null,
      updated_by = auth.uid()
  where id = p_entry_id;

  insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, notes)
  values (v_activity.id, 'APPROVED', auth.uid(), 'SUBMITTED', 'APPROVED', 'Peserta: ' || coalesce(v_entry.employee_name_snapshot, v_entry.employee_id::text));

  v_prev_activity_status := v_activity.status;
  perform public.refresh_overtime_activity_review_status(v_activity.id);
  select * into v_after from public.overtime_activities where id = v_activity.id;
  if v_after.status = 'APPROVED' and v_prev_activity_status <> 'APPROVED' then
    update public.overtime_activities
    set approved_at = clock_timestamp(),
        approved_by = auth.uid(),
        closed_at = null,
        closure_reason = null
    where id = v_activity.id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status)
    values (v_activity.id, 'APPROVED', auth.uid(), v_prev_activity_status, 'APPROVED');
  end if;
  return p_entry_id;
end;
$$;

-- Reject a single participant entry (3-strike revision cycle per participant).
create or replace function public.reject_overtime_entry_l5(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.overtime_entries%rowtype;
  v_activity public.overtime_activities%rowtype;
  v_reason text;
  v_deadline timestamptz;
  v_prev_activity_status text;
  v_after public.overtime_activities%rowtype;
  v_participant_label text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then raise exception 'Reject reason is required'; end if;
  select * into v_entry from public.overtime_entries where id = p_entry_id for update;
  if not found then raise exception 'Overtime participant not found'; end if;
  select * into v_activity from public.overtime_activities where id = v_entry.activity_id and deleted_at is null for update;
  if not found then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to reject in this UP3' using errcode = '42501';
  end if;
  if v_entry.approval_status <> 'SUBMITTED' then
    raise exception 'Only submitted overtime entries can be rejected';
  end if;
  if v_entry.rejection_count >= 3 then raise exception 'Maximum rejections reached'; end if;

  v_deadline := ((now() at time zone 'Asia/Pontianak')::date + 3 + time '23:59:59.999999') at time zone 'Asia/Pontianak';
  v_participant_label := 'Peserta: ' || coalesce(v_entry.employee_name_snapshot, v_entry.employee_id::text);

  if v_entry.rejection_count = 0 then
    update public.overtime_entries
    set approval_status = 'CORRECTION_REQUIRED', rejection_count = 1,
        revision_deadline_at = v_deadline, updated_by = auth.uid()
    where id = p_entry_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number, notes)
    values (v_activity.id, 'REJECTED', auth.uid(), 'SUBMITTED', 'CORRECTION_REQUIRED', v_reason, 1, v_participant_label);
  elsif v_entry.rejection_count = 1 then
    update public.overtime_entries
    set approval_status = 'CORRECTION_REQUIRED', rejection_count = 2,
        revision_deadline_at = v_deadline, updated_by = auth.uid()
    where id = p_entry_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number, notes)
    values (v_activity.id, 'REJECTED', auth.uid(), 'SUBMITTED', 'CORRECTION_REQUIRED', v_reason, 2, v_participant_label);
  else
    update public.overtime_entries
    set approval_status = 'CLOSED', rejection_count = 3,
        revision_deadline_at = null, updated_by = auth.uid()
    where id = p_entry_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number, notes)
    values (v_activity.id, 'CLOSED', auth.uid(), 'SUBMITTED', 'CLOSED', v_reason, 3, v_participant_label);
  end if;

  v_prev_activity_status := v_activity.status;
  perform public.refresh_overtime_activity_review_status(v_activity.id);
  select * into v_after from public.overtime_activities where id = v_activity.id;
  if v_after.status <> v_prev_activity_status then
    if v_after.status = 'CORRECTION_REQUIRED' then
      insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, notes)
      values (v_activity.id, 'REJECTED', auth.uid(), v_prev_activity_status, 'CORRECTION_REQUIRED', v_reason, v_participant_label);
    elsif v_after.status = 'CLOSED' then
      insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, notes)
      values (v_activity.id, 'CLOSED', auth.uid(), v_prev_activity_status, 'CLOSED', v_reason, v_participant_label);
    end if;
  end if;
  return p_entry_id;
end;
$$;

-- Legacy activity-level approve: also flips open entries so both levels stay consistent.
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
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then raise exception 'Not authorized to approve in this UP3' using errcode='42501'; end if;
  if v_activity.status <> 'SUBMITTED' then raise exception 'Only submitted overtime can be approved'; end if;
  update public.overtime_activities set status='APPROVED', approved_at=clock_timestamp(), approved_by=auth.uid(), updated_by=auth.uid(), closed_at=null, closure_reason=null where id=p_activity_id;
  update public.overtime_entries set approval_status='APPROVED', revision_deadline_at=null, updated_by=auth.uid()
  where activity_id=p_activity_id and approval_status <> 'CLOSED';
  insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status) values (p_activity_id,'APPROVED',auth.uid(),v_activity.status,'APPROVED');
  return p_activity_id;
end;
$$;

-- Legacy activity-level reject: mirrors the strike transition onto open entries.
create or replace function public.reject_overtime_l5(p_activity_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_activity public.overtime_activities%rowtype; v_reason text; v_deadline timestamptz; v_next_count int;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  v_reason:=btrim(coalesce(p_reason,''));
  if v_reason='' then raise exception 'Reject reason is required'; end if;
  select * into v_activity from public.overtime_activities where id=p_activity_id for update;
  if not found then raise exception 'Overtime activity not found'; end if;
  if not public.auth_can_review_overtime_l5(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then raise exception 'Not authorized to reject in this UP3' using errcode='42501'; end if;
  if v_activity.status <> 'SUBMITTED' then raise exception 'Only submitted overtime can be rejected'; end if;
  if v_activity.rejection_count >= 3 then raise exception 'Maximum rejections reached'; end if;
  v_deadline := ((now() at time zone 'Asia/Pontianak')::date + 3 + time '23:59:59.999999') at time zone 'Asia/Pontianak';
  v_next_count := v_activity.rejection_count + 1;
  if v_activity.rejection_count = 0 then
    update public.overtime_activities set status='CORRECTION_REQUIRED', rejection_count=1, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), revision_deadline_at=v_deadline, updated_by=auth.uid() where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number) values (p_activity_id,'REJECTED',auth.uid(),v_activity.status,'CORRECTION_REQUIRED',v_reason,1);
  elsif v_activity.rejection_count = 1 then
    update public.overtime_activities set status='CORRECTION_REQUIRED', rejection_count=2, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), revision_deadline_at=v_deadline, updated_by=auth.uid() where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number) values (p_activity_id,'REJECTED',auth.uid(),v_activity.status,'CORRECTION_REQUIRED',v_reason,2);
  else
    update public.overtime_activities set status='CLOSED', closure_reason='FINAL_REJECTED', rejection_count=3, last_rejection_at=clock_timestamp(), last_rejected_by=auth.uid(), closed_at=clock_timestamp(), closed_by=auth.uid(), updated_by=auth.uid(), revision_deadline_at=null where id=p_activity_id;
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason, rejection_number) values (p_activity_id,'CLOSED',auth.uid(),v_activity.status,'CLOSED',v_reason,3);
  end if;
  update public.overtime_entries
  set approval_status = case when v_next_count >= 3 then 'CLOSED' else 'CORRECTION_REQUIRED' end,
      rejection_count = v_next_count,
      revision_deadline_at = case when v_next_count >= 3 then null else v_deadline end,
      updated_by = auth.uid()
  where activity_id = p_activity_id
    and approval_status not in ('APPROVED', 'CLOSED');
  return p_activity_id;
end;
$$;

-- Resubmit flips revised entries back to SUBMITTED; approved siblings are untouched.
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
  if not public.auth_can_mutate_overtime_replacement_l2(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id)
     and not public.auth_can_mutate_overtime_work_l3(v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) then
    raise exception 'Not authorized to resubmit' using errcode='42501';
  end if;
  if v_activity.status <> 'CORRECTION_REQUIRED' then raise exception 'Only revision can be resubmitted'; end if;
  if v_activity.revision_deadline_at is not null and clock_timestamp() > v_activity.revision_deadline_at then
    update public.overtime_activities set status='CLOSED', closure_reason='EXPIRED', closed_at=clock_timestamp(), closed_by=auth.uid(), updated_by=auth.uid() where id=p_activity_id;
    update public.overtime_entries set approval_status='CLOSED', revision_deadline_at=null, updated_by=auth.uid()
    where activity_id=p_activity_id and approval_status in ('DRAFT', 'SUBMITTED', 'CORRECTION_REQUIRED');
    insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason) values (p_activity_id,'CLOSED',auth.uid(),v_activity.status,'CLOSED','Revision deadline expired');
    raise exception 'Revision deadline has expired';
  end if;
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
  update public.overtime_entries set approval_status='SUBMITTED', revision_deadline_at=null, updated_by=auth.uid()
  where activity_id=p_activity_id and approval_status in ('DRAFT', 'CORRECTION_REQUIRED');
  insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, submission_number) values (p_activity_id,'RESUBMITTED',auth.uid(),v_activity.status,'SUBMITTED', v_activity.submission_count+1);
  return p_activity_id;
end;
$$;

-- First submit flips DRAFT entries to SUBMITTED.
create or replace function public.submit_overtime_work_l3(p_activity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.overtime_activities%rowtype;
  v_submission_number integer;
  v_as_of timestamptz := clock_timestamp();
  v_effective_submission_days integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_activity
  from public.overtime_activities activity
  where activity.id = p_activity_id
    and activity.deleted_at is null
    and public.auth_can_mutate_overtime_work_l3(
      activity.contract_id,
      activity.up3_id,
      activity.unit_id
    )
  for update;
  if not found then
    raise exception 'Overtime activity is not available to this account'
      using errcode = '42501';
  end if;
  if v_activity.type <> 'WORK' then
    raise exception 'Only Lembur Pekerjaan can be submitted via this path';
  end if;
  if v_activity.status <> 'DRAFT' then
    raise exception 'Only DRAFT work overtime can be submitted';
  end if;
  if v_activity.work_category not in ('ADMINISTRASI', 'GARDU', 'JTM', 'JTR', 'ROW') then
    raise exception 'Work category is not valid';
  end if;
  if btrim(coalesce(v_activity.description, '')) = '' then
    raise exception 'Keterangan pekerjaan wajib diisi';
  end if;
  if v_activity.work_category <> 'ADMINISTRASI' then
    if btrim(coalesce(v_activity.work_title, '')) = '' then
      raise exception 'Uraian pekerjaan wajib diisi';
    end if;
    if btrim(coalesce(v_activity.work_location, '')) = '' then
      raise exception 'Lokasi pekerjaan wajib diisi';
    end if;
  end if;
  if v_as_of > public.resolve_overtime_initial_deadline(
    v_activity.contract_id,
    v_activity.up3_id,
    v_activity.overtime_date,
    v_as_of
  ) then
    select config.effective_submission_days
    into v_effective_submission_days
    from public.resolve_overtime_initial_deadline_config(
      v_activity.contract_id,
      v_activity.up3_id,
      v_as_of
    ) config;
    raise exception 'Batas pengajuan telah lewat. Batas efektif H+% untuk Lembur Pekerjaan.',
      v_effective_submission_days;
  end if;
  if (select count(*) from public.overtime_entries
      where activity_id = p_activity_id) = 0 then
    raise exception 'At least one participant is required';
  end if;
  if v_activity.work_category = 'ADMINISTRASI'
     and (select count(*) from public.overtime_entries
          where activity_id = p_activity_id) <> 1 then
    raise exception 'Administrasi requires exactly one participant';
  end if;
  if exists (
    select 1
    from public.overtime_evidence
    where activity_id = p_activity_id
      and status in ('PENDING', 'DELETE_PENDING')
  ) then
    raise exception 'Resolve pending evidence operations before submission';
  end if;

  if v_activity.work_category = 'ADMINISTRASI' then
    if (select count(*) from public.overtime_evidence
        where activity_id = p_activity_id
          and evidence_type = 'FOTO_SEBELUM'
          and status = 'ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_SEBELUM';
    end if;
    if (select count(*) from public.overtime_evidence
        where activity_id = p_activity_id
          and evidence_type = 'FOTO_SESUDAH'
          and status = 'ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_SESUDAH';
    end if;
    if exists (
      select 1
      from public.overtime_evidence
      where activity_id = p_activity_id
        and status = 'ACTIVE'
        and evidence_type not in ('FOTO_SEBELUM', 'FOTO_SESUDAH')
    ) then
      raise exception 'ACTIVE evidence contains a type not required by Administrasi';
    end if;
  else
    if (select count(*) from public.overtime_evidence
        where activity_id = p_activity_id
          and evidence_type = 'SPK'
          and status = 'ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: SPK';
    end if;
    if (select count(*) from public.overtime_evidence
        where activity_id = p_activity_id
          and evidence_type = 'FOTO_BRIEFING'
          and status = 'ACTIVE') < 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_BRIEFING';
    end if;
    if (select count(*) from public.overtime_evidence
        where activity_id = p_activity_id
          and evidence_type = 'FOTO_PROSES'
          and status = 'ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_PROSES';
    end if;
    if (select count(*) from public.overtime_evidence
        where activity_id = p_activity_id
          and evidence_type = 'FOTO_SELESAI'
          and status = 'ACTIVE') <> 1 then
      raise exception 'Required ACTIVE evidence is missing or duplicated: FOTO_SELESAI';
    end if;
    if exists (
      select 1
      from public.overtime_evidence
      where activity_id = p_activity_id
        and status = 'ACTIVE'
        and evidence_type not in (
          'SPK', 'FOTO_BRIEFING', 'FOTO_PROSES', 'FOTO_SELESAI'
        )
    ) then
      raise exception 'ACTIVE evidence contains a type not required by this work category';
    end if;
  end if;

  v_submission_number := v_activity.submission_count + 1;
  update public.overtime_activities
  set status = 'SUBMITTED',
      submitted_at = clock_timestamp(),
      submitted_by = auth.uid(),
      submission_count = v_submission_number,
      current_submission_number = v_submission_number,
      updated_by = auth.uid()
  where id = p_activity_id;
  update public.overtime_entries
  set approval_status = 'SUBMITTED',
      updated_by = auth.uid()
  where activity_id = p_activity_id
    and approval_status in ('DRAFT', 'CORRECTION_REQUIRED');
  insert into public.overtime_activity_history (
    activity_id,
    event,
    actor_user_id,
    submission_number,
    previous_status,
    new_status
  ) values (
    p_activity_id,
    'SUBMITTED',
    auth.uid(),
    v_submission_number,
    'DRAFT',
    'SUBMITTED'
  );
  return p_activity_id;
end;
$$;

-- Work list now exposes per-entry review state.
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
  entry_approval_status text,
  entry_rejection_count integer,
  entry_revision_deadline_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
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

-- Save work draft: DRAFT editing as before, plus CORRECTION_REQUIRED revision
-- editing that preserves review state of untouched participants (matched by employee).
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
  v_carry_status text;
  v_carry_rejections int;
  v_carry_deadline timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_work_category is null or p_work_category not in ('ADMINISTRASI', 'GARDU', 'JTM', 'JTR', 'ROW') then raise exception 'Work category must be ADMINISTRASI, GARDU, JTM, JTR, or ROW'; end if;
  v_desc_trim := btrim(coalesce(p_description, ''));
  if v_desc_trim = '' then raise exception 'Keterangan pekerjaan wajib diisi'; end if;
  v_title_trim := btrim(coalesce(p_work_title, ''));
  v_location_trim := btrim(coalesce(p_work_location, ''));
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
    if v_activity.status not in ('DRAFT', 'CORRECTION_REQUIRED') then raise exception 'Only DRAFT or revision work overtime can be changed'; end if;
    if v_activity.status = 'CORRECTION_REQUIRED' and v_activity.revision_deadline_at is not null and clock_timestamp() > v_activity.revision_deadline_at then
      update public.overtime_activities set status = 'CLOSED', closure_reason = 'EXPIRED', closed_at = clock_timestamp(), closed_by = auth.uid(), updated_by = auth.uid() where id = p_activity_id;
      update public.overtime_entries set approval_status = 'CLOSED', revision_deadline_at = null, updated_by = auth.uid()
      where activity_id = p_activity_id and approval_status in ('DRAFT', 'SUBMITTED', 'CORRECTION_REQUIRED');
      insert into public.overtime_activity_history(activity_id, event, actor_user_id, previous_status, new_status, reason) values (p_activity_id, 'CLOSED', auth.uid(), v_activity.status, 'CLOSED', 'Revision deadline expired');
      raise exception 'Revision deadline has expired';
    end if;
    if v_activity.type <> 'WORK' then raise exception 'The requested activity is not Lembur Pekerjaan'; end if;
    if (v_activity.contract_id, v_activity.up3_id, v_activity.unit_id) is distinct from (p_contract_id, p_up3_id, p_unit_id) then raise exception 'Overtime activity is not in the exact requested scope'; end if;
  end if;
  if not public.auth_can_mutate_overtime_work_l3(p_contract_id, p_up3_id, p_unit_id) then raise exception 'Work overtime scope is not mutable by this account' using errcode = '42501'; end if;
  v_seen := array[]::uuid[];
  v_min_started := null;
  v_max_ended := null;
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
  if p_activity_id is not null then
    -- Snapshot prior review state so revision edits keep untouched participants intact.
    create temp table tmp_overtime_entry_carry on commit drop as
      select employee_id, approval_status, rejection_count, revision_deadline_at
      from public.overtime_entries
      where activity_id = p_activity_id;
    perform 1 from public.overtime_entries where activity_id = p_activity_id for update;
    delete from public.overtime_entries where activity_id = p_activity_id;
  end if;
  if p_activity_id is null then
    insert into public.overtime_activities(contract_id, up3_id, unit_id, type, work_category, replaced_employee_id, description, work_title, work_location, started_at, ended_at, status, created_by, updated_by)
    values (p_contract_id, p_up3_id, p_unit_id, 'WORK', p_work_category, null, v_desc_trim, nullif(v_title_trim, ''), nullif(v_location_trim, ''), v_min_started, v_max_ended, 'DRAFT', auth.uid(), auth.uid())
    returning id into v_activity_id;
  else
    update public.overtime_activities
    set work_category = p_work_category, description = v_desc_trim, work_title = nullif(v_title_trim, ''), work_location = nullif(v_location_trim, ''),
        started_at = v_min_started, ended_at = v_max_ended, updated_by = auth.uid()
    where id = p_activity_id
    returning id into v_activity_id;
  end if;
  for v_idx in 0..v_count - 1 loop
    v_part := p_participants -> v_idx;
    v_employee_id := (v_part ->> 'employee_id')::uuid;
    v_started := (v_part ->> 'started_at')::timestamptz;
    v_ended := (v_part ->> 'ended_at')::timestamptz;
    v_business_date := (v_started at time zone 'Asia/Pontianak')::date;
    v_period_month := date_trunc('month', v_started at time zone 'Asia/Pontianak')::date;
    select upper(e.name) into v_name from public.employees e where e.id = v_employee_id;
    select r.hourly_rate into v_rate from public.employee_hourly_rate_history r where r.employee_id = v_employee_id and r.effective_from <= v_business_date and (r.effective_to is null or v_business_date < r.effective_to) order by r.effective_from desc limit 1;
    if v_rate is null then raise exception 'Hourly rate not found for participant start date'; end if;
    v_actual_minutes := extract(epoch from (v_ended - v_started)) / 60;
    v_duration := round(v_actual_minutes / 60, 4);
    v_multiplier := round(case when v_actual_minutes <= 60 then v_actual_minutes * 1.5 / 60 else 1.5 + ((v_actual_minutes - 60) * 2 / 60) end, 4);
    v_carry_status := 'DRAFT';
    v_carry_rejections := 0;
    v_carry_deadline := null;
    if p_activity_id is not null then
      select c.approval_status, c.rejection_count, c.revision_deadline_at
      into v_carry_status, v_carry_rejections, v_carry_deadline
      from tmp_overtime_entry_carry c
      where c.employee_id = v_employee_id
      limit 1;
      if not found then
        v_carry_status := 'DRAFT';
        v_carry_rejections := 0;
        v_carry_deadline := null;
      end if;
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
$$;

revoke all on function public.refresh_overtime_activity_review_status(uuid) from public, anon, authenticated;
revoke all on function public.approve_overtime_entry_l5(uuid) from public, anon, authenticated;
revoke all on function public.reject_overtime_entry_l5(uuid, text) from public, anon, authenticated;
revoke all on function public.approve_overtime_l5(uuid) from public, anon, authenticated;
revoke all on function public.reject_overtime_l5(uuid, text) from public, anon, authenticated;
revoke all on function public.resubmit_overtime_l5(uuid) from public, anon, authenticated;
revoke all on function public.submit_overtime_work_l3(uuid) from public, anon, authenticated;
revoke all on function public.list_overtime_work_l3(uuid, uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.save_overtime_work_draft_l3(uuid, uuid, uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.refresh_overtime_activity_review_status(uuid) to authenticated;
grant execute on function public.approve_overtime_entry_l5(uuid) to authenticated;
grant execute on function public.reject_overtime_entry_l5(uuid, text) to authenticated;
grant execute on function public.approve_overtime_l5(uuid) to authenticated;
grant execute on function public.reject_overtime_l5(uuid, text) to authenticated;
grant execute on function public.resubmit_overtime_l5(uuid) to authenticated;
grant execute on function public.submit_overtime_work_l3(uuid) to authenticated;
grant execute on function public.list_overtime_work_l3(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.save_overtime_work_draft_l3(uuid, uuid, uuid, uuid, text, text, text, text, jsonb) to authenticated;

comment on function public.approve_overtime_entry_l5(uuid)
  is 'Approves a single work overtime participant; the activity flips to APPROVED once every entry is approved.';
comment on function public.reject_overtime_entry_l5(uuid, text)
  is 'Rejects a single work overtime participant with a per-participant 3-strike revision cycle.';
comment on function public.refresh_overtime_activity_review_status(uuid)
  is 'Derives overtime activity review status from its participant entries.';
