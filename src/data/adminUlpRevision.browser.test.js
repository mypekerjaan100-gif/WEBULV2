import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Real SLALembur component + CSS, mocked read RPCs. Verifies that a revision
// notification target opens the exact participant form and that the active
// period banner ignores expired revisions.
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
  plugins: [{
    name: 'admin-ulp-revision-test-page',
    configureServer(viteServer) {
      viteServer.middlewares.use('/admin-ulp-revision-test', (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><title>Admin ULP revision test</title><main id="root"></main>')
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1') return route.continue()
    return route.abort()
  })
  await page.route('**/src/lib/supabaseClient.js*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export const supabase = {
      rpc: async (name) => {
        window.__rpcCalls.push(name)
        if (name === 'list_overtime_replacement_employees_l2') return { data: [{ employee_id: 'employee-1', name: 'Peserta Revisi', unit_id: 'test-ulp' }], error: null }
        if (name === 'list_overtime_activity_entries' || name === 'list_overtime_evidence' || name === 'list_overtime_entry_effective_evidence') {
          return { data: [], error: null }
        }
        if (name === 'get_overtime_initial_deadline_config') return { data: [], error: null }
        throw new Error('Unexpected RPC in revision fixture: ' + name)
      },
    }`,
  }))
  const { port } = server.httpServer.address()
  await page.goto(`http://127.0.0.1:${port}/admin-ulp-revision-test`)
  await page.evaluate(async () => {
    const { default: RefreshRuntime } = await import('/@react-refresh')
    RefreshRuntime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    await import('/src/styles/index.css')
    const ReactModule = await import('/node_modules/.vite/deps/react.js')
    const React = ReactModule.default ?? ReactModule
    const ReactDOMClient = await import('/node_modules/.vite/deps/react-dom_client.js')
    const createRoot = ReactDOMClient.createRoot ?? ReactDOMClient.default?.createRoot
    const { default: SLALembur } = await import('/src/components/sla/SLALembur.jsx')

    const futureDeadline = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    const expiredDeadline = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const baseRecord = {
      contractId: 'test-contract',
      up3Id: 'test-up3',
      unitId: 'test-ulp',
      periodMonth: '2026-11-01',
      date: '2026-11-20',
      type: 'REPLACEMENT_LEAVE',
      participantName: 'Peserta Revisi',
      participantEmployeeId: 'employee-1',
      replacedEmployeeId: 'employee-2',
      replacedEmployeeName: 'Pegawai Diganti',
      startedAt: '2026-11-20T18:00:00+07:00',
      endedAt: '2026-11-20T20:00:00+07:00',
      durationHours: 2,
      total: 100000,
      description: 'Pengganti cuti uji',
      status: 'CORRECTION_REQUIRED',
      rejectionCount: 1,
      revisionDeadlineAt: futureDeadline,
      updatedAt: futureDeadline,
    }
    const activeRecord = { ...baseRecord, id: 'activity-revision', entryId: 'entry-revision' }
    const expiredRecord = {
      ...baseRecord,
      id: 'activity-expired',
      entryId: 'entry-expired',
      participantName: 'Peserta Kedaluwarsa',
      revisionDeadlineAt: expiredDeadline,
    }

    window.__rpcCalls = []
    window.__handledRevisionTokens = []
    const root = createRoot(document.getElementById('root'))
    root.render(React.createElement(SLALembur, {
      records: [activeRecord, expiredRecord],
      dataReady: true,
      loading: false,
      contractScope: { contractId: 'test-contract', region: 'UP3 Uji' },
      up3Id: 'test-up3',
      unitId: 'test-ulp',
      periodMonth: '2026-11-01',
      orgUnits: [],
      canMutate: true,
      isAdminUp3: false,
      isSuperAdmin: false,
      isAdminUlp: true,
      revisionTarget: {
        kind: 'revision',
        token: 'revision-target-1',
        activityId: activeRecord.id,
        entryId: activeRecord.entryId,
        periodMonth: '2026-11-01',
      },
      onRevisionTargetHandled: () => window.__handledRevisionTokens.push('revision-target-1'),
    }))
  })

  const form = page.locator('.lembur-form-card.lembur-form-modal-wide')
  await form.waitFor({ state: 'visible' })
  assert.match(await form.innerText(), /Revisi Pengajuan · Peserta Revisi/i)
  assert.equal(await page.evaluate(() => window.__handledRevisionTokens.includes('revision-target-1')), true)
  assert.equal(await page.evaluate(() => window.__rpcCalls.includes('list_overtime_activity_entries')), true)
  const banner = page.locator('.lembur-revision-notice')
  await banner.waitFor({ state: 'visible' })
  assert.match(await banner.innerText(), /1 peserta pada periode ini dikembalikan untuk direvisi/)
  assert.doesNotMatch(await banner.innerText(), /2 peserta/)
  assert.deepEqual(pageErrors, [])
  console.log('Admin ULP revision browser test passed: target form and active-period banner')
} finally {
  await browser?.close()
  await server.close()
}
