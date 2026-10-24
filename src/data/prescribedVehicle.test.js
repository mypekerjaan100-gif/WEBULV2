import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { conditionSnapshot, evaluateCondition, groupVehicleConditions, summarizeFleet } from './ulpConditionDomain.js'

const vehicles = [{ id: 'a', plate_display: 'KB 1234 AA' }, { id: 'b', plate_display: 'KB 5678 BB' }]
const items = [
  { key: 'a:vehicle', kind: 'vehicle', vehicle_id: 'a', required_qty: 1, good_qty: 1, bad_qty: 0 },
  { key: 'a:helm', kind: 'equipment', vehicle_id: 'a', equipment_id: 'helm', category: 'K3', required_qty: 1, good_qty: 0, bad_qty: 1 },
  { key: 'b:vehicle', kind: 'vehicle', vehicle_id: 'b', required_qty: 1, good_qty: 1, bad_qty: 0 },
  { key: 'b:helm', kind: 'equipment', vehicle_id: 'b', equipment_id: 'helm', category: 'K3', required_qty: 1, good_qty: 10, bad_qty: 0 },
]
const grouped = groupVehicleConditions(vehicles, items)
assert.equal(grouped.length, 2)
assert.equal(grouped[0].condition.key, 'a:vehicle')
assert.equal(grouped[0].groups[0][1][0].key, 'a:helm')
assert.equal(grouped[1].groups[0][1][0].key, 'b:helm')
assert.equal(summarizeFleet(vehicles, items).status, 'non_compliant', 'Surplus in vehicle B must not compensate for broken tools in vehicle A')
assert.equal(summarizeFleet(vehicles, items).failed, 1)
assert.equal(summarizeFleet([{ id: 'a', plate_display: '' }], [items[0]]).status, 'draft')
assert.equal(summarizeFleet([{ id: 'a', plate_display: '' }], [items[0]]).missingPlates, 1)
assert.equal(summarizeFleet([], []).status, 'no_assigned_vehicles')
assert.equal(evaluateCondition({ ...items[0], good_qty: 1, bad_qty: 1 }).status, 'invalid')
assert.equal(evaluateCondition({ ...items[0], good_qty: null, bad_qty: 0 }).status, 'invalid')
assert.equal(evaluateCondition({ ...items[0], good_qty: null, bad_qty: null }).status, 'unfilled')
assert.equal(evaluateCondition({ ...items[0], good_qty: 0, bad_qty: 1 }).status, 'non_compliant')
assert.equal(evaluateCondition({ ...items[0], good_qty: 0, bad_qty: 0 }).status, 'non_compliant')
assert.notEqual(conditionSnapshot(items), conditionSnapshot(items.map((item) => item.key === 'a:helm' ? { ...item, good_qty: 1 } : item)))

const sql = readFileSync(new URL('../../supabase/migrations/20261024140225_ops_prescribed_vehicle_monthly.sql', import.meta.url), 'utf8')
for (const table of ['ops_prescribed_vehicles', 'ops_vehicle_monthly_reports', 'ops_vehicle_monthly_history', 'ops_prescribed_vehicle_history']) {
  assert.ok(sql.includes(`create table public.${table}`))
  assert.ok(sql.includes(`alter table public.${table} enable row level security`))
}
const names = ['ops_create_prescribed_vehicles', 'ops_end_prescribed_vehicle', 'ops_list_prescribed_vehicles', 'ops_set_prescribed_vehicle_plate', 'ops_get_vehicle_condition_report', 'ops_save_vehicle_condition_report', 'ops_list_vehicle_condition_overview']
const revoked = sql.match(/revoke all on function[\s\S]+?from public, anon, authenticated, service_role;/)?.[0] || ''
const granted = sql.match(/grant execute on function[\s\S]+?to authenticated;/)?.[0] || ''
for (const name of names) {
  assert.ok(sql.includes(`create function public.${name}(`), name)
  assert.ok(revoked.includes(`${name}(`), `Revoke missing: ${name}`)
  assert.ok(granted.includes(`${name}(`), `Grant missing: ${name}`)
}
assert.ok(sql.includes('references public.ops_equipment_templates(id)'))
assert.ok(sql.includes("v_slot.id || ':' || (v_item ->> 'equipment_id')"))
assert.ok(sql.includes('Only Super Admin or the exact Admin ULP may fill plates'))
assert.ok(sql.includes('public.ops_can_manage_master(p_contract_id, p_up3_id)'))
assert.ok(sql.includes('Report vehicle metadata is pinned'))
assert.ok(sql.includes('Historical nonempty plates are immutable'))
assert.ok(sql.includes('ops_prescribed_registry_guard before insert or update'))
assert.doesNotMatch(sql, /(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?sla_/i)
assert.doesNotMatch(sql, /delete\s+from/i)

const intervals = readFileSync(new URL('../../supabase/migrations/20261024142735_ops_prescribed_plate_intervals.sql', import.meta.url), 'utf8')
assert.ok(intervals.includes('ops_prescribed_vehicles_plate_month_excl exclude using gist'))
assert.ok(intervals.includes("daterange(effective_month, end_month, '[)') with &&"))
assert.ok(intervals.includes('where (plate_normalized is not null)'))
assert.ok(intervals.includes("daterange(s.effective_month, s.end_month, '[)') && daterange(new.effective_month, new.end_month, '[)')"))
assert.ok(intervals.includes('drop constraint ops_prescribed_vehicles_plate_normalized_key'))
assert.ok(intervals.includes('drop constraint ops_prescribed_vehicles_legacy_vehicle_id_key'))
assert.doesNotMatch(intervals, /alter table public\.ops_vehicles/i)
assert.doesNotMatch(intervals, /(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?sla_/i)

const repo = readFileSync(new URL('./ulpConditionRepository.js', import.meta.url), 'utf8')
assert.ok(repo.includes("rpc('ops_set_prescribed_vehicle_plate'"))
assert.ok(repo.includes("rpc('ops_save_vehicle_condition_report'"))
assert.ok(!repo.includes('ops_save_ulp_template'))
const master = readFileSync(new URL('../components/sla/AlatKendaraanMaster.jsx', import.meta.url), 'utf8')
assert.ok(master.includes("const [tab, setTab] = useState('template')"))
assert.ok(!master.includes('UlpStandardsAdmin'))
assert.ok(master.includes('PrescribedFleetAdmin'))
assert.equal((master.match(/\{ id: 'template', label:/g) || []).length, 1)
const component = readFileSync(new URL('../components/sla/UlpConditionReport.jsx', import.meta.url), 'utf8')
assert.ok(component.includes('Simpan Nopol'))
assert.ok(component.includes('groupVehicleConditions(shownVehicles, shownItems)'))
assert.ok(component.includes('vehicleMetadataDirty'))
assert.ok(component.includes('condition.good_qty != null && condition.bad_qty != null'))
console.log('Prescribed vehicle grouping, plate, permissions, snapshot, and no-SLA tests passed')
