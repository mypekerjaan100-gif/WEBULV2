import { currentLocationNameOf } from './lokasiPelayananTeknik.js'

export const UNRESOLVED_EMPLOYEE_DIRECTORY_VALUE = 'Belum Ditentukan'

function isEffectiveOn(entry, date) {
  const from = entry.validFrom ?? ''
  const to = entry.validTo ?? ''
  return (from === '' || date >= from) && (to === '' || date < to)
}

function historyValueAt(history, valueKey, date, currentValue) {
  const entries = Array.isArray(history) ? history : []
  if (!entries.length) return currentValue ?? null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) return null
  return entries.find((entry) => isEffectiveOn(entry, date))?.[valueKey] ?? null
}

export function employeeDirectoryAssignmentAt(employee, date) {
  return {
    positionId: historyValueAt(employee?.positionHistory, 'positionId', date, employee?.positionId),
    workLocationId: historyValueAt(employee?.workLocationHistory, 'workLocationId', date, employee?.workLocationId),
  }
}

export function workLocationNameAt(location, date, unitName = '') {
  if (!location) return null

  const history = Array.isArray(location.nameHistory) ? location.nameHistory : []
  const hasValidDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))
  const historicalName = hasValidDate
    ? history.find((entry) => isEffectiveOn(entry, date))?.name
    : null
  const currentName = currentLocationNameOf(location)
  const name = historicalName || (!hasValidDate || !history.length ? currentName : '')
  if (name) return name

  if (location.type === 'UNIT_OFFICE' && unitName) return unitName
  return location.legacyKey || location.id || null
}
