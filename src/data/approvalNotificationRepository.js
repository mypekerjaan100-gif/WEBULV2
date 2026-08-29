import { variableCostIndicators } from './slaPelayananTeknik.js'
import { listOvertimeReplacements, listOvertimeWork } from './overtimeReplacementRepository.js'
import { getShortLabel, listFeeders, listSubmittedEntries } from './variableCostRepository.js'

const NOTIFICATION_SOURCE_TIMEOUT_MS = 10000

function withTimeout(promise, sourceLabel) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${sourceLabel} melebihi batas waktu.`)), NOTIFICATION_SOURCE_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId))
}

function unitName(units, unitId) {
  return units.find((unit) => unit.uuid === unitId)?.displayName ?? unitId?.slice(0, 8) ?? '—'
}

function activityName(row) {
  if (row.type === 'WORK') return row.workTitle || row.workCategory || 'Pekerjaan Lembur'
  return row.description || row.type || 'Penggantian Lembur'
}

const APPROVAL_SOURCES = [
  {
    id: 'variable',
    label: 'Variable Cost',
    load: async ({ contractId, up3Id, units }) => {
      const rows = await listSubmittedEntries({ contractId, up3Id })
      return rows.map((row) => {
        const indicator = row.sla_indicators ?? variableCostIndicators.find((item) => item.id === row.indicator_id)
        return {
          id: row.id,
          source: 'variable',
          unitId: row.unit_id,
          unitName: unitName(units, row.unit_id),
          title: getShortLabel(indicator),
          date: row.work_date?.slice(0, 10) ?? null,
          sortAt: row.created_at ?? row.work_date,
        }
      })
    },
  },
  {
    id: 'lembur',
    label: 'Lembur',
    load: async ({ contractId, up3Id, units }) => {
      const [replacementRows, workRows] = await Promise.all([
        listOvertimeReplacements({ contractId, up3Id, unitId: null, periodMonth: null }),
        listOvertimeWork({ contractId, up3Id, unitId: null, periodMonth: null }),
      ])
      const activities = new Map()
      for (const row of [...replacementRows, ...workRows]) {
        if (row.status === 'SUBMITTED' && !activities.has(row.id)) activities.set(row.id, row)
      }
      return [...activities.values()].map((row) => ({
        id: row.id,
        source: 'lembur',
        unitId: row.unitId,
        unitName: unitName(units, row.unitId),
        title: activityName(row),
        date: row.date ?? null,
        periodMonth: row.periodMonth ?? null,
        sortAt: row.submittedAt ?? row.updatedAt ?? row.date,
      }))
    },
  },
  {
    id: 'feeder',
    label: 'Master Penyulang',
    load: async ({ contractId, up3Id, units }) => {
      const rows = await listFeeders({ contractId, up3Id })
      return rows.filter((row) => row.status === 'PENDING').map((row) => ({
        id: row.id,
        source: 'feeder',
        unitId: row.unit_id,
        unitName: unitName(units, row.unit_id),
        title: row.name,
        date: row.proposed_at?.slice(0, 10) ?? null,
        sortAt: row.proposed_at,
      }))
    },
  },
]

export async function listAdminUp3ApprovalNotifications({ contractId, up3Id, units = [] }) {
  const groups = await Promise.all(APPROVAL_SOURCES.map(async (source) => {
    try {
      const items = await withTimeout(source.load({ contractId, up3Id, units }), source.label)
      items.sort((left, right) => String(right.sortAt ?? '').localeCompare(String(left.sortAt ?? '')))
      return { id: source.id, label: source.label, count: items.length, items, error: '' }
    } catch (error) {
      return { id: source.id, label: source.label, count: 0, items: [], error: error.message || `${source.label} gagal dimuat.` }
    }
  }))
  return { count: groups.reduce((total, group) => total + group.count, 0), groups }
}

export async function listManagementApprovalNotifications({ scopes, units = [] }) {
  const results = await Promise.all(scopes.map(async (scope) => ({
    scope,
    result: await listAdminUp3ApprovalNotifications({
      contractId: scope.contractId,
      up3Id: scope.up3Uuid,
      units,
    }),
  })))
  const groups = APPROVAL_SOURCES.map((source) => {
    const items = new Map()
    let error = ''
    for (const { scope, result } of results) {
      const group = result.groups.find((entry) => entry.id === source.id)
      if (group?.error && !error) error = group.error
      for (const item of group?.items ?? []) {
        items.set(item.id, { ...item, managementScopeKey: scope.key })
      }
    }
    const sortedItems = [...items.values()].sort((left, right) =>
      String(right.sortAt ?? '').localeCompare(String(left.sortAt ?? '')),
    )
    return { id: source.id, label: source.label, count: sortedItems.length, items: sortedItems, error }
  })
  return { count: groups.reduce((total, group) => total + group.count, 0), groups }
}
