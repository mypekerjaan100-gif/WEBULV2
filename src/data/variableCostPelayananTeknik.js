import {
  slaContractScope,
  slaIndicators,
  slaUlpEntries,
} from './slaPelayananTeknik.js'

export function variableCostIndicatorIds() {
  return slaIndicators
    .filter((indicator) => indicator.inputMode === 'variable-cost')
    .map((indicator) => indicator.id)
}

export function isVariableCostIndicator(indicatorId) {
  return variableCostIndicatorIds().includes(indicatorId)
}

export function initialVariableCostForUp3(contractId, up3Id, units) {
  if (up3Id !== slaContractScope.up3.id) return {}
  const map = {}
  Object.keys(slaUlpEntries).forEach((ulpId) => {
    map[ulpId] = {}
    Object.keys(slaUlpEntries[ulpId]).forEach((indicatorId) => {
      map[ulpId][indicatorId] = {
        ...slaUlpEntries[ulpId][indicatorId],
        contractId,
        up3Id,
        unitId: ulpId,
      }
    })
  })
  return map
}

export function writeVariableCostEntries(
  entriesByUnit,
  { contractId, up3Id, unitId, period, versionId, scopedUnitIds, entries },
) {
  if (!scopedUnitIds.includes(unitId)) {
    return {
      entriesByUnit,
      ok: false,
      message: `unitId "${unitId}" di luar scope UP3 "${up3Id}".`,
    }
  }
  const scopedEntries = {}
  Object.keys(entries).forEach((indicatorId) => {
    scopedEntries[indicatorId] = {
      ...entries[indicatorId],
      contractId,
      up3Id,
      versionId: versionId ?? null,
      period: period ?? null,
      unitId,
    }
  })
  return { entriesByUnit: { ...entriesByUnit, [unitId]: scopedEntries }, ok: true }
}