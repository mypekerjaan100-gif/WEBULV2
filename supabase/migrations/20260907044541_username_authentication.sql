create table public.auth_usernames (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_normalized text generated always as (lower(btrim(username))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  constraint auth_usernames_username_format_check check (
    username = btrim(username)
    and char_length(username) between 3 and 64
    and username ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  ),
  constraint auth_usernames_normalized_unique unique (username_normalized)
);

create trigger trg_auth_usernames_touch
before update on public.auth_usernames
for each row execute function public.touch_audit_columns();

alter table public.auth_usernames enable row level security;
revoke all on table public.auth_usernames from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_usernames to service_role;

-- Preserve every Auth UUID and attach a deterministic username to existing users.
with raw_candidates as (
  select
    users.id,
    ltrim(regexp_replace(lower(split_part(coalesce(users.email, ''), '@', 1)), '[^a-z0-9._-]+', '_', 'g'), '._-') as raw_username
  from auth.users users
), candidates as (
  select
    id,
    case
      when char_length(raw_username) >= 3 then left(raw_username, 32)
      else 'user_' || left(replace(id::text, '-', ''), 12)
    end as base_username
  from raw_candidates
), ranked as (
  select
    id,
    base_username,
    row_number() over (partition by base_username order by id) as duplicate_number
  from candidates
)
insert into public.auth_usernames(user_id, username)
select
  id,
  case
    when duplicate_number = 1 then base_username
    else 'user_' || replace(id::text, '-', '')
  end
from ranked
on conflict (user_id) do nothing;

-- Administration is only reachable through the authenticated Edge Function.
revoke all on function public.admin_set_user_access(uuid,text,uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_delete_user_access(uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_revoke_user_access(uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_deactivate_user(uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_replace_contract_access(uuid,uuid,text,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_replace_organization_access(uuid,uuid,text,uuid) from public, anon, authenticated;

grant execute on function public.admin_set_user_access(uuid,text,uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.admin_delete_user_access(uuid,uuid) to service_role;
grant execute on function public.admin_revoke_user_access(uuid,uuid) to service_role;
grant execute on function public.admin_deactivate_user(uuid,uuid) to service_role;
grant execute on function public.admin_replace_contract_access(uuid,uuid,text,uuid,uuid,uuid) to service_role;
grant execute on function public.admin_replace_organization_access(uuid,uuid,text,uuid) to service_role;
