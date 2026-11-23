-- Rotasi API key AI: beberapa key per penyedia dengan key utama dan cadangan.
-- Nilai key tetap hanya tersimpan di Vault dan tidak pernah dikirim ke browser.
create table if not exists ai_private.api_keys (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gemini','deepseek','grok')),
  secret_id uuid not null,
  hint text not null,
  label text not null default '',
  position integer not null default 0,
  enabled boolean not null default true,
  status text not null default 'active' check (status in ('active','cooldown','invalid')),
  cooldown_until timestamptz,
  last_error text,
  last_used_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists ai_api_keys_provider_order on ai_private.api_keys(provider, position, created_at);
alter table ai_private.api_keys enable row level security;
revoke all on ai_private.api_keys from public, anon, authenticated;

-- Pindahkan key lama (satu per penyedia) menjadi key utama tanpa menyalin rahasianya.
insert into ai_private.api_keys(provider, secret_id, hint, label, position, enabled, created_by)
select s.provider, s.api_key_secret_id, coalesce(s.api_key_hint, '••••'), 'Utama', 0, true, s.updated_by
from ai_private.settings s
where s.api_key_secret_id is not null
  and not exists (select 1 from ai_private.api_keys k where k.secret_id = s.api_key_secret_id);

create or replace function public.ai_get_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  s ai_private.settings;
  v_keys jsonb;
begin
  if not public.auth_is_super_admin() then
    raise exception 'Hanya Super Admin yang dapat membuka pengaturan AI.' using errcode='42501';
  end if;
  select * into s from ai_private.settings where id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', k.id,
    'hint', k.hint,
    'label', k.label,
    'position', k.position,
    'enabled', k.enabled,
    'status', case when k.status = 'cooldown' and (k.cooldown_until is null or k.cooldown_until <= now()) then 'active' else k.status end,
    'cooldown_until', k.cooldown_until,
    'last_error', k.last_error,
    'last_used_at', k.last_used_at,
    'last_success_at', k.last_success_at,
    'created_at', k.created_at
  ) order by k.position, k.created_at), '[]'::jsonb)
  into v_keys
  from ai_private.api_keys k
  where k.provider = s.provider;
  return jsonb_build_object(
    'provider', s.provider,
    'model', s.model,
    'base_url', s.base_url,
    'enabled', s.enabled and exists(select 1 from ai_private.api_keys k where k.provider = s.provider and k.enabled),
    'has_key', exists(select 1 from ai_private.api_keys k where k.provider = s.provider),
    'key_hint', (
      select k.hint from ai_private.api_keys k
      where k.provider = s.provider
      order by k.enabled desc, k.position, k.created_at limit 1
    ),
    'key_count', (select count(*) from ai_private.api_keys k where k.provider = s.provider),
    'active_key_count', (select count(*) from ai_private.api_keys k where k.provider = s.provider and k.enabled),
    'keys', v_keys,
    'last_test_at', s.last_test_at,
    'last_test_ok', s.last_test_ok,
    'last_test_message', s.last_test_message,
    'updated_at', s.updated_at
  );
end $$;
revoke all on function public.ai_get_settings() from public, anon;
grant execute on function public.ai_get_settings() to authenticated;

create or replace function public.ai_save_settings(
  p_provider text,
  p_model text,
  p_base_url text,
  p_api_key text default '',
  p_enabled boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s ai_private.settings;
  k ai_private.api_keys;
  v_provider text := lower(btrim(coalesce(p_provider,'')));
  v_model text := btrim(coalesce(p_model,''));
  v_key text := btrim(coalesce(p_api_key,''));
  v_url text;
  v_secret_id uuid;
  v_hint text;
  v_position integer;
begin
  if not public.auth_is_super_admin() then
    raise exception 'Hanya Super Admin yang dapat mengubah pengaturan AI.' using errcode='42501';
  end if;
  if v_provider not in ('gemini','deepseek','grok') then
    raise exception 'Penyedia AI tidak valid.';
  end if;
  if v_model !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'Nama model AI tidak valid.';
  end if;
  v_url := ai_private.normalize_base_url(v_provider, p_base_url);

  select * into s from ai_private.settings where id;

  -- Kompatibilitas klien lama: key yang dikirim lewat simpan pengaturan
  -- menggantikan key utama pada penyedia yang dipilih.
  if v_key <> '' then
    if length(v_key) < 8 or length(v_key) > 500 then
      raise exception 'API key harus terdiri dari 8 sampai 500 karakter.';
    end if;
    select * into k from ai_private.api_keys
    where provider = v_provider order by position, created_at limit 1;
    if found then
      perform vault.update_secret(k.secret_id, v_key, 'ai-provider-api-key', 'API key penyedia AI');
      update ai_private.api_keys set
        hint = '••••' || right(v_key, 4),
        enabled = true,
        status = 'active',
        cooldown_until = null,
        last_error = null
      where id = k.id;
    else
      v_secret_id := vault.create_secret(v_key, 'ai-provider-api-key', 'API key penyedia AI');
      select coalesce(max(position) + 1, 0) into v_position from ai_private.api_keys where provider = v_provider;
      insert into ai_private.api_keys(provider, secret_id, hint, label, position, enabled, created_by)
      values (v_provider, v_secret_id, '••••' || right(v_key, 4), 'Utama', v_position, true, auth.uid());
    end if;
  end if;

  if p_enabled and not exists(
    select 1 from ai_private.api_keys k where k.provider = v_provider and k.enabled
  ) then
    raise exception 'Tambahkan API key terlebih dahulu sebelum mengaktifkan AI.';
  end if;

  update ai_private.settings set
    provider = v_provider,
    model = v_model,
    base_url = v_url,
    enabled = p_enabled,
    last_test_at = null,
    last_test_ok = null,
    last_test_message = null,
    updated_at = now(),
    updated_by = auth.uid()
  where id;

  return public.ai_get_settings();
end $$;
revoke all on function public.ai_save_settings(text,text,text,text,boolean) from public, anon;
grant execute on function public.ai_save_settings(text,text,text,text,boolean) to authenticated;

create or replace function public.ai_add_api_key(
  p_provider text,
  p_api_key text,
  p_label text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider,'')));
  v_key text := btrim(coalesce(p_api_key,''));
  v_label text := left(btrim(coalesce(p_label,'')), 80);
  v_secret_id uuid;
  v_position integer;
