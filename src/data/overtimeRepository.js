import { supabase } from '../lib/supabaseClient.js'

function mapOvertimeEntry(row) {
  return {
    id: row.id,
    contractId: row.contract_id,
    up3Id: row.up3_id,
    unitId: row.unit_id,
    employeeId: row.employee_id,
    employeeName: row.employee_name_snapshot,
    date: row.work_date,
    period: String(row.period_month ?? '').slice(0, 7),
    hours: Number(row.hours),
    rate: Number(row.hourly_rate_snapshot),
    total: Number(row.calculated_amount_snapshot),
    keterangan: row.description ?? '',
  }
}

export async function listOvertimeEntries({ contractId, up3Id, unitId, periodMonth }) {
  let query = supabase
    .from('overtime_entries')
    .select(
      'id, contract_id, up3_id, unit_id, employee_id, work_date, period_month, hours, description, employee_name_snapshot, hourly_rate_snapshot, calculated_amount_snapshot',
    )
    .eq('contract_id', contractId)
    .eq('up3_id', up3Id)
    .order('work_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (unitId) query = query.eq('unit_id', unitId)
  if (periodMonth) query = query.eq('period_month', periodMonth)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(mapOvertimeEntry)
}

export async function saveOvertimeEntry({
  id = null,
  contractId,
  up3Id,
  unitId,
  employeeId,
  date,
  hours,
  keterangan,
}) {
  const { data, error } = await supabase.rpc('save_overtime_entry_authenticated', {
    p_entry_id: id,
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId,
    p_employee_id: employeeId,
    p_work_date: date,
    p_hours: hours,
    p_description: keterangan ?? '',
    p_legacy_key: null,
  })
  if (error) throw error
  return mapOvertimeEntry(data)
}

export async function deleteOvertimeEntry({ id, contractId, up3Id, unitId }) {
  const { error } = await supabase.rpc('delete_overtime_entry_authenticated', {
    p_entry_id: id,
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId,
  })
  if (error) throw error
}
