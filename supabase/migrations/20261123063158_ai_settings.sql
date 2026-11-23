-- Pengaturan AI umum (bukan khusus BBM): penyedia, model, endpoint, dan API key.
-- API key hanya disimpan terenkripsi di Supabase Vault dan tidak pernah dikirim
-- kembali ke browser. Hanya Super Admin yang dapat membaca/mengubah pengaturan.
create schema if not exists ai_private;
revoke all on schema ai_private from public, anon, authenticated;
grant usage on schema ai_private to service_role;

create table if not exists ai_private.settings (
  id boolean primary key default true check (id),
  provider text not null default 'gemini' check (provider in ('gemini','deepseek','grok')),
  model text not null default 'gemini-3.6-flash',
  base_url text not null default 'https://generativelanguage.googleapis.com',
  api_key_secret_id uuid,
  api_key_hint text,
  enabled boolean not null default false,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table ai_private.settings enable row level security;
revoke all on ai_private.settings from public, anon, authenticated;
grant select, update on ai_private.settings to service_role;
insert into ai_private.settings(id) values (true) on conflict (id) do nothing;

create or replace function ai_private.normalize_base_url(p_provider text, p_base_url text)
returns text language plpgsql immutable set search_path='' as $$
declare
  v_url text := regexp_replace(btrim(coalesce(p_base_url,'')), '/+$', '');
begin
  if v_url !~ '^https://[a-z0-9.-]+$' then
    raise exception 'Endpoint AI harus berupa alamat https tanpa path.';
  end if;
  if p_provider = 'gemini' and v_url <> 'https://generativelanguage.googleapis.com' then
    raise exception 'Endpoint Gemini tidak diizinkan.';
  elsif p_provider = 'deepseek' and v_url <> 'https://api.deepseek.com' then
    raise exception 'Endpoint DeepSeek tidak diizinkan.';
  elsif p_provider = 'grok' and v_url <> 'https://api.x.ai' then
    raise exception 'Endpoint Grok tidak diizinkan.';
  end if;
  return v_url;
end $$;
revoke all on function ai_private.normalize_base_url(text,text) from public, anon, authenticated;

create or replace function public.ai_get_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  s ai_private.settings;
begin
  if not public.auth_is_super_admin() then
    raise exception 'Hanya Super Admin yang dapat membuka pengaturan AI.' using errcode='42501';
  end if;
  select * into s from ai_private.settings where id;
  return jsonb_build_object(
    'provider', s.provider,
    'model', s.model,
    'base_url', s.base_url,
    'enabled', s.enabled and s.api_key_secret_id is not null,
    'has_key', s.api_key_secret_id is not null,
    'key_hint', s.api_key_hint,
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
  v_provider text := lower(btrim(coalesce(p_provider,'')));
  v_model text := btrim(coalesce(p_model,''));
  v_key text := btrim(coalesce(p_api_key,''));
  v_url text;
  v_secret_id uuid;
  v_hint text;
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
  v_secret_id := s.api_key_secret_id;
  v_hint := s.api_key_hint;

  if v_key <> '' then
    if length(v_key) < 8 or length(v_key) > 500 then
      raise exception 'API key harus terdiri dari 8 sampai 500 karakter.';
    end if;
    if v_secret_id is null then
      v_secret_id := vault.create_secret(v_key, 'ai-provider-api-key', 'API key penyedia AI');
    else
      perform vault.update_secret(v_secret_id, v_key, 'ai-provider-api-key', 'API key penyedia AI');
    end if;
    v_hint := '••••' || right(v_key, 4);
  end if;

  if p_enabled and v_secret_id is null then
    raise exception 'Isi API key terlebih dahulu sebelum mengaktifkan AI.';
  end if;

  update ai_private.settings set
    provider = v_provider,
    model = v_model,
    base_url = v_url,
    api_key_secret_id = v_secret_id,
    api_key_hint = v_hint,
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

create or replace function public.ai_clear_api_key()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s ai_private.settings;
begin
  if not public.auth_is_super_admin() then
    raise exception 'Hanya Super Admin yang dapat menghapus API key AI.' using errcode='42501';
  end if;
  select * into s from ai_private.settings where id;
  if s.api_key_secret_id is not null then
    delete from vault.secrets where id = s.api_key_secret_id;
  end if;
  update ai_private.settings set
    api_key_secret_id = null,
    api_key_hint = null,
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
      'enabled', s.enabled and s.api_key_secret_id is not null,
      'provider', s.provider,
      'model', s.model
    )
    from ai_private.settings s where s.id
  ), '{"enabled": false}'::jsonb);
$$;
revoke all on function public.ai_public_status() from public, anon;
grant execute on function public.ai_public_status() to authenticated;

create or replace function ai_private.get_runtime_config()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'provider', s.provider,
    'model', s.model,
    'base_url', s.base_url,
    'api_key', ds.decrypted_secret,
    'enabled', s.enabled and ds.decrypted_secret is not null
  )
  from ai_private.settings s
  left join vault.decrypted_secrets ds on ds.id = s.api_key_secret_id
  where s.id;
$$;
revoke all on function ai_private.get_runtime_config() from public, anon, authenticated;
grant execute on function ai_private.get_runtime_config() to service_role;

create or replace function ai_private.record_test_result(p_ok boolean, p_message text)
returns void language sql security definer set search_path='' as $$
  update ai_private.settings set
    last_test_at = now(),
    last_test_ok = p_ok,
    last_test_message = left(coalesce(p_message,''), 500)
  where id;
$$;
revoke all on function ai_private.record_test_result(boolean,text) from public, anon, authenticated;
grant execute on function ai_private.record_test_result(boolean,text) to service_role;

create or replace function public.bbm_ai_can_validate(p_vehicle_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(bbm_private.can_access(p_vehicle_id, false), false);
$$;
revoke all on function public.bbm_ai_can_validate(uuid) from public, anon;
grant execute on function public.bbm_ai_can_validate(uuid) to authenticated;
