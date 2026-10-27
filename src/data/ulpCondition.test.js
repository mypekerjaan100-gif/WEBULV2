import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { conditionSnapshot, evaluateCondition, parseConditionCount, summarizeConditions, groupConditionItems } from './ulpConditionDomain.js'

assert.equal(parseConditionCount(''), null)
assert.equal(parseConditionCount(null), null)
assert.equal(parseConditionCount('0'), 0)
assert.equal(parseConditionCount(' 12 '), 12)
for (const invalid of ['-1', '1.5', '1e2', 'abc', '2147483648', Infinity]) assert.ok(Number.isNaN(parseConditionCount(invalid)))
const item = { key: 'equipment:a', category: 'K3', required_qty: 2, good_qty: 2, bad_qty: 0 }
assert.deepEqual(evaluateCondition(item), { status: 'compliant', available: 2, percentage: 100 })
assert.equal(evaluateCondition({ ...item, good_qty: null }).status, 'unfilled')
assert.equal(evaluateCondition({ ...item, bad_qty: '' }).status, 'unfilled')
assert.equal(evaluateCondition({ ...item, good_qty: '1.5' }).status, 'invalid')
assert.equal(evaluateCondition({ ...item, good_qty: 1, bad_qty: 1 }).percentage, 50)
assert.equal(evaluateCondition({ ...item, good_qty: 1, bad_qty: 0 }).status, 'invalid', 'Jumlah kurang dari kontrak harus ditolak')
assert.equal(evaluateCondition({ ...item, required_qty: 3, good_qty: 2, bad_qty: 1 }).status, 'non_compliant', 'Kerusakan tetap gagal meski jumlah baik mencukupi')
assert.equal(evaluateCondition({ ...item, good_qty: 2, bad_qty: 0 }).percentage, 100)
assert.equal(evaluateCondition({ ...item, good_qty: 0, bad_qty: 2 }).status, 'non_compliant')
assert.equal(summarizeConditions([item]).status, 'compliant')
assert.equal(summarizeConditions([item, { ...item, good_qty: 1, bad_qty: 1 }]).status, 'non_compliant')
assert.equal(summarizeConditions([item, { ...item, good_qty: '', bad_qty: 1 }]).status, 'draft')
assert.equal(summarizeConditions([]).status, 'draft')
assert.equal(summarizeConditions([item, { ...item, good_qty: 1, bad_qty: 1 }]).failed, 1)
assert.equal(groupConditionItems([item, { ...item, key: 'vehicle:b', category: 'Kendaraan' }]).length, 2)
assert.equal(conditionSnapshot([{ ...item, good_qty: null }]), conditionSnapshot([{ ...item, good_qty: '' }]))

const sql = readFileSync(new URL('../../supabase/migrations/20261024125408_ops_ulp_condition_reports.sql', import.meta.url), 'utf8')
for (const table of ['ops_ulp_templates', 'ops_ulp_template_assignments', 'ops_ulp_condition_reports', 'ops_ulp_condition_history']) {
  assert.ok(sql.includes(`create table public.${table}`))
  assert.ok(sql.includes(`alter table public.${table} enable row level security`))
}
for (const rpc of ['ops_list_ulp_templates', 'ops_save_ulp_template', 'ops_publish_ulp_template', 'ops_assign_ulp_template', 'ops_get_ulp_condition_report', 'ops_save_ulp_condition_report', 'ops_list_ulp_condition_overview']) {
  assert.ok(sql.includes(`create function public.${rpc}(`))
  const revoked = sql.match(new RegExp(`revoke all on function public\\.${rpc}\\([^;]+from ([^;]+);`))?.[1].split(',').map((role) => role.trim()) || []
  assert.ok(['public', 'anon', 'authenticated', 'service_role'].every((role) => revoked.includes(role)), `Missing ACL revocation: ${rpc}`)
  assert.ok(new RegExp(`grant execute on function public\\.${rpc}\\([^;]+to authenticated`).test(sql), `Missing authenticated RPC grant: ${rpc}`)
}
assert.ok(sql.includes('v_bad > 0 or v_good <'))
assert.ok(sql.includes('v_report.revision, 0) is distinct from p_expected_revision'))
assert.ok(sql.includes('Existing report template is pinned'))
assert.ok(sql.includes('jsonb_array_length(p_items) <> jsonb_array_length(v_template.items)'))
assert.ok(sql.includes('pg_advisory_xact_lock'))
assert.ok(sql.includes('history is append-only'))
assert.doesNotMatch(sql, /(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?sla_/i)
assert.doesNotMatch(sql, /delete\s+from/i)

const component = readFileSync(new URL('../components/sla/UlpConditionReport.jsx', import.meta.url), 'utf8')
assert.ok(component.includes('good_qty') && component.includes('bad_qty'))
assert.ok(component.includes('Simpan Rekap'))
assert.ok(component.includes('Tidak ada sinkronisasi indikator atau denda SLA'))
assert.ok(component.includes('onEditorStateChange'))
assert.ok(component.includes('saveLock.current'))
assert.ok(component.includes('token !== request.current'))
assert.ok(component.includes('Kendaraan belum ditetapkan'))
console.log('ULP condition domain, isolation, migration, and UI contract tests passed')
