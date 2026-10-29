import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const foundation = read('../../supabase/migrations/20261028100000_ops_tool_inspection_foundation.sql')
const rpcs = read('../../supabase/migrations/20261028101000_ops_tool_inspection_rpcs.sql')
const restoredReports = read('../../supabase/migrations/20261028102000_ops_vehicle_condition_reports_restore.sql')
const panel = read('../components/sla/UlpToolUnitPanel.jsx')
const matrix = read('../components/sla/UlpToolInspectionMatrix.jsx')
const evidenceUi = read('../components/sla/ToolEvidence.jsx')
const report = read('../components/sla/UlpConditionReport.jsx')
const repo = read('../data/toolInspectionRepository.js')
const evidence = read('../data/toolEvidence.js')
const page = read('../pages/sla/SLAPelayananTeknikPage.jsx')
const app = read('../App.jsx')
const notifications = read('../data/approvalNotificationRepository.js')
const previewGuard = read('../lib/previewWriteGuard.js')
const vehicleMigration = read('../../supabase/migrations/20261029100000_ops_vehicle_inspections.sql')
const vehicleModal = read('../components/sla/VehicleInspectionModal.jsx')
const vehicleResult = read('../components/sla/VehicleInspectionResultModal.jsx')
const style = read('../styles/index.css')

// --- Fondasi data ---
for (const table of ['ops_tool_assets', 'ops_tool_inspections', 'ops_tool_issues']) {
  assert(foundation.includes(`create table if not exists public.${table}`), `Tabel ${table} hilang`)
}
assert(foundation.includes('asset_sequence integer not null'), 'Urutan unit fisik alat hilang')
assert(foundation.includes('commissioned_at timestamptz'), 'Waktu mulai masa pakai hilang')
assert(foundation.includes("status text not null default 'ACTIVE'"), 'Status unit alat hilang')
assert(foundation.includes('photo_paths jsonb not null'), 'Bukti foto inspeksi hilang')
assert(foundation.includes('handover_photo_paths jsonb'), 'Bukti foto serah terima hilang')
assert(foundation.includes('replacement_asset_id uuid'), 'Tautan alat pengganti hilang')
assert(foundation.includes('damaged_before_life boolean'), 'Penanda rusak sebelum masa pakai hilang')
assert(foundation.includes('ops_tool_issues_one_open_per_asset'), 'Satu issue terbuka per alat harus unik')
assert(foundation.includes('create trigger trg_ops_seed_tool_assets'), 'Seed alat untuk kendaraan baru hilang')
assert(foundation.includes("('ops-tool-evidence', 'ops-tool-evidence'"), 'Bucket bukti alat hilang')
assert(foundation.includes("'alat.inspect'") && foundation.includes("'alat.issue.resolve'"), 'Izin inspeksi/penyelesaian hilang')
assert(foundation.includes('authorization_grant_tool_permissions'), 'Pewarisan izin role edit alat hilang')

