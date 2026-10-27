import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migrationUrl = new URL(
  '../../supabase/migrations/20261016090000_ops_equipment_master.sql',
  import.meta.url,
)
const sql = readFileSync(fileURLToPath(migrationUrl), 'utf8')
let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

for (const table of [
  'ops_vehicle_types',
  'ops_vehicle_assignments',
  'ops_equipment_categories',
  'ops_equipment_items',
  'ops_equipment_templates',
  'ops_equipment_template_items',
]) {
  assert(sql.includes(`create table if not exists public.${table}`), `Tabel ${table} hilang`)
  assert(sql.includes(`enable row level security`) || sql.includes(`row level security`), 'RLS harus aktif')
}
assert(sql.includes('uq_ops_template_item'), 'Unique template+alat hilang')
assert(sql.includes("where status = 'Aktif'"), 'Proteksi template aktif ganda hilang')
assert(sql.includes('on delete restrict'), 'Relasi yang dipakai harus restrict')
assert(sql.includes('check (required_qty >= 0)'), 'Check jumlah >= 0 hilang')
assert(sql.includes('ops_can_manage_master'), 'Penjaga tulis hilang')
assert(sql.includes("cm.contract_role = 'ADMIN_UP3'"), 'Tulis harus Super Admin/Admin UP3')
assert(sql.includes('ops_save_master'), 'RPC master hilang')
assert(sql.includes('ops_save_equipment'), 'RPC peralatan hilang')
assert(sql.includes('ops_save_template_draft'), 'RPC draft template hilang')
assert(sql.includes('ops_publish_template'), 'RPC publikasi hilang')
assert(sql.includes('ops_archive_template'), 'RPC arsip hilang')
assert(sql.includes('ops_duplicate_template'), 'RPC duplikasi hilang')
assert(sql.includes('Jumlah Kebutuhan lebih dari 0'), 'Validasi publikasi hilang')
assert(sql.includes('Sudah ada template Aktif'), 'Proteksi bentrok aktif hilang')
assert(sql.includes('Hanya template Draft yang dapat diubah'), 'Proteksi draft hilang')
assert(!/delete from public\.ops_(vehicle_types|vehicle_assignments|equipment_categories|equipment_items|equipment_templates)\b/i.test(sql), 'Migration tidak boleh menghapus data master (kecuali ganti isi draft)')
assert(!/drop table/i.test(sql), 'Migration tidak boleh drop tabel')

const fixUrl = new URL(
  '../../supabase/migrations/20261016090100_ops_equipment_master_fix.sql',
  import.meta.url,
)
const fixSql = readFileSync(fileURLToPath(fixUrl), 'utf8')
assert(fixSql.includes('v_row jsonb'), 'Perbaikan return draft hilang')

const activeEditSql = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20261025031131_ops_active_template_edit.sql',
  import.meta.url,
)), 'utf8')
assert(activeEditSql.includes('ops_update_active_template'), 'RPC edit template aktif hilang')
assert(activeEditSql.includes("set_config('ops.allow_active_template_edit', 'on', true)"), 'Kunci edit template aktif hilang')
assert(activeEditSql.includes("errcode = '40001'"), 'Perlindungan revisi template aktif hilang')
assert(!activeEditSql.includes('ops_vehicle_monthly_reports'), 'Edit template tidak boleh menulis laporan tersimpan')
assert(!activeEditSql.includes('ops_prescribed_vehicles'), 'Edit template tidak boleh mengubah penetapan kendaraan')

const automaticNameSql = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20261026051506_ops_template_automatic_names.sql',
  import.meta.url,
)), 'utf8')
assert(automaticNameSql.includes("new.template_name := concat_ws(' - '"), 'Nama template harus dibentuk otomatis di database')
assert(automaticNameSql.includes("old.status = 'Draft' or (old.status = 'Aktif' and v_active_edit)"), 'Nama otomatis harus berlaku pada draft dan penyimpanan aktif')
assert(automaticNameSql.includes('if not v_items_unchanged then'), 'Perubahan nama saja harus mempertahankan snapshot alat')
assert(automaticNameSql.includes('v_items_after is distinct from v_items_before'), 'Koreksi nama lama harus memverifikasi isi dan harga tetap utuh')
assert(!/disable\s+trigger/i.test(automaticNameSql), 'Koreksi nama tidak boleh mematikan guard database')
assert(!automaticNameSql.includes('ops_vehicle_monthly_reports'), 'Koreksi nama tidak boleh mengubah laporan bulanan')
assert(!automaticNameSql.includes('ops_prescribed_vehicles'), 'Koreksi nama tidak boleh mengubah penetapan kendaraan')

