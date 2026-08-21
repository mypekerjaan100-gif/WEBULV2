-- AUTH-F4A.1: Restore authenticated EXECUTE grants on auth helper functions
-- Root cause: AUTH-F4A revoked EXECUTE from public/anon/authenticated but
-- never granted it back to authenticated, so RLS policies calling these
-- functions fail with permission denied before the function body runs.

GRANT EXECUTE
  ON FUNCTION public.auth_is_super_admin()
  TO authenticated;

GRANT EXECUTE
  ON FUNCTION public.auth_has_permission(text)
  TO authenticated;
