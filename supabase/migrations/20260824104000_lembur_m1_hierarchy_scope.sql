-- M1: Hierarchy + operational scope mapping foundation.
-- Reuses existing tables: internal_organization_units, organization_units,
-- organization_contract_access, organization_memberships.
-- No Lembur authorization expansion, no UI changes, no new mapping table.

-- Ensure hierarchy resolvable by UUID and mapping queryable without name matching.
-- Helper views normalize mapping data for M2; they do NOT grant permissions.

create or replace view public.v_internal_organization_hierarchy as
select
  up.id as up_id,
  up.code as up_code,
  up.legacy_key as up_legacy_key,
  up.name as up_name,
  ul.id as ul_id,
  ul.code as ul_code,
  ul.legacy_key as ul_legacy_key,
  ul.name as ul_name,
  ul.status as ul_status,
  up.status as up_status
from public.internal_organization_units ul
join public.internal_organization_units up
  on up.id = ul.parent_id
where ul.type = 'UL'
  and up.type = 'UP';

create or replace view public.v_internal_ul_pelayanan_teknik_scope as
select
  iou.id as internal_ul_id,
  iou.code as internal_ul_code,
  iou.legacy_key as internal_ul_legacy_key,
  iou.name as internal_ul_name,
  iou.parent_id as internal_up_id,
  oca.contract_id,
  c.code as contract_code,
  oca.operational_up3_id,
  ou.legacy_key as operational_up3_legacy_key,
  ou.type as operational_up3_type,
  oca.operational_unit_id,
  oca.status as mapping_status,
  oca.effective_from as mapping_effective_from,
  oca.effective_to as mapping_effective_to
from public.internal_organization_units iou
join public.organization_contract_access oca
  on oca.internal_org_unit_id = iou.id
join public.contracts c
  on c.id = oca.contract_id
join public.organization_units ou
  on ou.id = oca.operational_up3_id
where iou.type = 'UL';

-- Helpful index for M2 descendant resolution: UP -> child UL lookup.
-- Already have idx_internal_org_units_parent; add composite for active hierarchy scans.
create index if not exists idx_internal_org_units_parent_active
  on public.internal_organization_units (parent_id, status)
  where type = 'UL' and status = 'ACTIVE';

-- Ensure mapping lookups by internal UL + contract are fast and unambiguous.
create index if not exists idx_oca_internal_contract_active
  on public.organization_contract_access (internal_org_unit_id, contract_id)
  where status = 'ACTIVE' and effective_to is null;

comment on view public.v_internal_organization_hierarchy
  is 'M1 helper: UP Kal1 -> Unit Layanan hierarchy by UUID. No authorization.';
comment on view public.v_internal_ul_pelayanan_teknik_scope
  is 'M1 helper: Unit Layanan -> contract -> operational UP3 UUID mapping. Normalized for M2 resolver; does not grant Lembur access.';
