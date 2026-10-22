import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

function fnBodyAt(source, start) {
  const open = source.indexOf('$function$', start)
  const bodyStart = open + '$function$'.length
  const close = source.indexOf('$function$', bodyStart)
  return source.slice(bodyStart, close)
}

// ---------------------------------------------------------------------------
// Migrasi: Tolak Final untuk Lembur Administrasi, Pengganti Izin, Pengganti Sakit
// ---------------------------------------------------------------------------
const migrationUrl = new URL(
  '../../supabase/migrations/20261022090000_overtime_final_reject.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')

assert(sql.includes('add column if not exists closure_reason text'), 'Kolom closure_reason entries wajib ditambahkan')
assert(sql.includes("oe_closure_reason_check"), 'Constraint alasan penutupan wajib ada')
assert((sql.match(/closure_reason = 'EXPIRED'/g) ?? []).length >= 1, 'Backfill kedaluwarsa dari aktivitas wajib ada')
assert(sql.includes("and a.closure_reason in ('FINAL_REJECTED', 'EXPIRED')"), 'Backfill harus menandai entry CLOSED tanpa alasan aktivitas sebagai final')

function indexOfFn(source, name) {
  const upper = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  if (upper >= 0) return upper
  return source.indexOf(`create or replace function public.${name}(`)
}

// A) Fungsi yang didefinisikan ulang
for (const name of [
  'reject_overtime_entry_l5',
  'final_reject_overtime_entry_l5',
  'final_reject_overtime_l5',
  'reject_overtime_l5',
]) {
  const fnStart = indexOfFn(sql, name)
  assert(fnStart >= 0, `${name} tidak ditemukan`)
}

// B) Gerbang kantor UP3 & review harus berurutan di semua RPC keputusan.
function orderGuard(body, label) {
  const guardPos = body.indexOf('v_activity.up3_id and not public.auth_is_super_admin()')
  const reviewPos = body.indexOf('auth_can_review_overtime_l5')
  assert(guardPos >= 0 && reviewPos > guardPos, `Gerbang kantor UP3 harus sebelum pemeriksaan review pada ${label}`)
}
function assertScope(body, label) {
  assert(body.includes("v_activity.type in ('REPLACEMENT_PERMISSION', 'REPLACEMENT_SICK')"), `Cakupan pengganti izin/sakit hilang pada ${label}`)
  assert(body.includes("v_activity.type = 'WORK' and v_activity.work_category = 'ADMINISTRASI'"), `Cakupan Administrasi hilang pada ${label}`)
  assert(!body.includes('REPLACEMENT_LEAVE'), `Pengganti Cuti tidak boleh ikut Tolak Final pada ${label}`)
}

const entryFnBody = fnBodyAt(sql, indexOfFn(sql, 'final_reject_overtime_entry_l5'))
const activityFnBody = fnBodyAt(sql, indexOfFn(sql, 'final_reject_overtime_l5'))
const rejectEntryBody = fnBodyAt(sql, indexOfFn(sql, 'reject_overtime_entry_l5'))
const rejectActivityBody = fnBodyAt(sql, indexOfFn(sql, 'reject_overtime_l5'))

// B) Tolak Final per peserta
orderGuard(entryFnBody, 'final_reject_overtime_entry_l5')
assertScope(entryFnBody, 'final_reject_overtime_entry_l5')
assert(entryFnBody.includes('Final reject reason is required'), 'Alasan final wajib')
assert(entryFnBody.includes("v_entry.approval_status <> 'SUBMITTED'"), 'Tolak Final hanya untuk peserta Diajukan')
assert(entryFnBody.includes("set approval_status = 'CLOSED'"), 'Status akhir Tolak Final per peserta adalah CLOSED')
assert(entryFnBody.includes("closure_reason = 'FINAL_REJECTED'"), 'Alasan Tolak Final per peserta wajib FINAL_REJECTED')
assert(entryFnBody.includes('revision_deadline_at = null'), 'Batas revisi peserta harus dikosongkan')
assert(entryFnBody.includes("'Penolakan final (Tolak Final)"), 'Riwayat Tolak Final per peserta wajib terekam')
assert(entryFnBody.includes('perform public.refresh_overtime_activity_review_status'), 'Ringkasan aktivitas wajib disegarkan')
assert(!entryFnBody.includes('rejection_count ='), 'Tolak Final per peserta tidak boleh menaikkan hitungan revisi')
assert((entryFnBody.match(/update public\.overtime_entries/g) ?? []).length === 1, 'Tolak Final per peserta hanya menyentuh peserta target')

// C) Tolak Final tingkat aktivitas (pengganti)
orderGuard(activityFnBody, 'final_reject_overtime_l5')
assertScope(activityFnBody, 'final_reject_overtime_l5')
assert(activityFnBody.includes("v_activity.status <> 'SUBMITTED'"), 'Tolak Final aktivitas hanya untuk Diajukan')
assert(activityFnBody.includes("and approval_status = 'SUBMITTED'\n    for update"), 'Loop hanya mengunci peserta Diajukan')
assert((activityFnBody.match(/new_status, reason, notes\)/g) ?? []).length >= 2, 'Riwayat per peserta + aktivitas wajib ada')
assert(activityFnBody.includes("'Penolakan final (Tolak Final)"), 'Riwayat Tolak Final aktivitas wajib terekam')
assert(activityFnBody.includes('perform public.refresh_overtime_activity_review_status'), 'Aktivitas harus disegarkan')
assert(!activityFnBody.includes("'APPROVED'"), 'Tolak Final aktivitas tidak boleh menyentuh peserta Disetujui')

