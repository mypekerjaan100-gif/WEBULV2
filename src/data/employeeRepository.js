import { supabase } from '../lib/supabaseClient.js'

const UNRESOLVED_POSITION = 'Belum Ditentukan'
const UNRESOLVED_LOCATION = 'Belum Ditentukan'

function mapEmployeeRow(row, { unitName, positionName, locationName }) {
  return {
    id: row.id,
    nip: row.nip,
    name: row.name,
    birthDate: row.birth_date ?? '',
    bank: row.bank ?? '',
    accountNumber: row.account_number ?? '',
    sourcePosition: row.source_position ?? null,
    retirementDateOverride: row.retirement_date_override ?? null,
    pensionOverrideReason: row.pension_override_reason ?? null,
    createdAt: row.created_at,
    _unitName: unitName,
    _positionName: positionName,
    _locationName: locationName,
  }
}

function mapHistoryEntry(row, fieldMap) {
  const mapped = { id: row.id }
  for (const [dbCol, jsProp] of Object.entries(fieldMap)) {
    mapped[jsProp] = row[dbCol] ?? null
  }
  mapped.validFrom = row.effective_from
  mapped.validTo = row.effective_to ?? null
  return mapped
}

function resolveCurrentEntry(history, today) {
  if (!history.length) return null
  const sorted = [...history].sort((a, b) =>
    (a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1,
  )
  return (
    sorted.find((e) => {
      const from = e.validFrom ?? ''
      const to = e.validTo ?? ''
      return (from === '' || today >= from) && (to === '' || today < to)
    }) ?? sorted[sorted.length - 1]
  )
}

export async function fetchEmployeesFromSupabase({ hasSensitiveRead = false } = {}) {
  const today = new Date().toISOString().slice(0, 10)

  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('*')
    .order('nip')

  if (empErr) throw empErr

  if (!employees?.length) {
    return { employees: [], total: 0 }
  }

  const employeeIds = employees.map((e) => e.id)

  const [unitHist, posHist, statusHist, rateHist, locHist] = await Promise.all([
    supabase.from('employee_unit_history').select('*').in('employee_id', employeeIds),
    supabase.from('employee_position_history').select('*').in('employee_id', employeeIds),
    supabase.from('employee_status_history').select('*').in('employee_id', employeeIds),
    supabase.from('employee_hourly_rate_history').select('*').in('employee_id', employeeIds),
    supabase.from('employee_work_location_history').select('*').in('employee_id', employeeIds),
  ])

  const histByEmployee = (rows, fieldMap) => {
    const grouped = {}
    for (const row of (rows.data ?? [])) {
      ;(grouped[row.employee_id] ??= []).push(mapHistoryEntry(row, fieldMap))
    }
    return grouped
  }

  const unitHistByEmp = histByEmployee(unitHist, { unit_id: 'unitId' })
  const posHistByEmp = histByEmployee(posHist, { position_id: 'positionId' })
  const statusHistByEmp = histByEmployee(statusHist, {
    status: 'status',
    reason: 'reason',
    reason_note: 'note',
  })
  const rateHistByEmp = histByEmployee(rateHist, { hourly_rate: 'rate' })
  const locHistByEmp = histByEmployee(locHist, { location_id: 'workLocationId' })

  const result = employees.map((emp) => {
    const unitHistory = (unitHistByEmp[emp.id] ?? []).sort((a, b) =>
      (a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1,
    )
    const positionHistory = (posHistByEmp[emp.id] ?? []).sort((a, b) =>
      (a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1,
    )
    const statusHistory = (statusHistByEmp[emp.id] ?? []).sort((a, b) =>
      (a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1,
    )
    const hourlyRateHistory = (rateHistByEmp[emp.id] ?? []).sort((a, b) =>
      (a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1,
    )
    const workLocationHistory = (locHistByEmp[emp.id] ?? []).sort((a, b) =>
      (a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1,
    )

    const currentUnit = resolveCurrentEntry(unitHistory, today)
    const currentPosition = resolveCurrentEntry(positionHistory, today)
    const currentStatus = resolveCurrentEntry(statusHistory, today)
    const currentRate = resolveCurrentEntry(hourlyRateHistory, today)
    const currentLocation = resolveCurrentEntry(workLocationHistory, today)

    const mapped = mapEmployeeRow(emp, {
      unitName: currentUnit?.unitId ?? null,
      positionName: currentPosition?.positionId ?? null,
      locationName: currentLocation?.workLocationId ?? null,
    })

    mapped.contractId = currentUnit?.contractId ?? null
    mapped.up3Id = currentUnit?.up3Id ?? null
    mapped.unitId = currentUnit?.unitId ?? null
    mapped.positionId = currentPosition?.positionId ?? null
    mapped.workLocationId = currentLocation?.workLocationId ?? null
    mapped.employmentStatus = currentStatus?.status ?? 'Aktif'
    mapped.statusReason = currentStatus?.reason ?? null
    mapped.statusReasonNote = currentStatus?.note ?? null
    mapped.statusEffectiveDate = currentStatus?.effectiveDate ?? null
    mapped.hourlyRate = currentRate?.rate ?? 0

    mapped.unitHistory = unitHistory.map((e) => ({
      id: e.id,
      unitId: e.unitId,
      contractId: currentUnit?.contractId ?? null,
      up3Id: currentUnit?.up3Id ?? null,
      validFrom: e.validFrom,
      validTo: e.validTo,
    }))
    mapped.positionHistory = positionHistory.map((e) => ({
      id: e.id,
      positionId: e.positionId,
      validFrom: e.validFrom,
      validTo: e.validTo,
    }))
    mapped.workLocationHistory = workLocationHistory.map((e) => ({
      id: e.id,
      workLocationId: e.workLocationId,
      validFrom: e.validFrom,
      validTo: e.validTo,
    }))
    mapped.statusHistory = statusHistory.map((e) => ({
      id: e.id,
      status: e.status,
      reason: e.reason,
      note: e.note,
      effectiveDate: e.effectiveDate,
      validFrom: e.validFrom,
      validTo: e.validTo,
    }))
    mapped.hourlyRateHistory = hourlyRateHistory.map((e) => ({
      id: e.id,
      rate: e.rate,
      validFrom: e.validFrom,
      validTo: e.validTo,
    }))

    if (!hasSensitiveRead) {
      mapped.bank = ''
      mapped.accountNumber = ''
    }

    return mapped
  })

  return { employees: result, total: result.length }
}

export async function fetchPositionsFromSupabase() {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function fetchLocationsFromSupabase() {
  const { data, error } = await supabase
    .from('locations')
    .select('id, legacy_key, contract_id, up3_id, unit_id, type, own_status')
    .order('legacy_key')
  if (error) throw error
  return (data ?? []).map((location) => ({
    id: location.id,
    legacyKey: location.legacy_key,
    contractId: location.contract_id,
    up3Id: location.up3_id,
    unitId: location.unit_id,
    type: location.type,
    ownStatus: location.own_status,
    nameHistory: [],
  }))
}

export async function fetchOrganizationUnitsFromSupabase() {
  const { data, error } = await supabase
    .from('organization_units')
    .select('*')
    .order('name')
  if (error) throw error
  return data ?? []
}

export { UNRESOLVED_POSITION, UNRESOLVED_LOCATION }
