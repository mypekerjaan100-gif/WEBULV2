import { supabase } from '../lib/supabaseClient.js'

function mapRecord(row) {
  return {
    id: row.activity_id,
    entryId: row.entry_id,
    contractId: row.contract_id,
    up3Id: row.up3_id,
    unitId: row.unit_id,
    periodMonth: row.period_month,
    date: row.overtime_date,
    type: row.type,
    participantEmployeeId: row.participant_employee_id,
    participantName: row.participant_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationHours: Number(row.duration_hours),
    total: Number(row.total_amount),
    description: row.description,
    status: row.status,
    submissionDeadlineAt: row.submission_deadline_at,
    replacedEmployeeId: row.replaced_employee_id,
    replacedEmployeeName: row.replaced_employee_name,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rejectionCount: Number(row.rejection_count ?? 0),
    revisionDeadlineAt: row.revision_deadline_at,
    closureReason: row.closure_reason,
  }
}

async function rpc(name, parameters) {
  const { data, error } = await supabase.rpc(name, parameters)
  if (error) {
    const message = error.message || `${name} gagal.`
    if (/submission deadline has passed|batas pengajuan telah lewat/i.test(message)) {
      if (/batas pengajuan/i.test(message)) throw new Error(message)
      const days = message.match(/(\d+)\s*days?/i)?.[1]
      throw new Error(`Batas pengajuan${days ? ` ${days} hari` : ''} telah lewat. Pilih tanggal lembur yang masih berada dalam batas pengajuan.`)
    }
    if (/revision deadline has expired|batas revisi telah/i.test(message)) {
      throw new Error('Batas revisi telah lewat. Transaksi Lembur sudah kedaluwarsa.')
    }
    throw new Error(message)
  }
  return data
}

function mapInitialDeadlineConfig(row) {
  if (!row) return null
  return {
    contractId: row.contract_id,
    up3Id: row.up3_id,
    configExists: Boolean(row.config_exists),
    initialSubmissionDays: Number(row.initial_submission_days),
    temporarySubmissionDays: row.temporary_submission_days == null
      ? null
      : Number(row.temporary_submission_days),
    temporaryEffectiveUntil: row.temporary_effective_until,
    temporaryReason: row.temporary_reason,
    temporaryIsActive: Boolean(row.temporary_is_active),
    effectiveSubmissionDays: Number(row.effective_submission_days),
    overtimeDate: row.overtime_date,
    effectiveDeadlineDate: row.effective_deadline_date,
    effectiveDeadlineAt: row.effective_deadline_at,
    asOf: row.as_of,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    revision: row.revision == null ? null : Number(row.revision),
  }
}

export async function getOvertimeInitialDeadlineConfig({ contractId, up3Id, overtimeDate }) {
  const rows = await rpc('get_overtime_initial_deadline_config', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_overtime_date: overtimeDate,
  })
  return mapInitialDeadlineConfig((rows ?? [])[0])
}

export async function setOvertimeInitialDeadlineConfig({
  contractId,
  up3Id,
  initialSubmissionDays,
  temporarySubmissionDays = null,
  temporaryEffectiveUntil = null,
  temporaryReason = null,
}) {
  return rpc('set_overtime_initial_deadline_config', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_initial_submission_days: initialSubmissionDays,
    p_temporary_submission_days: temporarySubmissionDays,
    p_temporary_effective_until: temporaryEffectiveUntil,
    p_temporary_reason: temporaryReason,
  })
}

export async function expireInitialOvertimeDrafts({ contractId, up3Id, unitId }) {
  return rpc('expire_overtime_initial_drafts_l6', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId ?? null,
  })
}

export async function listReplacementEmployees({ contractId, up3Id, startedAt }) {
  const rows = await rpc('list_overtime_replacement_employees_l2', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_started_at: startedAt,
  })
  return (rows ?? []).map((row) => ({
    id: row.employee_id,
    name: row.name,
    unitId: row.unit_id,
  }))
}

