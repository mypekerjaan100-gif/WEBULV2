import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'bbm-test', configureServer(vite) {
    vite.middlewares.use('/bbm-test', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><main id="root"></main>') })
  },
}] })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/src/data/bbmRepository.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export const listBbmVehicles=async()=>[{id:'vehicle',ulp_id:'ulp',label:'RODA 4',plate_display:'KB 1382 AX',can_write:true}];
    export const getBbmSheet=async()=>window.bbmSaved??{rows:[],details:{},revision:0,initial_odometer:null,previous:null,can_write:true};
    export const saveBbmSheet=async(v,m,rev,initial,rows,details)=>{
      if(window.failSave)throw Error('Laporan berubah. Muat ulang');
      window.bbmSaved={revision:rev+1,rows,details,initial_odometer:Number(initial),previous:null,can_write:true};return window.bbmSaved;
    };
    export const uploadBbmPhoto=async(v,date,kind,file)=>date+'/'+kind+'/'+file.name;
    export const getBbmPhoto=async()=> 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
  ` }))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/bbm-test`)
  await page.evaluate(async () => {
    const { default: Refresh } = await import('/@react-refresh'); Refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (t) => t; window.__vite_plugin_react_preamble_installed__ = true
    await import('/src/styles/index.css')
    const r = await import('/node_modules/.vite/deps/react.js'), React = r.default ?? r
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Report } = await import('/src/components/sla/BbmReport.jsx')
    const root = (dom.createRoot ?? dom.default.createRoot)(document.getElementById('root'))
    window.renderBbm = (write, preview = false) => root.render(React.createElement(Report, { key: `${write}:${preview}`, contractId: 'contract', up3Id: 'up3', ownUlpId: write ? 'ulp' : null, units: [{ uuid: 'ulp', type: 'ULP', displayName: 'ULP Pemangkat' }], canWrite: write, previewActive: preview, initialMonth: '2026-10', onEditorStateChange: (s) => { window.editor = s } }))
    window.renderBbm(true)
  })
  await page.getByRole('heading', { name: /BERITA ACARA/ }).waitFor()
  assert.equal(await page.locator('.bbm-grid').first().locator('tbody tr').count(), 31)
  await page.getByLabel('Stand awal pertama 2026-10-01').fill('40951')
  await page.getByLabel('Stand akhir 2026-10-01', { exact: true }).fill('41186')
  await page.getByLabel('Stand akhir 2026-10-01', { exact: true }).press('Enter')
  assert.equal(await page.getByLabel('Stand akhir 2026-10-02', { exact: true }).evaluate((el) => el === document.activeElement), true)
  await page.getByRole('button', { name: 'Simpan laporan', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'foto odometer wajib' }).waitFor()
  const photo = { name: 'proof.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('test') }
  await page.getByLabel('Foto odometer 2026-10-01', { exact: true }).setInputFiles(photo)
  await page.getByRole('button', { name: 'Lihat foto odometer 2026-10-01' }).waitFor()
  await page.getByRole('button', { name: 'Tambah pembelian 2026-10-01', exact: true }).click()
  await page.getByLabel('Liter 2026-10-01 1', { exact: true }).fill('50')
  await page.getByLabel('Harga per liter 2026-10-01 1', { exact: true }).fill('10000')
  await page.getByLabel('Jenis BBM 2026-10-01 1', { exact: true }).selectOption('Pertalite')
  await page.getByLabel('Foto struk 1 2026-10-01', { exact: true }).setInputFiles(photo)
  await page.getByRole('button', { name: 'Lihat foto struk 2026-10-01' }).waitFor()
  await page.getByLabel('Nama pemeriksa', { exact: true }).fill('Pemeriksa Contoh')
  await page.getByRole('button', { name: 'Simpan laporan', exact: true }).click()
  await page.getByText('Laporan BBM tersimpan.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.bbmSaved.rows[0].purchases[0].liters), '50')
  assert.match(await page.locator('tfoot').innerText(), /500\.000/)
  await page.getByLabel('Stand akhir 2026-10-02', { exact: true }).fill('41200')
  assert.match(await page.locator('.bbm-grid').first().locator('tbody tr').nth(1).innerText(), /41\.186/)
  await page.getByLabel('Foto odometer 2026-10-02', { exact: true }).setInputFiles(photo)
  await page.getByRole('button', { name: 'Lihat foto odometer 2026-10-02' }).waitFor()
  await page.evaluate(() => { window.failSave = true })
  await page.getByRole('button', { name: 'Simpan laporan', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Laporan berubah' }).waitFor()
  assert.equal(await page.getByLabel('Stand akhir 2026-10-02', { exact: true }).inputValue(), '41200')
  page.on('dialog', (d) => d.dismiss())
  await page.getByLabel('Periode BBM').fill('2026-09')
  assert.equal(await page.getByLabel('Periode BBM').inputValue(), '2026-10')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'C:\\Users\\risky\\AppData\\Local\\Temp\\opencode\\bbm-spreadsheet.png', fullPage: true })
  await page.evaluate(() => window.renderBbm(false))
  await page.getByRole('heading', { name: /BERITA ACARA/ }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Simpan laporan' }).count(), 0)
  assert.equal(await page.locator('.bbm-paper input:not(:disabled)').count(), 0)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.locator('.bbm-scroll').evaluate((el) => el.scrollWidth > el.clientWidth), true)
  await page.evaluate(() => window.renderBbm(true, true))
  await page.getByRole('heading', { name: /BERITA ACARA/ }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Simpan laporan' }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('BBM browser: spreadsheet, keyboard, photos, save, stale-save preservation, navigation guard, reader, preview and mobile passed.')
} finally { await browser?.close(); await server.close() }
