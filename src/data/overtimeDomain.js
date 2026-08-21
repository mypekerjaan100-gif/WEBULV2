import { hourlyRateFor } from './pegawaiPelayananTeknik.js'
import {
  activePensionPolicy,
  isEmployeeActiveOn,
} from './pensiunPelayananTeknik.js'

// =============================================================================
// TIME MODEL
// =============================================================================

export function hoursBetween(startedAt, endedAt) {
  if (!startedAt || !endedAt) return 0
  const start = new Date(startedAt)
  const end = new Date(endedAt)
  const ms = end.getTime() - start.getTime()
  return ms > 0 ? ms / (1000 * 60 * 60) : 0
}

// =============================================================================
// CALCULATION — LOCKED FORMULA
// =============================================================================

export function calculateMultiplierHours(durationHours) {
  if (durationHours <= 0) return 0
  if (durationHours <= 1) return durationHours * 1.5
  return 1.5 + ((durationHours - 1) * 2)
}

export function calculateAmount(multiplierHours, hourlyRate) {
  return multiplierHours * hourlyRate
}

// =============================================================================
// PARTICIPANT SNAPSHOT
// =============================================================================

export function computeParticipantSnapshot(employee, participantStartedAt, participantEndedAt) {
  const durationHours = hoursBetween(participantStartedAt, participantEndedAt)
  const multiplierHours = calculateMultiplierHours(durationHours)
  const hourlyRate = hourlyRateFor(employee, participantStartedAt)
  const calculatedAmount = calculateAmount(multiplierHours, hourlyRate)
  return {
    duration_hours_snapshot: durationHours,
    multiplier_hours_snapshot: multiplierHours,
    hourly_rate_snapshot: hourlyRate,
    calculated_amount_snapshot: calculatedAmount,
  }
}

// =============================================================================
// EFFECTIVE EMPLOYEE VALIDATION
// =============================================================================

