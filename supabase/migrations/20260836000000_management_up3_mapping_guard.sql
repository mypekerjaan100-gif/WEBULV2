-- Management hierarchy consumes explicit UP3 mappings only.
-- ULP-specific organization_contract_access rows never widen to their parent UP3.

create or replace function public.auth_has_management_operational_scope(
  p_contract_id uuid,
  p_up3_id uuid,
  p_unit_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.organization_memberships m
    join public.internal_organization_units assigned
      on assigned.id = m.internal_org_unit_id
     and assigned.status = 'ACTIVE'
    join public.internal_organization_units mapped_ul
      on mapped_ul.status = 'ACTIVE'
     and mapped_ul.type = 'UL'
     and (
       (m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT') and assigned.type = 'UL' and mapped_ul.id = assigned.id)
       or
       (m.organization_role in ('MANAGER_UP', 'ASMAN_OPERASI', 'ASMAN_KEUANGAN') and assigned.type = 'UP' and mapped_ul.parent_id = assigned.id)
     )
    join public.organization_contract_access oca
      on oca.internal_org_unit_id = mapped_ul.id
     and oca.status = 'ACTIVE'
     and oca.effective_from <= current_date
     and (oca.effective_to is null or current_date < oca.effective_to)
     and oca.operational_unit_id is null
    join public.contracts c
      on c.id = oca.contract_id
     and c.status = 'active'
    join public.contract_up3_scopes cus
      on cus.contract_id = oca.contract_id
     and cus.up3_id = oca.operational_up3_id
     and cus.status = 'Aktif'
    join public.organization_units operational_up3
      on operational_up3.id = oca.operational_up3_id
     and operational_up3.type = 'UP3'
     and operational_up3.own_status = 'Aktif'
    where m.user_id = auth.uid()
      and m.status = 'ACTIVE'
      and m.effective_from <= current_date
      and (m.effective_to is null or current_date < m.effective_to)
      and m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT', 'MANAGER_UP', 'ASMAN_OPERASI', 'ASMAN_KEUANGAN')
      and oca.contract_id = p_contract_id
      and oca.operational_up3_id = p_up3_id
      and (
        p_unit_id is null
        or exists (
          select 1
          from public.organization_units ou
          where ou.id = p_unit_id
            and ou.type = 'ULP'
            and ou.parent_id = p_up3_id
            and ou.own_status = 'Aktif'
        )
      )
  )
$$;

create or replace function public.list_management_operational_scopes()
returns table(
  contract_id uuid,
  contract_code text,
  operational_up3_id uuid,
  operational_unit_id uuid,
  internal_ul_id uuid,
  internal_ul_name text,
  internal_up_id uuid,
  internal_up_name text,
  organization_role text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct
    oca.contract_id,
    c.code,
    oca.operational_up3_id,
    oca.operational_unit_id,
    mapped_ul.id,
    mapped_ul.name,
    parent_up.id,
    parent_up.name,
    m.organization_role
  from public.organization_memberships m
  join public.internal_organization_units assigned
    on assigned.id = m.internal_org_unit_id
   and assigned.status = 'ACTIVE'
  join public.internal_organization_units mapped_ul
    on mapped_ul.status = 'ACTIVE'
   and mapped_ul.type = 'UL'
   and (
     (m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT') and assigned.type = 'UL' and mapped_ul.id = assigned.id)
     or
     (m.organization_role in ('MANAGER_UP', 'ASMAN_OPERASI', 'ASMAN_KEUANGAN') and assigned.type = 'UP' and mapped_ul.parent_id = assigned.id)
   )
  join public.internal_organization_units parent_up
    on parent_up.id = mapped_ul.parent_id
   and parent_up.type = 'UP'
   and parent_up.status = 'ACTIVE'
  join public.organization_contract_access oca
    on oca.internal_org_unit_id = mapped_ul.id
   and oca.status = 'ACTIVE'
   and oca.effective_from <= current_date
   and (oca.effective_to is null or current_date < oca.effective_to)
   and oca.operational_unit_id is null
  join public.contracts c
    on c.id = oca.contract_id
   and c.status = 'active'
  join public.contract_up3_scopes cus
    on cus.contract_id = oca.contract_id
   and cus.up3_id = oca.operational_up3_id
   and cus.status = 'Aktif'
  join public.organization_units operational_up3
    on operational_up3.id = oca.operational_up3_id
   and operational_up3.type = 'UP3'
   and operational_up3.own_status = 'Aktif'
  where m.user_id = auth.uid()
    and m.status = 'ACTIVE'
    and m.effective_from <= current_date
    and (m.effective_to is null or current_date < m.effective_to)
    and m.organization_role in ('TEAM_LEADER', 'MANAGER_UNIT', 'MANAGER_UP', 'ASMAN_OPERASI', 'ASMAN_KEUANGAN')
$$;

revoke all on function public.auth_has_management_operational_scope(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_management_operational_scopes() from public, anon, authenticated;
grant execute on function public.list_management_operational_scopes() to authenticated;
