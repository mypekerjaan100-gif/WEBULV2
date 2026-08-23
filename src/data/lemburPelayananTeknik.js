import { hourlyRateFor } from './pegawaiPelayananTeknik.js'
import {
  activePensionPolicy,
  isEmployeeActiveOn,
} from './pensiunPelayananTeknik.js'

export function periodKeyOf(date) {
  return String(date ?? '').slice(0, 7)
}

export function employeeAssignmentForLembur(employee, date) {
  return (employee?.unitHistory ?? []).find((entry) => {
    const from = entry.validFrom ?? ''
    const to = entry.validTo ?? ''
    return (from === '' || date >= from) && (to === '' || date < to)
  }) ?? null
}

export function employeeInLemburScope(
  employee,
  contractId,
  up3Id,
  unitId,
  date,
) {
  const assignment = employeeAssignmentForLembur(employee, date)
  return !!assignment &&
    assignment.contractId === contractId &&
    assignment.up3Id === up3Id &&
    (unitId == null || assignment.unitId === unitId)
}

export function availableEmployeesForLembur(
  employees,
  { contractId, up3Id, unitId, date, pensionPolicies },
) {
  const policy = activePensionPolicy(pensionPolicies, contractId, up3Id, date)
  return (employees ?? []).filter(
    (employee) =>
      employeeInLemburScope(employee, contractId, up3Id, unitId, date) &&
      isEmployeeActiveOn(employee, date, policy),
  )
}

export function lemburTarifFor(employee, date) {
  return hourlyRateFor(employee, date)
}
