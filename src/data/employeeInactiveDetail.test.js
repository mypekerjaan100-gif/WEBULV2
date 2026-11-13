import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectiveEmploymentStatusOf } from './pensiunPelayananTeknik.js'

const repository = readFileSync(new URL('./employeeRepository.js', import.meta.url), 'utf8')
const statusMapping = repository.slice(repository.indexOf('const statusHistByEmp'), repository.indexOf('const rateHistByEmp'))
assert.ok(statusMapping.includes("effective_from: 'effectiveDate'"), 'Tanggal status harus dipetakan dari tanggal efektif riwayat')
assert.ok(repository.includes("currentStatus?.status === 'Nonaktif' ? (currentStatus?.effectiveDate ?? null) : null"), 'Tanggal status hanya boleh terisi untuk Nonaktif')
assert.ok(repository.includes('effectiveDate: e.effectiveDate'), 'Riwayat juga harus membawa tanggal efektif')
const component = readFileSync(new URL('../components/sla/SLADatabasePegawai.jsx', import.meta.url), 'utf8')
const detail = component.slice(component.indexOf('const renderUtama'), component.indexOf('const editExistingPhoto'))
assert.ok(detail.includes('const effectiveStatus = effectiveEmploymentStatusOf(data, todayStr, pensionPolicy)'))
assert.ok(detail.includes("effectiveStatus.status === 'Nonaktif'"))
assert.ok(detail.includes("formatIndonesianDate(effectiveStatus.effectiveDate) || '\\u2014'"))
for (const reason of ['Resign', 'PHK', 'Pensiun', 'Lainnya']) {
  const result = effectiveEmploymentStatusOf({ employmentStatus: 'Nonaktif', statusReason: reason, statusEffectiveDate: '2026-11-01' }, '2026-11-13', null)
  assert.equal(result.effectiveDate, '2026-11-01')
  assert.equal(result.reason, reason)
}
assert.deepEqual(effectiveEmploymentStatusOf({ employmentStatus: 'Aktif', retirementDateOverride: '2026-11-01' }, '2026-11-13', null), {
  status: 'Nonaktif', reason: 'Pensiun', effectiveDate: '2026-11-01',
})
assert.equal(effectiveEmploymentStatusOf({ employmentStatus: 'Nonaktif', statusEffectiveDate: null }, '2026-11-13', null).effectiveDate, null)
console.log('Employee inactive detail regression tests passed')
