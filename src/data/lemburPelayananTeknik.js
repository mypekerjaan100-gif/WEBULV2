import { hourlyRateFor } from './pegawaiPelayananTeknik.js'
import {
  activePensionPolicy,
  isEmployeeActiveOn,
} from './pensiunPelayananTeknik.js'

export const initialLemburRecords = [
  {
    id: 'lembur-seed-1',
    employeeId: '8219006SKW',
    employeeName: 'Wahab',
    unitId: 'ulp-3',
    date: '2026-06-10',
    period: '2026-06',
    hours: 2,
    rate: 21305,
    total: 42610,
    keterangan: 'Penyelesaian laporan gangguan',
  },
  {
    id: 'lembur-seed-2',
    employeeId: '9419002SKW',
    employeeName: 'Maulidi',
    unitId: 'ulp-3',
    date: '2026-06-11',
    period: '2026-06',
    hours: 3,
    rate: 21305,
    total: 63915,
    keterangan: 'Pengawasan pekerjaan jaringan',
  },
  {
    id: 'lembur-seed-3',
    employeeId: '96241214PTK',
    employeeName: 'Inas Hazimah',
    unitId: 'ulp-3',
    date: '2026-06-12',
    period: '2026-06',
    hours: 2,
    rate: 20930,
    total: 41860,
    keterangan: 'Verifikasi laporan bulanan',
  },
].map((record) => ({
  ...record,
  contractId: 'pelayanan-teknik',
  up3Id: 'up3',
}))

export function periodKeyOf(date) {
  return String(date ?? '').slice(0, 7)
}

export function lemburRecordInScope(record, contractId, up3Id, unitId = null) {
  return (
    !!record &&
    record.contractId === contractId &&
    record.up3Id === up3Id &&
    (unitId == null || record.unitId === unitId)
  )
}

export function scopedLemburRecords(records, contractId, up3Id, unitId = null) {
  return (records ?? []).filter((record) =>
    lemburRecordInScope(record, contractId, up3Id, unitId),
  )
}

export function employeeInLemburScope(
  employee,
  contractId,
  up3Id,
  unitId = null,
  validUnitIds = null,
) {
  if (!employee || employee.contractId !== contractId || employee.up3Id !== up3Id) {
    return false
  }
  if (validUnitIds && !validUnitIds.includes(employee.unitId)) return false
  if (unitId != null && employee.unitId !== unitId) return false
  return true
}

export function availableEmployeesForLembur(
  employees,
  { contractId, up3Id, unitId = null, validUnitIds = null, date, pensionPolicies },
) {
  const policy = activePensionPolicy(pensionPolicies, contractId, up3Id, date)
  return (employees ?? []).filter(
    (employee) =>
      employeeInLemburScope(employee, contractId, up3Id, unitId, validUnitIds) &&
      isEmployeeActiveOn(employee, date, policy),
  )
}

export function lemburTarifFor(employee, date) {
  return hourlyRateFor(employee, date)
}

export function createLemburRecord(
  records,
  draft,
  { employees, contractId, up3Id, unitId = null, validUnitIds = null, date, pensionPolicies },
) {
  const employee = (employees ?? []).find((entry) => entry.id === draft.employeeId)
  if (!employeeInLemburScope(employee, contractId, up3Id, unitId, validUnitIds)) {
    return { records, ok: false, message: 'Pegawai di luar scope kontrak/UP3/unit.' }
  }
  const policy = activePensionPolicy(pensionPolicies, contractId, up3Id, date)
  if (!isEmployeeActiveOn(employee, date, policy)) {
    return {
      records,
      ok: false,
      message: `Pegawai efektif Nonaktif/Pensiun pada tanggal ${date}; lembur tidak dapat dibuat.`,
    }
  }
  const hours = Number(draft.hours) || 0
  const rate = hourlyRateFor(employee, date)
  const record = {
    id: `lembur-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    contractId,
    up3Id,
    unitId: employee.unitId,
    employeeId: employee.id,
    employeeName: employee.name,
    date,
    period: periodKeyOf(date),
    hours,
    rate,
    total: Math.round(hours * rate),
    keterangan: draft.keterangan ?? '',
  }
  return { records: [...(records ?? []), record], ok: true, record }
}

export function updateLemburRecord(
  records,
  id,
  patch,
  { employees, contractId, up3Id, unitId = null, validUnitIds = null, date, pensionPolicies },
) {
  const record = (records ?? []).find((entry) => entry.id === id)
  if (!lemburRecordInScope(record, contractId, up3Id, unitId)) {
    return { records, ok: false, message: 'Record lembur di luar scope.' }
  }
  const next = { ...record }
  const employee = (employees ?? []).find((entry) => entry.id === record.employeeId)
  if (patch.employeeId !== undefined && patch.employeeId !== record.employeeId) {
    const candidate = (employees ?? []).find((entry) => entry.id === patch.employeeId)
    if (!employeeInLemburScope(candidate, contractId, up3Id, unitId, validUnitIds)) {
      return { records, ok: false, message: 'Pegawai di luar scope kontrak/UP3/unit.' }
    }
    const policy = activePensionPolicy(pensionPolicies, contractId, up3Id, next.date ?? date)
    if (!isEmployeeActiveOn(candidate, next.date ?? date, policy)) {
      return { records, ok: false, message: 'Pegawai efektif Nonaktif/Pensiun pada tanggal lembur.' }
    }
    next.employeeId = candidate.id
    next.employeeName = candidate.name
    next.unitId = candidate.unitId
    next.rate = hourlyRateFor(candidate, next.date ?? date)
  }
  if (patch.date !== undefined && patch.date !== record.date) {
    if (!isEmployeeActiveOn(employee, patch.date, activePensionPolicy(pensionPolicies, contractId, up3Id, patch.date))) {
      return { records, ok: false, message: 'Pegawai efektif Nonaktif/Pensiun pada tanggal lembur.' }
    }
    next.date = patch.date
    next.period = periodKeyOf(patch.date)
    next.rate = hourlyRateFor(employee, patch.date)
  }
  if (patch.hours !== undefined) next.hours = Number(patch.hours) || 0
  if (patch.keterangan !== undefined) next.keterangan = patch.keterangan ?? ''
  next.total = Math.round((next.hours ?? 0) * (next.rate ?? 0))
  return {
    records: (records ?? []).map((entry) => (entry.id === id ? next : entry)),
    ok: true,
    record: next,
  }
}

export function deleteLemburRecord(records, id, { contractId, up3Id, unitId = null }) {
  const record = (records ?? []).find((entry) => entry.id === id)
  if (!lemburRecordInScope(record, contractId, up3Id, unitId)) {
    return { records, ok: false, message: 'Record lembur di luar scope.' }
  }
  return { records: (records ?? []).filter((entry) => entry.id !== id), ok: true }
}