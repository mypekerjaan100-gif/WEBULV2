import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migration = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20261026083508_overtime_unified_entry_correction.sql',
  import.meta.url,
)), 'utf8')
const targetOnlyFix = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20261026083528_overtime_unified_correction_target_only_fix.sql',
  import.meta.url,
)), 'utf8')

const rpcStart = migration.indexOf('create or replace function public.correct_overtime_entry_super_admin_l7(')
assert.ok(rpcStart >= 0, 'RPC koreksi Lembur terpadu tidak ditemukan')
const rpc = migration.slice(rpcStart, migration.indexOf('\n$function$;', rpcStart))

assert.ok(rpc.includes('public.auth_is_super_admin()'), 'RPC harus memeriksa Super Admin')
assert.ok(rpc.includes('p_apply boolean'), 'RPC harus mendukung pratinjau tanpa menulis')
assert.ok(rpc.includes('if not v_apply then'), 'Mode pratinjau harus berhenti sebelum menulis')
assert.ok(rpc.includes('v_activity.updated_at is distinct from p_expected_updated_at'), 'RPC harus memakai token perubahan')
assert.ok(rpc.includes('where activity_id = p_activity_id\n    order by id\n    for update'), 'RPC harus mengunci seluruh peserta saat menerapkan')
assert.ok(rpc.includes("v_activity.type not in ('WORK','REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION')"), 'RPC harus mendukung semua jenis lembur')
assert.ok(!/v_activity\.status\s*(<>|not in)/i.test(rpc), 'Koreksi harus berlaku pada semua status pengajuan')
assert.ok(!/v_entry\.approval_status\s*(<>|not in)/i.test(rpc), 'Koreksi harus berlaku pada semua status peserta')
assert.ok(rpc.includes('v_date_changed := p_overtime_date is distinct from v_activity.overtime_date'), 'RPC harus mendeteksi perubahan tanggal')
assert.ok(rpc.includes('v_new_started := (\n        p_overtime_date'), 'Peserta lain harus dipindah tanggal dengan jam lokal tetap')
assert.ok(rpc.includes('work_date = p_overtime_date'), 'Perubahan tanggal harus memperbarui tanggal peserta')
assert.ok(rpc.includes('period_month = date_trunc('), 'Perubahan tanggal harus memperbarui periode')
assert.ok(rpc.includes("from public.employee_hourly_rate_history"), 'Perubahan tanggal harus memakai tarif tanggal baru')
assert.ok(rpc.includes('hourly_rate_snapshot = (v_participant ->> \'rate\')::numeric'), 'Tarif baru harus disimpan')
assert.ok(rpc.includes('calculated_amount_snapshot = (v_participant ->> \'amount\')::numeric'), 'Nominal harus dihitung ulang')
assert.ok(rpc.includes("case when (v_participant ->> 'is_target')::boolean then 'CORRECTED' else 'DATE_CORRECTED' end"), 'Audit target dan peserta lain harus terpisah')
assert.ok(rpc.includes("'overtime.time_correction_recalc_dates'"), 'Perubahan tanggal harus memicu sinkronisasi tanggal')
assert.ok(rpc.includes("'overtime.date_transition'"), 'Perubahan tanggal harus memakai transisi tanggal atomik')
assert.ok(!rpc.includes('refresh_overtime_activity_review_status'), 'Koreksi tidak boleh memanggil agregator status')
assert.ok(!rpc.includes('delete from public.overtime_entries'), 'Koreksi tidak boleh mengganti entry')
assert.ok(!rpc.includes('approved_at ='), 'Koreksi tidak boleh mengubah approved_at')
assert.ok(!rpc.includes('approved_by ='), 'Koreksi tidak boleh mengubah approved_by')
assert.ok(!rpc.includes('overtime_evidence'), 'Koreksi tidak boleh menyentuh evidence')
assert.ok(migration.includes("revoke all on function public.correct_overtime_entry_times_super_admin_l6"), 'RPC koreksi lama harus ditutup')
assert.ok(migration.includes("revoke all on function public.correct_approved_overtime_work_l6"), 'Koreksi batch lama harus ditutup')
assert.ok(targetOnlyFix.includes("not (v_participant ->> ''is_target'')::boolean"), 'Koreksi jam saja tidak boleh menulis peserta lain')

const repo = readFileSync(fileURLToPath(new URL('./overtimeReplacementRepository.js', import.meta.url)), 'utf8')
assert.ok(repo.includes('previewOvertimeEntryCorrection'), 'Wrapper pratinjau koreksi hilang')
assert.ok(repo.includes('correctOvertimeEntrySuperAdmin'), 'Wrapper penerapan koreksi hilang')
assert.ok(repo.includes("rpc('correct_overtime_entry_super_admin_l7'"), 'Wrapper harus memakai RPC koreksi terpadu')
assert.ok(!repo.includes('correctApprovedOvertimeWork'), 'Wrapper koreksi batch lama harus dihapus')
assert.ok(!repo.includes('correctOvertimeEntryTimes'), 'Wrapper koreksi jam lama harus dihapus')

const component = readFileSync(fileURLToPath(new URL('../components/sla/SLALembur.jsx', import.meta.url)), 'utf8')
assert.ok(component.includes('>Koreksi</Button>'), 'Satu aksi Koreksi hilang')
assert.ok(!component.includes('Koreksi Batch'), 'Aksi koreksi batch harus dihapus')
assert.ok(!component.includes('Koreksi Jam</Button>'), 'Aksi koreksi jam terpisah harus dihapus')
assert.ok(!component.includes('canCorrectApprovedWork'), 'Prop koreksi batch lama harus dihapus')
assert.ok(component.includes('Koreksi Lembur'), 'Judul modal koreksi hilang')
assert.ok(component.includes('Tanggal Lembur *'), 'Input tanggal koreksi hilang')
assert.ok(component.includes('Tanggal baru berlaku untuk seluruh'), 'Penjelasan dampak tanggal hilang')
assert.ok(component.includes('Nominal baru target'), 'Pratinjau nominal target hilang')
assert.ok(component.includes('participant.previousDate'), 'Pratinjau tanggal peserta lain hilang')
assert.ok(component.includes('previewOvertimeEntryCorrection'), 'UI harus memakai pratinjau server')
assert.ok(component.includes('correctOvertimeEntrySuperAdmin'), 'UI harus memakai RPC koreksi terpadu')
assert.ok(component.includes('Koreksi Data Lembur'), 'Label riwayat koreksi harus netral')
assert.ok(component.includes('Tanggal Peserta Dikoreksi'), 'Label riwayat peserta yang ikut pindah tanggal hilang')

const page = readFileSync(fileURLToPath(new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url)), 'utf8')
assert.ok(!page.includes('canCorrectApprovedWork'), 'Halaman tidak boleh lagi mengirim akses koreksi batch')

console.log('Overtime unified correction tests passed')
