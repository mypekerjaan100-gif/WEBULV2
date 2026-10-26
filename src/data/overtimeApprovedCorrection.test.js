import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migration = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20261026083508_overtime_unified_entry_correction.sql',
  import.meta.url,
)), 'utf8')
const repo = readFileSync(fileURLToPath(new URL('./overtimeReplacementRepository.js', import.meta.url)), 'utf8')
const component = readFileSync(fileURLToPath(new URL('../components/sla/SLALembur.jsx', import.meta.url)), 'utf8')
const page = readFileSync(fileURLToPath(new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url)), 'utf8')

assert.ok(migration.includes('revoke all on function public.correct_approved_overtime_work_l6'), 'Endpoint koreksi batch lama harus dicabut')
assert.ok(!repo.includes('correctApprovedOvertimeWork'), 'Repository koreksi batch lama harus dihapus')
assert.ok(!repo.includes("rpc('correct_approved_overtime_work_l6'"), 'RPC koreksi batch lama tidak boleh dipanggil')
assert.ok(!component.includes('canCorrectApprovedWork'), 'UI koreksi batch lama harus dihapus')
assert.ok(!component.includes('Koreksi Batch'), 'Tombol koreksi batch lama harus dihapus')
assert.ok(!component.includes('Koreksi Tanggal & Jam'), 'Modal koreksi batch lama harus dihapus')
assert.ok(!component.includes('STATUS TETAP DISETUJUI'), 'Penanda koreksi batch lama harus dihapus')
assert.ok(!page.includes('canCorrectApprovedWork'), 'Prop koreksi batch lama harus dihapus dari halaman')
assert.ok(component.includes('>Koreksi</Button>'), 'Satu aksi koreksi per peserta harus tersedia')

console.log('Overtime approved correction retirement tests passed: 9')
