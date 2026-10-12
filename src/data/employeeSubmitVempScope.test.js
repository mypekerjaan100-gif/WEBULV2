import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migrationUrl = new URL(
  '../../supabase/migrations/20261012120000_employee_submit_v_emp_scope_fix.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const fnStart = sql.indexOf('create or replace function public.submit_employee_change_request')
assert(fnStart >= 0, 'Fungsi submit_employee_change_request tidak ditemukan')
const body = sql.slice(fnStart)
assert(body.length > 1000, 'Body fungsi submit tidak lengkap')

// v_emp harus dideklarasikan pada scope fungsi, bukan blok nested.
assert(
  body.includes('declare v_id uuid; v_is_manager boolean; v_target uuid; v_emp uuid;'),
  'v_emp harus dideklarasikan di scope fungsi utama',
)
assert(
  !body.includes('declare v_emp uuid;\n    begin'),
  'Deklarasi nested v_emp yang menyebabkan out-of-scope harus dihapus',
)
assert(body.includes('v_emp := private.apply_employee_snapshot'), 'Pemanggilan helper snapshot hilang')
assert(
  body.includes('case when p_request_type=\'add\' then v_emp else p_employee_id end'),
  'Penggunaan v_emp setelah snapshot harus dipertahankan',
)

// Keamanan dan validasi scope harus dipertahankan.
assert(body.includes('security definer'), 'SECURITY DEFINER hilang')
assert(body.includes("set search_path to 'public', 'pg_temp'"), 'search_path aman hilang')
assert(body.includes('auth_can_submit_employee_scope'), 'Validasi submit scope hilang')
assert(body.includes('auth_can_manage_employee_scope'), 'Validasi manager scope hilang')
assert(body.includes('Admin ULP hanya boleh mengajukan unit sendiri'), 'Guard Admin ULP hilang')
assert(body.includes('grant execute'), 'Grant execute hilang')
assert(body.includes('authenticated'), 'Grant untuk authenticated hilang')

console.log(`Employee submit v_emp scope tests passed: ${passed}`)
