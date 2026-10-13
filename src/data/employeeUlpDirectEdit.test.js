import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const migrationUrl = new URL(
  '../../supabase/migrations/20261014140000_employee_ulp_direct_edit.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
assert(sql.includes('submit_employee_change_request'), 'Redefinisi submit hilang')
assert(sql.includes('Unit usulan tidak konsisten dengan unit target'), 'Validasi unit usulan hilang')
assert(sql.includes("cm.contract_role = 'ADMIN_ULP'"), 'Cek membership Admin ULP hilang')
assert(sql.includes('cm.operational_unit_id = v_target'), 'Membership harus tepat satu ULP target')
assert(sql.includes('cm.effective_from <= current_date'), 'Membership harus memperhatikan masa berlaku')
assert(sql.includes('hanya boleh mengedit pegawai unit sendiri'), 'Batas unit pegawai hilang')
assert(sql.includes('tidak boleh pindah unit'), 'Larangan pindah unit hilang')
assert(sql.includes("jsonb_set(v_snapshot, '{bank}'"), 'Merge bank edit langsung hilang')
assert(sql.includes("jsonb_set(v_snapshot, '{account_number}'"), 'Merge rekening edit langsung hilang')
assert(sql.includes("jsonb_set(v_snapshot, '{hourly_rate}'"), 'Merge tarif edit langsung hilang')
assert(sql.includes("status='ACTIVE', uploaded_at=now()"), 'Aktivasi foto edit langsung hilang')
assert(sql.includes("status='SUPERSEDED'"), 'Supersede foto lama hilang')
assert(sql.includes("'Approved', 'Admin ULP', 'Admin ULP'"), 'Audit Approved Admin ULP hilang')
assert(sql.includes("'Pending', 'Admin ULP'"), 'Tambah ULP harus tetap Pending')

const lifecycleUrl = new URL(
  '../../supabase/migrations/20261013121000_employee_photos_lifecycle.sql',
  import.meta.url,
)
const lifecycle = readFileSync(fileURLToPath(lifecycleUrl), 'utf8')
assert(lifecycle.includes('Edit langsung Admin ULP dalam unit sendiri'), 'File lifecycle harus sinkron dengan migration baru')
assert(lifecycle.includes('Unit usulan tidak konsisten dengan unit target'), 'Validasi unit usulan harus sinkron')

const componentUrl = new URL('../components/sla/SLADatabasePegawai.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
assert(component.includes('Perubahan pegawai berhasil disimpan langsung'), 'Pesan sukses edit langsung hilang')
assert(!component.includes('Pengajuan edit dikirim (Pending)'), 'Sisa pesan Pending untuk edit harus dihapus')
assert(component.includes('Edit pegawai unit ini langsung tersimpan tanpa approval'), 'Catatan mode edit hilang')
assert(component.includes('Tambah pegawai akan dikirim sebagai pengajuan'), 'Catatan mode tambah hilang')
assert(component.includes('tambah pegawai tetap Pending'), 'Deskripsi alur tambah hilang')

console.log(`Employee ULP direct edit tests passed: ${passed}`)
