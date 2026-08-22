import { supabase } from '../lib/supabaseClient.js'

export async function fetchLocationsFromSupabase() {
  const [locationResult, historyResult] = await Promise.all([
    supabase
      .from('locations')
      .select('id, legacy_key, contract_id, up3_id, unit_id, type, own_status')
      .order('legacy_key'),
    supabase
      .from('location_name_history')
      .select('id, location_id, name, effective_from, effective_to')
      .order('effective_from'),
  ])
  if (locationResult.error) throw locationResult.error
  if (historyResult.error) throw historyResult.error

  const historyByLocation = {}
  for (const history of historyResult.data ?? []) {
    ;(historyByLocation[history.location_id] ??= []).push({
      id: history.id,
      name: history.name,
      validFrom: history.effective_from,
      validTo: history.effective_to,
    })
  }

  return (locationResult.data ?? []).map((location) => ({
    id: location.id,
    legacyKey: location.legacy_key,
    contractId: location.contract_id,
    up3Id: location.up3_id,
    unitId: location.unit_id,
    type: location.type,
    ownStatus: location.own_status,
    nameHistory: historyByLocation[location.id] ?? [],
  }))
}

export async function createKantorJaga({ contractId, unitId, name, effectiveFrom }) {
  const { data, error } = await supabase.rpc('create_kantor_jaga', {
    p_contract_id: contractId,
    p_unit_id: unitId,
    p_name: name,
    p_effective_from: effectiveFrom,
  })
  if (error) throw error
  return data
}

export async function renameKantorJaga({ locationId, name, effectiveFrom }) {
  const { error } = await supabase.rpc('rename_kantor_jaga', {
    p_location_id: locationId,
    p_name: name,
    p_effective_from: effectiveFrom,
  })
  if (error) throw error
}

export async function setKantorJagaStatus({ locationId, ownStatus }) {
  const { error } = await supabase.rpc('set_kantor_jaga_status', {
    p_location_id: locationId,
    p_own_status: ownStatus,
  })
  if (error) throw error
}

export async function deleteKantorJaga(locationId) {
  const { error } = await supabase.rpc('delete_kantor_jaga', {
    p_location_id: locationId,
  })
  if (error) throw error
}
