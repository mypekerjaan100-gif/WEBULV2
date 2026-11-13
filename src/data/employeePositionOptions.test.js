import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dedupePositionOptions, normalizePositionName } from './employeePositionOptions.js'

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const legacyNames = [
  'Koordinator UP3',
  'Koordinator ULP',
  'Koordinator K3 ULP',
  'Petugas Pelayanan Teknik',
  'Petugas ULC',
  'Petugas Variable ROW',
  'Petugas Variable HARDUKON',
]
const supabaseNames = [
  ...legacyNames,
  'Petugas Variabel Inspeksi',
  'Admin ULP',
  'Admin UP3',
  'Operator',
  'Operator BS',
]
const legacyPositions = legacyNames.map((name, index) => ({
  id: `jab-${index}`,
  name,
  order: index + 1,
  status: 'Aktif',
}))
const supabasePositions = supabaseNames.map((name, index) => ({
  id: uuid(index + 1),
  name,
  order: index + 1,
  status: 'Aktif',
  legacyKey: index < legacyPositions.length ? legacyPositions[index].id : `pos-${index}`,
}))

const options = dedupePositionOptions({ supabasePositions, legacyPositions })
assert.equal(options.length, supabaseNames.length, 'Nama jabatan yang sama harus menjadi satu opsi')
assert.equal(
  new Set(options.map((option) => normalizePositionName(option.name))).size,
  options.length,
  'Tidak boleh ada nama jabatan duplikat',
)
for (let index = 0; index < legacyPositions.length; index += 1) {
  const option = options.find((entry) => entry.name === legacyNames[index])
  assert.ok(option, `Opsi ${legacyNames[index]} hilang`)
  assert.equal(option.id, supabasePositions[index].id, 'ID Supabase harus menjadi nilai utama')
  assert.deepEqual(option.positionIds, [supabasePositions[index].id, legacyPositions[index].id])
}

const messy = dedupePositionOptions({
  supabasePositions: [{ id: uuid(90), name: '  Petugas   ULC ', order: 5, status: 'Aktif' }],
  legacyPositions: [{ id: 'jab-petugas-ulc', name: 'PETUGAS ULC', order: 5, status: 'Aktif' }],
})
assert.equal(messy.length, 1, 'Perbedaan spasi dan kapitalisasi harus digabung')
assert.equal(messy[0].id, uuid(90))
assert.equal(messy[0].name, 'Petugas ULC')
assert.deepEqual(messy[0].positionIds, [uuid(90), 'jab-petugas-ulc'])

const renamed = dedupePositionOptions({
  supabasePositions: [{ id: uuid(91), name: 'Koordinator UP3 Baru', legacyKey: 'jab-koord-up3', order: 1 }],
  legacyPositions: [{ id: 'jab-koord-up3', name: 'Koordinator UP3', order: 1 }],
})
assert.equal(renamed.length, 1, 'legacy_key harus menggabungkan walau nama berubah')
assert.equal(renamed[0].name, 'Koordinator UP3 Baru')
assert.deepEqual(renamed[0].positionIds, [uuid(91), 'jab-koord-up3'])

const localOnly = dedupePositionOptions({
  supabasePositions,
  legacyPositions: [...legacyPositions, { id: 'jab-lokal', name: 'Jabatan Lokal', order: 20 }],
})
assert.equal(localOnly.length, supabaseNames.length + 1, 'Jabatan lokal yang belum ada di Supabase tetap dipertahankan')

const duplicateMaster = dedupePositionOptions({
  supabasePositions: [
    { id: uuid(92), name: 'Operator', order: 1, status: 'Aktif' },
    { id: uuid(93), name: ' operator ', order: 2, status: 'Aktif' },
  ],
})
assert.equal(duplicateMaster.length, 1, 'Duplikat di master Supabase juga harus digabung')
assert.deepEqual(duplicateMaster[0].positionIds, [uuid(92), uuid(93)])

const component = readFileSync(new URL('../components/sla/SLADatabasePegawai.jsx', import.meta.url), 'utf8')
assert.ok(component.includes("import { dedupePositionOptions } from '../../data/employeePositionOptions.js'"))
assert.ok(component.includes('const jabatanOptions = dedupePositionOptions({'), 'Dropdown harus memakai helper deduplikasi')
assert.ok(!component.includes('const jabatanOptions = [...supabaseJabatan, ...scopedJabatan'), 'Penggabungan tanpa deduplikasi harus dihapus')
assert.ok(component.includes('j.contractId === resolvedContractUuid'), 'Jabatan Supabase harus dibatasi kontrak aktif')
assert.ok(component.includes('(!j.up3Id || j.up3Id === resolvedUp3Uuid)'), 'Jabatan Supabase harus dibatasi UP3 aktif')
assert.ok(component.includes('value={canonicalPositionId(form.positionId) ?? \'\'}'), 'Select harus memakai ID kanonis')
assert.ok(component.includes('canonicalPositionId(data.positionId) !== canonicalPositionId(filterJabatan)'), 'Filter harus mengenali ID legacy dan UUID sebagai jabatan yang sama')
assert.ok(component.includes('const mapped = positionNameById.get(posId)'), 'Nama jabatan harus memakai peta alias')

const masterJabatan = readFileSync(new URL('../components/sla/SLAMasterJabatan.jsx', import.meta.url), 'utf8')
assert.ok(masterJabatan.includes('dedupePositionOptions({'), 'Master Jabatan harus memakai helper deduplikasi')
assert.ok(!masterJabatan.includes('[...databaseScoped, ...localScoped'), 'Penggabungan mentah Master Jabatan harus dihapus')

console.log('Employee position option deduplication tests passed')
