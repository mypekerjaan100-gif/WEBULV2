import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { periodLabelFromMonth } from './versiSlaPelayananTeknik.js'

assert.equal(periodLabelFromMonth('2026-10'), 'Oktober 2026')
assert.equal(periodLabelFromMonth('2026-10-01'), 'Oktober 2026')
assert.equal(periodLabelFromMonth('2026-13'), null)
assert.equal(periodLabelFromMonth(''), null)

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
    export const listBbmVehicles=async({month})=>{if(!/^\\d{4}-\\d{2}$/.test(month??''))throw Error('invalid input syntax for type date: \"'+month+'-01\"');return [{id:'vehicle',ulp_id:'ulp',label:'RODA 4',plate_display:'KB 1382 AX',can_write:true},{id:'vehicle2',ulp_id:'ulp',label:'RODA 2 - Inspeksi TM/TR',plate_display:'KB 2644XT',can_write:true}]};
    export const getBbmSheet=async(v,month)=>{if(!/^\\d{4}-\\d{2}$/.test(month??''))throw Error('invalid input syntax for type date: \"'+month+'-01\"');return window.bbmSaved??{rows:[],details:{},revision:0,initial_odometer:null,previous:null,can_write:true}};
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
    window.renderBbm = (write, preview = false, month = '2026-10') => root.render(React.createElement(Report, { key: `${write}:${preview}:${month}`, contractId: 'contract', up3Id: 'up3', ownUlpId: write ? 'ulp' : null, units: [{ uuid: 'ulp', type: 'ULP', displayName: 'ULP Pemangkat' }], canWrite: write, previewActive: preview, initialMonth: `${month}-01`, onMonthChange: (value) => window.renderBbm(write, preview, value), onEditorStateChange: (s) => { window.editor = s } }))
    window.renderBbm(true, false, '2026-11')
  })
  await page.getByRole('heading', { name: /BERITA ACARA/ }).waitFor()
  assert.equal(await page.getByLabel('Periode BBM').evaluate((el) => el.tagName), 'BUTTON')
  await page.getByLabel('Periode BBM').click()
  await page.locator('.bbm-mp-popup').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Desember 2026' }).isDisabled(), true)
  await page.screenshot({ path: 'C:\\Users\\risky\\AppData\\Local\\Temp\\opencode\\bbm-month-picker.png' })
  await page.getByRole('button', { name: 'Oktober 2026' }).click()
  await page.getByRole('heading', { name: /BERITA ACARA/ }).waitFor()
  assert.match(await page.getByLabel('Periode BBM').innerText(), /Oktober 2026/)
  assert.equal(await page.getByRole('alert').count(), 0)
  await page.getByLabel('Kendaraan BBM').click()
  await page.locator('.bbm-cs-popup').waitFor()
  await page.getByLabel('Cari kendaraan').focus()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.bbm-cs-search')).boxShadow.includes('24, 136, 108'))
  const searchOutline = await page.getByLabel('Cari kendaraan').evaluate((el) => getComputedStyle(el).outlineStyle)
  assert.equal(searchOutline, 'none')
  const searchFrame = await page.locator('.bbm-cs-search').evaluate((el) => getComputedStyle(el).boxShadow)
  assert.match(searchFrame, /rgba\(24, 136, 108/)
  await page.getByLabel('Cari kendaraan').fill('2644')
  assert.equal(await page.getByRole('option').count(), 1)
  await page.screenshot({ path: 'C:\\Users\\risky\\AppData\\Local\\Temp\\opencode\\bbm-vehicle-dropdown.png' })
  await page.getByRole('option', { name: /KB 2644XT/ }).click()
  await page.getByRole('heading', { name: /BERITA ACARA/ }).waitFor()
  assert.match(await page.getByLabel('Kendaraan BBM').innerText(), /KB 2644XT/)
  assert.equal(await page.locator('.bbm-grid').first().locator('tbody tr').count(), 31)
  assert.notEqual(await page.locator('.bbm-toolbar').evaluate((el) => getComputedStyle(el).position), 'sticky')
  await page.evaluate(() => {
    const head = document.querySelector('.bbm-grid:not(.bbm-sampling) thead')
    window.scrollTo(0, head.getBoundingClientRect().top + window.scrollY - 8)
  })
  assert(await page.locator('.bbm-toolbar').evaluate((el) => el.getBoundingClientRect().bottom < 0))
  assert(await page.locator('.bbm-grid:not(.bbm-sampling) thead').evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return rect.top >= 0 && rect.top < 40
  }))
  await page.screenshot({ path: 'C:\\Users\\risky\\AppData\\Local\\Temp\\opencode\\bbm-toolbar-scroll.png' })
  await page.evaluate(() => window.scrollTo(0, 0))
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
  await page.getByLabel('Periode BBM').click()
  await page.getByRole('button', { name: 'September 2026' }).click()
  assert.match(await page.getByLabel('Periode BBM').innerText(), /Oktober 2026/)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'C:\\Users\\risky\\AppData\\Local\\Temp\\opencode\\bbm-spreadsheet.png', fullPage: true })
  await page.evaluate(() => window.renderBbm(false))
  await page.getByRole('heading', { name: /BERITA ACARA/ }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Simpan laporan' }).count(), 0)
  assert.equal(await page.locator('.bbm-paper input:not(:disabled)').count(), 0)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.locator('.bbm-scroll').evaluate((el) => el.scrollWidth > el.clientWidth), true)
  await page.getByLabel('Periode BBM').focus()
  await page.keyboard.press('Enter')
  await page.locator('.bbm-mp-popup').waitFor()
  const mobilePopup = await page.locator('.bbm-mp-popup').boundingBox()
  assert(mobilePopup.x >= 0 && mobilePopup.x + mobilePopup.width <= 390)
  await page.screenshot({ path: 'C:\\Users\\risky\\AppData\\Local\\Temp\\opencode\\bbm-month-picker-mobile.png' })
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.bbm-mp-popup').count(), 0)
  await page.evaluate(() => window.renderBbm(true, true))
  await page.getByRole('heading', { name: /BERITA ACARA/ }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Simpan laporan' }).count(), 0)
  await page.evaluate(() => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ date: `2026-09-${String(index + 1).padStart(2, '0')}`, end: 1000 + index, photo: `odo-${index}`, purchases: [] }))
    window.bbmSaved = { revision: 5, details: {}, rows, initial_odometer: 999, previous: null, can_write: true }
    window.renderBbm(false, false, '2026-09')
  })
  await page.getByRole('heading', { name: /BERITA ACARA/ }).waitFor()
  assert.equal(await page.getByLabel('Tanggal berita acara').inputValue(), '2026-09-30')
  assert.equal(await page.getByLabel('Tanggal berita acara').getAttribute('title'), 'Otomatis: seluruh odometer dan foto bulan ini sudah lengkap')
  assert.match(await page.locator('.bbm-sign-date').innerText(), /30 September 2026/)
  await page.evaluate(() => {
    const rows = Array.from({ length: 31 }, (_, index) => ({ date: `2026-07-${String(index + 1).padStart(2, '0')}`, end: 2000 + index, photo: `odo-${index}`, purchases: [] }))
    window.bbmSaved = { revision: 6, details: { report_date: '2026-07-20' }, rows, initial_odometer: 1999, previous: null, can_write: true }
    window.renderBbm(false, false, '2026-07')
  })
  await page.getByRole('heading', { name: /BERITA ACARA/ }).waitFor()
  assert.equal(await page.getByLabel('Tanggal berita acara').inputValue(), '2026-07-20')
  await page.evaluate(() => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ date: `2026-08-${String(index + 1).padStart(2, '0')}`, end: 2000 + index, photo: `odo-${index}`, purchases: [] }))
    window.bbmSaved = { revision: 7, details: {}, rows, initial_odometer: 1999, previous: null, can_write: true }
    window.renderBbm(false, false, '2026-08')
  })
  await page.getByRole('heading', { name: /BERITA ACARA/ }).waitFor()
  assert.equal(await page.getByLabel('Tanggal berita acara').inputValue(), '')
  assert.match(await page.locator('.bbm-sign-date').innerText(), /____/)
  assert.deepEqual(errors, [])
  console.log('BBM browser: spreadsheet, keyboard, photos, save, stale-save preservation, navigation guard, reader, preview and mobile passed.')
} finally { await browser?.close(); await server.close() }
