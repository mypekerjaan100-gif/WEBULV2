import { effectiveEmploymentStatusOf } from './pensiunPelayananTeknik.js'

export const EMPLOYEE_EXPORT_COLUMN_OPTIONS = [
  { key: 'nip', label: 'NIP', width: 22 },
  { key: 'name', label: 'Nama', width: 32 },
  { key: 'unitName', label: 'Unit / ULP', width: 26 },
  { key: 'locationName', label: 'Lokasi Penempatan', width: 32 },
  { key: 'positionName', label: 'Jabatan', width: 30 },
  { key: 'birthDate', label: 'Tanggal Lahir', width: 18 },
  { key: 'status', label: 'Status', width: 16 },
  { key: 'employmentType', label: 'Jenis Perjanjian Kerja', width: 24 },
  { key: 'pension', label: 'Masa Pensiun', width: 34 },
]
export const EMPLOYEE_EXPORT_COLUMNS = ['No', ...EMPLOYEE_EXPORT_COLUMN_OPTIONS.map((column) => column.label)]

export function activeEmployeeExportRows(employees, date, pensionPolicy) {
  return employees.filter((employee) => effectiveEmploymentStatusOf(employee, date, pensionPolicy).status === 'Aktif')
}

export function filterEmployeeExportRows(employees, { unitId = '', locationId = '', positionId = '', positionIds = null, includeUnassignedPosition = false } = {}) {
  const matches = (value, selection) => !selection || (selection === '__none__' ? !value : value === selection)
  return employees.filter((employee) => matches(employee.unitId, unitId) &&
    matches(employee.workLocationId, locationId) &&
    (positionIds
      ? (employee.positionId ? positionIds.includes(employee.positionId) : includeUnassignedPosition)
      : matches(employee.positionId, positionId)))
}

export function employeeExportPositionOptions(positions, employees) {
  const usedIds = new Set(employees.map((employee) => employee.positionId).filter(Boolean))
  const eligible = [...new Map(positions
    .filter((position) => (position.status ?? 'Aktif') === 'Aktif' || usedIds.has(position.id))
    .map((position) => [position.id, position])).values()]
  const groups = new Map()
  for (const position of eligible) {
    const name = String(position.name ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ')
    const key = name.toLocaleLowerCase('id')
    const existing = groups.get(key)
    if (existing) {
      existing.positionIds.push(position.id)
      if ((position.status ?? 'Aktif') === 'Aktif') existing.status = 'Aktif'
    } else {
      groups.set(key, { ...position, name, status: position.status ?? 'Aktif', positionIds: [position.id] })
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'id'))
}

export function buildEmployeeOperationalWorkbook(XLSX, rows, selectedColumns = EMPLOYEE_EXPORT_COLUMN_OPTIONS.map((column) => column.key)) {
  const columns = EMPLOYEE_EXPORT_COLUMN_OPTIONS.filter((column) => selectedColumns.includes(column.key))
  if (!columns.length) throw new Error('Pilih minimal satu kolom data untuk diunduh.')
  const groups = new Map()
  for (const row of rows) {
    const key = JSON.stringify([row.unitId, row.locationId || null])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const workbook = XLSX.utils.book_new()
  const usedNames = new Set()
  const sortedGroups = [...groups.values()].sort((a, b) =>
    `${a[0].unitName} ${a[0].locationName}`.localeCompare(`${b[0].unitName} ${b[0].locationName}`, 'id'))
  for (const group of sortedGroups) {
    const first = group[0]
    const base = `${first.unitName} - ${first.locationName}`.replace(/[\\/?:*\[\]\x00-\x1f]/g, ' ').replace(/^'+|'+$/g, '').trim() || 'Pegawai'
    let name = base.slice(0, 31)
    let index = 2
    while (usedNames.has(name.toLowerCase())) {
      const suffix = ` (${index++})`
      name = base.slice(0, 31 - suffix.length) + suffix
    }
    usedNames.add(name.toLowerCase())
    const values = group.sort((a, b) => a.name.localeCompare(b.name, 'id')).map((row, i) => [
      i + 1, ...columns.map((column) => String(row[column.key] ?? '')),
    ])
    const sheet = XLSX.utils.aoa_to_sheet([['No', ...columns.map((column) => column.label)], ...values])
    sheet['!cols'] = [6, ...columns.map((column) => column.width)].map((wch) => ({ wch }))
    sheet['!autofilter'] = { ref: sheet['!ref'] }
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  }
  return workbook
}
