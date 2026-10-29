// Display-only exception for migration 20261029075057. Keep the repository's
// full audit untouched; never apply this summary to another overtime activity.
const CORRECTED_ROW_ACTIVITIES = new Set([
  '70ec2e23-b57f-4432-8aaa-3384d02f55b2', // Keraban
  '2eb84c1e-508e-42a3-bc4c-d5430269e1b9', // Ds. Jambu
  'e29d0c27-3cc2-46a3-818d-de70e512f6b2', // Ds. Sasak Dalam
])
const ROW_SUBMISSION_MAINTENANCE_KEY = 'correct_row_oct21_submission_oct28_2026'
const SUBMISSION_DAY_START = Date.parse('2026-10-28T00:00:00+07:00')
const SUBMISSION_DAY_END = Date.parse('2026-10-29T00:00:00+07:00')

function maintenanceMetadata(row) {
  if (typeof row?.notes !== 'string') return null
  const separator = row.notes.indexOf('\n')
  if (separator < 0) return null
  try {
    return JSON.parse(row.notes.slice(separator + 1))
  } catch {
    return null
  }
}

function isRowMaintenanceEvent(row, event, activityId, previousStatus) {
  return row?.activity_id === activityId
    && typeof row.id === 'string'
    && row.entry_id == null
    && row.event === event
    && row.previous_status === previousStatus
    && row.new_status === 'SUBMITTED'
    && row.submission_number === 1
    && maintenanceMetadata(row)?.maintenance_key === ROW_SUBMISSION_MAINTENANCE_KEY
}

export function selectOvertimeHistoryForDisplay(history, activityId) {
  if (!Array.isArray(history)) return []
  if (!CORRECTED_ROW_ACTIVITIES.has(activityId)) return history

  const submissions = history.filter((row) => isRowMaintenanceEvent(row, 'SUBMITTED', activityId, 'DRAFT'))
  const corrections = history.filter((row) => isRowMaintenanceEvent(row, 'CORRECTED', activityId, 'CLOSED'))
  // Fail open: incomplete/ambiguous audit data must never hide real events.
  if (submissions.length !== 1 || corrections.length !== 1) return history
  const submitted = submissions[0]
  const corrected = corrections[0]
  const metadata = maintenanceMetadata(corrected)
  const submittedAt = Date.parse(submitted.occurred_at)
  const correctedAt = Date.parse(corrected.occurred_at)
  const recordedAt = Date.parse(corrected.created_at)
  if (!Number.isFinite(submittedAt) || !Number.isFinite(correctedAt) || !Number.isFinite(recordedAt)
    || submittedAt < SUBMISSION_DAY_START || submittedAt >= SUBMISSION_DAY_END
    || correctedAt < submittedAt || recordedAt < submittedAt
    || metadata?.before?.activity?.id !== activityId || metadata?.after?.activity?.id !== activityId
    || Date.parse(metadata?.after?.activity?.submitted_at) !== submittedAt
    || Date.parse(maintenanceMetadata(submitted)?.effective_submitted_at) !== submittedAt) return history

  return history.filter((row) => {
    if (row.id === corrected.id) return false
    if (row.activity_id !== activityId || row.entry_id != null) return true
    const occurredAt = Date.parse(row.occurred_at)
    const createdAt = Date.parse(row.created_at)
    // Future decisions/corrections stay visible, even if effective dates are
    // backdated. Only the original pre-maintenance draft/expiry logs are hidden.
    if (!Number.isFinite(occurredAt) || !Number.isFinite(createdAt)
      || createdAt >= recordedAt || occurredAt > correctedAt) return true
    if (['CREATED', 'UPDATED'].includes(row.event)
      && row.new_status === 'DRAFT' && occurredAt <= submittedAt) return false
    return !(row.event === 'CLOSED' && row.previous_status === 'DRAFT' && row.new_status === 'CLOSED'
      && row.reason === 'Batas pengajuan awal H+7 telah lewat')
  }).map((row) => row.id === submitted.id ? { ...row, reason: null, notes: null } : row)
}
