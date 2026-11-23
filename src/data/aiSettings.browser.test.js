import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'ai-settings-test', configureServer(vite) {
    vite.middlewares.use('/ai-settings-test', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><main id="root"></main>') })
  },
}] })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/src/data/aiRepository.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.aiSettings={provider:'gemini',model:'gemini-3.6-flash',base_url:'https://generativelanguage.googleapis.com',enabled:false,has_key:false,key_hint:null,last_test_at:null,last_test_ok:null,last_test_message:null,updated_at:null};
    export const getAiSettings=async()=>window.aiSettings;
    export const saveAiSettings=async(input)=>{
      if(window.failAiSave)throw Error('API key harus terdiri dari 8 sampai 500 karakter.');
      window.lastAiSave=input;
      const sameProvider=window.aiSettings.provider===input.provider;
      const hasKey=input.apiKey?true:(window.aiSettings.has_key&&sameProvider);
      window.aiSettings={...window.aiSettings,provider:input.provider,model:input.model,base_url:input.baseUrl,enabled:input.enabled&&hasKey,has_key:hasKey,key_hint:input.apiKey?'••••'+input.apiKey.slice(-4):(sameProvider?window.aiSettings.key_hint:null),last_test_at:null,last_test_ok:null,last_test_message:null};
      return window.aiSettings;
    };
    export const testAiConnection=async()=>{
      if(window.failAiTest)throw Error('Penyedia AI menolak permintaan (HTTP 401): API key salah.');
      window.aiSettings={...window.aiSettings,last_test_at:new Date().toISOString(),last_test_ok:true,last_test_message:'Koneksi berhasil melalui Google Gemini.'};
      return {message:'Koneksi ke Google Gemini berhasil.'};
    };
    export const clearAiApiKey=async()=>{window.aiSettings={...window.aiSettings,enabled:false,has_key:false,key_hint:null,last_test_at:null,last_test_ok:null,last_test_message:null};return window.aiSettings;};
  ` }))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/ai-settings-test`)
  await page.evaluate(async () => {
    const { default: Refresh } = await import('/@react-refresh'); Refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (t) => t; window.__vite_plugin_react_preamble_installed__ = true
    await import('/src/styles/index.css')
    const r = await import('/node_modules/.vite/deps/react.js'), React = r.default ?? r
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Page } = await import('/src/pages/AIPengaturanPage.jsx')
    const root = (dom.createRoot ?? dom.default.createRoot)(document.getElementById('root'))
    root.render(React.createElement(Page, { onBack: () => {} }))
  })
  await page.getByRole('heading', { name: 'Pengaturan AI' }).waitFor()
  assert.match(await page.getByLabel('Penyedia AI').innerText(), /Google Gemini/)
  assert.match(await page.getByLabel('Model AI').innerText(), /gemini-3\.6-flash/)
  assert.equal(await page.getByLabel('Endpoint dasar AI').inputValue(), 'https://generativelanguage.googleapis.com')
  assert.match(await page.getByText('Belum ada API key').innerText(), /Belum ada API key/)
  assert.equal(await page.getByRole('button', { name: 'Uji koneksi' }).isDisabled(), true)

  await page.getByLabel('API key AI').fill('AIza-test-key-1234')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Simpan pengaturan' }).click()
  await page.getByText('Pengaturan AI tersimpan.').waitFor()
  assert.deepEqual(await page.evaluate(() => window.lastAiSave), {
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: 'AIza-test-key-1234',
    enabled: true,
  })
  assert.match(await page.getByText('Aktif · Google Gemini').innerText(), /Aktif/)
  assert.match(await page.getByText('API key tersimpan: ••••1234.').innerText(), /••••1234/)

  await page.getByRole('button', { name: 'Uji koneksi' }).click()
  await page.getByText('Koneksi ke Google Gemini berhasil.').waitFor()
  assert.match(await page.getByText('Koneksi berhasil melalui Google Gemini.').innerText(), /berhasil/)
  await page.screenshot({ path: 'C:\\Users\\risky\\AppData\\Local\\Temp\\opencode\\ai-settings.png', fullPage: true })

  await page.getByLabel('Penyedia AI').click()
  await page.getByRole('option', { name: 'DeepSeek', exact: true }).click()
  assert.match(await page.getByLabel('Penyedia AI').innerText(), /DeepSeek/)
  assert.equal(await page.getByLabel('Endpoint dasar AI').inputValue(), 'https://api.deepseek.com')
  assert.match(await page.getByLabel('Model AI').innerText(), /deepseek-flash/)
  await page.getByRole('button', { name: 'Simpan pengaturan' }).click()
  await page.getByText('Masukkan API key untuk penyedia AI yang baru.').waitFor()

  await page.getByLabel('API key AI').fill('sk-deepseek-test-5678')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Simpan pengaturan' }).click()
  await page.getByText('Pengaturan AI tersimpan.').waitFor()
  assert.equal(await page.evaluate(() => window.aiSettings.provider), 'deepseek')
  assert.equal(await page.evaluate(() => window.aiSettings.enabled), true)

  await page.getByRole('button', { name: 'Hapus API key' }).click()
  const clearDialog = page.getByRole('dialog', { name: 'Hapus API key AI?' })
  await clearDialog.waitFor()
  await clearDialog.getByRole('button', { name: 'Hapus API key', exact: true }).click()
  await page.getByText('API key AI telah dihapus. AI dinonaktifkan.').waitFor()
  assert.equal(await page.evaluate(() => window.aiSettings.has_key), false)
  assert.equal(await page.getByRole('button', { name: 'Hapus API key' }).count(), 0)

  await page.getByLabel('Endpoint dasar AI').fill('https://evil.example.com')
  await page.getByRole('button', { name: 'Simpan pengaturan' }).click()
  await page.getByText('Endpoint DeepSeek harus https://api.deepseek.com.').waitFor()

  await page.setViewportSize({ width: 390, height: 900 })
  assert.equal(await page.locator('.ai-settings-layout').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1)
  assert.deepEqual(errors, [])
  console.log('AI settings browser: provider, model, secure key form, test connection, key removal, validation and mobile passed.')
} finally {
  await browser?.close()
  await server.close()
}
