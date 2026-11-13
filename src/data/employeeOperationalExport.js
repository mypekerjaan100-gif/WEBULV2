export const EMPLOYEE_EXPORT_COLUMNS = ['No', 'NIP', 'Nama', 'Unit / ULP', 'Lokasi Penempatan', 'Jabatan', 'Tanggal Lahir', 'Status', 'Jenis Perjanjian Kerja', 'Masa Pensiun']

export function buildEmployeeOperationalWorkbook(XLSX, rows) {
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
      i + 1, String(row.nip ?? ''), row.name, row.unitName, row.locationName,
      row.positionName, row.birthDate, row.status, row.employmentType, row.pension,
    ])
    const sheet = XLSX.utils.aoa_to_sheet([EMPLOYEE_EXPORT_COLUMNS, ...values])
    sheet['!cols'] = [6, 22, 32, 26, 32, 30, 18, 16, 24, 34].map((wch) => ({ wch }))
    sheet['!autofilter'] = { ref: sheet['!ref'] }
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  }
  return workbook
}
