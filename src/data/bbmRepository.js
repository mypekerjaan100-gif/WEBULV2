import { supabase } from '../lib/supabaseClient.js'
import { prepareVehicleEvidence } from './toolEvidence.js'

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args).abortSignal(AbortSignal.timeout(30000))
  if (error) throw new Error(error.code === '40001' ? 'Laporan berubah di sesi lain. Salin koreksi Anda lalu muat ulang data terbaru.' : error.message)
  return data
}
export const listBbmVehicles = ({ contractId, up3Id, month }) => rpc('ops_list_bbm_vehicles', { p_contract_id: contractId, p_up3_id: up3Id, p_month: `${month}-01` })
export const getBbmSheet = (vehicleId, month) => rpc('ops_get_bbm_sheet', { p_vehicle_id: vehicleId, p_month: `${month}-01` })
export const saveBbmSheet = (vehicleId, month, revision, initial, rows, details) => rpc('ops_save_bbm_sheet', {
  p_vehicle_id: vehicleId, p_month: `${month}-01`, p_expected_revision: revision,
  p_initial_odometer: initial === '' || initial == null ? null : Number(initial), p_rows: rows, p_details: details,
})
export async function uploadBbmPhoto(vehicleId, date, kind, file) {
  const compressed = await prepareVehicleEvidence(file)
  const extension = compressed.type === 'image/png' ? 'png' : compressed.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${vehicleId}/${date}/${kind}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage.from('bbm-evidence').upload(path, compressed, { contentType: compressed.type, upsert: false })
  if (error) throw new Error(error.message)
  return path
}
export async function getBbmPhoto(path) {
  const { data, error } = await supabase.storage.from('bbm-evidence').createSignedUrl(path, 300)
  if (error) throw new Error(error.message)
  return data.signedUrl
}
