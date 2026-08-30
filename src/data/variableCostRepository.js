import { supabase } from '../lib/supabaseClient.js'
import { variableCostLabelsByCode } from './slaPelayananTeknik.js'

const STATUS_LABEL = {
  PENDING: 'Menunggu Persetujuan',
  ACTIVE: 'Aktif',
  REJECTED: 'Ditolak',
  INACTIVE: 'Nonaktif',
}

export function formatFeederStatus(status) {
  return STATUS_LABEL[status] ?? status
}

function rlsPhaseMessage(phase, err) {
  const msg = err?.message || String(err)
  const isRls = /row-level security|violates|permission|not allowed/i.test(msg)
  return isRls ? `[${phase}] ${msg}` : msg
}

async function rpc(name, params, phase) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) {
    const prefix = phase ? `[${phase}] ` : ''
    throw new Error(prefix + (error.message || `${name} gagal`))
  }
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

export async function fetchTargetVersions({ contractId, up3Id }) {
  const { data, error } = await supabase
    .from('sla_versions')
    .select('id,legacy_key,name,status,period_start,period_end')
    .eq('contract_id', contractId)
    .eq('up3_id', up3Id)
    .order('period_start', { ascending: false })
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

export async function fetchKonstruksiMonthlyAmounts({ contractId, up3Id, unitIds, periodMonth }) {
  if (!unitIds?.length) return []
  const { data, error } = await supabase
    .from('variable_cost_konstruksi_monthly_amounts')
    .select('id,unit_id,indicator_id,period_month,amount_rp,updated_at,updated_by')
    .eq('contract_id', contractId)
    .eq('up3_id', up3Id)
    .eq('period_month', periodMonth)
    .in('unit_id', unitIds)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function setKonstruksiMonthlyAmount({ contractId, up3Id, unitId, periodMonth, indicatorId, amountRp }) {
  return rpc('set_konstruksi_monthly_amount', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId,
    p_period_month: periodMonth,
    p_indicator_id: indicatorId,
    p_amount_rp: amountRp,
  }, 'KONSTRUKSI_MONTHLY_SAVE')
}

export async function setKonstruksiMonthlyAmounts({ contractId, up3Id, periodMonth, indicatorId, values }) {
  return rpc('set_konstruksi_monthly_amounts', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_period_month: periodMonth,
    p_indicator_id: indicatorId,
    p_values: values.map((value) => ({ unit_id: value.unitId, amount_rp: value.amountRp })),
  }, 'KONSTRUKSI_MONTHLY_SAVE')
}

export async function fetchApprovedVariableMonthlyEntries({ contractId, up3Id, unitIds, indicatorIds, periodMonth, versionId }) {
  if (!unitIds?.length || !indicatorIds?.length) return []
  const end = new Date(`${periodMonth}T00:00:00Z`)
  end.setUTCMonth(end.getUTCMonth() + 1)
  const { data, error } = await supabase.from('variable_cost_entries')
    .select('unit_id,indicator_id,measurement_unit,work_order,realization')
    .eq('contract_id', contractId).eq('up3_id', up3Id).eq('sla_version_id', versionId)
    .eq('status', 'APPROVED').in('unit_id', unitIds).in('indicator_id', indicatorIds)
    .gte('work_date', periodMonth).lt('work_date', end.toISOString().slice(0, 10))
  if (error) throw new Error(error.message)
  const aggregates = new Map()
  for (const row of data ?? []) {
    const key = `${row.unit_id}:${row.indicator_id}`
    const current = aggregates.get(key) ?? {
      unit_id: row.unit_id,
      indicator_id: row.indicator_id,
      measurement_unit: row.measurement_unit,
      work_order: 0,
      realization: 0,
      achievement: null,
      target_value: null,
    }
    current.work_order += Number(row.work_order ?? 0)
    current.realization += Number(row.realization ?? 0)
    aggregates.set(key, current)
  }
  return [...aggregates.values()]
}

