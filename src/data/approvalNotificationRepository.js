import { listOvertimeReplacements, listOvertimeWork } from './overtimeReplacementRepository.js'
import { listOpenToolIssues } from './toolInspectionRepository.js'

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
    id: 'lembur',
    label: 'Lembur',
    load: async ({ contractId, up3Id, units }) => {
      const [replacementRows, workRows] = await Promise.all([
        listOvertimeReplacements({ contractId, up3Id, unitId: null, periodMonth: null }),
        listOvertimeWork({ contractId, up3Id, unitId: null, periodMonth: null }),
      ])
      const items = []
      for (const row of replacementRows) {
        if (row.status !== 'SUBMITTED') continue
        items.push({
          id: row.entryId ? `${row.id}:${row.entryId}` : row.id,
          source: 'lembur',
          entryId: row.entryId ?? null,
          participantName: row.participant_name ?? row.participantName ?? '',
          unitId: row.unitId,
          unitName: unitName(units, row.unitId),
          title: activityName(row),
          date: row.date ?? null,
          periodMonth: row.periodMonth ?? null,
          sortAt: row.submittedAt ?? row.updatedAt ?? row.date,
        })
      }
      // Lembur Pekerjaan: satu notifikasi per peserta agar approval dan
      // evidence selalu terbuka pada peserta yang tepat.
      for (const row of workRows) {
        const reviewStatus = row.entryStatus ?? row.status
        if (reviewStatus !== 'SUBMITTED') continue
        const participantName = row.participant_name ?? row.participantName ?? ''
        items.push({
          id: row.entryId ? `${row.id}:${row.entryId}` : row.id,
          source: 'lembur',
          entryId: row.entryId ?? null,
          participantName,
          unitId: row.unitId,
          unitName: unitName(units, row.unitId),
          title: participantName ? `${activityName(row)} · ${participantName}` : activityName(row),
          date: row.date ?? null,
          periodMonth: row.periodMonth ?? null,
          sortAt: row.submittedAt ?? row.updatedAt ?? row.date,
        })
      }
      return items
    },
  },
  {
    id: 'alat',
    label: 'Alat & Kendaraan',
    load: async ({ contractId, up3Id, units }) => {
      const rows = await listOpenToolIssues({ contractId, up3Id })
      return rows.map((row) => ({
        id: row.id,
        source: 'alat',
        unitId: row.ulp_id,
        unitName: unitName(units, row.ulp_id),
        title: `${row.equipment_name} · ${row.vehicle_label || row.plate_display || 'Kendaraan'}`,
        date: row.opened_at?.slice(0, 10) ?? null,
        sortAt: row.opened_at,
      }))
    },
  },
]

function revisionPeriodMonth(value) {
  const match = /^(\d{4})-(\d{2})/.exec(String(value ?? ''))
  return match ? `${match[1]}-${match[2]}-01` : null
}

function revisionItem(row, units, reviewStatus) {
  if (reviewStatus !== 'CORRECTION_REQUIRED') return null
  if (row.revisionDeadlineAt && new Date(row.revisionDeadlineAt).getTime() < Date.now()) return null
  const participantName = row.participant_name ?? row.participantName ?? ''
  const unitLabel = unitName(units, row.unitId)
  const periodMonth = revisionPeriodMonth(row.periodMonth)
  const deadline = row.revisionDeadlineAt
    ? new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Pontianak',
    }).format(new Date(row.revisionDeadlineAt))
    : null
  const lastRevision = Number(row.rejectionCount ?? 0) >= 2
  return {
    id: row.entryId ? `${row.id}:${row.entryId}` : row.id,
    source: 'lembur',
    kind: 'revision',
    entryId: row.entryId ?? null,
    activityId: row.id,
    participantName,
    unitId: row.unitId,
    unitName: unitLabel,
    title: participantName ? `${activityName(row)} · ${participantName}` : activityName(row),
    meta: [
      unitLabel,
      row.date,
      deadline ? `Batas revisi ${deadline} WITA` : null,
      lastRevision ? 'Revisi terakhir' : null,
    ].filter(Boolean).join(' · '),
    date: row.date ?? null,
    periodMonth,
    revisionDeadlineAt: row.revisionDeadlineAt ?? null,
    lastRevision,
    sortAt: row.revisionDeadlineAt ?? row.updatedAt ?? row.date,
  }
}

// Admin ULP hanya perlu melihat pengajuan milik ULP-nya yang dikembalikan
// Admin UP3 untuk diperbaiki. Revisi yang sudah kedaluwarsa tidak dihitung
// karena sudah tidak dapat diajukan ulang.
export async function listAdminUlpRevisionNotifications({ contractId, up3Id, unitId, units = [] }) {
  const [replacements, work] = await Promise.allSettled([
    withTimeout(listOvertimeReplacements({ contractId, up3Id, unitId, periodMonth: null }), 'Revisi Lembur'),
    withTimeout(listOvertimeWork({ contractId, up3Id, unitId, periodMonth: null }), 'Revisi Lembur Pekerjaan'),
  ])
  if (replacements.status === 'rejected' && work.status === 'rejected') {
    throw replacements.reason
  }
  const items = [
    ...(replacements.status === 'fulfilled'
      ? replacements.value.map((row) => revisionItem(row, units, row.status)).filter(Boolean)
      : []),
    ...(work.status === 'fulfilled'
      ? work.value.map((row) => revisionItem(row, units, row.entryStatus ?? row.status)).filter(Boolean)
      : []),
  ]
  items.sort((left, right) => String(left.sortAt ?? '').localeCompare(String(right.sortAt ?? '')))
  const error = replacements.status === 'rejected' || work.status === 'rejected'
    ? 'Sebagian data revisi Lembur gagal dimuat.'
    : ''
  return {
    mode: 'revision',
    title: 'Lembur Perlu Revisi',
    count: items.length,
    groups: [{
      id: 'lembur',
      label: 'Lembur',
      count: items.length,
      items,
      error,
    }],
  }
}

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
  return {
    mode: 'approval',
    title: 'Menunggu Persetujuan',
    count: groups.reduce((total, group) => total + group.count, 0),
    groups,
  }
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
  return {
    mode: 'approval',
    title: 'Menunggu Persetujuan',
    count: groups.reduce((total, group) => total + group.count, 0),
    groups,
  }
}
