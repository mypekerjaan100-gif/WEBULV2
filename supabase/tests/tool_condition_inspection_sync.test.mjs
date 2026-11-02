import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite')
const db = new PGlite()
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const [contract,up3,ulp,vehicle,equipment,actor,asset] = [1,2,3,4,5,6,7].map(id)
const scope=[contract,up3,ulp]
const query=async(sql,params=[]) => (await db.query(sql,params)).rows
const report=async(month) => (await query('select public.ops_get_vehicle_condition_report($1,$2,$3,$4) value',[...scope,month]))[0].value
const tool=b=>b.items.find(i=>i.kind==='equipment')
const coverage=b=>b.inspection_summary[0]
let checks=0
function check(actual,expected){assert.deepEqual(actual,expected);checks++}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select '${actor}'::uuid$$;
    create table public.organization_units(id uuid,type text,parent_id uuid,sort_order integer,legacy_key text);
    insert into public.organization_units values('${ulp}','ULP','${up3}',1,'ulp-1');
    create table public.ops_tool_assets(id uuid,contract_id uuid,up3_id uuid,ulp_id uuid,slot_id uuid,equipment_id uuid,commissioned_at timestamptz,replaced_at timestamptz);
    create table public.ops_tool_inspections(asset_id uuid,inspected_at timestamptz);
    create table public.ops_tool_issues(contract_id uuid,up3_id uuid,ulp_id uuid,slot_id uuid,equipment_id uuid,opened_at timestamptz,resolved_at timestamptz,status text default 'OPEN',replacement_asset_id uuid);
    create table public.ops_vehicle_monthly_reports(id uuid default gen_random_uuid(),contract_id uuid,up3_id uuid,ulp_id uuid,period_month date,revision integer default 1,vehicles jsonb,items jsonb,status text,created_by uuid,updated_by uuid);
    create table public.fixture(bundle jsonb);
    create function public.ops_prescribed_assert_scope(uuid,uuid,uuid) returns void language plpgsql as $$begin if $1<>'${contract}'::uuid or $2<>'${up3}'::uuid or ($3 is not null and $3<>'${ulp}'::uuid) then raise exception 'Scope denied';end if;end$$;
    create function public.ops_vehicle_can_report(uuid,uuid,uuid) returns boolean language sql as $$select true$$;
    create function public.ops_business_today() returns date language sql as $$select '2026-12-15'::date$$;
    create function public.ops_get_vehicle_condition_report(p_contract_id uuid,p_up3_id uuid,p_ulp_id uuid,p_period_month date) returns jsonb language plpgsql stable as $$declare r public.ops_vehicle_monthly_reports;begin
      perform public.ops_prescribed_assert_scope(p_contract_id,p_up3_id,p_ulp_id);
      if p_period_month is null or extract(day from p_period_month)<>1 then raise exception 'Invalid month';end if;
      select * into r from public.ops_vehicle_monthly_reports where period_month=p_period_month;
      if found then return jsonb_build_object('report',to_jsonb(r),'vehicles',r.vehicles,'items',r.items,'history','[]'::jsonb);end if;
      return (select bundle from public.fixture);end$$;`)
  const items=[{key:`${vehicle}:vehicle`,vehicle_id:vehicle,kind:'vehicle',required_qty:1,good_qty:null,bad_qty:null,status:'unfilled'},
    {key:`${vehicle}:${equipment}`,vehicle_id:vehicle,equipment_id:equipment,kind:'equipment',name:'Teropong',required_qty:1,good_qty:null,bad_qty:null,note:'keep note',status:'unfilled'}]
  const fixture={report:null,vehicles:[{id:vehicle,plate_display:'KB 1',plate_normalized:'KB1'}],items,history:[]}
  await query('insert into public.fixture values($1)',[JSON.stringify(fixture)])
  await query('insert into public.ops_tool_assets values($1,$2,$3,$4,$5,$6,null,null)',[asset,...scope,vehicle,equipment])
  const source=readFileSync(new URL('../migrations/20261028102000_ops_vehicle_condition_reports_restore.sql',import.meta.url),'utf8')
  await db.exec(source.slice(source.indexOf('create or replace function public.ops_save_vehicle_condition_report('),source.indexOf('create or replace function public.ops_save_vehicle_condition_subset(')))
  await db.exec(readFileSync(new URL('../migrations/20261102024519_tool_condition_inspection_sync.sql',import.meta.url),'utf8'))
  await db.exec(readFileSync(new URL('../migrations/20261102075127_handover_verifies_tool_unit.sql',import.meta.url),'utf8'))
  let b=await report('2026-10-01')
  check([tool(b).good_qty,tool(b).bad_qty,coverage(b).uninspected],[1,0,1])
  await query('insert into public.ops_tool_inspections values($1,$2),($1,$3)',[asset,'2026-10-09T02:24:00Z','2026-10-10T02:24:00Z'])
  await query('insert into public.ops_tool_issues values($1,$2,$3,$4,$5,$6,null)',[...scope,vehicle,equipment,'2026-10-09T02:24:00Z'])
  b=await report('2026-10-01')
  check([tool(b).good_qty,tool(b).bad_qty,Number(tool(b).percentage),b.effective_status],[0,1,0,'non_compliant'])
  check([coverage(b).inspected,coverage(b).uninspected],[1,0])
  check(tool(b).note,'keep note')
  b=await report('2026-11-01')
  check([tool(b).bad_qty,coverage(b).inspected,coverage(b).uninspected,coverage(b).open_issues],[1,0,1,1])
  check(tool(await report('2026-09-01')).bad_qty,0)
  const overview=(await query('select public.ops_list_vehicle_condition_overview($1,$2,$3) value',[contract,up3,'2026-10-01']))[0].value
  check(overview[0].report_status,'non_compliant')
  check(overview[0].failed_count,1)
  // Submitted manual quantities cannot hide an inspection finding.
  const manual=items.map(i=>({key:i.key,good_qty:1,bad_qty:0,note:i.note??''}))
  b=(await query('select public.ops_save_vehicle_condition_report($1,$2,$3,$4,0,$5) value',[...scope,'2026-10-01',JSON.stringify(manual)]))[0].value
  check([tool(b).good_qty,tool(b).bad_qty],[0,1])
  const frozen=JSON.stringify((await query('select items from public.ops_vehicle_monthly_reports'))[0].items)
  // November handover verifies the replacement unit in November, not October.
  await query('update public.ops_tool_issues set resolved_at=$1,status=$2,replacement_asset_id=$3',['2026-11-02T02:00:00Z','RESOLVED',id(8)])
  await query('update public.ops_tool_assets set replaced_at=$1 where id=$2',['2026-11-02T02:00:00Z',asset])
  await query('insert into public.ops_tool_assets values($1,$2,$3,$4,$5,$6,$7,null)',[id(8),...scope,vehicle,equipment,'2026-11-02T02:00:00Z'])
  b=await report('2026-11-01')
  check([tool(b).good_qty,tool(b).bad_qty,coverage(b).inspected,coverage(b).uninspected],[1,0,1,0])
  check(tool(await report('2026-10-01')).bad_qty,1)
  check(JSON.stringify((await query('select items from public.ops_vehicle_monthly_reports'))[0].items),frozen)
  // Handover is a verification for its own month; next month needs a new check.
  check(coverage(await report('2026-12-01')).uninspected,1)
  // Pontianak month boundary: Nov 1 00:00 WIB is not October.
  await query('update public.ops_tool_issues set resolved_at=$1',['2026-10-31T17:00:00Z'])
  check(tool(await report('2026-10-01')).bad_qty,1)
  await assert.rejects(()=>report('2026-10-02'),/Invalid month/)
  check((await query("select has_function_privilege('authenticated','public.ops_get_vehicle_condition_report_snapshot(uuid,uuid,uuid,date)','execute') allowed"))[0].allowed,false)
  check((await query("select has_function_privilege('anon','public.ops_get_vehicle_condition_report(uuid,uuid,uuid,date)','execute') allowed"))[0].allowed,false)
  console.log(`Tool inspection monthly sync integration checks passed: ${checks}`)
} catch(error){ console.error(error.message,error.where??'');process.exitCode=1 } finally{await db.close()}
