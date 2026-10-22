import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

// ---------------------------------------------------------------------------
// Migrasi: Riwayat Lembur Pegawai (read-only, per-baris scope, pagination)
// ---------------------------------------------------------------------------
const migrationUrl = new URL(
  '../../supabase/migrations/20261022100000_overtime_employee_history.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')

const fnStart = sql.indexOf('create or replace function public.list_overtime_employee_history_l5(')
assert(fnStart >= 0, 'RPC riwayat pegawai tidak ditemukan')
const openMarker = '$$'
const bodyStart = sql.indexOf(openMarker, fnStart) + openMarker.length
const bodyEnd = sql.indexOf(openMarker + ';', bodyStart)
const rpcBody = sql.slice(bodyStart, bodyEnd)

assert(/language\s+plpgsql/.test(sql.slice(fnStart, bodyStart)), 'RPC harus plpgsql')
assert(/security\s+definer/.test(sql.slice(fnStart, bodyStart)), 'RPC harus security definer (pola proyek)')
assert(/set\s+search_path\s+to\s+('public',\s*'pg_temp'|public,\s*pg_temp)/.test(sql.slice(fnStart, bodyStart)), 'Search path harus terkunci')

assert(rpcBody.includes("raise exception 'Authentication required'"), 'RPC wajib menuntut login')
assert(rpcBody.includes("'Overtime participant not found'"), 'Entry hilang harus terpetakan')
assert(rpcBody.includes("'Overtime activity not found'"), 'Aktivitas hilang/terhapus harus terpetakan')
assert(rpcBody.includes('auth_can_read_overtime_evidence_scope('), 'Scope baca konteks wajib dicek')
assert(rpcBody.includes('a.contract_id = v_activity.contract_id'), 'Riwayat harus dibatasi kontrak yang sama')
assert(rpcBody.includes('e.employee_id = v_entry.employee_id'), 'Riwayat harus berdasar ID pegawai peserta')
assert(rpcBody.includes('a.id <> v_activity.id'), 'Pengajuan yang sedang dibuka wajib dikecualikan')
assert(rpcBody.includes('a.deleted_at is null'), 'Aktivitas terhapus wajib dikecualikan')
assert(rpcBody.includes('a.submission_count > 0'), 'Hanya pengajuan yang pernah dikirim yang boleh tampil')
assert(rpcBody.includes('public.auth_can_read_overtime_evidence_scope(\n      a.contract_id,'), 'Setiap baris hasil wajib lolos scope baca (tanpa menambah hak lintas-UP3)')
assert(rpcBody.includes('order by a.overtime_date desc, e.id desc'), 'Riwayat harus urut tanggal lembur terbaru')
assert(rpcBody.includes('limit least(greatest(coalesce(p_limit, 10), 1), 50)'), 'Pagination harus dibatasi (maks 50 baris)')
assert(rpcBody.includes('offset greatest(coalesce(p_offset, 0), 0)'), 'Offset pagination harus aman')

// Tidak ada kolom finansial pada hasil riwayat.
for (const forbidden of ['hourly_rate', 'calculated_amount', 'multiplier']) {
  assert(!rpcBody.includes(forbidden), `RPC riwayat tidak boleh mengekspos finansial (${forbidden})`)
}
assert(rpcBody.includes('e.approval_status'), 'Status peserta wajib dikembalikan')
assert(rpcBody.includes('e.closure_reason'), 'Alasan penutupan per peserta wajib dikembalikan')
assert(rpcBody.includes('a.closure_reason'), 'Alasan penutupan aktivitas wajib dikembalikan untuk fallback')
assert(rpcBody.includes('count(*) over ()'), 'Total jumlah untuk pagination wajib ada')

