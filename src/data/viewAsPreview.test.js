import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isPreviewWriteMethod, isPreviewWriteRpc } from '../lib/previewWriteGuard.js'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

// --- Aturan blokir tulis saat pratinjau ---
for (const name of [
  'save_manual_sla_entry',
  'set_manual_sla_target',
  'create_feeder_proposal',
  'approve_overtime_l5',
  'reject_overtime_entry_l5',
  'final_reject_overtime_l5',
  'submit_overtime_work_l3',
  'import_employees_bulk',
  'soft_delete_overtime_entry',
  'mark_sla_version_used_from_entry',
  'expire_overtime_initial_drafts_l6',
  'reorder_locations',
  'set_custom_role_active',
  'ops_save_vehicle',
  'ops_set_vehicle_status',
  'ops_correct_vehicle_ulp',
  'ops_save_master',
  'ops_save_equipment_v3',
  'ops_import_equipment_v2',
  'ops_publish_template',
  'ops_archive_template',
  'ops_duplicate_template',
  'ops_create_prescribed_vehicles_batch_v2',
  'ops_end_prescribed_vehicle',
  'ops_set_prescribed_vehicle_plate',
  'ops_save_vehicle_condition_report',
  'ops_save_vehicle_condition_subset',
  'ops_submit_tool_inspection',
  'ops_resolve_tool_issue',
  'deactivate_feeder',
  'activate_feeder',
  'prepare_employee_photo_upload',
  'finalize_employee_photo_upload',
  'begin_employee_photo_delete',
  'cancel_overtime_evidence_upload',
  'admin_set_user_access',
]) {
  assert(isPreviewWriteRpc(name) === true, `RPC tulis harus diblokir: ${name}`)
}
for (const name of [
  'get_financial_comparison_dashboard',
  'list_custom_roles',
  'list_rejected_entries',
  'list_employee_photos',
  'list_variable_unit_prices',
  'ops_list_prescribed_vehicles',
  'ops_get_vehicle',
  'ops_vehicle_can_manage',
  'user_management_authorize_operation',
]) {
  assert(isPreviewWriteRpc(name) === false, `RPC baca harus diizinkan: ${name}`)
}
for (const method of ['insert', 'update', 'delete', 'upsert']) {
  assert(isPreviewWriteMethod(method) === true, `Metode tulis harus diblokir: ${method}`)
}
assert(isPreviewWriteMethod('select') === false, 'Select harus diizinkan saat pratinjau')

// --- Sumber mode pratinjau ---
const state = read('../lib/viewAsState.js')
assert(state.includes('let active = false'), 'Status pratinjau harus global')
assert(state.includes('setViewAsActive'), 'Setter status pratinjau hilang')
assert(state.includes('isViewAsActive'), 'Pembaca status pratinjau hilang')

const client = read('../lib/supabaseClient.js')
assert(client.includes('isViewAsActive() && isPreviewWriteRpc(name)'), 'RPC tulis tidak diblokir saat pratinjau')
assert(client.includes('isPreviewWriteMethod(prop)'), 'Mutasi tabel tidak diblokir saat pratinjau')
assert(client.includes('PREVIEW_STORAGE_WRITE_METHODS'), 'Unggahan berkas tidak diblokir saat pratinjau')
assert(client.includes('Mode pratinjau: perubahan data dinonaktifkan.'), 'Pesan pratinjau hilang')

