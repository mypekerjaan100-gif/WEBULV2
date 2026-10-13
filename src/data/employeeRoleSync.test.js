import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const pageUrl = new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url)
const page = readFileSync(fileURLToPath(pageUrl), 'utf8')
assert(page.includes('hasSensitiveRead: true'), 'Semua role harus memuat field sensitif (RLS membatasi scope)')
assert(page.includes('includeHourlyRates: true'), 'Semua role harus memuat histori tarif')
assert(!page.includes('hasSensitiveRead: canReadEmployeeFinancials'), 'Gating finansial per role harus dihapus dari fetch')
assert(page.includes("window.addEventListener('focus'"), 'Refresh saat jendela aktif hilang')
assert(page.includes('setInterval'), 'Polling sinkron lintas sesi hilang')
assert(page.includes('45000'), 'Interval sinkron harus 45 detik')
assert(page.includes('refreshEmployees().catch'), 'Refresh lintas sesi harus toleran error')

const repoUrl = new URL('./employeeRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
assert(repo.includes('_financialsLoaded'), 'Penanda finansial termuat hilang')
assert(repo.includes('employee_sensitive_fields'), 'RPC field sensitif hilang')

const componentUrl = new URL('../components/sla/SLADatabasePegawai.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
assert(component.includes('_financialsLoaded === false'), 'Submit harus diblokir bila finansial belum termuat')
assert(component.includes('data valid tidak terhapus'), 'Pesan pengaman finansial hilang')
assert(component.includes('photoUrlToken'), 'Refresh signed URL foto hilang')
assert(component.includes('240000'), 'Refresh URL foto harus sebelum kedaluwarsa 300 detik')
assert(component.includes('Menunggu Approval'), 'Badge pengajuan pending hilang')
assert(component.includes('Foto usulan'), 'Preview foto usulan hilang')
assert(component.includes('req.contractId === resolvedContractUuid'), 'Filter Pending harus memakai UUID kontrak')

const lifecycleUrl = new URL(
  '../../supabase/migrations/20261013121000_employee_photos_lifecycle.sql',
  import.meta.url,
)
const lifecycle = readFileSync(fileURLToPath(lifecycleUrl), 'utf8')
assert(lifecycle.includes('v_snapshot'), 'Approve harus memakai snapshot hasil merge')
assert(lifecycle.includes("created_by_actor,'') = 'Admin ULP'"), 'Proteksi finansial khusus pengajuan ULP hilang')
assert(lifecycle.includes("jsonb_set(v_snapshot, '{bank}'"), 'Merge bank saat approve hilang')
assert(lifecycle.includes("jsonb_set(v_snapshot, '{account_number}'"), 'Merge rekening saat approve hilang')
assert(lifecycle.includes("jsonb_set(v_snapshot, '{hourly_rate}'"), 'Merge tarif saat approve hilang')

const preserveUrl = new URL(
  '../../supabase/migrations/20261014130000_employee_approve_preserve_financials.sql',
  import.meta.url,
)
const preserve = readFileSync(fileURLToPath(preserveUrl), 'utf8')
assert(preserve.includes('approve_employee_change_request'), 'Migration proteksi approve hilang')
assert(preserve.includes("jsonb_set(v_snapshot, '{account_number}'"), 'Migration proteksi harus merge rekening')

const recoveryUrl = new URL(
  '../../supabase/migrations/20261014131000_employee_iswanto_financials_recovery.sql',
  import.meta.url,
)
const recovery = readFileSync(fileURLToPath(recoveryUrl), 'utf8')
assert(recovery.includes("nip = '00220716PTK'"), 'Pemulihan harus berbasis NIP')
assert(!recovery.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i), 'Pemulihan tidak boleh hardcode UUID')
assert(recovery.includes('effective_to = null'), 'Pemulihan harus membuka kembali tarif valid')

console.log(`Employee role sync tests passed: ${passed}`)
