import {
  hoursBetween,
  calculateMultiplierHours,
  calculateAmount,
  computeParticipantSnapshot,
  validateActivityTypeRules,
  validateParticipantTimes,
  validateNoDuplicateEmployees,
  validateOvertimeActivity,
} from './overtimeDomain.js'
import { buildNewEmployee } from './pegawaiPelayananTeknik.js'

let passed = 0
let failed = 0

function assert(condition, label, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

function approx(actual, expected, tolerance = 0.001) {
  return Math.abs(actual - expected) <= tolerance
}

// =============================================================================
// TEST A: 10:00-14:00 = 4h = 7.5
// =============================================================================
console.log('\nTest A: 10:00-14:00 = 4h = 7.5')
{
  const d = hoursBetween('2026-08-11T10:00:00+07:00', '2026-08-11T14:00:00+07:00')
  const m = calculateMultiplierHours(d)
  assert(approx(d, 4), 'duration = 4')
  assert(approx(m, 7.5), 'multiplier = 7.5', `got ${m}`)
}

// =============================================================================
// TEST B: 18:00-20:30 = 2.5h = 4.5
// =============================================================================
console.log('\nTest B: 18:00-20:30 = 2.5h = 4.5')
{
  const d = hoursBetween('2026-08-11T18:00:00+07:00', '2026-08-11T20:30:00+07:00')
  const m = calculateMultiplierHours(d)
  assert(approx(d, 2.5), 'duration = 2.5')
  assert(approx(m, 4.5), 'multiplier = 4.5', `got ${m}`)
}

// =============================================================================
// TEST C: 11 Aug 23:00 -> 12 Aug 03:00 = 4h = 7.5 (cross-midnight)
// =============================================================================
console.log('\nTest C: cross-midnight 23:00-03:00 = 4h = 7.5')
{
  const d = hoursBetween('2026-08-11T23:00:00+07:00', '2026-08-12T03:00:00+07:00')
  const m = calculateMultiplierHours(d)
  assert(approx(d, 4), 'duration = 4')
  assert(approx(m, 7.5), 'multiplier = 7.5', `got ${m}`)
}

// =============================================================================
// TEST D: participant shorter than activity — calculated from actual participant time
// =============================================================================
console.log('\nTest D: participant shorter than activity')
{
  const emp = buildNewEmployee({
    nip: 'TEST001',
    name: 'Test Employee',
    unitId: 'ulp-3',
    hourlyRate: 21305,
    contractId: 'pelayanan-teknik',
    up3Id: 'up3',
    effectiveDate: '2026-01-01',
  })
  const snap = computeParticipantSnapshot(emp, '2026-08-11T10:00:00+07:00', '2026-08-11T13:00:00+07:00')
  assert(approx(snap.duration_hours_snapshot, 3), 'participant duration = 3 (not activity 4)')
  assert(approx(snap.multiplier_hours_snapshot, 5.5), 'multiplier = 5.5', `got ${snap.multiplier_hours_snapshot}`)
}

// =============================================================================
// TEST E: employee A and B same activity, different rates -> different amounts
// =============================================================================
console.log('\nTest E: different rates produce different amounts')
{
  const empA = buildNewEmployee({
    nip: 'TEST-A',
    name: 'Employee A',
    unitId: 'ulp-3',
    hourlyRate: 21305,
    contractId: 'pelayanan-teknik',
    up3Id: 'up3',
    effectiveDate: '2026-01-01',
  })
  const empB = buildNewEmployee({
    nip: 'TEST-B',
    name: 'Employee B',
    unitId: 'ulp-3',
    hourlyRate: 25000,
    contractId: 'pelayanan-teknik',
    up3Id: 'up3',
    effectiveDate: '2026-01-01',
  })
  const snapA = computeParticipantSnapshot(empA, '2026-08-11T10:00:00+07:00', '2026-08-11T14:00:00+07:00')
  const snapB = computeParticipantSnapshot(empB, '2026-08-11T10:00:00+07:00', '2026-08-11T14:00:00+07:00')
  assert(approx(snapA.calculated_amount_snapshot, 7.5 * 21305), 'A amount = 159787.5', `got ${snapA.calculated_amount_snapshot}`)
  assert(approx(snapB.calculated_amount_snapshot, 7.5 * 25000), 'B amount = 187500', `got ${snapB.calculated_amount_snapshot}`)
  assert(snapA.calculated_amount_snapshot !== snapB.calculated_amount_snapshot, 'amounts differ')
}

// =============================================================================
// TEST F: zero/negative duration rejected
// =============================================================================
console.log('\nTest F: zero/negative duration rejected')
{
  const dZero = hoursBetween('2026-08-11T10:00:00+07:00', '2026-08-11T10:00:00+07:00')
  const dNeg = hoursBetween('2026-08-11T14:00:00+07:00', '2026-08-11T10:00:00+07:00')
  assert(dZero === 0, 'zero duration returns 0')
  assert(dNeg === 0, 'negative duration returns 0')
  assert(calculateMultiplierHours(0) === 0, 'multiplier for 0 = 0')
}

// =============================================================================
// TEST G: participant outside activity range rejected
// =============================================================================
console.log('\nTest G: participant outside activity range')
{
  const result = validateParticipantTimes(
    '2026-08-11T08:00:00+07:00', // before activity start
    '2026-08-11T10:00:00+07:00',
    '2026-08-11T10:00:00+07:00',
    '2026-08-11T14:00:00+07:00',
  )
  assert(result.length > 0, 'rejected: starts before activity')
  const result2 = validateParticipantTimes(
    '2026-08-11T13:00:00+07:00',
    '2026-08-11T15:00:00+07:00', // after activity end
    '2026-08-11T10:00:00+07:00',
    '2026-08-11T14:00:00+07:00',
  )
  assert(result2.length > 0, 'rejected: ends after activity')
}

// =============================================================================
// TEST H: wrong ULP / inactive employee rejected
// =============================================================================
console.log('\nTest H: wrong ULP / inactive employee rejected')
{
  const empWrongUlp = buildNewEmployee({
    nip: 'TEST-WRONG',
    name: 'Wrong ULP',
    unitId: 'ulp-1',
    hourlyRate: 21305,
    contractId: 'pelayanan-teknik',
    up3Id: 'up3',
    effectiveDate: '2026-01-01',
  })
  const empInactive = buildNewEmployee({
    nip: 'TEST-INACTIVE',
    name: 'Inactive Emp',
    unitId: 'ulp-3',
    hourlyRate: 21305,
    contractId: 'pelayanan-teknik',
    up3Id: 'up3',
    effectiveDate: '2026-01-01',
  })
  empInactive.employmentStatus = 'Nonaktif'
  empInactive.statusHistory = [
    { id: 'sh1', status: 'Aktif', validFrom: '2026-01-01', validTo: '2026-06-01' },
    { id: 'sh2', status: 'Nonaktif', validFrom: '2026-06-01', validTo: null },
  ]

  const activity = {
    contractId: 'pelayanan-teknik',
    up3Id: 'up3',
    unitId: 'ulp-3',
    type: 'WORK',
    workCategory: 'GARDU',
    replacedEmployeeId: null,
    startedAt: '2026-08-11T10:00:00+07:00',
    endedAt: '2026-08-11T14:00:00+07:00',
  }
  const participants = [
    { employeeId: 'TEST-WRONG', startedAt: '2026-08-11T10:00:00+07:00', endedAt: '2026-08-11T14:00:00+07:00' },
  ]
  const employees = [empWrongUlp, empInactive]
  const policies = []

  const res1 = validateOvertimeActivity(activity, participants, employees, policies)
  assert(!res1.ok, 'wrong ULP rejected', res1.errors.join('; '))

  const participants2 = [
    { employeeId: 'TEST-INACTIVE', startedAt: '2026-08-11T10:00:00+07:00', endedAt: '2026-08-11T14:00:00+07:00' },
  ]
  const res2 = validateOvertimeActivity(activity, participants2, employees, policies)
  assert(!res2.ok, 'inactive employee rejected', res2.errors.join('; '))
}

// =============================================================================
// ADDITIONAL: WORK type rules
// =============================================================================
console.log('\nAdditional: WORK type rules')
{
  const r1 = validateActivityTypeRules('WORK', null, null)
  assert(r1.length > 0, 'WORK without category rejected')
  const r2 = validateActivityTypeRules('WORK', 'GARDU', 'some-emp')
  assert(r2.length > 0, 'WORK with replaced_employee rejected')
  const r3 = validateActivityTypeRules('WORK', 'GARDU', null)
  assert(r3.length === 0, 'WORK with category accepted')
}

console.log('\nAdditional: Replacement type rules')
{
  const r1 = validateActivityTypeRules('REPLACEMENT_LEAVE', null, null)
  assert(r1.length > 0, 'REPLACEMENT without replaced_employee rejected')
  const r2 = validateActivityTypeRules('REPLACEMENT_LEAVE', null, 'some-emp')
  assert(r2.length === 0, 'REPLACEMENT with replaced_employee accepted')
}

// =============================================================================
// ADDITIONAL: duplicate employee
// =============================================================================
console.log('\nAdditional: duplicate employee')
{
  const r = validateNoDuplicateEmployees([
    { employeeId: 'emp-1' },
    { employeeId: 'emp-2' },
    { employeeId: 'emp-1' },
  ])
  assert(r.length > 0, 'duplicate employee rejected')
}

// =============================================================================
// SUMMARY
// =============================================================================
console.log(`\n--- ${passed} passed, ${failed} failed ---`)
process.exit(failed > 0 ? 1 : 0)
