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
  buildDefaultTargets,
  buildVersionSections,
  cloneTargets,
  flattenVersionIndicators,
  pelayananTeknikModules,
  slaContractScope,
  slaPeriods,
  slaSignatureGroups,
  slaUlpEntries,
  slaVersions,
  variableCostIndicators,
  variableCostPoints,
} from '../../data/slaPelayananTeknik.js'
import { fetchVariableLinkedSlaTargets, listRejectedEntries, fetchManualSlaTargets, setManualSlaTarget, fetchIndicators, fetchActiveVersion } from '../../data/variableCostRepository.js'
import {
  currentNameOf,
  ulpIdsOfUp3,
} from '../../data/organisasiPelayananTeknik.js'
import { initialJabatanForUp3 } from '../../data/jabatanPelayananTeknik.js'
import { getOrganizationScope, invalidateOrganizationMap } from '../../data/orgIdMap.js'
import { initialPensionPoliciesForUp3 } from '../../data/pensiunPelayananTeknik.js'
import { initialVariableCostForUp3, writeVariableCostEntries } from '../../data/variableCostPelayananTeknik.js'
import {
  expireInitialOvertimeDrafts,
  listOvertimeReplacements,
  listOvertimeWork,
  saveOvertimeReplacementDraft,
  saveOvertimeWorkDraft,
  submitOvertimeReplacement,
  submitOvertimeWork,
} from '../../data/overtimeReplacementRepository.js'
import {
  activateScopedVersion,
  deleteScopedDraft,
  markScopedVersionUsed,
  periodKeyFromLabel,
  resolveVersionForPeriod,
  rollbackScopedVersion,
  updateScopedVersion,
} from '../../data/versiSlaPelayananTeknik.js'


