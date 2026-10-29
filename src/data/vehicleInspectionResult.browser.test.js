import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Fixture lokal: komponen dan CSS asli, tanpa login/akses database atau Storage.
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
  plugins: [{
    name: 'vehicle-preview-test-page',
    configureServer(viteServer) {
      viteServer.middlewares.use('/vehicle-preview-test', (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><title>Vehicle preview test</title><main id="root"></main>')
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
  await page.route('**/src/lib/supabaseClient.js*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export const supabase = {
      storage: { from: () => ({
        createSignedUrl: async (path) => ({ data: { signedUrl: '/vehicle-preview-image/' + path } }),
      }) },
    }`,
  }))
  await page.route('**/vehicle-preview-image/*', (route) => {
    const portrait = route.request().url().endsWith('portrait.svg')
    const [width, height] = portrait ? [900, 1600] : [1600, 900]
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="100%" height="100%" fill="#164e63" />
        <rect x="10" y="10" width="${width - 20}" height="${height - 20}" fill="none" stroke="#fff" stroke-width="20" />
        <text x="50%" y="50%" text-anchor="middle" fill="#fff" font-size="80">${portrait ? 'Portrait' : 'Landscape'}</text>
      </svg>`,
    })
  })
  const { port } = server.httpServer.address()
  await page.goto(`http://127.0.0.1:${port}/vehicle-preview-test`)
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
    const { default: ResultModal } = await import('/src/components/sla/VehicleInspectionResultModal.jsx')
    const { default: InspectionModal } = await import('/src/components/sla/VehicleInspectionModal.jsx')
    const root = createRoot(document.getElementById('root'))
    window.__renderVehiclePreview = (mode = 'result') => root.render(React.createElement(
      mode === 'result' ? ResultModal : InspectionModal,
      {
        vehicle: { id: 'preview-test', plate_display: 'KB PREVIEW', label: 'Kendaraan uji' },
        inspection: {
          condition: 'GOOD', inspected_at: '2026-10-29T03:34:00Z',
          inspected_by_name: 'Petugas uji', note: 'Foto ditampilkan utuh tanpa klik.',
          photo_paths: { SIDE_RIGHT: 'landscape.svg', SIDE_LEFT: 'portrait.svg', FRONT: 'landscape.svg', REAR: 'portrait.svg' },
        },
        onClose: () => root.render(null),
      },
    ))
    window.__renderVehiclePreview()
  })
  await page.getByText('4/4 foto dimuat', { exact: true }).waitFor()
  const images = page.locator('.vehicle-result-grid img')
  assert.equal(await images.count(), 4)
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded()
    await image.evaluate((element) => element.decode())
  }
  assert.equal(await page.locator('.vehicle-result-grid a[target="_blank"]').count(), 4)

  for (const width of [1440, 900, 720, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
      const layout = await page.evaluate(() => {
        const dialog = document.querySelector('.ui-modal-vehicle-result')
        const content = dialog.querySelector('.ui-modal-content')
        const rect = dialog.getBoundingClientRect()
        return {
          width: rect.width, left: rect.left, right: rect.right,
          columns: getComputedStyle(dialog.querySelector('.vehicle-result-grid')).gridTemplateColumns.split(' ').length,
          overflow: content.scrollWidth > content.clientWidth,
          photos: [...dialog.querySelectorAll('.vehicle-photo-slot-frame')].map((frame) => {
            const link = frame.querySelector('a')
            const image = frame.querySelector('img')
            return {
              height: frame.getBoundingClientRect().height,
              linkWidth: link.getBoundingClientRect().width, linkHeight: link.getBoundingClientRect().height,
              frameWidth: frame.clientWidth, frameHeight: frame.clientHeight,
              fit: getComputedStyle(image).objectFit, loaded: image.complete && image.naturalWidth > 0,
            }
          }),
        }
      })
      assert.equal(layout.columns, width <= 720 ? 1 : 2, `${width}/${theme}: susunan kolom salah`)
      assert.ok(layout.width <= 1100 && layout.left >= 0 && layout.right <= width, 'Modal harus muat di layar')
      if (width === 1440) assert.equal(layout.width, 1100, 'Modal desktop harus diperlebar')
      assert.equal(layout.overflow, false, `${width}/${theme}: preview meluber horizontal`)
      for (const photo of layout.photos) {
        assert.ok(photo.height >= (width <= 720 ? 240 : 280) && photo.height <= 320, 'Preview harus berukuran besar')
        assert.equal(photo.fit, 'contain', 'Foto landscape/portrait tidak boleh terpotong')
        assert.ok(photo.loaded, 'Foto fixture harus berhasil dimuat')
        assert.ok(Math.abs(photo.linkWidth - photo.frameWidth) < 1 && Math.abs(photo.linkHeight - photo.frameHeight) < 1, 'Tautan harus memenuhi frame')
      }
    }
  }
  // Baris terakhir tetap dapat dicapai pada layar ponsel yang pendek.
  await page.setViewportSize({ width: 390, height: 640 })
  await images.last().scrollIntoViewIfNeeded()
  const lastPhotoVisible = await images.last().evaluate((image) => {
    const photo = image.getBoundingClientRect()
    const content = image.closest('.ui-modal-content').getBoundingClientRect()
    return photo.top >= content.top && photo.bottom <= content.bottom
  })
  assert.ok(lastPhotoVisible, 'Foto terakhir harus dapat dilihat dengan menggulir modal')

  await page.evaluate(() => window.__renderVehiclePreview('form'))
  await page.getByText('Simpan Inspeksi', { exact: true }).waitFor()
  const uploadHeights = await page.locator('.vehicle-photo-slot-frame').evaluateAll((frames) => frames.map((frame) => frame.getBoundingClientRect().height))
  assert.equal(uploadHeights.length, 4)
  assert.ok(uploadHeights.every((height) => height === 92), 'Preview form unggah harus tetap 92px')
  assert.deepEqual(pageErrors, [])
  console.log('Vehicle result preview passed: desktop/tablet/mobile, light/dark, landscape/portrait, upload unchanged')
} finally {
  if (browser) await browser.close()
  await server.close()
}
