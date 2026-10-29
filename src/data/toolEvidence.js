const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_INPUT_BYTES = 12 * 1024 * 1024
const MAX_DIMENSION = 1600
const TARGET_BYTES = 4 * 1024 * 1024

function outputName(name) {
  const base = String(name || 'foto-alat').replace(/\.[^.]+$/, '') || 'foto-alat'
  return `${base}.jpg`
}

export async function prepareToolEvidence(file) {
  if (!file) throw new Error('Pilih foto bukti terlebih dahulu.')
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Foto harus berupa JPG, PNG, atau WebP.')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Ukuran foto maksimal 12 MB sebelum dikompresi.')
  }
  if (file.size <= TARGET_BYTES) return file
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('Foto tidak dapat dibaca. Gunakan JPG, PNG, atau WebP.')
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) {
    bitmap.close()
    return file
  }
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  if (!blob) return file
  return new File([blob], outputName(file.name), { type: 'image/jpeg', lastModified: file.lastModified })
}

// Bukti inspeksi kendaraan diwajibkan maksimal 500 KB per foto sebelum unggah.
// Batas ini juga ditegakkan di server (RPC memeriksa metadata ukuran berkas).
const VEHICLE_TARGET_BYTES = 500 * 1024
const VEHICLE_MAX_INPUT_BYTES = 12 * 1024 * 1024
const VEHICLE_OUTPUT_DIMENSIONS = [1600, 1200, 850]
const VEHICLE_OUTPUT_QUALITIES = [0.82, 0.7, 0.62, 0.52]

function vehicleOutputName(name) {
  const base = String(name || 'foto-kendaraan').replace(/\.[^.]+$/, '') || 'foto-kendaraan'
  return `${base}.jpg`
}

export async function prepareVehicleEvidence(file) {
  if (!file) throw new Error('Pilih foto kendaraan terlebih dahulu.')
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Foto kendaraan harus berupa JPG, PNG, atau WebP.')
  }
  if (file.size > VEHICLE_MAX_INPUT_BYTES) {
    throw new Error('Ukuran foto kendaraan maksimal 12 MB sebelum dikompresi.')
  }
  if (file.type === 'image/jpeg' && file.size <= VEHICLE_TARGET_BYTES) return file
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    if (file.size <= VEHICLE_TARGET_BYTES) return file
    throw new Error('Foto tidak dapat dikompresi di bawah 500 KB. Gunakan foto dengan ukuran lebih kecil.')
  }

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('Foto kendaraan tidak dapat dibaca. Gunakan JPG, PNG, atau WebP.')
  }
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) {
    bitmap.close()
    if (file.size <= VEHICLE_TARGET_BYTES) return file
    throw new Error('Foto tidak dapat dikompresi di bawah 500 KB. Gunakan foto dengan ukuran lebih kecil.')
  }

  try {
    for (const maxDimension of VEHICLE_OUTPUT_DIMENSIONS) {
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.width = width
      canvas.height = height
      context.drawImage(bitmap, 0, 0, width, height)
      for (const quality of VEHICLE_OUTPUT_QUALITIES) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
        if (!blob) break
        if (blob.size <= VEHICLE_TARGET_BYTES) {
          return new File([blob], vehicleOutputName(file.name), { type: 'image/jpeg', lastModified: file.lastModified })
        }
      }
    }
    throw new Error('Foto tidak dapat dikompresi di bawah 500 KB. Gunakan foto dengan resolusi lebih rendah.')
  } finally {
    bitmap.close()
  }
}
