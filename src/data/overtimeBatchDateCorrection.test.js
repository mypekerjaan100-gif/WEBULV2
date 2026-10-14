import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migrationUrl = new URL(
  '../../supabase/migrations/20261016120000_overtime_batch_date_transition.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

// Flag transisi: trigger menunda cek tanggal hanya dalam transaksi RPC.
assert(sql.includes("current_setting('overtime.date_transition', true)"), 'Flag transisi hilang')
assert(sql.includes('Transisi tanggal batch atomik'), 'Komentar transisi hilang')
assert(sql.includes("perform set_config('overtime.date_transition', 'on', true)"), 'Aktivasi flag hilang')
assert(sql.includes('hasil akhir tidak konsisten'), 'Tegasan akhir hilang')
assert(sql.includes("'DATE_CORRECTED'"), 'Event DATE_CORRECTED hilang')

const batchStart = sql.indexOf('create or replace function public.correct_work_batch_date_l3(')
assert(batchStart >= 0, 'RPC correct_work_batch_date_l3 tidak ditemukan')
const batchBody = sql.slice(batchStart, sql.indexOf('correct_approved_overtime_work_l6', batchStart))
assert(batchBody.includes('auth_can_mutate_overtime_work_l3'), 'RPC batch harus memakai scope ULP')
assert(batchBody.includes("status not in ('DRAFT', 'CORRECTION_REQUIRED')"), 'RPC batch harus menolak status final')
assert(batchBody.includes("approval_status = 'APPROVED'"), 'RPC batch harus menolak peserta approved')
assert(batchBody.includes('Tanggal batch hanya dapat dikoreksi selama seluruh peserta masih draft atau revisi'), 'Pesan SUBMITTED hilang')
assert(batchBody.includes('Alasan koreksi wajib diisi'), 'Validasi alasan hilang')
assert(batchBody.includes('Data sudah berubah'), 'Proteksi concurrency hilang')
assert(sql.includes('grant execute on function public.correct_work_batch_date_l3'), 'Grant RPC batch hilang')

const l6Start = sql.indexOf('create or replace function public.correct_approved_overtime_work_l6(', batchStart)
assert(l6Start >= 0, 'Rewrite l6 hilang')
const l6Body = sql.slice(l6Start)
assert(l6Body.includes("perform set_config('overtime.date_transition', 'on', true)"), 'l6 harus memakai flag transisi')
assert(l6Body.includes('tanggal akhir tidak sesuai'), 'l6 harus menegaskan tanggal akhir')

const repoUrl = new URL('./overtimeReplacementRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
assert(repo.includes('correctWorkBatchDate'), 'Repo koreksi tanggal batch hilang')
assert(repo.includes('correct_work_batch_date_l3'), 'Repo harus memanggil RPC batch')

const componentUrl = new URL('../components/sla/SLALembur.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
assert(component.includes('disabled={isEvidenceOnlyRevision || isEntryRevision}'), 'Tanggal harus dikunci saat revisi peserta')
assert(component.includes('Tanggal batch dikunci selama revisi peserta'), 'Petunjuk kunci tanggal hilang')
assert(component.includes('Koreksi Tanggal Batch'), 'Judul modal tanggal batch hilang')
assert(component.includes('Pindahkan Tanggal'), 'Tombol pindahkan tanggal hilang')
assert(component.includes('Tanggal Batch Dikoreksi'), 'Label riwayat DATE_CORRECTED hilang')
assert(component.includes('Tanggal berlaku untuk seluruh batch'), 'Penjelasan batch hilang')
assert(component.includes('failValidation({ message: friendlySaveError'), 'Gagal simpan harus memakai banner validasi')

console.log(`Overtime batch date correction tests passed: ${passed}`)
