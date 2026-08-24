import { supabase } from '../lib/supabaseClient.js'
import { processEvidenceFile } from './evidenceFileProcessor.js'

const BUCKET = 'overtime-evidence'
const SIGNED_URL_SECONDS = 300

function mapEvidence(row) {
  return {
    id: row.id,
    activityId: row.activity_id,
    evidenceType: row.evidence_type,
    storagePath: row.storage_path,
    originalFilename: row.original_filename,
    originalMimeType: row.original_mime_type,
    originalSizeBytes: Number(row.original_size_bytes),
    storedSizeBytes: Number(row.stored_size_bytes),
    storedMimeType: row.stored_mime_type,
    checksum: row.checksum,
    uploadedBy: row.uploader_user_id,
    uploadedAt: row.uploaded_at,
    sortOrder: row.sort_order,
    status: row.status,
    revisionNumber: row.revision_number,
    supersedesEvidenceId: row.supersedes_evidence_id,
  }
}

async function rpc(name, parameters) {
  const { data, error } = await supabase.rpc(name, parameters)
  if (error) throw new Error(error.message || `RPC ${name} gagal.`)
  return data
}

export async function listOvertimeEvidence(activityId, { includeHistory = false } = {}) {
  const rows = await rpc('list_overtime_evidence', {
    p_activity_id: activityId,
    p_include_history: includeHistory,
  })
  return (rows ?? []).map(mapEvidence)
}

export async function uploadOvertimeEvidence({
  activityId,
  evidenceType,
  file,
  sortOrder = 0,
  supersedesEvidenceId = null,
}) {
  const processed = await processEvidenceFile(file, evidenceType)
  const preparedRow = await rpc('prepare_overtime_evidence_upload', {
    p_activity_id: activityId,
    p_evidence_type: evidenceType,
    p_original_filename: processed.original.filename,
    p_original_mime_type: processed.original.mimeType,
    p_original_size_bytes: processed.original.sizeBytes,
    p_stored_size_bytes: processed.stored.sizeBytes,
    p_stored_mime_type: processed.stored.mimeType,
    p_checksum: processed.stored.checksum,
    p_sort_order: sortOrder,
    p_supersedes_evidence_id: supersedesEvidenceId,
  })
  const prepared = mapEvidence(preparedRow)

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
        await rpc('cancel_overtime_evidence_upload', { p_evidence_id: prepared.id })
      } catch {
        // A concurrent upload may have completed; keep PENDING for explicit recovery.
      }
    }
    const suffix = removeError
      ? ' Metadata PENDING dipertahankan agar cleanup dapat diulang.'
      : ''
    throw new Error(`${uploadError.message || 'Upload evidence gagal.'}${suffix}`)
  }

  let finalizeError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const finalized = await rpc('finalize_overtime_evidence_upload', {
        p_evidence_id: prepared.id,
      })
      return mapEvidence(finalized)
    } catch (error) {
      finalizeError ??= error
    }
  }

  const current = (await listOvertimeEvidence(activityId, { includeHistory: true }))
    .find((evidence) => evidence.id === prepared.id)
  if (current?.status === 'ACTIVE') return current

  const { error: removeError } = await supabase.storage
    .from(BUCKET)
    .remove([prepared.storagePath])
  if (removeError) {
    throw new Error(
      `${finalizeError.message} Metadata PENDING dipertahankan agar cleanup dapat diulang.`,
    )
  }
  await rpc('cancel_overtime_evidence_upload', { p_evidence_id: prepared.id })
  throw finalizeError
}

export async function deleteOvertimeEvidence(evidenceId) {
  const storagePath = await rpc('begin_overtime_evidence_delete', {
    p_evidence_id: evidenceId,
  })
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath])
  if (error) {
    throw new Error(
      `${error.message || 'Hapus evidence dari Storage gagal.'} ` +
      'Metadata DELETE_PENDING dipertahankan agar cleanup dapat diulang.',
    )
  }

  let finalizeError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await rpc('finalize_overtime_evidence_delete', { p_evidence_id: evidenceId })
      return
    } catch (error) {
      finalizeError ??= error
    }
  }
  const current = (await listOvertimeEvidenceById(evidenceId))
  if (current?.status === 'DELETED') return
  throw new Error(
    `${finalizeError.message} Metadata DELETE_PENDING dipertahankan agar cleanup dapat diulang.`,
  )
}

async function listOvertimeEvidenceById(evidenceId) {
  try {
    const data = await rpc('get_overtime_evidence_lifecycle', {
      p_evidence_id: evidenceId,
    })
    return data ? mapEvidence(data) : null
  } catch {
    return null
  }
}

export async function createOvertimeEvidenceSignedUrl(evidenceId) {
  const storagePath = await rpc('get_overtime_evidence_preview_path', {
    p_evidence_id: evidenceId,
  })
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS)
  if (error) throw new Error(error.message || 'Signed URL evidence gagal dibuat.')
  if (!data?.signedUrl) throw new Error('Signed URL evidence tidak tersedia.')
  return { signedUrl: data.signedUrl, expiresIn: SIGNED_URL_SECONDS }
}
