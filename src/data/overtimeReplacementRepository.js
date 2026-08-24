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
  }
}

async function rpc(name, parameters) {
  const { data, error } = await supabase.rpc(name, parameters)
  if (error) throw new Error(error.message || `${name} gagal.`)
  return data
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