// --- RPC dan penjagaan ---
for (const name of [
  'ops_submit_tool_inspection',
  'ops_resolve_tool_issue',
  'ops_get_tool_inspection_bundle',
  'ops_list_open_tool_issues',
]) {
  assert(rpcs.includes(`function public.${name}`), `RPC ${name} hilang`)
}
assert(rpcs.includes('ops_tool_can_inspect_scope'), 'Gate inspeksi hilang')
assert(rpcs.includes('ops_tool_can_resolve_scope'), 'Gate penyelesaian issue hilang')
assert(rpcs.includes('ops_vehicle_can_manage_plate'), 'Gate nopol Admin ULP hilang')
assert(rpcs.includes('select public.ops_vehicle_can_manage_plate'), 'Nopol harus memakai gate khusus')
assert(rpcs.includes("'alat.inspect'"), 'Izin inspeksi harus diperiksa')
assert(rpcs.includes("'alat.issue.resolve'"), 'Izin penyelesaian harus diperiksa')
assert(rpcs.includes('Masih ada issue terbuka pada alat ini'), 'Issue terbuka harus menghalangi inspeksi ulang')
assert(rpcs.includes("v_condition not in ('GOOD', 'DAMAGED')"), 'Validasi kondisi alat hilang')
assert(rpcs.includes('Minimal satu foto bukti wajib diunggah'), 'Validasi foto hilang')
assert(rpcs.includes('Foto bukti berada di luar scope ULP ini'), 'Validasi scope foto hilang')
assert(rpcs.includes('commissioned_at = p_resolved_at') === false, 'Waktu serah terima harus lewat kolom insert')
assert(rpcs.includes("commissioned_at, commissioned_by") && rpcs.includes('p_resolved_at, auth.uid()'), 'Awal masa pakai alat pengganti hilang')
assert(rpcs.includes("status = 'REPLACED'"), 'Alat lama harus ditutup sebagai diganti')
assert(rpcs.includes('age_at_failure_months'), 'Umur saat rusak hilang')
assert(rpcs.includes('damaged_before_life = v_before_life'), 'Perbandingan umur standar hilang')
assert(rpcs.includes('Pemeriksaan agregat telah diganti'), 'Penutupan sementara alur agregat hilang dari migrasi lama')
assert(rpcs.includes("where i.slot_id = s.id and i.status = 'OPEN'"), 'Slot dengan issue terbuka harus tetap tampil')
assert(rpcs.includes("ops_tool_evidence_select"), 'Policy baca bukti hilang')
assert(rpcs.includes("ops_tool_evidence_insert"), 'Policy unggah bukti hilang')

// --- Rekap bulanan dikembalikan sebagai laporan utama ---
assert(restoredReports.includes('function public.ops_save_vehicle_condition_report'), 'RPC rekap bulanan harus dipulihkan')
assert(restoredReports.includes('function public.ops_save_vehicle_condition_subset'), 'RPC subset kendaraan harus dipulihkan')
assert(!restoredReports.includes('Pemeriksaan agregat telah diganti'), 'Rekap tidak boleh tetap diblokir')
assert(restoredReports.includes('function public.ops_vehicle_can_report'), 'Gate penulis rekap hilang')
assert(restoredReports.includes("'alat.inspect'"), 'Penulis rekap harus memakai izin inspeksi')
assert(restoredReports.includes('Good + damaged quantity must equal required quantity'), 'Validasi Baik + Rusak harus sama dengan kontrak')
assert(restoredReports.includes("'available_qty', case when v_spec ->> 'kind' = 'vehicle' then v_good + v_bad"), 'Ada di ULP harus dihitung server')
assert(restoredReports.includes("else (v_spec ->> 'required_qty')::bigint end"), 'Ada di ULP harus sama dengan jumlah kontrak')
assert(restoredReports.includes('ops_vehicle_can_report(new.contract_id'), 'Trigger rekap harus memakai gate penulis baru')
assert(restoredReports.includes("'INSPECTOR'"), 'Aktor inspeksi harus tercatat di riwayat')
assert(restoredReports.includes('actor_role in (\'SUPER_ADMIN\', \'ADMIN_UP3\', \'ADMIN_ULP\', \'INSPECTOR\')'), 'Constraint aktor riwayat harus menerima inspektur')

// --- Repository ---
assert(repo.includes("rpc('ops_submit_tool_inspection'"), 'Repository inspeksi hilang')
assert(repo.includes("rpc('ops_resolve_tool_issue'"), 'Repository serah terima hilang')
assert(repo.includes("rpc('ops_get_tool_inspection_bundle'"), 'Repository laporan hilang')
assert(repo.includes("rpc('ops_list_open_tool_issues'"), 'Repository notifikasi issue hilang')
assert(repo.includes("bucket_id = 'ops-tool-evidence'") === false && repo.includes("from('ops-tool-evidence')"), 'Bucket bukti tidak dipakai')
assert(repo.includes('crypto.randomUUID()'), 'Nama berkas bukti harus unik')
assert(evidence.includes('prepareToolEvidence'), 'Kompresi bukti hilang')
assert(evidence.includes("'image/jpeg'") && evidence.includes("'image/png'") && evidence.includes("'image/webp'"), 'Format bukti harus dibatasi')