const equipmentPricingSql = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20261025054509_ops_equipment_pricing.sql',
  import.meta.url,
)), 'utf8')
assert(equipmentPricingSql.includes('bpp_amount'), 'Kolom BPP katalog hilang')
assert(equipmentPricingSql.includes('monthly_cost'), 'Kolom Cost/Bulan katalog hilang')
assert(equipmentPricingSql.includes('ops_save_equipment_v3'), 'RPC simpan harga alat hilang')
assert(equipmentPricingSql.includes('ops_import_equipment_v2'), 'RPC impor harga alat hilang')

const templatePricingSql = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20261025054532_ops_template_pricing_snapshots.sql',
  import.meta.url,
)), 'utf8')
assert(templatePricingSql.includes('useful_life_months'), 'Snapshot masa manfaat template hilang')
assert(templatePricingSql.includes('ops_snapshot_template_item_prices'), 'Trigger snapshot harga template hilang')

const templateCostSql = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20261025055622_ops_template_cost_summary.sql',
  import.meta.url,
)), 'utf8')
assert(templateCostSql.includes('ops_list_template_costs'), 'Ringkasan biaya template hilang')
assert(templateCostSql.includes('ops_can_read_master'), 'Scope baca ringkasan biaya hilang')

const masterReadSql = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20261027110000_ops_master_read_exclude_ulp.sql',
  import.meta.url,
)), 'utf8')
assert(masterReadSql.includes("cm.contract_role <> 'ADMIN_ULP'"), 'Master tidak boleh terbaca oleh Admin ULP')

const repoUrl = new URL('./opsEquipmentRepository.js', import.meta.url)
const repo = readFileSync(fileURLToPath(repoUrl), 'utf8')
for (const fn of [
  'listOpsMasters', 'saveOpsMaster', 'listOpsEquipment', 'saveOpsEquipment',
  'listOpsTemplates', 'listOpsTemplateCosts', 'listOpsTemplateItems', 'saveOpsTemplateDraft',
  'updateOpsActiveTemplate', 'publishOpsTemplate', 'archiveOpsTemplate', 'duplicateOpsTemplate',
]) {
  assert(repo.includes(fn), `Repo ${fn} hilang`)
}
assert(repo.includes("rpc('ops_save_equipment_v3'"), 'Repo harga alat belum memakai RPC v3')
assert(repo.includes("rpc('ops_import_equipment_v2'"), 'Repo impor harga belum memakai RPC v2')
assert(!repo.includes('.delete('), 'Repo tidak boleh hapus destruktif')
assert(!repo.includes('Jumlah SLA'), 'Istilah Jumlah SLA dilarang, pakai Jumlah Kebutuhan')

