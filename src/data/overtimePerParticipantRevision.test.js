import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

// 1. Tombol revisi per peserta harus memakai row yang diklik,
//    bukan peserta pertama dalam aktivitas.
const lemburUrl = new URL('../components/sla/SLALembur.jsx', import.meta.url)
const lembur = readFileSync(fileURLToPath(lemburUrl), 'utf8')
const editStart = lembur.indexOf('const editDraft = (record)')
assert(editStart >= 0, 'Fungsi editDraft tidak ditemukan')
const editBody = lembur.slice(editStart, editStart + 1200)
assert(editBody.includes('recordReviewStatus(record)'), 'editDraft harus memeriksa status row yang diklik')
assert(!editBody.includes("recordReviewStatus(first)==='DRAFT'"), 'editDraft tidak boleh memakai peserta pertama untuk validasi')
assert(editBody.includes('Data sudah berubah status'), 'editDraft harus memberi pesan saat status berubah')
assert(lembur.includes('activeHasApproved'), 'Form harus menghitung peserta yang sudah disetujui')
assert(lembur.includes('Evidence dikunci karena sebagian peserta sudah disetujui'), 'Form harus menjelaskan evidence dikunci')

// 2. Evidence bersama dikunci di backend bila ada peserta APPROVED.
const migrationUrl = new URL(
  '../../supabase/migrations/20261007160000_overtime_evidence_lock_on_approval.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
const fnStart = sql.indexOf('create or replace function public.auth_can_manage_overtime_activity_evidence')
assert(fnStart >= 0, 'Fungsi evidence manage tidak ditemukan')
const fnBody = sql.slice(fnStart)
assert(fnBody.includes("approval_status = 'APPROVED'"), 'Evidence harus dikunci saat ada peserta APPROVED')
assert(fnBody.includes('not exists'), 'Kunci evidence harus memakai not exists')

// 3. Pesan repository menjelaskan penguncian evidence.
const repoUrl = new URL('./overtimeEvidenceRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
assert(repo.includes('sebagian peserta sudah disetujui'), 'Pesan evidence harus menyebut peserta disetujui')

console.log(`Overtime per-participant revision tests passed: ${passed}`)
