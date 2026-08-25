-- Restore Variable submit/approve/reject RPCs that were missing due to earlier grant failure
create or replace function public.submit_variable_cost_entry(p_entry_id uuid)
returns public.variable_cost_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.variable_cost_entries%rowtype;
begin
  select * into v_row from public.variable_cost_entries where id=p_entry_id for update;
  if not found then raise exception 'entry not found'; end if;
  if not public.auth_can_access_variable_scope(v_row.contract_id, v_row.up3_id, v_row.unit_id) then raise exception 'access denied'; end if;
  if v_row.status not in ('DRAFT','REJECTED') then raise exception 'only DRAFT/REJECTED can be submitted'; end if;
  if not exists (select 1 from public.variable_cost_evidence where variable_cost_entry_id=p_entry_id) then raise exception 'minimum 1 evidence required on submit'; end if;
  update public.variable_cost_entries set status='SUBMITTED', submitted_at=now(), submitted_by=auth.uid(), rejected_at=null, rejected_by=null, rejection_reason=null, updated_by=auth.uid() where id=p_entry_id returning * into v_row;
  insert into public.variable_cost_status_history (variable_cost_entry_id, from_status, to_status, changed_by) values (p_entry_id, 'DRAFT', 'SUBMITTED', auth.uid());
  return v_row;
end;
$$;
create or replace function public.approve_variable_cost_entry(p_entry_id uuid)
returns public.variable_cost_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.variable_cost_entries%rowtype;
begin
  select * into v_row from public.variable_cost_entries where id=p_entry_id for update;
  if not found then raise exception 'entry not found'; end if;
  if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=v_row.contract_id and cm.operational_up3_id=v_row.up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then
    raise exception 'only ADMIN_UP3 can approve';
  end if;
  if v_row.status <> 'SUBMITTED' then raise exception 'only SUBMITTED can be approved'; end if;
  update public.variable_cost_entries set status='APPROVED', approved_at=now(), approved_by=auth.uid(), updated_by=auth.uid() where id=p_entry_id returning * into v_row;
  insert into public.variable_cost_status_history (variable_cost_entry_id, from_status, to_status, changed_by) values (p_entry_id, 'SUBMITTED', 'APPROVED', auth.uid());
  perform public.sync_variable_cost_month(v_row.contract_id, v_row.up3_id, v_row.unit_id, v_row.sla_version_id, v_row.indicator_id, date_trunc('month', v_row.work_date)::date);
  return v_row;
end;
$$;
create or replace function public.reject_variable_cost_entry(p_entry_id uuid, p_reason text)
returns public.variable_cost_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.variable_cost_entries%rowtype;
begin
  if p_reason is null or btrim(p_reason)='' then raise exception 'rejection_reason required'; end if;
  select * into v_row from public.variable_cost_entries where id=p_entry_id for update;
  if not found then raise exception 'entry not found'; end if;
  if not (public.auth_is_super_admin() or exists (select 1 from public.contract_memberships cm where cm.user_id=auth.uid() and cm.contract_role='ADMIN_UP3' and cm.contract_id=v_row.contract_id and cm.operational_up3_id=v_row.up3_id and cm.status='ACTIVE' and cm.effective_from <= current_date and (cm.effective_to is null or current_date < cm.effective_to))) then
    raise exception 'only ADMIN_UP3 can reject';
  end if;
  if v_row.status <> 'SUBMITTED' then raise exception 'only SUBMITTED can be rejected'; end if;
  update public.variable_cost_entries set status='REJECTED', rejected_at=now(), rejected_by=auth.uid(), rejection_reason=btrim(p_reason), updated_by=auth.uid() where id=p_entry_id returning * into v_row;
  insert into public.variable_cost_status_history (variable_cost_entry_id, from_status, to_status, changed_by, reason) values (p_entry_id, 'SUBMITTED', 'REJECTED', auth.uid(), btrim(p_reason));
  return v_row;
end;
$$;
grant execute on function public.submit_variable_cost_entry(uuid) to authenticated;
grant execute on function public.approve_variable_cost_entry(uuid) to authenticated;
grant execute on function public.reject_variable_cost_entry(uuid, text) to authenticated;
notify pgrst, 'reload schema';