begin
  if not public.auth_is_super_admin() then
    raise exception 'Hanya Super Admin yang dapat menambah API key AI.' using errcode='42501';
  end if;
  if v_provider not in ('gemini','deepseek','grok') then
    raise exception 'Penyedia AI tidak valid.';
  end if;
  if length(v_key) < 8 or length(v_key) > 500 then
    raise exception 'API key harus terdiri dari 8 sampai 500 karakter.';
  end if;
  if (select count(*) from ai_private.api_keys where provider = v_provider) >= 10 then
    raise exception 'Maksimal 10 API key untuk setiap penyedia.';
  end if;
  v_secret_id := vault.create_secret(v_key, 'ai-provider-api-key', 'API key penyedia AI');
  select coalesce(max(position) + 1, 0) into v_position from ai_private.api_keys where provider = v_provider;
  insert into ai_private.api_keys(provider, secret_id, hint, label, position, enabled, created_by)
  values (v_provider, v_secret_id, '••••' || right(v_key, 4), v_label, v_position, true, auth.uid());
  return public.ai_get_settings();
end $$;
revoke all on function public.ai_add_api_key(text,text,text) from public, anon;
grant execute on function public.ai_add_api_key(text,text,text) to authenticated;

create or replace function public.ai_update_api_key(
  p_key_id uuid,
  p_enabled boolean default null,
  p_label text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  k ai_private.api_keys;
  s ai_private.settings;
begin
  if not public.auth_is_super_admin() then
    raise exception 'Hanya Super Admin yang dapat mengubah API key AI.' using errcode='42501';
  end if;
  select * into k from ai_private.api_keys where id = p_key_id;
  if not found then raise exception 'API key tidak ditemukan.'; end if;
  select * into s from ai_private.settings where id;
  if p_enabled = false and k.enabled and k.provider = s.provider and s.enabled
    and (select count(*) from ai_private.api_keys where provider = k.provider and enabled) <= 1 then
    raise exception 'Nonaktifkan AI sebelum menonaktifkan API key terakhir yang aktif.';
  end if;
  update ai_private.api_keys set
    enabled = coalesce(p_enabled, enabled),
    label = left(coalesce(nullif(btrim(p_label), ''), label), 80)
  where id = k.id;
  return public.ai_get_settings();
end $$;
revoke all on function public.ai_update_api_key(uuid,boolean,text) from public, anon;
grant execute on function public.ai_update_api_key(uuid,boolean,text) to authenticated;

create or replace function public.ai_promote_api_key(p_key_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  k ai_private.api_keys;
  s ai_private.settings;
  v_position integer;
begin
  if not public.auth_is_super_admin() then
    raise exception 'Hanya Super Admin yang dapat mengubah urutan API key AI.' using errcode='42501';
  end if;
  select * into k from ai_private.api_keys where id = p_key_id;
  if not found then raise exception 'API key tidak ditemukan.'; end if;
  select * into s from ai_private.settings where id;
  if k.provider <> s.provider then raise exception 'API key bukan untuk penyedia yang aktif.'; end if;
  if not k.enabled then raise exception 'Aktifkan API key sebelum menjadikannya utama.'; end if;
  select coalesce(min(position) - 1, 0) into v_position from ai_private.api_keys where provider = k.provider;
  update ai_private.api_keys set position = v_position where id = k.id;
  return public.ai_get_settings();
end $$;
revoke all on function public.ai_promote_api_key(uuid) from public, anon;
grant execute on function public.ai_promote_api_key(uuid) to authenticated;

create or replace function public.ai_delete_api_key(p_key_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  k ai_private.api_keys;
  s ai_private.settings;
begin
  if not public.auth_is_super_admin() then
    raise exception 'Hanya Super Admin yang dapat menghapus API key AI.' using errcode='42501';
  end if;
  select * into k from ai_private.api_keys where id = p_key_id;
  if not found then raise exception 'API key tidak ditemukan.'; end if;
  select * into s from ai_private.settings where id;
  if k.provider = s.provider and s.enabled and k.enabled
    and (select count(*) from ai_private.api_keys where provider = k.provider and enabled) <= 1 then
    raise exception 'Nonaktifkan AI sebelum menghapus API key terakhir yang aktif.';
  end if;
  delete from vault.secrets where id = k.secret_id;
  delete from ai_private.api_keys where id = k.id;
  return public.ai_get_settings();
end $$;
revoke all on function public.ai_delete_api_key(uuid) from public, anon;
grant execute on function public.ai_delete_api_key(uuid) to authenticated;

create or replace function public.ai_clear_api_key()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s ai_private.settings;
begin
  if not public.auth_is_super_admin() then
    raise exception 'Hanya Super Admin yang dapat menghapus API key AI.' using errcode='42501';
  end if;
  select * into s from ai_private.settings where id;
  delete from vault.secrets where id in (
    select secret_id from ai_private.api_keys where provider = s.provider
  );
  delete from ai_private.api_keys where provider = s.provider;
  update ai_private.settings set
    enabled = false,
    last_test_at = null,
    last_test_ok = null,
    last_test_message = null,
    updated_at = now(),
    updated_by = auth.uid()
  where id;
  return public.ai_get_settings();
end $$;
revoke all on function public.ai_clear_api_key() from public, anon;
grant execute on function public.ai_clear_api_key() to authenticated;

create or replace function public.ai_public_status()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((
    select jsonb_build_object(
      'enabled', s.enabled and exists(
        select 1 from ai_private.api_keys k where k.provider = s.provider and k.enabled
      ),
      'provider', s.provider,
      'model', s.model
    )
    from ai_private.settings s where s.id
  ), '{"enabled": false}'::jsonb);
$$;
revoke all on function public.ai_public_status() from public, anon;
grant execute on function public.ai_public_status() to authenticated;

create or replace function public.ai_service_runtime_config()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'provider', s.provider,
    'model', s.model,
    'base_url', s.base_url,
    'enabled', s.enabled and exists(
      select 1 from ai_private.api_keys k where k.provider = s.provider and k.enabled
    ),
    'api_key', (
      select ds.decrypted_secret
      from ai_private.api_keys k
      join vault.decrypted_secrets ds on ds.id = k.secret_id
      where k.provider = s.provider and k.enabled
      order by k.position, k.created_at limit 1
    ),
    'keys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id,
        'api_key', ds.decrypted_secret,
        'hint', k.hint,
        'status', k.status,
        'cooldown_until', k.cooldown_until,
        'position', k.position
      ) order by k.position, k.created_at)
      from ai_private.api_keys k
      join vault.decrypted_secrets ds on ds.id = k.secret_id
      where k.provider = s.provider and k.enabled
    ), '[]'::jsonb)
  )
  from ai_private.settings s
  where s.id;
