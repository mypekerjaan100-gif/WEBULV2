import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite')
const db = new PGlite()
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [contract, up3, ulp, slotOne, equipmentOne, slotTwo, equipmentTwo, actor] = [1, 2, 3, 4, 5, 6, 7, 8].map(id)
const scope = [contract, up3, ulp]
const query = async (sql, params = []) => (await db.query(sql, params)).rows
let checks = 0
function check(actual, expected) {
  assert.deepEqual(actual, expected)
  checks += 1
}

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select '${actor}'::uuid$$;
    create table public.ops_tool_assets (
      id uuid primary key default gen_random_uuid(),
      contract_id uuid not null,
      up3_id uuid not null,
      ulp_id uuid not null,
      slot_id uuid not null,
      equipment_id uuid not null,
      equipment_code text not null default '',
      equipment_name text not null,
      equipment_category text not null default '',
      equipment_unit text not null default 'unit',
      specification text not null default '',
      asset_sequence integer not null check (asset_sequence > 0),
      useful_life_months integer,
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REPLACED')),
      commissioned_at timestamptz,
      commissioned_by uuid,
      replaced_at timestamptz,
      replaced_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      created_by uuid,
      updated_by uuid,
      constraint ops_tool_assets_slot_id_equipment_id_asset_sequence_key
        unique (slot_id, equipment_id, asset_sequence)
    );
    create table public.ops_tool_issues (
      id uuid primary key,
      asset_id uuid not null,
      contract_id uuid not null,
      up3_id uuid not null,
      ulp_id uuid not null,
      slot_id uuid not null,
      equipment_id uuid not null,
      status text not null default 'OPEN',
      opened_at timestamptz not null,
      opened_by uuid not null,
      note text not null default '',
      age_at_failure_months integer,
      standard_life_months integer,
      damaged_before_life boolean,
      resolved_at timestamptz,
      resolved_by uuid,
      resolution_note text,
      handover_photo_paths jsonb,
      replacement_asset_id uuid,
      revision integer not null default 1,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create function public.ops_tool_can_resolve_scope(uuid, uuid, uuid) returns boolean
      language sql stable as $$select true$$;
    create function public.ops_validate_tool_photo_paths(uuid, uuid, uuid, jsonb) returns void
      language plpgsql as $$begin return; end$$;
    create function public.ops_tool_age_months(timestamptz, timestamptz) returns integer
      language sql immutable as $$select 1$$;
    create function public.ops_tool_assets_guard() returns trigger language plpgsql as $$
    begin
      if (to_jsonb(new) - array['status','replaced_at','replaced_by','updated_at','updated_by'])
        is distinct from (to_jsonb(old) - array['status','replaced_at','replaced_by','updated_at','updated_by']) then
        raise exception 'Tool identity, scope, and commissioning date are immutable';
      end if;
      new.updated_at := now();
      new.updated_by := auth.uid();
      return new;
    end$$;
    create trigger trg_ops_tool_assets_guard before update on public.ops_tool_assets
      for each row execute function public.ops_tool_assets_guard();
  `)

  await query(
    `insert into public.ops_tool_assets
      (id, contract_id, up3_id, ulp_id, slot_id, equipment_id, equipment_name, asset_sequence, status,
       commissioned_at, replaced_at, replaced_by, created_by, updated_by)
     values
      ($1,$7,$8,$9,$10,$11,'Teropong',1,'REPLACED',null,$14,$6,$6,$6),
      ($2,$7,$8,$9,$10,$11,'Teropong',2,'ACTIVE',$14,null,null,$6,$6),
      ($3,$7,$8,$9,$12,$13,'Multimeter',1,'ACTIVE',null,null,null,$6,$6),
      ($4,$7,$8,$9,$12,$13,'Multimeter',2,'REPLACED',null,$14,$6,$6,$6),
      ($5,$7,$8,$9,$12,$13,'Multimeter',3,'ACTIVE',$14,null,null,$6,$6)`,
    [id(10), id(11), id(12), id(13), id(14), actor, ...scope, slotOne, equipmentOne, slotTwo, equipmentTwo, '2026-10-30T02:00:00Z'],
  )

  await query(
    `insert into public.ops_tool_issues
      (id, asset_id, contract_id, up3_id, ulp_id, slot_id, equipment_id, status, opened_at, opened_by)
     values
      ($1,$4,$8,$9,$10,$11,$12,'OPEN','2026-10-09T02:24:00Z',$7),
      ($2,$5,$8,$9,$10,$13,$14,'OPEN','2026-10-10T02:24:00Z',$7),
      ($3,$6,$8,$9,$10,$13,$14,'OPEN','2026-10-11T02:24:00Z',$7)`,
    [id(20), id(21), id(22), id(11), id(12), id(14), actor, ...scope, slotOne, equipmentOne, slotTwo, equipmentTwo],
  )

  const before = await query(
    `select slot_id, array_agg(asset_sequence order by asset_sequence) positions
     from public.ops_tool_assets where status='ACTIVE' group by slot_id order by slot_id`,
  )
  check(before.map((row) => row.positions), [[2], [1, 3]])

  await db.exec(readFileSync(new URL('../migrations/20261102031600_stable_tool_unit_numbers.sql', import.meta.url), 'utf8'))

  const after = await query(
    `select slot_id, array_agg(asset_sequence order by asset_sequence) positions
     from public.ops_tool_assets where status='ACTIVE' group by slot_id order by slot_id`,
  )
  check(after.map((row) => row.positions), [[1], [1, 2]])

  const history = await query(
    `select asset_sequence, status from public.ops_tool_assets
     where slot_id=$1 order by asset_sequence, status`,
    [slotTwo],
  )
  check(history.map((row) => [row.asset_sequence, row.status]), [[1, 'ACTIVE'], [2, 'ACTIVE'], [2, 'REPLACED']])

  const trigger = await query("select tgenabled from pg_trigger where tgname='trg_ops_tool_assets_guard'")
  check(trigger[0].tgenabled, 'O')
  await assert.rejects(
    () => db.exec(`update public.ops_tool_assets set asset_sequence=9 where id='${id(11)}'`),
    /immutable/,
  )

  await assert.rejects(
    () => query(
      `insert into public.ops_tool_assets (contract_id, up3_id, ulp_id, slot_id, equipment_id, equipment_name, asset_sequence, status, created_by, updated_by)
       values ($1,$2,$3,$4,$5,'Teropong',1,'ACTIVE',$6,$6)`,
      [...scope, slotOne, equipmentOne, actor],
    ),
    /duplicate key|unique/i,
  )

  const resolvedAt = new Date(Date.now() - 60_000).toISOString()
  const first = (await query(
    'select public.ops_resolve_tool_issue($1,$2,$3,$4,$5) result',
    [id(20), resolvedAt, 'Serah terima', JSON.stringify(['photo.png']), 1],
  ))[0].result
  check(first.replacement_asset.asset_sequence, 1)
  const firstActive = await query(
    "select array_agg(asset_sequence order by asset_sequence) positions from public.ops_tool_assets where slot_id=$1 and equipment_id=$2 and status='ACTIVE'",
    [slotOne, equipmentOne],
  )
  check(firstActive[0].positions, [1])

  const second = (await query(
    'select public.ops_resolve_tool_issue($1,$2,$3,$4,$5) result',
    [id(21), resolvedAt, 'Serah terima', JSON.stringify(['photo.png']), 1],
  ))[0].result
  check(second.replacement_asset.asset_sequence, 1)
  const secondActive = await query(
    "select array_agg(asset_sequence order by asset_sequence) positions from public.ops_tool_assets where slot_id=$1 and equipment_id=$2 and status='ACTIVE'",
    [slotTwo, equipmentTwo],
  )
  check(secondActive[0].positions, [1, 2])

  const third = (await query(
    'select public.ops_resolve_tool_issue($1,$2,$3,$4,$5) result',
    [id(22), resolvedAt, 'Serah terima posisi kedua', JSON.stringify(['photo.png']), 1],
  ))[0].result
  check(third.replacement_asset.asset_sequence, 2)
  const thirdActive = await query(
    "select array_agg(asset_sequence order by asset_sequence) positions from public.ops_tool_assets where slot_id=$1 and equipment_id=$2 and status='ACTIVE'",
    [slotTwo, equipmentTwo],
  )
  check(thirdActive[0].positions, [1, 2])

  console.log(`Stable tool unit numbering integration checks passed: ${checks}`)
} catch (error) {
  console.error(error.message, error.where ?? '')
  process.exitCode = 1
} finally {
  await db.close()
}
