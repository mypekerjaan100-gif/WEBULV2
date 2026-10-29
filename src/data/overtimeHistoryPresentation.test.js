import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { selectOvertimeHistoryForDisplay } from './overtimeHistoryPresentation.js'

const maintenanceKey = 'correct_row_oct21_submission_oct28_2026'
const correctedAt = '2026-10-29T07:50:57.500000+00:00'
const recordedAt = '2026-10-29T07:50:57.326650+00:00'
const targets = [
  ['70ec2e23-b57f-4432-8aaa-3384d02f55b2', '2026-10-28T02:54:17.843285+00:00', 2],
  ['2eb84c1e-508e-42a3-bc4c-d5430269e1b9', '2026-10-28T03:17:29.056268+00:00', 1],
  ['e29d0c27-3cc2-46a3-818d-de70e512f6b2', '2026-10-28T03:28:53.589259+00:00', 0],
]
const notes = (metadata) => `Pemeliharaan database; bukan aksi pengguna.\n${JSON.stringify({ maintenance_key: maintenanceKey, ...metadata })}`

function fixture(activityId, submittedAt, updates = 0) {
  const event = (id, type, occurredAt, from, to, extra = {}) => ({
    id, activity_id: activityId, entry_id: null, event: type,
    previous_status: from, new_status: to, occurred_at: occurredAt,
    created_at: occurredAt, submission_number: null, actor_user_id: null,
    reason: null, notes: null, ...extra,
  })
  return [
    event('draft', 'CREATED', '2026-10-28T02:50:00+00:00', null, 'DRAFT'),
    ...Array.from({ length: updates }, (_, index) => event(`update-${index}`, 'UPDATED', `2026-10-28T02:5${index + 1}:00+00:00`, 'DRAFT', 'DRAFT')),
    event('submitted', 'SUBMITTED', submittedAt, 'DRAFT', 'SUBMITTED', {
      submission_number: 1, created_at: recordedAt,
      reason: 'Tanggal efektif pengajuan ditetapkan 28 Oktober 2026.',
      notes: notes({ effective_submitted_at: submittedAt, database_role: 'postgres' }),
    }),
    event('expired', 'CLOSED', '2026-10-28T23:32:35.351719+00:00', 'DRAFT', 'CLOSED', {
      reason: 'Batas pengajuan awal H+7 telah lewat',
    }),
    event('corrected', 'CORRECTED', correctedAt, 'CLOSED', 'SUBMITTED', {
      submission_number: 1, created_at: recordedAt,
      notes: notes({
        before: { activity: { id: activityId, status: 'CLOSED' } },
        after: { activity: { id: activityId, status: 'SUBMITTED', submitted_at: submittedAt } },
      }),
    }),
  ]
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

let hiddenCount = 0
for (const [activityId, submittedAt, updates] of targets) {
  const raw = fixture(activityId, submittedAt, updates)
  const original = JSON.stringify(raw)
  deepFreeze(raw)
  const visible = selectOvertimeHistoryForDisplay(raw, activityId)
  assert.equal(visible.length, 1, 'Each corrected activity has one Submitted card')
  assert.equal(visible[0].event, 'SUBMITTED')
  assert.equal(visible[0].occurred_at, submittedAt, 'Keep the effective date, not recording time')
  assert.match(new Date(visible[0].occurred_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Pontianak', dateStyle: 'long' }), /28 Oktober 2026/)
  assert.equal(visible[0].created_at, recordedAt)
  assert.equal(visible[0].notes, null, 'Hide technical JSON only in the presentation copy')
  assert.equal(visible[0].reason, null)
  assert.equal(JSON.stringify(raw), original, 'Do not mutate raw repository audit data')
  assert.notEqual(visible[0], raw.find((row) => row.event === 'SUBMITTED'))
  hiddenCount += raw.length - visible.length

  const futureEvents = ['APPROVED', 'REJECTED', 'RESUBMITTED', 'CLOSED', 'CORRECTED', 'UPDATED', 'CREATED', 'DATE_CORRECTED', 'DELETED']
    .map((event, index) => ({
      id: `future-${event}`, activity_id: activityId, entry_id: null, event,
      previous_status: 'SUBMITTED', new_status: 'DRAFT',
      // Even a backdated future event must not disappear.
      occurred_at: '2026-10-28T01:00:00+00:00', created_at: '2026-10-30T00:00:00+00:00',
      notes: `Catatan baru ${index}`, reason: 'Alasan baru',
    }))
  const futureExpiry = {
    ...raw.find((row) => row.event === 'CLOSED'),
    id: 'future-expiry', created_at: '2026-10-30T00:00:00+00:00',
  }
  const futureDisplay = selectOvertimeHistoryForDisplay([...raw, ...futureEvents, futureExpiry], activityId)
  assert.deepEqual(futureDisplay.slice(1), [...futureEvents, futureExpiry], 'All future events, notes and reasons remain visible')

  const participantDecision = { ...raw.find((row) => row.event === 'CLOSED'), id: 'participant-closed', entry_id: 'participant-1' }
  const nonExpiryClosure = { ...participantDecision, id: 'final-rejected', entry_id: null, reason: 'Penolakan final' }
  const otherActivityRow = { ...raw[0], id: 'other-draft', activity_id: 'another-activity' }
  const preserved = [participantDecision, nonExpiryClosure, otherActivityRow]
  assert.deepEqual(selectOvertimeHistoryForDisplay([...raw, ...preserved], activityId).slice(1), preserved)
  assert.deepEqual(selectOvertimeHistoryForDisplay([...raw].reverse(), activityId).map((row) => row.event), ['SUBMITTED'], 'No dependency on RPC row ordering')
}
assert.equal(hiddenCount, 12, 'Only the twelve old draft/expiry/maintenance cards are summarized')

const [activityId, submittedAt] = targets[0]
const raw = fixture(activityId, submittedAt, 2)
const submittedIndex = raw.findIndex((row) => row.event === 'SUBMITTED')
const correctedIndex = raw.findIndex((row) => row.event === 'CORRECTED')
const changeRow = (index, changes) => raw.map((row, i) => i === index ? { ...row, ...changes } : row)
const unchangedCases = [
  raw.filter((row) => row.event !== 'CORRECTED'),
  raw.filter((row) => row.event !== 'SUBMITTED'),
  [...raw, { ...raw[submittedIndex], id: 'duplicate-submitted' }],
  [...raw, { ...raw[correctedIndex], id: 'duplicate-corrected' }],
  changeRow(correctedIndex, { notes: maintenanceKey }),
  changeRow(correctedIndex, { notes: `Invalid\n${maintenanceKey}` }),
  changeRow(correctedIndex, { notes: null }),
  changeRow(correctedIndex, { notes: 123 }),
  changeRow(correctedIndex, { notes: notes({ maintenance_key: 'another_correction' }) }),
  changeRow(correctedIndex, { notes: notes({ before: { activity: { id: 'wrong-id' } } }) }),
  changeRow(correctedIndex, { created_at: 'invalid' }),
  changeRow(correctedIndex, { occurred_at: '2026-10-27T00:00:00+00:00' }),
  changeRow(submittedIndex, { occurred_at: '2026-10-29T00:00:00+00:00' }),
  changeRow(submittedIndex, { notes: notes({ effective_submitted_at: '2026-10-28T12:00:00+07:00' }) }),
  changeRow(submittedIndex, { submission_number: 2 }),
]
for (const rows of unchangedCases) {
  assert.equal(selectOvertimeHistoryForDisplay(rows, activityId), rows, 'Incomplete or ambiguous metadata must show the full audit')
}
assert.equal(selectOvertimeHistoryForDisplay(raw, 'another-activity'), raw)
assert.equal(selectOvertimeHistoryForDisplay(raw, null), raw)
assert.deepEqual(selectOvertimeHistoryForDisplay(null, activityId), [])

// Unknown activities stay unchanged even if a note copies the maintenance key.
const unrelated = fixture('another-activity', submittedAt, 2)
assert.equal(selectOvertimeHistoryForDisplay(unrelated, 'another-activity'), unrelated)

// Integration: only the detail presentation is filtered, before existing
// per-participant scoping/deduplication. Repository still returns complete audit.
const component = readFileSync(new URL('../components/sla/SLALembur.jsx', import.meta.url), 'utf8')
assert.match(component, /selectOvertimeHistoryForDisplay\(detailHistory, detailActivityId\)/)
assert.match(component, /displayDetailHistory\s*\.filter/)
assert.match(component, /return displayDetailHistory\.filter/)
assert.match(component, /setDetailHistory\(history\)/)
assert.match(component, /visibleDetailHistory\.map/)
assert.match(component, /isLegacyRevisionMarker\(h\)/)
const repository = readFileSync(new URL('./overtimeReplacementRepository.js', import.meta.url), 'utf8')
assert.match(repository, /listOvertimeHistory\(activityId\) \{\s*return rpc\('list_overtime_history_l5', \{ p_activity_id: activityId \}\)/)
assert.ok(!repository.includes('selectOvertimeHistoryForDisplay'))

console.log('Overtime history presentation tests passed: three targeted summaries, future events and raw audit preserved')