export async function listOvertimeReplacements({ contractId, up3Id, unitId, periodMonth }) {
  const rows = await rpc('list_overtime_replacements_l2', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId ?? null,
    p_period_month: periodMonth ?? null,
  })
  return (rows ?? []).map(mapRecord)
}

export async function saveOvertimeReplacementDraft({
  activityId,
  contractId,
  up3Id,
  unitId,
  type,
  replacedEmployeeId,
  participantEmployeeId,
  startedAt,
  endedAt,
}) {
  return rpc('save_overtime_replacement_draft_l2', {
    p_activity_id: activityId ?? null,
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId,
    p_type: type,
    p_replaced_employee_id: replacedEmployeeId,
    p_participant_employee_id: participantEmployeeId,
    p_started_at: startedAt,
    p_ended_at: endedAt,
  })
}

export async function submitOvertimeReplacement(activityId) {
  return rpc('submit_overtime_replacement_l2', { p_activity_id: activityId })
}

function nullableNumber(value) {
  return value === null || value === undefined ? null : Number(value)
}

function mapWorkRecord(row) {
  return {
    id: row.activity_id,
    entryId: row.entry_id,
    contractId: row.contract_id,
    up3Id: row.up3_id,
    unitId: row.unit_id,
    periodMonth: row.period_month,
    date: row.overtime_date,
    type: 'WORK',
    workCategory: row.work_category,
    workTitle: row.work_title,
    workLocation: row.work_location,
    description: row.description,
    rowVarSpanCount: nullableNumber(row.row_var_span_count),
    rowPruningSpanCount: nullableNumber(row.row_pruning_span_count),
    rowFelling2040Count: nullableNumber(row.row_felling_20_40_count),
    rowFelling4160Count: nullableNumber(row.row_felling_41_60_count),
    status: row.status,
    entryStatus: row.entry_approval_status ?? row.status,
    participantEmployeeId: row.participant_employee_id,
    participantName: row.participant_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationHours: Number(row.duration_hours),
    total: Number(row.total_amount),
    submissionDeadlineAt: row.submission_deadline_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rejectionCount: Number(row.entry_rejection_count ?? row.rejection_count ?? 0),
    activityRejectionCount: Number(row.rejection_count ?? 0),
    // Kolom entry selalu ada dari RPC: null eksplisit berarti peserta ini
    // tidak punya batas revisi (jangan warisi batas batch peserta lain).
    revisionDeadlineAt: ('entry_revision_deadline_at' in row) ? row.entry_revision_deadline_at : row.revision_deadline_at,
    activityRevisionDeadlineAt: row.revision_deadline_at,
    // Alasan penutupan per peserta; fallback alasan aktivitas dipakai
    // hanya bila kolom peserta tidak tersedia di RPC.
    entryClosureReason: ('entry_closure_reason' in row) ? row.entry_closure_reason : null,
    closureReason: row.closure_reason,
    evidenceMode: row.evidence_mode ?? 'LEGACY_SHARED',
  }
}

export async function listOvertimeWork({ contractId, up3Id, unitId, periodMonth }) {
  const rows = await rpc('list_overtime_work_l3', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId ?? null,
    p_period_month: periodMonth ?? null,
  })
  return (rows ?? []).map(mapWorkRecord)
}

export async function saveOvertimeWorkDraft({
  activityId,
  contractId,
  up3Id,
  unitId,
  workCategory,
  description,
  workTitle,
  workLocation,
  participants,
  revisionEntryId,
  rowVarSpanCount,
  rowPruningSpanCount,
  rowFelling2040Count,
  rowFelling4160Count,
}) {
  return rpc('save_overtime_work_draft_l3', {
    p_activity_id: activityId ?? null,
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId,
    p_work_category: workCategory,
    p_description: description,
    p_work_title: workTitle ?? null,
    p_work_location: workLocation ?? null,
    p_participants: participants,
    p_revision_entry_id: revisionEntryId ?? null,
    p_row_var_span_count: rowVarSpanCount ?? null,
    p_row_pruning_span_count: rowPruningSpanCount ?? null,
    p_row_felling_20_40_count: rowFelling2040Count ?? null,
    p_row_felling_41_60_count: rowFelling4160Count ?? null,
  })
}

