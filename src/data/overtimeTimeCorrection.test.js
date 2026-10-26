import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { overtimeTimeCorrectionPreview } from './overtimeTimeCorrection.js'

const ninety = overtimeTimeCorrectionPreview({
  hourlyRate: 100000,
  date: '2026-08-20',
  startTime: '08:00',
  endTime: '09:30',
})
assert.equal(ninety.minutes, 90)
assert.equal(ninety.durationHours, 1.5)
assert.equal(ninety.multiplierHours, 2.5)
assert.equal(ninety.amount, 250000)
assert.equal(ninety.startedAt, '2026-08-20T08:00:00+07:00')
assert.equal(ninety.endedAt, '2026-08-20T09:30:00+07:00')

const overnight = overtimeTimeCorrectionPreview({
  hourlyRate: 87500,
  date: '2026-08-31',
  startTime: '22:00',
  endTime: '02:00',
})
assert.equal(overnight.minutes, 240)
assert.equal(overnight.multiplierHours, 7.5)
assert.equal(overnight.amount, 656250)
assert.equal(overnight.endedAt, '2026-09-01T02:00:00+07:00')

const oneMinute = overtimeTimeCorrectionPreview({
  hourlyRate: 100000, date: '2026-08-20', startTime: '08:00', endTime: '08:01',
})
assert.equal(oneMinute.minutes, 1)
assert.equal(oneMinute.multiplierHours, 0.025)
assert.equal(oneMinute.amount, 2500)

const sixtyMinutes = overtimeTimeCorrectionPreview({
  hourlyRate: 100000, date: '2026-08-20', startTime: '08:00', endTime: '09:00',
})
assert.equal(sixtyMinutes.multiplierHours, 1.5)
assert.equal(sixtyMinutes.amount, 150000)

const sixtyOneMinutes = overtimeTimeCorrectionPreview({
  hourlyRate: 100000, date: '2026-08-20', startTime: '08:00', endTime: '09:01',
})
assert.equal(sixtyOneMinutes.multiplierHours, 1.5333)
assert.equal(sixtyOneMinutes.amount, 153330)

const fullDay = overtimeTimeCorrectionPreview({
  hourlyRate: 1000, date: '2026-08-20', startTime: '00:00', endTime: '23:59',
})
assert.equal(fullDay.minutes, 1439)
assert.equal(fullDay.multiplierHours, 47.4667)
assert.equal(fullDay.amount, 47466.7)

const approvedCase = overtimeTimeCorrectionPreview({
  hourlyRate: 21399, date: '2026-10-20', startTime: '08:10', endTime: '16:20',
})
assert.equal(approvedCase.multiplierHours, 15.8333)
assert.equal(approvedCase.amount, 338816.79)

const zeroRate = overtimeTimeCorrectionPreview({
  hourlyRate: 0, date: '2026-08-20', startTime: '08:00', endTime: '09:00',
})
assert.equal(zeroRate.amount, 0)

assert.equal(overtimeTimeCorrectionPreview({
  hourlyRate: 100000, date: '2026-08-20', startTime: '08:00', endTime: '08:00',
}), null)
assert.equal(overtimeTimeCorrectionPreview({
  hourlyRate: null, date: '2026-08-20', startTime: '08:00', endTime: '09:00',
}), null)
assert.equal(overtimeTimeCorrectionPreview({
  hourlyRate: 100000, date: '', startTime: '08:00', endTime: '09:00',
}), null)
assert.equal(overtimeTimeCorrectionPreview({
  hourlyRate: Number.NaN, date: '2026-08-20', startTime: '08:00', endTime: '09:00',
}), null)

