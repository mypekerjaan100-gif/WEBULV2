import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const migrationUrl = new URL(
  '../../supabase/migrations/20261012140000_employee_ulp_transfer_effective_oct1.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')

assert(sql.includes("8319005SKW"), 'NIP Sepriwendi hilang')
assert(sql.includes("7519004SKW"), 'NIP MOH KHAI RONI hilang')
assert(sql.includes("date '2026-10-01'"), 'Tanggal efektif 1 Oktober hilang')
assert(sql.includes("date '2026-10-12'"), 'Filter tanggal salah 12 Oktober hilang')
assert(sql.includes("employee_unit_history"), 'Koreksi riwayat unit hilang')
assert(sql.includes("employee_work_location_history"), 'Koreksi riwayat lokasi hilang')
assert(!sql.includes("4e21a426-873c-4913-9569-1e1001ac154a"), 'Migration tidak boleh hardcode UUID pegawai')
assert(!sql.includes("57a31512-73f0-4927-885f-097221518ba0"), 'Migration tidak boleh hardcode UUID pegawai')
assert(!sql.includes("27617d7d-795f-4f34-8edd-cc236ed49146"), 'Migration tidak boleh hardcode UUID unit')
assert(!sql.includes("280d0c0e-cbf2-4fac-a8f9-3ea15da1bd02"), 'Migration tidak boleh hardcode UUID unit')

console.log(`Employee ULP transfer Oct 1 tests passed: ${passed}`)
