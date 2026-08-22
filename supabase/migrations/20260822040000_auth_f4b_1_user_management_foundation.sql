-- AUTH-F4B-1: User management lifecycle, audit, and authorization boundary.

-- Normalize profile lifecycle values without changing the existing user identity.
alter table public.profiles drop constraint profiles_status_check;
update public.profiles
set status = case status
  when 'active' then 'ACTIVE'
  when 'inactive' then 'DISABLED'
  else upper(status)
end;
alter table public.profiles alter column status set default 'INVITED';
alter table public.profiles
  add constraint profiles_status_check
  check (status in ('INVITED', 'ACTIVE', 'DISABLED'));

-- Invitation metadata never stores an Auth token or password.
create table public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED')),
  requested_access jsonb not null default '{}'::jsonb,
  invited_by uuid not null references auth.users(id),
  invited_at timestamptz not null default now(),
  expires_at timestamptz,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  constraint user_invitations_email_normalized
    check (email = lower(btrim(email))),
  constraint user_invitations_display_name_required
    check (nullif(btrim(display_name), '') is not null),
  constraint user_invitations_state_dates
    check (
      (status <> 'ACCEPTED' or accepted_at is not null)
      and (status <> 'CANCELLED' or cancelled_at is not null)
    )
);

create unique index uq_user_invitations_pending_email
  on public.user_invitations (lower(email))
  where status = 'PENDING';
create index idx_user_invitations_target
  on public.user_invitations (target_user_id, status)
  where target_user_id is not null;
create index idx_user_invitations_status_time
  on public.user_invitations (status, invited_at desc);

create trigger trg_user_invitations_touch
  before update on public.user_invitations
  for each row execute function public.touch_audit_columns();

alter table public.user_invitations enable row level security;
revoke all on table public.user_invitations from anon, authenticated;

-- Extend the existing append-only authorization audit stream.
alter table public.authorization_audit_events
  drop constraint authorization_audit_events_event_type_check;
alter table public.authorization_audit_events
  add constraint authorization_audit_events_event_type_check
  check (event_type in (
    'SYSTEM_ROLE_ASSIGNED',
    'SYSTEM_ROLE_REVOKED',
    'OVERRIDE_USED',
    'VIEW_AS_STARTED',
    'VIEW_AS_ENDED',
    'USER_INVITED',
    'USER_ACTIVATED',
    'USER_DISABLED',
    'USER_ENABLED',
    'ROLE_ASSIGNED',
    'ROLE_REVOKED',
    'MEMBERSHIP_ADDED',
    'MEMBERSHIP_REMOVED',
    'SUPER_ADMIN_ASSIGNED',
    'SUPER_ADMIN_REVOKED'
  ));

alter table public.authorization_audit_events
  add column request_id uuid,
  add column before_state jsonb,
  add column after_state jsonb;

alter table public.authorization_audit_events
  add constraint authorization_audit_super_admin_reason
  check (
    event_type not in ('SUPER_ADMIN_ASSIGNED', 'SUPER_ADMIN_REVOKED')
    or nullif(btrim(reason), '') is not null
  );

create index idx_authorization_audit_request
  on public.authorization_audit_events (request_id)
  where request_id is not null;

create or replace function public.reject_authorization_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'authorization_audit_events is append-only' using errcode = '42501';
end;
$$;

create trigger trg_authorization_audit_append_only
  before update or delete on public.authorization_audit_events
  for each row execute function public.reject_authorization_audit_mutation();

revoke execute on function public.reject_authorization_audit_mutation()
  from public, anon, authenticated;

-- Private authorization kernel. It is not exposed through PostgREST.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.user_is_active_super_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.system_role_memberships membership
      on membership.user_id = profile.id
    join public.authorization_roles role
      on role.id = membership.role_id
    where profile.id = p_user_id
      and profile.status = 'ACTIVE'
      and membership.status = 'ACTIVE'
      and membership.effective_from <= current_date
      and (membership.effective_to is null or membership.effective_to > current_date)
      and role.role_namespace = 'SYSTEM'
      and role.code = 'SUPER_ADMIN'
  )
$$;

create or replace function private.active_super_admin_count(p_exclude_user_id uuid default null)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct profile.id)
  from public.profiles profile
  join public.system_role_memberships membership
    on membership.user_id = profile.id
  join public.authorization_roles role
    on role.id = membership.role_id
  where profile.status = 'ACTIVE'
    and membership.status = 'ACTIVE'
    and membership.effective_from <= current_date
    and (membership.effective_to is null or membership.effective_to > current_date)
    and role.role_namespace = 'SYSTEM'
    and role.code = 'SUPER_ADMIN'
    and (p_exclude_user_id is null or profile.id <> p_exclude_user_id)
$$;

