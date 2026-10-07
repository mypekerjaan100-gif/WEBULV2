import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migrationUrl = new URL(
  '../../supabase/migrations/20261007140000_overtime_ulp_soft_delete_guard.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const guardStart = sql.indexOf('create or replace function public.guard_soft_deleted_overtime_activity')
assert(guardStart >= 0, 'Guard soft-delete tidak ditemukan')
const guardBody = sql.slice(guardStart, sql.indexOf('\n$$;', guardStart))
assert(guardBody.length > 500, 'Body guard soft-delete tidak lengkap')

// Skema benar: SUPER_ADMIN tetap full akses, ADMIN_ULP dibatasi scope/status/approval.
assert(guardBody.includes('public.auth_is_super_admin()'), 'Guard harus memeriksa SUPER_ADMIN')
assert(guardBody.includes('public.auth_can_mutate_overtime_replacement_l2'), 'Guard harus memeriksa scope ULP replacement')
assert(guardBody.includes('public.auth_can_mutate_overtime_work_l3'), 'Guard harus memeriksa scope ULP pekerjaan')
assert(guardBody.includes("'DRAFT', 'SUBMITTED', 'CORRECTION_REQUIRED'"), 'Guard harus membatasi status draft/pengajuan/revisi')
assert(guardBody.includes("approval_status = 'APPROVED'"), 'Guard harus menolak jika ada peserta disetujui')
assert(guardBody.includes('Hanya pemilik data pada ULP sendiri yang dapat menghapus'), 'Pesan scope ULP hilang')
assert(guardBody.includes('Hanya lembur yang belum disetujui yang dapat dihapus'), 'Pesan status final hilang')
assert(guardBody.includes('Sebagian peserta sudah disetujui'), 'Pesan peserta disetujui hilang')
assert(guardBody.includes('Alasan hapus wajib diisi'), 'Validasi alasan hapus hilang')
assert(!guardBody.includes('Only SUPER_ADMIN may delete overtime data'), 'Aturan lama SUPER_ADMIN-only harus dihapus')

console.log(`Overtime soft-delete guard tests passed: ${passed}`)