const migration = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20261026062110_overtime_super_admin_time_correction.sql',
  import.meta.url,
)), 'utf8')
const rpcStart = migration.indexOf('create or replace function public.correct_overtime_entry_times_super_admin_l6(')
assert.ok(rpcStart >= 0, 'RPC koreksi jam Super Admin tidak ditemukan')
const rpc = migration.slice(rpcStart, migration.indexOf('\n$function$;', rpcStart))
assert.ok(rpc.includes('public.auth_is_super_admin()'), 'RPC harus memeriksa Super Admin')
assert.ok(rpc.includes("v_activity.type not in ('WORK','REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION')"), 'RPC harus mendukung semua jenis lembur')
assert.ok(!/v_activity\.status\s*(<>|not in)/i.test(rpc), 'Koreksi harus berlaku pada semua status pengajuan')
assert.ok(!/v_entry\.approval_status\s*(<>|not in)/i.test(rpc), 'Koreksi harus berlaku pada semua status peserta')
assert.ok(rpc.includes('v_activity.updated_at is distinct from p_expected_updated_at'), 'RPC harus memakai token perubahan')
assert.ok(rpc.includes('v_entry.hourly_rate_snapshot * v_multiplier'), 'Nominal harus memakai tarif historis')
assert.ok(!/hourly_rate_snapshot\s*=/.test(rpc), 'Koreksi tidak boleh mengubah tarif snapshot')
assert.ok(rpc.includes('calculated_amount_snapshot = v_amount'), 'Nominal harus diperbarui')
assert.ok(rpc.includes('duration_hours_snapshot = v_duration'), 'Durasi harus diperbarui')
assert.ok(rpc.includes('approval_status'), 'RPC harus memeriksa status peserta')
assert.ok(!/update\s+public\.overtime_entries[\s\S]*?approval_status\s*=/.test(rpc), 'Koreksi tidak boleh mengubah status peserta')
assert.ok(!/update\s+public\.overtime_activities[\s\S]*?\bstatus\s*=/.test(rpc), 'Koreksi tidak boleh mengubah status pengajuan')
assert.ok(!rpc.includes('refresh_overtime_activity_review_status'), 'Koreksi tidak boleh memanggil agregator status')
assert.ok(!rpc.includes('delete from public.overtime_entries'), 'Koreksi tidak boleh mengganti entry')
assert.ok(!rpc.includes('approved_at ='), 'Koreksi tidak boleh mengubah approved_at')
assert.ok(!rpc.includes('approved_by ='), 'Koreksi tidak boleh mengubah approved_by')
assert.ok(!rpc.includes('overtime_evidence'), 'Koreksi tidak boleh menyentuh evidence')
assert.ok(rpc.includes("event, actor_user_id, previous_status, new_status, reason, notes"), 'Audit history harus lengkap')
assert.ok(rpc.includes("'CORRECTED'"), 'Audit harus memakai event CORRECTED')
assert.ok(rpc.includes("'overtime.time_correction_activity'"), 'Trigger pembatas harus memakai scope koreksi')
assert.ok(migration.includes('new.submission_deadline := old.submission_deadline'), 'Deadline draft harus dipertahankan')
assert.ok(migration.includes('new.status is not distinct from old.status'), 'Bypass deadline hanya boleh saat status tetap')

const descriptionFix = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20261026064706_overtime_time_correction_description_fix.sql',
  import.meta.url,
)), 'utf8')
assert.ok(descriptionFix.includes("if v_activity.description = v_old_description then"), 'Patch deskripsi aktivitas pengganti hilang')
assert.ok(descriptionFix.includes("if v_entry.description = v_old_description then"), 'Patch deskripsi entry pengganti hilang')
assert.ok(descriptionFix.includes("'if true then'"), 'Deskripsi pengganti harus tetap diperbarui saat nama berubah')

const repo = readFileSync(fileURLToPath(new URL('./overtimeReplacementRepository.js', import.meta.url)), 'utf8')
assert.ok(repo.includes('correctOvertimeEntryTimes'), 'Wrapper koreksi jam hilang')
assert.ok(repo.includes("rpc('correct_overtime_entry_times_super_admin_l6'"), 'Wrapper harus memanggil RPC koreksi jam')

const component = readFileSync(fileURLToPath(new URL('../components/sla/SLALembur.jsx', import.meta.url)), 'utf8')
assert.ok(component.includes('Koreksi Jam'), 'Aksi Koreksi Jam hilang')
assert.ok(component.includes('Koreksi Jam & Nominal'), 'Judul modal koreksi jam hilang')
assert.ok(component.includes('Tarif historis'), 'Pratinjau tarif historis hilang')
assert.ok(component.includes('Nominal baru'), 'Pratinjau nominal baru hilang')
assert.ok(component.includes('canCorrectTimeRecord'), 'Hak akses aksi koreksi jam hilang')
assert.ok(component.includes('Hanya peserta ini yang dikoreksi'), 'Penjelasan batas koreksi hilang')
assert.ok(component.includes('Data Lembur berubah di sesi lain'), 'Pemulihan konflik sesi lain hilang')
assert.ok(component.includes('Koreksi Data Lembur'), 'Label riwayat koreksi harus netral')

console.log('Overtime Super Admin time correction tests passed')
