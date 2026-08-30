-- Fix single-role trigger to respect canonical active semantics: status ACTIVE + effective dates
create or replace function public.enforce_single_active_access()
 returns trigger
 language plpgsql
as $function$
declare
  v_count int;
begin
  if new.status is distinct from 'ACTIVE' then
    return new;
  end if;
  if new.effective_from is not null and new.effective_from > current_date then
    return new;
  end if;
  if new.effective_to is not null and new.effective_to <= current_date then
    return new;
  end if;

  if tg_table_name = 'contract_memberships' then
    select
      (select count(*) from public.contract_memberships where user_id = new.user_id and status='ACTIVE' and id <> new.id and effective_from <= current_date and (effective_to is null or effective_to > current_date))
    + (select count(*) from public.organization_memberships where user_id = new.user_id and status='ACTIVE' and effective_from <= current_date and (effective_to is null or effective_to > current_date))
    + (select count(*) from public.system_role_memberships where user_id = new.user_id and status='ACTIVE' and effective_from <= current_date and (effective_to is null or effective_to > current_date))
    into v_count;
  elsif tg_table_name = 'organization_memberships' then
    select
      (select count(*) from public.contract_memberships where user_id = new.user_id and status='ACTIVE' and effective_from <= current_date and (effective_to is null or effective_to > current_date))
    + (select count(*) from public.organization_memberships where user_id = new.user_id and status='ACTIVE' and id <> new.id and effective_from <= current_date and (effective_to is null or effective_to > current_date))
    + (select count(*) from public.system_role_memberships where user_id = new.user_id and status='ACTIVE' and effective_from <= current_date and (effective_to is null or effective_to > current_date))
    into v_count;
  elsif tg_table_name = 'system_role_memberships' then
    select
      (select count(*) from public.contract_memberships where user_id = new.user_id and status='ACTIVE' and effective_from <= current_date and (effective_to is null or effective_to > current_date))
    + (select count(*) from public.organization_memberships where user_id = new.user_id and status='ACTIVE' and effective_from <= current_date and (effective_to is null or effective_to > current_date))
    + (select count(*) from public.system_role_memberships where user_id = new.user_id and status='ACTIVE' and id <> new.id and effective_from <= current_date and (effective_to is null or effective_to > current_date))
    into v_count;
  else
    v_count := 0;
  end if;

  if v_count > 0 then
    raise exception 'single-role violation: user already has an active role' using errcode='23514';
  end if;
  return new;
end;
$function$;

comment on function public.enforce_single_active_access() is 'Enforces 1 ACTIVE role per user respecting effective dates';
