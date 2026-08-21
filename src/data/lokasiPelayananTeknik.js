import { currentNameOf, effectiveStatusOf } from './organisasiPelayananTeknik.js'

let locSeq = 0
const locId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(locSeq++).toString(36)}`

export const today = () => new Date().toISOString().slice(0, 10)

export function seedWorkLocationsFromUnits(units, contractId = 'pelayanan-teknik') {
  const locations = []
  const upsert = (unitId, up3Id, type, name) => {
    const existing = locations.find(
      (loc) => loc.unitId === unitId && loc.up3Id === up3Id && loc.type === type,
    )
    if (existing) return
    locations.push({
      id: `loc-${unitId}-${type.toLowerCase()}-1`,
      contractId,
      up3Id,
      unitId,
      type,
      ownStatus: 'Aktif',
      nameHistory: [{ id: locId('nh'), name, validFrom: null, validTo: null }],
    })
  }
  units
    .filter((unit) => unit.type === 'UP3' && effectiveStatusOf(units, unit.id) === 'Aktif')
    .forEach((unit) => upsert(unit.id, unit.id, 'UNIT_OFFICE', currentNameOf(unit)))
  units
    .filter(
      (unit) =>
        unit.type === 'ULP' &&
        unit.parentUnitId != null &&
        effectiveStatusOf(units, unit.id) === 'Aktif',
    )
    .forEach((unit) =>
      upsert(unit.id, unit.parentUnitId, 'UNIT_OFFICE', currentNameOf(unit)),
    )
  return locations
}

export function currentLocationNameOf(location) {
  const history = [...(location?.nameHistory ?? [])].sort((a, b) =>
    (a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1,
  )
  const current = history.find((entry) => entry.validTo == null)
  return current?.name ?? history[history.length - 1]?.name ?? location?.name ?? ''
}

export function effectiveStatusOfLocation(locations, units, locationId) {
  const location = locations.find((item) => item.id === locationId)
  if (!location) return 'Nonaktif'
  if (location.ownStatus !== 'Aktif') return 'Nonaktif'
  const unit = units.find((item) => item.id === location.unitId)
  if (!unit) return 'Nonaktif'
  return effectiveStatusOf(units, unit.id)
}

export function addWorkLocation(locations, { contractId = 'pelayanan-teknik', up3Id, unitId, name, type = 'KANTOR_JAGA', ownStatus = 'Aktif' }) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return locations
  return [
    ...locations,
    {
      id: locId('loc'),
      contractId,
      up3Id,
      unitId,
      type,
      ownStatus,
      nameHistory: [{ id: locId('nh'), name: trimmed, validFrom: null, validTo: null }],
    },
  ]
}

export function currentLocationUsers(employees, workLocationId) {
  return (employees ?? []).filter((item) => item.workLocationId === workLocationId).length
}

export function reconcileLocationsFromUnits(locations, units, contractId = 'pelayanan-teknik') {
  let changed = false
  let next = [...(locations ?? [])]
  units
    .filter((unit) => unit.type === 'UP3' || unit.type === 'ULP')
    .forEach((unit) => {
      const up3Id = unit.type === 'UP3' ? unit.id : unit.parentUnitId
      const offices = next.filter(
        (location) => location.unitId === unit.id && location.type === 'UNIT_OFFICE',
      )
      if (offices.length > 1) {
        const keepId = offices[0].id
        next = next.filter(
          (location) =>
            !(
              location.unitId === unit.id &&
              location.type === 'UNIT_OFFICE' &&
              location.id !== keepId
            ),
        )
        changed = true
      }
      const office = next.find(
        (location) => location.unitId === unit.id && location.type === 'UNIT_OFFICE',
      )
      if (!office) {
        next = [
          ...next,
          {
            id: `loc-${unit.id}-unit-office-1`,
            contractId,
            up3Id,
            unitId: unit.id,
            type: 'UNIT_OFFICE',
            ownStatus: 'Aktif',
            nameHistory: [{ id: locId('nh'), name: currentNameOf(unit), validFrom: null, validTo: null }],
          },
        ]
        changed = true
      } else if (currentLocationNameOf(office) !== currentNameOf(unit)) {
        next = next.map((location) =>
          location.id === office.id ? renameWorkLocation([location], office.id, currentNameOf(unit))[0] : location,
        )
        changed = true
      }
    })
  return changed ? next : locations
}

export function renameWorkLocation(locations, locationId, name) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return locations
  return locations.map((location) => {
    if (location.id !== locationId) return location
    const history = [...(location.nameHistory ?? [])].map((entry) =>
      entry.validTo == null ? { ...entry, validTo: today() } : entry,
    )
    return {
      ...location,
      nameHistory: [...history, { id: locId('nh'), name: trimmed, validFrom: today(), validTo: null }],
    }
  })
}

export function setLocationOwnStatus(locations, locationId, ownStatus) {
  return locations.map((location) =>
    location.id === locationId ? { ...location, ownStatus } : location,
  )
}

export function deleteWorkLocation(locations, locationId) {
  return locations.filter((location) => location.id !== locationId)
}

export function collectLocationReferences(workLocationId, context = {}) {
  const refs = []
  ;(context.employees ?? []).forEach((item) => {
    if (item.workLocationId === workLocationId) {
      refs.push({ kind: 'pegawai', id: item.id, label: item.name ?? item.id })
    }
    ;(item.workLocationHistory ?? []).forEach((entry) => {
      if (entry.workLocationId === workLocationId) {
        refs.push({ kind: 'pegawai-riwayat', id: item.id, label: `${item.name ?? item.id} (riwayat)` })
      }
    })
  })
  ;(context.changeRequests ?? []).forEach((request) => {
    if (request.status === 'Pending' && request.proposed?.workLocationId === workLocationId) {
      refs.push({
        kind: 'pengajuan',
        id: request.id,
        label: `${request.proposed.nip ?? ''} (${request.proposed.name ?? ''})`,
      })
    }
  })
  return refs
}