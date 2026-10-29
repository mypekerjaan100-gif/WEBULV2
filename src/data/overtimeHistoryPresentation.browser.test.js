import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Real detail component + CSS, mocked read-only RPCs. No login/live DB/Storage.
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
  plugins: [{
    name: 'overtime-history-test-page',
    configureServer(viteServer) {
      viteServer.middlewares.use('/overtime-history-test', (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><title>Overtime history test</title><main id="root"></main>')
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
  const externalRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1') return route.continue()
    externalRequests.push(url.href)
    return route.abort()
  })
  await page.route('**/src/lib/supabaseClient.js*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export const supabase = {
      rpc: async (name, parameters) => {
        window.__rpcCalls.push(name)
        if (name === 'list_overtime_history_l5') {
          return { data: structuredClone(window.__historyFixtures[parameters.p_activity_id]), error: null }
        }
        if (['list_overtime_entry_effective_evidence', 'list_overtime_evidence', 'list_overtime_activity_entries', 'list_employee_photos'].includes(name)) {
          return { data: [], error: null }
        }
        throw new Error('Unexpected RPC in read-only fixture: ' + name)
      },
    }`,
  }))
  const { port } = server.httpServer.address()
  await page.goto(`http://127.0.0.1:${port}/overtime-history-test`)
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
    const targets = [
      ['70ec2e23-b57f-4432-8aaa-3384d02f55b2', '2026-10-28T02:54:17.843285+00:00', 'Keraban', 2],
      ['2eb84c1e-508e-42a3-bc4c-d5430269e1b9', '2026-10-28T03:17:29.056268+00:00', 'Ds.Jambu', 1],
      ['e29d0c27-3cc2-46a3-818d-de70e512f6b2', '2026-10-28T03:28:53.589259+00:00', 'Ds.Sasak Dalam', 0],
      ['normal-activity', '2026-10-28T03:00:00+00:00', 'Aktivitas lain', 2],
    ]
    const key = 'correct_row_oct21_submission_oct28_2026'
    const recordedAt = '2026-10-29T07:50:57.326650+00:00'
    const makeNotes = (value) => `Koreksi database.\n${JSON.stringify({ maintenance_key: key, ...value })}`
    window.__rpcCalls = []
    window.__historyFixtures = {}
    for (const [activityId, submittedAt, , updateCount] of targets) {
      const event = (id, type, from, to, time, extra = {}) => ({
        id, activity_id: activityId, entry_id: null, event: type,
        previous_status: from, new_status: to, occurred_at: time,
        created_at: time, reason: null, notes: null, submission_number: null, ...extra,
      })
      window.__historyFixtures[activityId] = [
        event('created', 'CREATED', null, 'DRAFT', '2026-10-28T02:00:00Z'),
        ...Array.from({ length: updateCount }, (_, index) => event(`updated-${index}`, 'UPDATED', 'DRAFT', 'DRAFT', `2026-10-28T02:0${index + 1}:00Z`)),
        event('submitted', 'SUBMITTED', 'DRAFT', 'SUBMITTED', submittedAt, {
          submission_number: 1, created_at: recordedAt,
          reason: 'Tanggal efektif pengajuan ditetapkan melalui koreksi.',
          notes: makeNotes({ effective_submitted_at: submittedAt }),
        }),
        event('expired', 'CLOSED', 'DRAFT', 'CLOSED', '2026-10-28T23:32:35Z', { reason: 'Batas pengajuan awal H+7 telah lewat' }),
        event('corrected', 'CORRECTED', 'CLOSED', 'SUBMITTED', '2026-10-29T07:50:57.500000Z', {
          submission_number: 1, created_at: recordedAt,
          notes: makeNotes({ before: { activity: { id: activityId } }, after: { activity: { id: activityId, submitted_at: submittedAt } } }),
        }),
      ]
    }
    const root = createRoot(document.getElementById('root'))
    let renderNumber = 0
    window.__renderOvertimeHistory = (targetIndex, participantIndex = 0) => {
      const [activityId, , location] = targets[targetIndex]
      const records = Array.from({ length: 3 }, (_, index) => ({
        id: activityId, entryId: `${activityId}-entry-${index}`,
        contractId: 'test-contract', up3Id: 'test-up3', unitId: 'test-ulp',
        periodMonth: '2026-10-01', date: '2026-10-21', type: 'WORK', workCategory: 'ROW',
        participantName: `Pegawai ${index + 1}`, participantEmployeeId: `employee-${index}`,
        startedAt: '2026-10-21T09:30:00+07:00', endedAt: '2026-10-21T15:30:00+07:00',
        durationHours: 6, total: 246088.5, status: 'SUBMITTED', entryStatus: 'SUBMITTED',
        description: 'ROW uji tampilan', workTitle: 'ROW Gabungan', workLocation: location,
        rowVarSpanCount: 21, rejectionCount: 0,
      }))
      renderNumber += 1
      root.render(React.createElement(SLALembur, {
        key: renderNumber, records, contractScope: { contractId: 'test-contract' },
        up3Id: 'test-up3', unitId: 'test-ulp', periodMonth: '2026-10-01', orgUnits: [],
        canMutate: false, isAdminUp3: false, isSuperAdmin: false, loading: false,
        approvalTarget: { source: 'lembur', token: `fixture-${renderNumber}`, id: activityId, entryId: records[participantIndex].entryId },
      }))
    }
    window.__originalAudit = JSON.stringify(window.__historyFixtures)
  })

  const timeline = page.locator('.lembur-history-timeline')
  const closeDetail = async () => {
    await page.locator('.lembur-detail-header').getByRole('button', { name: 'Tutup', exact: true }).click()
    await page.locator('.lembur-detail-modal').waitFor({ state: 'detached' })
  }
  for (let target = 0; target < 3; target += 1) {
    for (let participant = 0; participant < 3; participant += 1) {
      await page.evaluate(([t, p]) => window.__renderOvertimeHistory(t, p), [target, participant])
      await timeline.getByText('Pengajuan Dikirim', { exact: true }).waitFor()
      assert.equal(await timeline.locator('.lembur-history-item').count(), 1)
      assert.match(await timeline.innerText(), /28\/10\/2026/)
      assert.doesNotMatch(await timeline.innerText(), /Draft Dibuat|Draft Diperbarui|Ditutup|Koreksi Data Lembur|maintenance_key|database|Tanggal efektif/)
      await closeDetail()
    }
  }
  assert.equal(await page.evaluate(() => JSON.stringify(window.__historyFixtures) === window.__originalAudit), true)

  // A new participant decision must stay visible only for that participant.
  await page.evaluate(() => {
    const activityId = '70ec2e23-b57f-4432-8aaa-3384d02f55b2'
    window.__historyFixtures[activityId].push({
      id: 'new-approval', activity_id: activityId, entry_id: `${activityId}-entry-0`,
      event: 'APPROVED', previous_status: 'SUBMITTED', new_status: 'APPROVED',
      occurred_at: '2026-10-30T00:00:00Z', created_at: '2026-10-30T00:00:00Z',
      notes: 'Persetujuan baru tetap terlihat.',
    })
    window.__renderOvertimeHistory(0, 0)
  })
  await timeline.getByText('Disetujui', { exact: true }).waitFor()
  assert.equal(await timeline.locator('.lembur-history-item').count(), 2)
  await closeDetail()
  await page.evaluate(() => window.__renderOvertimeHistory(0, 1))
  await timeline.getByText('Pengajuan Dikirim', { exact: true }).waitFor()
  assert.equal(await timeline.locator('.lembur-history-item').count(), 1, 'Do not leak another participant decision')
  await closeDetail()

  await page.evaluate(() => window.__renderOvertimeHistory(3))
  await timeline.getByText('Koreksi Data Lembur', { exact: true }).waitFor()
  assert.equal(await timeline.locator('.lembur-history-item').count(), 6, 'Other activities keep the complete timeline')
  assert.match(await timeline.innerText(), /Draft Dibuat|Ditutup|maintenance_key/)
  assert.ok((await page.evaluate(() => window.__rpcCalls)).every((name) => name.startsWith('list_')))
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(externalRequests, [])
  console.log('Overtime history UI passed: all nine participant views, 28 October submission, new scoped approval, unrelated audit unchanged; no live requests')
} finally {
  if (browser) await browser.close()
  await server.close()
}
