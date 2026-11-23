-- RPC khusus Edge Function (service role) untuk membaca konfigurasi AI dan
-- mencatat hasil uji. Dipindahkan ke public agar dapat dipanggil PostgREST,
-- tetapi EXECUTE hanya diberikan kepada service_role (bukan browser).
create or replace function public.ai_service_runtime_config()
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
revoke all on function public.ai_service_runtime_config() from public, anon, authenticated;
grant execute on function public.ai_service_runtime_config() to service_role;

create or replace function public.ai_service_record_test(p_ok boolean, p_message text)
returns void language sql security definer set search_path='' as $$
  update ai_private.settings set
    last_test_at = now(),
    last_test_ok = p_ok,
    last_test_message = left(coalesce(p_message,''), 500)
  where id;
$$;
revoke all on function public.ai_service_record_test(boolean,text) from public, anon, authenticated;
grant execute on function public.ai_service_record_test(boolean,text) to service_role;

drop function if exists ai_private.get_runtime_config();
drop function if exists ai_private.record_test_result(boolean,text);
