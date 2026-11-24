import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const notifications = read('./approvalNotificationRepository.js')
const app = read('../App.jsx')
const header = read('../components/Header.jsx')
const page = read('../pages/sla/SLAPelayananTeknikPage.jsx')
const lembur = read('../components/sla/SLALembur.jsx')

// Sumber notifikasi: revisi Lembur lintas periode dalam scope satu ULP.
assert(notifications.includes('export async function listAdminUlpRevisionNotifications'), 'Builder notifikasi revisi Admin ULP hilang')
assert(notifications.includes("reviewStatus !== 'CORRECTION_REQUIRED'"), 'Filter status revisi hilang')
assert(notifications.includes('row.revisionDeadlineAt'), 'Notifikasi harus membawa batas revisi')
assert(notifications.includes("mode: 'revision'"), 'Mode notifikasi revisi hilang')
assert(notifications.includes("title: 'Lembur Perlu Revisi'"), 'Judul notifikasi revisi hilang')
assert(
  notifications.slice(notifications.indexOf('listAdminUlpRevisionNotifications')).includes('periodMonth: null'),
  'Notifikasi revisi harus mencakup semua periode',
)
assert(notifications.includes('revisionDeadlineAt && new Date(row.revisionDeadlineAt).getTime() < Date.now()'), 'Revisi kedaluwarsa harus disaring')

// Admin ULP memakai lonceng revisi, bukan antrean persetujuan Admin UP3.
assert(app.includes('const adminUlpAccess = previewActive'), 'Scope Admin ULP di App hilang')
assert(app.includes('listAdminUlpRevisionNotifications({'), 'App harus memuat notifikasi revisi Admin ULP')
assert(app.includes("item.kind === 'revision'"), 'Klik notifikasi revisi harus dikenali')
assert(app.includes('setRevisionTarget({ ...item'), 'Target revisi harus disimpan saat notifikasi diklik')
assert(app.includes("writeRouteHash({ segments: ['pelayanan-teknik', 'lembur'], periode: revisionPeriod }"), 'URL revisi harus membawa periode target')
assert(app.includes('revisionTarget={revisionTarget}'), 'Target revisi harus diteruskan ke halaman SLA')

// Header mengikuti mode notifikasi.
assert(header.includes("const notificationMode = approvalNotifications?.mode ?? 'approval'"), 'Mode header notifikasi hilang')
assert(header.includes("notificationMode === 'revision'"), 'Empty state/aria revisi hilang')
assert(header.includes('{notificationTitle}'), 'Judul panel harus mengikuti mode')
assert(header.includes('item.meta ||'), 'Metadata batas revisi harus tampil di panel')

// Halaman SLA berpindah modul/periode sebelum membuka revisi.
assert(page.includes('revisionTarget = null'), 'Prop target revisi halaman hilang')
assert(page.includes("if (orgMapStatus === 'loading') return"), 'Target revisi harus menunggu pemetaan organisasi')
assert(page.includes('setActiveRevisionToken(revisionTarget.token)'), 'Target revisi harus dikonfirmasi setelah prompt perubahan')
assert(page.includes("setModuleId('lembur')"), 'Halaman harus pindah ke modul Lembur')
assert(page.includes('setPeriod(targetPeriod)'), 'Halaman harus pindah periode target')
assert(page.includes('dataReady={lemburLoadStatus ==='), 'Kesiapan data periode harus diteruskan')
assert(page.includes('activeRevisionToken === revisionTarget?.token'), 'Form revisi tidak boleh dibuka sebelum navigasi dikonfirmasi')

// SLALembur membuka form peserta yang tepat dan menampilkan banner periode aktif.
assert(lembur.includes('if (!dataReady || loading) return'), 'Form revisi harus menunggu data periode selesai dimuat')
assert(lembur.includes('editDraft(match)'), 'Notifikasi revisi harus membuka editDraft')
assert(lembur.includes('periodRevisionCount'), 'Banner jumlah revisi periode aktif hilang')
assert(lembur.includes('isAdminUlp && dataReady && periodRevisionCount > 0'), 'Banner hanya untuk Admin ULP dengan data siap')
assert(lembur.includes("recordReviewStatus(record) === 'CORRECTION_REQUIRED' && !recordIsExpired(record)"), 'Banner harus menghitung revisi aktif saja')

console.log(`Admin ULP revision notification tests passed: ${passed}`)
