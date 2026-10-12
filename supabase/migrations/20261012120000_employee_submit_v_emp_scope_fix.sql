-- Fix out-of-scope v_emp reference in submit_employee_change_request.
-- The previous version declared v_emp inside a nested block, then used it
-- after that block ended. PostgreSQL therefore treated v_emp as a missing
-- column (42703: column "v_emp" does not exist) for Admin UP3/Super Admin
-- auto-apply edits/adds. Move the declaration to the function scope.

create or replace function public.submit_employee_change_request(p_request_type text, p_employee_id uuid, p_contract_id uuid, p_up3_id uuid, p_source_unit_id uuid, p_target_unit_id uuid, p_proposed jsonb, p_old_snapshot jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid; v_is_manager boolean; v_target uuid; v_emp uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_request_type not in ('add','edit') then raise exception 'Tipe request tidak valid' using errcode='22023'; end if;
  if p_request_type='edit' and p_employee_id is null then raise exception 'Edit membutuhkan employee_id' using errcode='22023'; end if;
  if p_request_type='add' and p_employee_id is not null then raise exception 'Add tidak boleh punya employee_id' using errcode='22023'; end if;
  v_target := coalesce(p_target_unit_id, nullif(p_proposed->>'unit_id','')::uuid);
  if v_target is null then raise exception 'Unit target wajib diisi' using errcode='22023'; end if;
  if not public.auth_can_submit_employee_scope(p_contract_id, p_up3_id, v_target) then raise exception 'Tidak berhak mengajukan untuk unit ini' using errcode='42501'; end if;
  -- ULP cannot transfer across units: for edit, source must equal own scope already enforced by target check + verify employee currently in target unit for ULP actor
  if not public.auth_is_super_admin() and exists (select 1 from public.contract_memberships where user_id=auth.uid() and contract_role='ADMIN_ULP' and status='ACTIVE') then
    if p_request_type='edit' then
      if not exists (select 1 from public.employee_unit_history where employee_id=p_employee_id and effective_to is null and unit_id=v_target and contract_id=p_contract_id and up3_id=p_up3_id) then
        raise exception 'Admin ULP hanya boleh mengajukan unit sendiri; transfer antar-ULP oleh Admin UP3' using errcode='42501';
      end if;
      if p_source_unit_id is distinct from v_target then raise exception 'Admin ULP tidak boleh pindah unit' using errcode='42501'; end if;
    end if;
  end if;
  v_is_manager := public.auth_can_manage_employee_scope(p_contract_id, p_up3_id);
  if v_is_manager then
    -- auto-apply immediately + record Approved
    begin
      v_emp := private.apply_employee_snapshot(case when p_request_type='add' then null else p_employee_id end, p_contract_id, p_up3_id, p_proposed, current_date);
    exception when others then raise; end;
    insert into public.employee_change_requests (employee_id, contract_id, up3_id, request_type, source_unit_id, target_unit_id, old_snapshot, proposed_snapshot, status, created_by_actor, decided_by, decided_at, created_by, updated_by)
    values (case when p_request_type='add' then v_emp else p_employee_id end, p_contract_id, p_up3_id, p_request_type, p_source_unit_id, v_target, p_old_snapshot, p_proposed, 'Approved', 'Admin UP3', 'Admin UP3', current_date, auth.uid(), auth.uid())
    returning id into v_id;
  else
    insert into public.employee_change_requests (employee_id, contract_id, up3_id, request_type, source_unit_id, target_unit_id, old_snapshot, proposed_snapshot, status, created_by_actor, created_by)
    values (p_employee_id, p_contract_id, p_up3_id, p_request_type, p_source_unit_id, v_target, p_old_snapshot, p_proposed, 'Pending', 'Admin ULP', auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end;
$function$;

revoke all on function public.submit_employee_change_request(text, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.submit_employee_change_request(text, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb) to authenticated;

comment on function public.submit_employee_change_request(text, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb)
  is 'Employee add/edit request; Admin UP3/Super Admin auto-applies via private.apply_employee_snapshot, Admin ULP creates Pending.';
