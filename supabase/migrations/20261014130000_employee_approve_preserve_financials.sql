-- Approve pengajuan Admin ULP tidak boleh menghapus bank/rekening/tarif valid
-- dengan nilai kosong (mis. edit foto/tgl lahir yang tidak menyentuh finansial).

create or replace function public.approve_employee_change_request(p_request_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to public, pg_temp
as $function$
declare r record; v_emp uuid; v_pid uuid;
  v_snapshot jsonb; v_live_bank text; v_live_acct text; v_live_rate numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into r from public.employee_change_requests where id=p_request_id for update;
  if not found then raise exception 'Request tidak ditemukan' using errcode='22023'; end if;
  if r.status <> 'Pending' then raise exception 'Request sudah diputuskan' using errcode='22023'; end if;
  if not public.auth_can_manage_employee_scope(r.contract_id, r.up3_id) then raise exception 'Hanya Admin UP3/Super Admin yang boleh approve' using errcode='42501'; end if;
  v_snapshot := r.proposed_snapshot;
  -- Pengajuan Admin ULP yang tidak melihat/mengubah data finansial tidak boleh
  -- menghapus bank/rekening/tarif valid dengan nilai kosong (mis. edit foto/tgl lahir).
  if r.request_type = 'edit' and r.employee_id is not null and coalesce(r.created_by_actor,'') = 'Admin ULP' then
    select e.bank, e.account_number into v_live_bank, v_live_acct
    from public.employees e where e.id = r.employee_id;
    select h.hourly_rate into v_live_rate
    from public.employee_hourly_rate_history h
    where h.employee_id = r.employee_id and h.effective_to is null
    order by h.effective_from desc limit 1;
    if coalesce(nullif(btrim(coalesce(v_snapshot->>'bank','')),''),'') = '' and coalesce(v_live_bank,'') <> '' then
      v_snapshot := jsonb_set(v_snapshot, '{bank}', to_jsonb(v_live_bank));
    end if;
    if coalesce(nullif(btrim(coalesce(v_snapshot->>'account_number','')),''),'') = '' and coalesce(v_live_acct,'') <> '' then
      v_snapshot := jsonb_set(v_snapshot, '{account_number}', to_jsonb(v_live_acct));
    end if;
    if coalesce(nullif(v_snapshot->>'hourly_rate','')::numeric, 0) = 0 and coalesce(v_live_rate, 0) <> 0 then
      v_snapshot := jsonb_set(v_snapshot, '{hourly_rate}', to_jsonb(v_live_rate));
    end if;
  end if;
  v_emp := private.apply_employee_snapshot(case when r.request_type='add' then null else r.employee_id end, r.contract_id, r.up3_id, v_snapshot, current_date);
  select id into v_pid from public.employee_photos
  where change_request_id = p_request_id and status='STAGED'
  order by created_at desc limit 1;
  if found then
    update public.employee_photos set status='SUPERSEDED'
    where employee_id = v_emp and status='ACTIVE' and id <> v_pid;
    update public.employee_photos set employee_id=v_emp, status='ACTIVE', uploaded_at=now()
    where id=v_pid;
    update public.employee_photos set status='ABANDONED'
    where change_request_id = p_request_id and status='STAGED' and id <> v_pid;
  else
    update public.employee_photos set contract_id=r.contract_id, up3_id=r.up3_id,
      unit_id=coalesce(r.target_unit_id, (select unit_id from public.employee_unit_history where employee_id=v_emp and effective_to is null limit 1))
    where employee_id=v_emp and status='ACTIVE';
  end if;
  update public.employee_change_requests set status='Approved', employee_id=coalesce(r.employee_id, v_emp), decided_by='Admin UP3', decided_at=current_date, updated_by=auth.uid(), updated_at=now() where id=p_request_id;
  return v_emp;
end;
$function$;
