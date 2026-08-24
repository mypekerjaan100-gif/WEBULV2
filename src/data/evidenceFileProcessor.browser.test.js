import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const server = await createServer({
  server: { host: '127.0.0.1', port: 4179 },
  logLevel: 'error',
  plugins: [{
    name: 'evidence-test-page',
    configureServer(viteServer) {
      viteServer.middlewares.use('/evidence-test', (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><title>Evidence test</title>')
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
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:4179/evidence-test')

  const result = await page.evaluate(async () => {
    const { EVIDENCE_MAX_BYTES, processEvidenceFile } = await import(
      '/src/data/evidenceFileProcessor.js'
    )
    const canvas = document.createElement('canvas')
    canvas.width = 2200
    canvas.height = 1600
    const context = canvas.getContext('2d')
    const pixels = context.createImageData(canvas.width, canvas.height)
    for (let offset = 0; offset < pixels.data.length; offset += 65536) {
      crypto.getRandomValues(pixels.data.subarray(offset, Math.min(offset + 65536, pixels.data.length)))
    }
    for (let index = 3; index < pixels.data.length; index += 4) pixels.data[index] = 255
    context.putImageData(pixels, 0, 0)
    const source = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    const input = new File([source], 'briefing.png', { type: 'image/png' })
    const processed = await processEvidenceFile(input, 'FOTO_BRIEFING')
    const bitmap = await createImageBitmap(processed.file)
    const dimensions = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    const oversizedDimensions = new Uint8Array(24)
    const oversizedView = new DataView(oversizedDimensions.buffer)
    oversizedView.setUint32(16, 10000)
    oversizedView.setUint32(20, 5000)
    let pixelBombRejected = false
    try {
      await processEvidenceFile(
        new File([oversizedDimensions], 'oversized.png', { type: 'image/png' }),
        'FOTO_BRIEFING',
      )
    } catch (error) {
      pixelBombRejected = /resolusi terlalu besar/.test(error.message)
    }
    return {
      originalSize: input.size,
      storedSize: processed.file.size,
      storedType: processed.file.type,
      checksumLength: processed.stored.checksum.length,
      maxBytes: EVIDENCE_MAX_BYTES,
      dimensions,
      pixelBombRejected,
    }
  })

  if (result.originalSize <= result.maxBytes) throw new Error('Source image was not oversized')
  if (result.storedSize > result.maxBytes) throw new Error('Compressed image exceeds 1 MB')
  if (result.storedType !== 'image/webp') throw new Error('Compressed image is not WebP')
  if (result.checksumLength !== 64) throw new Error('Image checksum is invalid')
  if (Math.max(result.dimensions.width, result.dimensions.height) < 900) {
    throw new Error('Compressed image dimensions are too small')
  }
  const ratio = result.dimensions.width / result.dimensions.height
  if (Math.abs(ratio - 2200 / 1600) > 0.01) throw new Error('Image aspect ratio changed')
  if (!result.pixelBombRejected) throw new Error('Oversized image dimensions were not rejected early')
  console.log(`Browser image compression passed: ${result.originalSize} -> ${result.storedSize} bytes`)
} finally {
  if (browser) await browser.close()
  await server.close()
}