// --- UI rekap + inspeksi dalam satu baris alat ---
assert(matrix.includes(' Kontrak</span>') && report.includes('Jumlah Baik + Rusak harus sama dengan jumlah kontrak'), 'Kolom jumlah kontrak hilang')
assert(matrix.includes('Ada di ULP'), 'Kolom ada di ULP hilang')
assert(matrix.includes('>Baik<') && matrix.includes('>Rusak<'), 'Kolom Baik/Rusak hilang')
assert(matrix.includes('{item.required_qty}'), 'Nilai kontrak harus ditampilkan')
assert(matrix.includes('tool-matrix-inspection'), 'Inspeksi harus berada di baris alat')
assert(matrix.includes('tool-unit-card'), 'Kartu unit harus berada di kolom inspeksi')
assert(matrix.includes('open={Boolean(editor)}'), 'Form inspeksi harus terbuka sebagai modal fokus')
assert(matrix.includes('Simpan Inspeksi') && matrix.includes('Simpan Serah Terima'), 'Simpan form harus melalui modal')
assert(matrix.includes('vehicleLabel'), 'Modal inspeksi harus menampilkan kendaraan alat')
assert(matrix.includes('tool-modal-scope'), 'Modal inspeksi harus memperjelas unit dan alat')
assert(matrix.includes('Isi Inspeksi') && matrix.includes('Serah Terima Pengganti'), 'Judul modal inspeksi hilang')
assert(matrix.includes('Inspeksi'), 'Aksi inspeksi hilang')
assert(matrix.includes('Serah Terima'), 'Aksi penyelesaian issue hilang')
assert(matrix.includes('Foto bukti'), 'Input foto inspeksi hilang')
assert(matrix.includes('Rusak sebelum masa pakai'), 'Peringatan umur alat hilang')
assert(matrix.includes('Awal masa pakai belum tercatat'), 'Status umur tidak diketahui hilang')
assert(matrix.includes('Riwayat penggantian'), 'Riwayat penggantian hilang')
assert(matrix.includes('onQuantityChange'), 'Isian jumlah harus tetap terhubung')
assert(matrix.includes('showInspections'), 'Opsi arsip tanpa inspeksi hilang')
assert(evidenceUi.includes('PhotoPicker') && evidenceUi.includes('EvidenceThumbs'), 'Komponen bukti bersama hilang')
assert(report.includes('UlpToolInspectionMatrix'), 'Matriks inspeksi harus dipakai di halaman detail')
assert(report.includes('uc-vehicle-page'), 'Detail kendaraan harus menjadi halaman, bukan modal')
assert(report.includes('Kembali ke daftar kendaraan'), 'Halaman detail harus punya tombol kembali')
assert(report.includes('uc-page-footer') === false && report.includes('Simpan Rekap'), 'Aksi simpan harus di header bagian, tanpa footer yang membeku')
assert(report.includes('uc-vehicle-hero') && report.includes('Detail acuan'), 'Ringkasan kendaraan harus padat dan detail acuan terpisah lewat pembuka')
assert(report.includes('uc-tool-guide') && report.includes('Panduan pengisian'), 'Petunjuk panjang harus menjadi bagian yang bisa dibuka')
assert(report.includes('AlkesModal') === false, 'Detail kendaraan tidak boleh dirender sebagai modal lagi')
assert(report.includes('vehicleLabel={selectedVehicle.plate_display'), 'Mode inspeksi harus tahu nopol kendaraan')
assert(report.includes('inspectionStatus={toolStatus}'), 'Status rincian unit harus diteruskan')
assert(report.includes('showInspections={!historical}'), 'Arsip harus menyembunyikan inspeksi terkini')
assert(report.includes('Jumlah Baik + Rusak harus sama dengan jumlah kontrak'), 'Aturan jumlah lama hilang')
assert(report.includes('selectedOpenIssues.length > 0'), 'Peringatan issue terbuka pada rekap hilang')
assert(report.includes('Buka Rincian Unit'), 'Issue kendaraan nonaktif harus tetap bisa dibuka')
assert(report.includes('Kendaraan tidak aktif pada periode ini'), 'Penanda kendaraan nonaktif hilang')
assert(report.includes('UlpToolUnitPanel'), 'Tampilan fokus kendaraan nonaktif harus tetap tersedia')
assert(report.includes('canManagePlate'), 'Hak nopol harus terpisah dari isian rekap')
assert(report.includes('canInspect'), 'Hak inspeksi harus diteruskan ke matriks')
assert(report.includes('issueTarget'), 'Target issue dari notifikasi hilang')

