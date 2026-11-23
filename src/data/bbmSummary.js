import { bbmToday, calculateBbm, monthDays } from './bbmDomain.js'

export function summarizeBbm(vehicle, sheet, month, today = bbmToday()) {
  const result = calculateBbm(month, sheet.rows || [], sheet.initial_odometer, sheet.previous)
  const expectedDays = monthDays(month).filter((date) => date <= today).length
  const completeDays = result.days.filter(({ date, row }) => date <= today && row?.end !== '' && row?.end != null && row.photo && (row.purchases || []).every((p) => p.photo)).length
  return { vehicle, ...result, completeDays, expectedDays,
    status: !result.recorded ? 'Belum diisi' : completeDays < expectedDays || result.gaps ? 'Belum lengkap' : 'Lengkap s.d. periode' }
}

export function totalBbmSummary(rows) {
  const total = rows.reduce((sum, row) => ({
    km: sum.km + row.km, liters: sum.liters + row.liters, total: sum.total + row.total,
  }), { km: 0, liters: 0, total: 0 })
  return { ...total, ratio: total.liters > 0 ? total.km / total.liters : null }
}
