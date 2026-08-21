import { supabase } from '../lib/supabaseClient.js'

let _orgMap = null
let _contractMap = null

async function loadOrgMap() {
  if (_orgMap) return _orgMap

  const { data: units } = await supabase
    .from('organization_units')
    .select('id, legacy_key, type, parent_id, own_status')

  const { data: names } = await supabase
    .from('organization_name_history')
    .select('organization_unit_id, name, effective_from, effective_to')

  const nameByUnit = {}
  for (const n of names ?? []) {
    ;(nameByUnit[n.organization_unit_id] ??= []).push(n)
  }

  const unitsByKey = {}
  const unitsByUuid = {}

  for (const u of units ?? []) {
    const history = (nameByUnit[u.id] ?? []).sort((a, b) =>
      (a.effective_from ?? '') < (b.effective_from ?? '') ? -1 : 1,
    )
    const current = history.find((e) => e.effective_to == null)
    const displayName = current?.name ?? history[history.length - 1]?.name ?? u.legacy_key ?? u.id

    const entry = {
      uuid: u.id,
      legacyKey: u.legacy_key,
      displayName,
      type: u.type,
      parentUuid: u.parent_id,
      status: u.own_status,
    }
    unitsByUuid[u.id] = entry
    if (u.legacy_key) unitsByKey[u.legacy_key] = entry
  }

  _orgMap = { unitsByUuid, unitsByKey }
  return _orgMap
}

export async function resolveLegacyKeyToUuid(legacyKey) {
  const map = await loadOrgMap()
  return map.unitsByKey[legacyKey]?.uuid ?? legacyKey
}

export async function resolveUuidToLegacyKey(uuid) {
  const map = await loadOrgMap()
  return map.unitsByUuid[uuid]?.legacyKey ?? uuid
}

export async function resolveUuidToDisplayName(uuid) {
  const map = await loadOrgMap()
  return map.unitsByUuid[uuid]?.displayName ?? uuid
}

export async function resolveParentUuid(childUuid) {
  const map = await loadOrgMap()
  return map.unitsByUuid[childUuid]?.parentUuid ?? null
}

export async function getOrgUnits() {
  const map = await loadOrgMap()
  return Object.values(map.unitsByUuid)
}

export async function getLegacyKeyToUuidMap() {
  const map = await loadOrgMap()
  const result = {}
  for (const [key, entry] of Object.entries(map.unitsByKey)) {
    result[key] = entry.uuid
  }
  return result
}

export async function getUuidToDisplayNameMap() {
  const map = await loadOrgMap()
  const result = {}
  for (const [uuid, entry] of Object.entries(map.unitsByUuid)) {
    result[uuid] = entry.displayName
  }
  return result
}

export async function getChildUuidsOfUp3(up3Uuid) {
  const map = await loadOrgMap()
  return Object.values(map.unitsByUuid)
    .filter((u) => u.type === 'ULP' && u.parentUuid === up3Uuid)
    .map((u) => u.uuid)
}

export async function loadContractMap() {
  if (_contractMap) return _contractMap

  const { data: contracts } = await supabase
    .from('contracts')
    .select('id, code, title')

  _contractMap = {}
  for (const c of contracts ?? []) {
    _contractMap[c.code] = c.id
    _contractMap[c.id] = c.code
  }
  return _contractMap
}

export async function resolveContractCodeToUuid(code) {
  const map = await loadContractMap()
  return map[code] ?? code
}

export async function resolveContractUuidToCode(uuid) {
  const map = await loadContractMap()
  return map[uuid] ?? uuid
}
