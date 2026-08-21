export const DEFAULT_RETIREMENT_AGE = 56
export const PENSION_CONTRACT_ID = 'pelayanan-teknik'

export const initialPensionPolicies = [
  {
    id: 'pensiun-policy-1',
    contractId: 'pelayanan-teknik',
    up3Id: 'up3',
    retirementAge: 56,
    periodStart: '2026-01-01',
    periodEnd: null,
    status: 'Aktif',
    keterangan: '',
  },
]

const parseDate = (value) => {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

const toKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const shiftDateKey = (key, days) => {
  const date = parseDate(key)
  if (!date) return key
  date.setDate(date.getDate() + days)
  return toKey(date)
}

export function ageAt(birthDate, date) {
  const birth = parseDate(birthDate)
  const ref = parseDate(date)
  if (!birth || !ref) return null
  let age = ref.getFullYear() - birth.getFullYear()
  const beforeBirthday =
    ref.getMonth() < birth.getMonth() ||
    (ref.getMonth() === birth.getMonth() && ref.getDate() < birth.getDate())
  if (beforeBirthday) age--
  return age
}

export function retirementAgeDateFor(birthDate, retirementAge) {
  const birth = parseDate(birthDate)
  if (!birth || !Number.isFinite(Number(retirementAge))) return null
  birth.setFullYear(birth.getFullYear() + Number(retirementAge))
  return toKey(birth)
}

export function lastWorkingDateFor(birthDate, retirementAge) {
  const ageDate = retirementAgeDateFor(birthDate, retirementAge)
  if (!ageDate) return null
  const date = parseDate(ageDate)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

export function retirementEffectiveDateFor(birthDate, retirementAge) {
  const ageDate = retirementAgeDateFor(birthDate, retirementAge)
  if (!ageDate) return null
  const date = parseDate(ageDate)
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 1)
  return toKey(next)
}

export function monthsBetween(fromDate, toDate) {
  const from = parseDate(fromDate)
  const to = parseDate(toDate)
  if (!from || !to) return null
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  if (to.getDate() < from.getDate()) months--
  return months
}

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}$/

export function activePensionPolicy(policies, contractId, up3IdOrDate, date) {
  const isLegacyDate = DATE_LIKE.test(String(up3IdOrDate ?? ''))
  const up3Id = isLegacyDate ? null : up3IdOrDate
  const key = String(date ?? (isLegacyDate ? up3IdOrDate : ''))
  const scoped = (policies ?? []).filter(
    (policy) =>
      policy.contractId === contractId &&
      (up3Id == null || policy.up3Id == null || policy.up3Id === up3Id) &&
      policy.status === 'Aktif',
  )
  return (
    scoped.find(
      (policy) =>
        (policy.periodStart == null || key >= policy.periodStart) &&
        (policy.periodEnd == null || key < policy.periodEnd),
    ) ??
    scoped[0] ??
    null
  )
}

export function changePensionPolicy(
  policies,
  contractId,
  up3IdOrOpts,
  optsOrCurrent,
  currentPolicy,
) {
  const isNewSignature =
    typeof up3IdOrOpts === 'string' && !DATE_LIKE.test(up3IdOrOpts)
  const up3Id = isNewSignature ? up3IdOrOpts : null
  const opts = isNewSignature ? optsOrCurrent : up3IdOrOpts
  const current = isNewSignature ? currentPolicy : optsOrCurrent
  const { retirementAge, periodStart, keterangan } = opts ?? {}
  const next = (policies ?? []).map((policy) =>
    policy.id === current?.id &&
    policy.periodEnd == null &&
    (current?.up3Id == null || policy.up3Id == null || policy.up3Id === current.up3Id)
      ? { ...policy, periodEnd: periodStart || null }
      : policy,
  )
  return [
    ...next,
    {
      id: `pensiun-policy-${Date.now().toString(36)}`,
      contractId,
      up3Id: up3Id ?? null,
      retirementAge: Number(retirementAge),
      periodStart: periodStart || null,
      periodEnd: null,
      status: 'Aktif',
      keterangan: keterangan ?? '',
    },
  ]
}

export function initialPensionPoliciesForUp3(contractId, up3Id) {
  return initialPensionPolicies.map((policy) => ({ ...policy, contractId, up3Id }))
}

export function effectiveRetirementDateOf(employee, policy) {
  if (employee?.retirementDateOverride) return employee.retirementDateOverride
  if (!employee?.birthDate) return null
  return retirementEffectiveDateFor(employee.birthDate, policy?.retirementAge ?? DEFAULT_RETIREMENT_AGE)
}

export function pensionStateOf(employee, date, policy) {
  const retirementDate = effectiveRetirementDateOf(employee, policy)
  if (!retirementDate) return { state: null, retirementDate: null }
  if (String(date ?? '') >= retirementDate) return { state: 'Pensiun', retirementDate }
  const months = monthsBetween(date, retirementDate)
  if (months != null && months <= 3) return { state: 'Segera Pensiun', retirementDate }
  if (months != null && months <= 6) return { state: 'Peringatan', retirementDate }
  if (months != null && months <= 12) return { state: 'Mendekati Pensiun', retirementDate }
  return { state: 'Normal', retirementDate }
}

export function effectiveEmploymentStatusOf(employee, date, policy) {
  if (employee?.employmentStatus === 'Nonaktif') {
    return {
      status: 'Nonaktif',
      reason: employee.statusReason,
      effectiveDate: employee.statusEffectiveDate,
    }
  }
  const retirementDate = effectiveRetirementDateOf(employee, policy)
  if (retirementDate && String(date ?? '') >= retirementDate) {
    return { status: 'Nonaktif', reason: 'Pensiun', effectiveDate: retirementDate }
  }
  return { status: 'Aktif', reason: null, effectiveDate: null }
}

export function isEmployeeActiveOn(employee, date, policy) {
  return effectiveEmploymentStatusOf(employee, date, policy).status === 'Aktif'
}

export function effectiveStatusHistoryOf(employee, policy) {
  const base = [...(employee?.statusHistory ?? [])]
  const retirementDate = effectiveRetirementDateOf(employee, policy)
  if (!retirementDate || employee?.employmentStatus === 'Nonaktif') return base
  const openIndex = base.findIndex((entry) => entry.validTo == null)
  if (openIndex < 0) return base
  const open = base[openIndex]
  if (open.validFrom != null && retirementDate <= open.validFrom) return base
  const closed = base.map((entry, index) =>
    index === openIndex ? { ...entry, validTo: shiftDateKey(retirementDate, -1) } : entry,
  )
  return [
    ...closed,
    {
      id: `derived-pensiun-${employee?.id ?? 'x'}`,
      status: 'Nonaktif',
      reason: 'Pensiun',
      note: 'Otomatis sesuai kebijakan pensiun',
      effectiveDate: retirementDate,
      validFrom: retirementDate,
      validTo: null,
      derived: true,
    },
  ]
}