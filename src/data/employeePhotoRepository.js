import { supabase } from '../lib/supabaseClient.js'
import { processEmployeePhotoFile } from './employeePhotoProcessor.js'

const BUCKET = 'employee-photos'
const SIGNED_URL_SECONDS = 300

function mapPhoto(row) {
  return {
    id: row.id,
    employeeId: row.employee_id ?? null,
    changeRequestId: row.change_request_id ?? null,
    contractId: row.contract_id,
    up3Id: row.up3_id,
    unitId: row.unit_id,
    storagePath: row.storage_path,
    originalFilename: row.original_filename,
    originalMimeType: row.original_mime_type,
    originalSizeBytes: row.original_size_bytes == null ? null : Number(row.original_size_bytes),
    storedMimeType: row.stored_mime_type,
    storedSizeBytes: row.stored_size_bytes == null ? null : Number(row.stored_size_bytes),
    checksum: row.checksum,
    status: row.status,
    supersedesPhotoId: row.supersedes_photo_id ?? null,
    uploadedBy: row.uploader_user_id,
    uploadedAt: row.uploaded_at,
  }
}

async function rpc(name, parameters) {
  const { data, error } = await supabase.rpc(name, parameters)
  if (error) {
    throw new Error(error.message || `RPC ${name} gagal.`)
  }
  return data
}

export function prepareEmployeePhotoFile(file) {
  return processEmployeePhotoFile(file)
}

export async function listEmployeePhotos(employeeIds) {
  if (!employeeIds?.length) return []
  const rows = await rpc('list_employee_photos', { p_employee_ids: employeeIds })
  return (rows ?? []).map(mapPhoto)
}

export async function uploadEmployeePhoto({
  contractId,
  up3Id,
  unitId,
  employeeId = null,
  file,
  processedFile = null,
  supersedesPhotoId = null,
}) {
  const processed = processedFile ?? await processEmployeePhotoFile(file)
  const preparedRow = await rpc('prepare_employee_photo_upload', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_unit_id: unitId,
    p_employee_id: employeeId,
    p_original_filename: processed.original.filename,
    p_original_mime_type: processed.original.mimeType,
    p_original_size_bytes: processed.original.sizeBytes,
    p_stored_size_bytes: processed.stored.sizeBytes,
    p_stored_mime_type: processed.stored.mimeType,
    p_checksum: processed.stored.checksum,
    p_supersedes_photo_id: supersedesPhotoId,
  })
  const prepared = mapPhoto(preparedRow)

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(prepared.storagePath, processed.file, {
      cacheControl: '3600',
      contentType: processed.stored.mimeType,
      upsert: false,
    })
  if (uploadError) {
    const { error: removeError } = await supabase.storage
      .from(BUCKET)
      .remove([prepared.storagePath])
    if (!removeError) {
      try {
        await rpc('cancel_employee_photo_upload', { p_photo_id: prepared.id })
      } catch {
        // Biarkan PENDING untuk cleanup eksplisit bila race.
      }
    }
    const suffix = removeError ? ' Metadata PENDING dipertahankan agar cleanup dapat diulang.' : ''
    throw new Error(`${uploadError.message || 'Upload foto pegawai gagal.'}${suffix}`)
  }

  try {
    const finalized = await rpc('finalize_employee_photo_upload', { p_photo_id: prepared.id })
    return mapPhoto(finalized)
  } catch (error) {
    const current = await rpc('list_employee_photos', { p_employee_ids: employeeId ? [employeeId] : [] })
      .then((rows) => (rows ?? []).map(mapPhoto).find((photo) => photo.id === prepared.id))
      .catch(() => null)
    if (current?.status === 'STAGED') return current
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([prepared.storagePath])
    if (removeError) {
      throw new Error(`${error.message} Metadata PENDING dipertahankan agar cleanup dapat diulang.`)
    }
    await rpc('cancel_employee_photo_upload', { p_photo_id: prepared.id })
    throw error
  }
}

export async function deleteEmployeePhoto(photoId) {
  const storagePath = await rpc('begin_employee_photo_delete', { p_photo_id: photoId })
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath])
  if (error) {
    throw new Error(
      `${error.message || 'Hapus foto dari Storage gagal.'} Metadata DELETE_PENDING dipertahankan agar cleanup dapat diulang.`,
    )
  }
  await rpc('finalize_employee_photo_delete', { p_photo_id: photoId })
}

export async function createEmployeePhotoSignedUrl(photoId) {
  const storagePath = await rpc('get_employee_photo_preview_path', { p_photo_id: photoId })
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_SECONDS)
  if (error) throw new Error(error.message || 'Signed URL foto gagal dibuat.')
  if (!data?.signedUrl) throw new Error('Signed URL foto tidak tersedia.')
  return { signedUrl: data.signedUrl, expiresIn: SIGNED_URL_SECONDS }
}

export async function createEmployeePhotoSignedUrls(photoIds) {
  const unique = [...new Set((photoIds ?? []).filter(Boolean))]
  const entries = await Promise.all(
    unique.map(async (photoId) => {
      try {
        const signed = await createEmployeePhotoSignedUrl(photoId)
        return [photoId, signed.signedUrl]
      } catch {
        return [photoId, null]
      }
    }),
  )
  return Object.fromEntries(entries)
}
