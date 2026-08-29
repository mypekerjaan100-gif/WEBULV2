-- Capability helpers are server-internal. Only the scoped listing RPC is client-callable.
revoke all on function public.auth_can_manage_up3_operations(uuid, uuid) from public, anon, authenticated;
revoke all on function public.auth_has_management_operational_scope(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.auth_can_manage_pelayanan_teknik_scope(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.auth_can_review_overtime_l5(uuid, uuid, uuid) from public, anon, authenticated;

revoke all on function public.list_management_operational_scopes() from public, anon, authenticated;
grant execute on function public.list_management_operational_scopes() to authenticated;
