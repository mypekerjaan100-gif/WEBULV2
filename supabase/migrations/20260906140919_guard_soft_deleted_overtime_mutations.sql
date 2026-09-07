create or replace function public.guard_soft_deleted_overtime_activity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.deleted_at is not null then
    raise exception 'Overtime activity is not available';
  end if;
  if (new.deleted_at, new.deleted_by, new.delete_reason)
       is distinct from (old.deleted_at, old.deleted_by, old.delete_reason)
     and not public.auth_is_super_admin() then
    raise exception 'Only SUPER_ADMIN may delete overtime data' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_guard_soft_deleted_overtime_activity
before update on public.overtime_activities
for each row execute function public.guard_soft_deleted_overtime_activity();
