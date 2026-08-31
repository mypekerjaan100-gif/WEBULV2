-- Preserve the exact selected Harga Satuan effective date for work-date pricing.
alter table public.variable_unit_prices drop constraint if exists variable_unit_price_effective_start;

create or replace function public.set_variable_unit_price(
  p_contract_id uuid,p_up3_id uuid,p_indicator_id uuid,p_effective_from date,p_unit_price numeric
) returns public.variable_unit_prices
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_existing public.variable_unit_prices%rowtype;v_result public.variable_unit_prices%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_effective_from is null then raise exception 'effective_from is required'; end if;
  if p_unit_price is null or p_unit_price<0 then raise exception 'unit_price must be >=0'; end if;
  if not exists(select 1 from public.organization_units where parent_id=p_up3_id and type='ULP' and own_status='Aktif') then raise exception 'UP3 has no active ULP'; end if;
  if not public.auth_can_manage_pelayanan_teknik_scope(p_contract_id,p_up3_id,(select id from public.organization_units where parent_id=p_up3_id and type='ULP' and own_status='Aktif' limit 1)) then raise exception 'Not authorized to manage Harga Satuan in this scope' using errcode='42501'; end if;
  if not public.is_priced_variable_indicator(p_contract_id,p_up3_id,p_indicator_id) then raise exception 'Indicator is not eligible for Harga Satuan: %',p_indicator_id; end if;
  if not exists(select 1 from public.contracts where id=p_contract_id and status='active') then raise exception 'Invalid contract'; end if;
  if not exists(select 1 from public.organization_units where id=p_up3_id and type='UP3' and own_status='Aktif') then raise exception 'Invalid UP3'; end if;
  if not exists(select 1 from public.contract_up3_scopes where contract_id=p_contract_id and up3_id=p_up3_id and status='Aktif') then raise exception 'Contract not scoped to UP3'; end if;
  select * into v_existing from public.variable_unit_prices where contract_id=p_contract_id and operational_up3_id=p_up3_id and indicator_id=p_indicator_id and effective_from=p_effective_from for update;
  if found then
    if v_existing.unit_price=p_unit_price then return v_existing; end if;
    update public.variable_unit_prices set unit_price=p_unit_price,updated_by=auth.uid() where id=v_existing.id returning * into v_result;
  else
    insert into public.variable_unit_prices(contract_id,operational_up3_id,indicator_id,unit_price,effective_from,created_by,updated_by)
    values(p_contract_id,p_up3_id,p_indicator_id,p_unit_price,p_effective_from,auth.uid(),auth.uid()) returning * into v_result;
  end if;
  return v_result;
end;
$function$;

revoke all on function public.set_variable_unit_price(uuid,uuid,uuid,date,numeric) from public,anon;
grant execute on function public.set_variable_unit_price(uuid,uuid,uuid,date,numeric) to authenticated;
notify pgrst,'reload schema';