assert(panel.includes('canInspect'), 'Hak inspeksi hilang pada tampilan fokus')
assert(panel.includes('canResolveIssue'), 'Hak penyelesaian issue hilang pada tampilan fokus')
assert(panel.includes('Inspeksi terakhir'), 'Kolom tanggal inspeksi hilang pada tampilan fokus')
assert(panel.includes('Foto bukti'), 'Input foto inspeksi hilang pada tampilan fokus')
assert(panel.includes('Selesaikan'), 'Aksi penyelesaian issue hilang pada tampilan fokus')
assert(panel.includes('Rusak sebelum masa pakai'), 'Peringatan umur alat hilang pada tampilan fokus')
assert(panel.includes('Awal masa pakai belum tercatat'), 'Status umur tidak diketahui hilang pada tampilan fokus')
assert(panel.includes('serah terima'), 'Alur serah terima hilang pada tampilan fokus')
assert(panel.includes('Riwayat penggantian'), 'Riwayat penggantian hilang pada tampilan fokus')
assert(panel.includes('Rincian ini tambahan'), 'Penanda fitur tambahan hilang pada tampilan fokus')

assert(page.includes("import UlpConditionReport from '../../components/sla/UlpConditionReport.jsx'"), 'Halaman harus memakai rekap bulanan')
assert(page.includes("canManage={isSuperAdmin || (isCustomRole && customCanEdit('alat_kendaraan'))}"), 'Isian rekap bukan untuk K3')
assert(page.includes('canManagePlate={isSuperAdmin || isAdminUlp}'), 'Nopol bukan hanya SA/Admin ULP')
assert(page.includes("canInspect={isSuperAdmin || (isCustomRole && customCanEdit('alat_kendaraan'))}"), 'K3 harus menjadi inspektur')
assert(page.includes('issueTarget={toolIssueTarget}'), 'Target issue dari notifikasi hilang')
assert(app.includes("label: 'Alat & Kendaraan'") === false, 'Sumber notifikasi tidak boleh hanya label UI')
assert(notifications.includes("id: 'alat'") && notifications.includes('listOpenToolIssues'), 'Notifikasi issue alat hilang')
assert(app.includes("item.source === 'alat'"), 'Navigasi notifikasi alat hilang')
assert(app.includes("setToolIssueTarget"), 'Target issue alat hilang')
assert(previewGuard.includes('resolve'), 'RPC penyelesaian harus diblokir saat pratinjau')

