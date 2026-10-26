import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migrationUrl = new URL(
  '../../supabase/migrations/20261015120000_overtime_approved_correction.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const fnStart = sql.indexOf('create or replace function public.correct_approved_overtime_work_l6(')
assert(fnStart >= 0, 'RPC correct_approved_overtime_work_l6 tidak ditemukan')
const fnBody = sql.slice(fnStart, sql.indexOf('\n$function$;', fnStart))
assert(fnBody.length > 3000, 'Body RPC koreksi tidak lengkap')

// Skema benar: SUPER_ADMIN atau ADMIN_UP3 exact-scope; bukan helper luas.
assert(fnBody.includes('public.auth_is_super_admin()'), 'RPC harus memeriksa SUPER_ADMIN')
assert(fnBody.includes("cm.contract_role = 'ADMIN_UP3'"), 'RPC harus memeriksa ADMIN_UP3 exact-scope')
assert(!fnBody.includes('auth_can_review_overtime_l5'), 'RPC tidak boleh memakai helper review luas')
assert(!fnBody.includes('auth_can_mutate_overtime_work_l3'), 'RPC tidak boleh memakai gate draft ULP')
assert(fnBody.includes("v_activity.type <> 'WORK'"), 'RPC harus menolak selain Lembur Pekerjaan')
assert(fnBody.includes("v_activity.status <> 'APPROVED'"), 'RPC harus menolak status selain APPROVED')
assert(fnBody.includes("approval_status <> 'APPROVED'"), 'Semua peserta harus APPROVED')
assert(fnBody.includes('Alasan koreksi wajib diisi'), 'Validasi alasan hilang')
assert(fnBody.includes('Data sudah berubah'), 'Proteksi concurrency hilang')
assert(fnBody.includes('Jumlah peserta tidak sesuai'), 'Proteksi jumlah peserta hilang')
assert(fnBody.includes('CORRECTED'), 'Event audit CORRECTED hilang')
assert(!/approved_at\s*=/.test(fnBody), 'approved_at asli tidak boleh ditimpa')
assert(!/approved_by\s*=/.test(fnBody), 'approved_by asli tidak boleh ditimpa')
assert(fnBody.includes('calculated_amount_snapshot = v_amount'), 'Nominal harus dihitung ulang')
assert(fnBody.includes('hourly_rate_snapshot = v_new_rate'), 'Tarif snapshot harus diperbarui saat tanggal berubah')
assert(sql.includes("'CORRECTED'"), 'Constraint event harus memuat CORRECTED')
assert(sql.includes('grant execute on function public.correct_approved_overtime_work_l6'), 'Grant authenticated hilang')

const repoUrl = new URL('./overtimeReplacementRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
assert(repo.includes('correctApprovedOvertimeWork'), 'Repo koreksi hilang')
assert(repo.includes('correct_approved_overtime_work_l6'), 'Repo harus memanggil RPC koreksi')

const componentUrl = new URL('../components/sla/SLALembur.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
assert(component.includes('canCorrectApprovedWork'), 'Prop koreksi hilang')
assert(component.includes('Koreksi Tanggal & Jam'), 'Judul modal koreksi hilang')
assert(component.includes('Simpan Koreksi'), 'Tombol simpan koreksi hilang')
assert(component.includes('Alasan Koreksi'), 'Alasan koreksi hilang')
assert(component.includes('STATUS TETAP DISETUJUI'), 'Penegas status hilang')
assert(component.includes('Koreksi Data Lembur'), 'Label riwayat koreksi hilang')
assert(component.includes('Tanggal pindah periode'), 'Pesan pindah periode hilang')

const pageUrl = new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url)
const page = readFileSync(fileURLToPath(pageUrl), 'utf8')
assert(page.includes('canCorrectApprovedWork={isSuperAdmin || isAdminUp3}'), 'Prop harus eksak Super Admin/Admin UP3')

const cssUrl = new URL('../styles/index.css', import.meta.url)
const css = readFileSync(fileURLToPath(cssUrl), 'utf8')
assert(css.includes('.lembur-correct-modal'), 'Style modal koreksi hilang')
assert(css.includes('.lembur-correct-row'), 'Style baris koreksi hilang')

console.log(`Overtime approved correction tests passed: ${passed}`)
