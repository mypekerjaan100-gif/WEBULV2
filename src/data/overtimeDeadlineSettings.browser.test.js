import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const CONTRACT_ID = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'
const UP3_ID = '3215235c-c194-43a1-84d2-25c767c75d7a'

const server = await createServer({
  server: { host: '127.0.0.1', port: 4190 },
  logLevel: 'error',
  plugins: [{
    name: 'overtime-deadline-settings-test-page',
    configureServer(viteServer) {
      viteServer.middlewares.use('/overtime-deadline-settings-test', (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><html><body><main id="root"></main></body></html>')
      })
    },
  }],
})

function addDays(date, days) {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

function configResponse(parameters, state) {
  const temporaryIsActive = Boolean(
    state.temporarySubmissionDays != null
    && new Date(state.temporaryEffectiveUntil) >= new Date(),
  )
  const effectiveDays = temporaryIsActive
    ? state.temporarySubmissionDays
    : state.initialSubmissionDays
  const deadlineDate = addDays(parameters.p_overtime_date, effectiveDays)
  return [{
    contract_id: parameters.p_contract_id,
    up3_id: parameters.p_up3_id,
    config_exists: true,
    initial_submission_days: state.initialSubmissionDays,
    temporary_submission_days: state.temporarySubmissionDays,
    temporary_effective_until: state.temporaryEffectiveUntil,
    temporary_reason: state.temporaryReason,
    temporary_is_active: temporaryIsActive,
    effective_submission_days: effectiveDays,
    overtime_date: parameters.p_overtime_date,
    effective_deadline_date: deadlineDate,
    effective_deadline_at: new Date(`${deadlineDate}T23:59:59.999+07:00`).toISOString(),
    as_of: new Date().toISOString(),
    updated_by: '00000000-0000-4000-8000-000000000001',
    updated_at: new Date().toISOString(),
    revision: state.revision,
  }]
}

async function installRpcRoutes(page, state, mutations) {
  await page.route('**/rest/v1/rpc/get_overtime_initial_deadline_config', async (route) => {
    const parameters = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(configResponse(parameters, state)),
    })
  })
  await page.route('**/rest/v1/rpc/set_overtime_initial_deadline_config', async (route) => {
    const parameters = route.request().postDataJSON()
    mutations.push(parameters)
    state.initialSubmissionDays = parameters.p_initial_submission_days
    state.temporarySubmissionDays = parameters.p_temporary_submission_days
    state.temporaryEffectiveUntil = parameters.p_temporary_effective_until
    state.temporaryReason = parameters.p_temporary_reason
    state.revision += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/rest/v1/rpc/list_overtime_replacement_employees_l2', (route) => (
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  ))
}

async function installReact(page) {
  await page.evaluate(async () => {
    const RefreshRuntime = (await import('/@react-refresh')).default
    RefreshRuntime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    await import('/src/styles/index.css')
  })
}