// --- Inspeksi kendaraan (role K3) ---
for (const name of ['ops_submit_vehicle_inspection', 'ops_get_vehicle_last_inspections']) {
  assert(vehicleMigration.includes(`function public.${name}`), `RPC inspeksi kendaraan ${name} hilang`)
}
for (const name of [
  'ops_vehicle_can_read_inspections',
  'ops_vehicle_can_submit_inspection',
  'ops_validate_vehicle_photo_paths',
  'ops_vehicle_inspection_photos_object_valid',
]) {
  assert(vehicleMigration.includes(`function public.${name}`), `Helper inspeksi kendaraan ${name} hilang`)
}
assert(vehicleMigration.includes('create table if not exists public.ops_vehicle_inspections'), 'Tabel inspeksi kendaraan hilang')
assert(vehicleMigration.includes("condition text not null check (condition in ('GOOD', 'DAMAGED'))"), 'Kondisi kendaraan harus GOOD/DAMAGED')
assert(vehicleMigration.includes('note text not null default \'\' check (length(note) <= 2000)'), 'Catatan inspeksi kendaraan hilang')
assert(vehicleMigration.includes("'ops-vehicle-inspections', 'ops-vehicle-inspections'"), 'Bucket foto inspeksi kendaraan hilang')
assert(vehicleMigration.includes('ops_vehicle_inspection_select') && vehicleMigration.includes('ops_vehicle_inspection_insert'), 'Policy foto kendaraan hilang')
assert(vehicleMigration.includes("'alat.inspect'"), 'Inspeksi kendaraan harus memakai izin K3 alat.inspect')
for (const slot of ['SIDE_RIGHT', 'SIDE_LEFT', 'FRONT', 'REAR']) {
  assert(vehicleMigration.includes(`'${slot}'`), `Slot foto ${slot} hilang`)
}
assert(vehicleMigration.includes('512000'), 'Batas 500 KB per foto harus ditegakkan di server')
assert(vehicleMigration.includes("o.metadata ->> 'size'"), 'Ukuran foto harus dicek dari metadata penyimpanan')
assert(vehicleMigration.includes('Vehicle inspections are append-only'), 'Riwayat inspeksi kendaraan harus append-only')
assert(vehicleMigration.includes("date_trunc('month', (p_inspected_at at time zone 'Asia/Pontianak'))"), 'Periode inspeksi harus mengikuti waktu Pontianak')
assert(vehicleMigration.includes('s.effective_month <= v_month and (s.end_month is null or v_month < s.end_month)'), 'Kendaraan tidak aktif pada periode inspeksi harus ditolak')
assert(vehicleMigration.includes('Kondisi kendaraan harus Baik atau Rusak'), 'Validasi kondisi kendaraan hilang')
assert(vehicleMigration.includes('Waktu inspeksi tidak boleh melewati waktu sekarang'), 'Waktu inspeksi tidak boleh masa depan')
assert(vehicleMigration.includes('distinct on (slot_id)'), 'Inspeksi terakhir harus satu per kendaraan')
assert(vehicleMigration.includes('public.profiles p on p.id = v.inspected_by'), 'Nama petugas inspeksi kendaraan harus diisi')

assert(repo.includes("rpc('ops_submit_vehicle_inspection'") && repo.includes("rpc('ops_get_vehicle_last_inspections'"), 'Repository inspeksi kendaraan hilang')
assert(repo.includes("from('ops-vehicle-inspections')"), 'Unggahan foto kendaraan harus memakai bucket khusus')
assert(repo.includes('slotKey'), 'Jalur berkas foto harus memuat kunci slot')

assert(evidence.includes('prepareVehicleEvidence'), 'Kompresi foto inspeksi kendaraan hilang')
assert(evidence.includes('VEHICLE_TARGET_BYTES = 500 * 1024'), 'Target 500 KB foto kendaraan hilang')
assert(evidence.includes('bawah 500 KB'), 'Pesan batas 500 KB harus jelas')

assert(vehicleModal.includes("key: 'SIDE_RIGHT'") && vehicleModal.includes('Samping kanan'), 'Slot samping kanan hilang')
assert(vehicleModal.includes("key: 'SIDE_LEFT'") && vehicleModal.includes('Samping kiri'), 'Slot samping kiri hilang')
assert(vehicleModal.includes("key: 'FRONT'") && vehicleModal.includes('Tampak depan'), 'Slot tampak depan hilang')
assert(vehicleModal.includes("key: 'REAR'") && vehicleModal.includes('Tampak belakang'), 'Slot tampak belakang hilang')
assert(vehicleModal.includes('Simpan Inspeksi'), 'Aksi simpan inspeksi kendaraan hilang')
assert(vehicleModal.includes('prepareVehicleEvidence'), 'Foto wajib dikompresi saat dipilih')
assert(vehicleModal.includes('datetime-local'), 'Isian tanggal & jam inspeksi hilang')
assert(vehicleModal.includes('Catatan'), 'Kolom catatan bebas hilang')
assert(vehicleModal.includes('window.confirm'), 'Menutup form yang masih diisi harus dikonfirmasi')
assert(vehicleModal.includes('onEditorStateChange'), 'Status dirty/busy modal harus diumumkan')