$$;
revoke all on function public.ai_service_runtime_config() from public, anon, authenticated;
grant execute on function public.ai_service_runtime_config() to service_role;

create or replace function public.ai_service_key_result(
  p_key_id uuid,
  p_result text,
  p_message text default '',
  p_cooldown_seconds integer default 60
) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_result = 'ok' then
    update ai_private.api_keys set
      status = 'active', cooldown_until = null, last_error = null,
      last_used_at = now(), last_success_at = now()
    where id = p_key_id;
  elsif p_result = 'invalid' then
    update ai_private.api_keys set
      status = 'invalid', cooldown_until = null,
      last_error = left(coalesce(p_message,''), 500), last_used_at = now()
    where id = p_key_id;
  elsif p_result = 'cooldown' then
    update ai_private.api_keys set
      status = 'cooldown',
      cooldown_until = now() + make_interval(secs => greatest(5, least(coalesce(p_cooldown_seconds, 60), 3600))),
      last_error = left(coalesce(p_message,''), 500), last_used_at = now()
    where id = p_key_id;
  else
    update ai_private.api_keys set
      last_error = left(coalesce(p_message,''), 500), last_used_at = now()
    where id = p_key_id;
  end if;
end $$;
revoke all on function public.ai_service_key_result(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.ai_service_key_result(uuid,text,text,integer) to service_role;

-- Kolom key tunggal lama tidak lagi dipakai setelah seluruh fungsi di atas
-- membaca ai_private.api_keys.
alter table ai_private.settings drop column if exists api_key_secret_id;
alter table ai_private.settings drop column if exists api_key_hint;
