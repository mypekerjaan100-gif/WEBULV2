import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const form = read('../components/sla/SLALembur.jsx')
const page = read('../pages/sla/SLAPelayananTeknikPage.jsx')

assert(
  !form.includes('Tanggal lembur harus berada dalam periode yang dipilih.'),
  'Pengajuan baru tidak boleh ditolak hanya karena beda bulan',
)
assert(
  form.includes('isCrossPeriodDate(draft.date, periodMonth)'),
  'Form harus membedakan tanggal lintas periode',
)
assert(
  form.includes('Draft masuk periode ${periodLabelForDate(crossPeriodDate)}'),
  'Pesan simpan draft harus menyebut periode tujuan',
)
assert(
  form.includes('Tersimpan pada periode ${periodLabelForDate(submitCrossPeriodDate)}'),
  'Pesan ajukan harus menyebut periode tujuan',
)
assert(
  form.includes('Buka periode {periodLabelForDate(savedCrossPeriodDate)}'),
  'Pengguna harus dapat membuka periode hasil simpan',
)
assert(
  form.includes('onOpenPeriod(savedCrossPeriodDate)'),
  'Tombol periode harus memakai tanggal pengajuan',
)
assert(
  page.includes('onOpenPeriod={(date) =>') && page.includes('periodLabelFromMonth(`${String(date).slice(0, 7)}-01`)'),
  'Halaman harus meneruskan tombol periode ke pemilih periode',
)
assert(
  page.includes("if (target && target !== period) setPeriod(target)"),
  'Membuka periode harus mengganti periode laporan',
)

console.log(`overtimeCrossMonth.test.js: ${passed} assertions passed`)
