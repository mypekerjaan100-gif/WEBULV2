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
for (const hook of ['lembur-upload-card', 'lembur-upload-card-heading', 'lembur-timemark-badge', 'lembur-dropzone', 'lembur-file-input', 'lembur-upload-icon', 'lembur-selected-files', 'lembur-selected-file', 'lembur-thumb-button', 'lembur-doc-icon']) {
  assert(card.includes(hook), `EvidenceUploadCard harus memakai class ${hook}`)
}
assert(card.includes('siap disimpan'), 'Label staged harus menyebut siap disimpan')
assert(card.includes('tersimpan'), 'Label tersimpan harus ada')
assert(card.includes('Preview'), 'Tombol Preview evidence tersimpan harus ada')
assert(card.includes('input[type=file]') || card.includes('type="file"'), 'Input file harus ada di kartu')
assert(lembur.includes("import EvidenceUploadCard from './EvidenceUploadCard.jsx'"), 'SLALembur harus memakai EvidenceUploadCard')
assert(lembur.includes('<EvidenceUploadCard'), 'Section evidence harus merender EvidenceUploadCard')
assert(lembur.includes('evidenceDoneCount'), 'Header evidence harus menampilkan progress')
assert(lembur.includes("'Evidence Bersama'") && lembur.includes('<h3>{isV2Work'), 'Heading Evidence Bersama/kondisional harus ada')

// Tidak ada lagi teks instruksi berulang per kartu.
assert(!card.includes('klik pilih file, lalu Simpan Draft'), 'Instruksi berulang per kartu harus dihapus')
assert(!css.includes('.lembur-dropzone::after'), 'Pseudo-element instruksi dropzone harus dihapus')
assert(!css.includes('.lembur-upload-card:nth-child(2)::after'), 'Tooltip hover nth-child harus dihapus')

// Grid responsif berbasis ruang, bukan jumlah kolom tetap.
assert(css.includes('repeat(auto-fit, minmax(250px, 1fr))'), 'Grid evidence harus responsif auto-fit')
assert(css.includes('.lembur-evidence-status'), 'Status per kartu harus punya style')
assert(css.includes('.lembur-evidence-progress'), 'Progress header harus punya style')
assert(css.includes('.lembur-evidence-locked-note'), 'Catatan terkunci harus punya style')

// Badge progres tidak boleh ikut style ikon langkah 26px.
assert(!css.includes('.lembur-section-heading > span'), 'Selector generik section-heading > span harus dihapus agar badge progres tidak terpotong')
assert(css.includes('.lembur-step-badge'), 'Ikon langkah harus memakai class khusus')
assert(css.includes('.lembur-section-heading-text'), 'Teks heading harus punya wrapper flex')
assert(lembur.includes('lembur-step-badge'), 'SLALembur harus memakai lembur-step-badge')
assert(lembur.includes('lembur-section-heading-text'), 'SLALembur harus memakai wrapper teks heading')

// Input file native tidak boleh terlihat; pakai teknik visually-hidden yang andal.
assert(card.includes('lembur-file-input'), 'Input file harus memakai class khusus')
assert(css.includes('.lembur-file-input'), 'CSS harus menyembunyikan input file khusus')
assert(css.includes('clip-path: inset(50%)'), 'Input file harus disembunyikan dengan clip-path')
assert(!css.includes('.lembur-dropzone input { position: absolute; inset: 0'), 'Overlay input full-size harus dihapus')

// Header kartu harus wrap rapi saat badge TimeMark + status berdampingan.
assert(css.includes('.lembur-upload-card-heading { display: flex; flex-wrap: wrap'), 'Header kartu harus wrap')
assert(css.includes('.lembur-evidence-badges { display: inline-flex; flex: 0 1 auto'), 'Badges kartu harus bisa wrap ke kanan')

console.log(`Evidence upload UI tests passed: ${passed}`)