const ROLE_NOTES = {
  up3: 'Admin UP3 \u2014 pilih view UP3 atau salah satu ULP. View UP3: Target UP3 dan data Manual (Satuan, WO, Realisasi, Pencapaian) dapat dikelola. View ULP: Target ULP dikelola Admin UP3, data input ULP hanya ditampilkan.',
  ulp: 'Admin ULP \u2014 Target read-only. Indikator Manual: Satuan, WO, Realisasi, dan Pencapaian dapat diedit. 8 indikator Variable Cost: Realisasi dan Pencapaian read-only (otomatis).',
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
}) {
  const [moduleId, setModuleId] = useState('sla')
  const [period, setPeriod] = useState('Agustus 2026')
  const [versionId, setVersionId] = useState(() => slaVersions[0]?.id ?? '')
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
  const isUlManagement = managementAccess.some((a) => ['TEAM_LEADER','MANAGER_UNIT'].includes(a.organization_role))
  const isUpManagement = managementAccess.some((a) => ['MANAGER_UP','ASMAN_OPERASI','ASMAN_KEUANGAN'].includes(a.organization_role))
  // For management, Lembur is monitoring read-only but financial detail is allowed
  const isLemburManagementRead = isManagement
  const canViewAdminUp3Modules = isSuperAdmin || isAdminUp3
  const canViewReadOnlyMasterLocations = isAdminUlp
  const canMutateMasterLocations = isSuperAdmin
  const canReorderMasterLocations = isSuperAdmin || isAdminUp3
  const canReadEmployeeFinancials = isSuperAdmin || (isAdminUp3 && !isAdminUlp) || isLemburManagementRead

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
  const [versions, setVersions] = useState(() =>
    slaVersions.map((version) => ({
      ...version,
      scope: slaContractScope,
      sections: buildVersionSections(),
      targets: buildDefaultTargets(),
    })),
  )
  const [entriesByUnit, setEntriesByUnit] = useState(() =>
    initialVariableCostForUp3(slaContractScope.contractId, up3Id, units),
  )
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
    if (moduleId !== 'sla' || !orgMap?.contractUuid || !orgMap?.up3Uuid || !selectedUnitUuid) {
      setVariableSlaTargets({})
      return
    }
    let cancelled = false
    setVariableSlaTargets({})
    fetchVariableLinkedSlaTargets({
      contractId: orgMap.contractUuid,
      up3Id: orgMap.up3Uuid,
      unitId: isUp3View ? null : selectedUnitUuid,
      periodMonth: periodKeyFromLabel(period),
    })
      .then((rows) => { if (!cancelled) setVariableSlaTargets(rows) })
      .catch(() => { if (!cancelled) setVariableSlaTargets({}) })
    return () => { cancelled = true }
  }, [moduleId, orgMap?.contractUuid, orgMap?.up3Uuid, selectedUnitUuid, isUp3View, period])

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
      ...Object.keys(slaUlpEntries),
      ...versions.map((version) => version.up3Id).filter(Boolean),
      slaContractScope.up3.id,
    ]),
  ]

  const selectedVersion =
    role === 'ulp'
      ? resolveVersionForPeriod(scopedVersions, {
          contractId: slaContractScope.contractId,
          up3Id,
          periodKey: periodKeyFromLabel(period),
        })
      : scopedVersions.find((version) => version.id === versionId) ??
        scopedVersions.find((version) => version.status === 'Aktif') ??
        scopedVersions[0]
  const flatIndicators = selectedVersion
    ? flattenVersionIndicators(selectedVersion)
    : []
  useEffect(() => {
    if (moduleId !== 'sla' || !orgMap?.contractUuid || !orgMap?.up3Uuid || !selectedUnitUuid || isUp3View) return
    let cancelled = false
    const periodMonth = periodKeyFromLabel(period)
    fetchManualSlaTargets({ contractId: orgMap.contractUuid, up3Id: orgMap.up3Uuid, unitId: selectedUnitUuid, periodMonth })
      .then((map) => {
        if (cancelled) return
        setVersions((prev) => prev.map((v) => {
          if (v.id !== selectedVersion?.id) return v
          const newTargets = { ...v.targets }
          const manualIds = flatIndicators.filter((ind) => !variableCostPoints.has(ind.point) && ind.point !== '3.1c' && ind.inputMode !== 'variable-cost').map((ind) => ind.id)
          manualIds.forEach((legacyKey) => {
            const value = map[legacyKey] ?? null
            const existing = newTargets[legacyKey] ?? { up3: null, ulp: null, ulpTargets: {} }
            newTargets[legacyKey] = { ...existing, ulp: value, ulpTargets: { ...(existing.ulpTargets ?? {}), [effectiveUnitId]: value } }
          })
          return { ...v, targets: newTargets }
        }))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [moduleId, orgMap?.contractUuid, orgMap?.up3Uuid, selectedUnitUuid, isUp3View, period, selectedVersion?.id, effectiveUnitId]) // eslint-disable-line react-hooks/exhaustive-deps
  const authorizedModules = isLemburManagementRead && !canViewAdminUp3Modules && !canViewReadOnlyMasterLocations
    ? pelayananTeknikModules.filter((module) => module.id === 'lembur')
    : pelayananTeknikModules.filter(
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
  const activeVcCount = flatIndicators.filter(
    (indicator) => variableCostPoints.has(indicator.point),
  ).length

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

  useEffect(() => {
    if (isLemburManagementRead && moduleId !== 'lembur') {
      setModuleId('lembur')
    }
  }, [isLemburManagementRead, moduleId])

  const updateActiveTargets = (nextTargets) => {
    const selected = selectedVersion
    if (
      !selected ||
      selected.contractId !== slaContractScope.contractId ||
      selected.up3Id !== up3Id
    ) {
      return
    }
    setVersions((prev) =>
      prev.map((version) =>
        version.id === selected.id && version.up3Id === up3Id
          ? { ...version, targets: nextTargets }
          : version,
      ),
    )
  }

  const updateEntries = (nextEntries) => {
    const selected = selectedVersion
    if (
      !selected ||
      selected.contractId !== slaContractScope.contractId ||
      selected.up3Id !== up3Id
    ) {
      return
    }
    const result = writeVariableCostEntries(entriesByUnit, {
      contractId: slaContractScope.contractId,
      up3Id,
      unitId: effectiveUnitId,
      period,
      versionId: selected.id,
      scopedUnitIds,
      entries: nextEntries,
    })
    if (!result.ok) return
    setEntriesByUnit(result.entriesByUnit)
    markVersionUsed(selected.id)
  }

  const markVersionUsed = (id) => {
    if (!id) return
    setVersions((prev) =>
      markScopedVersionUsed(prev, id, slaContractScope.contractId, up3Id),
    )
  }

  const handleSaveManualSlaTargets = async () => {
    if (!isAdminUp3 || isUp3View || !selectedUnitUuid || !orgMap?.contractUuid || !orgMap?.up3Uuid || !selectedVersion) return
    const periodMonth = periodKeyFromLabel(period)
    setSlaManualSaveError(''); setSlaManualSaveMessage('')
    let versionId
    try {
      versionId = await fetchActiveVersion({ contractId: orgMap.contractUuid, up3Id: orgMap.up3Uuid, periodMonth })
      if (!versionId) throw new Error('Tidak ada versi SLA aktif untuk periode ini.')
      const indicators = await fetchIndicators({ contractId: orgMap.contractUuid, up3Id: orgMap.up3Uuid, versionId })
      const manualIndicators = flatIndicators.filter((ind) => !variableCostPoints.has(ind.point) && ind.point !== '3.1c' && ind.inputMode !== 'variable-cost')
      setSlaManualSaving(true)
      for (const ind of manualIndicators) {
        const targetEntry = selectedVersion.targets?.[ind.id]
        const raw = targetEntry?.ulpTargets?.[effectiveUnitId] ?? targetEntry?.ulp ?? null
        if (raw == null || raw === '') continue
        const dbInd = indicators.find((r) => r.legacy_key === ind.id)
        if (!dbInd) continue
        await setManualSlaTarget({ contractId: orgMap.contractUuid, up3Id: orgMap.up3Uuid, unitId: selectedUnitUuid, versionId, indicatorId: dbInd.id, periodMonth, targetValue: Number(raw) })
      }
      setSlaManualSaveMessage('Target berhasil disimpan.')
    } catch (e) {
      setSlaManualSaveError(e.message || 'Gagal menyimpan target.')
    } finally {
      setSlaManualSaving(false)
    }
  }

  const handleCreateDraft = ({ name, period: draftPeriod, source, baseVersionId, periodStart, periodEnd }) => {
    const id = `draft-${Date.now()}`
    const base =
      baseVersionId != null
        ? scopedVersions.find((version) => version.id === baseVersionId)
        : scopedVersions.find((version) => version.status === 'Aktif')
    const sections =
      source === 'copy-active' && base
        ? base.sections.map((section) => ({
            ...section,
            indicators: section.indicators.map((indicator) => ({ ...indicator })),
          }))
        : buildVersionSections()
    const targets =
      source === 'copy-active' && base && base.targets
        ? cloneTargets(base.targets)
        : buildDefaultTargets(up3Id, units)
    setVersions((prev) => [
      ...prev,
      {
        id,
        name,
        status: 'Draft',
        period: draftPeriod,
        source,
        scope: slaContractScope,
        contractId: slaContractScope.contractId,
        up3Id,
        periodStart: periodStart ?? '2027-01-01',
        periodEnd: periodEnd ?? '2027-12-31',
        sections,
        targets,
      },
    ])
    return id
  }

  const handleUpdateVersion = (id, patch) =>
    setVersions((prev) => {
      const target = prev.find((version) => version.id === id)
      if (
        !target ||
        target.contractId !== slaContractScope.contractId ||
        target.up3Id !== up3Id
      ) {
        return prev
      }
      return prev.map((version) => (version.id === id ? { ...version, ...patch } : version))
    })

  const handleActivateVersion = (id) => {
    const result = activateScopedVersion(versions, id, slaContractScope.contractId, up3Id)
    if (!result.ok) return result
    setVersions(result.versions)
    setVersionId(id)
    return result
  }

  const handleRollbackVersion = (id) => {
    const result = rollbackScopedVersion(versions, id, slaContractScope.contractId, up3Id)
    if (!result.ok) return result
    setVersions(result.versions)
    setVersionId(result.nextVersionId)
    return result
  }

  const handleDeleteVersion = (id) => {
    const result = deleteScopedDraft(versions, id, slaContractScope.contractId, up3Id)
    if (!result.ok) return result
    setVersions(result.versions)
    if (versionId === id) setVersionId(result.nextVersionId)
    return result
  }

  const exportScopeLabel = isUp3View
    ? `SLA UP3 ${(currentNameOf(up3Unit) ?? '').replace(/^UP3\s+/, '')}`
    : `SLA ULP ${(currentNameOf(selectedUnit) ?? '').replace(/^ULP\s+/, '')}`

  return (
    <div className="page page-sla">
      <button type="button" className="back-button" onClick={onBack}>
        &larr; Kembali ke Dashboard
      </button>
      <section className="page-hero sla-hero">
        <h1 className="page-title">Pelayanan Teknik</h1>
        <p className="page-description">
          Navigasi Pelayanan Teknik: SLA (indikator A&ndash;D dalam satu tabel
          kontinu), Variable Cost, Lembur, Master Organisasi, Database Pegawai,
          dan Pengaturan SLA khusus Admin UP3. Data operasional bersumber dari
          Supabase.
        </p>
        <div className="sla-hero-meta">
          <span className="sla-hero-badge">
            {flatIndicators.length} indikator SLA
          </span>
          <span className="sla-hero-badge">{variableCostIndicators.length} Variable Cost</span>
          <span className="sla-hero-badge">{activeVcCount} Variable-linked SLA</span>
          <span className="sla-hero-badge">
            {flatIndicators.length - activeVcCount} Manual SLA
          </span>
          <span className="sla-hero-badge">
            {up3Unit ? currentNameOf(up3Unit) : slaContractScope.region} &middot;{' '}
            {ulpUnits.length} ULP
          </span>
        </div>
      </section>

      <nav className="sla-module-nav" aria-label="Menu Pelayanan Teknik">
        {visibleModules.map((module) => (
          <button
            key={module.id}
            type="button"
            className={`sla-module-nav-item ${moduleId === module.id ? 'sla-module-nav-item-active' : ''}`}
            onClick={() => setModuleId(module.id)}
          >
            {module.name}
            {module.id === 'variable-cost' && isAdminUlp && variableRejectedCount > 0 && (
              <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>{variableRejectedCount}</span>
            )}
          </button>
        ))}
      </nav>

      {moduleId === 'pengaturan-sla' ? (
        <SLAPengaturanSLA
          versions={scopedVersions}
          units={scopedUnits}
          contractScope={slaContractScope}
          onCreateDraft={handleCreateDraft}
          onUpdateVersion={handleUpdateVersion}
          onActivate={handleActivateVersion}
          onRollback={handleRollbackVersion}
          onDeleteVersion={handleDeleteVersion}
          orgMap={orgMap}
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
            versions={scopedVersions}
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
            {ROLE_NOTES[role]}
          </div>
          <div className="sla-export-bar">
            <span className="sla-export-scope">
              Export berlaku untuk {exportScopeLabel}
            </span>
            <button
              type="button"
              className="sla-btn sla-btn-primary"
              onClick={() => setExportOpen(true)}
            >
              Export
            </button>
          </div>
          {selectedVersion ? (
            <>
              <SLAIndicatorTable
                indicators={flatIndicators}
                role={role}
                unitId={effectiveUnitId}
                up3Id={up3Id}
                entries={entriesByUnit[effectiveUnitId] ?? {}}
                onEntriesChange={updateEntries}
                targets={selectedVersion.targets}
                onTargetsChange={updateActiveTargets}
                variableTargets={Object.fromEntries(Object.entries(variableSlaTargets).filter(([point]) => variableCostPoints.has(point)))}
              />
              {isAdminUp3 && !isUp3View && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="button" className="sla-btn sla-btn-primary" disabled={slaManualSaving} onClick={handleSaveManualSlaTargets}>{slaManualSaving ? 'Menyimpan...' : 'Simpan Target'}</button>
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
                Buat SLA/Addendum melalui modul Pengaturan SLA.
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
            key={`${orgMap?.contractUuid}-${orgMap?.up3Uuid}-${lemburUnitUuid ?? 'up3'}-${lemburPeriodMonth}-${isLemburManagementRead ? 'mgmt' : ''}`}
            contractScope={{ ...slaContractScope, contractId: orgMap.contractUuid }}
            up3Id={orgMap.up3Uuid}
            unitId={lemburUnitUuid}
            periodMonth={lemburPeriodMonth}
            records={lemburRecords}
            canMutate={isSuperAdmin || (isAdminUlp && role === 'ulp')}
            isAdminUp3={isAdminUp3}
            isSuperAdmin={isSuperAdmin}
            isManagement={isLemburManagementRead}
            isUlManagement={isUlManagement}
            isUpManagement={isUpManagement}
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
            onRefresh={refreshLembur}
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
          targets={selectedVersion.targets}
          ulpEntries={entriesByUnit}
          signatureGroups={signatureGroups}
          onExported={() => markVersionUsed(selectedVersion?.id)}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  )
}