function historyActiveOn(history, date) {
  if (!history?.length) return null
  const dateKey = typeof date === 'string' ? date : new Date(date).toISOString().slice(0, 10)
  const sorted = [...history].sort((a, b) =>
    (a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1,
  )
  let matched = null
  for (const entry of sorted) {
    const from = entry.validFrom ?? ''
    const to = entry.validTo ?? ''
    if (from && dateKey < from) continue
    if (to && dateKey >= to) continue
    matched = entry
  }
  return matched
}

export function employeeEffectiveUnitOn(employee, date) {
  const entry = historyActiveOn(employee?.unitHistory, date)
  return entry?.unitId ?? null
}

export function employeeEffectiveStatusOn(employee, date) {
  const entry = historyActiveOn(employee?.statusHistory, date)
  return entry?.status ?? null
}

export function employeeEffectiveHourlyRate(employee, date) {
  return hourlyRateFor(employee, date)
}

// =============================================================================
// SCOPE VALIDATION
// =============================================================================

export function isEmployeeInExactScope(employee, contractId, up3Id, unitId) {
  if (!employee) return false
  if (employee.contractId !== contractId) return false
  if (employee.up3Id !== up3Id) return false
  if (employee.unitId !== unitId) return false
  return true
}

export function isEmployeeActiveWithHistory(employee, date, pensionPolicies) {
  if (!employee) return false
  const policy = activePensionPolicy(
    pensionPolicies,
    employee.contractId,
    employee.up3Id,
    date,
  )
  if (!isEmployeeActiveOn(employee, date, policy)) return false
  const effectiveStatus = employeeEffectiveStatusOn(employee, date)
  return effectiveStatus === 'Aktif'
}

// =============================================================================
// ACTIVITY TYPE / CATEGORY RULES
// =============================================================================

export function validateActivityTypeRules(type, workCategory, replacedEmployeeId) {
  const errors = []
  if (type === 'WORK') {
    if (!workCategory) errors.push('WORK wajib memiliki work_category.')
    if (replacedEmployeeId) errors.push('WORK tidak boleh memiliki replaced_employee_id.')
  } else {
    if (!replacedEmployeeId) errors.push('Replacement wajib memiliki replaced_employee_id.')
  }
  return errors
}

// =============================================================================
// PARTICIPANT VALIDATION
// =============================================================================

export function validateParticipantTimes(participantStartedAt, participantEndedAt, activityStartedAt, activityEndedAt) {
  const errors = []
  if (!participantStartedAt || !participantEndedAt) {
    errors.push('Participant timestamps wajib diisi.')
    return errors
  }
  if (new Date(participantEndedAt) <= new Date(participantStartedAt)) {
    errors.push('participant_ended_at wajib lebih besar dari participant_started_at.')
    return errors
  }
  if (new Date(participantStartedAt) < new Date(activityStartedAt)) {
    errors.push('participant_started_at tidak boleh sebelum activity_started_at.')
  }
  if (new Date(participantEndedAt) > new Date(activityEndedAt)) {
    errors.push('participant_ended_at tidak boleh setelah activity_ended_at.')
  }
  return errors
}

export function validateNoDuplicateEmployees(participants) {
  const seen = new Set()
  const errors = []
  for (const p of participants) {
    if (seen.has(p.employeeId)) {
      errors.push(`Employee ${p.employeeId} muncul lebih dari sekali dalam activity.`)
    }
    seen.add(p.employeeId)
  }
  return errors
}

// =============================================================================
// FULL ACTIVITY + PARTICIPANT VALIDATION
// =============================================================================

export function validateOvertimeActivity(activity, participants, employees, pensionPolicies) {
  const errors = []
  const {
    contractId,
    up3Id,
    unitId,
    type,
    workCategory,
    replacedEmployeeId,
    startedAt,
    endedAt,
  } = activity

  // Activity timestamps
  if (!startedAt || !endedAt) {
    errors.push('started_at dan ended_at wajib diisi.')
    return { ok: false, errors }
  }
  if (new Date(endedAt) <= new Date(startedAt)) {
    errors.push('ended_at wajib lebih besar dari started_at.')
    return { ok: false, errors }
  }

  // Activity type rules
  errors.push(...validateActivityTypeRules(type, workCategory, replacedEmployeeId))
  if (errors.length) return { ok: false, errors }

  // Replaced employee existence
  if (replacedEmployeeId) {
    const replacedEmployee = employees.find((e) => e.id === replacedEmployeeId)
    if (!replacedEmployee) {
      errors.push('Replaced employee tidak ditemukan.')
      return { ok: false, errors }
    }
    if (!isEmployeeInExactScope(replacedEmployee, contractId, up3Id, unitId)) {
      errors.push('Replaced employee di luar scope activity (contract/UP3/ULP).')
    }
    if (!isEmployeeActiveWithHistory(replacedEmployee, startedAt, pensionPolicies)) {
      errors.push('Replaced employee tidak aktif pada waktu activity.')
    }
  }

  // Duplicate employees across participants
  errors.push(...validateNoDuplicateEmployees(participants))
  if (errors.length) return { ok: false, errors }

  // Validate each participant
  for (const participant of participants) {
    const employee = employees.find((e) => e.id === participant.employeeId)
    if (!employee) {
      errors.push(`Participant employee ${participant.employeeId} tidak ditemukan.`)
      continue
    }

    // Timestamps
    errors.push(...validateParticipantTimes(
      participant.startedAt, participant.endedAt, startedAt, endedAt,
    ))

    // Scope
    if (!isEmployeeInExactScope(employee, contractId, up3Id, unitId)) {
      errors.push(`Employee ${employee.name} di luar scope activity (contract/UP3/ULP).`)
    }

    // Active status
    if (!isEmployeeActiveWithHistory(employee, participant.startedAt ?? startedAt, pensionPolicies)) {
      errors.push(`Employee ${employee.name} tidak aktif pada waktu tersebut.`)
    }
  }

  return { ok: errors.length === 0, errors }
}

// =============================================================================
// BULK SNAPSHOT GENERATION
// =============================================================================

export function computeActivitySnapshots(activity, participants, employees) {
  return participants.map((participant) => {
    const employee = employees.find((e) => e.id === participant.employeeId)
    if (!employee) return null
    const snapshot = computeParticipantSnapshot(
      employee,
      participant.startedAt || activity.startedAt,
      participant.endedAt || activity.endedAt,
    )
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      ...snapshot,
    }
  }).filter(Boolean)
}