// --- Pilihan role pada View As ---
const app = read('../App.jsx')
assert(app.includes("import { listCustomRoles } from './lib/customRoles.js'"), 'Role custom harus dimuat untuk View As')
assert(app.includes('viewAsRoleCode'), 'State role pratinjau hilang')
assert(app.includes("id: 'super', name: 'Super Admin'"), 'Pilihan Super Admin hilang')
assert(app.includes("id: 'ADMIN_UP3', name: 'Admin UP3'"), 'Pilihan Admin UP3 hilang')
assert(app.includes("id: 'ADMIN_ULP', name: 'Admin ULP'"), 'Pilihan Admin ULP hilang')
assert(app.includes('...customRoleList.map((role) => ({ id: role.code, name: role.displayName }))'), 'Role custom harus masuk daftar pratinjau')
assert(app.includes('value: previewActive ? viewAsRoleCode : \'super\''), 'Nilai pilihan pratinjau hilang')
assert(app.includes("onReset: () => handleViewAsChange('super')"), 'Aksi keluar pratinjau hilang')
assert(app.includes('setViewAsActive(previewActive)'), 'Status pratinjau tidak disinkronkan')
assert(app.includes('previewActive ? viewAsRoleCode : null'), 'Role pratinjau tidak diteruskan ke halaman')
assert(app.includes('previewActive={previewActive}'), 'Status pratinjau tidak diteruskan ke layout')
assert(app.includes('previewApprovalAccess'), 'Notifikasi persetujuan Admin UP3 pratinjau hilang')
assert(app.includes('adminUp3Access && (isRealScopedUser || previewActive)'), 'Notifikasi persetujuan harus aktif saat pratinjau Admin UP3')
assert(app.includes('resolveContractCodeToUuid'), 'Scope persetujuan pratinjau harus memakai kontrak asli')

const bar = read('../components/sla/SlaPreviewBar.jsx')
assert(!bar.includes('slaRoles'), 'Daftar role statis harus diganti')
assert(bar.includes('options = []'), 'Daftar role pratinjau hilang')
assert(bar.includes('Read-only'), 'Penanda read-only hilang')
assert(bar.includes('Keluar'), 'Tombol keluar pratinjau hilang')
assert(bar.includes('onReset'), 'Handler keluar pratinjau hilang')

const header = read('../components/Header.jsx')
assert(header.includes("const previewLabel = preview?.active ? preview.label : null"), 'Label pratinjau header hilang')
assert(header.includes('previewLabel ??'), 'Header harus menampilkan role pratinjau')

const sidebar = read('../components/Sidebar.jsx')
assert(sidebar.includes('previewActive = false'), 'Sidebar harus menerima status pratinjau')
assert(sidebar.includes('isSuperAdmin && !previewActive'), 'Pengguna & Akses harus disembunyikan saat pratinjau')
assert(sidebar.includes('!previewActive && (isSuperAdmin || organizationAccess.some'), 'Analisis Finansial harus disembunyikan saat pratinjau')
assert(sidebar.includes('!previewActive && (isSuperAdmin || allowedContractCodes.has(c.id))'), 'Kontrak lain harus disembunyikan saat pratinjau')

// --- Halaman mengikuti role pratinjau ---
const page = read('../pages/sla/SLAPelayananTeknikPage.jsx')
assert(page.includes('viewAsRoleCode = null'), 'Halaman harus menerima role pratinjau')
assert(page.includes('const previewActive = Boolean(viewAsRoleCode)'), 'Status pratinjau halaman hilang')
assert(page.includes('const isSuperAdmin = !previewActive && actor?.is_super_admin === true'), 'Super Admin harus dinonaktifkan saat pratinjau')
assert(page.includes("? viewAsRoleCode === 'ADMIN_UP3'"), 'Admin UP3 pratinjau harus memakai cakupan UP3')
assert(page.includes("? viewAsRoleCode === 'ADMIN_ULP'"), 'Admin ULP pratinjau harus memakai cakupan ULP')
assert(page.includes("previewActive\n    ? { operational_unit_id: selectedUnitUuid }"), 'Cakupan ULP pratinjau hilang')
assert(page.includes('sla-preview-banner'), 'Banner pratinjau halaman hilang')
assert(page.includes('Perubahan data dinonaktifkan selama pratinjau.'), 'Peringatan read-only halaman hilang')

console.log(`viewAsPreview.test.js: ${passed} assertions passed`)
