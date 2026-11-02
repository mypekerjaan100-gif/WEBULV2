import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const migration = read('../../supabase/migrations/20261102075127_handover_verifies_tool_unit.sql')
const evidenceUi = read('../components/sla/ToolEvidence.jsx')
const matrix = read('../components/sla/UlpToolInspectionMatrix.jsx')
const panel = read('../components/sla/UlpToolUnitPanel.jsx')
const report = read('../components/sla/UlpConditionReport.jsx')

assert(
  migration.includes("'handover', (") && migration.includes("'handover_photo_paths'"),
  'Bundle harus mengirim bukti Serah Terima untuk unit pengganti',
)
assert(
  migration.includes('h.replacement_asset_id=a.id') && migration.includes('h.resolved_at>=v_start')
    && migration.includes('h.resolved_at<v_end'),
  'Serah Terima harus dihitung sebagai pemeriksaan pada bulannya',
)
assert(
  migration.includes('status=\'RESOLVED\'') || migration.includes("status = 'RESOLVED'"),
  'Hanya Serah Terima selesai yang boleh dihitung',
)
assert(
  migration.includes('ops_tool_issues_replacement_asset'),
  'Pencarian bukti pengganti harus memakai indeks',
)
assert(
  evidenceUi.includes("label: 'Baik · sudah diperiksa'"),
  'Status unit setelah Serah Terima harus sudah diperiksa',
)
assert(
  matrix.includes('Bukti serah terima') && matrix.includes('handover.resolved_by_name'),
  'Rincian unit harus menampilkan bukti dan petugas Serah Terima',
)
assert(
  panel.includes('asset.latest_inspection || asset.handover?.resolved_at'),
  'Jumlah unit diperiksa harus memasukkan Serah Terima',
)
assert(
  panel.includes('Serah terima oleh') && panel.includes('asset.handover.photo_paths'),
  'Panel unit harus menampilkan bukti Serah Terima',
)
assert(
  matrix.includes('tercatat sudah diperiksa'),
  'Pesan Serah Terima harus menyatakan unit sudah diperiksa',
)
assert(
  report.includes('Serah Terima pengganti dengan bukti dihitung sebagai pemeriksaan'),
  'Petunjuk laporan harus menjelaskan Serah Terima sebagai pemeriksaan',
)

console.log(`toolHandoverVerification.test.js: ${passed} assertions passed`)