export async function fetchIndicators({ contractId, up3Id, versionId }) {
  if (versionId) {
    const { data, error } = await supabase.from('sla_indicators').select('id,point_code,legacy_key,criteria,measurement_unit,variable_cost_profile,input_mode,sla_version_id').eq('sla_version_id', versionId)
    if (error) throw new Error(error.message)
    return data ?? []
  }
  const { data: versions } = await supabase.from('sla_versions').select('id').eq('contract_id', contractId).eq('up3_id', up3Id).eq('status', 'ACTIVE')
  if (!versions?.length) {
    const { data: anyVersions } = await supabase.from('sla_versions').select('id').eq('contract_id', contractId).eq('up3_id', up3Id).limit(1)
    if (!anyVersions?.length) return []
    const versionIds = anyVersions.map((v) => v.id)
    const { data, error } = await supabase.from('sla_indicators').select('id,point_code,legacy_key,criteria,measurement_unit,variable_cost_profile,input_mode,sla_version_id').in('sla_version_id', versionIds)
    if (error) throw new Error(error.message)
    return data ?? []
  }
  const versionIds = versions.map((v) => v.id)
  const { data, error } = await supabase.from('sla_indicators').select('id,point_code,legacy_key,criteria,measurement_unit,variable_cost_profile,input_mode,sla_version_id').in('sla_version_id', versionIds)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function fetchManualSlaTargets({ contractId, up3Id, unitId, periodMonth, versionId }) {
  const vid = versionId ?? await fetchReportingVersion({ contractId, up3Id, periodMonth })
  if (!vid) return {}
  const { data: indicatorRows } = await supabase.from('sla_indicators').select('id,legacy_key,point_code,input_mode').eq('sla_version_id', vid)
  const manualById = new Map((indicatorRows ?? []).filter((r) => r.input_mode === 'MANUAL').map((r) => [r.id, r.legacy_key]))
  const { data: targetRows, error } = await supabase.from('sla_targets').select('indicator_id,target_value').eq('contract_id', contractId).eq('up3_id', up3Id).eq('sla_version_id', vid).eq('period_month', periodMonth).eq('target_scope', 'ULP').eq('unit_id', unitId)
  if (error) throw new Error(error.message)
  const map = {}
  for (const row of targetRows ?? []) {
    const legacy = manualById.get(row.indicator_id)
    if (legacy) map[legacy] = row.target_value
  }
  return map
}

export async function setManualSlaTarget({ contractId, up3Id, unitId, versionId, indicatorId, periodMonth, targetValue }) {
  return rpc('set_manual_sla_target', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId,
    p_sla_version_id: versionId,
    p_indicator_id: indicatorId,
    p_period_month: periodMonth,
    p_target_value: targetValue,
  }, 'MANUAL_TARGET_SAVE')
}

export async function fetchActiveVersion({ contractId, up3Id, periodMonth }) {
  let query = supabase.from('sla_versions').select('id').eq('contract_id', contractId).eq('up3_id', up3Id).eq('status', 'ACTIVE')
  if (periodMonth) {
    const monthEnd = new Date(`${periodMonth}T00:00:00Z`)
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)
    monthEnd.setUTCDate(0)
    query = query.lte('period_start', monthEnd.toISOString().slice(0, 10)).gte('period_end', periodMonth)
  }
  const { data, error } = await query.limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return data?.id ?? null
}

async function fetchReportingVersion({ contractId, up3Id, periodMonth }) {
  const monthEnd = new Date(`${periodMonth}T00:00:00Z`)
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)
  monthEnd.setUTCDate(0)
  const { data, error } = await supabase.from('sla_versions').select('id,status,period_start')
    .eq('contract_id', contractId).eq('up3_id', up3Id).in('status', ['ACTIVE', 'ARCHIVED'])
    .lte('period_start', monthEnd.toISOString().slice(0, 10)).gte('period_end', periodMonth)
    .order('status').order('period_start', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return data?.id ?? null
}

export async function setVariableTarget({ contractId, up3Id, unitId, versionId, indicatorId, periodMonth, targetValue }) {
  return rpc('set_variable_target', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId,
    p_sla_version_id: versionId,
    p_indicator_id: indicatorId,
    p_period_month: periodMonth,
    p_target_value: targetValue,
  }, 'TARGET_SAVE')
}

export async function fetchVariableLinkedSlaTargets({ contractId, up3Id, unitId, periodMonth }) {
  const versionId = await fetchReportingVersion({ contractId, up3Id, periodMonth })
  if (!versionId) return {}
  const [targetRows, indicatorRows] = await Promise.all([
    unitId
      ? fetchMonthlyTargets({ contractId, up3Id, unitIds: [unitId], periodMonth, versionId })
      : fetchUp3Targets({ contractId, up3Id, periodMonth, versionId }),
    fetchIndicators({ contractId, up3Id, versionId }),
  ])
  const pointById = new Map(indicatorRows.map((row) => [row.id, row.point_code]))
  return Object.fromEntries(targetRows.flatMap((row) => {
    const point = pointById.get(row.indicator_id)
    return point ? [[point, row.target_value]] : []
  }))
}

export async function listDailyEntries({ contractId, up3Id, unitId, indicatorId, periodMonth }) {
  let query = supabase.from('variable_cost_entries').select('id,work_date,feeder_id,location_address,work_order,realization,description,rejection_reason,status,created_at,updated_at').eq('contract_id', contractId).eq('up3_id', up3Id).eq('unit_id', unitId).eq('indicator_id', indicatorId).order('work_date', { ascending: false })
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
  let indicator = null
  if (data?.indicator_id) {
    const { data: ind } = await supabase.from('sla_indicators').select('id,point_code,legacy_key,criteria,measurement_unit,variable_cost_profile').eq('id', data.indicator_id).maybeSingle()
    indicator = ind ?? null
  }
  return { entry: data, personnel: personnel ?? [], evidences: evidences ?? [], history: history ?? [], indicator }
}

export async function saveVariableEntry(params) {
  try {
    return await rpc('save_variable_cost_entry', {
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
    }, 'ENTRY_SAVE_RLS')
  } catch (e) {
    throw new Error(rlsPhaseMessage('ENTRY_SAVE_RLS', e))
  }
}

