export const SEED_VALID_FROM = '2026-01-01'
export const DEFAULT_POSITION_ID = 'jab-petugas-yantek'

export const UNIT_BY_LABEL = {
  'up3 singkawang': 'up3',
  'singkawang kota': 'ulp-1',
  'sungai duri': 'ulp-2',
  'pemangkat': 'ulp-3',
  'bengkayang': 'ulp-4',
  'sambas': 'ulp-5',
  'sekura': 'ulp-6',
}

const POSITION_BY_NORM = {
  'koordinator up3': 'jab-koord-up3',
  'koordinator': 'jab-koord-ulp',
  'koord yantek ulp': 'jab-koord-ulp',
  'koordinator yantek ulp': 'jab-koord-ulp',
  'k3': 'jab-koord-k3-ulp',
  'k3 ulp': 'jab-koord-k3-ulp',
  'k3 yantek': 'jab-koord-k3-ulp',
  'ulc': 'jab-petugas-ulc',
  'var row': 'jab-petugas-var-row',
  'row': 'jab-petugas-var-row',
  'har row': 'jab-petugas-var-row',
  'harrow': 'jab-petugas-var-row',
  'var gardu': 'jab-petugas-var-hardukon',
  'gardu': 'jab-petugas-var-hardukon',
  'har gardu': 'jab-petugas-var-hardukon',
  'hardu': 'jab-petugas-var-hardukon',
}

const normalize = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

