export const EMPLOYEE_PHOTO_MAX_BYTES = 512 * 1024
export const EMPLOYEE_PHOTO_TARGET_BYTES = 400 * 1024
export const EMPLOYEE_PHOTO_MAX_INPUT_BYTES = 10 * 1024 * 1024
export const EMPLOYEE_PHOTO_MAX_DIMENSION = 1200

const MAX_IMAGE_PIXELS = 25_000_000
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const EXTENSION_MIME_TYPES = new Map([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
])

function fileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return match?.[1] ?? ''
}

function normalizePhotoFileType(file) {
  if (SUPPORTED_IMAGE_TYPES.has(file.type)) return file
  const fallbackType = EXTENSION_MIME_TYPES.get(fileExtension(file.name))
  if (!fallbackType) return file
  return new File([file], file.name, { type: fallbackType, lastModified: file.lastModified })
}

function processedName(name) {
  const base = String(name || 'foto-pegawai').replace(/\.[^.]+$/, '') || 'foto-pegawai'
  return `${base}.webp`
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Gagal memproses foto pegawai.')),
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
  throw new Error('Format foto tidak dapat dibaca. Gunakan JPG/JPEG, PNG, atau WebP.')
}

async function compressPortrait(file) {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    throw new Error('Kompresi foto hanya tersedia di browser yang mendukung Canvas.')
  }

  const dimensions = await readImageDimensions(file)
  if (!dimensions.width || !dimensions.height) {
    throw new Error('Dimensi foto tidak valid.')
  }
  if (dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    throw new Error('Foto memiliki resolusi terlalu besar untuk diproses dengan aman.')
  }
  const decodeScale = Math.min(1, EMPLOYEE_PHOTO_MAX_DIMENSION / Math.max(dimensions.width, dimensions.height))
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
    throw new Error('Format foto tidak dapat dibaca. Gunakan JPG/JPEG, PNG, atau WebP.')
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) {
    bitmap.close()
    throw new Error('Browser tidak dapat menyiapkan kompresi foto.')
  }

  const initialScale = Math.min(1, EMPLOYEE_PHOTO_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  let width = Math.max(1, Math.round(bitmap.width * initialScale))
  let height = Math.max(1, Math.round(bitmap.height * initialScale))
  let quality = 0.9
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
        throw new Error('Browser tidak mendukung encoder WebP untuk foto pegawai.')
      }
      if (!best || blob.size < best.size) best = blob
      if (blob.size <= EMPLOYEE_PHOTO_TARGET_BYTES) break

      if (quality > 0.72) {
        quality = Math.max(0.72, quality - 0.06)
      } else {
        if (Math.max(width, height) <= 500) break
        width = Math.max(1, Math.round(width * 0.84))
        height = Math.max(1, Math.round(height * 0.84))
        quality = 0.8
      }
    }
  } finally {
    bitmap.close()
  }

  if (!best || best.size > EMPLOYEE_PHOTO_MAX_BYTES) {
    throw new Error('Foto tidak dapat dikompresi hingga 512 KB. Gunakan foto beresolusi lebih kecil.')
  }
  return new File([best], processedName(file.name), { type: 'image/webp' })
}

async function sha256(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function processEmployeePhotoFile(file) {
  if (!(file instanceof File) || file.size <= 0) {
    throw new Error('File foto tidak valid atau kosong.')
  }
  if (file.size > EMPLOYEE_PHOTO_MAX_INPUT_BYTES) {
    throw new Error('File foto melebihi batas input aman 10 MB.')
  }

  const normalizedFile = normalizePhotoFileType(file)
  if (!SUPPORTED_IMAGE_TYPES.has(normalizedFile.type)) {
    throw new Error('Foto pegawai wajib berupa JPG/JPEG, PNG, atau WebP.')
  }

  const original = {
    filename: normalizedFile.name,
    mimeType: normalizedFile.type || 'application/octet-stream',
    sizeBytes: normalizedFile.size,
  }

  const storedFile = await compressPortrait(normalizedFile)
  if (storedFile.size > EMPLOYEE_PHOTO_MAX_BYTES) {
    throw new Error('Foto tetap melebihi 512 KB setelah kompresi. Kecilkan foto sebelum upload.')
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