const componentUrl = new URL('../components/sla/AlatKendaraanMaster.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
assert(component.includes('Master Data Alat & Kendaraan'), 'Judul modul hilang')
assert(component.includes('Jenis Kendaraan'), 'Tab jenis hilang')
assert(component.includes('Penugasan Kendaraan'), 'Tab penugasan hilang')
assert(component.includes('Kategori Peralatan'), 'Tab kategori hilang')
assert(component.includes('Daftar Peralatan'), 'Tab peralatan hilang')
assert(component.includes('Kebutuhan Peralatan'), 'Tab template hilang')
assert(component.includes('Jumlah Kebutuhan'), 'Label Jumlah Kebutuhan hilang')
assert(!component.includes('Jumlah SLA'), 'Istilah Jumlah SLA dilarang di UI')
assert(component.includes('read-only'), 'Penanda read-only ULP hilang')
assert(component.includes('untuk scope organisasi yang dipilih'), 'Keterangan scope dinamis hilang')
assert(!component.includes('Sei Duri, Bengkayang'), 'Daftar ULP tidak boleh hardcode')
assert(component.includes('Simpan Draft'), 'Aksi draft hilang')
assert(component.includes('Simpan Perubahan'), 'Aksi simpan template aktif hilang')
assert(component.includes("templateMeta?.status === 'Aktif'"), 'Mode edit template aktif hilang')
assert(component.includes('Edit Template Aktif'), 'Judul edit template aktif hilang')
assert(!component.includes("if (template.status !== 'Aktif')"), 'Template aktif tidak boleh mempertahankan nama manual lama')
assert(component.includes('const savedBaseline = templateSnapshot(next)'), 'Koreksi nama otomatis harus tetap terdeteksi sebagai perubahan')
assert(component.includes('templateName: saved.templateName'), 'Form harus memakai nama resmi yang dikembalikan server')
assert(component.includes('Terbitkan'), 'Aksi publikasi hilang')
assert(component.includes('Duplikasi'), 'Aksi duplikasi hilang')
assert(component.includes('Arsipkan'), 'Aksi arsip hilang')
assert(component.includes('Varian/Model'), 'Field varian hilang')
assert(component.includes('Informasi tambahan'), 'Bagian informasi tambahan hilang')
assert(component.includes('alkes-worksheet-table'), 'Tabel worksheet kebutuhan hilang')
assert(component.includes('BPP (Rp/Unit)'), 'Field BPP katalog hilang')
assert(component.includes('Cost/Bulan (Rp/Unit)'), 'Field Cost/Bulan katalog hilang')
assert(component.includes('alkes-equipment-form-modal'), 'Form alat harus memakai modal modern')
assert(component.includes('Simpan Alat'), 'Aksi simpan alat baru hilang')
assert(component.includes('Total/Bln'), 'Kolom total biaya template hilang')
assert(component.includes('Biaya/Bulan'), 'Ringkasan biaya pada daftar template hilang')
assert(component.includes('alkes-catalog-toolbar'), 'Pemilih katalog alat hilang')
assert(component.includes('onDirtyChange'), 'Perlindungan perubahan belum tersimpan hilang')
assert(component.includes('switchTab'), 'Konfirmasi pindah tab hilang')
assert(component.includes('Number.isSafeInteger(Number(raw))'), 'Jumlah kebutuhan harus divalidasi tanpa mengubah maknanya')
assert(component.includes('requiredQty: event.target.value }'), 'Input jumlah harus mempertahankan nilai yang diketik')
assert(repo.includes('published ? row.equipment_name'), 'Pratinjau terbitan harus memakai snapshot nama alat')
assert(component.includes('ListPagination'), 'Pagination daftar master hilang')
assert(component.includes('Sebelumnya') && component.includes('Berikutnya'), 'Kontrol pagination hilang')
assert(component.includes('nopol') === false && component.includes('Nomor Polisi') === false, 'Tahap 1 dilarang menyentuh nopol')

const css = readFileSync(fileURLToPath(new URL('../styles/index.css', import.meta.url)), 'utf8')
for (const className of ['alkes-worksheet-table', 'alkes-catalog-toolbar', 'alkes-savebar', 'alkes-field-wide']) {
  assert(css.includes(`.${className}`), `Style ${className} hilang`)
}

const modulesUrl = new URL('./slaPelayananTeknik.js', import.meta.url)
const modules = readFileSync(fileURLToPath(modulesUrl), 'utf8')
assert(modules.includes("id: 'alat-kendaraan'"), 'Modul navigasi hilang')
assert(modules.includes("name: 'Master Alat & Kendaraan'"), 'Nama modul master hilang')
assert(component.includes("id: 'template', label: 'Template Kebutuhan'"), 'Satu sumber template kendaraan harus tersedia')
assert(component.includes("id: 'penetapan', label: 'Penetapan Kendaraan'"), 'Penetapan kendaraan oleh UP3 harus tersedia')
assert(!component.includes("id: 'standar-ulp'"), 'Template ULP terpisah tidak boleh muncul lagi')
assert(component.includes('Katalog & Data Pendukung'), 'Katalog harus menjadi pengaturan pendukung')

const pageUrl = new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url)
const page = readFileSync(fileURLToPath(pageUrl), 'utf8')
assert(page.includes('AlatKendaraanMaster'), 'Render modul hilang')
assert(page.includes('canManage={isSuperAdmin || isAdminUp3}'), 'Hak tulis harus eksak SA/Admin UP3')

console.log(`Ops equipment master tests passed: ${passed}`)