const toRate = (value) => {
  const parsed = Number(String(value ?? '').replace(/\D/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export function parseCsvRows(text) {
  const rows = []
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((line) => {
      if (!line.trim()) return
      rows.push(line.split(',').map((cell) => cell.trim()))
    })
  return rows
}

export function seedPegawaiFromCsv(text, { contractId = 'pelayanan-teknik', up3Id = 'up3' } = {}) {
  const rows = parseCsvRows(text)
  const headerIdx = rows.findIndex((row) => row[2] === 'Nama')
  if (headerIdx < 0) throw new Error('Header pegawai CSV tidak ditemukan')
  const seen = new Set()
  const employees = []
  let skippedUnknownUnit = 0
  let skippedDuplicate = 0
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const nip = String(row[5] ?? '').trim()
    const name = String(row[2] ?? '').trim()
    if (!nip || !name) continue
    const unitId = UNIT_BY_LABEL[normalize(row[4])]
    if (!unitId) {
      skippedUnknownUnit++
      continue
    }
    if (seen.has(nip)) {
      skippedDuplicate++
      continue
    }
    seen.add(nip)
    const sourcePosition = String(row[6] ?? '').trim()
    employees.push(
      buildNewEmployee({
        nip,
        name,
        unitId,
        positionId: POSITION_BY_NORM[normalize(sourcePosition)] ?? DEFAULT_POSITION_ID,
        sourcePosition,
        bank: String(row[7] ?? '').trim(),
        accountNumber: String(row[8] ?? '').trim(),
        hourlyRate: toRate(row[9]),
        effectiveDate: SEED_VALID_FROM,
        contractId,
        up3Id,
      }),
    )
  }
  return { employees, totalRows: rows.length - headerIdx - 1, skippedUnknownUnit, skippedDuplicate }
}

let histSeq = 0
const histId = () => `hist-${Date.now().toString(36)}-${(histSeq++).toString(36)}`

export const today = () => new Date().toISOString().slice(0, 10)

export function closeHistoryEntry(history, validTo) {
  return (history ?? []).map((entry) =>
    entry.validTo == null ? { ...entry, validTo } : entry,
  )
}

export function appendHistoryEntry(history, entry) {
  return [
    ...closeHistoryEntry(history, entry.validFrom ?? null),
    { ...entry, validTo: null },
  ]
}

export function buildNewEmployee({
  nip,
  name,
  unitId,
  positionId,
  sourcePosition,
  bank,
  accountNumber,
  hourlyRate,
  birthDate,
  contractId = 'pelayanan-teknik',
  up3Id,
  workLocationId,
  effectiveDate = SEED_VALID_FROM,
}) {
  const ef = effectiveDate ?? SEED_VALID_FROM
  return {
    id: nip,
    nip,
    name,
    contractId,
    up3Id: up3Id ?? (unitId === 'up3' ? unitId : 'up3'),
    unitId,
    workLocationId: workLocationId ?? null,
    positionId,
    sourcePosition: sourcePosition ?? null,
    bank: bank ?? '',
    accountNumber: accountNumber ?? '',
    birthDate: birthDate ?? '',
    retirementDateOverride: null,
    pensionOverrideReason: null,
    employmentStatus: 'Aktif',
    statusReason: null,
    statusReasonNote: null,
    statusEffectiveDate: null,
    unitHistory: [{ id: histId(), unitId, validFrom: ef, validTo: null }],
    positionHistory: [{ id: histId(), positionId, validFrom: ef, validTo: null }],
    workLocationHistory: workLocationId
      ? [{ id: histId(), workLocationId, validFrom: ef, validTo: null }]
      : [],
    statusHistory: [
      {
        id: histId(),
        status: 'Aktif',
        reason: null,
        note: null,
        effectiveDate: null,
        validFrom: ef,
        validTo: null,
      },
    ],
    hourlyRateHistory: [{ id: histId(), rate: hourlyRate ?? 0, validFrom: ef, validTo: null }],
  }
}

export function hourlyRateFor(employee, dateInput) {
  const date =
    typeof dateInput === 'string' ? dateInput : (dateInput ?? new Date()).toISOString().slice(0, 10)
  const history = [...(employee?.hourlyRateHistory ?? [])].sort((a, b) =>
    (a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1,
  )
  const entry = history.find((item) => {
    const from = item.validFrom ?? ''
    const to = item.validTo ?? ''
    return (from === '' || date >= from) && (to === '' || date < to)
  })
  return entry?.rate ?? 0
}

export function applyProposedChange(employee, proposed, effectiveDate) {
  const next = { ...employee }
  const ef = effectiveDate ?? today()
  if (proposed.nip !== undefined && proposed.nip !== employee.nip) next.nip = proposed.nip
  if (proposed.name !== undefined && proposed.name !== employee.name) next.name = proposed.name
  if (proposed.sourcePosition !== undefined) next.sourcePosition = proposed.sourcePosition
  if (proposed.birthDate !== undefined) next.birthDate = proposed.birthDate ?? ''
  if (proposed.retirementDateOverride !== undefined) {
    next.retirementDateOverride = proposed.retirementDateOverride ?? null
  }
  if (proposed.pensionOverrideReason !== undefined) {
    next.pensionOverrideReason = proposed.pensionOverrideReason ?? null
  }
  if (proposed.bank !== undefined && proposed.bank !== employee.bank) next.bank = proposed.bank
  if (proposed.accountNumber !== undefined && proposed.accountNumber !== employee.accountNumber) {
    next.accountNumber = proposed.accountNumber
  }
  if (proposed.up3Id !== undefined) next.up3Id = proposed.up3Id
  const unitChanged = proposed.unitId !== undefined && proposed.unitId !== employee.unitId
  const locationChanged =
    proposed.workLocationId !== undefined &&
    proposed.workLocationId !== employee.workLocationId
  if (unitChanged) {
    next.unitId = proposed.unitId
    next.unitHistory = appendHistoryEntry(employee.unitHistory, {
      id: histId(),
      unitId: proposed.unitId,
      validFrom: ef,
    })
    if (locationChanged) {
      next.workLocationId = proposed.workLocationId ?? null
      if (next.workLocationId) {
        next.workLocationHistory = appendHistoryEntry(employee.workLocationHistory, {
          id: histId(),
          workLocationId: next.workLocationId,
          validFrom: ef,
        })
      }
    } else {
      next.workLocationId = null
    }
  } else if (locationChanged) {
    next.workLocationId = proposed.workLocationId ?? null
    if (next.workLocationId) {
      next.workLocationHistory = appendHistoryEntry(employee.workLocationHistory, {
        id: histId(),
        workLocationId: next.workLocationId,
        validFrom: ef,
      })
    }
  }
  if (proposed.positionId !== undefined && proposed.positionId !== employee.positionId) {
    next.positionId = proposed.positionId
    next.positionHistory = appendHistoryEntry(employee.positionHistory, {
      id: histId(),
      positionId: proposed.positionId,
      validFrom: ef,
    })
  }
  if (
    proposed.hourlyRate !== undefined &&
    Number(proposed.hourlyRate) !== hourlyRateFor(employee, ef)
  ) {
    next.hourlyRateHistory = appendHistoryEntry(employee.hourlyRateHistory, {
      id: histId(),
      rate: Number(proposed.hourlyRate) || 0,
      validFrom: ef,
    })
  }
  if (proposed.employmentStatus !== undefined && proposed.employmentStatus !== employee.employmentStatus) {
    next.employmentStatus = proposed.employmentStatus
    next.statusReason = proposed.statusReason ?? null
    next.statusReasonNote = proposed.statusReasonNote ?? null
    next.statusEffectiveDate = proposed.statusEffectiveDate ?? ef
    next.statusHistory = appendHistoryEntry(employee.statusHistory, {
      id: histId(),
      status: proposed.employmentStatus,
      reason: next.statusReason,
      note: next.statusReasonNote,
      effectiveDate: next.statusEffectiveDate,
      validFrom: next.statusEffectiveDate,
    })
  } else if (
    proposed.statusReason !== undefined ||
    proposed.statusReasonNote !== undefined ||
    proposed.statusEffectiveDate !== undefined
  ) {
    next.statusReason = proposed.statusReason ?? employee.statusReason
    next.statusReasonNote = proposed.statusReasonNote ?? employee.statusReasonNote
    next.statusEffectiveDate = proposed.statusEffectiveDate ?? employee.statusEffectiveDate
  }
  return next
}