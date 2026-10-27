import { supabase } from '../lib/supabaseClient.js'

async function rpc(name, parameters) {
  const { data, error } = await supabase.rpc(name, parameters)
  if (error) {
    if (error.code === '42501') throw new Error('Anda tidak memiliki izin untuk tindakan ini pada ULP tersebut.')
    if (error.code === '40001') throw new Error('Data telah berubah. Muat ulang halaman sebelum menyimpan.')
    if (error.code === '0A000') throw new Error(error.message)
    throw new Error(error.message || 'Permintaan alat & kendaraan gagal.')
  }
  return data
}

const scope = ({ contractId, up3Id }) => ({ p_contract_id: contractId, p_up3_id: up3Id })

export async function getToolInspectionBundle({ contractId, up3Id, ulpId }) {
  const data = await rpc('ops_get_tool_inspection_bundle', {
    ...scope({ contractId, up3Id }),
    p_ulp_id: ulpId,
  })
  return {
    vehicles: data?.vehicles ?? [],
    history: data?.history ?? [],
    openIssues: data?.open_issues ?? [],
  }
}

export async function submitToolInspection({ assetId, inspectedAt, condition, note, photoPaths }) {
  return rpc('ops_submit_tool_inspection', {
    p_asset_id: assetId,
    p_inspected_at: inspectedAt,
    p_condition: condition,
    p_note: note ?? '',
    p_photo_paths: photoPaths,
  })
}

export async function resolveToolIssue({ issueId, resolvedAt, note, photoPaths, expectedRevision }) {
  return rpc('ops_resolve_tool_issue', {
    p_issue_id: issueId,
    p_resolved_at: resolvedAt,
    p_note: note ?? '',
    p_photo_paths: photoPaths,
    p_expected_revision: expectedRevision,
  })
}

export async function listOpenToolIssues({ contractId, up3Id }) {
  const data = await rpc('ops_list_open_tool_issues', scope({ contractId, up3Id }))
  return data ?? []
}

export async function uploadToolEvidence({ contractId, up3Id, ulpId, assetId, file }) {
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${contractId}/${up3Id}/${ulpId}/${assetId}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage
    .from('ops-tool-evidence')
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
  if (error) throw new Error(error.message || 'Foto bukti gagal diunggah.')
  return path
}

export async function getToolEvidenceUrl(path) {
  const { data, error } = await supabase.storage
    .from('ops-tool-evidence')
    .createSignedUrl(path, 3600)
  if (error) throw new Error(error.message || 'Foto bukti gagal dibuka.')
  return data?.signedUrl ?? ''
}
