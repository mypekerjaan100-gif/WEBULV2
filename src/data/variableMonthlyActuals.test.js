import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  VARIABLE_MONTHLY_CODES, monthlyInputNumber, monthlyDraftsFromRows, monthlyDraftIsDirty, monthlyChanges,
  monthlyAchievement, aggregateMonthlyValues, aggregateLinkedSlaValues, selectedMonthlyFinancialTotals, periodEndOf,
} from './variableMonthlyActuals.js'
import { isPreviewWriteRpc } from '../lib/previewWriteGuard.js'

assert.equal(VARIABLE_MONTHLY_CODES.length, 10)
assert(!VARIABLE_MONTHLY_CODES.includes('3.1c'))
assert(VARIABLE_MONTHLY_CODES.includes('3.1a'))
assert(VARIABLE_MONTHLY_CODES.includes('TEBANG_20_40_CM'))
assert(VARIABLE_MONTHLY_CODES.includes('TEBANG_40_60_CM'))
assert.equal(monthlyInputNumber(''), null)
assert.equal(monthlyInputNumber('  '), null)
assert.equal(monthlyInputNumber(null), null)
assert.equal(monthlyInputNumber('0'), 0)
assert.equal(monthlyInputNumber('12.3456'), 12.3456)
for (const raw of ['-1', '1.23456', '1,23', 'NaN', 'Infinity', '1e3', 'text', '100000000000000']) assert.throws(() => monthlyInputNumber(raw))

const rows = [{ unit_id: 'ulp-1', indicator_code: '2.1a', work_order: 100, realization: 0, revision: 2 }]
const drafts = monthlyDraftsFromRows(rows, 'ulp-1')
assert.equal(drafts['2.1a'].realization, '0')
assert.equal(drafts['3.2b'].workOrder, '')
assert(!monthlyDraftIsDirty(drafts, rows, 'ulp-1'))
assert.deepEqual(monthlyChanges(drafts, rows, 'ulp-1'), [])
drafts['2.1a'].realization = ''
assert(monthlyDraftIsDirty(drafts, rows, 'ulp-1'))
assert.deepEqual(monthlyChanges(drafts, rows, 'ulp-1'), [{ indicatorCode: '2.1a', workOrder: 100, realization: null, expectedRevision: 2 }])
drafts['2.1a'].realization = '0.0000'
assert(!monthlyDraftIsDirty(drafts, rows, 'ulp-1'))
drafts['3.2b'].realization = '0'
assert.deepEqual(monthlyChanges(drafts, rows, 'ulp-1'), [{ indicatorCode: '3.2b', workOrder: null, realization: 0, expectedRevision: 0 }])
drafts['3.2b'].realization = '-2'
assert.throws(() => monthlyChanges(drafts, rows, 'ulp-1'))
assert(monthlyDraftIsDirty(drafts, rows, 'ulp-1'))

assert.equal(monthlyAchievement(100, 80, 40), 50)
assert.equal(monthlyAchievement(80, 100, 80), 100)
assert.equal(monthlyAchievement(80, 100, 120), 150)
assert.equal(monthlyAchievement(80, 100, 0), 0)
assert.equal(monthlyAchievement(0, 100, 120), null)
assert.equal(monthlyAchievement(80, 0, 120), null)
assert.equal(monthlyAchievement(null, 100, 120), null)
assert.equal(monthlyAchievement(80, null, 120), null)
assert.equal(monthlyAchievement(80, 100, null), null)
assert.deepEqual(aggregateMonthlyValues(rows, '2.1a', ['ulp-1', 'ulp-2']), { workOrder: 100, realization: 0, missingWorkOrder: 1, missingRealization: 1 })
assert.deepEqual(aggregateMonthlyValues(rows, '3.2b', ['ulp-1', 'ulp-2']), { workOrder: null, realization: null, missingWorkOrder: 2, missingRealization: 2 })
assert.equal(aggregateMonthlyValues(rows, '2.1a', ['ulp-2']).realization, null)
assert.deepEqual(aggregateLinkedSlaValues([undefined, undefined], 100), { wo: null, realization: null, achievement: null, incomplete: true })
assert.deepEqual(aggregateLinkedSlaValues([{wo:80,realization:40}, undefined], 100), { wo:80, realization:40, achievement:null, incomplete:true })
assert.deepEqual(aggregateLinkedSlaValues([{wo:80,realization:40}, {wo:120,realization:60}], 200), { wo:200, realization:100, achievement:50, incomplete:false })
assert.equal(aggregateLinkedSlaValues([{wo:0,realization:0}], 100).achievement, null)
assert.equal(periodEndOf('2026-10-01'), '2026-10-31')
assert.equal(periodEndOf('2024-02-01'), '2024-02-29')
assert.equal(periodEndOf('2026-02-01'), '2026-02-28')
assert.equal(periodEndOf('bad-date'), null)

