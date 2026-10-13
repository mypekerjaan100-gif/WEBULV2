import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const pickerUrl = new URL('../components/sla/ModernDatePicker.jsx', import.meta.url)
const picker = readFileSync(fileURLToPath(pickerUrl), 'utf8')
assert(picker.includes('createPortal'), 'Popup harus memakai portal agar tidak terpotong modal')
assert(picker.includes('document.body'), 'Portal harus dirender ke document.body')
assert(picker.includes('Pilih bulan'), 'Navigasi bulan cepat hilang')
assert(picker.includes('Pilih tahun'), 'Navigasi tahun cepat hilang (penting untuk tanggal lahir)')
assert(picker.includes('Hari ini'), 'Tombol Hari ini hilang')
assert(picker.includes('Hapus'), 'Tombol Hapus hilang')
assert(picker.includes('Escape'), 'Popup harus bisa ditutup dengan Escape')
assert(picker.includes('formatIndonesianDate'), 'Format tanggal Indonesia hilang')
assert(picker.includes('Agustus'), 'Nama bulan Indonesia hilang')
assert(picker.includes('parseISODate'), 'Validasi tanggal (tangent 30 Feb) hilang')
assert(picker.includes('mdp-popup'), 'Class popup hilang')
assert(picker.includes('mdp-day'), 'Class sel hari hilang')
assert(picker.includes('is-selected'), 'State hari terpilih hilang')
assert(picker.includes('is-today'), 'Penanda hari ini hilang')
assert(picker.includes('role="dialog"'), 'Aksesibilitas dialog hilang')
assert(picker.includes('onDrop') === false, 'Date picker tidak boleh memakai drop file')

const componentUrl = new URL('../components/sla/SLADatabasePegawai.jsx', import.meta.url)
const component = readFileSync(fileURLToPath(componentUrl), 'utf8')
assert(component.includes('ModernDatePicker'), 'Field Tanggal Lahir harus memakai ModernDatePicker')
assert(component.includes("from './ModernDatePicker.jsx'"), 'Import ModernDatePicker hilang')
assert(component.includes('max={todayStr}'), 'Tanggal lahir tidak boleh melebihi hari ini')
assert(component.includes('Tanggal lahir tidak boleh melebihi hari ini'), 'Validasi tanggal lahir masa depan hilang')
const bindingIndex = component.indexOf('birthDate: next')
assert(bindingIndex >= 0, 'Binding form.birthDate hilang')
const section = component.slice(Math.max(0, bindingIndex - 600), bindingIndex + 200)
assert(section.includes('ModernDatePicker'), 'ModernDatePicker harus terikat ke form.birthDate')
assert(section.includes('Tanggal Lahir'), 'Label Tanggal Lahir hilang')

const cssUrl = new URL('../styles/index.css', import.meta.url)
const css = readFileSync(fileURLToPath(cssUrl), 'utf8')
assert(css.includes('.mdp-trigger'), 'Style trigger date picker hilang')
assert(css.includes('.mdp-popup'), 'Style popup date picker hilang')
assert(css.includes('.mdp-grid'), 'Style grid kalender hilang')
assert(css.includes('.mdp-day'), 'Style sel hari hilang')
assert(css.includes('.mdp-footer'), 'Style footer kalender hilang')
assert(css.includes('.mdp-select'), 'Style dropdown bulan/tahun hilang')
assert(css.includes(":root[data-theme='dark'] .mdp-trigger-icon"), 'Dark mode date picker hilang')

console.log(`Employee birth date picker tests passed: ${passed}`)
