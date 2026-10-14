import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migrationUrl = new URL(
  '../../supabase/migrations/20261016140000_overtime_revision_target_save.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const fnStart = sql.indexOf('create or replace function public.save_overtime_work_revision_l3(')
assert(fnStart >= 0, 'RPC save_overtime_work_revision_l3 tidak ditemukan')
const fnBody = sql.slice(fnStart)
assert(fnBody.includes('Hanya peserta yang ditolak dapat direvisi'), 'Target harus CORRECTION_REQUIRED')
assert(fnBody.includes("approval_status = 'APPROVED'"), 'Batch ber-approved harus ditolak')
assert(fnBody.includes('Tanggal batch hanya dapat diubah selama seluruh peserta lain masih draft atau revisi'), 'Proteksi SUBMITTED hilang')
assert(fnBody.includes('Alasan koreksi wajib diisi') === false, 'RPC revisi tidak memakai alasan koreksi')
assert(fnBody.includes('Data sudah berubah'), 'Proteksi concurrency hilang')
assert(fnBody.includes('Batas revisi peserta telah lewat'), 'Batas revisi per entry hilang')
assert(fnBody.includes("perform set_config('overtime.date_transition', 'on', true)"), 'Flag transisi hilang')
assert(fnBody.includes('hasil akhir tidak konsisten'), 'Tegasan akhir hilang')
assert(fnBody.includes("'REVISION_SAVED'"), 'Audit target hilang')
assert(fnBody.includes("'DATE_CORRECTED'"), 'Audit peserta ikut pindah hilang')
assert(fnBody.includes('jam clock dipertahankan') || fnBody.includes('v_start_tod'), 'Jam peserta lain harus dipertahankan')
assert(fnBody.includes('status agregat berubah'), 'Penjaga status agregat hilang')
assert(sql.includes('grant execute on function public.save_overtime_work_revision_l3'), 'Grant hilang')
assert(sql.includes("current_setting('overtime.date_transition', true)"), 'Trigger harus mendukung transisi')

const repoUrl = new URL('./overtimeReplacementRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
assert(repo.includes('saveOvertimeWorkRevision'), 'Repo revisi target hilang')
assert(repo.includes('save_overtime_work_revision_l3'), 'Repo harus memanggil RPC revisi')

const componentUrl = new URL('../components/sla/SLALembur.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
assert(component.includes('persistRevision'), 'Jalur simpan revisi target hilang')
assert(component.includes('akan berubah dari'), 'Konfirmasi tanggal batch hilang')
assert(component.includes('Jam dan evidence peserta lain tetap'), 'Penegasan isolasi hilang')
assert(component.includes('Revisi tanggal/jam tersimpan, tetapi evidence gagal disimpan'), 'Pesan parsial DB-vs-Storage hilang')
assert(component.includes('Tanggal Lembur{isEntryRevision'), 'Label tanggal batch hilang')
assert(component.includes('Perubahan tanggal berlaku untuk seluruh peserta batch'), 'Petunjuk tanggal batch hilang')

console.log(`Overtime revision target save tests passed: ${passed}`)
