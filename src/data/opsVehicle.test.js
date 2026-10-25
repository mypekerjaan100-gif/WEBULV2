import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const registrySql = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/20261023092000_ops_vehicles_registry.sql', import.meta.url)),
  'utf8',
)
const foundationSql = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/20261023091000_ops_stage2_foundation.sql', import.meta.url)),
  'utf8',
)
const mirrorSql = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/20261015074409_fix_ops_equipment_master_read_scope.sql', import.meta.url)),
  'utf8',
)
const masterSql = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/20261016090000_ops_equipment_master.sql', import.meta.url)),
  'utf8',
)
const repo = readFileSync(fileURLToPath(new URL('./opsVehicleRepository.js', import.meta.url)), 'utf8')
const component = readFileSync(
  fileURLToPath(new URL('../components/sla/KendaraanUlp.jsx', import.meta.url)),
  'utf8',
)
const masterComponent = readFileSync(
  fileURLToPath(new URL('../components/sla/AlatKendaraanMaster.jsx', import.meta.url)),
  'utf8',
)
const page = readFileSync(
  fileURLToPath(new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url)),
  'utf8',
)
const modules = readFileSync(
  fileURLToPath(new URL('./slaPelayananTeknik.js', import.meta.url)),
  'utf8',
)
let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

// Registry kendaraan
for (const table of ['ops_vehicles', 'ops_vehicle_template_assignments', 'ops_vehicle_history']) {
  assert(registrySql.includes(`create table if not exists public.${table}`), `Tabel ${table} hilang`)
}
assert(registrySql.includes('uq_ops_vehicles_plate unique (plate_normalized)'), 'Nomor polisi wajib unik global')
assert(registrySql.includes("check (status in ('Aktif', 'Tidak Aktif'))"), 'Status kendaraan tidak valid')
assert(registrySql.includes('ck_ops_vehicles_inactive_reason'), 'Alasan nonaktif wajib diatur')
assert(registrySql.includes('ex_ops_vta_no_overlap'), 'Anti-overlap acuan hilang')
assert(registrySql.includes("daterange(effective_from, effective_to, '[)') with &&"), 'Rentang acuan harus [from, to)')
assert(registrySql.includes('Asia/Pontianak'), 'Tanggal bisnis harus WIB')
assert(registrySql.includes('ops_vehicle_can_access'), 'Predikat akses kendaraan hilang')
assert(registrySql.includes("cm.contract_role = 'ADMIN_ULP' and cm.operational_unit_id = p_ulp_id"), 'Akses Admin ULP harus eksak ULP')
assert(registrySql.includes("cm.contract_role = 'ADMIN_UP3'"), 'Akses Admin UP3 hilang')

for (const rpc of [
  'ops_list_vehicles', 'ops_get_vehicle', 'ops_list_vehicle_template_candidates',
  'ops_list_template_items_for_vehicle', 'ops_save_vehicle', 'ops_set_vehicle_status',
  'ops_correct_vehicle_ulp', 'ops_list_vehicle_history',
]) {
  assert(registrySql.includes(`function public.${rpc}`), `RPC ${rpc} hilang`)
}
assert(registrySql.includes('Nomor polisi sudah terdaftar'), 'Pesan nopol duplikat hilang')
assert(registrySql.includes('Nomor polisi wajib diisi'), 'Validasi nopol kosong hilang')
assert(registrySql.includes('Kendaraan tidak aktif tidak dapat diubah'), 'Kendaraan nonaktif harus terkunci')
assert(registrySql.includes('Acuan baru harus memiliki jenis kendaraan dan penugasan yang sama'), 'Aturan pindah acuan hilang')
assert(registrySql.includes('Alasan perubahan status wajib diisi'), 'Alasan ubah status wajib')
assert(registrySql.includes('Alasan koreksi ULP wajib diisi'), 'Alasan koreksi ULP wajib')
assert(registrySql.includes('KOREKSI_HARI_SAMA'), 'Koreksi hari sama harus tanpa interval nol')
assert(registrySql.includes("'CREATED', 'UPDATED', 'ASSIGNED', 'STATUS_CHANGED', 'CORRECTED_ULP'"), 'Aksi riwayat tidak lengkap')
assert(registrySql.includes('revoke all on public.ops_vehicle_history from anon, authenticated'), 'Riwayat harus RPC-only')
assert(!/create policy[^;]*on public\.ops_vehicle_history/i.test(registrySql), 'Riwayat tidak boleh punya policy SELECT')
assert(!/delete from public\.ops_vehicles/i.test(registrySql), 'Kendaraan tidak boleh dihapus permanen')
assert(!/drop table/i.test(registrySql), 'Registry tidak boleh drop tabel')
assert(registrySql.includes('grant execute on function public.ops_save_vehicle'), 'Grant simpan kendaraan hilang')
assert(!/grant execute on function public\.ops_save_vehicle[^;]*to anon/i.test(registrySql), 'Anon dilarang menulis kendaraan')