// --- Tampilan hasil inspeksi kendaraan ---
assert(repo.includes('function getVehicleInspectionPhotoUrl'), 'Helper signed URL foto inspeksi kendaraan hilang')
assert(vehicleResult.includes("from './VehicleInspectionModal.jsx'"), 'Slot 4 foto harus dipakai ulang dari modal inspeksi, bukan digandakan')
assert(vehicleResult.includes('getVehicleInspectionPhotoUrl'), 'Foto hasil harus dimuat lewat signed URL bucket privat')
assert(vehicleResult.includes('target="_blank"'), 'Foto harus bisa dibuka ukuran penuh')
assert(vehicleResult.includes('Muat ulang'), 'Foto gagal dimuat harus punya tombol coba lagi')
assert(vehicleResult.includes('vehicle-photo-slot-label'), 'Slot hasil harus menampilkan label foto')
assert(vehicleResult.includes('ui-icon-spin'), 'Status memuat foto harus terlihat')
assert(vehicleResult.includes("const damaged = inspection?.condition === 'DAMAGED'"), 'Lencana kondisi hasil harus Baik/Rusak')
assert(vehicleResult.includes("note ? note : 'Tidak ada catatan.'"), 'Catatan kosong harus jelas di modal hasil')

assert(report.includes('VehicleInspectionResultModal'), 'Modal hasil inspeksi kendaraan harus dirender di detail kendaraan')
assert(report.includes('Lihat Hasil Inspeksi'), 'Tombol lihat hasil inspeksi hilang')
assert(report.includes('melihat hasil dan fotonya'), 'Pesan tersimpan harus mengarah ke Lihat Hasil Inspeksi')

assert(style.includes('.vehicle-result-badge--good') && style.includes('.vehicle-result-badge--damaged'), 'Gaya lencana kondisi hasil inspeksi hilang')
assert(style.includes('.vehicle-photo-retry'), 'Gaya tombol muat ulang foto inspeksi hilang')

// Preview hasil besar dan utuh, tanpa mengubah preview form unggah.
assert(vehicleResult.includes('className="ui-modal-vehicle-result"'), 'Modal hasil harus punya kelas khusus untuk lebar preview')
assert(vehicleResult.includes('className="vehicle-photo-grid vehicle-result-grid"'), 'Grid hasil harus terpisah dari grid form unggah')
assert(/\.ui-modal\.ui-modal-vehicle-result\s*\{\s*width: min\(100%, 1100px\);\s*\}/.test(style), 'Modal hasil harus responsif dengan lebar maksimum 1100px')
assert(/\.vehicle-result-grid \.vehicle-photo-slot-frame\s*\{\s*height: clamp\(280px, 28vw, 320px\);\s*\}/.test(style), 'Preview hasil harus setinggi 280–320px pada desktop')
assert(/\.vehicle-result-grid \.vehicle-photo-slot-frame > a\s*\{\s*display: flex;\s*width: 100%;\s*height: 100%;\s*\}/.test(style), 'Tautan foto hasil harus memenuhi kotak preview')
assert(/\.vehicle-result-grid \.vehicle-photo-slot-frame img\s*\{[^}]*object-fit: contain;/.test(style), 'Foto hasil harus ditampilkan utuh, tidak terpotong')
assert(/@media \(max-width: 720px\)\s*\{\s*\.vehicle-result-grid\s*\{\s*grid-template-columns: 1fr;/.test(style), 'Grid hasil harus menjadi satu kolom pada layar kecil')
assert(/\.vehicle-photo-slot-frame\s*\{[^}]*height: 92px;/.test(style), 'Ukuran preview form unggah tidak boleh ikut berubah')

assert(report.includes('VehicleInspectionModal'), 'Modal inspeksi kendaraan harus dirender di detail kendaraan')
assert(report.includes('listVehicleLastInspections'), 'Inspeksi terakhir harus dimuat per scope ULP')
assert(report.includes('Belum diinspeksi'), 'Keterangan belum diinspeksi hilang')
assert(report.includes('Inspeksi Kendaraan'), 'Tombol inspeksi kendaraan hilang')
assert(report.includes('camera'), 'Ikon kamera inspeksi hilang')
assert(report.includes('vehicleInspectionBusy'), 'Status modal inspeksi kendaraan harus digabung ke editor state halaman')

console.log(`toolInspection.test.js: ${passed} assertions passed`)
