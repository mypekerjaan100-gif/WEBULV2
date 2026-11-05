import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const cssUrl = new URL('../styles/index.css', import.meta.url)
const css = readFileSync(fileURLToPath(cssUrl), 'utf8')
const modalSource = readFileSync(fileURLToPath(new URL('../components/sla/SLALembur.jsx', import.meta.url)), 'utf8')
const pageSource = readFileSync(fileURLToPath(new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url)), 'utf8')

// Modal Detail Lembur tidak boleh punya padding: celah padding membuat
// konten yang di-scroll terlihat di atas header sticky.
assert(
  css.includes('.rekap-detail-modal.lembur-detail-modal { max-width: 1280px; padding: 0; }'),
  'Modal Detail Lembur harus memakai selector gabungan dengan padding 0 agar tidak tertimpa .rekap-detail-modal',
)

assert(
  css.includes('.lembur-detail-overlay { padding: 20px; }') && css.includes('.lembur-detail-overlay { padding: 8px; }'),
  'Modal Detail Lembur harus memiliki padding overlay yang responsif',
)

assert(
  css.includes('.lembur-participant-meta { display: grid;') && css.includes('grid-template-columns: 104px minmax(0, 1fr)'),
  'Detail peserta harus memiliki tata letak metadata Jabatan dan Lokasi Penempatan',
)

assert(
  ['employees={employees}', 'jabatan={jabatan}', 'employeeLocations={employeeLocations}']
    .every((prop) => pageSource.includes(prop)),
  'Modal Detail Lembur harus menerima data yang sama dengan Database Pegawai',
)

assert(
  modalSource.includes('participantEmployeesById.get(r.participantEmployeeId)') &&
    modalSource.includes('employeeDirectoryAssignmentAt(employee, detailActivity.date ?? r.date)') &&
    modalSource.includes('<span>Jabatan</span>') && modalSource.includes('<span>Lokasi Penempatan</span>'),
  'Detail peserta harus mencocokkan ID pegawai dan menampilkan jabatan serta lokasi penempatan',
)

// Header detail harus tetap sticky di atas konten saat modal di-scroll.
assert(
  css.includes('.lembur-detail-header { position: sticky; top: 0;'),
  'Header Detail Lembur harus sticky di atas konten modal',
)

// Modal detail harus menjadi scroll container dengan batas tinggi.
for (const rule of ['max-height: 90vh', 'overflow: auto']) {
  assert(css.includes(rule), `Modal detail harus membatasi tinggi dan bisa di-scroll (${rule})`)
}

console.log(`Overtime detail modal tests passed: ${passed}`)