const snapshot = {
  revenue_eligible_components: [
    { indicator_code: '2.1a', amount: 2000, missing_price_count: 0, missing_actual_count: 0 },
    { indicator_code: '2.1b', amount: 0, missing_price_count: 0, missing_actual_count: 1 },
    { indicator_code: '3.2a', amount: 0, missing_price_count: 1, missing_actual_count: 0 },
    { indicator_code: '3.2b', amount: 0, missing_price_count: 0, missing_actual_count: 0 },
  ],
  cost_components: [{ cost_code: 'ROW', amount: 500 }],
}
assert.equal(selectedMonthlyFinancialTotals(snapshot, ['2.1a'], ['ROW']).margin, 1500)
assert.equal(selectedMonthlyFinancialTotals(snapshot, ['2.1a'], ['ROW']).ratio, 25)
assert.equal(selectedMonthlyFinancialTotals(snapshot, ['2.1a', '2.1b'], ['ROW']).margin, null)
assert.equal(selectedMonthlyFinancialTotals(snapshot, ['2.1a', '3.2a'], ['ROW']).margin, null)
assert.equal(selectedMonthlyFinancialTotals(snapshot, ['TEBANG_20_40_CM'], ['ROW']).complete, false)
assert.equal(selectedMonthlyFinancialTotals(snapshot, ['3.2b'], []).margin, 0)
assert.equal(selectedMonthlyFinancialTotals(snapshot, ['3.2b'], []).ratio, null)

const component = readFileSync(new URL('../components/sla/SLAVariableCost.jsx', import.meta.url), 'utf8')
assert(component.includes('Simpan Input Bulanan'))
assert(component.includes('canInputMonthly && role'))
assert(component.includes('Tidak Ditagihkan'))
assert(component.includes('onEditorStateChange'))
assert(component.includes('onSaved?.()'))
const page = readFileSync(new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url), 'utf8')
assert(page.includes('onSaved={handleVariableSaved}'))
assert(page.includes('const handleVariableSaved = useCallback(() => setSlaReloadToken'))
assert(component.includes('beforeunload'))
for (const legacy of ['listDailyEntries', 'saveVariableEntry', 'uploadVariableEvidence', 'listSubmittedEntries', 'Master Penyulang']) assert(!component.includes(legacy), legacy)
for (const name of ['SLAVariableCost', 'VariableFinancialDashboard', 'FinancialComparisonDashboard']) {
  const source = readFileSync(new URL(`../components/sla/${name}.jsx`, import.meta.url), 'utf8')
  assert(!/spreadsheet|script\.google\.com|fetchSpreadsheet/i.test(source), name)
}
const notification = readFileSync(new URL('./approvalNotificationRepository.js', import.meta.url), 'utf8')
assert(!notification.includes("id: 'variable'"))
assert(!notification.includes("id: 'feeder'"))
assert(isPreviewWriteRpc('save_variable_monthly_actuals'))
const migrations = readdirSync(new URL('../../supabase/migrations/', import.meta.url))
const sql = readFileSync(new URL(`../../supabase/migrations/${migrations.find((name) => name.endsWith('_variable_monthly_direct_input.sql'))}`, import.meta.url), 'utf8')
assert(sql.includes("m.contract_role='ADMIN_ULP'"))
assert(sql.includes('expected_revision'))
assert(sql.includes('variable_cost_monthly_history'))
assert(sql.includes('enable row level security'))
assert(sql.includes('a.realization*price.unit_price'))
assert(sql.includes('p.effective_from<=v_end'))
assert(!/from public\.variable_cost_entries/i.test(sql))
assert(!/from public\.variable_cost_manual_wo/i.test(sql))
console.log('Variable monthly input, completeness, formula, and retirement tests passed')
