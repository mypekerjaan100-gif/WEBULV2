import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const CONTRACT_ID = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'
const UP3_ID = '3215235c-c194-43a1-84d2-25c767c75d7a'
const UNIT_ID = '27617d7d-795f-4f34-8edd-cc236ed49146'

function addDays(date, days) {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

const server = await createServer({
  server: { host: '127.0.0.1', port: 4192 },
  logLevel: 'error',
  plugins: [{
    name: 'overtime-cross-month-test-page',
    configureServer(viteServer) {
      viteServer.middlewares.use('/overtime-cross-month-test', (_request, response) => {
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
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.route('**/rest/v1/rpc/get_overtime_initial_deadline_config', async (route) => {
    const parameters = route.request().postDataJSON()
    const days = 7
    const deadlineDate = addDays(parameters.p_overtime_date, days)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        contract_id: parameters.p_contract_id,
        up3_id: parameters.p_up3_id,
        config_exists: true,
        initial_submission_days: days,
        temporary_submission_days: null,
        temporary_effective_until: null,
        temporary_reason: null,
        temporary_is_active: false,
        effective_submission_days: days,
        overtime_date: parameters.p_overtime_date,
        effective_deadline_date: deadlineDate,
        effective_deadline_at: new Date(`${deadlineDate}T23:59:59.999+07:00`).toISOString(),
        as_of: '2026-11-02T12:00:00+07:00',
        updated_by: '00000000-0000-4000-8000-000000000001',
        updated_at: '2026-11-02T12:00:00+07:00',
        revision: 1,
      }]),
    })
  })
  await page.route('**/rest/v1/rpc/list_overtime_replacement_employees_l2', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { employee_id: '00000000-0000-4000-8000-000000000101', name: 'PEGAWAI DIGANTIKAN', unit_id: UNIT_ID },
      { employee_id: '00000000-0000-4000-8000-000000000102', name: 'PEGAWAI PENGGANTI', unit_id: UNIT_ID },
    ]),
  }))
  await page.route('**/rest/v1/rpc/list_overtime_evidence', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }))

  await page.goto('http://127.0.0.1:4192/overtime-cross-month-test')
  await page.evaluate(async ({ contractId, up3Id, unitId }) => {
    const RefreshRuntime = (await import('/@react-refresh')).default
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
    window.__savedDraft = null
    window.__openedPeriod = null
    createRoot(document.getElementById('root')).render(React.createElement(SLALembur, {
      contractScope: { contractId, contractName: 'Pelayanan Teknik' },
      up3Id,
      unitId,
      periodMonth: '2026-11-01',
      records: [],
      canMutate: true,
      loading: false,
      loadError: '',
      orgUnits: [],
      onRetry: () => {},
      onRefresh: async () => {},
      onOpenPeriod: (date) => { window.__openedPeriod = date },
      onSaveDraft: async (activityId, draft) => {
        window.__savedDraft = draft
        return { ok: true, activityId: '00000000-0000-4000-8000-000000000201', message: 'Draft disimpan.' }
      },
      onSubmit: async () => ({ ok: true, message: 'Lembur diajukan.' }),
      onSaveWorkDraft: async () => ({ ok: false, message: 'Tidak digunakan pada uji ini.' }),
      onSubmitWork: async () => ({ ok: false, message: 'Tidak digunakan pada uji ini.' }),
    }))
  }, { contractId: CONTRACT_ID, up3Id: UP3_ID, unitId: UNIT_ID })

  await page.getByRole('button', { name: '+ Tambah Lembur', exact: true }).click()
  await page.getByRole('button', { name: /^Pengganti Cuti/ }).click()
  const dateInput = page.locator('label').filter({ hasText: 'Tanggal Lembur' }).locator('input')
  await dateInput.fill('2026-10-28')
  await page.getByText(/Batas pengajuan H\+7:/).waitFor()
  await page.getByText(/Tanggal ini masuk periode/).waitFor()
  assert.equal(
    await page.getByText('Tanggal lembur harus berada dalam periode yang dipilih.', { exact: true }).count(),
    0,
  )
  assert((await page.locator('.lembur-form-card').innerText()).includes('Oktober 2026'))
  assert((await page.locator('.lembur-form-card').innerText()).includes('November 2026'))

  const replacementGrid = page.locator('.lembur-time-grid.is-replacement')
  const replaced = replacementGrid.locator('select').nth(0)
  const participant = replacementGrid.locator('select').nth(1)
  await replaced.locator('option').nth(1).waitFor({ state: 'attached' })
  await replaced.selectOption('00000000-0000-4000-8000-000000000101')
  await participant.locator('option').nth(1).waitFor({ state: 'attached' })
  await participant.selectOption('00000000-0000-4000-8000-000000000102')
  await replacementGrid.locator('input[type=time]').nth(0).fill('08:00')
  await replacementGrid.locator('input[type=time]').nth(1).fill('10:00')

  await page.getByRole('button', { name: 'Simpan Draft', exact: true }).click()
  await page.getByText(/Draft dan evidence berhasil disimpan/).waitFor()
  const message = await page.locator('.lembur-message').innerText()
  assert(message.includes('Draft masuk periode Oktober 2026.'))
  await page.getByRole('button', { name: 'Buka periode Oktober 2026', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__openedPeriod), '2026-10-28')
  assert.deepEqual(await page.evaluate(() => ({
    startedAt: window.__savedDraft?.startedAt,
    endedAt: window.__savedDraft?.endedAt,
  })), {
    startedAt: '2026-10-28T08:00:00+07:00',
    endedAt: '2026-10-28T10:00:00+07:00',
  })
  assert.deepEqual(errors, [])
  console.log('Overtime cross-month browser checks passed: date outside selected period can be saved, period destination is shown, and period switch action works.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await browser?.close()
  await server.close()
}
