import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
  plugins: [{
    name: 'tool-matrix-layout-test',
    configureServer(vite) {
      vite.middlewares.use('/matrix-layout-test', (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end('<!doctype html><div id="root" style="padding:20px"></div>')
      })
    },
  }],
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/src/lib/supabaseClient.js*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'export const supabase = {}',
  }))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/matrix-layout-test`)
  await page.evaluate(async () => {
    const { default: Refresh } = await import('/@react-refresh')
    Refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (value) => value
    window.__vite_plugin_react_preamble_installed__ = true
    await import('/src/styles/index.css')
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js')
    const createRoot = dom.createRoot ?? dom.default.createRoot
    const { default: Matrix } = await import('/src/components/sla/UlpToolInspectionMatrix.jsx')
    createRoot(document.getElementById('root')).render(React.createElement(Matrix, {
      items: [{
        key: 'puller', equipment_id: 'puller', category: 'PERALATAN KERJA',
        name: 'Straining Device/Ratchet Puller 2 ton + comealong',
        unit: 'Unit', required_qty: 2, good_qty: 0, bad_qty: 2,
      }],
      assets: [1, 2].map((n) => ({
        id: `unit-${n}`, equipment_id: 'puller', asset_sequence: n,
        open_issue: { id: `issue-${n}` },
      })),
      canResolveIssue: true,
    }))
  })
  await page.locator('.tool-unit-summary').first().waitFor()
  for (const width of [1536, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const failures = await page.evaluate(() => {
      const failures = []
      for (const unit of document.querySelectorAll('.tool-unit-summary')) {
        const cell = unit.closest('td').getBoundingClientRect()
        const id = unit.querySelector('.tool-unit-id').getBoundingClientRect()
        const state = unit.querySelector('.tool-unit-state').getBoundingClientRect()
        const actions = unit.querySelector('.tool-unit-summary-actions').getBoundingClientRect()
        if (id.right > state.left + 1) failures.push('Unit overlaps status')
        if (actions.top < Math.max(id.bottom, state.bottom)) failures.push('Actions overlap status')
        for (const child of unit.querySelectorAll('.tool-unit-id, .tool-unit-state, .tool-action-btn, .tool-unit-hint')) {
          const rect = child.getBoundingClientRect()
          if (rect.right > cell.right + 1 || rect.left < cell.left - 1) failures.push('Content escapes inspection column')
          if (child.scrollWidth > child.clientWidth + 1) failures.push('Text overflows its box')
        }
      }
      const wrap = document.querySelector('.tool-matrix-wrap').getBoundingClientRect()
      if (wrap.right > innerWidth + 1) failures.push('Table container escapes viewport')
      return failures
    })
    assert.deepEqual(failures, [], `Layout at ${width}px`)
  }
  assert.equal(await page.getByRole('button', { name: 'Serah Terima', exact: true }).first().isDisabled(), true)
  await page.getByRole('button', { name: 'Rincian umur & bukti' }).click()
  assert.equal(await page.locator('.tool-unit-card').count(), 2)
  assert.deepEqual(errors, [])
  console.log('Tool matrix: no overlap at five viewport widths; handover and details preserved.')
} finally {
  await browser?.close()
  await server.close()
}
