import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { REPLACEMENT_TYPES } from './overtimeReplacementL2.js'
import { WORK_CATEGORIES } from './overtimeWorkL3.js'

const migrationUrl = new URL(
  '../../supabase/migrations/20260907120000_configurable_overtime_initial_deadline.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

function functionBody(name) {
  const start = sql.indexOf(`create or replace function public.${name}`)
  assert(start >= 0, `Function ${name} tidak ditemukan`)
  const end = sql.indexOf('\n$$;', start)
  assert(end > start, `Body function ${name} tidak lengkap`)
  return sql.slice(start, end)
}

function deadlineAt(date, days) {
  const start = new Date(`${date}T00:00:00+07:00`)
  return new Date(start.getTime() + ((days + 1) * 86400000) - 1)
}

function effectiveDays({ normal, temporary, temporaryUntil, asOf }) {
  return temporary != null && asOf <= temporaryUntil ? temporary : normal
}

assert(deadlineAt('2026-09-01', 3).toISOString() === '2026-09-04T16:59:59.999Z', 'H+3 cutoff salah')
assert(deadlineAt('2026-09-01', 7).toISOString() === '2026-09-08T16:59:59.999Z', 'H+7 cutoff salah')
assert(deadlineAt('2026-09-01', 10).toISOString() === '2026-09-11T16:59:59.999Z', 'H+10 cutoff salah')
const h10Cutoff = deadlineAt('2026-09-01', 10)
assert(new Date('2026-09-11T16:59:59.999Z') <= h10Cutoff, 'H+10 harus diterima sampai 23:59:59.999 WITA')
assert(new Date('2026-09-11T17:00:00.000Z') > h10Cutoff, 'H+10 harus ditolak setelah cutoff WITA')

const temporaryUntil = new Date('2026-09-10T10:00:00Z')
assert(effectiveDays({ normal: 7, temporary: 10, temporaryUntil, asOf: new Date('2026-09-10T10:00:00Z') }) === 10, 'Override harus aktif sampai timestamp inklusif')
assert(effectiveDays({ normal: 7, temporary: 10, temporaryUntil, asOf: new Date('2026-09-10T10:00:00.001Z') }) === 7, 'Override harus fallback otomatis setelah expiry')

const allCategories = [...Object.keys(REPLACEMENT_TYPES), ...Object.keys(WORK_CATEGORIES)]
assert(allCategories.length === 8, `Jumlah kategori Lembur harus 8, ditemukan ${allCategories.length}`)
assert(new Set(allCategories).size === 8, 'Kategori Lembur tidak boleh duplikat')
for (const category of [
  'REPLACEMENT_LEAVE',
  'REPLACEMENT_SICK',
  'REPLACEMENT_PERMISSION',
  'ADMINISTRASI',
  'GARDU',
  'JTM',
  'JTR',
  'ROW',
]) {
  assert(allCategories.includes(category), `Kategori ${category} belum tercakup`)
}

for (const table of [
  'overtime_initial_deadline_configs',
  'overtime_initial_deadline_config_history',
]) {
  assert(sql.includes(`create table public.${table}`), `Table ${table} tidak ditemukan`)
  assert(sql.includes(`alter table public.${table} enable row level security`), `RLS ${table} belum aktif`)
}
assert(sql.includes('initial_submission_days between 1 and 30'), 'Range normal 1-30 belum ditegakkan')
assert(sql.includes('temporary_submission_days between 1 and 30'), 'Range temporary 1-30 belum ditegakkan')
assert(sql.includes('old_temporary_submission_days is not null'), 'Snapshot temporary lama harus lengkap')
assert(sql.includes('new_temporary_submission_days is not null'), 'Snapshot temporary baru harus lengkap')
assert(sql.includes('trg_overtime_initial_deadline_config_audit'), 'Audit trigger belum tersedia')
assert(sql.includes('trg_overtime_initial_deadline_config_history_append_only'), 'Audit history belum append-only')

for (const name of [
  'enforce_overtime_initial_deadline_l6',
  'enforce_overtime_evidence_initial_deadline_l6',
  'auth_can_manage_overtime_activity_evidence',
  'expire_overtime_initial_drafts_l6',
  'submit_overtime_replacement_l2',
  'submit_overtime_work_l3',
  'list_overtime_replacements_l2',
  'list_overtime_work_l3',
]) {
  assert(functionBody(name).includes('resolve_overtime_initial_deadline('), `${name} belum memakai canonical deadline resolver`)
}
assert(functionBody('sync_overtime_activity_business_dates').includes('resolve_overtime_initial_deadline_config('), 'Deadline cache belum memakai canonical config resolver')
assert(functionBody('expire_overtime_initial_drafts_l5').includes('expire_overtime_initial_drafts_l6('), 'Alias expiry L5 tidak mendelegasikan resolver canonical')
const prepareEvidence = functionBody('prepare_overtime_evidence_upload')
assert(prepareEvidence.includes('auth_can_manage_overtime_activity_evidence(p_activity_id)'), 'Prepare evidence belum memakai authorization deadline canonical')
assert(prepareEvidence.includes("v_activity.work_category in ('GARDU', 'JTM', 'JTR', 'ROW')"), 'Evidence pekerjaan lapangan belum mencakup ROW')

const evidenceAuthorization = functionBody('auth_can_manage_overtime_activity_evidence')
assert(evidenceAuthorization.includes('activity.revision_deadline_at'), 'Revision D+3 branch hilang')
assert(!evidenceAuthorization.includes('resolve_overtime_initial_deadline(\n            activity.contract_id,\n            activity.up3_id,\n            activity.revision_deadline_at'), 'Revision deadline tidak boleh memakai initial resolver')

const expiryBody = functionBody('expire_overtime_initial_drafts_l6')
assert(expiryBody.includes("activity.status = 'DRAFT'"), 'Expiry hanya boleh menutup DRAFT')
assert(expiryBody.includes('coalesce(activity.submission_count, 0) = 0'), 'Expiry hanya boleh menutup Draft awal')
assert(expiryBody.includes('activity.deleted_at is null'), 'Expiry harus mengecualikan soft-deleted activity')
assert(!functionBody('set_overtime_initial_deadline_config').includes('update public.overtime_activities'), 'Mutation config tidak boleh membuka atau menulis ulang activity existing')
assert(!/submission_deadline\s*\+\s*time/i.test(sql), 'Active migration masih memiliki keputusan dari cached submission_deadline')

console.log(`Configurable overtime initial deadline contract tests passed: ${passed}`)
