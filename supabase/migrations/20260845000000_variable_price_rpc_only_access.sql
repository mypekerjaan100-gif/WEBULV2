-- Harga Satuan is exposed only through its scoped batch/list RPCs.
revoke all on public.variable_unit_prices from public, anon, authenticated;
revoke all on function public.is_priced_variable_indicator(uuid,uuid,uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
