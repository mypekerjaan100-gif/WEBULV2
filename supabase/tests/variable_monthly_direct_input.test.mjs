// Isolated Postgres (PGlite), never connected to the application database.
// Usage: node supabase/tests/variable_monthly_direct_input.test.mjs [path to @electric-sql/pglite/dist/index.js]
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite')
const db = new PGlite()
const id = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const contract = id(1, 1), up3 = id(2, 1), ulp1 = id(2, 2), ulp2 = id(2, 3), version = id(3, 1)
const actors = { ulp1: id(4, 1), ulp2: id(4, 2), up3: id(4, 3), manager: id(4, 4), super: id(4, 5), custom: id(4, 6) }
const codes = ['2.1a', '2.1b', '2.1c', '2.1d', '3.1a', '3.1b', '3.2a', '3.2b', 'TEBANG_20_40_CM', 'TEBANG_40_60_CM']
const tebang = ['7e5b0214-f394-4f1e-86ad-2040d1972040', 'b612e8c7-68b6-4ed7-9bba-4060d1974060']
const indicatorIds = codes.map((_, index) => index < 8 ? id(5, index + 1) : tebang[index - 8])
const legacySignatures = [
  'save_variable_cost_entry(uuid,uuid,uuid,uuid,uuid,uuid,date,uuid,text,numeric,numeric,numeric,text,uuid[])',
  'submit_variable_cost_entry(uuid)', 'approve_variable_cost_entry(uuid)', 'reject_variable_cost_entry(uuid,text)',
  'set_variable_manual_wo(uuid,uuid,uuid,date,text,numeric)', 'create_feeder_proposal(uuid,uuid,uuid,text,text)',
  'create_feeder_direct(uuid,uuid,uuid,text,text)', 'approve_feeder(uuid)', 'reject_feeder(uuid,text)',
  'deactivate_feeder(uuid)', 'activate_feeder(uuid)', 'delete_feeder(uuid)', 'get_variable_evidence_upload_path(uuid,text)',
]
const query = async (sql, params = []) => (await db.query(sql, params)).rows
const scalar = async (sql, params = []) => Object.values((await query(sql, params))[0])[0]
let checks = 0
function check(value, expected, label) { assert.deepEqual(value, expected, label); checks++ }
async function fails(action, pattern, label) {
  await assert.rejects(action, pattern, label); checks++
}
async function as(actor, action) {
  await db.exec('reset role')
  await query("select set_config('request.jwt.claim.sub',$1,false)", [actor])
  await db.exec('set role authenticated')
  try { return await action() } finally { await db.exec('reset role') }
}
const values = (code, wo, real, revision = 0) => ({ indicator_code: code, work_order: wo, realization: real, expected_revision: revision })
async function save(batch, unit = ulp1, month = '2026-10-01', versionId = version) {
  return scalar('select public.save_variable_monthly_actuals($1,$2,$3,$4,$5,$6::jsonb)', [contract, up3, unit, versionId, month, JSON.stringify(batch)])
}
async function financial(unit = ulp1) {
  return scalar('select public.get_variable_financial_dashboard($1,$2,$3,$4)', [contract, up3, '2026-10-01', unit])
}

