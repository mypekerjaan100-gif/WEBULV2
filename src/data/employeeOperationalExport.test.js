import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { activeEmployeeExportRows, buildEmployeeOperationalWorkbook, EMPLOYEE_EXPORT_COLUMNS, employeeExportPositionOptions, filterEmployeeExportRows } from './employeeOperationalExport.js'

assert.deepEqual(activeEmployeeExportRows([
  { id: 'active', employmentStatus: 'Aktif' },
  ...['Resign', 'PHK', 'Pensiun', 'Lainnya'].map((statusReason) => ({ id: statusReason, employmentStatus: 'Nonaktif', statusReason })),
  { id: 'retired-today', employmentStatus: 'Aktif', retirementDateOverride: '2026-11-13' },
  { id: 'retired-before', employmentStatus: 'Aktif', retirementDateOverride: '2026-11-12' },
  { id: 'future-retirement', employmentStatus: 'Aktif', retirementDateOverride: '2026-11-14' },
], '2026-11-13', null).map((employee) => employee.id), ['active', 'future-retirement'])

const employees = [
  { id: 'a', unitId: 'u1', workLocationId: 'l1', positionId: 'yantek' },
  { id: 'b', unitId: 'u1', workLocationId: 'l1', positionId: 'other' },
  { id: 'c', unitId: 'u2', workLocationId: 'l2', positionId: 'yantek' },
  { id: 'd', unitId: 'u1', workLocationId: null, positionId: null },
]
assert.equal(filterEmployeeExportRows(employees).length, 4)
assert.deepEqual(filterEmployeeExportRows(employees, { positionId: 'yantek' }).map((e) => e.id), ['a', 'c'])
assert.deepEqual(filterEmployeeExportRows(employees, { unitId: 'u1', locationId: 'l1', positionId: 'yantek' }).map((e) => e.id), ['a'])
assert.deepEqual(filterEmployeeExportRows(employees, { positionId: '__none__' }).map((e) => e.id), ['d'])
assert.equal(filterEmployeeExportRows(employees, { unitId: 'u2', positionId: 'other' }).length, 0)
assert.deepEqual(employeeExportPositionOptions([
  { id: 'yantek', name: 'Pelayanan Teknik', status: 'Aktif' },
  { id: 'other', name: 'Jabatan Lama', status: 'Nonaktif' },
  { id: 'unused', name: 'Tidak Dipakai', status: 'Nonaktif' },
], employees).map((p) => p.id), ['other', 'yantek'])

const duplicatePositions = employeeExportPositionOptions([
  { id: 'old', name: '  Pelayanan   Teknik ', status: 'Nonaktif' },
  { id: 'new', name: 'PELAYANAN TEKNIK', status: 'Aktif' },
  { id: 'retired', name: 'Jabatan Lama', status: 'Nonaktif' },
], [{ positionId: 'old' }, { positionId: 'retired' }])
assert.equal(duplicatePositions.length, 2)
const technical = duplicatePositions.find((option) => option.positionIds.includes('new'))
assert.deepEqual(technical.positionIds, ['old', 'new'])
assert.equal(technical.status, 'Aktif')
assert.equal(technical.name, 'Pelayanan Teknik')
assert.equal(duplicatePositions.find((option) => option.id === 'retired').status, 'Nonaktif')
const groupedEmployees = [
  { id: 'old-employee', positionId: 'old', unitId: 'u1', workLocationId: 'l1' },
  { id: 'new-employee', positionId: 'new', unitId: 'u1', workLocationId: 'l1' },
  { id: 'other-unit', positionId: 'new', unitId: 'u2', workLocationId: 'l2' },
  { id: 'unrelated', positionId: 'retired', unitId: 'u1', workLocationId: 'l1' },
]
assert.deepEqual(filterEmployeeExportRows(groupedEmployees, {
  positionIds: technical.positionIds, unitId: 'u1', locationId: 'l1',
}).map((employee) => employee.id), ['old-employee', 'new-employee'])

const base = {
  unitId: 'ulp-1', locationId: 'loc-1', unitName: 'ULP Nama Unit Sangat Panjang Sekali',
  locationName: 'Lokasi / Satu', nip: '00001234', name: '=Nama Pegawai',
  positionName: 'Petugas', birthDate: '1990-01-01', status: 'Aktif',
  employmentType: 'PKWT', pension: 'Belum Pensiun',
  bank: 'RAHASIA', accountNumber: 'RAHASIA', hourlyRate: 999999,
}
const workbook = buildEmployeeOperationalWorkbook(XLSX, [
  base,
  { ...base, nip: '00005678', name: 'Budi' },
  { ...base, locationId: 'loc-2', locationName: 'Lokasi : Dua' },
  { ...base, unitId: 'up3', unitName: 'Kantor UP3', locationId: null, locationName: 'Belum Ditentukan' },
])
const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
const parsed = XLSX.read(bytes, { type: 'array' })
assert.equal(parsed.SheetNames.length, 3, 'Kelompok ditentukan oleh ID unit/lokasi')
assert.equal(new Set(parsed.SheetNames.map((name) => name.toLowerCase())).size, 3)
for (const name of parsed.SheetNames) {
  assert.ok(name.length <= 31)
  assert.ok(!/[\\/?:*\[\]]/.test(name))
  const sheet = parsed.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })
  assert.deepEqual(rows[0], EMPLOYEE_EXPORT_COLUMNS)
  assert.ok(!JSON.stringify(rows).includes('RAHASIA'))
  assert.ok(!JSON.stringify(rows).includes('999999'))
  assert.equal(sheet.B2.t, 's', 'NIP harus teks agar nol depan tetap ada')
  assert.ok(sheet.B2.v.startsWith('0000'))
  for (const cell of Object.values(sheet)) assert.equal(cell?.f, undefined, 'Nilai teks tidak menjadi formula Excel')
}
assert.equal(parsed.SheetNames.map((name) => XLSX.utils.sheet_to_json(parsed.Sheets[name]).length).reduce((a, b) => a + b), 4)
console.log('Employee operational export: grouping, roundtrip, sheet collisions, sensitive fields and text cells passed')
