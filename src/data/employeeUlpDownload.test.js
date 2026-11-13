import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activeEmployeeExportRows, filterEmployeeExportRows } from './employeeOperationalExport.js'

const page = readFileSync(new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url), 'utf8')
const component = readFileSync(new URL('../components/sla/SLADatabasePegawai.jsx', import.meta.url), 'utf8')
assert.ok(page.includes("canDownloadOperational={!isCustomRole && (previewActive ? ['ADMIN_UP3', 'ADMIN_ULP'].includes(viewAsRoleCode) : canManageUp3Operations || isAdminUlp)}"))
assert.ok(component.includes("const scopeUnitIds = role === 'ulp'\n    ? [selectedPreviewUnitUuid]"))
assert.ok(component.includes('scopedUnitIds.includes(row.employee ? row.employee.unitId : row.request.proposed.unitId)'))
assert.ok(component.includes("const effectiveDownloadUnit = role === 'ulp' ? selectedPreviewUnitUuid : downloadUnit"))
assert.ok(component.includes('unitId: effectiveDownloadUnit, locationId: downloadLocation'))
assert.ok(component.includes("disabled={downloadBusy || role === 'ulp'}"))
assert.ok(component.includes("if (role === 'ulp' && !selectedPreviewUnitUuid) return"))
const employees = [
  { id: 'own', unitId: 'ulp-a', employmentStatus: 'Aktif' },
  { id: 'other', unitId: 'ulp-b', employmentStatus: 'Aktif' },
  { id: 'inactive', unitId: 'ulp-a', employmentStatus: 'Nonaktif' },
]
const scoped = employees.filter((employee) => ['ulp-a'].includes(employee.unitId))
const active = activeEmployeeExportRows(scoped, '2026-11-13', null)
assert.deepEqual(filterEmployeeExportRows(active, { unitId: 'ulp-a' }).map((employee) => employee.id), ['own'])
assert.deepEqual(filterEmployeeExportRows(active, { unitId: 'ulp-b' }), [])
assert.deepEqual(filterEmployeeExportRows(active).map((employee) => employee.id), ['own'])
console.log('Employee ULP download access and scope tests passed')
