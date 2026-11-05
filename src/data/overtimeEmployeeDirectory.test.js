import {
  employeeDirectoryAssignmentAt,
  UNRESOLVED_EMPLOYEE_DIRECTORY_VALUE,
  workLocationNameAt,
} from './overtimeEmployeeDirectory.js'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const employee = {
  positionId: 'position-current',
  workLocationId: 'location-current',
  positionHistory: [
    { positionId: 'position-old', validFrom: '2025-01-01', validTo: '2026-01-01' },
    { positionId: 'position-current', validFrom: '2026-01-01', validTo: null },
  ],
  workLocationHistory: [
    { workLocationId: 'location-old', validFrom: '2025-01-01', validTo: '2026-01-01' },
    { workLocationId: 'location-current', validFrom: '2026-01-01', validTo: null },
  ],
}

const pastAssignment = employeeDirectoryAssignmentAt(employee, '2025-12-31')
assert(pastAssignment.positionId === 'position-old', 'Jabatan harus mengikuti riwayat pada tanggal lembur')
assert(pastAssignment.workLocationId === 'location-old', 'Lokasi harus mengikuti riwayat pada tanggal lembur')

const currentAssignment = employeeDirectoryAssignmentAt(employee, '2026-01-01')
assert(currentAssignment.positionId === 'position-current', 'Riwayat berlaku mulai tanggal efektif')
assert(currentAssignment.workLocationId === 'location-current', 'Pergantian lokasi berlaku inklusif pada tanggal mulai')

const noHistoryAssignment = employeeDirectoryAssignmentAt({ positionId: 'p', workLocationId: 'l' }, '2026-02-01')
assert(noHistoryAssignment.positionId === 'p' && noHistoryAssignment.workLocationId === 'l', 'Data pegawai tanpa riwayat memakai nilai Database Pegawai saat ini')

const unknownHistoricalAssignment = employeeDirectoryAssignmentAt({ ...employee, positionHistory: [{ positionId: 'p', validFrom: '2026-01-01', validTo: null }] }, '2025-12-31')
assert(unknownHistoricalAssignment.positionId === null, 'Riwayat di luar tanggal lembur tidak boleh diganti dengan nilai terkini')

const location = {
  id: 'location-id',
  type: 'KANTOR_JAGA',
  nameHistory: [
    { name: 'Lokasi Lama', validFrom: '2025-01-01', validTo: '2026-01-01' },
    { name: 'Lokasi Baru', validFrom: '2026-01-01', validTo: null },
  ],
}
assert(workLocationNameAt(location, '2025-12-31') === 'Lokasi Lama', 'Nama lokasi harus memakai riwayat yang berlaku pada tanggal lembur')
assert(workLocationNameAt(location, '2026-01-01') === 'Lokasi Baru', 'Nama lokasi baru harus berlaku pada tanggal efektif')
assert(workLocationNameAt({ id: 'office-id', type: 'UNIT_OFFICE' }, '2026-01-01', 'UP3 Contoh') === 'UP3 Contoh', 'Lokasi kantor menggunakan nama unit seperti Database Pegawai')
assert(workLocationNameAt(null, '2026-01-01') === null, 'Lokasi yang tidak tersedia harus dapat ditangani dengan fallback UI')
assert(UNRESOLVED_EMPLOYEE_DIRECTORY_VALUE === 'Belum Ditentukan', 'Fallback data peserta mengikuti Database Pegawai')

console.log(`Overtime employee directory tests passed: ${passed}`)
