import { supabase } from '../lib/supabaseClient.js'

function mapMaster(row) {
  return {
    id: row.id,
    contractId: row.contract_id,
    up3Id: row.up3_id,
    code: row.code,
    name: row.name,
    description: row.description ?? '',
    isActive: row.is_active !== false,
    sortOrder: row.sort_order ?? 0,
  }
}

function mapEquipment(row) {
  return {
    id: row.id,
    contractId: row.contract_id,
    up3Id: row.up3_id,
    code: row.code,
    name: row.name,
    categoryId: row.category_id,
    unit: row.unit ?? 'unit',
    ageMonths: row.age_months == null ? null : Number(row.age_months),
    specification: row.specification ?? '',
    description: row.description ?? '',
    isActive: row.is_active !== false,
    sortOrder: row.sort_order ?? 0,
  }
}

export function mapTemplate(row) {
  return {
    id: row.id,
    contractId: row.contract_id,
    up3Id: row.up3_id,
    templateCode: row.template_code,
    templateName: row.template_name,
    vehicleTypeId: row.vehicle_type_id,
    assignmentId: row.assignment_id,
    vehicleVariant: row.vehicle_variant ?? '',
    versionNumber: row.version_number ?? 1,
    revision: Number(row.revision ?? 1),
    effectiveFrom: row.effective_from ?? '',
    status: row.status ?? 'Draft',
    description: row.description ?? '',
    previousVersionId: row.previous_version_id ?? null,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
    publishedAt: row.published_at ?? '',
  }
}

function mapTemplateItem(row, equipmentById = new Map(), published = false) {
  const equipment = equipmentById.get(row.equipment_id) ?? null
  return {
    id: row.id,
    templateId: row.template_id,
    equipmentId: row.equipment_id,
    equipmentName: (published ? row.equipment_name : null) ?? equipment?.name ?? '',
    equipmentCode: (published ? row.equipment_code : null) ?? equipment?.code ?? '',
    categoryId: equipment?.categoryId ?? null,
    categoryName: (published ? row.equipment_category_name : null) ?? '',
    unit: (published ? row.equipment_unit : null) ?? equipment?.unit ?? 'unit',
    legacyMetadata: published && row.equipment_name == null,
    requiredQty: Number(row.required_qty ?? 0),
    note: row.note ?? '',
    sortOrder: row.sort_order ?? 0,
  }
}

const MASTER_TABLES = {
  vehicle_type: 'ops_vehicle_types',
  assignment: 'ops_vehicle_assignments',
  category: 'ops_equipment_categories',
}

export async function listOpsMasters(kind, { contractId, up3Id }) {
  const table = MASTER_TABLES[kind]
  if (!table) throw new Error('Jenis master tidak dikenal.')
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('contract_id', contractId)
    .eq('up3_id', up3Id)
    .order('sort_order')
    .order('code')
  if (error) throw new Error(error.message || 'Master gagal dimuat.')
  return (data ?? []).map(mapMaster)
}

export async function saveOpsMaster(kind, { id = null, contractId, up3Id, code, name, description = '', isActive = true }) {
  const { data, error } = await supabase.rpc('ops_save_master', {
    p_kind: kind,
    p_id: id,
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_code: code,
    p_name: name,
    p_description: description,
    p_is_active: isActive,
  })
  if (error) throw new Error(error.message || 'Master gagal disimpan.')
  return mapMaster(data)
}

export async function listOpsEquipment({ contractId, up3Id }) {
  const { data, error } = await supabase
    .from('ops_equipment_items')
    .select('*')
    .eq('contract_id', contractId)
    .eq('up3_id', up3Id)
    .order('sort_order')
    .order('code')
  if (error) throw new Error(error.message || 'Daftar peralatan gagal dimuat.')
  return (data ?? []).map(mapEquipment)
}