export async function submitOvertimeWork(activityId) {
  return rpc('submit_overtime_work_l3', { p_activity_id: activityId })
}
export async function saveOvertimeWorkRevision({ activityId, revisionEntryId, overtimeDate, startedAt, endedAt, expectedUpdatedAt }) {
  return rpc('save_overtime_work_revision_l3', {
    p_activity_id: activityId ?? null,
    p_revision_entry_id: revisionEntryId ?? null,
    p_overtime_date: overtimeDate,
    p_started_at: startedAt,
    p_ended_at: endedAt,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  })
}

export async function approveOvertime(activityId) {
  return rpc('approve_overtime_l5', { p_activity_id: activityId })
}
export async function approveOvertimeEntry(entryId) {
  return rpc('approve_overtime_entry_l5', { p_entry_id: entryId })
}
export async function rejectOvertime(activityId, reason) {
  return rpc('reject_overtime_l5', { p_activity_id: activityId, p_reason: reason })
}
export async function rejectOvertimeEntry(entryId, reason) {
  return rpc('reject_overtime_entry_l5', { p_entry_id: entryId, p_reason: reason })
}
export async function finalRejectOvertime(activityId, reason) {
  return rpc('final_reject_overtime_l5', { p_activity_id: activityId, p_reason: reason })
}
export async function finalRejectOvertimeEntry(entryId, reason) {
  return rpc('final_reject_overtime_entry_l5', { p_entry_id: entryId, p_reason: reason })
}
export async function resubmitOvertime(activityId) {
  return rpc('resubmit_overtime_l5', { p_activity_id: activityId })
}
export async function resubmitOvertimeEntry(entryId) {
  return rpc('resubmit_overtime_entry_l5', { p_entry_id: entryId })
}
export async function softDeleteOvertimeActivity(activityId, reason) {
  return rpc('soft_delete_overtime_activity', { p_activity_id: activityId, p_reason: reason })
}
export async function softDeleteOvertimeEntry(entryId, reason) {
  return rpc('soft_delete_overtime_entry_l5', { p_entry_id: entryId, p_reason: reason })
}
function mapCorrectionParticipant(row) {
  return {
    entryId: row.entry_id,
    employeeId: row.employee_id,
    participantName: row.participant_name,
    previousStatus: row.previous_status,
    status: row.status,
    previousDate: row.previous_date,
    date: row.date,
    previousStartedAt: row.previous_started_at,
    startedAt: row.started_at,
    previousEndedAt: row.previous_ended_at,
    endedAt: row.ended_at,
    previousRate: Number(row.previous_rate ?? 0),
    rate: Number(row.rate ?? 0),
    previousDurationHours: Number(row.previous_duration_hours ?? 0),
    durationHours: Number(row.duration_hours ?? 0),
    previousMultiplierHours: Number(row.previous_multiplier_hours ?? 0),
    multiplierHours: Number(row.multiplier_hours ?? 0),
    previousAmount: Number(row.previous_amount ?? 0),
    amount: Number(row.amount ?? 0),
    isTarget: Boolean(row.is_target),
  }
}

function mapCorrectionPlan(data) {
  if (!data) return null
  return {
    activityId: data.activity_id,
    activityType: data.activity_type,
    activityStatus: data.activity_status,
    entryId: data.entry_id,
    previousDate: data.previous_date,
    date: data.date,
    dateChanged: Boolean(data.date_changed),
    targetChanged: Boolean(data.target_changed),
    applied: Boolean(data.applied),
    periodMonth: data.period_month ?? null,
    participants: (data.participants ?? []).map(mapCorrectionParticipant),
    target: data.target ? mapCorrectionParticipant(data.target) : null,
  }
}