create or replace function private.assert_user_management_actor(p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not private.user_is_active_super_admin(v_actor) then
    raise exception 'Active SUPER_ADMIN required' using errcode = '42501';
  end if;
  if not public.auth_has_permission(p_permission) then
    raise exception 'Missing permission: %', p_permission using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function private.append_authorization_audit(
  p_event_type text,
  p_actor_user_id uuid,
  p_target_user_id uuid default null,
  p_target_role_id uuid default null,
  p_reason text default null,
  p_request_id uuid default null,
  p_before_state jsonb default null,
  p_after_state jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.authorization_audit_events (
    event_type,
    actor_user_id,
    target_user_id,
    target_role_id,
    reason,
    request_id,
    before_state,
    after_state,
    metadata
  ) values (
    p_event_type,
    p_actor_user_id,
    p_target_user_id,
    p_target_role_id,
    nullif(btrim(p_reason), ''),
    p_request_id,
    p_before_state,
    p_after_state,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- Last-SUPER_ADMIN protection applies even to privileged server-side writes.
create or replace function public.protect_last_super_admin_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_was_active boolean;
  v_will_be_active boolean := false;
begin
  v_was_active := private.user_is_active_super_admin(old.user_id);
  if tg_op = 'UPDATE' then
    v_will_be_active :=
      new.status = 'ACTIVE'
      and new.effective_from <= current_date
      and (new.effective_to is null or new.effective_to > current_date);
  end if;
  if v_was_active and not v_will_be_active
     and private.active_super_admin_count(old.user_id) = 0 then
    raise exception 'Cannot revoke the last active SUPER_ADMIN' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger trg_protect_last_super_admin_membership
  before update or delete on public.system_role_memberships
  for each row execute function public.protect_last_super_admin_membership();

create or replace function public.protect_last_super_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_was_active_super_admin boolean;
begin
  v_was_active_super_admin := private.user_is_active_super_admin(old.id);
  if v_was_active_super_admin
     and (tg_op = 'DELETE' or new.status <> 'ACTIVE')
     and private.active_super_admin_count(old.id) = 0 then
    raise exception 'Cannot disable the last active SUPER_ADMIN' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger trg_protect_last_super_admin_profile
  before update or delete on public.profiles
  for each row execute function public.protect_last_super_admin_profile();

revoke execute on function public.protect_last_super_admin_membership()
  from public, anon, authenticated;
revoke execute on function public.protect_last_super_admin_profile()
  from public, anon, authenticated;

-- Public RPCs expose only the caller's authority context and operation authorization.
create or replace function public.user_management_actor_context()
returns table (
  actor_user_id uuid,
  account_status text,
  is_super_admin boolean,
  capabilities text[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := private.assert_user_management_actor('user.read');
  return query
    select
      v_actor,
      'ACTIVE'::text,
      true,
      array[
        'LIST_USERS',
        'INVITE_USER',
        'ASSIGN_MEMBERSHIP',
        'REVOKE_MEMBERSHIP',
        'ASSIGN_ROLE',
        'REVOKE_ROLE',
        'DISABLE_USER',
        'ENABLE_USER'
      ]::text[];
end;
$$;

create or replace function public.user_management_authorize_operation(
  p_operation text,
  p_target_user_id uuid default null,
  p_target_role_code text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_permission text;
  v_operation text := upper(btrim(p_operation));
  v_role_code text := upper(nullif(btrim(p_target_role_code), ''));
begin
  v_permission := case v_operation
    when 'LIST_USERS' then 'user.read'
    when 'INVITE_USER' then 'user.invite'
    when 'ASSIGN_MEMBERSHIP' then 'user.manage_membership'
    when 'REVOKE_MEMBERSHIP' then 'user.manage_membership'
    when 'ASSIGN_ROLE' then 'user.assign_role'
    when 'REVOKE_ROLE' then 'user.assign_role'
    when 'DISABLE_USER' then 'user.disable'
    when 'ENABLE_USER' then 'user.disable'
    else null
  end;
  if v_permission is null then
    raise exception 'Unsupported user-management operation' using errcode = '22023';
  end if;

  v_actor := private.assert_user_management_actor(v_permission);

  if p_target_user_id = v_actor
     and v_operation in (
       'ASSIGN_MEMBERSHIP', 'REVOKE_MEMBERSHIP',
       'ASSIGN_ROLE', 'REVOKE_ROLE', 'DISABLE_USER'
     ) then
    raise exception 'Self privilege or lifecycle mutation is not allowed'
      using errcode = '42501';
  end if;

  if v_role_code = 'SUPER_ADMIN'
     and v_operation in ('ASSIGN_ROLE', 'REVOKE_ROLE')
     and nullif(btrim(p_reason), '') is null then
    raise exception 'SUPER_ADMIN assignment or revoke requires a reason'
      using errcode = '22023';
  end if;

  if v_operation = 'REVOKE_ROLE'
     and v_role_code = 'SUPER_ADMIN'
     and p_target_user_id is not null
     and private.user_is_active_super_admin(p_target_user_id)
     and private.active_super_admin_count(p_target_user_id) = 0 then
    raise exception 'Cannot revoke the last active SUPER_ADMIN' using errcode = '23514';
  end if;

  if v_operation = 'DISABLE_USER'
     and p_target_user_id is not null
     and private.user_is_active_super_admin(p_target_user_id)
     and private.active_super_admin_count(p_target_user_id) = 0 then
    raise exception 'Cannot disable the last active SUPER_ADMIN' using errcode = '23514';
  end if;

  return jsonb_build_object(
    'authorized', true,
    'actorUserId', v_actor,
    'operation', v_operation,
    'authority', 'SUPER_ADMIN',
    'scope', 'ALL'
  );
end;
$$;

revoke all on function public.user_management_actor_context() from public, anon;
revoke all on function public.user_management_authorize_operation(text, uuid, text, text)
  from public, anon;
grant execute on function public.user_management_actor_context() to authenticated;
grant execute on function public.user_management_authorize_operation(text, uuid, text, text)
  to authenticated;