// D) Penolakan ke-3 (organik) juga menandai alasan final
assert(rejectEntryBody.includes("closure_reason = 'FINAL_REJECTED'"), 'Revisi ke-3 per peserta wajib alasan FINAL_REJECTED')
assert(rejectActivityBody.includes("case when v_next_count >= 3 then 'FINAL_REJECTED' else closure_reason end"), 'Revisi ke-3 aktivitas wajib alasan FINAL_REJECTED pada peserta')

// F) List WORK membawa alasan penutupan milik peserta
const listStart = sql.indexOf('create function public.list_overtime_work_l3(')
const listEnd = sql.indexOf('revoke all on function public.list_overtime_work_l3', listStart)
assert(listStart >= 0 && listEnd > listStart, 'List WORK harus didefinisikan ulang')
const listBody = sql.slice(listStart, listEnd)
assert(listBody.includes('entry_closure_reason text'), 'List WORK wajib mengembalikan entry_closure_reason')
assert(listBody.includes('entry.closure_reason'), 'List WORK harus memilih closure_reason peserta')
assert(sql.includes('grant execute on function public.final_reject_overtime_entry_l5(uuid, text) to authenticated'), 'RPC Tolak Final harus dieksekusi authenticated')
assert(sql.includes('grant execute on function public.final_reject_overtime_l5(uuid, text) to authenticated'), 'RPC Tolak Final aktivitas harus dieksekusi authenticated')

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------
const repoUrl = new URL('./overtimeReplacementRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
assert(repo.includes("rpc('final_reject_overtime_entry_l5'"), 'Repository harus memanggil RPC final_reject_overtime_entry_l5')
assert(repo.includes("rpc('final_reject_overtime_l5'"), 'Repository harus memanggil RPC final_reject_overtime_l5')
assert(repo.includes("entryClosureReason: ('entry_closure_reason' in row) ? row.entry_closure_reason : null,"), 'Pemetaan alasan per peserta harus eksplisit')

// ---------------------------------------------------------------------------
// Komponen SLALembur
// ---------------------------------------------------------------------------
const comUrl = new URL('../../src/components/sla/SLALembur.jsx', import.meta.url)
const com = readFileSync(fileURLToPath(comUrl), 'utf8')
assert(com.includes('recordSupportsFinalReject'), 'Helper cakupan Tolak Final wajib ada')
assert(com.includes("record.workCategory === 'ADMINISTRASI'"), 'Cakupan Administrasi pada UI hilang')
assert(com.includes("['REPLACEMENT_PERMISSION', 'REPLACEMENT_SICK'].includes(record.type)"), 'Cakupan Pengganti Izin/Sakit pada UI hilang')
const finalRejectHelperBody = com.slice(
  com.indexOf('function recordSupportsFinalReject('),
  com.indexOf('\n}', com.indexOf('function recordSupportsFinalReject(')),
)
assert(!finalRejectHelperBody.includes('REPLACEMENT_LEAVE'), 'UI tidak boleh memasukkan Pengganti Cuti ke Tolak Final')
assert(com.includes('recordClosureReason(record)'), 'Tampilan status wajib memakai alasan per peserta')
assert((com.match(/detailSupportsFinalReject&&<Button variant="danger" disabled=\{approvalBusy\} onClick=\{\(\)=>openRejectBox\('FINAL'\)\}>Tolak Final<\/Button>/g) ?? []).length === 1, 'Tombol Tolak Final harus muncul tepat satu pada panel approval')
assert(com.includes('openFinalRejectConfirm'), 'Alur konfirmasi Tolak Final wajib ada')
assert(com.includes('await finalRejectOvertimeEntry(entryId, reason)'), 'Tolak Final peserta harus memanggil repository')
assert(com.includes('await finalRejectOvertime(record.id, reason)'), 'Tolak Final pengganti harus memanggil repository')
assert(com.includes("verifyParticipantStatus(record, entryId, ['CLOSED'])"), 'Verifikasi Tolak Final wajib menunggu CLOSED')
assert(com.includes("title=\"Konfirmasi Tolak Final\""), 'Dialog konfirmasi Tolak Final wajib ada')
assert(com.includes('tidak masuk rekap pembayaran'), 'Dialog wajib menjelaskan pengaruh rekap')
const confirmFinalRejectBody = com.slice(
  com.indexOf('const confirmFinalReject'),
  com.indexOf('function friendlyFinalRejectError'),
)
assert(!confirmFinalRejectBody.includes('softDeleteOvertimeEntry'), 'Tolak Final tidak boleh memanggil hapus peserta')
assert(com.includes("'Penolakan final'"), 'Riwayat Tolak Final wajib ditampilkan sebagai Ditolak Final')

console.log(`overtimeFinalReject.test.js: ${passed} assertions passed`)
