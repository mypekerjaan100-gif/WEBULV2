import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { splitOvertimeExportTimes } from './overtimeExport.js'

assert.deepEqual(
  splitOvertimeExportTimes('2026-08-20T08:00:00+07:00', '2026-08-20T16:00:00+07:00'),
  { startTime: '08:00', endTime: '16:00' },
)
assert.deepEqual(
  splitOvertimeExportTimes('2026-08-20T01:00:00Z', '2026-08-20T09:00:00Z'),
  { startTime: '08:00', endTime: '16:00' },
)
assert.deepEqual(
  splitOvertimeExportTimes('2026-08-31T22:00:00+07:00', '2026-09-01T02:00:00+07:00'),
  { startTime: '22:00', endTime: '02:00 (+1 hari)' },
)

const component = readFileSync(
  fileURLToPath(new URL('../components/sla/SLALembur.jsx', import.meta.url)),
  'utf8',
)
assert.ok(component.includes("{ label: 'Jam Mulai', width: 14 }"), 'Kolom Jam Mulai export hilang')
assert.ok(component.includes("{ label: 'Jam Selesai', width: 22 }"), 'Kolom Jam Selesai export hilang')
assert.ok(!component.includes("{ label: 'Waktu/Jam', width: 22 }"), 'Kolom waktu gabungan export masih ada')
assert.ok(component.includes('splitOvertimeExportTimes(record.startedAt, record.endedAt)'), 'Export harus memakai pemisahan waktu WIB')

console.log('Overtime export tests passed')
