import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '../../lib/AppAuth.jsx'
import {
  fetchEmployeesFromSupabase,
  fetchPositionsFromSupabase,
} from '../../data/employeeRepository.js'
import {
  createKantorJaga,
  deleteKantorJaga,
  fetchLocationsFromSupabase,
  renameKantorJaga,
  reorderLocations,
  reorderOrganizationUnits,
  setKantorJagaStatus,
} from '../../data/locationRepository.js'
import SLAContextBar from '../../components/sla/SLAContextBar.jsx'
import SLAIndicatorTable from '../../components/sla/SLAIndicatorTable.jsx'
import SLAExportPreview from '../../components/sla/SLAExportPreview.jsx'
import SLAMasterOrganisasi from '../../components/sla/SLAMasterOrganisasi.jsx'
import SLAMasterLokasi from '../../components/sla/SLAMasterLokasi.jsx'
import SLAMasterJabatan from '../../components/sla/SLAMasterJabatan.jsx'
import SLADatabasePegawai from '../../components/sla/SLADatabasePegawai.jsx'
import SLAMasterPenandatangan from '../../components/sla/SLAMasterPenandatangan.jsx'
import SLAPengaturanSLA from '../../components/sla/SLAPengaturanSLA.jsx'
import SLAVariableCost from '../../components/sla/SLAVariableCost.jsx'
import SLALembur from '../../components/sla/SLALembur.jsx'
import {
  buildVersionSections,
  flattenVersionIndicators,
  pelayananTeknikModules,
  slaContractScope,
  slaPeriods,
  slaSignatureGroups,
  variableCostPoints,
} from '../../data/slaPelayananTeknik.js'
import { listRejectedEntries, setManualSlaTarget } from '../../data/variableCostRepository.js'
import {
  fetchSlaEntries,
  fetchSlaIndicators,
  fetchSlaTargets,
  fetchSlaVersions,
  resolveReportingVersionByMonth,
  saveManualSlaEntry,
  setManualSlaUp3Target,
} from '../../data/slaRepository.js'
import {
  currentNameOf,
  ulpIdsOfUp3,
} from '../../data/organisasiPelayananTeknik.js'
import { initialJabatanForUp3 } from '../../data/jabatanPelayananTeknik.js'
import { getOrganizationScope, invalidateOrganizationMap } from '../../data/orgIdMap.js'
import { initialPensionPoliciesForUp3 } from '../../data/pensiunPelayananTeknik.js'
import {
  expireInitialOvertimeDrafts,
  listOvertimeReplacements,
  listOvertimeWork,
  saveOvertimeReplacementDraft,
  saveOvertimeWorkDraft,
  submitOvertimeReplacement,
  submitOvertimeWork,
} from '../../data/overtimeReplacementRepository.js'
import { periodKeyFromLabel } from '../../data/versiSlaPelayananTeknik.js'


const ROLE_NOTES = {
  up3: 'Admin UP3 - konsolidasi operasional UP3 read-only. Target Manual dapat dikelola untuk UP3 atau ULP; target Variable Cost otomatis.',
  ulp: 'Admin ULP - Target read-only. Indikator Manual dapat diedit pada ULP sendiri. Seluruh field 8 indikator Variable Cost read-only otomatis.',
}

const MANAGEMENT_ROLE_LABELS = {
  TEAM_LEADER: 'Team Leader',
  MANAGER_UNIT: 'Manager Unit',
  MANAGER_UP: 'Manager Unit Pelaksana',
  ASMAN_OPERASI: 'Asman Operasi',
  ASMAN_KEUANGAN: 'Asman Keuangan',
}

const VERSION_STATUS_LABEL = {
  ACTIVE: 'Aktif',
  ARCHIVED: 'Arsip',
  DRAFT: 'Draft',
}

function mapDatabaseVersion(version, uiUp3Id) {
  return {
    ...version,
    id: version.id,
    legacyKey: version.legacy_key,
    contractId: slaContractScope.contractId,
    up3Id: uiUp3Id,
    databaseContractId: version.contract_id,
    databaseUp3Id: version.up3_id,
    status: VERSION_STATUS_LABEL[version.status] ?? version.status,
    databaseStatus: version.status,
    period: `${version.period_start} - ${version.period_end}`,
    periodStart: version.period_start,
    periodEnd: version.period_end,
    effectiveDate: version.effective_date,
    agreementName: version.addendum_number || version.parent_contract_number,
    parentContractNumber: version.parent_contract_number,
    addendumNumber: version.addendum_number,
    metadataNote: version.notes,
    used: Boolean(version.first_used_at),
    sections: buildVersionSections(),
    targets: {},
  }
}

function versionCoversMonth(version, periodMonth) {
  if (!periodMonth || !['ACTIVE', 'ARCHIVED'].includes(version.databaseStatus)) return false
  const end = new Date(`${periodMonth}T00:00:00Z`)
  end.setUTCMonth(end.getUTCMonth() + 1)
  end.setUTCDate(0)
  const monthEnd = end.toISOString().slice(0, 10)
  return version.periodStart <= monthEnd && version.periodEnd >= periodMonth
}

function periodLabelFromMonth(periodMonth) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodMonth ?? '')) return null
  const [year, month] = periodMonth.split('-')
  const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
  return monthNames[Number(month) - 1] ? `${monthNames[Number(month) - 1]} ${year}` : null
}

