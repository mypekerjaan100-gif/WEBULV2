-- AUTH-F4B: Return payment fields only for employees visible to the caller.
-- Direct bank/account_number column grants remain unchanged.

create or replace function public.employee_sensitive_fields()
returns table (
  employee_id uuid,
  bank text,
  account_number text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authorized to read sensitive employee fields'
      using errcode = '42501';
  end if;

  if public.auth_is_super_admin() then
    return query
      select e.id, e.bank, e.account_number
      from public.employees e
      order by e.id;
    return;
  end if;

  return query
    select e.id, e.bank, e.account_number
    from public.employees e
    where public.auth_can_read_employee(e.id)
    order by e.id;
end;
$$;
