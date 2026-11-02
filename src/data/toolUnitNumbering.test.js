import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const migration = read('../../supabase/migrations/20261102031600_stable_tool_unit_numbers.sql')
const matrix = read('../components/sla/UlpToolInspectionMatrix.jsx')
const evidenceUi = read('../components/sla/ToolEvidence.jsx')

assert(
  migration.includes('drop constraint if exists ops_tool_assets_slot_id_equipment_id_asset_sequence_key'),
  'Batasan nomor unit lama harus dilepas',
)
assert(
  migration.includes('where status = \'ACTIVE\''),
  'Keunikan nomor unit hanya boleh berlaku untuk unit aktif',
)
assert(
  migration.includes('row_number() over') && migration.includes('partition by slot_id, equipment_id'),
  'Nomor unit lama harus dirapikan per posisi alat',
)
assert(
  migration.includes('disable trigger trg_ops_tool_assets_guard')
    && migration.includes('enable trigger trg_ops_tool_assets_guard'),
  'Perapian nomor unit harus menutup penjaga identitas sementara',
)
assert(
  migration.includes('a.asset_sequence, v_life, \'ACTIVE\''),
  'Alat pengganti harus memakai nomor posisi Unit yang sama',
)
assert(
  !migration.includes('max(asset_sequence)'),
  'Alat pengganti tidak boleh memakai nomor urut generasi',
)
assert(
  migration.indexOf("set status = 'REPLACED'") < migration.indexOf('insert into public.ops_tool_assets'),
  'Unit lama harus ditutup sebelum pengganti mengisi posisi yang sama',
)
assert(
  migration.includes('Alat pengganti menempati posisi unit yang sama')
    || migration.includes('Alat pengganti tetap memakai nomor unit yang sama'),
  'Migrasi harus menjelaskan nomor unit tetap',
)

assert(
  evidenceUi.includes("label: 'Alat pengganti · belum diperiksa'"),
  'Unit pengganti tanpa inspeksi harus ditandai jelas',
)
assert(
  matrix.includes('Alat pengganti · mulai pakai'),
  'Rincian unit harus menampilkan waktu mulai alat pengganti',
)
assert(
  matrix.includes('Alat pengganti menempati unit ${editor.asset.asset_sequence} yang sama'),
  'Pesan serah terima harus menyebut nomor unit tetap',
)
assert(
  matrix.includes('Alat pengganti tetap memakai nomor unit yang sama'),
  'Form serah terima harus menjelaskan nomor unit tetap',
)

console.log(`toolUnitNumbering.test.js: ${passed} assertions passed`)
