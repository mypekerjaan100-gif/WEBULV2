import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { buildEmployeeOperationalWorkbook, EMPLOYEE_EXPORT_COLUMNS } from './employeeOperationalExport.js'

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
