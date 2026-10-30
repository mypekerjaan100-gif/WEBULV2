import { variableCostIndicators } from './slaPelayananTeknik.js'

export const VARIABLE_MONTHLY_INDICATORS = variableCostIndicators.filter((indicator) => indicator.ulpInputEnabled)
export const VARIABLE_MONTHLY_CODES = VARIABLE_MONTHLY_INDICATORS.map((indicator) => indicator.code)

export function periodEndOf(periodMonth) {
  const match = String(periodMonth ?? '').match(/^(\d{4})-(0[1-9]|1[0-2])-01$/)
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).toISOString().slice(0, 10)
}

// Blank is unknown, not zero. Reject invalid input rather than silently changing it.
export function monthlyInputNumber(raw) {
  if (raw == null || String(raw).trim() === '') return null
  const text = String(raw).trim()
  const value = Number(text)
  if (!/^\d+(?:\.\d{1,4})?$/.test(text) || !Number.isFinite(value) || value >= 1e14) {
    throw new Error('WO dan realisasi harus angka nol atau lebih, maksimal 4 angka desimal.')
  }
  return value
}

export function monthlyDraftsFromRows(rows, unitId) {
  return Object.fromEntries(VARIABLE_MONTHLY_CODES.map((code) => {
    const row = rows.find((item) => item.unit_id === unitId && item.indicator_code === code)
    return [code, {
      workOrder: row?.work_order == null ? '' : String(row.work_order),
      realization: row?.realization == null ? '' : String(row.realization),
    }]
  }))
}

export function monthlyDraftIsDirty(drafts, rows, unitId) {
  return VARIABLE_MONTHLY_CODES.some((code) => {
    const row = rows.find((item) => item.unit_id === unitId && item.indicator_code === code)
    try {
      return monthlyInputNumber(drafts[code]?.workOrder) !== (row?.work_order == null ? null : Number(row.work_order))
        || monthlyInputNumber(drafts[code]?.realization) !== (row?.realization == null ? null : Number(row.realization))
    } catch {
      return true
    }
  })
}

export function monthlyChanges(drafts, rows, unitId) {
  return VARIABLE_MONTHLY_CODES.flatMap((code) => {
    const row = rows.find((item) => item.unit_id === unitId && item.indicator_code === code)
    const workOrder = monthlyInputNumber(drafts[code]?.workOrder)
    const realization = monthlyInputNumber(drafts[code]?.realization)
    if (workOrder === (row?.work_order == null ? null : Number(row.work_order))
      && realization === (row?.realization == null ? null : Number(row.realization))) return []
    return [{ indicatorCode: code, workOrder, realization, expectedRevision: row?.revision ?? 0 }]
  })
}

export function monthlyAchievement(target, workOrder, realization) {
  if ([target, workOrder, realization].some((value) => value == null || value === '' || !Number.isFinite(Number(value)))) return null
  const denominator = Math.min(Number(target), Number(workOrder))
  return denominator > 0 ? Number(realization) / denominator * 100 : null
}

export function sumMonthlyField(rows, field) {
  const configured = rows.filter((row) => row[field] != null)
  return configured.length ? configured.reduce((sum, row) => sum + Number(row[field]), 0) : null
}

export function aggregateLinkedSlaValues(entries, target) {
  const rows = entries.map((entry) => entry ?? {})
  const wo = sumMonthlyField(rows, 'wo')
  const realization = sumMonthlyField(rows, 'realization')
  const incomplete = !rows.length || target == null || rows.some((row) => row.wo == null || row.realization == null)
  return { wo, realization, incomplete, achievement: incomplete ? null : monthlyAchievement(target, wo, realization) }
}

export function aggregateMonthlyValues(rows, indicatorCode, unitIds) {
  const relevant = rows.filter((row) => row.indicator_code === indicatorCode && unitIds.includes(row.unit_id))
  return {
    workOrder: sumMonthlyField(relevant, 'work_order'),
    realization: sumMonthlyField(relevant, 'realization'),
    missingWorkOrder: unitIds.length - relevant.filter((row) => row.work_order != null).length,
    missingRealization: unitIds.length - relevant.filter((row) => row.realization != null).length,
  }
}

export function selectedMonthlyFinancialTotals(snapshot, revenueCodes, costCodes) {
  const revenues = new Map((snapshot?.revenue_eligible_components ?? []).map((row) => [row.indicator_code, row]))
  const costs = new Map((snapshot?.cost_components ?? []).map((row) => [row.cost_code, row]))
  let revenue = 0
  let revenueMissingPrice = 0
  let revenueMissingActual = 0
  for (const code of revenueCodes) {
    const row = revenues.get(code)
    revenue += Number(row?.amount ?? 0)
    revenueMissingPrice += Number(row?.missing_price_count ?? 0)
    revenueMissingActual += row ? Number(row.missing_actual_count ?? 0) : 1
  }
  const cost = costCodes.reduce((sum, code) => sum + Number(costs.get(code)?.amount ?? 0), 0)
  const complete = revenueMissingPrice === 0 && revenueMissingActual === 0
  return { revenue, cost, complete, revenueMissingPrice, revenueMissingActual,
    margin: complete ? revenue - cost : null,
    ratio: complete && revenue > 0 ? cost / revenue * 100 : null,
  }
}
