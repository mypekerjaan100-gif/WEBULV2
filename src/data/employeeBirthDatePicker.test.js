import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const componentUrl = new URL('../components/sla/SLADatabasePegawai.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')

const bindingIndex = component.indexOf('birthDate: e.target.value')
assert(bindingIndex >= 0, 'Binding form.birthDate hilang')
const section = component.slice(Math.max(0, bindingIndex - 600), bindingIndex + 200)
assert(section.includes('type="date"'), 'Field Tanggal Lahir harus memakai date picker (type="date")')
assert(section.includes('form.birthDate'), 'Date picker harus terikat ke form.birthDate')
assert(section.includes('Tanggal Lahir'), 'Label Tanggal Lahir hilang')
assert(
  !component.includes('Tanggal Lahir (YYYY-MM-DD)'),
  'Hint format manual YYYY-MM-DD harus dihapus karena date picker sudah menangani format',
)

console.log(`Employee birth date picker tests passed: ${passed}`)
