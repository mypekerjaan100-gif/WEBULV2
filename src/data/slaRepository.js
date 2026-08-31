import { supabase } from '../lib/supabaseClient.js'

const VERSION_COLUMNS = [
  'id',
  'legacy_key',
  'contract_id',
  'up3_id',
  'name',
  'parent_contract_number',
  'addendum_number',
  'effective_date',
  'period_start',
  'period_end',
  'status',
  'previous_active_version_id',
  'source',
  'source_version_id',
  'notes',
  'first_used_at',
  'created_at',
  'updated_at',
  'revision',
].join(',')

function monthEnd(periodMonth) {
  const date = new Date(`${periodMonth}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  date.setUTCDate(0)
  return date.toISOString().slice(0, 10)
}

function newestVersion(a, b) {
  return String(b.effective_date ?? '').localeCompare(String(a.effective_date ?? ''))
    || Number(b.revision ?? 0) - Number(a.revision ?? 0)
    || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
    || String(b.id).localeCompare(String(a.id))
}

export async function fetchSlaVersions({ contractId, up3Id }) {
  const { data, error } = await supabase
    .from('sla_versions')
    .select(VERSION_COLUMNS)
    .eq('contract_id', contractId)
    .eq('up3_id', up3Id)
    .order('effective_date', { ascending: false })
    .order('revision', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function resolveReportingVersionByMonth({ contractId, up3Id, periodMonth }) {
  const { data, error } = await supabase
    .from('sla_versions')
    .select(VERSION_COLUMNS)
    .eq('contract_id', contractId)
    .eq('up3_id', up3Id)
    .in('status', ['ACTIVE', 'ARCHIVED'])
    .lte('period_start', monthEnd(periodMonth))
    .gte('period_end', periodMonth)
  if (error) throw new Error(error.message)
  const rows = data ?? []
  return [...rows.filter((row) => row.status === 'ACTIVE')].sort(newestVersion)[0]
    ?? [...rows.filter((row) => row.status === 'ARCHIVED')].sort(newestVersion)[0]
    ?? null
}

export async function fetchSlaIndicators({ versionId }) {
  const { data, error } = await supabase
    .from('sla_indicators')
    .select('id,legacy_key,point_code,input_mode,variable_cost_profile')
    .eq('sla_version_id', versionId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({ ...row, profile: row.variable_cost_profile }))
}

export async function fetchSlaTargets({ contractId, up3Id, versionId, periodMonth }) {
  const { data, error } = await supabase
    .from('sla_targets')
    .select('id,unit_id,indicator_id,target_scope,target_value')
    .eq('contract_id', contractId)
    .eq('up3_id', up3Id)
    .eq('sla_version_id', versionId)
    .eq('period_month', periodMonth)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function fetchSlaEntries({ contractId, up3Id, versionId, periodMonth, unitIds }) {
  let query = supabase
    .from('sla_entries')
    .select('id,unit_id,indicator_id,source_type,measurement_unit,work_order,realization,achievement')
    .eq('contract_id', contractId)
    .eq('up3_id', up3Id)
    .eq('sla_version_id', versionId)
    .eq('period_month', periodMonth)
  if (unitIds?.length) query = query.in('unit_id', unitIds)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function saveManualSlaEntry({
  contractId,
  up3Id,
  unitId,
  versionId,
  indicatorId,
  periodMonth,
  measurementUnit,
  workOrder,
  realization,
  achievement,
}) {
  const { data, error } = await supabase.rpc('save_manual_sla_entry', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId,
    p_sla_version_id: versionId,
    p_indicator_id: indicatorId,
    p_period_month: periodMonth,
    p_measurement_unit: measurementUnit || null,
    p_work_order: workOrder,
    p_realization: realization,
    p_achievement: achievement,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function setManualSlaUp3Target({
  contractId,
  up3Id,
  versionId,
  indicatorId,
  periodMonth,
  targetValue,
}) {
  const { data, error } = await supabase.rpc('set_manual_sla_up3_target', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_sla_version_id: versionId,
    p_indicator_id: indicatorId,
    p_period_month: periodMonth,
    p_target_value: targetValue,
  })
  if (error) throw new Error(error.message)
  return data
}