export default function SLAPelayananTeknikPage({
  onBack,
  contractId,
  role,
  onRoleChange,
  unitId,
  onUnitChange,
  up3Id,
  units,
  onUnitsChange,
  isRealScopedUser = false,
  isManagementUser = false,
  organizationAccess = [],
  managementScopes = [],
  selectedManagementScopeKey = '',
  onManagementScopeChange,
  approvalNotifications = { count: 0, groups: [] },
  approvalTarget = null,
  onApprovalTargetHandled,
  onApprovalChange,
}) {
  const [moduleId, setModuleId] = useState('sla')
  const [period, setPeriod] = useState('Agustus 2026')
  const [versionId, setVersionId] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [changeRequests, setChangeRequests] = useState([])
  const auth = useAuth()
  const [employees, setEmployees] = useState([])
  const [employeesLoaded, setEmployeesLoaded] = useState(false)
  const [employeeLoadError, setEmployeeLoadError] = useState('')
  const [employeeReloadToken, setEmployeeReloadToken] = useState(0)
  const [employeeLocations, setEmployeeLocations] = useState([])
  const [locationLoadStatus, setLocationLoadStatus] = useState('loading')
  const [locationLoadError, setLocationLoadError] = useState('')
  const [orgMap, setOrgMap] = useState(null)
  const [orgMapStatus, setOrgMapStatus] = useState('loading')
  const [orgMapError, setOrgMapError] = useState('')
  const [variableSlaTargets, setVariableSlaTargets] = useState({})
  const [variableRejectedCount, setVariableRejectedCount] = useState(0)
  const [slaManualSaveMessage, setSlaManualSaveMessage] = useState('')
  const [slaManualSaveError, setSlaManualSaveError] = useState('')
  const [slaManualSaving, setSlaManualSaving] = useState(false)
  const [slaLoadStatus, setSlaLoadStatus] = useState('loading')
  const [slaLoadError, setSlaLoadError] = useState('')
  const [slaReloadToken, setSlaReloadToken] = useState(0)
  const [databaseIndicators, setDatabaseIndicators] = useState([])
  const [savedEntriesByUnit, setSavedEntriesByUnit] = useState({})
  const [savedTargets, setSavedTargets] = useState({})
  const actor = auth?.authority?.actor
  const isSuperAdmin = actor?.is_super_admin === true
  const contractAccess = actor?.contract_access ?? []
  const isAdminUp3 = contractAccess.some(
    (access) =>
      access.role === 'ADMIN_UP3' &&
      access.contract_id === orgMap?.contractUuid &&
      access.operational_up3_id === orgMap?.up3Uuid,
  )
  const isAdminUlp = contractAccess.some(
    (access) =>
      access.role === 'ADMIN_ULP' &&
      access.contract_id === orgMap?.contractUuid &&
      access.operational_up3_id === orgMap?.up3Uuid &&
      access.operational_unit_id != null,
  )
  const managementRoles = ['TEAM_LEADER','MANAGER_UNIT','MANAGER_UP','ASMAN_OPERASI','ASMAN_KEUANGAN']
  const isManagement = isManagementUser || (actor?.organization_access ?? []).some((a) => managementRoles.includes(a.organization_role))
  const managementAccess = (actor?.organization_access ?? organizationAccess ?? []).filter((a) => managementRoles.includes(a.organization_role))
  const isUpManagement = managementAccess.some((a) => ['MANAGER_UP','ASMAN_OPERASI','ASMAN_KEUANGAN'].includes(a.organization_role))
  const managementRole = managementAccess[0]?.organization_role ?? null
  const selectedManagementScope = managementScopes.find((scope) => scope.key === selectedManagementScopeKey)
    ?? managementScopes[0]
    ?? null
  const canManageUp3Operations = isSuperAdmin || isAdminUp3 || isManagement
  const managementScopeLabel = isManagement && selectedManagementScope
    ? isUpManagement
      ? `${MANAGEMENT_ROLE_LABELS[managementRole]} · ${selectedManagementScope.internalUpName} · ${managementScopes.length} Unit Layanan terpetakan`
      : `${MANAGEMENT_ROLE_LABELS[managementRole]} · ${selectedManagementScope.internalUlName} · ${selectedManagementScope.up3Name} · ${selectedManagementScope.childUlpCount} ULP`
    : null
  const canViewAdminUp3Modules = canManageUp3Operations
  const canViewReadOnlyMasterLocations = isAdminUlp
  const canMutateMasterLocations = isSuperAdmin
  const canReorderMasterLocations = isSuperAdmin || canManageUp3Operations
  const canReadEmployeeFinancials = isSuperAdmin || canManageUp3Operations
  const approvalCounts = Object.fromEntries((approvalNotifications.groups ?? []).map((group) => [group.id, group.count]))

  useEffect(() => {
    if (!canManageUp3Operations || !approvalTarget) return
    if (approvalTarget.source === 'lembur') {
      const targetPeriod = slaPeriods.find((label) => periodKeyFromLabel(label) === approvalTarget.periodMonth) ?? periodLabelFromMonth(approvalTarget.periodMonth)
      if (targetPeriod) setPeriod(targetPeriod)
      setModuleId('lembur')
    } else if (approvalTarget.source === 'variable' || approvalTarget.source === 'feeder') {
      setModuleId('variable-cost')
    }
  }, [canManageUp3Operations, approvalTarget?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshLocations = useCallback(async ({ preserveOnError = false } = {}) => {
    if (!preserveOnError) setLocationLoadStatus('loading')
    setLocationLoadError('')
    try {
      const locationRows = await fetchLocationsFromSupabase()
      setEmployeeLocations(locationRows)
      setLocationLoadStatus('ready')
      return locationRows
    } catch (error) {
      setLocationLoadError(error.message || 'Gagal memuat lokasi Supabase.')
      if (!preserveOnError) {
        setEmployeeLocations([])
        setLocationLoadStatus('error')
      }
      throw error
    }
  }, [])

  useEffect(() => {
    if (!auth?.session) return
    let cancelled = false
    Promise.all([
      fetchEmployeesFromSupabase({
        hasSensitiveRead: canReadEmployeeFinancials,
        includeHourlyRates: canReadEmployeeFinancials,
      }),
      fetchPositionsFromSupabase(),
    ])
      .then(([empResult, posRows]) => {
        if (cancelled) return
        setEmployeeLoadError('')
        setEmployees(empResult.employees)
        if (posRows.length) {
          setJabatan((prev) => {
            const existing = new Set(prev.map((j) => j.id))
            const supabasePositions = posRows.map((p) => ({
              id: p.id,
              name: p.name,
              contractId: p.contract_id,
            }))
            const newPositions = supabasePositions.filter((p) => !existing.has(p.id))
            return newPositions.length ? [...prev, ...newPositions] : prev
          })
        }
        setEmployeesLoaded(true)
      })
      .catch((error) => {
        if (!cancelled) {
          setEmployeeLoadError(error.message || 'Gagal memuat pegawai Supabase.')
          setEmployeesLoaded(true)
        }
      })
    return () => { cancelled = true }
  }, [auth?.session, employeeReloadToken, canReadEmployeeFinancials])

  useEffect(() => {
    if (!auth?.session) return
    refreshLocations().catch(() => {})
  }, [auth?.session, refreshLocations])

  useEffect(() => {
    if (!auth?.session) {
      setOrgMap(null)
      setOrgMapStatus('loading')
      setOrgMapError('')
      return undefined
    }
    let cancelled = false
    setOrgMap(null)
    setOrgMapStatus('loading')
    setOrgMapError('')
    const displayNameByLegacyKey = Object.fromEntries(
      units.map((unit) => [unit.id, currentNameOf(unit)]),
    )
    getOrganizationScope({
      up3Id,
      contractCode: slaContractScope.contractId,
      displayNameByLegacyKey,
    })
      .then((scope) => {
        if (cancelled) return
        setOrgMap(scope)
        setOrgMapStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setOrgMapError(error.message || 'Gagal memuat organisasi Supabase.')
        setOrgMapStatus('error')
      })
    return () => { cancelled = true }
  }, [auth?.session, up3Id, units])
  const [pensionPolicies, setPensionPolicies] = useState(() =>
    initialPensionPoliciesForUp3(slaContractScope.contractId, up3Id),
  )
  const [jabatan, setJabatan] = useState(() =>
    initialJabatanForUp3(slaContractScope.contractId, up3Id),
  )
  const [signatureGroups, setSignatureGroups] = useState(() =>
    slaSignatureGroups.map((group) => ({
      ...group,
      signatories: group.signatories.map((signatory) => ({ ...signatory })),
    })),
  )
  const [versions, setVersions] = useState([])
  const [entriesByUnit, setEntriesByUnit] = useState({})
  const [targets, setTargets] = useState({})
  const [lemburRecords, setLemburRecords] = useState([])
  const [lemburLoadStatus, setLemburLoadStatus] = useState('idle')
  const [lemburLoadError, setLemburLoadError] = useState('')
  const lemburRequestId = useRef(0)

  const activeModule = pelayananTeknikModules.find((module) => module.id === moduleId)
  const up3Unit = units.find((unit) => unit.type === 'UP3' && unit.id === up3Id) ?? null
  const ulpUnits = units.filter(
    (unit) => unit.type === 'ULP' && unit.parentUnitId === up3Id,
  )
  const scopedUnits = [up3Unit, ...ulpUnits].filter(Boolean)
  const scopedVersions = versions.filter(
    (version) =>
      version.contractId === slaContractScope.contractId &&
      version.up3Id === up3Id,
  )
  const scopedUnitIds = [up3Id, ...ulpIdsOfUp3(units, up3Id)]
  const effectiveUnitId = scopedUnitIds.includes(unitId)
    ? unitId
    : role === 'ulp'
      ? null
      : (ulpUnits[0]?.id ?? up3Id)
  const adminUlpAccess = contractAccess.find(
    (access) =>
      access.role === 'ADMIN_ULP' &&
      access.contract_id === orgMap?.contractUuid &&
      access.operational_up3_id === orgMap?.up3Uuid,
  )
  const selectedUnitUuid = orgMap?.units.find(
    (entry) => entry.uuid === effectiveUnitId || entry.legacyKey === effectiveUnitId,
  )?.uuid ?? null
  const lemburUnitUuid = role === 'ulp'
    ? isAdminUlp
      ? adminUlpAccess?.operational_unit_id ?? null
      : selectedUnitUuid
    : null
  const lemburPeriodMonth = periodKeyFromLabel(period)
  const selectedUnit = units.find((unit) => unit.id === effectiveUnitId)
  const isUp3View = effectiveUnitId === up3Id

  useEffect(() => {
    if (!isAdminUlp || !orgMap?.contractUuid || !orgMap?.up3Uuid || !selectedUnitUuid) { setVariableRejectedCount(0); return }
    let cancelled = false
    listRejectedEntries({ contractId: orgMap.contractUuid, up3Id: orgMap.up3Uuid, unitId: selectedUnitUuid })
      .then((rows) => { if (!cancelled) setVariableRejectedCount((rows ?? []).length) })
      .catch(() => { if (!cancelled) setVariableRejectedCount(0) })
    return () => { cancelled = true }
  }, [isAdminUlp, orgMap?.contractUuid, orgMap?.up3Uuid, selectedUnitUuid])
  const masterLocationUnits = (orgMap?.units ?? []).map((unit) => ({
    id: unit.uuid,
    type: unit.type,
    parentUnitId: unit.parentUuid,
    status: unit.status,
    nameHistory: [
      {
        id: `org-name-${unit.uuid}`,
        name: unit.displayName,
        validFrom: null,
        validTo: null,
      },
    ],
  }))
  const masterLocationUnitId = orgMap?.units.find(
    (unit) => unit.uuid === effectiveUnitId || unit.legacyKey === effectiveUnitId,
  )?.uuid ?? null
  const masterLocationContractScope = orgMap
    ? { ...slaContractScope, contractId: orgMap.contractUuid }
    : slaContractScope
  const slaUnitIds = [
    ...new Set([
      ...units.map((unit) => unit.id),
      ...versions.map((version) => version.up3Id).filter(Boolean),
      slaContractScope.up3.id,
    ]),
  ]

  const periodMonth = periodKeyFromLabel(period)
  const reportingVersions = scopedVersions.filter((version) => versionCoversMonth(version, periodMonth))
  const selectedVersion = reportingVersions.find((version) => version.id === versionId) ?? null
  const flatIndicators = selectedVersion
    ? flattenVersionIndicators(selectedVersion)
    : []

  useEffect(() => {
    if (!orgMap?.contractUuid || !orgMap?.up3Uuid || !periodMonth) {
      setVersions([])
      setVersionId('')
      return undefined
    }
    let cancelled = false
    setSlaLoadStatus('loading')
    setSlaLoadError('')
    Promise.all([
      fetchSlaVersions({ contractId: orgMap.contractUuid, up3Id: orgMap.up3Uuid }),
      resolveReportingVersionByMonth({ contractId: orgMap.contractUuid, up3Id: orgMap.up3Uuid, periodMonth }),
    ])
      .then(([versionRows, reportingVersion]) => {
        if (cancelled) return
        setVersions(versionRows.map((row) => mapDatabaseVersion(row, up3Id)))
        setVersionId(reportingVersion?.id ?? '')
        if (!reportingVersion) setSlaLoadStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setVersions([])
        setVersionId('')
        setSlaLoadError(error.message || 'Gagal memuat versi SLA Supabase.')
        setSlaLoadStatus('error')
      })
    return () => { cancelled = true }
  }, [orgMap?.contractUuid, orgMap?.up3Uuid, periodMonth, up3Id])

  useEffect(() => {
    if (!selectedVersion || !orgMap?.contractUuid || !orgMap?.up3Uuid) {
      setEntriesByUnit({})
      setSavedEntriesByUnit({})
      setTargets({})
      setSavedTargets({})
      setDatabaseIndicators([])
      setVariableSlaTargets({})
      return undefined
    }
    let cancelled = false
    setSlaLoadStatus('loading')
    setSlaLoadError('')
    const ulpOrgUnits = (orgMap.units ?? []).filter((unit) => unit.type === 'ULP')
    const unitIds = ulpOrgUnits.map((unit) => unit.uuid)
    Promise.all([
      fetchSlaIndicators({ versionId: selectedVersion.id }),
      fetchSlaTargets({
        contractId: orgMap.contractUuid,
        up3Id: orgMap.up3Uuid,
        versionId: selectedVersion.id,
        periodMonth,
      }),
      fetchSlaEntries({
        contractId: orgMap.contractUuid,
        up3Id: orgMap.up3Uuid,
        versionId: selectedVersion.id,
        periodMonth,
        unitIds,
      }),
    ])
      .then(([indicatorRows, targetRows, entryRows]) => {
        if (cancelled) return
        const legacyByIndicatorId = new Map(indicatorRows.map((row) => [row.id, row.legacy_key]))
        const pointByIndicatorId = new Map(indicatorRows.map((row) => [row.id, row.point_code]))
        const uiUnitByUuid = new Map(ulpOrgUnits.map((unit) => [unit.uuid, unit.legacyKey ?? unit.uuid]))
        const nextEntries = {}
        entryRows.forEach((row) => {
          const uiUnitId = uiUnitByUuid.get(row.unit_id)
          const indicatorId = legacyByIndicatorId.get(row.indicator_id)
          if (!uiUnitId || !indicatorId) return
          nextEntries[uiUnitId] ??= {}
          nextEntries[uiUnitId][indicatorId] = {
            unit: row.measurement_unit,
            wo: row.work_order,
            realization: row.realization,
            achievement: row.achievement,
          }
        })
        const consolidated = {}
        ulpOrgUnits.forEach((unit) => {
          const unitEntries = nextEntries[unit.legacyKey ?? unit.uuid] ?? {}
          Object.entries(unitEntries).forEach(([indicatorId, entry]) => {
            const aggregate = consolidated[indicatorId] ?? { unit: null, wo: 0, realization: 0, achievement: null }
            const candidateUnit = String(entry.unit ?? '').trim()
            if (candidateUnit && (!aggregate.unit || candidateUnit.localeCompare(aggregate.unit) < 0)) aggregate.unit = candidateUnit
            aggregate.wo += Number(entry.wo ?? 0)
            aggregate.realization += Number(entry.realization ?? 0)
            consolidated[indicatorId] = aggregate
          })
        })
        nextEntries[up3Id] = consolidated

        const nextTargets = {}
        targetRows.forEach((row) => {
          const indicatorId = legacyByIndicatorId.get(row.indicator_id)
          if (!indicatorId) return
          const target = nextTargets[indicatorId] ?? { up3: null, ulp: null, ulpTargets: {} }
          if (row.target_scope === 'UP3') target.up3 = row.target_value
          else {
            const uiUnitId = uiUnitByUuid.get(row.unit_id)
            if (uiUnitId) target.ulpTargets[uiUnitId] = row.target_value
          }
          nextTargets[indicatorId] = target
        })
        const nextVariableTargets = {}
        indicatorRows.forEach((row) => {
          if (!variableCostPoints.has(row.point_code) || row.input_mode !== 'VARIABLE_COST') return
          const indicatorTarget = nextTargets[row.legacy_key] ?? { up3: null, ulp: null, ulpTargets: {} }
          const values = ulpOrgUnits.map((unit) => indicatorTarget.ulpTargets[unit.legacyKey ?? unit.uuid]).filter((value) => value != null)
          indicatorTarget.up3 = values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null
          nextTargets[row.legacy_key] = indicatorTarget
          nextVariableTargets[row.point_code] = isUp3View
            ? indicatorTarget.up3
            : indicatorTarget.ulpTargets[effectiveUnitId] ?? null
        })
        setDatabaseIndicators(indicatorRows)
        setEntriesByUnit(nextEntries)
        setSavedEntriesByUnit(nextEntries)
        setTargets(nextTargets)
        setSavedTargets(nextTargets)
        setVariableSlaTargets(nextVariableTargets)
        setSlaLoadStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setEntriesByUnit({})
        setTargets({})
        setVariableSlaTargets({})
        setSlaLoadError(error.message || 'Gagal memuat snapshot SLA Supabase.')
        setSlaLoadStatus('error')
      })
    return () => { cancelled = true }
  }, [selectedVersion?.id, orgMap?.contractUuid, orgMap?.up3Uuid, periodMonth, up3Id, isUp3View, effectiveUnitId, slaReloadToken])
  const authorizedModules = pelayananTeknikModules.filter(
        (module) =>
          !module.adminOnly ||
          canViewAdminUp3Modules ||
          (module.id === 'master-lokasi' && canViewReadOnlyMasterLocations),
      )
  const visibleModules =
    canViewReadOnlyMasterLocations && !canViewAdminUp3Modules
      ? [
          ...authorizedModules.filter((module) => module.id !== 'master-lokasi'),
          authorizedModules.find((module) => module.id === 'master-lokasi'),
        ].filter(Boolean)
      : authorizedModules
  const primaryModules = visibleModules.filter((module) => ['sla', 'variable-cost', 'lembur'].includes(module.id))
  const configurationModules = visibleModules.filter((module) => !['sla', 'variable-cost', 'lembur'].includes(module.id))

  const refreshLembur = useCallback(async () => {
    if (!orgMap?.contractUuid || !orgMap?.up3Uuid || (role === 'ulp' && !lemburUnitUuid)) {
      setLemburRecords([])
      setLemburLoadStatus('idle')
      return
    }
    const requestId = ++lemburRequestId.current
    setLemburLoadStatus('loading')
    setLemburLoadError('')
    setLemburRecords([])
    try {
      await expireInitialOvertimeDrafts({
        contractId: orgMap.contractUuid,
        up3Id: orgMap.up3Uuid,
        unitId: lemburUnitUuid,
      })
      const [repRows, workRows] = await Promise.all([
        listOvertimeReplacements({
          contractId: orgMap.contractUuid,
          up3Id: orgMap.up3Uuid,
          unitId: lemburUnitUuid,
          periodMonth: lemburPeriodMonth,
        }),
        listOvertimeWork({
          contractId: orgMap.contractUuid,
          up3Id: orgMap.up3Uuid,
          unitId: lemburUnitUuid,
          periodMonth: lemburPeriodMonth,
        }),
      ])
      if (requestId !== lemburRequestId.current) return
      setLemburRecords([...repRows, ...workRows])
      setLemburLoadStatus('ready')
    } catch (error) {
      if (requestId !== lemburRequestId.current) return
      setLemburLoadError(error.message || 'Gagal memuat data lembur Supabase.')
      setLemburLoadStatus('error')
    }
  }, [orgMap?.contractUuid, orgMap?.up3Uuid, role, lemburUnitUuid, lemburPeriodMonth])

  const refreshLemburAndApprovals = useCallback(async () => {
    await refreshLembur()
    await onApprovalChange?.()
  }, [refreshLembur, onApprovalChange])

  useEffect(() => {
    if (moduleId !== 'lembur' || !auth?.session) return
    refreshLembur()
    return () => { lemburRequestId.current += 1 }
  }, [moduleId, auth?.session, refreshLembur])

  const saveLembur = async (id, draft) => {
    try {
      const activityId = await saveOvertimeReplacementDraft({
        activityId: id,
        contractId: orgMap.contractUuid,
        up3Id: orgMap.up3Uuid,
        ...draft,
      })
      await refreshLembur()
      return {
        ok: true,
        activityId,
        message: id ? 'Draft diperbarui di Supabase.' : 'Draft disimpan di Supabase. Lengkapi evidence sebelum mengajukan.',
      }
    } catch (error) {
      return { ok: false, message: error.message || 'Gagal menyimpan Draft ke Supabase.' }
    }
  }

  const saveWorkLembur = async (id, draft) => {
    try {
      const activityId = await saveOvertimeWorkDraft({
        activityId: id,
        contractId: orgMap.contractUuid,
        up3Id: orgMap.up3Uuid,
        ...draft,
      })
      await refreshLembur()
      return {
        ok: true,
        activityId,
        message: id ? 'Draft diperbarui di Supabase.' : 'Draft disimpan di Supabase. Lengkapi evidence sebelum mengajukan.',
      }
    } catch (error) {
      return { ok: false, message: error.message || 'Gagal menyimpan Draft ke Supabase.' }
    }
  }

  const submitLembur = async (activityId) => {
    try {
      await submitOvertimeReplacement(activityId)
      await refreshLembur()
      return { ok: true, message: 'Lembur diajukan dan menunggu approval.' }
    } catch (error) {
      return { ok: false, message: error.message || 'Gagal mengajukan Lembur.' }
    }
  }

  const submitWorkLembur = async (activityId) => {
    try {
      await submitOvertimeWork(activityId)
      await refreshLembur()
      return { ok: true, message: 'Lembur diajukan dan menunggu approval.' }
    } catch (error) {
      return { ok: false, message: error.message || 'Gagal mengajukan Lembur.' }
    }
  }

  useEffect(() => {
    setJabatan((prev) =>
      prev.some(
        (item) =>
          item.contractId === slaContractScope.contractId &&
          item.up3Id === up3Id,
      )
        ? prev
        : [...prev, ...initialJabatanForUp3(slaContractScope.contractId, up3Id)],
    )
  }, [up3Id])

  useEffect(() => {
    setPensionPolicies((prev) =>
      prev.some(
        (policy) =>
          policy.contractId === slaContractScope.contractId &&
          policy.up3Id === up3Id,
      )
        ? prev
        : [...prev, ...initialPensionPoliciesForUp3(slaContractScope.contractId, up3Id)],
    )
  }, [up3Id])

  useEffect(() => {
    const canViewActiveModule =
      !activeModule?.adminOnly ||
      canViewAdminUp3Modules ||
      (activeModule?.id === 'master-lokasi' && canViewReadOnlyMasterLocations)
    if (!canViewActiveModule) {
      setModuleId('sla')
    }
  }, [activeModule, canViewAdminUp3Modules, canViewReadOnlyMasterLocations])

  const isActiveReportingVersion = selectedVersion?.databaseStatus === 'ACTIVE'
  const isOwnAdminUlp = isAdminUlp && selectedUnitUuid === adminUlpAccess?.operational_unit_id
  const canEditManualOperations = Boolean(
    isActiveReportingVersion && !isUp3View && (isOwnAdminUlp || isSuperAdmin),
  )
  const canEditTarget = Boolean(isActiveReportingVersion && canManageUp3Operations)

  const updateEntries = (nextEntries) => {
    if (!canEditManualOperations) return
    setEntriesByUnit((current) => ({ ...current, [effectiveUnitId]: nextEntries }))
  }

  const manualIndicators = flatIndicators.filter(
    (indicator) => indicator.inputMode !== 'variable-cost' && !variableCostPoints.has(indicator.point),
  )

  const handleSaveManualSlaEntries = async () => {
    if (!canEditManualOperations || !selectedVersion || !selectedUnitUuid) return
    const currentEntries = entriesByUnit[effectiveUnitId] ?? {}
    const persistedEntries = savedEntriesByUnit[effectiveUnitId] ?? {}
    const changes = manualIndicators.filter((indicator) => {
      const current = currentEntries[indicator.id] ?? {}
      const persisted = persistedEntries[indicator.id] ?? {}
      return ['unit', 'wo', 'realization', 'achievement'].some((field) => (current[field] ?? null) !== (persisted[field] ?? null))
    })
    setSlaManualSaveError('')
    setSlaManualSaveMessage('')
    if (!changes.length) {
      setSlaManualSaveMessage('Tidak ada perubahan data SLA.')
      return
    }
    setSlaManualSaving(true)
    try {
      await Promise.all(changes.map((indicator) => {
        const databaseIndicator = databaseIndicators.find((row) => row.legacy_key === indicator.id)
        if (!databaseIndicator) throw new Error(`Indikator ${indicator.point} tidak ditemukan pada versi database.`)
        const entry = currentEntries[indicator.id] ?? {}
        return saveManualSlaEntry({
          contractId: orgMap.contractUuid,
          up3Id: orgMap.up3Uuid,
          unitId: selectedUnitUuid,
          versionId: selectedVersion.id,
          indicatorId: databaseIndicator.id,
          periodMonth,
          measurementUnit: entry.unit,
          workOrder: entry.wo ?? null,
          realization: entry.realization ?? null,
          achievement: entry.achievement ?? null,
        })
      }))
      setSlaManualSaveMessage(`${changes.length} baris SLA berhasil disimpan.`)
      setSlaReloadToken((value) => value + 1)
    } catch (error) {
      setSlaManualSaveError(error.message || 'Gagal menyimpan data SLA.')
    } finally {
      setSlaManualSaving(false)
    }
  }

  const handleSaveManualSlaTargets = async () => {
    if (!canEditTarget || (!isUp3View && !selectedUnitUuid) || !orgMap?.contractUuid || !orgMap?.up3Uuid || !selectedVersion) return
    setSlaManualSaveError(''); setSlaManualSaveMessage('')
    try {
      const changes = manualIndicators.flatMap((indicator) => {
        const current = targets[indicator.id] ?? { up3: null, ulpTargets: {} }
        const persisted = savedTargets[indicator.id] ?? { up3: null, ulpTargets: {} }
        const value = isUp3View ? current.up3 : current.ulpTargets?.[effectiveUnitId]
        const oldValue = isUp3View ? persisted.up3 : persisted.ulpTargets?.[effectiveUnitId]
        return (value ?? null) === (oldValue ?? null) ? [] : [{ indicator, value }]
      })
      if (!changes.length) {
        setSlaManualSaveMessage('Tidak ada perubahan target.')
        return
      }
      if (changes.some(({ value }) => value == null || !Number.isFinite(Number(value)))) {
        throw new Error('Target yang diubah wajib berupa angka.')
      }
      setSlaManualSaving(true)
      await Promise.all(changes.map(({ indicator, value }) => {
        const databaseIndicator = databaseIndicators.find((row) => row.legacy_key === indicator.id)
        if (!databaseIndicator) throw new Error(`Indikator ${indicator.point} tidak ditemukan pada versi database.`)
        const common = {
          contractId: orgMap.contractUuid,
          up3Id: orgMap.up3Uuid,
          versionId: selectedVersion.id,
          indicatorId: databaseIndicator.id,
          periodMonth,
          targetValue: Number(value),
        }
        return isUp3View
          ? setManualSlaUp3Target(common)
          : setManualSlaTarget({ ...common, unitId: selectedUnitUuid })
      }))
      setSlaManualSaveMessage(`${changes.length} target berhasil disimpan.`)
      setSlaReloadToken((value) => value + 1)
    } catch (e) {
      setSlaManualSaveError(e.message || 'Gagal menyimpan target.')
    } finally {
      setSlaManualSaving(false)
    }
  }

  const exportScopeLabel = isUp3View
    ? `SLA UP3 ${(currentNameOf(up3Unit) ?? '').replace(/^UP3\s+/, '')}`
    : `SLA ULP ${(currentNameOf(selectedUnit) ?? '').replace(/^ULP\s+/, '')}`

  const renderModuleButton = (module) => (
    <button
      key={module.id}
      type="button"
      className={`sla-module-nav-item ${moduleId === module.id ? 'sla-module-nav-item-active' : ''}`}
      onClick={() => setModuleId(module.id)}
    >
      {module.name}
      {canManageUp3Operations && module.id === 'variable-cost' && (approvalCounts.variable ?? 0) > 0 && (
        <span className="approval-count-badge">{approvalCounts.variable}</span>
      )}
      {canManageUp3Operations && module.id === 'lembur' && (approvalCounts.lembur ?? 0) > 0 && (
        <span className="approval-count-badge">{approvalCounts.lembur}</span>
      )}
      {module.id === 'variable-cost' && isAdminUlp && variableRejectedCount > 0 && (
        <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>{variableRejectedCount}</span>
      )}
    </button>
  )

  return (
    <div className="page page-sla">
      <header className="pt-page-header">
        <div>
          <h1 className="page-title">Pelayanan Teknik</h1>
          <p className="page-description">Kelola pelaporan dan monitoring pekerjaan secara terintegrasi.</p>
        </div>
        <button type="button" className="back-button pt-back-button" onClick={onBack}>
          &larr; Dashboard
        </button>
      </header>

      <div className="sla-module-navigation">
        <nav className="sla-module-nav" aria-label="Modul utama Pelayanan Teknik">
          {primaryModules.map(renderModuleButton)}
        </nav>
        {configurationModules.length > 0 && (
          <details className="sla-config-menu">
            <summary className={configurationModules.some((module) => module.id === moduleId) ? 'sla-config-menu-active' : ''}>
              Master &amp; Pengaturan
            </summary>
            <div className="sla-config-menu-panel">
              {configurationModules.map(renderModuleButton)}
            </div>
          </details>
        )}
      </div>
      {isManagement && managementScopeLabel && (
        <div className="sla-role-banner sla-role-banner-mgmt" style={{ marginTop: 8 }}>{managementScopeLabel}</div>
      )}
      {isUpManagement && managementScopes.length > 1 && (
        <label className="sla-context-field" style={{ marginTop: 8, maxWidth: 360 }}>
          <span className="sla-context-label">Scope Unit Layanan</span>
          <select
            className="sla-context-select"
            value={selectedManagementScope?.key ?? ''}
            onChange={(event) => onManagementScopeChange?.(event.target.value)}
          >
            {managementScopes.map((scope) => (
              <option key={scope.key} value={scope.key}>{scope.internalUlName}</option>
            ))}
          </select>
        </label>
      )}

      {moduleId === 'pengaturan-sla' ? (
        <SLAPengaturanSLA
          versions={scopedVersions}
          units={scopedUnits}
          contractScope={slaContractScope}
          orgMap={orgMap}
          lifecycleReadOnly
        />
      ) : moduleId === 'master-penandatangan' ? (
        <SLAMasterPenandatangan
          contractScope={slaContractScope}
          up3Id={up3Id}
          units={scopedUnits}
          signatureGroups={signatureGroups}
          onSignatureGroupsChange={setSignatureGroups}
        />
      ) : moduleId === 'master-organisasi' ? (
        <SLAMasterOrganisasi
          contractScope={slaContractScope}
          up3Id={up3Id}
          role={role}
          units={units}
          onUnitsChange={isRealScopedUser ? () => {} : onUnitsChange}
          referencesContext={{ employees, signatureGroups, slaUnitIds }}
        />
      ) : moduleId === 'master-lokasi' && orgMapStatus === 'loading' ? (
        <section className="placeholder">
          <h2 className="placeholder-title">Memuat organisasi</h2>
          <p className="placeholder-text">Menyiapkan hierarki Master Lokasi dari Supabase.</p>
        </section>
      ) : moduleId === 'master-lokasi' && orgMapStatus === 'error' ? (
        <section className="placeholder">
          <h2 className="placeholder-title">Organisasi tidak dapat dimuat</h2>
          <p className="sla-blocked-note">{orgMapError}</p>
        </section>
      ) : moduleId === 'master-lokasi' && locationLoadStatus === 'loading' ? (
        <section className="placeholder">
          <h2 className="placeholder-title">Memuat lokasi</h2>
          <p className="placeholder-text">Menyiapkan Master Lokasi dari Supabase.</p>
        </section>
      ) : moduleId === 'master-lokasi' && locationLoadStatus === 'error' ? (
        <section className="placeholder">
          <h2 className="placeholder-title">Lokasi tidak dapat dimuat</h2>
          <p className="sla-blocked-note">{locationLoadError}</p>
        </section>
      ) : moduleId === 'master-lokasi' ? (
        <SLAMasterLokasi
          contractScope={masterLocationContractScope}
          up3Id={orgMap.up3Uuid}
          units={masterLocationUnits}
          locations={employeeLocations}
          role={role}
          unitId={masterLocationUnitId}
          canMutate={canMutateMasterLocations}
          canReorder={canReorderMasterLocations}
          onCreateLocation={async (draft) => {
            await createKantorJaga({
              ...draft,
              contractId: orgMap.contractUuid,
            })
            await refreshLocations()
          }}
          onRenameLocation={async (draft) => {
            await renameKantorJaga(draft)
            await refreshLocations()
          }}
          onStatusLocation={async (draft) => {
            await setKantorJagaStatus(draft)
            await refreshLocations()
          }}
          onDeleteLocation={async (locationId) => {
            await deleteKantorJaga(locationId)
            await refreshLocations()
          }}
          onReorderUnits={async (unitIds) => {
            await reorderOrganizationUnits(unitIds)
          }}
          onRefreshUnits={async () => {
            invalidateOrganizationMap()
            const scope = await getOrganizationScope({
              up3Id,
              contractCode: slaContractScope.contractId,
              displayNameByLegacyKey: Object.fromEntries(
                units.map((unit) => [unit.id, currentNameOf(unit)]),
              ),
            })
            setOrgMap(scope)
          }}
          onReorderLocations={async (locationIds) => {
            await reorderLocations(locationIds)
          }}
          onRefreshLocations={async () => {
            await refreshLocations({ preserveOnError: true })
          }}
          referencesContext={{ employees, changeRequests }}
        />
      ) : moduleId === 'master-jabatan' ? (
        <SLAMasterJabatan
          contractScope={slaContractScope}
          up3Id={up3Id}
          jabatan={jabatan}
          onJabatanChange={setJabatan}
        />
      ) : moduleId === 'database-pegawai' && orgMapStatus === 'loading' ? (
        <section className="placeholder">
          <h2 className="placeholder-title">Memuat organisasi</h2>
          <p className="placeholder-text">Menyiapkan unit dan lokasi Master Pegawai dari Supabase.</p>
        </section>
      ) : moduleId === 'database-pegawai' && orgMapStatus === 'error' ? (
        <section className="placeholder">
          <h2 className="placeholder-title">Organisasi tidak dapat dimuat</h2>
          <p className="sla-blocked-note">{orgMapError}</p>
        </section>
      ) : moduleId === 'database-pegawai' && locationLoadStatus === 'loading' ? (
        <section className="placeholder">
          <h2 className="placeholder-title">Memuat lokasi</h2>
          <p className="placeholder-text">Menyiapkan lokasi penempatan dari Supabase.</p>
        </section>
      ) : moduleId === 'database-pegawai' && locationLoadStatus === 'error' ? (
        <section className="placeholder">
          <h2 className="placeholder-title">Lokasi tidak dapat dimuat</h2>
          <p className="sla-blocked-note">{locationLoadError}</p>
        </section>
      ) : moduleId === 'database-pegawai' ? (
        <SLADatabasePegawai
          contractScope={slaContractScope}
          up3Id={up3Id}
          units={scopedUnits}
          employees={employees}
          onEmployeesChange={setEmployees}
          changeRequests={changeRequests}
          onChangeRequestsChange={setChangeRequests}
          jabatan={jabatan}
          role={role}
          unitId={effectiveUnitId}
          pensionPolicies={pensionPolicies}
          onPensionPoliciesChange={setPensionPolicies}
          locations={employeeLocations}
          orgMap={orgMap}
        />
      ) : moduleId === 'sla' ? (
        role === 'ulp' && !effectiveUnitId ? (
          <section className="placeholder">
            <h2 className="placeholder-title">Unit tidak tersedia</h2>
            <p className="placeholder-text">
              Tidak ada ULP aktif pada UP3{' '}
              <strong>{up3Unit ? currentNameOf(up3Unit) : up3Id}</strong>.
              Pilih UP3 lain atau aktifkan ULP melalui Master Organisasi.
            </p>
          </section>
        ) : (
        <>
          <SLAContextBar
            role={role}
            periods={slaPeriods}
            versions={reportingVersions}
            units={scopedUnits}
            period={period}
            version={versionId}
            versionName={selectedVersion?.name}
            unitId={effectiveUnitId}
            onPeriodChange={setPeriod}
            onVersionChange={setVersionId}
            onUnitChange={onUnitChange}
          />
          <div className={`sla-role-banner sla-role-banner-${role}`}>
            {isManagement ? managementScopeLabel : ROLE_NOTES[role]}
          </div>
          <div className="sla-export-bar">
            <span className="sla-export-scope">
              Export berlaku untuk {exportScopeLabel}
            </span>
            <button
              type="button"
              className="sla-btn sla-btn-primary"
              disabled={!selectedVersion || slaLoadStatus !== 'ready'}
              onClick={() => {
                if (selectedVersion && versionCoversMonth(selectedVersion, periodMonth)) setExportOpen(true)
              }}
            >
              Export
            </button>
          </div>
          {slaLoadStatus === 'loading' ? (
            <section className="placeholder">
              <h2 className="placeholder-title">Memuat snapshot SLA</h2>
              <p className="placeholder-text">Menyiapkan versi, target, dan data laporan dari Supabase.</p>
            </section>
          ) : slaLoadStatus === 'error' ? (
            <section className="placeholder">
              <h2 className="placeholder-title">Snapshot SLA tidak dapat dimuat</h2>
              <p className="sla-blocked-note">{slaLoadError}</p>
            </section>
          ) : selectedVersion ? (
            <>
              <SLAIndicatorTable
                indicators={flatIndicators}
                role={role}
                unitId={effectiveUnitId}
                up3Id={up3Id}
                entries={entriesByUnit[effectiveUnitId] ?? {}}
                onEntriesChange={updateEntries}
                targets={targets}
                onTargetsChange={setTargets}
                variableTargets={Object.fromEntries(Object.entries(variableSlaTargets).filter(([point]) => variableCostPoints.has(point)))}
                canEditManualOperations={canEditManualOperations}
                canEditTarget={canEditTarget}
              />
              {(canEditManualOperations || canEditTarget) && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {canEditManualOperations && (
                    <button type="button" className="sla-btn sla-btn-primary" disabled={slaManualSaving} onClick={handleSaveManualSlaEntries}>{slaManualSaving ? 'Menyimpan...' : 'Simpan Data SLA'}</button>
                  )}
                  {canEditTarget && (
                    <button type="button" className="sla-btn sla-btn-primary" disabled={slaManualSaving} onClick={handleSaveManualSlaTargets}>{slaManualSaving ? 'Menyimpan...' : 'Simpan Target'}</button>
                  )}
                  {slaManualSaveMessage && <span style={{ color: '#065f46', fontSize: 13 }}>{slaManualSaveMessage}</span>}
                  {slaManualSaveError && <span className="sla-blocked-note">{slaManualSaveError}</span>}
                  <span className="text-muted" style={{ fontSize: 12 }}>Target dari Variable Cost read-only.</span>
                </div>
              )}
            </>
          ) : (
            <section className="placeholder">
              <h2 className="placeholder-title">Belum ada SLA untuk UP3 ini</h2>
              <p className="placeholder-text">
                Belum ada versi SLA untuk kontrak{' '}
                <strong>{slaContractScope.contractName}</strong> pada UP3{' '}
                <strong>{up3Unit ? currentNameOf(up3Unit) : up3Id}</strong>.
                Riwayat versi dapat dilihat melalui modul Pengaturan SLA.
              </p>
            </section>
          )}
        </>
        )
      ) : moduleId === 'variable-cost' ? (
        role === 'ulp' && !effectiveUnitId ? (
          <section className="placeholder">
            <h2 className="placeholder-title">Unit tidak tersedia</h2>
            <p className="placeholder-text">
              Tidak ada ULP aktif pada UP3{' '}
              <strong>{up3Unit ? currentNameOf(up3Unit) : up3Id}</strong>.
            </p>
          </section>
        ) : orgMapStatus === 'loading' ? (
          <section className="placeholder">
            <h2 className="placeholder-title">Memuat organisasi</h2>
            <p className="placeholder-text">Menyiapkan Variable Cost dari Supabase.</p>
          </section>
        ) : orgMapStatus === 'error' || !orgMap ? (
          <section className="placeholder">
            <h2 className="placeholder-title">Organisasi tidak tersedia</h2>
            <p className="sla-blocked-note">{orgMapError || 'Gagal memuat organisasi.'}</p>
          </section>
        ) : (
          <SLAVariableCost
            period={period}
            periods={slaPeriods}
            onPeriodChange={setPeriod}
            orgMap={orgMap}
            role={role}
            unitId={effectiveUnitId}
            up3Id={up3Id}
            onRejectedCountChange={setVariableRejectedCount}
            approvalCounts={approvalCounts}
            approvalTarget={canManageUp3Operations ? approvalTarget : null}
            onApprovalTargetHandled={onApprovalTargetHandled}
            onApprovalChange={onApprovalChange}
            isManagementReadOnly={isManagement && !canManageUp3Operations}
            canManageKonstruksiMonthly={canManageUp3Operations}
            canViewVariableFinancial={canManageUp3Operations}
          />
        )
      ) : moduleId === 'lembur' && orgMapStatus === 'loading' ? (
        <section className="placeholder">
          <h2 className="placeholder-title">Memuat organisasi</h2>
          <p className="placeholder-text">Menyiapkan scope Lembur dari Supabase.</p>
        </section>
      ) : moduleId === 'lembur' && (orgMapStatus === 'error' || !orgMap) ? (
        <section className="placeholder">
          <h2 className="placeholder-title">Scope Lembur tidak tersedia</h2>
          <p className="sla-blocked-note">{orgMapError || 'Organisasi Supabase tidak tersedia.'}</p>
        </section>
      ) : moduleId === 'lembur' ? (
        role === 'ulp' && !effectiveUnitId ? (
          <section className="placeholder">
            <h2 className="placeholder-title">Unit tidak tersedia</h2>
            <p className="placeholder-text">
              Tidak ada ULP aktif pada UP3{' '}
              <strong>{up3Unit ? currentNameOf(up3Unit) : up3Id}</strong>.
            </p>
          </section>
        ) : (
          <SLALembur
            key={`${orgMap?.contractUuid}-${orgMap?.up3Uuid}-${lemburUnitUuid ?? 'up3'}-${lemburPeriodMonth}-${isManagement ? 'mgmt' : ''}`}
            contractScope={{ ...slaContractScope, contractId: orgMap.contractUuid }}
            up3Id={orgMap.up3Uuid}
            unitId={lemburUnitUuid}
            periodMonth={lemburPeriodMonth}
            records={lemburRecords}
            canMutate={isSuperAdmin || (isAdminUlp && role === 'ulp')}
            isAdminUp3={canManageUp3Operations}
            isSuperAdmin={isSuperAdmin}
            isManagement={false}
            isUlManagement={false}
            isUpManagement={false}
            loading={lemburLoadStatus === 'loading' || !employeesLoaded}
            loadError={lemburLoadError || employeeLoadError}
            orgUnits={orgMap.units}
            onRetry={() => {
              if (employeeLoadError) {
                setEmployeesLoaded(false)
                setEmployeeReloadToken((current) => current + 1)
              }
              refreshLembur()
            }}
            onSaveDraft={saveLembur}
            onSubmit={submitLembur}
            onSaveWorkDraft={saveWorkLembur}
            onSubmitWork={submitWorkLembur}
            onRefresh={refreshLemburAndApprovals}
            approvalTarget={canManageUp3Operations && periodKeyFromLabel(period) === approvalTarget?.periodMonth ? approvalTarget : null}
            onApprovalTargetHandled={onApprovalTargetHandled}
          />
        )
      ) : (
        <section className="placeholder">
          <h2 className="placeholder-title">{activeModule.name}</h2>
          <p className="placeholder-text">
            Modul <strong>{activeModule.name}</strong> baru berupa struktur
            navigasi pada tahap ini. Isi modul akan dibangun pada tahap
            pengembangan berikutnya.
          </p>
        </section>
      )}
      {exportOpen && selectedVersion && (
        <SLAExportPreview
          period={period}
          version={selectedVersion}
          role={role}
          unitId={effectiveUnitId}
          up3Id={up3Id}
          units={units}
          contractId={slaContractScope.contractId}
          documentScope={isUp3View ? 'sla-up3' : 'sla-ulp'}
          indicators={flatIndicators}
          targets={targets}
          ulpEntries={entriesByUnit}
          signatureGroups={signatureGroups}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  )
}