await server.listen()
let browser
try {
  browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  })

  const state = {
    initialSubmissionDays: 7,
    temporarySubmissionDays: 10,
    temporaryEffectiveUntil: new Date(Date.now() + 86400000).toISOString(),
    temporaryReason: 'Gangguan operasional test',
    revision: 2,
  }
  const mutations = []
  const settingsPage = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await installRpcRoutes(settingsPage, state, mutations)
  await settingsPage.goto('http://127.0.0.1:4190/overtime-deadline-settings-test')
  await installReact(settingsPage)
  await settingsPage.evaluate(async ({ contractId, up3Id }) => {
    const ReactModule = await import('/node_modules/.vite/deps/react.js')
    const React = ReactModule.default ?? ReactModule
    const ReactDOMClient = await import('/node_modules/.vite/deps/react-dom_client.js')
    const createRoot = ReactDOMClient.createRoot ?? ReactDOMClient.default?.createRoot
    const Component = (await import('/src/components/sla/SLAPengaturanLembur.jsx')).default
    window.__deadlineRoot = createRoot(document.getElementById('root'))
    window.__renderDeadlineSettings = (isSuperAdmin) => window.__deadlineRoot.render(React.createElement(Component, {
      contractId,
      up3Id,
      up3Name: 'UP3 Singkawang',
      isSuperAdmin,
    }))
    window.__renderDeadlineSettings(true)
  }, { contractId: CONTRACT_ID, up3Id: UP3_ID })

  await settingsPage.getByRole('heading', { name: 'Pengaturan Lembur' }).waitFor()
  await settingsPage.getByText('H+10', { exact: true }).waitFor()
  const normalInput = settingsPage.locator('label').filter({ hasText: 'Jumlah hari setelah tanggal mulai' }).locator('input')
  await normalInput.fill('9')
  await settingsPage.getByText('Aktifkan toleransi sementara').click()
  await settingsPage.getByRole('button', { name: 'Simpan Pengaturan' }).click()
  await settingsPage.getByText('Pengaturan deadline Lembur berhasil disimpan dan dicatat dalam audit.').waitFor()
  if (mutations.length !== 1) throw new Error(`Mutation count salah: ${mutations.length}`)
  if (mutations[0].p_initial_submission_days !== 9 || mutations[0].p_temporary_submission_days !== null) {
    throw new Error(`Payload mutation salah: ${JSON.stringify(mutations[0])}`)
  }

  await settingsPage.evaluate(() => window.__renderDeadlineSettings(false))
  await settingsPage.getByText('Hanya baca', { exact: true }).waitFor()
  if (await settingsPage.getByRole('button', { name: 'Simpan Pengaturan' }).count()) {
    throw new Error('Role read-only masih melihat action mutation')
  }
  if (!await normalInput.isDisabled()) throw new Error('Input role read-only masih aktif')
  await settingsPage.setViewportSize({ width: 375, height: 780 })
  const mobileOverflow = await settingsPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  if (mobileOverflow) throw new Error('Panel Pengaturan Lembur overflow pada viewport mobile')

  state.initialSubmissionDays = 7
  state.temporarySubmissionDays = 10
  state.temporaryEffectiveUntil = new Date(Date.now() + 86400000).toISOString()
  state.temporaryReason = 'Gangguan operasional test'
  const formPage = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await installRpcRoutes(formPage, state, mutations)
  await formPage.goto('http://127.0.0.1:4190/overtime-deadline-settings-test')
  await installReact(formPage)
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Pontianak',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`
  await formPage.evaluate(async ({ contractId, up3Id, periodMonth }) => {
    const ReactModule = await import('/node_modules/.vite/deps/react.js')
    const React = ReactModule.default ?? ReactModule
    const ReactDOMClient = await import('/node_modules/.vite/deps/react-dom_client.js')
    const createRoot = ReactDOMClient.createRoot ?? ReactDOMClient.default?.createRoot
    const Component = (await import('/src/components/sla/SLALembur.jsx')).default
    createRoot(document.getElementById('root')).render(React.createElement(Component, {
      contractScope: { contractId, contractName: 'Pelayanan Teknik' },
      up3Id,
      unitId: '27617d7d-795f-4f34-8edd-cc236ed49146',
      periodMonth,
      records: [],
      canMutate: true,
      loading: false,
      loadError: '',
      orgUnits: [],
      onRetry: () => {},
      onRefresh: async () => {},
      onSaveDraft: async () => ({ ok: false, message: 'UI smoke only' }),
      onSubmit: async () => ({ ok: false, message: 'UI smoke only' }),
      onSaveWorkDraft: async () => ({ ok: false, message: 'UI smoke only' }),
      onSubmitWork: async () => ({ ok: false, message: 'UI smoke only' }),
    }))
  }, { contractId: CONTRACT_ID, up3Id: UP3_ID, periodMonth: `${today.slice(0, 7)}-01` })
  await formPage.getByRole('button', { name: '+ Tambah Lembur' }).click()
  await formPage.getByRole('button', { name: /^Lembur Pekerjaan/ }).click()
  for (const category of ['Administrasi', 'Gardu', 'JTM', 'JTR', 'ROW']) {
    if (!await formPage.getByRole('button', { name: new RegExp(`^${category}`) }).isVisible()) {
      throw new Error(`Kategori ${category} tidak terlihat`)
    }
  }
  await formPage.getByRole('button', { name: '← Kembali' }).click()
  await formPage.getByRole('button', { name: /^Pengganti Cuti/ }).click()
  await formPage.locator('label').filter({ hasText: 'Tanggal Lembur' }).locator('input').fill(today)
  await formPage.getByText(/Batas pengajuan H\+10:/).waitFor()
  if (await formPage.getByRole('button', { name: 'Simpan Draft' }).isDisabled()) {
    throw new Error('Simpan Draft tetap disabled setelah deadline server valid')
  }

  console.log(`Overtime deadline settings UI tests passed: ${JSON.stringify({ mutation: mutations[0], mobile: true, effectiveDays: 10, categories: 8 })}`)
} finally {
  if (browser) await browser.close()
  await server.close()
}