try {
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    create table public.contracts(id uuid primary key,status text);
    create table public.organization_units(id uuid primary key,parent_id uuid,type text,own_status text);
    create table public.contract_up3_scopes(contract_id uuid,up3_id uuid,status text);
    create table public.contract_memberships(user_id uuid,contract_id uuid,contract_role text,operational_up3_id uuid,operational_unit_id uuid,status text,effective_from date,effective_to date);
    create table public.sla_versions(id uuid primary key,contract_id uuid,up3_id uuid,status text,period_start date,period_end date);
    create table public.sla_indicators(id uuid primary key,sla_version_id uuid,point_code text,legacy_key text,input_mode text,variable_cost_profile text,measurement_unit text);
    create table public.sla_targets(contract_id uuid,up3_id uuid,unit_id uuid,sla_version_id uuid,indicator_id uuid,period_month date,target_scope text,target_value numeric);
    create table public.sla_entries(id uuid primary key default gen_random_uuid(),contract_id uuid,up3_id uuid,unit_id uuid,sla_version_id uuid,indicator_id uuid,period_month date,source_type text,measurement_unit text,target_value numeric,work_order numeric,realization numeric,achievement numeric,penalty_value numeric,created_by uuid,updated_by uuid,
      unique(contract_id,up3_id,unit_id,sla_version_id,indicator_id,period_month));
    grant select on public.sla_entries to authenticated;
    create table public.variable_cost_entries(id uuid primary key,unit_id uuid,indicator_id uuid,realization numeric,status text);
    create table public.variable_cost_manual_wo(id uuid primary key,wo_value numeric);
    create table public.feeders(id uuid primary key);
    create table public.variable_cost_entry_personnel(id uuid primary key);
    create table public.variable_cost_evidence(id uuid primary key);
    create table public.variable_cost_status_history(id uuid primary key);
    create table public.variable_unit_prices(contract_id uuid,operational_up3_id uuid,indicator_id uuid,unit_price numeric,effective_from date);
    create table public.variable_revenue_targets(contract_id uuid,operational_up3_id uuid,operational_unit_id uuid,indicator_id uuid,period_month date,target_amount numeric);
    create table public.variable_cost_konstruksi_monthly_amounts(id uuid primary key default gen_random_uuid(),contract_id uuid,up3_id uuid,unit_id uuid,indicator_id uuid,period_month date,amount_rp numeric);
    create table public.variable_cost_konstruksi_monthly_targets(contract_id uuid,up3_id uuid,unit_id uuid,indicator_id uuid,period_month date,target_rp numeric);
    create table public.overtime_activities(id uuid primary key,contract_id uuid,up3_id uuid,unit_id uuid,period_month date,status text,deleted_at timestamptz,type text,work_category text);
    create table public.overtime_entries(activity_id uuid,approval_status text,calculated_amount_snapshot numeric);
    create function public.auth_is_super_admin() returns boolean language sql stable as $$ select auth.uid()='${actors.super}'::uuid $$;
    create function public.auth_has_financial_analysis_scope(uuid,uuid,uuid) returns boolean language sql stable as $$ select auth.uid()='${actors.manager}'::uuid $$;
    create function public.auth_can_manage_up3_operations(uuid,uuid) returns boolean language sql stable as $$ select auth.uid() in ('${actors.up3}'::uuid,'${actors.manager}'::uuid,'${actors.super}'::uuid) $$;
    create function public.auth_can_manage_pelayanan_teknik_scope(uuid,uuid,uuid) returns boolean language sql stable as $$ select public.auth_can_manage_up3_operations($1,$2) $$;
    create function public.auth_can_access_variable_scope(uuid,uuid,uuid) returns boolean language sql stable security definer set search_path='' as $$
      select public.auth_can_manage_up3_operations($1,$2) or exists(select 1 from public.contract_memberships m where m.user_id=auth.uid() and m.contract_id=$1 and m.operational_up3_id=$2 and m.operational_unit_id=$3)
    $$;
    grant usage on schema public to authenticated,anon,service_role;
    insert into public.contracts values('${contract}','active');
    insert into public.organization_units values('${up3}',null,'UP3','Aktif'),('${ulp1}','${up3}','ULP','Aktif'),('${ulp2}','${up3}','ULP','Aktif');
    insert into public.contract_up3_scopes values('${contract}','${up3}','Aktif');
    insert into public.sla_versions values('${version}','${contract}','${up3}','ACTIVE','2026-01-01','2026-12-31');
    insert into public.variable_cost_entries values('${id(9, 1)}','${ulp1}','${indicatorIds[0]}',99999,'APPROVED');
    insert into public.variable_cost_manual_wo values('${id(9, 2)}',66);
  `)
  for (const signature of legacySignatures) await db.exec(`create function public.${signature} returns void language sql as $$ select $$; grant execute on function public.${signature} to authenticated;`)
  for (const [name, actor] of Object.entries(actors)) {
    await query('insert into auth.users values($1)', [actor])
    if (['ulp1', 'ulp2', 'up3', 'custom'].includes(name)) await query('insert into public.contract_memberships values($1,$2,$3,$4,$5,$6,$7,null)', [actor, contract, name === 'up3' ? 'ADMIN_UP3' : name === 'custom' ? 'CUSTOM' : 'ADMIN_ULP', up3, name === 'ulp2' ? ulp2 : name === 'up3' ? null : ulp1, 'ACTIVE', '2026-01-01'])
  }
  for (let index = 0; index < 9; index++) await query('insert into public.sla_indicators values($1,$2,$3,$4,$5,$6,$7)', [id(5, index + 1), version, index < 8 ? codes[index] : '3.1c', `A-${index < 8 ? codes[index] : '3.1c'}`, 'VARIABLE_COST', index < 8 ? 'STANDARD' : 'KONSTRUKSI', index < 8 ? 'buah' : 'Rp'])
  for (const unit of [ulp1, ulp2]) {
    for (let index = 0; index < 8; index++) await query("insert into public.sla_targets values($1,$2,$3,$4,$5,'2026-10-01','ULP',100)", [contract, up3, unit, version, indicatorIds[index]])
    for (const [index, code] of codes.entries()) if (code !== '3.1a') await query("insert into public.variable_revenue_targets values($1,$2,$3,$4,'2026-10-01',1000)", [contract, up3, unit, indicatorIds[index]])
    await query("insert into public.variable_cost_konstruksi_monthly_targets values($1,$2,$3,$4,'2026-10-01',300)", [contract, up3, unit, id(5, 9)])
  }
  for (const [index, code] of codes.entries()) if (code !== '3.1a') for (const [date, price] of [['2026-10-01', 10], ['2026-10-20', 20], ['2026-11-01', 99]]) await query('insert into public.variable_unit_prices values($1,$2,$3,$4,$5)', [contract, up3, indicatorIds[index], price, date])
  await query("insert into public.variable_cost_konstruksi_monthly_amounts(contract_id,up3_id,unit_id,indicator_id,period_month,amount_rp) values($1,$2,$3,$4,'2026-10-01',100)", [contract, up3, ulp1, id(5, 9)])
  for (const [i, deleted, approval, amount] of [[1, false, 'APPROVED', 500], [2, true, 'APPROVED', 900], [3, false, 'SUBMITTED', 400]]) {
    await query("insert into public.overtime_activities values($1,$2,$3,$4,'2026-10-01','APPROVED',$5,'WORK','ROW')", [id(8, i), contract, up3, ulp1, deleted ? new Date().toISOString() : null])
    await query('insert into public.overtime_entries values($1,$2,$3)', [id(8, i), approval, amount])
  }
  const migrations = new URL('../migrations/', import.meta.url)
  const migration = readdirSync(migrations).find((name) => name.endsWith('_variable_monthly_direct_input.sql'))
  await db.exec(readFileSync(new URL(migration, migrations), 'utf8'))
  await db.exec(readFileSync(new URL('20260904035118_financial_comparison_trend.sql', migrations), 'utf8'))

  check(await scalar('select count(*)::int from public.variable_cost_monthly_actuals'), 0, 'No data import')
  check(await scalar('select count(*)::int from public.variable_cost_entries'), 1, 'Legacy entries preserved')
  check(Number(await scalar('select wo_value from public.variable_cost_manual_wo')), 66, 'Legacy WO preserved')
  await as(actors.ulp1, async () => {
    check(await save([values('2.1a', null, null)]), 0, 'Untouched blank creates no row')
    check(await save([values('2.1a', 80, 40)]), 1, 'Monthly save immediately active')
    check(Number(await scalar('select achievement from public.sla_entries')), 50, 'SLA achievement formula')
    check(await save([values('2.1a', 80, 40, 1)]), 0, 'Unchanged save is idempotent')
    check(await scalar('select count(*)::int from public.variable_cost_monthly_history'), 1, 'No duplicate audit')
    await fails(() => save([values('2.1a', 90, 60, 0)]), /sesi lain/, 'Optimistic revision conflict')
    await fails(() => save([values('2.1b', 5, 3), values('3.1c', 1, 1)]), /tidak valid/, 'Konstruksi excluded')
    check(await scalar('select count(*)::int from public.variable_cost_monthly_actuals'), 1, 'Batch rolled back in full')
    await fails(() => save([values('2.1b', -1, 0)]), /angka nol/, 'Reject negative')
    await fails(() => save([values('2.1b', 1.00001, 0)]), /desimal/, 'Reject overprecision')
    await fails(() => save([values('2.1b', '1', 0)]), /tipe/, 'Reject numeric strings')
    await fails(() => save([values('2.1b', 0, 0), values('2.1b', 1, 1)]), /Duplicate/, 'Reject duplicate indicators')
    await fails(() => save([values('2.1b', 0, 0)], ulp2), /Admin ULP/, 'Deny cross-unit writes')
    await fails(() => save([values('2.1b', 0, 0)], ulp1, '2026-10-02'), /first day/, 'Reject non-month date')
    await fails(() => save([values('2.1b', 0, 0)], ulp1, '2027-01-01'), /versi SLA/, 'Reject out-of-version period')
    await fails(() => save([values('2.1b', 0, 0)], ulp1, '2026-10-01', id(3, 999)), /versi SLA/, 'Reject unknown version')
    await fails(() => db.exec('update public.variable_cost_monthly_actuals set realization=999'), /permission denied/, 'RPC-only writes')
    await fails(() => db.exec('delete from public.variable_cost_monthly_history'), /permission denied/, 'Audit is immutable')
    await fails(() => scalar('select count(*) from public.list_variable_monthly_actuals($1,$2,$3,$4)', [contract, up3, '2026-10-01', ulp2]), /Not authorized/, 'Deny foreign reads')
    check(await save([values('3.1a', 10, 7), values('TEBANG_20_40_CM', 6, 2), values('TEBANG_40_60_CM', null, 0)]), 3, 'ROW and both Tebang are accepted')
    check(await scalar('select count(*)::int from public.sla_entries'), 2, 'Only canonical SLA indicators are synchronized')
  })
  for (const name of ['up3', 'manager', 'super', 'custom']) await as(actors[name], () => fails(() => save([values('2.1b', 0, 0)]), /Admin ULP/, `${name} cannot edit ULP actuals`))
  await as(actors.ulp2, () => save([values('2.1b', 0, 0)], ulp2))
  await as(actors.ulp1, async () => {
    check(await scalar('select count(*)::int from public.variable_cost_monthly_actuals'), 4, 'RLS hides other ULP actuals')
    check(await scalar('select count(*)::int from public.list_variable_monthly_actuals($1,$2,$3,null)', [contract, up3, '2026-10-01']), 4, 'Unscoped RPC is still unit-filtered')
    check(await scalar('select count(*)::int from public.variable_cost_monthly_history where unit_id=$1', [ulp2]), 0, 'RLS hides other ULP history')
  })
  await as(actors.up3, async () => {
    const f = await financial()
    check(Number(f.summary.actual_amount), 940, '40×20 + 2×20 + 0×20 + Konstruksi 100, no ROW/legacy double-count')
    check(Number(f.summary.missing_actual_count), 6, 'Blank actuals remain missing')
    check(f.summary.difference_amount, null, 'Missing actuals block final comparison')
    const revenue = await query('select * from public.list_variable_actual_revenue($1,$2,$3,$4)', [contract, up3, '2026-10-01', ulp1])
    check(revenue.length, 10, 'Exactly nine billable quantities and Konstruksi')
    check(Number(revenue.find((row) => row.indicator_id === indicatorIds[0]).unit_price), 20, 'Price at month-end, not first day or future month')
    check(revenue.find((row) => row.indicator_id === indicatorIds[1]).revenue_amount, null, 'No-data revenue is NULL')
  })
  await query('update public.sla_targets set target_value=40 where unit_id=$1 and indicator_id=$2', [ulp1, indicatorIds[0]])
  check(Number(await scalar('select achievement from public.sla_entries where unit_id=$1 and indicator_id=$2', [ulp1, indicatorIds[0]])), 100, 'Target edit resynchronizes SLA')
  await as(actors.ulp1, async () => {
    check(await save([values('2.1a', 80, 0, 1)]), 1, 'Explicit zero remains valid')
    check(Number(await scalar('select achievement from public.sla_entries where indicator_id=$1', [indicatorIds[0]])), 0, 'Explicit zero is 0%')
    check(await save([values('2.1a', null, null, 2)]), 1, 'Clear both fields')
    check(await scalar('select count(*)::int from public.sla_entries where indicator_id=$1', [indicatorIds[0]]), 0, 'Clearing removes derived SLA row')
    check(await scalar('select count(*)::int from public.variable_cost_monthly_history where indicator_code=$1', ['2.1a']), 3, 'Clearing remains in audit history')
    const current = await query('select indicator_code,revision from public.variable_cost_monthly_actuals')
    await save(codes.map((code) => values(code, 0, 0, current.find((row) => row.indicator_code === code)?.revision ?? 0)))
  })
  await as(actors.ulp2, async () => {
    const current = await query('select indicator_code,revision from public.variable_cost_monthly_actuals')
    await save(codes.map((code) => values(code, 0, 0, current.find((row) => row.indicator_code === code)?.revision ?? 0)), ulp2)
  })
  await query("insert into public.variable_cost_konstruksi_monthly_amounts(contract_id,up3_id,unit_id,indicator_id,period_month,amount_rp) values($1,$2,$3,$4,'2026-10-01',0)", [contract, up3, ulp2, id(5, 9)])
  check(await scalar('select count(*)::int from public.sla_entries'), 16, 'Exactly 8 SLA entries per ULP, no Tebang/Konstruksi aggregates')
  await as(actors.manager, async () => {
    const f = await financial(null)
    check(Number(f.summary.missing_actual_count), 0, 'All explicit zero entries are complete')
    check(Number(f.summary.actual_amount), 100, 'Only Konstruksi revenue after zero quantities')
    check(Number(f.summary.difference_amount), -18500, 'Final difference across both ULPs')
    const trend = await scalar('select public.get_variable_financial_trend($1,$2,$3,null,6)', [contract, up3, '2026-10-01'])
    check(Number(trend.months.at(-1).actual_amount), Number(f.summary.actual_amount), 'Trend equals snapshot')
    const comparison = await scalar('select public.get_financial_comparison_dashboard($1,$2,$3,null)', [contract, up3, '2026-10-01'])
    check(Number(comparison.summary.revenue_amount), Number(f.summary.actual_amount), 'Both financial dashboards agree')
    check(Number(comparison.summary.cost_amount), 500, 'Only approved, undeleted ROW participant cost')
    check(Number(comparison.summary.margin_amount), -400, 'Comparison margin')
    const comparisonTrend = await scalar('select public.get_financial_comparison_trend($1,$2,$3,null,6)', [contract, up3, '2026-10-01'])
    check(comparisonTrend.at(-1).revenue_eligible_components.reduce((sum, row) => sum + Number(row.amount), 0), 100, 'Comparison trend agrees')
  })
  await query('delete from public.variable_unit_prices where indicator_id=$1', [indicatorIds[0]])
  await as(actors.up3, async () => {
    const f = await financial()
    check(Number(f.summary.missing_price_count), 1, 'Missing price is explicit, even for zero quantities')
    check(f.summary.difference_amount, null, 'Missing price blocks final difference')
  })
  for (const signature of legacySignatures) check(await scalar("select has_function_privilege('authenticated',$1,'execute')", [`public.${signature}`]), false, `Retired RPC locked: ${signature}`)
  await db.exec('set role anon')
  await fails(() => save([values('2.1b', 0, 0)]), /permission denied/, 'Anonymous RPC denied')
  await fails(() => db.exec('select * from public.variable_cost_monthly_actuals'), /permission denied/, 'Anonymous table read denied')
  await db.exec('reset role')
  check(await scalar('select count(*)::int from public.variable_cost_entries'), 1, 'Legacy data still untouched after all operations')
  const beforeSmoke = await scalar('select count(*)::int from public.variable_cost_monthly_history')
  await db.exec(readFileSync(new URL('./variable_monthly_live_smoke.sql', import.meta.url), 'utf8'))
  check(await scalar('select count(*)::int from public.variable_cost_monthly_history'), beforeSmoke, 'Live smoke script is valid and rolls all test writes back')
  console.log(`Variable monthly Postgres integration tests passed: ${checks}`)
} catch (error) {
  console.error('Postgres integration test failed:', error.message, error.query ?? '', error.where ?? '')
  process.exitCode = 1
} finally {
  await db.close()
}
