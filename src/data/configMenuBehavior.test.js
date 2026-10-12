import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const pageUrl = new URL('../pages/sla/SLAPelayananTeknikPage.jsx', import.meta.url)
const page = readFileSync(fileURLToPath(pageUrl), 'utf8')

// Dropdown Master & Pengaturan memakai <details> + ref.
assert(page.includes('const configMenuRef = useRef(null)'), 'Ref dropdown Master & Pengaturan hilang')
assert(page.includes('<details className="sla-config-menu" ref={configMenuRef}>'), 'Ref harus terpasang pada dropdown')

// Klik di sembarang tempat di luar dropdown menutupnya.
assert(page.includes("document.addEventListener('pointerdown'"), 'Listener klik luar dropdown hilang')
assert(page.includes('!menu.contains(event.target)'), 'Klik dalam panel tidak boleh menutup dropdown')
assert(page.includes('menu.open = false'), 'Klik luar harus menutup dropdown')

// Memilih menu menutup dropdown.
assert(page.includes('configMenuRef.current.open = false'), 'Memilih menu harus menutup dropdown')

// Tombol Escape menutup dropdown dan listener dibersihkan.
assert(page.includes("document.addEventListener('keydown'"), 'Listener Escape hilang')
assert(page.includes("event.key === 'Escape'"), 'Escape harus menutup dropdown')
assert(page.includes("document.removeEventListener('pointerdown'"), 'Cleanup listener pointerdown hilang')
assert(page.includes("document.removeEventListener('keydown'"), 'Cleanup listener keydown hilang')

console.log(`Config menu behavior tests passed: ${passed}`)
