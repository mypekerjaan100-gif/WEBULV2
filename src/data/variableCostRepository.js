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
  const { data: versions } = await supabase.from('sla_versions').select('id').eq('contract_id', contractId).eq('up3_id', up3Id)
  if (!versions?.length) return []
  const versionIds = versions.map((v) => v.id)
  const { data, error } = await supabase.from('sla_indicators').select('id,point_code,legacy_key,measurement_unit,variable_cost_profile').in('sla_version_id', versionIds)
  if (error) throw new Error(error.message)
  return data ?? []
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
