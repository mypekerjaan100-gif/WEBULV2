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
    window.aiSettings={provider:'gemini',model:'gemini-3.6-flash',base_url:'https://generativelanguage.googleapis.com',enabled:false,has_key:false,key_hint:null,key_count:0,active_key_count:0,keys:[],last_test_at:null,last_test_ok:null,last_test_message:null,updated_at:null};
    window.aiKeys={gemini:[],deepseek:[],grok:[]};
    window.aiKeySeq=0;
    const publish=()=>{
      const keys=window.aiKeys[window.aiSettings.provider]??[];
      const primary=keys.find((key)=>key.enabled)??keys[0];
      window.aiSettings={...window.aiSettings,keys,has_key:keys.length>0,key_count:keys.length,active_key_count:keys.filter((key)=>key.enabled).length,key_hint:primary?.hint??null,enabled:window.aiSettings.enabled&&keys.some((key)=>key.enabled)};
      return window.aiSettings;
    };
    export const getAiSettings=async()=>publish();
    export const saveAiSettings=async(input)=>{
      if(window.failAiSave)throw Error('API key harus terdiri dari 8 sampai 500 karakter.');
      window.lastAiSave=input;
      window.aiSettings={...window.aiSettings,provider:input.provider,model:input.model,base_url:input.baseUrl,enabled:Boolean(input.enabled),last_test_at:null,last_test_ok:null,last_test_message:null};
      return publish();
    };
    export const addAiApiKey=async({provider,apiKey,label=''})=>{
      if(apiKey.length<8||apiKey.length>500)throw Error('API key harus terdiri dari 8 sampai 500 karakter.');
      const keys=window.aiKeys[provider];
      if(keys.length>=10)throw Error('Maksimal 10 API key untuk setiap penyedia.');
      keys.push({id:'key'+(++window.aiKeySeq),hint:'••••'+apiKey.slice(-4),label,position:keys.length,enabled:true,status:'active',cooldown_until:null,last_error:null,last_used_at:null,last_success_at:null,created_at:new Date().toISOString()});
      return publish();
    };
    export const updateAiApiKey=async({keyId,enabled=null,label=null})=>{
      const keys=window.aiKeys[window.aiSettings.provider]??[];
      const key=keys.find((item)=>item.id===keyId);
      if(!key)throw Error('API key tidak ditemukan.');
      if(enabled===false&&window.aiSettings.enabled&&key.enabled&&keys.filter((item)=>item.enabled).length<=1)throw Error('Nonaktifkan AI sebelum menonaktifkan API key terakhir yang aktif.');
      window.aiKeys[window.aiSettings.provider]=keys.map((item)=>item.id===keyId?{...item,enabled:enabled==null?item.enabled:enabled,label:label==null?item.label:label}:item);
      return publish();
    };
    export const promoteAiApiKey=async(keyId)=>{
      const keys=window.aiKeys[window.aiSettings.provider]??[];
      const key=keys.find((item)=>item.id===keyId);
      if(!key)throw Error('API key tidak ditemukan.');
      window.aiKeys[window.aiSettings.provider]=[key,...keys.filter((item)=>item.id!==keyId)].map((item,index)=>({...item,position:index}));
      return publish();
    };
    export const deleteAiApiKey=async(keyId)=>{
      const keys=window.aiKeys[window.aiSettings.provider]??[];
      const key=keys.find((item)=>item.id===keyId);
      if(!key)throw Error('API key tidak ditemukan.');
      if(window.aiSettings.enabled&&key.enabled&&keys.filter((item)=>item.enabled).length<=1)throw Error('Nonaktifkan AI sebelum menghapus API key terakhir yang aktif.');
      window.aiKeys[window.aiSettings.provider]=keys.filter((item)=>item.id!==keyId).map((item,index)=>({...item,position:index}));
      return publish();
    };
    export const testAiConnection=async()=>{
      if(window.failAiTest)throw Error('Penyedia AI menolak permintaan (HTTP 401): API key salah.');
      const keys=(window.aiKeys[window.aiSettings.provider]??[]).filter((key)=>key.enabled);
      if(!keys.length)throw Error('API key AI belum disimpan.');
      window.aiSettings={...window.aiSettings,last_test_at:new Date().toISOString(),last_test_ok:true,last_test_message:'Koneksi berhasil melalui Google Gemini — '+keys.length+' dari '+keys.length+' key siap.'};
      return {message:'Koneksi ke Google Gemini berhasil.',tested:keys.length,ok_count:keys.length};
    };
    export const clearAiApiKey=async()=>{
      window.aiKeys[window.aiSettings.provider]=[];
      window.aiSettings={...window.aiSettings,enabled:false,last_test_at:null,last_test_ok:null,last_test_message:null};
      return publish();
    };
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
  assert.match(await page.getByText('Belum ada API key', { exact: true }).innerText(), /Belum ada API key/)
  assert.equal(await page.getByRole('button', { name: 'Uji koneksi' }).isDisabled(), true)

  const providerBox = await page.getByLabel('Penyedia AI').evaluate((el) => {
    const style = getComputedStyle(el)
    return { height: el.getBoundingClientRect().height, radius: style.borderRadius, border: style.borderTopWidth, carets: el.querySelectorAll('.bbm-cs-caret svg').length }
  })
  assert(providerBox.height >= 42, `Pemilih penyedia harus cukup tinggi: ${providerBox.height}`)
  assert.equal(providerBox.radius, '10px', 'Pemilih penyedia harus bersudut membulat')
  assert.equal(providerBox.border, '1px')
  assert.equal(providerBox.carets, 1, 'Pemilih penyedia harus memakai ikon panah khusus')
  assert.equal(await page.locator('.ai-select .bbm-cs-caret').count(), 2, 'Penyedia dan model harus memakai panah khusus')
  await page.getByLabel('Penyedia AI').click()
  const providerPopup = page.locator('.ai-select-popup')
  await providerPopup.waitFor()
  const selectLayout = await page.evaluate(() => {
    const trigger = document.querySelector('.ai-select')
    const popup = document.querySelector('.ai-select-popup')
    const list = popup.querySelector('.bbm-cs-list')
    const triggerRect = trigger.getBoundingClientRect()
    const popupRect = popup.getBoundingClientRect()
    return {
      popupTop: popupRect.top,
      triggerBottom: triggerRect.bottom,
      popupWidth: popupRect.width,
      triggerWidth: triggerRect.width,
      listDisplay: getComputedStyle(list).display,
      listDirection: getComputedStyle(list).flexDirection,
      justify: getComputedStyle(trigger).justifyContent,
    }
  })
  assert.equal(selectLayout.justify, 'space-between', 'Isi pemilih harus rata kiri dengan panah di kanan')
  assert(selectLayout.popupTop > selectLayout.triggerBottom, 'Daftar pilihan harus muncul di bawah pemilih')
  assert(Math.abs(selectLayout.popupWidth - selectLayout.triggerWidth) < 2, 'Lebar daftar pilihan harus mengikuti pemilih')
  assert.equal(selectLayout.listDisplay, 'flex')
  assert.equal(selectLayout.listDirection, 'column')
  assert.equal(await providerPopup.locator('.bbm-cs-option[aria-selected="true"]').innerText(), 'Google Gemini')
  assert.equal(await providerPopup.locator('.bbm-cs-option[aria-selected="true"]').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(237, 247, 241)')
  await page.screenshot({ path: 'C:\\Users\\risky\\AppData\\Local\\Temp\\opencode\\ai-settings-provider.png' })
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.ai-select-popup').count(), 0)

  await page.getByLabel('Nama API key').fill('Utama')
  await page.getByLabel('API key baru').fill('AIza-test-key-1234')
  await page.getByRole('button', { name: 'Tambah key' }).click()
  await page.getByText('API key berhasil ditambahkan.').waitFor()
  const firstKeyRow = page.locator('.ai-key-row').first()
  assert.match(await firstKeyRow.innerText(), /Utama/)
  assert.match(await firstKeyRow.innerText(), /••••1234/)
  assert.match(await page.getByText('1/1 aktif').innerText(), /1\/1/)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Simpan pengaturan' }).click()
  await page.getByText('Pengaturan AI tersimpan.').waitFor()
  assert.deepEqual(await page.evaluate(() => window.lastAiSave), {
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
    enabled: true,
  })
  assert.match(await page.getByText('Aktif · Google Gemini').innerText(), /Aktif/)

  await page.getByRole('button', { name: 'Uji koneksi' }).click()
  await page.getByText('Koneksi ke Google Gemini berhasil. 1 dari 1 API key siap.').waitFor()
  assert.match(await page.getByText(/Koneksi berhasil melalui Google Gemini/).innerText(), /berhasil/)
  await page.screenshot({ path: 'C:\\Users\\risky\\AppData\\Local\\Temp\\opencode\\ai-settings.png', fullPage: true })

  await page.getByLabel('Penyedia AI').click()
  await page.getByRole('option', { name: 'DeepSeek', exact: true }).click()
  assert.match(await page.getByLabel('Penyedia AI').innerText(), /DeepSeek/)
  assert.equal(await page.getByLabel('Endpoint dasar AI').inputValue(), 'https://api.deepseek.com')
  assert.match(await page.getByLabel('Model AI').innerText(), /deepseek-flash/)
  assert.equal(await page.getByRole('checkbox').isDisabled(), true, 'AI tidak boleh diaktifkan sebelum penyedia baru disimpan')
  await page.getByRole('button', { name: 'Simpan pengaturan' }).click()
  await page.getByText('Pengaturan AI tersimpan.').waitFor()
  assert.equal(await page.evaluate(() => window.aiSettings.provider), 'deepseek')
  assert.match(await page.getByText('Belum ada API key untuk DeepSeek.').innerText(), /Belum ada API key/)

  await page.getByLabel('Nama API key').fill('Utama DeepSeek')
  await page.getByLabel('API key baru').fill('sk-deepseek-test-5678')
  await page.getByRole('button', { name: 'Tambah key' }).click()
  await page.getByText('API key berhasil ditambahkan.').waitFor()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Simpan pengaturan' }).click()
  await page.getByText('Pengaturan AI tersimpan.').waitFor()
  assert.equal(await page.evaluate(() => window.aiSettings.provider), 'deepseek')
  assert.equal(await page.evaluate(() => window.aiSettings.enabled), true)

  await page.getByLabel('Nama API key').fill('Cadangan')
  await page.getByLabel('API key baru').fill('sk-deepseek-backup-9999')
  await page.getByRole('button', { name: 'Tambah key' }).click()
  await page.getByText('API key berhasil ditambahkan.').waitFor()
  const keyRows = page.locator('.ai-key-row')
  assert.equal(await keyRows.count(), 2)
  assert.match(await keyRows.nth(0).innerText(), /Utama DeepSeek/)
  assert.match(await keyRows.nth(1).innerText(), /Cadangan/)
  assert.match(await keyRows.nth(1).innerText(), /••••9999/)

  await keyRows.nth(1).getByRole('button', { name: /Jadikan Cadangan utama/ }).click()
  await page.getByText('API key dijadikan utama.').waitFor()
  assert.match(await keyRows.nth(0).innerText(), /Cadangan/)
  assert.equal(await keyRows.nth(0).getByText('Utama', { exact: true }).count(), 1)

  await keyRows.nth(1).getByRole('button', { name: /Nonaktifkan Utama DeepSeek/ }).click()
  await page.getByText('API key dinonaktifkan.').waitFor()
  assert.match(await keyRows.nth(1).innerText(), /Nonaktif/)

  await keyRows.nth(1).getByRole('button', { name: /Hapus Utama DeepSeek/ }).click()
  const deleteDialog = page.getByRole('dialog', { name: 'Hapus API key?' })
  await deleteDialog.waitFor()
  await deleteDialog.getByRole('button', { name: 'Hapus key', exact: true }).click()
  await page.getByText('API key telah dihapus.').waitFor()
  assert.equal(await keyRows.count(), 1)
  assert.match(await keyRows.nth(0).innerText(), /Cadangan/)
  assert.equal(await page.evaluate(() => window.aiSettings.active_key_count), 1)

  await page.getByLabel('Endpoint dasar AI').fill('https://evil.example.com')
  await page.getByRole('button', { name: 'Simpan pengaturan' }).click()
  await page.getByText('Endpoint DeepSeek harus https://api.deepseek.com.').waitFor()

  await page.setViewportSize({ width: 390, height: 900 })
  assert.equal(await page.locator('.ai-settings-layout').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1)
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.waitForTimeout(250)
  const luminance = (color) => {
    const [r, g, b] = String(color).match(/\d+/g).map(Number)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const darkSelect = await page.getByLabel('Penyedia AI').evaluate((el) => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
  assert(luminance(darkSelect.background) < 70, `Latar pemilih mode gelap harus gelap: ${darkSelect.background}`)
  assert(luminance(darkSelect.color) > 150, `Teks pemilih mode gelap harus terang: ${darkSelect.color}`)
  await page.getByLabel('Model AI').click()
  const darkPopup = page.locator('.ai-select-popup')
  await darkPopup.waitFor()
  const darkSelected = await darkPopup.locator('.bbm-cs-option[aria-selected="true"]').evaluate((el) => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
  assert(luminance(darkSelected.background) < 90, 'Pilihan aktif mode gelap harus memakai latar gelap')
  assert(luminance(darkSelected.color) > 150, 'Teks pilihan aktif mode gelap harus terang')
  await page.screenshot({ path: 'C:\\Users\\risky\\AppData\\Local\\Temp\\opencode\\ai-settings-dark.png' })
  await page.keyboard.press('Escape')
  await page.locator('.ai-keys-card').scrollIntoViewIfNeeded()
  const darkKey = await page.locator('.ai-key-row').first().evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el.querySelector('.ai-key-copy strong')).color,
  }))
  assert(luminance(darkKey.background) < 90, `Latar key mode gelap harus gelap: ${darkKey.background}`)
  assert(luminance(darkKey.color) > 150, `Teks key mode gelap harus terang: ${darkKey.color}`)
  await page.screenshot({ path: 'C:\\Users\\risky\\AppData\\Local\\Temp\\opencode\\ai-settings-dark-keys.png' })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  assert.deepEqual(errors, [])
  console.log('AI settings browser: provider, model, multi-key rotation, failover status, validation and mobile passed.')
} finally {
  await browser?.close()
  await server.close()
}
