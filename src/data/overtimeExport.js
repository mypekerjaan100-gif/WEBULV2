import { pontianakFormValues } from './overtimeReplacementL2.js'

export function splitOvertimeExportTimes(startedAt, endedAt) {
  const time = pontianakFormValues(startedAt, endedAt)
  return {
    startTime: time.startTime,
    endTime: time.endTime,
  }
}