// Fondasi snapshot & guard
assert(foundationSql.includes('add column if not exists revision integer not null default 1'), 'Kolom revision hilang')
assert(foundationSql.includes('published_at timestamptz'), 'Snapshot publikasi hilang')
assert(foundationSql.includes('equipment_name text'), 'Snapshot nama alat hilang')
assert(foundationSql.includes('guard_ops_template_content'), 'Guard konten template hilang')
assert(foundationSql.includes('guard_ops_template_item_content'), 'Guard rincian template hilang')
assert(foundationSql.includes('Konten template yang sudah terbit bersifat tetap'), 'Pesan guard template hilang')
assert(foundationSql.includes('Rincian alat template terbitan bersifat tetap'), 'Pesan guard rincian hilang')
assert(foundationSql.includes('ops_normalize_variant'), 'Normalisasi varian hilang')
assert(foundationSql.includes('published_at = now()'), 'Publikasi harus membekukan metadata')
assert(foundationSql.includes('equipment_category_name = c.name'), 'Snapshot kategori harus diisi saat publikasi')
assert(!/drop table/i.test(foundationSql), 'Fondasi tidak boleh drop tabel')

// Mirror drift & replai aman
assert(mirrorSql.includes('ops_can_read_master'), 'Mirror read scope hilang')
assert(mirrorSql.includes('create policy ops_master_select'), 'Policy mirror hilang')
assert(masterSql.includes("column_name = 'revision'"), 'Trigger audit harus aman saat replai')
assert(masterSql.includes('trg_') && masterSql.includes('_audit'), 'Nama trigger audit berubah')

// Repository
for (const fn of [
  'listOpsVehicles', 'getOpsVehicle', 'listVehicleTemplateCandidates', 'listTemplateItemsForVehicle',
  'saveOpsVehicle', 'setOpsVehicleStatus', 'correctOpsVehicleUlp', 'listOpsVehicleHistory',
  'normalizePlate', 'displayPlate',
]) {
  assert(repo.includes(`export ${fn.startsWith('normalize') || fn.startsWith('display') ? 'function' : 'async function'} ${fn}`), `Repo ${fn} hilang`)
}
assert(repo.includes("replace(/[^A-Z0-9]+/g, '')"), 'Normalisasi nopol klien hilang')
assert(!repo.includes('.delete('), 'Repo tidak boleh hapus destruktif')
assert(!repo.includes('Jumlah SLA'), 'Istilah Jumlah SLA dilarang')

// Komponen kendaraan
assert(component.includes('Kendaraan ULP'), 'Judul Kendaraan ULP hilang')
assert(component.includes('Nomor Polisi'), 'Field nomor polisi hilang')
assert(component.includes('Tipe/Merek'), 'Field tipe/merek hilang')
assert(component.includes('Jumlah Kebutuhan'), 'Label Jumlah Kebutuhan hilang')
assert(component.includes('Acuan Template'), 'Field acuan template hilang')
assert(component.includes('Koreksi ULP'), 'Aksi koreksi ULP hilang')
assert(component.includes('Riwayat'), 'Tab riwayat hilang')
assert(component.includes('Tidak Aktif'), 'Status tidak aktif hilang')
assert(component.includes('legacy'), 'Penanda template legacy hilang')
assert(component.includes('Identitas Kendaraan'), 'Bagian identitas kendaraan hilang')
assert(component.includes('Acuan Kebutuhan'), 'Bagian acuan kebutuhan hilang')
assert(component.includes('ops-vehicle-preview'), 'Pratinjau kebutuhan hilang')
assert(component.includes('alkes-savebar'), 'Status simpan kendaraan hilang')
assert(component.includes('filteredCandidates'), 'Filter bertingkat kandidat template hilang')
assert(component.includes('mutationPending.current = true'), 'Kunci pengiriman ganda kendaraan hilang')
assert(component.includes('disabled={busy} aria-busy={busy}'), 'Kontrol kendaraan harus terkunci saat menyimpan')
assert(page.includes('if (!canLeaveEditor())'), 'Perlindungan meninggalkan isian hilang')
assert(!component.includes('plateNormalized'), 'Kode teknis nopol tidak boleh tampil di UI')
assert(!component.includes('Jumlah SLA'), 'Istilah Jumlah SLA dilarang di UI')
assert(!/Sei Duri|Bengkayang|Singkawang/.test(component), 'Daftar ULP tidak boleh hardcode')

