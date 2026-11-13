import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('../../supabase/migrations/20261113140000_employee_history_same_day_fix.sql', import.meta.url),
  'utf8',
)

for (const helper of [
  'reconcile_employee_position_history',
  'reconcile_employee_location_history',
  'reconcile_employee_rate_history',
  'reconcile_employee_unit_and_location',
]) {
  assert.ok(
    migration.includes(`create or replace function private.${helper}`),
    `Helper ${helper} hilang`,
  )
}

assert.ok(
  migration.includes('perform private.reconcile_employee_unit_and_location('),
  'Snapshot harus memakai helper unit/lokasi',
)
assert.ok(
  migration.includes('perform private.reconcile_employee_position_history('),
  'Snapshot harus memakai helper jabatan',
)
assert.ok(
  migration.includes('perform private.reconcile_employee_rate_history('),
  'Snapshot harus memakai helper tarif',
)
assert.ok(
  migration.includes('perform private.reconcile_employee_status_history('),
  'Snapshot harus tetap memakai helper status',
)

const positionHelper = migration.slice(
  migration.indexOf('create or replace function private.reconcile_employee_position_history'),
  migration.indexOf('create or replace function private.reconcile_employee_location_history'),
)
assert.ok(positionHelper.includes('if v_open.effective_from >= v_effective then'), 'Perubahan jabatan hari yang sama harus update baris')
assert.ok(positionHelper.includes('set position_id = p_position_id'), 'Baris jabatan berjalan harus diperbarui')
assert.ok(positionHelper.includes('for update'), 'Baris jabatan berjalan harus dikunci')
assert.ok(positionHelper.includes('set effective_to = v_effective'), 'Perubahan tanggal berikutnya harus menutup baris lama')

const locationHelper = migration.slice(
  migration.indexOf('create or replace function private.reconcile_employee_location_history'),
  migration.indexOf('create or replace function private.reconcile_employee_rate_history'),
)
assert.ok(locationHelper.includes('if v_open.effective_from >= v_effective then'), 'Perubahan lokasi hari yang sama harus update baris')
assert.ok(locationHelper.includes('set location_id = p_location_id'), 'Baris lokasi berjalan harus diperbarui')
assert.ok(locationHelper.includes('for update'), 'Baris lokasi berjalan harus dikunci')

const rateHelper = migration.slice(
  migration.indexOf('create or replace function private.reconcile_employee_rate_history'),
  migration.indexOf('create or replace function private.reconcile_employee_unit_and_location'),
)
assert.ok(rateHelper.includes('if v_open.effective_from >= v_effective then'), 'Perubahan tarif hari yang sama harus update baris')
assert.ok(rateHelper.includes('set hourly_rate = v_rate'), 'Baris tarif berjalan harus diperbarui')
assert.ok(rateHelper.includes('for update'), 'Baris tarif berjalan harus dikunci')

const unitHelper = migration.slice(migration.indexOf('create or replace function private.reconcile_employee_unit_and_location'))
assert.ok(unitHelper.includes('if v_unit_open.effective_from >= v_effective then'), 'Perubahan unit hari yang sama harus update baris')
assert.ok(unitHelper.includes('set contract_id = p_contract_id'), 'Baris unit berjalan harus diperbarui')
assert.ok(unitHelper.includes('for update'), 'Baris unit berjalan harus dikunci')

assert.ok(
  !migration.includes('update public.employee_position_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null'),
  'Penutupan riwayat jabatan lama tanpa penanganan hari yang sama harus dihapus',
)
assert.ok(
  !migration.includes('update public.employee_work_location_history set effective_to=p_effective where employee_id=v_employee_id and effective_to is null'),
  'Penutupan riwayat lokasi lama tanpa penanganan hari yang sama harus dihapus',
)

console.log('Employee history same-day regression tests passed')
