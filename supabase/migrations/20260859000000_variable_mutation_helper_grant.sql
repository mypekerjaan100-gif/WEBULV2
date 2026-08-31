-- Metadata RLS evaluates this exact-ULP predicate as the authenticated caller.
grant execute on function public.auth_can_mutate_variable_entry_scope(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
