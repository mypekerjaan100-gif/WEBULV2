import assert from 'node:assert/strict'
import {
  filterToolIssuesByMonth,
  toolIssueMonthKey,
  toolIssueMonthLabel,
} from './toolIssuePeriod.js'

assert.equal(toolIssueMonthKey('2026-10-09T00:00:00Z'), '2026-10', 'Issue Oktober harus masuk periode Oktober')
assert.equal(toolIssueMonthKey('2026-10-31T16:59:59Z'), '2026-10', 'Batas akhir Oktober WIB harus tetap Oktober')
assert.equal(toolIssueMonthKey('2026-10-31T17:00:00Z'), '2026-11', 'Awal November WIB harus masuk November')
assert.equal(toolIssueMonthKey('2026-11-24T03:29:00Z'), '2026-11', 'Issue 24 November harus masuk periode November')
assert.equal(toolIssueMonthKey(''), '', 'Tanggal kosong tidak boleh memiliki periode')
assert.equal(toolIssueMonthKey('invalid'), '', 'Tanggal tidak valid tidak boleh memiliki periode')

const rows = [
  { id: 'oktober', opened_at: '2026-10-09T00:00:00Z' },
  { id: 'akhir-oktober', opened_at: '2026-10-31T16:59:59Z' },
  { id: 'awal-november', opened_at: '2026-10-31T17:00:00Z' },
  { id: 'november', opened_at: '2026-11-24T03:29:00Z' },
  { id: 'tanpa-tanggal', opened_at: null },
]

assert.deepEqual(
  filterToolIssuesByMonth(rows, '2026-10').map((row) => row.id),
  ['oktober', 'akhir-oktober'],
  'Oktober hanya boleh memuat issue yang ditemukan pada Oktober WIB',
)
assert.deepEqual(
  filterToolIssuesByMonth(rows, '2026-11').map((row) => row.id),
  ['awal-november', 'november'],
  'November hanya boleh memuat issue yang ditemukan pada November WIB',
)
assert.deepEqual(
  filterToolIssuesByMonth(rows, '2026-12').map((row) => row.id),
  [],
  'Bulan tanpa issue harus kosong',
)
assert.equal(
  filterToolIssuesByMonth(rows, 'bukan-bulan').length,
  rows.length,
  'Periode tidak valid tidak boleh menyembunyikan data',
)
assert.equal(toolIssueMonthLabel('2026-10'), 'Oktober 2026', 'Label periode harus dalam Bahasa Indonesia')
assert.equal(toolIssueMonthLabel('2026-11'), 'November 2026', 'Label periode November harus benar')

console.log('toolIssuePeriod.test.js: filter issue per bulan WIB passed')
