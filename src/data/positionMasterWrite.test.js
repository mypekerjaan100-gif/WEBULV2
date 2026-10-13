import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migrationUrl = new URL(
  '../../supabase/migrations/20261015090000_position_master_write.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const fnStart = sql.indexOf('create or replace function public.save_position_l1(')
assert(fnStart >= 0, 'RPC save_position_l1 tidak ditemukan')
const fnBody = sql.slice(fnStart, sql.indexOf('\n$function$;', fnStart))
assert(fnBody.length > 1500, 'Body save_position_l1 tidak lengkap')

// Skema benar: SUPER_ADMIN penuh, admin scope operasional boleh kelola scope-nya.
assert(fnBody.includes('public.auth_is_super_admin()'), 'RPC harus memeriksa SUPER_ADMIN')
assert(fnBody.includes('public.auth_can_access_operational_up3'), 'RPC harus memeriksa scope operasional')
assert(fnBody.includes('Nama jabatan wajib diisi'), 'Validasi nama hilang')
assert(fnBody.includes("Status jabatan harus Aktif atau Nonaktif"), 'Validasi status hilang')
assert(fnBody.includes('Nama jabatan sudah digunakan pada scope ini'), 'Proteksi duplikat hilang')
assert(sql.includes("grant execute on function public.save_position_l1"), 'Grant authenticated hilang')
assert(!/create policy/i.test(sql), 'Tulis langsung tabel harus tetap lewat RPC (tanpa policy baru)')
assert(sql.includes('Petugas Variabel Inspeksi'), 'Data Inspeksi hilang')

const repoUrl = new URL('./employeeRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
assert(repo.includes('savePositionToSupabase'), 'Repo simpan jabatan hilang')
assert(repo.includes('save_position_l1'), 'Repo harus memanggil RPC save_position_l1')
assert(repo.includes('mapSupabasePosition'), 'Mapper posisi database hilang')

const masterUrl = new URL('../components/sla/SLAMasterJabatan.jsx', import.meta.url)
const master = readFileSync(fileURLToPath(masterUrl), 'utf8')
assert(master.includes('savePositionToSupabase'), 'Master harus menyimpan ke database')
assert(master.includes('onRefreshPositions'), 'Master harus refresh daftar setelah simpan')
assert(!master.includes('Prototype'), 'Label prototype harus dihapus')
assert(master.includes('langsung dipakai dropdown jabatan'), 'Penjelasan sinkron hilang')

const pageUrl = new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url)
const page = readFileSync(fileURLToPath(pageUrl), 'utf8')
assert(page.includes('mergeSupabasePositions'), 'Helper merge posisi hilang')
assert(page.includes('refreshPositions'), 'Callback refresh posisi hilang')
assert(page.includes('contractUuid={orgMap?.contractUuid'), 'Scope UUID harus diteruskan ke master')
assert(!page.includes('if (!newPositions.length) return prev'), 'Bug early-return merge harus diperbaiki')

console.log(`Position master write tests passed: ${passed}`)
