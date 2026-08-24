import { PDFDocument } from 'pdf-lib'

export const EVIDENCE_MAX_BYTES = 1024 * 1024
export const EVIDENCE_TARGET_BYTES = 880 * 1024
export const EVIDENCE_MAX_INPUT_BYTES = 25 * 1024 * 1024

const MAX_IMAGE_PIXELS = 40_000_000
const MAX_PDF_PAGES = 500
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const PHOTO_EVIDENCE_TYPES = new Set([
  'FOTO_SEBELUM',
  'FOTO_SESUDAH',
  'FOTO_BRIEFING',
  'FOTO_PROSES',
  'FOTO_SELESAI',
])

const SUPPORTED_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function processedName(name, extension) {
  const base = String(name || 'evidence').replace(/\.[^.]+$/, '') || 'evidence'
  return `${base}.${extension}`
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Gagal memproses gambar evidence.')),
      type,
      quality,
    )
  })
}

async function readImageDimensions(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(bytes.buffer)
  if (file.type === 'image/png' && bytes.length >= 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (file.type === 'image/jpeg') {
    let offset = 2
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) break
      const marker = bytes[offset + 1]
      const length = view.getUint16(offset + 2)
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) }
      }
      if (length < 2) break
      offset += length + 2
    }
  }
  if (file.type === 'image/webp' && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16))
    if (chunk === 'VP8X') {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
      return { width, height }
    }
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      }
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      }
    }
  }
  throw new Error('Format gambar tidak dapat dibaca. Gunakan JPEG, PNG, atau WebP.')
}

async function compressImage(file) {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    throw new Error('Kompresi gambar hanya tersedia di browser yang mendukung Canvas.')
  }

  const dimensions = await readImageDimensions(file)
  if (!dimensions.width || !dimensions.height) {
    throw new Error('Dimensi gambar tidak valid.')
  }
  if (dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    throw new Error('Gambar memiliki resolusi terlalu besar untuk diproses dengan aman.')
  }
  const decodeScale = Math.min(1, 2400 / Math.max(dimensions.width, dimensions.height))
  const decodeWidth = Math.max(1, Math.round(dimensions.width * decodeScale))
  const decodeHeight = Math.max(1, Math.round(dimensions.height * decodeScale))

  let bitmap
  try {
    bitmap = await createImageBitmap(file, {
      resizeWidth: decodeWidth,
      resizeHeight: decodeHeight,
      resizeQuality: 'high',
    })
  } catch {
    throw new Error('Format gambar tidak dapat dibaca. Gunakan JPEG, PNG, atau WebP.')
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) {
    bitmap.close()
    throw new Error('Browser tidak dapat menyiapkan kompresi gambar.')
  }

  const initialScale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
  let width = Math.max(1, Math.round(bitmap.width * initialScale))
  let height = Math.max(1, Math.round(bitmap.height * initialScale))
  let quality = 0.92
  let best = null

  try {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      canvas.width = width
      canvas.height = height
      context.fillStyle = '#fff'
      context.fillRect(0, 0, width, height)
      context.drawImage(bitmap, 0, 0, width, height)

      const blob = await canvasBlob(canvas, 'image/webp', quality)
      if (blob.type !== 'image/webp') {
        throw new Error('Browser tidak mendukung encoder WebP untuk evidence.')
      }
      if (!best || blob.size < best.size) best = blob
      if (blob.size <= EVIDENCE_TARGET_BYTES) break

      if (quality > 0.74) {
        quality = Math.max(0.74, quality - 0.06)
      } else {
        if (Math.max(width, height) <= 900) break
        width = Math.max(1, Math.round(width * 0.84))
        height = Math.max(1, Math.round(height * 0.84))
        quality = 0.82
      }
    }
  } finally {
    bitmap.close()
  }

  if (!best || best.size > EVIDENCE_MAX_BYTES) {
    throw new Error('Gambar tidak dapat dikompresi hingga batas 1 MB tanpa menurunkan keterbacaan.')
  }
  return new File([best], processedName(file.name, 'webp'), { type: 'image/webp' })
}

async function optimizePdf(file) {
  if (file.size <= EVIDENCE_TARGET_BYTES) return file
  let document
  try {
    document = await PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: false,
      updateMetadata: false,
    })
  } catch {
    throw new Error('PDF tidak dapat dioptimalkan dengan aman atau dilindungi sandi.')
  }
  if (document.getPageCount() > MAX_PDF_PAGES) {
    throw new Error(`PDF melebihi batas aman ${MAX_PDF_PAGES} halaman.`)
  }

  const optimized = await document.save({
    addDefaultPage: false,
    useObjectStreams: true,
    objectsPerTick: 50,
  })
  const candidate = new File(
    [optimized],
    processedName(file.name, 'pdf'),
    { type: 'application/pdf' },
  )
  return candidate.size < file.size ? candidate : file
}

async function sha256(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function validateOfficeSignature(file) {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const isDoc = file.type === 'application/msword'
    && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
      .every((value, index) => header[index] === value)
  const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    && header[0] === 0x50 && header[1] === 0x4b
    && [0x03, 0x05, 0x07].includes(header[2])
    && [0x04, 0x06, 0x08].includes(header[3])
  if (!isDoc && !isDocx) {
    throw new Error('Isi dokumen tidak sesuai dengan format DOC atau DOCX.')
  }
}

export async function processEvidenceFile(file, evidenceType) {
  if (!(file instanceof File) || file.size <= 0) {
    throw new Error('File evidence tidak valid atau kosong.')
  }
  if (file.size > EVIDENCE_MAX_INPUT_BYTES) {
    throw new Error('File evidence melebihi batas input aman 25 MB.')
  }

  const original = {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  }

  let storedFile
  if (SUPPORTED_IMAGE_TYPES.has(file.type)) {
    storedFile = await compressImage(file)
  } else if (file.type === 'application/pdf') {
    storedFile = await optimizePdf(file)
  } else if (SUPPORTED_DOCUMENT_TYPES.has(file.type)) {
    await validateOfficeSignature(file)
    storedFile = file
  } else {
    throw new Error('Format evidence tidak didukung. Gunakan gambar, PDF, DOC, atau DOCX.')
  }

  if (PHOTO_EVIDENCE_TYPES.has(evidenceType) && !storedFile.type.startsWith('image/')) {
    throw new Error('Evidence foto wajib berupa gambar JPEG atau WebP.')
  }
  if (storedFile.size > EVIDENCE_MAX_BYTES) {
    const label = storedFile.type === 'application/pdf' ? 'PDF' : 'Dokumen'
    throw new Error(`${label} tetap melebihi 1 MB setelah optimasi aman. Kecilkan file sebelum upload.`)
  }

  return {
    file: storedFile,
    original,
    stored: {
      filename: storedFile.name,
      mimeType: storedFile.type,
      sizeBytes: storedFile.size,
      checksum: await sha256(storedFile),
    },
  }
}
