import { supabase } from '../lib/supabaseClient.js'

export function normalizePlate(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

export function displayPlate(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function mapVehicle(row) {
  return {
    id: row.id,
    contractId: row.contract_id,
    up3Id: row.up3_id,
    ulpId: row.ulp_id,
    ulpKey: row.ulp_key ?? '',
    plateDisplay: row.plate_display ?? '',
    plateNormalized: row.plate_normalized ?? '',
    brand: row.brand ?? '',
    notes: row.notes ?? '',
    status: row.status ?? 'Aktif',
    inactiveReason: row.inactive_reason ?? '',
    revision: Number(row.revision ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignmentId: row.assignment_id ?? null,
    templateId: row.template_id ?? null,
    templateCode: row.template_code ?? '',
    templateName: row.template_name ?? '',
    vehicleTypeName: row.vehicle_type_name ?? '',
    assignmentName: row.assignment_name ?? '',
    vehicleVariant: row.vehicle_variant ?? '',
    templateLegacy: row.template_legacy === true,
    effectiveFrom: row.effective_from ?? '',
  }
}

function mapAssignment(row) {
  if (!row) return null
  return {
    id: row.id,
    templateId: row.template_id,
    templateCode: row.template_code ?? '',
    templateName: row.template_name ?? '',
    vehicleTypeId: row.vehicle_type_id ?? null,
    vehicleTypeName: row.vehicle_type_name ?? '',
    assignmentId: row.assignment_id ?? null,
    assignmentName: row.assignment_name ?? '',
    vehicleVariant: row.vehicle_variant ?? '',
    templateLegacy: row.template_legacy === true,
    effectiveFrom: row.effective_from ?? '',
    itemsCount: Number(row.items_count ?? 0),
  }
}

function mapCandidate(row) {
  return {
    id: row.id,
    templateCode: row.template_code ?? '',
    templateName: row.template_name ?? '',
    versionNumber: Number(row.version_number ?? 1),
    vehicleVariant: row.vehicle_variant ?? '',
    vehicleTypeId: row.vehicle_type_id,
    vehicleTypeName: row.vehicle_type_name ?? '',
    assignmentId: row.assignment_id,
    assignmentName: row.assignment_name ?? '',
    templateLegacy: row.template_legacy === true,
    effectiveFrom: row.effective_from ?? '',
    itemsCount: Number(row.items_count ?? 0),
  }
}

function mapItem(row) {
  return {
    equipmentId: row.equipment_id,
    equipmentCode: row.equipment_code ?? '',
    equipmentName: row.equipment_name ?? '',
    equipmentUnit: row.equipment_unit ?? 'unit',
    categoryName: row.category_name ?? '',
    requiredQty: Number(row.required_qty ?? 0),
    note: row.note ?? '',
    sortOrder: Number(row.sort_order ?? 0),
    legacyMetadata: row.legacy_metadata === true,
    isActive: row.is_active !== false,
  }
}

function mapHistory(row) {
  return {
    id: row.id,
    action: row.action,
    detail: row.detail ?? {},
    actorId: row.actor_id ?? null,
    actorRole: row.actor_role ?? '',
    createdAt: row.created_at,
  }
}

export async function listOpsVehicles({ contractId, up3Id, ulpId = null, search = '', status = '', limit = 25, offset = 0 }) {
  const { data, error } = await supabase.rpc('ops_list_vehicles', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_ulp_id: ulpId || null,
    p_search: search || null,
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw new Error(error.message || 'Daftar kendaraan gagal dimuat.')
  return {
    total: Number(data?.total ?? 0),
    rows: (data?.rows ?? []).map(mapVehicle),
  }
}

export async function getOpsVehicle(vehicleId) {
  const { data, error } = await supabase.rpc('ops_get_vehicle', { p_vehicle_id: vehicleId })
  if (error) throw new Error(error.message || 'Detail kendaraan gagal dimuat.')
  return {
    vehicle: mapVehicle(data ?? {}),
    assignment: mapAssignment(data?.assignment),
  }
}

export async function listVehicleTemplateCandidates({ vehicleId = null, contractId = null, up3Id = null }) {
  const { data, error } = await supabase.rpc('ops_list_vehicle_template_candidates', {
    p_vehicle_id: vehicleId,
    p_contract_id: contractId,
    p_up3_id: up3Id,
  })
  if (error) throw new Error(error.message || 'Acuan template gagal dimuat.')
  return (data ?? []).map(mapCandidate)
}

export async function listTemplateItemsForVehicle(templateId) {
  const { data, error } = await supabase.rpc('ops_list_template_items_for_vehicle', {
    p_template_id: templateId,
  })
  if (error) throw new Error(error.message || 'Rincian kebutuhan gagal dimuat.')
  return (data ?? []).map(mapItem)
}

export async function saveOpsVehicle({
  id = null,
  contractId,
  up3Id,
  ulpId,
  expectedRevision = null,
  plate,
  brand,
  notes = '',
  templateId,
}) {
  const { data, error } = await supabase.rpc('ops_save_vehicle', {
    p_id: id,
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_ulp_id: ulpId,
    p_expected_revision: expectedRevision,
    p_plate: plate,
    p_brand: brand,
    p_notes: notes,
    p_template_id: templateId,
  })
  if (error) throw new Error(error.message || 'Kendaraan gagal disimpan.')
  return {
    vehicle: mapVehicle(data ?? {}),
    assignment: mapAssignment(data?.assignment),
  }
}

export async function setOpsVehicleStatus({ vehicleId, status, reason, expectedRevision = null }) {
  const { data, error } = await supabase.rpc('ops_set_vehicle_status', {
    p_vehicle_id: vehicleId,
    p_status: status,
    p_reason: reason,
    p_expected_revision: expectedRevision,
  })
  if (error) throw new Error(error.message || 'Status kendaraan gagal diubah.')
  return {
    vehicle: mapVehicle(data ?? {}),
    assignment: mapAssignment(data?.assignment),
  }
}

export async function correctOpsVehicleUlp({ vehicleId, newUlpId, reason, expectedRevision = null }) {
  const { data, error } = await supabase.rpc('ops_correct_vehicle_ulp', {
    p_vehicle_id: vehicleId,
    p_new_ulp_id: newUlpId,
    p_reason: reason,
    p_expected_revision: expectedRevision,
  })
  if (error) throw new Error(error.message || 'Koreksi ULP gagal disimpan.')
  return {
    id: data?.id ?? vehicleId,
    ulpId: data?.ulp_id ?? newUlpId,
    revision: Number(data?.revision ?? 0),
  }
}

export async function listOpsVehicleHistory({ vehicleId, limit = 50, offset = 0 }) {
  const { data, error } = await supabase.rpc('ops_list_vehicle_history', {
    p_vehicle_id: vehicleId,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw new Error(error.message || 'Riwayat kendaraan gagal dimuat.')
  return (data ?? []).map(mapHistory)
}
