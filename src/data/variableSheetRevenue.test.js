import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const componentUrl = new URL('../components/sla/SLAVariableCost.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
let passed = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

assert(component.includes('renderSheetRevenue'), 'Render pendapatan spreadsheet hilang')
assert(component.includes('realization * price'), 'Rumus realisasi × harga hilang')
assert(component.includes('Harga belum diatur'), 'Status harga hilang')
assert(component.includes('Tidak Ditagihkan'), 'ROW Fix non-tagih hilang')
assert(component.includes('sheetUuidSet'), 'Anti hitung ganda hilang')
assert(component.includes('listVariableUnitPrices'), 'Harga satuan harus dimuat di rekap')
assert(component.includes('periodEndOf'), 'Harga akhir periode hilang')
assert(component.includes('Data gagal dimuat'), 'Status error spreadsheet hilang')
assert(!component.includes('canViewVariableFinancial && <td>{EMPTY_VALUE}</td>'), 'Sel pendapatan spreadsheet tidak boleh hardcode kosong')

console.log(`Variable sheet revenue tests passed: ${passed}`)
