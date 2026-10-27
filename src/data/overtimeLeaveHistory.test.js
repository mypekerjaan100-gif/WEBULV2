import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

// ---------------------------------------------------------------------------
// RPC riwayat cuti: read-only, scope per baris, tanpa data finansial.
// ---------------------------------------------------------------------------
const sql = read('../../supabase/migrations/20261027130000_overtime_replacement_leave_history.sql')
assert(sql.includes('create or replace function public.list_overtime_replacement_leave_history('), 'RPC riwayat cuti hilang')
assert(/security\s+definer/.test(sql), 'RPC harus security definer')
assert(sql.includes("raise exception 'Authentication required'"), 'RPC wajib menuntut login')
assert(sql.includes("v_activity.type <> 'REPLACEMENT_LEAVE'"), 'RPC harus khusus Pengganti Cuti')
assert(sql.includes('a.replaced_employee_id = v_activity.replaced_employee_id'), 'Riwayat harus memakai pegawai yang digantikan')
assert(sql.includes('a.id <> v_activity.id'), 'Pengajuan yang sedang dibuka wajib dikecualikan')
assert(sql.includes("ev.evidence_type = 'FORM_CUTI'"), 'Form Cuti wajib difilter')
assert(sql.includes("ev.status = 'ACTIVE'"), 'Hanya Form Cuti aktif yang ditampilkan')
assert(sql.includes('public.auth_can_read_overtime_evidence_scope('), 'Scope baca per baris wajib dicek')
assert(sql.includes('a.submission_count > 0'), 'Hanya pengajuan yang pernah dikirim')
assert(sql.includes('a.deleted_at is null'), 'Aktivitas terhapus wajib dikecualikan')
assert(sql.includes('limit least(greatest(coalesce(p_limit, 10), 1), 50)'), 'Pagination harus dibatasi')
assert(sql.includes('count(*) over ()'), 'Total pagination wajib ada')
assert(sql.includes('revoke all on function public.list_overtime_replacement_leave_history'), 'Hak akses default harus dicabut')
assert(sql.includes('grant execute on function public.list_overtime_replacement_leave_history'), 'Hanya authenticated yang boleh memanggil')
for (const forbidden of ['hourly_rate', 'calculated_amount', 'total_amount']) {
  assert(!sql.includes(forbidden), `RPC riwayat cuti tidak boleh mengekspos ${forbidden}`)
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------
const repo = read('./overtimeReplacementRepository.js')
assert(repo.includes('listOvertimeReplacementLeaveHistory'), 'Fungsi repository riwayat cuti hilang')
assert(repo.includes("rpc('list_overtime_replacement_leave_history'"), 'Repository harus memanggil RPC riwayat cuti')
assert(repo.includes('formEvidence: (row.form_evidence ?? [])'), 'Metadata Form Cuti harus dipetakan')
assert(repo.includes('replacedEmployeeName: row.replaced_employee_name'), 'Nama pegawai yang digantikan harus dipetakan')
assert(repo.includes('totalCount: Number(row.total_count ?? 0)'), 'Total pagination harus dipetakan')

// ---------------------------------------------------------------------------
// Komponen SLALembur: tab dan tampilan riwayat cuti
// ---------------------------------------------------------------------------
const com = read('../components/sla/SLALembur.jsx')
assert(com.includes('leaveHistoryPseudoRecord'), 'Pemetaan status riwayat cuti hilang')
assert(com.includes("status: row.status"), 'Status riwayat cuti harus memakai status aktivitas')
assert(com.includes("setDetailTab('leave-history')"), 'Tab Riwayat Cuti wajib ada')
assert(com.includes('>Riwayat Cuti</button>'), 'Label tab Riwayat Cuti wajib ada')
assert(com.includes("detailActivity.type === 'REPLACEMENT_LEAVE'"), 'Tab hanya untuk Pengganti Cuti')
assert(com.includes('listOvertimeReplacementLeaveHistory'), 'Efek harus memanggil repository riwayat cuti')
assert(com.includes("detailTab !== 'leave-history'"), 'Riwayat cuti harus dimuat lazy saat tab dibuka')
assert(com.includes('leaveHistoryUrls'), 'Signed URL thumbnail Form Cuti hilang')
assert(com.includes('previewEvidence(entry, row.formEvidence)'), 'Form Cuti harus bisa dipratinjau')
assert(com.includes('Memuat riwayat cuti...'), 'Tanda memuat riwayat cuti hilang')
assert(com.includes('Belum ada riwayat cuti lain untuk pegawai ini dalam akses Anda.'), 'Pesan kosong riwayat cuti hilang')
assert(com.includes('Coba Lagi'), 'Gagal memuat harus punya tombol coba lagi')

const sectionStart = com.indexOf("detailTab==='leave-history' && detailActivity.type === 'REPLACEMENT_LEAVE' && (")
const sectionEnd = com.indexOf('</section>', sectionStart) + '</section>'.length
const section = com.slice(sectionStart, sectionEnd)
assert(sectionStart >= 0, 'Bagian riwayat cuti di komponen tidak ditemukan')
assert(section.includes('>Tanggal</th>'), 'Kolom Tanggal wajib ada')
assert(section.includes('>Waktu Cuti</th>'), 'Kolom Waktu Cuti wajib ada')
assert(section.includes('>Pegawai Pengganti</th>'), 'Kolom Pegawai Pengganti wajib ada')
assert(section.includes('>Unit</th>'), 'Kolom Unit wajib ada')
assert(section.includes('>Keterangan</th>'), 'Kolom Keterangan wajib ada')
assert(section.includes('>Status</th>'), 'Kolom Status wajib ada')
assert(section.includes('>Form Cuti</th>'), 'Kolom Form Cuti wajib ada')
assert(section.includes('leaveHistoryPseudoRecord(row)'), 'Status baris harus memakai pemetaan aktivitas')
assert(section.includes('displayStatus(pseudo)'), 'Label status harus konsisten dengan rekap')
assert(section.includes('leaveHistoryPage>=leaveHistoryTotalPages || leaveHistoryLoading'), 'Batas atas pagination wajib dijaga')
assert(section.includes('Halaman {leaveHistoryPage} dari {leaveHistoryTotalPages}'), 'Indikator halaman wajib ada')
assert(!section.includes("onClick={()=>openApproveConfirm"), 'Riwayat cuti tidak boleh punya tombol Setujui')
assert(!section.includes("setDeleteTarget("), 'Riwayat cuti tidak boleh punya tombol Hapus')

// Reset saat membuka/menutup detail.
const openDetail = com.slice(com.indexOf('const openDetail = (record)'), com.indexOf('const closeDetail = ()'))
for (const reset of ['setLeaveHistory([])', 'setLeaveHistoryPage(1)', 'setLeaveHistoryTotal(0)', 'setLeaveHistoryUrls({})']) {
  assert(openDetail.includes(reset), `openDetail wajib mereset riwayat cuti (${reset})`)
}
const closeDetail = com.slice(com.indexOf('const closeDetail = ()'), com.indexOf('const [detailEvidence, setDetailEvidence]'))
for (const reset of ['setLeaveHistory([])', 'setLeaveHistoryPage(1)', 'setLeaveHistoryTotal(0)']) {
  assert(closeDetail.includes(reset), `closeDetail wajib mereset riwayat cuti (${reset})`)
}

const css = read('../styles/index.css')
for (const className of ['lembur-leave-forms', 'lembur-leave-form', 'lembur-leave-history-table']) {
  assert(css.includes(`.${className}`), `Style ${className} hilang`)
}

console.log(`overtimeLeaveHistory.test.js: ${passed} assertions passed`)
