import { buildPontianakRange } from './overtimeReplacementL2.js'

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor
}

export function overtimeTimeCorrectionPreview({ hourlyRate, date, startTime, endTime }) {
  if (hourlyRate == null || String(hourlyRate).trim() === '') return null
  const range = buildPontianakRange(date, startTime, endTime)
  const rate = Number(hourlyRate)
  if (!range || !Number.isFinite(rate) || rate < 0) return null
  const minutes = range.durationMinutes
  const durationHours = round(minutes / 60, 4)
  const multiplierHours = round(
    minutes <= 60 ? minutes * 1.5 / 60 : 1.5 + ((minutes - 60) * 2 / 60),
    4,
  )
  return {
    startedAt: range.startedAt,
    endedAt: range.endedAt,
    minutes,
    durationHours,
    multiplierHours,
    hours: round(durationHours, 2),
    amount: round(rate * multiplierHours, 2),
  }
}
