import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const pageUrl = new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url)
const page = readFileSync(fileURLToPath(pageUrl), 'utf8')
const sidebarUrl = new URL('../components/Sidebar.jsx', import.meta.url)
const sidebar = readFileSync(fileURLToPath(sidebarUrl), 'utf8')

// Navigasi utama Pelayanan Teknik kini berada di sidebar sebagai submenu.
assert(sidebar.includes('slaPrimaryModules'), 'Submenu utama Pelayanan Teknik hilang')
assert(sidebar.includes('slaConfigurationModules'), 'Submenu Master & Pengaturan hilang')
assert(sidebar.includes('nav-submenu-item'), 'Item submenu sidebar hilang')
assert(sidebar.includes('aria-expanded={pelayananOpen}'), 'Status buka/tutup submenu Pelayanan Teknik hilang')
assert(sidebar.includes('aria-expanded={masterOpen}'), 'Status buka/tutup Master & Pengaturan hilang')
assert(sidebar.includes('onNavigateModule?.(module.id)'), 'Klik submenu harus memilih modul')

// Tab horizontal dan dropdown lama tidak boleh tersisa di halaman.
assert(!page.includes('sla-module-navigation'), 'Tab horizontal lama harus dihapus dari halaman')
assert(!page.includes('sla-config-menu'), 'Dropdown Master & Pengaturan lama harus dihapus dari halaman')
assert(!page.includes('configMenuRef'), 'Ref dropdown lama harus dihapus dari halaman')

console.log(`Sidebar module navigation tests passed: ${passed}`)

// Dropdown Pengaturan Variable memakai pola yang sama: <details> + ref,
// listener klik luar, Escape, dan menutup saat menu dipilih.
const variableUrl = new URL('../components/sla/SLAVariableCost.jsx', import.meta.url)
const variable = readFileSync(fileURLToPath(variableUrl), 'utf8')

assert(variable.includes('const variableConfigMenuRef = useRef(null)'), 'Ref dropdown Pengaturan Variable hilang')
assert(variable.includes('<details className="vc-config-menu" ref={variableConfigMenuRef}>'), 'Ref harus terpasang pada dropdown Pengaturan Variable')
assert(variable.includes("document.addEventListener('pointerdown'"), 'Listener klik luar dropdown Variable hilang')
assert(variable.includes('!menu.contains(event.target)'), 'Klik dalam panel Variable tidak boleh menutup dropdown')
assert(variable.includes('menu.open = false'), 'Klik luar harus menutup dropdown Variable')
assert(variable.includes('variableConfigMenuRef.current.open = false'), 'Memilih menu Variable harus menutup dropdown')
assert(variable.includes("event.key === 'Escape'"), 'Escape harus menutup dropdown Variable')
assert(variable.includes("document.removeEventListener('pointerdown'"), 'Cleanup listener pointerdown Variable hilang')
assert(variable.includes("document.removeEventListener('keydown'"), 'Cleanup listener keydown Variable hilang')

console.log(`Variable config menu behavior tests passed: ${passed}`)
