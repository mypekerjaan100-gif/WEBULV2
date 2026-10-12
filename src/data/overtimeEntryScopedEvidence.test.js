import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const migrationUrl = new URL(
  '../../supabase/migrations/20261012130000_overtime_entry_scoped_evidence.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')

// Schema: entry-scoped overrides, shared rows preserved.
assert(sql.includes('add column if not exists entry_id uuid'), 'Kolom entry_id hilang')
assert(sql.includes('fk_overtime_evidence_entry_activity'), 'FK entry/activity hilang')
assert(sql.includes('uq_overtime_evidence_shared_single_active'), 'Unique shared hilang')
assert(sql.includes('uq_overtime_evidence_scoped_single_active'), 'Unique scoped hilang')
assert(sql.includes('entry_id is null'), 'Filter shared hilang')

// Entry manage helper.
assert(sql.includes('auth_can_manage_overtime_entry_evidence'), 'Helper entry manage hilang')
assert(sql.includes("entry.approval_status = 'CORRECTION_REQUIRED'"), 'Helper harus mensyaratkan CORRECTION_REQUIRED')

// Scoped prepare keeps shared ACTIVE.
assert(sql.includes('prepare_overtime_entry_evidence_upload'), 'Prepare scoped hilang')
assert(sql.includes('Participant evidence target is required'), 'Validasi target peserta hilang')

// Lifecycle branches on scope.
for (const fn of ['finalize_overtime_evidence_upload', 'cancel_overtime_evidence_upload', 'begin_overtime_evidence_delete']) {
  const start = sql.indexOf(`create or replace function public.${fn}`)
  assert(start >= 0, `Fungsi ${fn} tidak ditemukan`)
  const body = sql.slice(start, start + 2000)
  assert(body.includes('entry_id is null'), `${fn} harus branch shared vs scoped`)
}

// Effective list fallback.
assert(sql.includes('list_overtime_entry_effective_evidence'), 'Effective list hilang')
assert(sql.includes('scoped ACTIVE override else shared'), 'Komentar effective hilang')

// Per-participant resubmit.
assert(sql.includes('resubmit_overtime_entry_l5'), 'Resubmit per peserta hilang')
assert(sql.includes("Only the rejected participant can be resubmitted"), 'Validasi resubmit peserta hilang')

// Save preserves entry IDs when approved.
assert(sql.includes('Preserve entry IDs when any participant is APPROVED'), 'Komentar preserve ID hilang')
assert(sql.includes('Peserta tidak boleh ditambah/dihapus setelah sebagian disetujui'), 'Guard tambah/hapus peserta hilang')
assert(sql.includes('Jam peserta yang sudah disetujui tidak dapat diubah'), 'Guard jam approved hilang')

// Frontend wiring.
const lemburUrl = new URL('../components/sla/SLALembur.jsx', import.meta.url)
const lembur = readFileSync(fileURLToPath(lemburUrl), 'utf8')
assert(lembur.includes('activeRevisionEntryId'), 'SLALembur harus melacak entry revisi')
assert(lembur.includes('isPartialApprovalRevision'), 'SLALembur harus menghitung revisi parsial')
assert(lembur.includes('listOvertimeEntryEffectiveEvidence'), 'SLALembur harus memakai effective evidence')
assert(lembur.includes('resubmitOvertimeEntry'), 'SLALembur harus resubmit per peserta')
assert(lembur.includes('Revisi evidence khusus'), 'SLALembur harus menjelaskan revisi khusus peserta')
assert(lembur.includes('Evidence awal'), 'SLALembur harus menyebut evidence awal')

const cardUrl = new URL('../components/sla/EvidenceUploadCard.jsx', import.meta.url)
const card = readFileSync(fileURLToPath(cardUrl), 'utf8')
assert(card.includes('isPartialRevision'), 'Kartu harus mendukung revisi parsial')
assert(card.includes('evidence awal'), 'Kartu harus melabeli evidence awal')

const repoUrl = new URL('./overtimeEvidenceRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
assert(repo.includes('listOvertimeEntryEffectiveEvidence'), 'Repository harus expose effective list')
assert(repo.includes('prepare_overtime_entry_evidence_upload'), 'Repository harus memakai prepare scoped')

const workRepoUrl = new URL('./overtimeReplacementRepository.js', import.meta.url)
const workRepo = readFileSync(fileURLToPath(workRepoUrl), 'utf8')
assert(workRepo.includes('resubmitOvertimeEntry'), 'Repository work harus expose resubmit per peserta')

console.log(`Overtime entry-scoped evidence tests passed: ${passed}`)
