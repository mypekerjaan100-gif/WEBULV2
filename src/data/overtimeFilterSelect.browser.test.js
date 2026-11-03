import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const server = await createServer({
  server: { host: '127.0.0.1', port: 4193 },
  logLevel: 'error',
  plugins: [{
    name: 'overtime-filter-select-test-page',
    configureServer(viteServer) {
      viteServer.middlewares.use('/overtime-filter-select-test', (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><html><body><main id="root"></main></body></html>')
      })
    },
  }],
})

let browser
try {
  await server.listen()
  browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 1120, height: 760 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:4193/overtime-filter-select-test')
  await page.evaluate(async () => {
    const RefreshRuntime = (await import('/@react-refresh')).default
    RefreshRuntime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    await import('/src/styles/index.css')
    const ReactModule = await import('/node_modules/.vite/deps/react.js')
    const React = ReactModule.default ?? ReactModule
    const ReactDOMClient = await import('/node_modules/.vite/deps/react-dom_client.js')
    const createRoot = ReactDOMClient.createRoot ?? ReactDOMClient.default?.createRoot
    const { default: OvertimeFilterSelect } = await import('/src/components/sla/OvertimeFilterSelect.jsx')
    const { FilterBar, FilterField } = await import('/src/components/ui/Primitives.jsx')
    const root = createRoot(document.getElementById('root'))
    function Fixture() {
      const [filters, setFilters] = React.useState({ ulp: '', kind: 'Semua', status: 'Semua' })
      window.__filterValues = filters
      return React.createElement(FilterBar, { className: 'lembur-filter-bar' },
        React.createElement(FilterField, { label: 'ULP', className: 'lembur-filter-field' },
          React.createElement(OvertimeFilterSelect, {
            label: 'ULP', value: filters.ulp, searchable: true,
            options: [
              { value: '', label: 'Semua' },
              { value: 'ulp-skw', label: 'ULP Singkawang' },
              { value: 'ulp-selakau', label: 'ULP Selakau' },
              { value: 'ulp-sambas', label: 'ULP Sambas' },
            ],
            onChange: (value) => setFilters((current) => ({ ...current, ulp: value })),
          })),
        React.createElement(FilterField, { label: 'Jenis', className: 'lembur-filter-field' },
          React.createElement(OvertimeFilterSelect, {
            label: 'Jenis', value: filters.kind,
            options: [{ value: 'Semua', label: 'Semua' }, { value: 'JTM', label: 'JTM' }, { value: 'GARDU', label: 'Gardu' }],
            onChange: (value) => setFilters((current) => ({ ...current, kind: value })),
          })),
        React.createElement(FilterField, { label: 'Status', className: 'lembur-filter-field' },
          React.createElement(OvertimeFilterSelect, {
            label: 'Status', value: filters.status, statusTone: true,
            options: [
              { value: 'Semua', label: 'Semua' },
              { value: 'Menunggu Approval', label: 'Menunggu Approval', tone: 'info' },
              { value: 'Disetujui', label: 'Disetujui', tone: 'success' },
              { value: 'Perlu Revisi', label: 'Perlu Revisi', tone: 'warning' },
              { value: 'Ditolak Final', label: 'Ditolak Final', tone: 'danger' },
            ],
            onChange: (value) => setFilters((current) => ({ ...current, status: value })),
          })),
      )
    }
    root.render(React.createElement(Fixture))
  })

  const ulpTrigger = page.getByRole('button', { name: 'ULP' })
  await ulpTrigger.click()
  const ulpDialog = page.getByRole('dialog', { name: 'Pilihan ULP' })
  await ulpDialog.getByRole('combobox', { name: 'Cari ULP' }).fill('singkawang')
  assert.equal(await ulpDialog.getByRole('option').count(), 1)
  await ulpDialog.getByRole('option', { name: 'ULP Singkawang' }).click()
  assert.equal(await page.evaluate(() => window.__filterValues.ulp), 'ulp-skw')
  assert((await ulpTrigger.innerText()).includes('ULP Singkawang'))

  const kindTrigger = page.getByRole('button', { name: 'Jenis' })
  await kindTrigger.click()
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.locator('.lembur-filter-select-option.is-active').innerText(), 'JTM')
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.__filterValues.kind), 'JTM')

  const statusTrigger = page.getByRole('button', { name: 'Status' })
  await statusTrigger.click()
  await page.getByRole('option', { name: 'Disetujui' }).click()
  assert.equal(await page.evaluate(() => window.__filterValues.status), 'Disetujui')
  assert(await statusTrigger.locator('.lembur-filter-status-dot').getAttribute('class').then((value) => value.includes('is-success')))

  await statusTrigger.click()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Pilihan Status' }).waitFor({ state: 'hidden' })
  assert.equal(await statusTrigger.evaluate((element) => document.activeElement === element), true)
  await statusTrigger.click()
  await page.locator('body').click({ position: { x: 1080, y: 700 } })
  await page.getByRole('dialog', { name: 'Pilihan Status' }).waitFor({ state: 'hidden' })

  await page.setViewportSize({ width: 390, height: 844 })
  await ulpTrigger.click()
  const mobilePanel = page.getByRole('dialog', { name: 'Pilihan ULP' })
  const bounds = await mobilePanel.boundingBox()
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 390)
  await page.locator('body').click({ position: { x: 380, y: 820 } })
  await mobilePanel.waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [])
  console.log('Overtime filter dropdown browser tests passed: ULP search, kind keyboard selection, status colors, Escape/outside close, and mobile bounds.')
} catch (error) {
  console.error(error.stack ?? error.message)
  process.exitCode = 1
} finally {
  await browser?.close()
  await server.close()
}
