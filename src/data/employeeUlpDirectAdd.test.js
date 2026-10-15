import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const migrationUrl = new URL(
  '../../supabase/migrations/20261016150000_employee_ulp_direct_add.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
assert(sql.includes('Tambah/edit langsung Admin ULP dalam unit sendiri'), 'Cabang tambah langsung hilang')
assert(sql.includes("p_request_type in ('add','edit')"), 'Cabang langsung harus mencakup add dan edit')
assert(sql.includes('Foto pegawai wajib diunggah untuk pegawai baru'), 'Foto wajib untuk tambah hilang')
assert(sql.includes("status = 'Approved'"), 'Constraint harus mengizinkan Approved menunjuk pegawai')
assert(sql.includes('NIP baru wajib ditambah lewat form'), 'Import NIP baru wajib lewat form')
assert(sql.includes("'Import ULP', 'Admin ULP'"), 'Audit import langsung Admin ULP hilang')
assert(sql.includes('tidak boleh pindah unit'), 'Larangan pindah unit hilang')

const componentUrl = new URL('../components/sla/SLADatabasePegawai.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
assert(component.includes('Pegawai baru tersimpan langsung'), 'Pesan sukses tambah langsung hilang')
assert(!component.includes('Pengajuan tambah pegawai dikirim (Pending)'), 'Sisa pesan Pending tambah harus dihapus')
assert(component.includes('Import ULP langsung tersimpan'), 'Catatan import langsung hilang')

console.log(`Employee ULP direct add tests passed: ${passed}`)