const vehicleCss = readFileSync(fileURLToPath(new URL('../styles/index.css', import.meta.url)), 'utf8')
for (const className of ['ops-vehicle-form-section', 'ops-vehicle-preview', 'ops-vehicle-selected-template']) {
  assert(vehicleCss.includes(`.${className}`), `Style ${className} hilang`)
}

// Integrasi tab utama & halaman
assert(modules.includes("{ id: 'kendaraan-ulp', name: 'Alat & Kendaraan' }"), 'Tab utama Alat & Kendaraan hilang')
assert(modules.includes("{ id: 'alat-kendaraan', name: 'Master Alat & Kendaraan' }"), 'Master Alat & Kendaraan harus terpisah')
assert(
  modules.indexOf("id: 'lembur'") < modules.indexOf("id: 'kendaraan-ulp'"),
  'Tab Alat & Kendaraan harus tepat setelah Lembur',
)
assert(page.includes("import UlpConditionReport from '../../components/sla/UlpConditionReport.jsx'"), 'Halaman utama harus membuka lembar kondisi ULP')
assert(page.includes("moduleId === 'kendaraan-ulp' ? ("), 'Cabang modul kendaraan-ulp hilang')
assert(page.includes('const canViewVehicles = isSuperAdmin || isAdminUp3 || isAdminUlp'), 'Visibilitas kendaraan harus dibatasi peran')
assert(page.includes("if (module.id === 'kendaraan-ulp') return canViewVehicles"), 'Filter modul kendaraan-ulp hilang')
assert(page.includes("primaryModuleIds = ['sla', 'variable-cost', 'lembur', 'kendaraan-ulp']"), 'Kendaraan ULP harus menjadi tab utama')
assert(page.includes('ownUlpUuid={adminUlpAccess?.operational_unit_id ?? null}'), 'ULP Admin ULP harus eksak')
assert(page.includes('canManage={isSuperAdmin || isAdminUlp}'), 'Hak kelola kendaraan harus SA/Admin ULP')
assert(page.includes('canPickUlp={isSuperAdmin || isAdminUp3}'), 'Pemantauan lintas ULP hanya untuk Super Admin/Admin UP3')
assert(page.includes('const VEHICLE_TAB_DISABLED = false'), 'Tab Alat & Kendaraan harus aktif')
assert(page.includes("disabled={VEHICLE_TAB_DISABLED && module.id === 'kendaraan-ulp'}"), 'Tab kendaraan harus tidak dapat diklik')
assert(page.includes("VEHICLE_TAB_DISABLED && routeRequest.module === 'kendaraan-ulp'"), 'Rute langsung kendaraan harus diblokir')
assert(page.includes("moduleId === 'kendaraan-ulp' && VEHICLE_TAB_DISABLED"), 'Modul kendaraan tidak boleh dirender saat dinonaktifkan')
assert(page.includes('units={orgMap.units}'), 'Daftar unit harus memakai scope organisasi')
assert(!masterComponent.includes('KendaraanUlp'), 'Registrasi kendaraan lama harus dihapus dari master')
assert(!masterComponent.includes('registrasi-kendaraan'), 'Submenu registrasi kendaraan lama harus dihapus')
assert(!masterComponent.includes('Registrasi Kendaraan Lama'), 'Label registrasi kendaraan lama harus dihapus')
assert(!masterComponent.includes("id: 'kendaraan'"), 'Subtab kendaraan lama harus dihapus dari master')

console.log(`Ops vehicle tests passed: ${passed}`)
