import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migrationUrl = new URL(
  '../../supabase/migrations/20261007150000_overtime_replacement_revision_save.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const fnStart = sql.indexOf('create or replace function public.save_overtime_replacement_draft_l2')
assert(fnStart >= 0, 'Fungsi save replacement tidak ditemukan')
const body = sql.slice(fnStart)
assert(body.length > 1000, 'Body fungsi save replacement tidak lengkap')

// Skema benar: revisi CORRECTION_REQUIRED bisa disimpan, DRAFT tetap bisa.
assert(body.includes("'DRAFT','CORRECTION_REQUIRED'"), 'Fungsi harus menerima DRAFT dan CORRECTION_REQUIRED')
assert(!body.includes("status<>'DRAFT' then raise exception 'Only DRAFT replacement overtime can be changed'"), 'Validasi lama DRAFT-only harus dihapus')
assert(body.includes('Only DRAFT or revision replacement overtime can be changed'), 'Pesan status baru hilang')
assert(body.includes('Revision deadline has expired'), 'Validasi batas revisi hilang')

// Metadata revisi harus dipertahankan sampai resubmit_overtime_l5.
assert(body.includes("case when v_is_revision then 'CORRECTION_REQUIRED' else 'DRAFT' end"), 'approval_status revisi harus dipertahankan')
assert(body.includes('v_carry_rejections'), 'rejection_count revisi harus dipertahankan')
assert(body.includes('v_carry_deadline'), 'revision_deadline_at revisi harus dipertahankan')
assert(body.includes("event,actor_user_id,previous_status,new_status,notes"), 'Riwayat revisi harus mencatat event')
assert(body.includes("resubmit_overtime_l5"), 'Komentar harus menegaskan resubmit lewat resubmit_overtime_l5')

console.log(`Overtime replacement revision tests passed: ${passed}`)
