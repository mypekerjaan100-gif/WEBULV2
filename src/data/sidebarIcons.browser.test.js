import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
  plugins: [{
    name: 'sidebar-test',
    configureServer(vite) {
      vite.middlewares.use('/sidebar-test', (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end('<!doctype html><div id="root"></div>')
      })
    },
  }],
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/src/lib/AppAuth.jsx*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export const useAuth = () => ({ authority: { actor: { is_super_admin: true, contract_access: [], organization_access: [] } } })`,
  }))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/sidebar-test`)
  await page.evaluate(async () => {
    const { default: Refresh } = await import('/@react-refresh')
    Refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (value) => value
    window.__vite_plugin_react_preamble_installed__ = true
    await import('/src/styles/index.css')
    const r = await import('/node_modules/.vite/deps/react.js')
    const React = r.default ?? r
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Sidebar } = await import('/src/components/Sidebar.jsx')
    const { pelayananTeknikModules } = await import('/src/data/slaPelayananTeknik.js')
    const root = (dom.createRoot ?? dom.default.createRoot)(document.getElementById('root'))
    const primaryIds = ['sla', 'variable-cost', 'lembur', 'kendaraan-ulp', 'laporan-bbm']
    root.render(React.createElement(Sidebar, {
      open: true,
      collapsed: false,
      activeContractId: 'pelayanan-teknik',
      currentPage: null,
      slaPrimaryModules: pelayananTeknikModules.filter((module) => primaryIds.includes(module.id)),
      slaConfigurationModules: pelayananTeknikModules.filter((module) => !primaryIds.includes(module.id)),
      slaActiveModule: 'master-organisasi',
    }))
  })
  await page.locator('#nav-submenu-pelayanan-teknik').waitFor()
  await page.locator('#nav-submenu-master-pengaturan').waitFor()
  assert.equal(await page.locator('#nav-submenu-pelayanan-teknik .nav-submenu-item').count(), 5)
  assert.equal(await page.locator('#nav-submenu-master-pengaturan .nav-submenu-item').count(), 8)
  assert.equal(await page.locator('.nav-submenu-marker svg.ui-icon').count(), 13)
  assert.equal(await page.locator('.nav-submenu-dot').count(), 0)
  assert.equal(await page.locator('.nav-item', { hasText: 'Pengaturan AI' }).first().locator('svg.ui-icon').count(), 1, 'Ikon menu Pengaturan AI tidak tampil')
  for (const label of ['SLA', 'Variable Cost', 'Lembur', 'Alat & Kendaraan', 'Laporan BBM', 'Master Organisasi', 'Master Lokasi', 'Master Jabatan', 'Master Alat & Kendaraan', 'Master Pegawai', 'Pengaturan SLA', 'Pengaturan Lembur', 'Master Penandatangan']) {
    assert.equal(await page.locator('.nav-submenu-item', { hasText: label }).first().locator('svg.ui-icon').count(), 1, `Ikon submenu ${label} tidak tampil`)
  }
  for (const label of ['Kontrak Lain', 'Billing Management', 'Operator Gardu Induk', 'Ground Patrol', 'Master Data', 'Komponen & Unit']) {
    assert.equal(await page.locator('.sidebar-nav').getByText(label, { exact: true }).count(), 0, `Menu ${label} harus disembunyikan`)
  }
  await page.screenshot({ path: 'C:\\Users\\risky\\AppData\\Local\\Temp\\opencode\\sidebar-icons.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('Sidebar icons: all primary and configuration submenus render icons.')
} finally {
  await browser?.close()
  await server.close()
}
