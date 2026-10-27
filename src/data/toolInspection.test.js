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
const component = read('../components/sla/UlpToolInspection.jsx')
const repo = read('../data/toolInspectionRepository.js')
const evidence = read('../data/toolEvidence.js')
const page = read('../pages/sla/SLAPelayananTeknikPage.jsx')
const app = read('../App.jsx')
const notifications = read('../data/approvalNotificationRepository.js')
const previewGuard = read('../lib/previewWriteGuard.js')

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
assert(rpcs.includes('Pemeriksaan agregat telah diganti'), 'Alur agregat lama harus ditutup')
assert(rpcs.includes("where i.slot_id = s.id and i.status = 'OPEN'"), 'Slot dengan issue terbuka harus tetap tampil')
assert(rpcs.includes("ops_tool_evidence_select"), 'Policy baca bukti hilang')
assert(rpcs.includes("ops_tool_evidence_insert"), 'Policy unggah bukti hilang')

// --- Repository ---
assert(repo.includes("rpc('ops_submit_tool_inspection'"), 'Repository inspeksi hilang')
assert(repo.includes("rpc('ops_resolve_tool_issue'"), 'Repository serah terima hilang')
assert(repo.includes("rpc('ops_get_tool_inspection_bundle'"), 'Repository laporan hilang')
assert(repo.includes("rpc('ops_list_open_tool_issues'"), 'Repository notifikasi issue hilang')
assert(repo.includes("bucket_id = 'ops-tool-evidence'") === false && repo.includes("from('ops-tool-evidence')"), 'Bucket bukti tidak dipakai')
assert(repo.includes('crypto.randomUUID()'), 'Nama berkas bukti harus unik')
assert(evidence.includes('prepareToolEvidence'), 'Kompresi bukti hilang')
assert(evidence.includes("'image/jpeg'") && evidence.includes("'image/png'") && evidence.includes("'image/webp'"), 'Format bukti harus dibatasi')

// --- UI K3 dan Admin ULP ---
assert(component.includes("canManagePlate"), 'Hak nopol harus terpisah')
assert(component.includes("canInspect"), 'Hak inspeksi hilang')
assert(component.includes("canResolveIssue"), 'Hak penyelesaian issue hilang')
assert(component.includes('Inspeksi terakhir'), 'Kolom tanggal inspeksi hilang')
assert(component.includes('Foto bukti'), 'Input foto inspeksi hilang')
assert(component.includes('Selesaikan issue'), 'Aksi penyelesaian issue hilang')
assert(component.includes('Rusak sebelum masa pakai'), 'Peringatan umur alat hilang')
assert(component.includes('Awal masa pakai belum tercatat'), 'Status umur tidak diketahui hilang')
assert(component.includes('serah terima'), 'Alur serah terima hilang')
assert(component.includes('Temuan terbuka'), 'Daftar issue terbuka hilang')
assert(component.includes('Riwayat penggantian'), 'Riwayat penggantian hilang')

assert(page.includes("import UlpToolInspection from '../../components/sla/UlpToolInspection.jsx'"), 'Halaman harus memakai inspeksi per alat')
assert(page.includes('canManagePlate={isSuperAdmin || isAdminUlp}'), 'Nopol bukan hanya SA/Admin ULP')
assert(page.includes("canInspect={isSuperAdmin || (isCustomRole && customCanEdit('alat_kendaraan'))}"), 'K3 harus menjadi inspektur')
assert(page.includes('issueTarget={toolIssueTarget}'), 'Target issue dari notifikasi hilang')
assert(app.includes("label: 'Alat & Kendaraan'") === false, 'Sumber notifikasi tidak boleh hanya label UI')
assert(notifications.includes("id: 'alat'") && notifications.includes('listOpenToolIssues'), 'Notifikasi issue alat hilang')
assert(app.includes("item.source === 'alat'"), 'Navigasi notifikasi alat hilang')
assert(app.includes("setToolIssueTarget"), 'Target issue alat hilang')
assert(previewGuard.includes('resolve'), 'RPC penyelesaian harus diblokir saat pratinjau')

console.log(`toolInspection.test.js: ${passed} assertions passed`)