assert(sql.includes('revoke all on function public.list_overtime_employee_history_l5(uuid, integer, integer) from public, anon, authenticated'), 'Hak akses anon harus dicabut')
assert(sql.includes('grant execute on function public.list_overtime_employee_history_l5(uuid, integer, integer) to authenticated'), 'Hanya authenticated yang boleh memanggil')

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------
const repoUrl = new URL('./overtimeReplacementRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
assert(repo.includes("rpc('list_overtime_employee_history_l5'"), 'Repository harus memanggil RPC riwayat pegawai')
assert(repo.includes('p_entry_id: entryId'), 'Entry konteks harus dikirim')
assert(repo.includes('p_offset: offset'), 'Offset pagination harus dikirim')
assert(repo.includes('closureReason: row.closure_reason'), 'Alasan penutupan per peserta harus dipetakan')
assert(repo.includes('activityClosureReason: row.activity_closure_reason'), 'Fallback alasan aktivitas harus dipetakan')
assert(repo.includes('totalCount: Number(row.total_count ?? 0)'), 'Total pagination harus dipetakan')

// ---------------------------------------------------------------------------
// Komponen SLALembur: tab detail + riwayat pegawai
// ---------------------------------------------------------------------------
const comUrl = new URL('../components/sla/SLALembur.jsx', import.meta.url)
const com = readFileSync(fileURLToPath(comUrl), import.meta ? 'utf8' : 'utf8')
const historySectionStart = com.indexOf("detailTab==='employee-history' && (")
const historySectionEnd = com.indexOf('</section>', historySectionStart) + '</section>'.length
const historySection = com.slice(historySectionStart, historySectionEnd)
assert(historySectionStart >= 0, 'Bagian riwayat pegawai di komponen tidak ditemukan')

assert(com.includes("setDetailTab('submission')"), 'Tab Pengajuan Ini wajib ada')
assert(com.includes("setDetailTab('employee-history')"), 'Tab Riwayat Lembur Pegawai wajib ada')
assert(com.includes('>Pengajuan Ini</button>'), 'Label tab pengajuan wajib ada')
assert(com.includes('>Riwayat Lembur Pegawai</button>'), 'Label tab riwayat pegawai wajib ada')
assert(com.includes('<h3>Riwayat Pengajuan Ini'), 'Judul riwayat lama harus diubah menjadi Riwayat Pengajuan Ini')

assert(com.includes('function employeeHistoryPseudoRecord'), 'Pemetaan status riwayat pegawai wajib ada')
assert(com.includes("status: historyRow.type === 'WORK' ? historyRow.status : (historyRow.approvalStatus ?? historyRow.status)"), 'Status WORK harus memakai status per peserta')

// Data riwayat dimuat lazily hanya pada tab riwayat.
const effectStart = com.indexOf('// Riwayat lembur pegawai: dimuat hanya saat tab dibuka')
const effectEnd = com.indexOf('function friendlyEmployeeHistoryError', effectStart)
const effectBody = com.slice(effectStart, effectEnd)
assert(com.includes("detailTab !== 'employee-history'"), 'Riwayat tidak boleh dimuat saat tab belum dibuka')
assert(effectBody.includes('listOvertimeEmployeeHistory'), 'Efek harus memanggil repository riwayat pegawai')
assert(effectBody.includes('(empHistoryPage - 1) * empHistoryPageSize'), 'Halaman harus dipetakan ke offset')
assert(!effectBody.includes('approveOvertime'), 'Riwayat pegawai tidak boleh mengeksekusi keputusan approval')
assert(!effectBody.includes('rejectOvertime'), 'Riwayat pegawai tidak boleh mengeksekusi penolakan')

// Tampilan & pagination.
assert(historySection.includes('>Tanggal</th>'), 'Kolom Tanggal wajib ada')
assert(historySection.includes('>Jenis</th>'), 'Kolom Jenis wajib ada')
assert(historySection.includes('>Waktu / Durasi</th>'), 'Kolom Waktu/Durasi wajib ada')
assert(historySection.includes('>Unit</th>'), 'Kolom Unit wajib ada')
assert(historySection.includes('>Keterangan</th>'), 'Kolom Keterangan wajib ada')
assert(historySection.includes('>Status</th>'), 'Kolom Status wajib ada')
assert(historySection.includes('employeeHistoryPseudoRecord(row)'), 'Status baris harus memakai pemetaan per peserta')
assert(historySection.includes('displayStatus(pseudo)'), 'Label status harus konsisten dengan daftar rekap')
assert(historySection.includes('Belum ada pengajuan lembur lain untuk pegawai ini dalam akses Anda.'), 'Pesan kosong riwayat wajib ada')
assert(historySection.includes('Memuat riwayat pegawai...'), 'Tanda memuat wajib ada')
assert(historySection.includes('Coba Lagi'), 'Gagal memuat harus punya tombol coba lagi')
assert(historySection.includes('>Sebelumnya</Button>'), 'Pagination mundur wajib ada')
assert(historySection.includes('>Berikutnya</Button>'), 'Pagination maju wajib ada')
assert(historySection.includes('empHistoryPage<=1 || empHistoryLoading'), 'Batas bawah pagination wajib dijaga')
assert(historySection.includes('empHistoryPage>=empHistoryTotalPages || empHistoryLoading'), 'Batas atas pagination wajib dijaga')
assert(historySection.includes('Halaman {empHistoryPage} dari {empHistoryTotalPages}'), 'Indikator halaman wajib ada')
assert(!historySection.includes("onClick={()=>openApproveConfirm"), 'Riwayat pegawai tidak boleh punya tombol Setujui')
assert(!historySection.includes("openRejectBox("), 'Riwayat pegawai tidak boleh punya tombol Tolak')
assert(!historySection.includes("setDeleteTarget("), 'Riwayat pegawai tidak boleh punya tombol Hapus')

// Reset saat membuka/menutup detail.
const componentOpenDetail = com.slice(com.indexOf('const openDetail = (record)'), com.indexOf('const closeDetail = ()'))
for (const reset of ["setDetailTab('submission')", 'setEmpHistory([])', 'setEmpHistoryPage(1)', 'setEmpHistoryTotal(0)']) {
  assert(componentOpenDetail.includes(reset), `openDetail wajib mereset riwayat (${reset})`)
}
const componentCloseDetail = com.slice(com.indexOf('const closeDetail = ()'), com.indexOf('const [detailEvidence, setDetailEvidence]'))
assert(componentCloseDetail.includes("setDetailTab('submission')"), 'closeDetail wajib mereset tab')
assert(componentCloseDetail.includes('setEmpHistoryPage(1)'), 'closeDetail wajib mereset halaman riwayat')

console.log(`overtimeEmployeeHistory.test.js: ${passed} assertions passed`)
