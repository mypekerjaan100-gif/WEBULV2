import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const cardUrl = new URL('../components/sla/EvidenceUploadCard.jsx', import.meta.url)
const card = readFileSync(fileURLToPath(cardUrl), 'utf8')
const lemburUrl = new URL('../components/sla/SLALembur.jsx', import.meta.url)
const lembur = readFileSync(fileURLToPath(lemburUrl), 'utf8')
const cssUrl = new URL('../styles/index.css', import.meta.url)
const css = readFileSync(fileURLToPath(cssUrl), 'utf8')

// Hooks yang dipakai browser test harus tetap ada.
for (const hook of ['lembur-upload-card', 'lembur-upload-card-heading', 'lembur-timemark-badge', 'lembur-dropzone', 'lembur-upload-icon', 'lembur-selected-files', 'lembur-selected-file', 'lembur-thumb-button', 'lembur-doc-icon']) {
  assert(card.includes(hook), `EvidenceUploadCard harus memakai class ${hook}`)
}
assert(card.includes('siap disimpan'), 'Label staged harus menyebut siap disimpan')
assert(card.includes('tersimpan'), 'Label tersimpan harus ada')
assert(card.includes('Preview'), 'Tombol Preview evidence tersimpan harus ada')
assert(card.includes('input[type=file]') || card.includes('type="file"'), 'Input file harus ada di kartu')
assert(lembur.includes("import EvidenceUploadCard from './EvidenceUploadCard.jsx'"), 'SLALembur harus memakai EvidenceUploadCard')
assert(lembur.includes('<EvidenceUploadCard'), 'Section evidence harus merender EvidenceUploadCard')
assert(lembur.includes('evidenceDoneCount'), 'Header evidence harus menampilkan progress')
assert(lembur.includes('<h3>Evidence</h3>'), 'Heading Evidence harus dipertahankan')

// Tidak ada lagi teks instruksi berulang per kartu.
assert(!card.includes('klik pilih file, lalu Simpan Draft'), 'Instruksi berulang per kartu harus dihapus')
assert(!css.includes('.lembur-dropzone::after'), 'Pseudo-element instruksi dropzone harus dihapus')
assert(!css.includes('.lembur-upload-card:nth-child(2)::after'), 'Tooltip hover nth-child harus dihapus')

// Grid responsif berbasis ruang, bukan jumlah kolom tetap.
assert(css.includes('repeat(auto-fit, minmax(250px, 1fr))'), 'Grid evidence harus responsif auto-fit')
assert(css.includes('.lembur-evidence-status'), 'Status per kartu harus punya style')
assert(css.includes('.lembur-evidence-progress'), 'Progress header harus punya style')
assert(css.includes('.lembur-evidence-locked-note'), 'Catatan terkunci harus punya style')

console.log(`Evidence upload UI tests passed: ${passed}`)
