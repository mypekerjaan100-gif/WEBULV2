const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

export function periodIndexOf(periodKey) {
  const [year, month] = String(periodKey ?? '').split('-').map(Number)
  return Number.isInteger(year) && Number.isInteger(month) ? year * 12 + (month - 1) : null
}

export function periodIndexFromLabel(periodLabel) {
  const parts = String(periodLabel ?? '').trim().split(/\s+/)
  const month = MONTHS.indexOf(parts[0])
  const year = Number(parts[1])
  return month >= 0 && Number.isInteger(year) ? year * 12 + month : null
}

export function currentNameOf(unit) {
  const history = [...(unit.nameHistory ?? [])].sort((a, b) =>
    (a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1,
  )
  const current = history.find((entry) => entry.validTo == null)
  return current?.name ?? history[history.length - 1]?.name ?? unit.name ?? ''
}

export function nameOfForPeriod(unit, periodLabel) {
  const key = periodIndexFromLabel(periodLabel)
  const history = [...(unit.nameHistory ?? [])].sort((a, b) =>
    (a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1,
  )
  if (key == null) return currentNameOf(unit)
  let matched = null
  history.forEach((entry) => {
    const from = periodIndexOf(entry.validFrom)
    const to = periodIndexOf(entry.validTo)
    if (from != null && key < from) return
    if (to != null && key > to) return
    matched = entry
  })
  return matched?.name ?? currentNameOf(unit)
}

export function unitNameForPeriod(units, unitId, periodLabel) {
  const unit = units.find((item) => item.id === unitId)
  return unit ? nameOfForPeriod(unit, periodLabel) : null
}

export function ulpIdsOfUp3(units, up3Id) {
  return units
    .filter((unit) => unit.type === 'ULP' && unit.parentUnitId === up3Id)
    .map((unit) => unit.id)
}

export function ownStatusOf(unit) {
  return unit?.status ?? 'Nonaktif'
}

export function effectiveStatusOf(units, unitId) {
  const unit = units.find((item) => item.id === unitId)
  if (!unit) return 'Nonaktif'
  if (unit.type === 'ULP') {
    if (unit.status !== 'Aktif') return 'Nonaktif'
    const parent = units.find((item) => item.id === unit.parentUnitId)
    return parent ? effectiveStatusOf(units, parent.id) : 'Nonaktif'
  }
  return unit.status === 'Aktif' ? 'Aktif' : 'Nonaktif'
}

export function collectUnitReferences(unitId, context = {}) {
  const refs = []
  ;(context.employees ?? []).forEach((item) => {
    if (item.unitId === unitId) {
      refs.push({ kind: 'pegawai', id: item.id, label: item.name ?? item.id })
    }
  })
  ;(context.signatureGroups ?? []).forEach((item) => {
    if (item.unitId === unitId || item.up3Id === unitId) {
      refs.push({ kind: 'penandatangan', id: item.id, label: item.title ?? item.id })
    }
  })
  ;(context.slaUnitIds ?? []).forEach((id) => {
    if (id === unitId) {
      refs.push({ kind: 'sla', id, label: 'Data SLA/report' })
    }
  })
  return refs
}

export const initialOrganizationUnits = [
  {
    id: 'up3',
    type: 'UP3',
    parentUnitId: null,
    status: 'Aktif',
    nameHistory: [
      { id: 'nh-up3-1', name: 'UP3 Singkawang', validFrom: null, validTo: null },
    ],
  },
  {
    id: 'ulp-1',
    type: 'ULP',
    parentUnitId: 'up3',
    status: 'Aktif',
    nameHistory: [
      { id: 'nh-ulp1-1', name: 'ULP Singkawang', validFrom: null, validTo: null },
    ],
  },
  {
    id: 'ulp-2',
    type: 'ULP',
    parentUnitId: 'up3',
    status: 'Aktif',
    nameHistory: [
      { id: 'nh-ulp2-1', name: 'ULP Sei Duri', validFrom: null, validTo: null },
    ],
  },
  {
    id: 'ulp-3',
    type: 'ULP',
    parentUnitId: 'up3',
    status: 'Aktif',
    nameHistory: [
      { id: 'nh-ulp3-1', name: 'ULP Pemangkat', validFrom: null, validTo: null },
    ],
  },
  {
    id: 'ulp-4',
    type: 'ULP',
    parentUnitId: 'up3',
    status: 'Aktif',
    nameHistory: [
      { id: 'nh-ulp4-1', name: 'ULP Bengkayang', validFrom: null, validTo: null },
    ],
  },
  {
    id: 'ulp-5',
    type: 'ULP',
    parentUnitId: 'up3',
    status: 'Aktif',
    nameHistory: [
      { id: 'nh-ulp5-1', name: 'ULP Sambas', validFrom: null, validTo: null },
    ],
  },
  {
    id: 'ulp-6',
    type: 'ULP',
    parentUnitId: 'up3',
    status: 'Aktif',
    nameHistory: [
      { id: 'nh-ulp6-1', name: 'ULP Sekura', validFrom: null, validTo: null },
    ],
  },
  {
    id: 'up3-b',
    type: 'UP3',
    parentUnitId: null,
    status: 'Aktif',
    nameHistory: [
      { id: 'nh-up3b-1', name: 'UP3 Dummy B', validFrom: null, validTo: null },
    ],
  },
  {
    id: 'ulp-b1',
    type: 'ULP',
    parentUnitId: 'up3-b',
    status: 'Aktif',
    nameHistory: [
      { id: 'nh-ulpb1-1', name: 'ULP B1', validFrom: null, validTo: null },
    ],
  },
]

export const contractOrganizationScopes = [
  {
    contractId: 'pelayanan-teknik',
    contractName: 'Pelayanan Teknik',
    region: 'UP3 Singkawang',
    up3Id: 'up3',
    status: 'Aktif',
  },
]

export const initialEmployees = [
  {
    id: 'e-1',
    unitId: 'up3',
    name: 'Ir. Andi Wijaya, M.T.',
    position: 'Manager UP3 Singkawang',
    status: 'Aktif',
  },
  {
    id: 'e-2',
    unitId: 'up3',
    name: 'Budi Santoso, S.T.',
    position: 'Assistant Manager Pelayanan Teknik',
    status: 'Aktif',
  },
  {
    id: 'e-3',
    unitId: 'ulp-1',
    name: 'Rina Marlina',
    position: 'Manajer Unit Pelaksana Layanan',
    status: 'Aktif',
  },
  {
    id: 'e-4',
    unitId: 'ulp-2',
    name: 'Dedi Kurniawan, S.E.',
    position: 'Manajer Unit Pelaksana Layanan',
    status: 'Aktif',
  },
  {
    id: 'e-5',
    unitId: 'ulp-5',
    name: 'Hj. Sri Rahayu, S.H.',
    position: 'Kepala Bagian Perekonomian (Contoh)',
    status: 'Aktif',
  },
]