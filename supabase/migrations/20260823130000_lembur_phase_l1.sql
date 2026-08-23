-- Lembur Phase L1: authenticated, scope-safe persistence for basic overtime entries.
-- Existing overtime tables and calculation RPCs remain authoritative.

create or replace function public.auth_can_manage_overtime_scope(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.contracts c
      join public.contract_up3_scopes scope
        on scope.contract_id = c.id
       and scope.up3_id = p_up3_id
       and scope.status = 'Aktif'
      join public.organization_units target_unit
        on target_unit.id = p_unit_id
       and target_unit.own_status = 'Aktif'
       and (
         target_unit.id = p_up3_id
         or (
           target_unit.type = 'ULP'
           and target_unit.parent_id = p_up3_id
         )
       )
      where c.id = p_contract_id
        and c.status = 'active'
        and (
          public.auth_is_super_admin()
          or exists (
            select 1
            from public.contract_memberships membership
            where membership.user_id = auth.uid()
              and membership.status = 'ACTIVE'
              and membership.effective_from <= current_date
              and (
                membership.effective_to is null
                or current_date < membership.effective_to
              )
              and membership.contract_id = p_contract_id
              and membership.operational_up3_id = p_up3_id
              and (
                (
                  membership.contract_role = 'ADMIN_UP3'
                  and membership.operational_unit_id is null
                )
                or (
                  membership.contract_role = 'ADMIN_ULP'
                  and membership.operational_unit_id = p_unit_id
                )
              )
          )
        )
    )
$$;

revoke all on function public.auth_can_manage_overtime_scope(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.auth_can_manage_overtime_scope(uuid, uuid, uuid)
  to authenticated, service_role;

drop policy if exists overtime_entries_select_authorized_scope
  on public.overtime_entries;
create policy overtime_entries_select_authorized_scope
  on public.overtime_entries
  for select
  to authenticated
  using (
    public.auth_can_manage_overtime_scope(contract_id, up3_id, unit_id)
  );

grant select on public.overtime_entries to authenticated;

-- The wrapper authorizes the JWT actor, while the existing RPC remains the
-- single implementation of historical rate, status, retirement, and formula logic.
create or replace function public.save_overtime_entry_authenticated(
  p_entry_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid,
  p_employee_id uuid,
  p_work_date date,
  p_hours numeric,
  p_description text,
  p_legacy_key text default null
)
returns public.overtime_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result public.overtime_entries%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.auth_can_manage_overtime_scope(
    p_contract_id,
    p_up3_id,
    p_unit_id
  ) then
    raise exception 'Overtime scope is not authorized for this account'
      using errcode = '42501';
  end if;

  select * into v_result
  from public.save_overtime_entry(
    p_entry_id,
    p_contract_id,
    p_up3_id,
    p_unit_id,
    p_employee_id,
    p_work_date,
    p_hours,
    p_description,
    p_legacy_key
  );
  return v_result;
end;
$$;

create or replace function public.delete_overtime_entry_authenticated(
  p_entry_id uuid,
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.auth_can_manage_overtime_scope(
    p_contract_id,
    p_up3_id,
    p_unit_id
  ) then
    raise exception 'Overtime scope is not authorized for this account'
      using errcode = '42501';
  end if;

  perform public.delete_overtime_entry(
    p_entry_id,
    p_contract_id,
    p_up3_id,
    p_unit_id
  );
end;
$$;

revoke all on function public.save_overtime_entry_authenticated(
  uuid, uuid, uuid, uuid, uuid, date, numeric, text, text
) from public, anon;
revoke all on function public.delete_overtime_entry_authenticated(
  uuid, uuid, uuid, uuid
) from public, anon;
grant execute on function public.save_overtime_entry_authenticated(
  uuid, uuid, uuid, uuid, uuid, date, numeric, text, text
) to authenticated;
grant execute on function public.delete_overtime_entry_authenticated(
  uuid, uuid, uuid, uuid
) to authenticated;

-- Persist the retirement policy already used by the Pelayanan Teknik UI.
insert into public.pension_policies (
  legacy_key,
  contract_id,
  up3_id,
  retirement_age,
  status,
  effective_from,
  effective_to,
  note
)
select
  'pensiun-policy-1',
  scope.contract_id,
  scope.up3_id,
  56,
  'active',
  date '2026-01-01',
  future_policy.effective_from,
  'Pelayanan Teknik retirement policy'
from public.contract_up3_scopes scope
join public.contracts contract on contract.id = scope.contract_id
left join lateral (
  select min(policy.effective_from) as effective_from
  from public.pension_policies policy
  where policy.contract_id = scope.contract_id
    and policy.up3_id = scope.up3_id
    and policy.effective_from > date '2026-01-01'
) future_policy on true
where contract.code = 'pelayanan-teknik'
  and scope.status = 'Aktif'
  and not exists (
    select 1
    from public.pension_policies policy
    where policy.contract_id = scope.contract_id
      and policy.up3_id = scope.up3_id
      and policy.effective_from <= date '2026-01-01'
      and (
        policy.effective_to is null
        or date '2026-01-01' < policy.effective_to
      )
  );
