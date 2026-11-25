export const TOOL_ISSUE_TIME_ZONE = 'Asia/Pontianak'

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function toolIssueMonthKey(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOOL_ISSUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return year && month ? `${year}-${month}` : ''
}

export function filterToolIssuesByMonth(rows, month) {
  if (!MONTH_PATTERN.test(month || '')) return rows
  return rows.filter((row) => toolIssueMonthKey(row.opened_at) === month)
}

export function toolIssueMonthLabel(month) {
  if (!MONTH_PATTERN.test(month || '')) return ''
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TOOL_ISSUE_TIME_ZONE,
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}-01T12:00:00+07:00`))
}