export async function submitVariableEntry(entryId) {
  try {
    return await rpc('submit_variable_cost_entry', { p_entry_id: entryId }, 'SUBMIT_RLS')
  } catch (e) {
    throw new Error(rlsPhaseMessage('SUBMIT_RLS', e))
  }
}

export async function uploadVariableEvidence({ entryId, file }) {
  let storagePath
  try {
    const { data: path, error: pathError } = await supabase.rpc('get_variable_evidence_upload_path', { p_entry_id: entryId, p_file_name: file.name })
    if (pathError) throw new Error(`[EVIDENCE_PATH_RLS] ${pathError.message}`)
    storagePath = path
  } catch (e) {
    throw new Error(rlsPhaseMessage('EVIDENCE_PATH_RLS', e))
  }
  try {
    const { error: uploadError } = await supabase.storage.from('variable-cost-evidence').upload(storagePath, file, { contentType: file.type, upsert: false })
    if (uploadError) throw new Error(uploadError.message)
  } catch (e) {
    throw new Error(rlsPhaseMessage('EVIDENCE_STORAGE_RLS', e))
  }
  try {
    const { error: insertError } = await supabase.from('variable_cost_evidence').insert({
      variable_cost_entry_id: entryId,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
    })
    if (insertError) throw new Error(insertError.message)
  } catch (e) {
    // clean up orphan storage object if metadata failed
    try { await supabase.storage.from('variable-cost-evidence').remove([storagePath]) } catch {}
    throw new Error(rlsPhaseMessage('EVIDENCE_METADATA_RLS', e))
  }
  return storagePath
}

export async function getEvidencePreviewUrl(storagePath) {
  const { data, error } = await supabase.storage.from('variable-cost-evidence').createSignedUrl(storagePath, 3600)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

export const SHORT_LABELS = variableCostLabelsByCode

export function getShortLabel(indicator) {
  if (!indicator) return '—'
  const code = indicator.point_code ?? indicator.point ?? indicator.legacy_key ?? ''
  return indicator.label ?? SHORT_LABELS[code] ?? code ?? '—'
}

export async function listSubmittedEntries({ contractId, up3Id }) {
  const { data, error } = await supabase.from('variable_cost_entries').select('id,work_date,unit_id,indicator_id,feeder_id,location_address,work_order,realization,status,created_at, feeders(name), sla_indicators(point_code,criteria,measurement_unit,legacy_key)').eq('contract_id', contractId).eq('up3_id', up3Id).eq('status', 'SUBMITTED').order('work_date', { ascending: false })
  if (error) {
    // fallback without join if FK not detected
    const { data: fallback, error: fallbackError } = await supabase.from('variable_cost_entries').select('id,work_date,unit_id,indicator_id,feeder_id,location_address,work_order,realization,status,created_at, feeders(name)').eq('contract_id', contractId).eq('up3_id', up3Id).eq('status', 'SUBMITTED').order('work_date', { ascending: false })
    if (fallbackError) throw new Error(fallbackError.message)
    const { data: konstruksiIndicators } = await supabase.from('sla_indicators').select('id').eq('point_code', '3.1c').eq('variable_cost_profile', 'KONSTRUKSI')
    const konstruksiIds = new Set((konstruksiIndicators ?? []).map((row) => row.id))
    return (fallback ?? []).filter((row) => !konstruksiIds.has(row.indicator_id))
  }
  return (data ?? []).filter((row) => row.sla_indicators?.point_code !== '3.1c')
}

export async function listRejectedEntries({ contractId, up3Id, unitId, periodMonth }) {
  let query = supabase.from('variable_cost_entries').select('id,work_date,unit_id,indicator_id,feeder_id,location_address,work_order,realization,rejection_reason,status,created_at, feeders(name), sla_indicators(point_code,criteria,measurement_unit,legacy_key)').eq('contract_id', contractId).eq('up3_id', up3Id).eq('status', 'REJECTED').order('work_date', { ascending: false })
  if (unitId) query = query.eq('unit_id', unitId)
  if (periodMonth) {
    const start = periodMonth
    const end = new Date(start)
    end.setMonth(end.getMonth() + 1)
    const endStr = end.toISOString().slice(0, 10)
    query = query.gte('work_date', start).lt('work_date', endStr)
  }
  const { data, error } = await query
  if (error) {
    let fallbackQuery = supabase.from('variable_cost_entries').select('id,work_date,unit_id,indicator_id,feeder_id,location_address,work_order,realization,rejection_reason,status,created_at, feeders(name)').eq('contract_id', contractId).eq('up3_id', up3Id).eq('status', 'REJECTED').order('work_date', { ascending: false })
    if (unitId) fallbackQuery = fallbackQuery.eq('unit_id', unitId)
    if (periodMonth) {
      const start = periodMonth
      const end = new Date(start)
      end.setMonth(end.getMonth() + 1)
      const endStr = end.toISOString().slice(0, 10)
      fallbackQuery = fallbackQuery.gte('work_date', start).lt('work_date', endStr)
    }
    const { data: fallback, error: fallbackError } = await fallbackQuery
    if (fallbackError) throw new Error(fallbackError.message)
    return fallback ?? []
  }
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