export async function saveOpsEquipment({ id = null, contractId, up3Id, code, name, categoryId, unit = 'unit', specification = '', description = '', isActive = true, ageMonths = null }) {
  const { data, error } = await supabase.rpc('ops_save_equipment_v2', {
    p_id: id,
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_code: code,
    p_name: name,
    p_category_id: categoryId,
    p_unit: unit,
    p_specification: specification,
    p_description: description,
    p_is_active: isActive,
    p_age_months: ageMonths,
  })
  if (error) throw new Error(error.message || 'Peralatan gagal disimpan.')
  return mapEquipment(data)
}

export async function importOpsEquipment({ contractId, up3Id, rows }) {
  const { data, error } = await supabase.rpc('ops_import_equipment', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_items: rows,
  })
  if (error) {
    if (error.code === '42501') throw new Error('Anda tidak memiliki izin mengimpor peralatan pada scope ini.')
    if (/Kategori tidak aktif/i.test(error.message || '')) throw new Error('Kategori tujuan tidak aktif. Petakan ke kategori aktif lain.')
    throw new Error(error.message || 'Peralatan gagal diimpor.')
  }
  return data
}

export async function listOpsTemplates({ contractId, up3Id }) {
  const { data, error } = await supabase
    .from('ops_equipment_templates')
    .select('*')
    .eq('contract_id', contractId)
    .eq('up3_id', up3Id)
    .order('template_name')
    .order('version_number', { ascending: false })
  if (error) throw new Error(error.message || 'Template gagal dimuat.')
  return (data ?? []).map(mapTemplate)
}

export async function listOpsTemplateItems(templateId, equipmentList = [], published = false) {
  const { data, error } = await supabase
    .from('ops_equipment_template_items')
    .select('*')
    .eq('template_id', templateId)
    .order('sort_order')
  if (error) throw new Error(error.message || 'Detail template gagal dimuat.')
  const equipmentById = new Map((equipmentList ?? []).map((item) => [item.id, item]))
  return (data ?? []).map((row) => mapTemplateItem(row, equipmentById, published))
}

export async function saveOpsTemplateDraft({ id = null, contractId, up3Id, templateName, vehicleTypeId, assignmentId, vehicleVariant = '', effectiveFrom = null, description = '', items = [] }) {
  const { data, error } = await supabase.rpc('ops_save_template_draft', {
    p_id: id,
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_template_name: templateName,
    p_vehicle_type_id: vehicleTypeId,
    p_assignment_id: assignmentId,
    p_vehicle_variant: vehicleVariant,
    p_effective_from: effectiveFrom,
    p_description: description,
    p_items: items.map((item) => ({
      equipment_id: item.equipmentId,
      required_qty: item.requiredQty,
      note: item.note ?? '',
    })),
  })
  if (error) throw new Error(error.message || 'Template gagal disimpan.')
  return mapTemplate(data)
}

export async function updateOpsActiveTemplate({ id, contractId, up3Id, expectedRevision, description = '', items = [] }) {
  const { data, error } = await supabase.rpc('ops_update_active_template', {
    p_id: id,
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_expected_revision: expectedRevision,
    p_description: description,
    p_items: items.map((item) => ({
      equipment_id: item.equipmentId,
      required_qty: item.requiredQty,
      note: item.note ?? '',
    })),
  })
  if (error) {
    const failure = new Error(error.message || 'Template gagal diperbarui.')
    failure.code = error.code
    throw failure
  }
  return mapTemplate(data)
}

export async function publishOpsTemplate(templateId) {
  const { data, error } = await supabase.rpc('ops_publish_template', { p_template_id: templateId })
  if (error) throw new Error(error.message || 'Template gagal diterbitkan.')
  return mapTemplate(data)
}

export async function archiveOpsTemplate(templateId) {
  const { data, error } = await supabase.rpc('ops_archive_template', { p_template_id: templateId })
  if (error) throw new Error(error.message || 'Template gagal diarsipkan.')
  return mapTemplate(data)
}

export async function duplicateOpsTemplate(templateId) {
  const { data, error } = await supabase.rpc('ops_duplicate_template', { p_template_id: templateId })
  if (error) throw new Error(error.message || 'Template gagal diduplikasi.')
  return mapTemplate(data)
}