export async function previewOvertimeEntryCorrection({ activityId, entryId, overtimeDate, startedAt, endedAt, expectedUpdatedAt }) {
  const data = await rpc('correct_overtime_entry_super_admin_l7', {
    p_activity_id: activityId,
    p_entry_id: entryId,
    p_overtime_date: overtimeDate,
    p_started_at: startedAt,
    p_ended_at: endedAt,
    p_reason: '',
    p_expected_updated_at: expectedUpdatedAt,
    p_apply: false,
  })
  return mapCorrectionPlan(data)
}

export async function correctOvertimeEntrySuperAdmin({ activityId, entryId, overtimeDate, startedAt, endedAt, reason, expectedUpdatedAt }) {
  const data = await rpc('correct_overtime_entry_super_admin_l7', {
    p_activity_id: activityId,
    p_entry_id: entryId,
    p_overtime_date: overtimeDate,
    p_started_at: startedAt,
    p_ended_at: endedAt,
    p_reason: reason,
    p_expected_updated_at: expectedUpdatedAt,
    p_apply: true,
  })
  return mapCorrectionPlan(data)
}
export async function listOvertimeHistory(activityId) {
  return rpc('list_overtime_history_l5', { p_activity_id: activityId })
}
// Riwayat lembur pegawai (semua jenis/periode, hanya pengajuan yang pernah
// dikirim) berdasarkan ENTRY konteks; server menjaga per-baris scope baca.
export async function listOvertimeEmployeeHistory({ entryId, limit = 10, offset = 0 }) {
  const rows = await rpc('list_overtime_employee_history_l5', {
    p_entry_id: entryId,
    p_limit: limit,
    p_offset: offset,
  })
  return (rows ?? []).map((row) => ({
    entryId: row.entry_id,
    activityId: row.activity_id,
    date: row.overtime_date,
    type: row.type,
    workCategory: row.work_category,
    workTitle: row.work_title,
    workLocation: row.work_location,
    description: row.description,
    unitId: row.unit_id,
    startedAt: row.participant_started_at,
    endedAt: row.participant_ended_at,
    durationHours: Number(row.duration_hours),
    status: row.status,
    approvalStatus: row.approval_status,
    rejectionCount: Number(row.rejection_count ?? 0),
    revisionDeadlineAt: row.revision_deadline_at,
    closureReason: row.closure_reason,
    activityClosureReason: row.activity_closure_reason,
    totalCount: Number(row.total_count ?? 0),
  }))
}
export async function getOvertimeDetail(activityId) {
  return rpc('get_overtime_detail_l5', { p_activity_id: activityId })
}
export async function listOvertimeActivityEntries(activityId) {
  const rows = await rpc('list_overtime_activity_entries', { p_activity_id: activityId })
  return (rows ?? []).map((row) => ({
    entryId: row.entry_id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    approvalStatus: row.approval_status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    evidenceMode: row.activity_evidence_mode ?? 'LEGACY_SHARED',
  }))
}

export async function getOvertimeSyncVersion({ contractId, up3Id, unitId, periodMonth }) {
  const rows = await rpc('get_overtime_sync_version', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId ?? null,
    p_period_month: periodMonth ?? null,
  })
  const row = (rows ?? [])[0] ?? {}
  return {
    version: row.version ?? null,
    activityCount: Number(row.activity_count ?? 0),
    submittedCount: Number(row.submitted_count ?? 0),
  }
}

export async function listOvertimeEntryFinancial(activityId) {
  const rows = await rpc('list_overtime_entry_financial_l5', { p_activity_id: activityId })
  return (rows ?? []).map((row) => ({
    entryId: row.entry_id,
    employeeId: row.employee_id,
    employeeName: row.employee_name_snapshot,
    hourlyRate: Number(row.hourly_rate_snapshot ?? 0),
    durationHours: Number(row.duration_hours_snapshot ?? 0),
    multiplierHours: Number(row.multiplier_hours_snapshot ?? 0),
    total: Number(row.calculated_amount_snapshot ?? 0),
    startedAt: row.participant_started_at,
    endedAt: row.participant_ended_at,
  }))
}
