import assert from 'node:assert/strict'
import { summarizeBbm, totalBbmSummary } from './bbmSummary.js'

const sheet = { initial_odometer: 100, rows: [{ date: '2026-11-01', end: 200, photo: 'odo', purchases: [{ liters: 10, price: 10000, photo: 'receipt' }] }] }
const row = summarizeBbm({ id: 'a' }, sheet, '2026-11', '2026-11-01')
assert.equal(row.km, 100)
assert.equal(row.ratio, 10)
assert.equal(row.status, 'Lengkap s.d. periode')
assert.equal(summarizeBbm({}, sheet, '2026-11', '2026-11-02').status, 'Belum lengkap')
assert.equal(summarizeBbm({}, { rows: [] }, '2026-11').status, 'Belum diisi')
assert.equal(summarizeBbm({}, { ...sheet, previous: { end: 150, date: '2026-10-31' } }, '2026-11').km, 50)
const totals = totalBbmSummary([row, { km: 300, liters: 60, total: 600000 }])
assert.equal(totals.ratio, 400 / 70)
assert.equal(totals.total, 700000)
assert.equal(totalBbmSummary([]).ratio, null)
console.log('BBM summary: carryover, completeness, empty data and weighted totals passed.')
