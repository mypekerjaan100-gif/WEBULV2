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
      throw new Error('Batas pengajuan telah lewat. Pilih tanggal lembur yang masih berada dalam batas pengajuan 7 hari.')
    }
    if (/revision deadline has expired|batas revisi telah/i.test(message)) {
      throw new Error('Batas revisi telah lewat. Transaksi Lembur sudah kedaluwarsa.')
    }
    throw new Error(message)
  }
  return data
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
    status: row.status,
    participantEmployeeId: row.participant_employee_id,
    participantName: row.participant_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationHours: Number(row.duration_hours),
    total: Number(row.total_amount),
    submissionDeadlineAt: row.submission_deadline_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rejectionCount: Number(row.rejection_count ?? 0),
    revisionDeadlineAt: row.revision_deadline_at,
    closureReason: row.closure_reason,
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
  })
}

export async function submitOvertimeWork(activityId) {
  return rpc('submit_overtime_work_l3', { p_activity_id: activityId })
}

export async function approveOvertime(activityId) {
  return rpc('approve_overtime_l5', { p_activity_id: activityId })
}
export async function rejectOvertime(activityId, reason) {
  return rpc('reject_overtime_l5', { p_activity_id: activityId, p_reason: reason })
}
export async function resubmitOvertime(activityId) {
  return rpc('resubmit_overtime_l5', { p_activity_id: activityId })
}
export async function listOvertimeHistory(activityId) {
  return rpc('list_overtime_history_l5', { p_activity_id: activityId })
}
export async function getOvertimeDetail(activityId) {
  return rpc('get_overtime_detail_l5', { p_activity_id: activityId })
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
