import { ulpIdsOfUp3 } from './organisasiPelayananTeknik.js'

export const SCOPE_ROLE_UP3 = 'up3'
export const SCOPE_ROLE_ULP = 'ulp'

export function scopedUnitIdsOf({ role, up3Id, unitId, units }) {
  if (role === SCOPE_ROLE_ULP) {
    return unitId ? [unitId] : []
  }
  return [up3Id, ...ulpIdsOfUp3(units, up3Id)].filter(Boolean)
}

export function authorizeScope({
  contractId,
  up3Id,
  unitId,
  role,
  units,
  period = null,
}) {
  const reasons = []
  if (!contractId) {
    reasons.push('contractId wajib')
  }
  if (!up3Id) {
    reasons.push('up3Id wajib')
  } else if (!units.some((u) => u.id === up3Id && u.type === 'UP3')) {
    reasons.push(`UP3 "${up3Id}" tidak ada`)
  }
  if (role === SCOPE_ROLE_ULP) {
    if (!unitId) {
      reasons.push('unitId wajib untuk Admin ULP')
    } else if (
      !units.some(
        (u) =>
          u.id === unitId &&
          u.type === 'ULP' &&
          u.parentUnitId === up3Id,
      )
    ) {
      reasons.push(`unitId "${unitId}" bukan child ULP dari UP3 "${up3Id}"`)
    }
  } else if (role === SCOPE_ROLE_UP3) {
    if (
      unitId != null &&
      unitId !== up3Id &&
      !units.some(
        (u) =>
          u.id === unitId &&
          u.type === 'ULP' &&
          u.parentUnitId === up3Id,
      )
    ) {
      reasons.push(`unitId "${unitId}" di luar scope UP3 "${up3Id}"`)
    }
  } else {
    reasons.push('role tidak dikenali')
  }
  return { ok: reasons.length === 0, reasons }
}