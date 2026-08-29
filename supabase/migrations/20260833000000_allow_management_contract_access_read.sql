-- Allow authenticated to read their mapped operational scope
drop policy if exists "organization_contract_access_select_authenticated" on public.organization_contract_access;
create policy "organization_contract_access_select_authenticated" on public.organization_contract_access for select to authenticated using (true);
