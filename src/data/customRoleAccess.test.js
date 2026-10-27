import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const base = read('../../supabase/migrations/20261027140000_custom_roles_menu_access.sql')
const enforce = read('../../supabase/migrations/20261027141000_custom_roles_enforcement.sql')
const writes = read('../../supabase/migrations/20261027142000_custom_roles_write_gates.sql')

assert(base.includes('is_custom boolean'), 'Penanda role custom hilang')
assert(base.includes('menu_access jsonb'), 'Penyimpanan akses menu hilang')
assert(base.includes('alat.read') && base.includes('alat.manage'), 'Permission Alat & Kendaraan hilang')
assert(base.includes('validate_contract_membership_role'), 'Validasi role kontrak hilang')
assert(base.includes("v_level is distinct from 'ULP'"), 'Role custom wajib ULP')
assert(base.includes("'analisis_finansial' and v_value = 'edit'"), 'Analisis Finansial harus read-only')
assert(base.includes('create or replace function public.list_custom_roles'), 'RPC daftar role hilang')
assert(base.includes('create or replace function public.save_custom_role'), 'RPC simpan role hilang')
assert(base.includes('create or replace function public.set_custom_role_active'), 'RPC status role hilang')
assert(base.includes('ROLE_CREATED') && base.includes('ROLE_UPDATED'), 'Audit role hilang')
assert(base.includes('Only SUPER_ADMIN may manage roles'), 'Batas Super Admin hilang')

assert(enforce.includes('auth_custom_has_permission'), 'Helper izin custom hilang')
assert(base.includes('auth_is_custom_contract_role'), 'Deteksi role custom hilang')
assert(enforce.includes("'overtime.manage'"), 'Izin edit Lembur hilang')
assert(enforce.includes("'variable_cost.manage'"), 'Izin edit Variable Cost hilang')
assert(enforce.includes("'alat.manage'"), 'Izin edit Alat hilang')
assert(enforce.includes('p_role not in (\'ADMIN_UP3\',\'ADMIN_ULP\')'), 'Role kontrak custom harus diterima')
assert(enforce.includes('Role custom hanya mendukung cakupan ULP'), 'Validasi cakupan assignment hilang')

assert(writes.includes("'sla.manage'"), 'Izin edit SLA hilang')
assert(writes.includes('auth_is_custom_contract_role'), 'Guard tulis custom hilang')
assert(writes.includes('Not authorized to set WO'), 'Guard edit WO hilang')

const session = read('../../supabase/functions/user-management/handlers/sessionContext.ts')
assert(session.includes('custom_menu_access'), 'Session context harus membawa akses menu custom')
assert(session.includes('role_display_name'), 'Nama role custom harus dipetakan')
assert(session.includes('authorization_role_permissions'), 'Permission role custom harus dimuat')

const options = read('../../supabase/functions/user-management/handlers/accessOptions.ts')
assert(options.includes('customRoles'), 'Opsi akses harus memuat role custom')

const createUser = read('../../supabase/functions/user-management/handlers/createUser.ts')
assert(!createUser.includes('ROLES = new Set'), 'Whitelist role statis harus dihapus')
assert(createUser.includes('role.startsWith("CUSTOM_")'), 'Scope ULP role custom harus dikirim')

const assign = read('../../supabase/functions/user-management/handlers/assignContractAccess.ts')
assert(assign.includes('role.is_custom'), 'Assignment harus menerima role custom')
assert(assign.includes('Role custom hanya mendukung cakupan ULP'), 'Assignment harus memvalidasi level ULP')

const app = read('../App.jsx')
assert(app.includes('customMenuAccess'), 'App harus memakai menu akses custom')
assert(app.includes("customCanView('alat_kendaraan')"), 'Visibilitas Alat harus mengikuti role custom')
assert(!app.includes("customCanView('analisis_finansial')"), 'Finansial belum boleh dibuka untuk role custom')
assert(app.includes('customMenuAccess={customMenuAccess}'), 'Halaman SLA harus menerima menu akses custom')

const page = read('../pages/sla/SLAPelayananTeknikPage.jsx')
assert(page.includes("isCustomRole && visibleModules.length === 0"), 'Role tanpa menu harus mendapat state kosong')
assert(page.includes("isCustomRole && customCanEdit('lembur')"), 'Edit Lembur custom harus diteruskan')
assert(page.includes("isManagementReadOnly={(isManagement && !canManageUp3Operations) || (isCustomRole && !customCanEdit('variable_cost'))}"), 'Read-only Variable Cost custom hilang')

const roleModal = read('../pages/user-management/RoleManagerModal.jsx')
assert(roleModal.includes('Manajemen Role'), 'Judul Manajemen Role hilang')
assert(roleModal.includes('Tidak ada akses'), 'Pilihan tanpa akses hilang')
assert(roleModal.includes('Hanya lihat'), 'Pilihan hanya lihat hilang')
assert(roleModal.includes('Lihat & edit'), 'Pilihan edit hilang')
assert(roleModal.includes('alat_kendaraan'), 'Menu Alat & Kendaraan hilang')
assert(!roleModal.includes('analisis_finansial'), 'Finansial belum boleh ditampilkan pada role dasar')
assert(roleModal.includes('CUSTOM_'), 'Prefix kode role hilang')
assert(roleModal.includes('roleCodeFromName'), 'Kode role harus terisi otomatis dari nama')
assert(roleModal.includes('if (!isEdit && !codeTouched) setCodeSuffix(roleCodeFromName(value))'), 'Sinkronisasi kode dari nama hilang')
assert(roleModal.includes('Terisi otomatis dari nama role'), 'Petunjuk kode otomatis hilang')
assert(!roleModal.includes("onChange={(event) => setDisplayName(event.target.value)}"), 'Input nama harus memicu kode otomatis')
assert(roleModal.includes('setCustomRoleActive'), 'Aksi aktif/nonaktif role hilang')

const users = read('../pages/user-management/UserListPage.jsx')
assert(users.includes('RoleManagerModal'), 'Modal role belum terpasang')
assert(users.includes('options.customRoles'), 'Form pengguna belum memuat role custom')
assert(users.includes('{custom.displayName}</option>'), 'Role buatan Super Admin harus tampil dengan nama saja')
assert(!users.includes('optgroup'), 'Dropdown role tidak boleh mengelompokkan role custom terpisah')
assert(users.includes('requiresUlp'), 'Form role custom harus meminta ULP')

console.log(`customRoleAccess.test.js: ${passed} assertions passed`)
