import { pontianakFormValues } from './overtimeReplacementL2.js'

export function splitOvertimeExportTimes(startedAt, endedAt) {
  const time = pontianakFormValues(startedAt, endedAt)
  const overnight = time.endTime <= time.startTime
  return {
    startTime: time.startTime,
    endTime: `${time.endTime}${overnight ? ' (+1 hari)' : ''}`,
  }
}
