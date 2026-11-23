-- Ganti penyedia AI wajib menyertakan API key baru agar key lama tidak
-- dipakai untuk penyedia yang berbeda.
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
  if s.api_key_secret_id is not null and s.provider <> v_provider and v_key = '' then
    raise exception 'Masukkan API key untuk penyedia AI yang baru.';
  end if;
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
