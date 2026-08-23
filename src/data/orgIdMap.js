import { supabase } from '../lib/supabaseClient.js'

let _orgMap = null
let _orgMapPromise = null
let _contractMap = null
let _contractMapPromise = null

async function loadOrgMap() {
  if (_orgMap) return _orgMap
  if (_orgMapPromise) return _orgMapPromise

  _orgMapPromise = Promise.all([
    supabase
      .from('organization_units')
      .select('id, legacy_key, type, parent_id, own_status, sort_order')
      .order('sort_order')
      .order('legacy_key'),
    supabase
      .from('organization_name_history')
      .select('organization_unit_id, name, effective_from, effective_to'),
  ])
    .then(([unitResult, nameResult]) => {
      if (unitResult.error) throw unitResult.error
      if (!unitResult.data?.length) {
        throw new Error('Data organisasi Supabase tidak tersedia untuk sesi ini.')
      }

      const nameByUnit = {}
      for (const name of nameResult.data ?? []) {
        ;(nameByUnit[name.organization_unit_id] ??= []).push(name)
      }

      const unitsByKey = {}
      const unitsByUuid = {}
      for (const unit of unitResult.data) {
        const history = (nameByUnit[unit.id] ?? []).sort((a, b) =>
          (a.effective_from ?? '') < (b.effective_from ?? '') ? -1 : 1,
        )
        const current = history.find((entry) => entry.effective_to == null)
        const entry = {
          uuid: unit.id,
          legacyKey: unit.legacy_key,
          displayName: current?.name ?? history[history.length - 1]?.name ?? null,
          type: unit.type,
          parentUuid: unit.parent_id,
          status: unit.own_status,
          sortOrder: unit.sort_order,
        }
        unitsByUuid[unit.id] = entry
        if (unit.legacy_key) unitsByKey[unit.legacy_key] = entry
      }

      _orgMap = {
        unitsByUuid,
        unitsByKey,
        nameLoadError: nameResult.error?.message ?? null,
      }
      return _orgMap
    })
    .finally(() => {
      _orgMapPromise = null
    })

  return _orgMapPromise
}

export async function resolveLegacyKeyToUuid(legacyKey) {
  const map = await loadOrgMap()
  const unit = map.unitsByKey[legacyKey] ?? map.unitsByUuid[legacyKey]
  if (!unit) throw new Error(`Unit organisasi "${legacyKey}" tidak ditemukan.`)
  return unit.uuid
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

export function invalidateOrganizationMap() {
  _orgMap = null
  _orgMapPromise = null
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
  if (_contractMapPromise) return _contractMapPromise

  _contractMapPromise = supabase
    .from('contracts')
    .select('id, code, title')
    .then(({ data, error }) => {
      if (error) throw error
      if (!data?.length) {
        throw new Error('Data kontrak Supabase tidak tersedia untuk sesi ini.')
      }
      _contractMap = {}
      for (const contract of data) {
        _contractMap[contract.code] = contract.id
        _contractMap[contract.id] = contract.code
      }
      return _contractMap
    })
    .finally(() => {
      _contractMapPromise = null
    })

  return _contractMapPromise
}

export async function resolveContractCodeToUuid(code) {
  const map = await loadContractMap()
  const uuid = map[code]
  if (!uuid) throw new Error(`Kontrak "${code}" tidak ditemukan.`)
  return uuid
}

export async function resolveContractUuidToCode(uuid) {
  const map = await loadContractMap()
  return map[uuid] ?? uuid
}

export async function getOrganizationScope({
  up3Id,
  contractCode,
  displayNameByLegacyKey = {},
}) {
  const [map, contractUuid] = await Promise.all([
    loadOrgMap(),
    resolveContractCodeToUuid(contractCode),
  ])
  const up3 = map.unitsByUuid[up3Id] ?? map.unitsByKey[up3Id]
  if (!up3 || up3.type !== 'UP3') {
    throw new Error(`UP3 "${up3Id}" tidak ditemukan pada organisasi Supabase.`)
  }
  if (up3.status !== 'Aktif') {
    throw new Error(`UP3 "${up3Id}" tidak aktif.`)
  }

  const childUnits = Object.values(map.unitsByUuid)
    .filter(
      (unit) =>
        unit.type === 'ULP' &&
        unit.parentUuid === up3.uuid,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.legacyKey.localeCompare(b.legacyKey))
  const scopeUnits = [up3, ...childUnits].map((unit) => ({
    ...unit,
    displayName: unit.displayName ?? displayNameByLegacyKey[unit.legacyKey] ?? null,
  }))
  const unnamedUnit = scopeUnits.find((unit) => !unit.displayName)
  if (unnamedUnit) {
    throw new Error(`Nama unit "${unnamedUnit.legacyKey ?? unnamedUnit.uuid}" tidak tersedia.`)
  }

  return {
    units: scopeUnits,
    up3Uuid: up3.uuid,
    contractUuid,
    scopedUnitUuids: scopeUnits.map((unit) => unit.uuid),
    warning: map.nameLoadError,
  }
}
