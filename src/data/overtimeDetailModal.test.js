import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const cssUrl = new URL('../styles/index.css', import.meta.url)
const css = readFileSync(fileURLToPath(cssUrl), 'utf8')

// Modal Detail Lembur tidak boleh punya padding: celah padding membuat
// konten yang di-scroll terlihat di atas header sticky.
assert(
  css.includes('.rekap-detail-modal.lembur-detail-modal { max-width: 920px; padding: 0; }'),
  'Modal Detail Lembur harus memakai selector gabungan dengan padding 0 agar tidak tertimpa .rekap-detail-modal',
)

// Header detail harus tetap sticky di atas konten saat modal di-scroll.
assert(
  css.includes('.lembur-detail-header { position: sticky; top: 0;'),
  'Header Detail Lembur harus sticky di atas konten modal',
)

// Modal detail harus menjadi scroll container dengan batas tinggi.
for (const rule of ['max-height: 90vh', 'overflow: auto']) {
  assert(css.includes(rule), `Modal detail harus membatasi tinggi dan bisa di-scroll (${rule})`)
}

console.log(`Overtime detail modal tests passed: ${passed}`)
