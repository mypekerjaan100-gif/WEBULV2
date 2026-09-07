alter table public.auth_usernames
  drop constraint auth_usernames_username_format_check;

alter table public.auth_usernames
  add constraint auth_usernames_username_format_check check (
    username = btrim(username)
    and char_length(username) between 3 and 64
    and username ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  );

create table public.username_auth_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index idx_username_auth_rate_limits_updated_at
  on public.username_auth_rate_limits(updated_at);

alter table public.username_auth_rate_limits enable row level security;
revoke all on table public.username_auth_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.username_auth_rate_limits to service_role;

create or replace function public.consume_username_auth_rate_limit(
  p_rate_key text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_block_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.username_auth_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
begin
  if nullif(p_rate_key, '') is null or p_max_attempts < 1 or p_window_seconds < 1 or p_block_seconds < 1 then
    raise exception 'Invalid rate limit configuration';
  end if;

  delete from public.username_auth_rate_limits where updated_at < v_now - interval '1 day';
  perform pg_advisory_xact_lock(hashtextextended(p_rate_key, 0));
  select * into v_row from public.username_auth_rate_limits where rate_key = p_rate_key for update;

  if not found then
    insert into public.username_auth_rate_limits(rate_key, attempts, window_started_at, updated_at)
    values (p_rate_key, 1, v_now, v_now);
    return true;
  end if;
  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return false;
  end if;
  if v_row.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    update public.username_auth_rate_limits
      set attempts = 1, window_started_at = v_now, blocked_until = null, updated_at = v_now
      where rate_key = p_rate_key;
    return true;
  end if;

  v_attempts := v_row.attempts + 1;
  update public.username_auth_rate_limits
    set attempts = v_attempts,
        blocked_until = case when v_attempts > p_max_attempts then v_now + make_interval(secs => p_block_seconds) else null end,
        updated_at = v_now
    where rate_key = p_rate_key;
  return v_attempts <= p_max_attempts;
end;
$$;

revoke all on function public.consume_username_auth_rate_limit(text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_username_auth_rate_limit(text,integer,integer,integer) to service_role;
