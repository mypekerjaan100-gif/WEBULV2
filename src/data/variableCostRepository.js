import { supabase } from '../lib/supabaseClient.js'

const STATUS_LABEL = {
  PENDING: 'Menunggu Persetujuan',
  ACTIVE: 'Aktif',
  REJECTED: 'Ditolak',
  INACTIVE: 'Nonaktif',
}

export function formatFeederStatus(status) {
  return STATUS_LABEL[status] ?? status
}

async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw new Error(error.message || `${name} gagal`)
  return data
}

// Feeders - scoped reads via RLS, writes via RPC
export async function listFeeders({ contractId, up3Id, unitId }) {
  let query = supabase.from('feeders').select('*').eq('contract_id', contractId).eq('up3_id', up3Id).order('name')
  if (unitId) query = query.eq('unit_id', unitId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function listActiveFeeders({ contractId, up3Id, unitId }) {
  let query = supabase.from('feeders').select('id,name,unit_id,status').eq('contract_id', contractId).eq('up3_id', up3Id).eq('status', 'ACTIVE').order('name')
  if (unitId) query = query.eq('unit_id', unitId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function proposeFeeder({ contractId, up3Id, unitId, name, code }) {
  return rpc('create_feeder_proposal', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId,
    p_name: name,
    p_code: code ?? null,
  })
}

export async function createFeederDirect({ contractId, up3Id, unitId, name, code }) {
  return rpc('create_feeder_direct', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId,
    p_name: name,
    p_code: code ?? null,
  })
}

export async function approveFeeder(feederId) {
  return rpc('approve_feeder', { p_feeder_id: feederId })
}
export async function rejectFeeder(feederId, reason) {
  return rpc('reject_feeder', { p_feeder_id: feederId, p_reason: reason })
}
export async function deactivateFeeder(feederId) {
  return rpc('deactivate_feeder', { p_feeder_id: feederId })
}
export async function activateFeeder(feederId) {
  return rpc('activate_feeder', { p_feeder_id: feederId })
}
export async function deleteFeeder(feederId) {
  return rpc('delete_feeder', { p_feeder_id: feederId })
}

// Monthly aggregation + targets - real Supabase reads
export async function fetchMonthlyTargets({ contractId, up3Id, unitIds, periodMonth, versionId }) {
  let query = supabase.from('sla_targets').select('unit_id,indicator_id,target_value').eq('contract_id', contractId).eq('up3_id', up3Id).eq('period_month', periodMonth)
  if (versionId) query = query.eq('sla_version_id', versionId)
  if (unitIds?.length) query = query.in('unit_id', unitIds)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function fetchUp3Targets({ contractId, up3Id, periodMonth, versionId }) {
  let query = supabase.from('sla_targets').select('indicator_id,target_value').eq('contract_id', contractId).eq('up3_id', up3Id).eq('period_month', periodMonth).is('unit_id', null)
  if (versionId) query = query.eq('sla_version_id', versionId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function fetchMonthlyEntries({ contractId, up3Id, unitIds, periodMonth, versionId }) {
  let query = supabase.from('sla_entries').select('unit_id,indicator_id,work_order,realization,achievement,target_value,measurement_unit').eq('contract_id', contractId).eq('up3_id', up3Id).eq('period_month', periodMonth).eq('source_type', 'VARIABLE_COST_AGGREGATE')
  if (versionId) query = query.eq('sla_version_id', versionId)
  if (unitIds?.length) query = query.in('unit_id', unitIds)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function fetchIndicators({ contractId, up3Id }) {
  const { data: versions } = await supabase.from('sla_versions').select('id').eq('contract_id', contractId).eq('up3_id', up3Id).eq('status', 'ACTIVE')
  if (!versions?.length) {
    const { data: anyVersions } = await supabase.from('sla_versions').select('id').eq('contract_id', contractId).eq('up3_id', up3Id).limit(1)
    if (!anyVersions?.length) return []
    const versionIds = anyVersions.map((v) => v.id)
    const { data, error } = await supabase.from('sla_indicators').select('id,point_code,legacy_key,measurement_unit,variable_cost_profile,sla_version_id').in('sla_version_id', versionIds)
    if (error) throw new Error(error.message)
    return data ?? []
  }
  const versionIds = versions.map((v) => v.id)
  const { data, error } = await supabase.from('sla_indicators').select('id,point_code,legacy_key,measurement_unit,variable_cost_profile,sla_version_id').in('sla_version_id', versionIds)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function fetchActiveVersion({ contractId, up3Id }) {
  const { data, error } = await supabase.from('sla_versions').select('id').eq('contract_id', contractId).eq('up3_id', up3Id).eq('status', 'ACTIVE').limit(1).single()
  if (error) return null
  return data?.id ?? null
}

export async function listDailyEntries({ contractId, up3Id, unitId, indicatorId, periodMonth }) {
  let query = supabase.from('variable_cost_entries').select('id,work_date,feeder_id,location_address,work_order,realization,description,status,created_at,updated_at').eq('contract_id', contractId).eq('up3_id', up3Id).eq('unit_id', unitId).eq('indicator_id', indicatorId).order('work_date', { ascending: false })
  if (periodMonth) {
    const start = periodMonth
    const end = new Date(start)
    end.setMonth(end.getMonth() + 1)
    const endStr = end.toISOString().slice(0, 10)
    query = query.gte('work_date', start).lt('work_date', endStr)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getVariableDetail(entryId) {
  const { data, error } = await supabase.from('variable_cost_entries').select('*, feeders(name)').eq('id', entryId).single()
  if (error) throw new Error(error.message)
  const { data: personnel } = await supabase.from('variable_cost_entry_personnel').select('employee_id, employees(name)').eq('variable_cost_entry_id', entryId)
  const { data: evidences } = await supabase.from('variable_cost_evidence').select('*').eq('variable_cost_entry_id', entryId)
  const { data: history } = await supabase.from('variable_cost_status_history').select('*').eq('variable_cost_entry_id', entryId).order('changed_at', { ascending: true })
  return { entry: data, personnel: personnel ?? [], evidences: evidences ?? [], history: history ?? [] }
}

export async function saveVariableEntry(params) {
  return rpc('save_variable_cost_entry', {
    p_entry_id: params.entryId ?? null,
    p_contract_id: params.contractId,
    p_up3_id: params.up3Id,
    p_unit_id: params.unitId,
    p_sla_version_id: params.slaVersionId,
    p_indicator_id: params.indicatorId,
    p_work_date: params.workDate,
    p_feeder_id: params.feederId ?? null,
    p_location_address: params.locationAddress ?? null,
    p_work_order: params.workOrder ?? null,
    p_realization: params.realization ?? null,
    p_revenue_amount: params.revenueAmount ?? null,
    p_description: params.description ?? null,
    p_employee_ids: params.employeeIds ?? null,
  })
}

export async function submitVariableEntry(entryId) {
  return rpc('submit_variable_cost_entry', { p_entry_id: entryId })
}

export async function uploadVariableEvidence({ entryId, file }) {
  const { data: path, error: pathError } = await supabase.rpc('get_variable_evidence_upload_path', { p_entry_id: entryId, p_file_name: file.name })
  if (pathError) throw new Error(pathError.message)
  const storagePath = path
  const { error: uploadError } = await supabase.storage.from('variable-cost-evidence').upload(storagePath, file, { contentType: file.type, upsert: false })
  if (uploadError) throw new Error(uploadError.message)
  const { error: insertError } = await supabase.from('variable_cost_evidence').insert({
    variable_cost_entry_id: entryId,
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.type || 'application/octet-stream',
    size_bytes: file.size,
  })
  if (insertError) throw new Error(insertError.message)
  return storagePath
}

export async function getEvidencePreviewUrl(storagePath) {
  const { data, error } = await supabase.storage.from('variable-cost-evidence').createSignedUrl(storagePath, 3600)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

export const SHORT_LABELS = {
  '2.1a': 'Inspeksi SUTM Tier 1',
  '2.1b': 'Inspeksi SUTM Tier 2',
  '2.1c': 'Inspeksi Gardu/Keypoint Tier 1',
  '2.1d': 'Inspeksi Gardu/Keypoint Tier 2',
  '3.1a': 'ROW Fix',
  '3.1b': 'ROW Var',
  '3.2a': 'Pengukuran Gardu',
  '3.2b': 'Pemeliharaan Gardu',
  '3.1c': 'Konstruksi',
}

export function getShortLabel(indicator) {
  if (!indicator) return '—'
  const code = indicator.point_code ?? indicator.point ?? indicator.legacy_key ?? ''
  return SHORT_LABELS[code] ?? code ?? '—'
}

export async function listSubmittedEntries({ contractId, up3Id }) {
  const { data, error } = await supabase.from('variable_cost_entries').select('id,work_date,unit_id,indicator_id,feeder_id,location_address,work_order,realization,status,created_at, feeders(name)').eq('contract_id', contractId).eq('up3_id', up3Id).eq('status', 'SUBMITTED').order('work_date', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function approveVariableEntry(entryId) {
  return rpc('approve_variable_cost_entry', { p_entry_id: entryId })
}

export async function rejectVariableEntry(entryId, reason) {
  return rpc('reject_variable_cost_entry', { p_entry_id: entryId, p_reason: reason })
}

// Helper to resolve period label to YYYY-MM-01
const MONTH_MAP = {
  Januari: '01', Februari: '02', Maret: '03', April: '04', Mei: '05', Juni: '06',
  Juli: '07', Agustus: '08', September: '09', Oktober: '10', November: '11', Desember: '12',
}
export function periodLabelToMonth(label) {
  if (!label) return null
  const [monthName, year] = label.split(' ')
  const mm = MONTH_MAP[monthName]
  if (!mm || !year) return null
  return `${year}-${mm}-01`
}
