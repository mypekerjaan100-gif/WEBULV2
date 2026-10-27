import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppLayout from './layout/AppLayout.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ContractPage from './pages/ContractPage.jsx'
import SLAPelayananTeknikPage from './pages/sla/SLAPelayananTeknikPage.jsx'
import UserListPage from './pages/user-management/UserListPage.jsx'
import FinancialAnalysisPage from './pages/FinancialAnalysisPage.jsx'
import { SlaPreviewContext } from './context/SlaPreviewContext.js'
import {
  currentNameOf,
  effectiveStatusOf,
  initialOrganizationUnits,
} from './data/organisasiPelayananTeknik.js'
import { contracts } from './data/contracts.js'
import { pelayananTeknikModules, slaPeriods } from './data/slaPelayananTeknik.js'
import { parseRouteHash, writeRouteHash } from './lib/routeHash.js'
import { getOrgUnits } from './data/orgIdMap.js'
import { useAuth } from './lib/AppAuth.jsx'
import {
  listAdminUp3ApprovalNotifications,
  listManagementApprovalNotifications,
} from './data/approvalNotificationRepository.js'
import { listManagementOperationalScopes } from './data/managementScopeRepository.js'

const EMPTY_APPROVAL_NOTIFICATIONS = { scopeKey: null, count: 0, groups: [] }
const SLA_PRIMARY_MODULE_IDS = ['sla', 'variable-cost', 'lembur', 'kendaraan-ulp']

function mergeApprovalNotifications(current, incoming) {
  const groups = incoming.groups.map((group) => {
    if (!group.error) return group
    const previous = current.groups.find((item) => item.id === group.id)
    return previous ? { ...previous, error: group.error } : group
  })
  return { scopeKey: incoming.scopeKey, count: groups.reduce((total, group) => total + group.count, 0), groups }
}

export default function App() {
  const { authority } = useAuth()
  const [activeContractId, setActiveContractId] = useState(null)
  const [currentPage, setCurrentPage] = useState(null)
  const [role, setRole] = useState('up3')
  const [units, setUnits] = useState(() =>
    initialOrganizationUnits.map((unit) => ({
      ...unit,
      nameHistory: unit.nameHistory.map((entry) => ({ ...entry })),
    })),
  )

  const seedUp3Id = units.find((unit) => unit.type === 'UP3')?.id ?? ''
  const [selectedUp3Id, setSelectedUp3Id] = useState(() => seedUp3Id)
  const up3Id = selectedUp3Id
  const activeUlps = units.filter(
    (unit) =>
      unit.type === 'ULP' &&
      unit.parentUnitId === up3Id &&
      effectiveStatusOf(units, unit.id) === 'Aktif',
  )
  const [unitId, setUnitId] = useState(() => seedUp3Id)
  const [realScope, setRealScope] = useState(null)
  const [managementScopes, setManagementScopes] = useState([])
  const [selectedManagementScopeKey, setSelectedManagementScopeKey] = useState('')
  const [managementUnitId, setManagementUnitId] = useState('')
  // Penanda pemetaan scope async selesai; restore hash menunggu keduanya.
  const [realScopeLoaded, setRealScopeLoaded] = useState(false)
  const [managementScopesLoaded, setManagementScopesLoaded] = useState(false)
  const [approvalNotifications, setApprovalNotifications] = useState(EMPTY_APPROVAL_NOTIFICATIONS)
  const [approvalNotificationError, setApprovalNotificationError] = useState('')
  const [approvalTarget, setApprovalTarget] = useState(null)
  const approvalRequestId = useRef(0)
  const approvalInFlight = useRef(null)
  const lastApprovalStart = useRef(0)
  // Permintaan sinkronisasi rute dari URL (refresh / Back-Forward).
  const [slaRouteRequest, setSlaRouteRequest] = useState(null)
  const [slaActiveModule, setSlaActiveModule] = useState('sla')
  const [slaVariableRejected, setSlaVariableRejected] = useState(0)
  const [finRouteRequest, setFinRouteRequest] = useState(null)
  const routeRestoredRef = useRef(false)
  const isSuperAdmin = authority?.actor?.is_super_admin === true
  const contractAccess = authority?.actor?.contract_access ?? []
  const organizationAccess = authority?.actor?.organization_access ?? []
  const MANAGEMENT_ROLES = ['TEAM_LEADER','MANAGER_UNIT','MANAGER_UP','ASMAN_OPERASI','ASMAN_KEUANGAN']
  const FINANCIAL_ROLES = ['TEAM_LEADER','MANAGER_UNIT','MANAGER_UP']
  const isManagementUserRaw = !isSuperAdmin && organizationAccess.some((a) => MANAGEMENT_ROLES.includes(a.organization_role))
  const hasAdminUp3Scope = contractAccess.some((access) =>
    access.role === 'ADMIN_UP3' && access.contract_code === 'pelayanan-teknik' && access.operational_up3_id,
  )
  const hasAdminUlpScope = contractAccess.some((access) =>
    access.role === 'ADMIN_ULP' && access.contract_code === 'pelayanan-teknik' && access.operational_up3_id,
  )
  const canViewAdminUp3Modules = isSuperAdmin || hasAdminUp3Scope || isManagementUserRaw
  const canViewReadOnlyMasterLocations = hasAdminUlpScope
  const customContractAccess = contractAccess.length === 1 && contractAccess[0]?.is_custom ? contractAccess[0] : null
  const customMenuAccess = customContractAccess?.menu_access ?? null
  const customCanView = (menu) => ['read', 'edit'].includes(customMenuAccess?.[menu] ?? 'none')
  const canViewVehicles = isSuperAdmin || hasAdminUp3Scope || hasAdminUlpScope || customCanView('alat_kendaraan')
  const slaPrimaryModules = useMemo(
    () => {
      if (customMenuAccess) {
        const allowed = {
          sla: customCanView('sla'),
          'variable-cost': customCanView('variable_cost'),
          lembur: customCanView('lembur'),
          'kendaraan-ulp': customCanView('alat_kendaraan'),
        }
        return pelayananTeknikModules.filter((module) => SLA_PRIMARY_MODULE_IDS.includes(module.id) && allowed[module.id])
      }
      return pelayananTeknikModules.filter(
        (module) => SLA_PRIMARY_MODULE_IDS.includes(module.id)
          && (module.id !== 'kendaraan-ulp' || canViewVehicles),
      )
    },
    [canViewVehicles, customMenuAccess],
  )
  const slaConfigurationModules = useMemo(() => {
    if (customMenuAccess) return []
    const modules = pelayananTeknikModules.filter((module) => (
      !SLA_PRIMARY_MODULE_IDS.includes(module.id)
      && (!module.adminOnly
        || canViewAdminUp3Modules
        || (module.id === 'master-lokasi' && canViewReadOnlyMasterLocations))
    ))
    if (canViewReadOnlyMasterLocations && !canViewAdminUp3Modules) {
      return [
        ...modules.filter((module) => module.id !== 'master-lokasi'),
        ...modules.filter((module) => module.id === 'master-lokasi'),
      ]
    }
    return modules
  }, [canViewAdminUp3Modules, canViewReadOnlyMasterLocations, customMenuAccess])
  const canAccessFinancial = isSuperAdmin || organizationAccess.some((a) => FINANCIAL_ROLES.includes(a.organization_role))
  const adminUp3Access = !isSuperAdmin && contractAccess.length === 1 && contractAccess[0]?.role === 'ADMIN_UP3'
    ? contractAccess[0]
    : null
  const adminUp3ScopeKey = adminUp3Access ? `${adminUp3Access.contract_id}:${adminUp3Access.operational_up3_id}` : null
  const managementScopeKey = managementScopes.length
    ? `management:${managementScopes.map((scope) => scope.key).sort().join('|')}`
    : null
  const effectiveApprovalAccess = adminUp3Access || managementScopes.length > 0
  const effectiveApprovalScopeKey = adminUp3ScopeKey || managementScopeKey
  const selectedManagementScope = managementScopes.find((scope) => scope.key === selectedManagementScopeKey)
    ?? managementScopes[0]
    ?? null

  const refreshApprovalNotifications = useCallback(async () => {
    // Gabungkan pemicu bersamaan (mount + fokus + ganti scope) ke satu request per scope.
    if (approvalInFlight.current && approvalInFlight.current.scopeKey === effectiveApprovalScopeKey) {
      return approvalInFlight.current.promise
    }
    const requestId = ++approvalRequestId.current
    if (!adminUp3Access && !managementScopes.length) {
      setApprovalNotifications(EMPTY_APPROVAL_NOTIFICATIONS)
      setApprovalNotificationError('')
      return
    }
    lastApprovalStart.current = Date.now()
    const promise = (async () => {
      try {
        const orgUnits = await getOrgUnits()
        const result = adminUp3Access
          ? await listAdminUp3ApprovalNotifications({
              contractId: adminUp3Access.contract_id,
              up3Id: adminUp3Access.operational_up3_id,
              units: orgUnits,
            })
          : await listManagementApprovalNotifications({ scopes: managementScopes, units: orgUnits })
        if (requestId !== approvalRequestId.current) return
        const scopedResult = { ...result, scopeKey: effectiveApprovalScopeKey }
        setApprovalNotifications((current) => current.scopeKey === effectiveApprovalScopeKey
          ? mergeApprovalNotifications(current, scopedResult)
          : scopedResult)
        setApprovalNotificationError('')
      } catch (error) {
        if (requestId !== approvalRequestId.current) return
        setApprovalNotificationError(error.message || 'Notifikasi persetujuan gagal dimuat.')
      } finally {
        if (approvalInFlight.current?.promise === promise) approvalInFlight.current = null
      }
    })()
    approvalInFlight.current = { scopeKey: effectiveApprovalScopeKey, promise }
    return promise
  }, [adminUp3Access?.contract_id, adminUp3Access?.operational_up3_id, effectiveApprovalScopeKey, managementScopes])

  useEffect(() => {
    refreshApprovalNotifications()
    return () => { approvalRequestId.current += 1 }
  }, [refreshApprovalNotifications])

  useEffect(() => {
    if (!effectiveApprovalAccess) return undefined
    // Throttle: fokus berulang dalam 2 menit memakai hasil/in-flight yang ada.
    const refreshOnFocus = () => {
      if (Date.now() - lastApprovalStart.current < 120000) return
      refreshApprovalNotifications()
    }
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [effectiveApprovalAccess, refreshApprovalNotifications])

  useEffect(() => {
    let cancelled = false
    setRealScopeLoaded(false)
    if (isSuperAdmin) {
      setRealScope(null)
      setRealScopeLoaded(true)
      return undefined
    }
    const access = contractAccess.length === 1 && (
      ['ADMIN_UP3', 'ADMIN_ULP'].includes(contractAccess[0]?.role)
      || contractAccess[0]?.is_custom === true
    )
      ? contractAccess[0]
      : null
    if (!access?.contract_code || !access.operational_up3_id ||
      ((access.role === 'ADMIN_ULP' || access.is_custom) && !access.operational_unit_id)) {
      setRealScope(null)
      setRealScopeLoaded(true)
      return undefined
    }
    getOrgUnits()
      .then((orgUnits) => {
        if (cancelled) return
        const up3 = orgUnits.find((unit) => unit.uuid === access.operational_up3_id && unit.type === 'UP3')
        const unit = access.role === 'ADMIN_UP3'
          ? up3
          : orgUnits.find(
            (entry) => entry.uuid === access.operational_unit_id && entry.type === 'ULP' && entry.parentUuid === up3?.uuid,
          )
        const contract = contracts.find((entry) => entry.id === access.contract_code)
        if (!up3?.legacyKey || !unit?.legacyKey || !contract) {
          setRealScope(null)
          setRealScopeLoaded(true)
          return
        }
        setRealScope({
          contractId: contract.id,
          up3Id: up3.legacyKey,
          unitId: unit.legacyKey,
          role: access.role === 'ADMIN_UP3' ? 'up3' : 'ulp',
        })
        setRealScopeLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setRealScope(null)
        setRealScopeLoaded(true)
      })
    return () => { cancelled = true }
  }, [isSuperAdmin, contractAccess])

  useEffect(() => {
    let cancelled = false
    setManagementScopesLoaded(false)
    if (!isManagementUserRaw) {
      setManagementScopes([])
      setSelectedManagementScopeKey('')
      setManagementScopesLoaded(true)
      return undefined
    }
    Promise.all([listManagementOperationalScopes(), getOrgUnits()])
      .then(([rows, orgUnits]) => {
        if (cancelled) return
        const scopeByKey = new Map()
        for (const row of rows) {
          const up3 = orgUnits.find((unit) => unit.uuid === row.operational_up3_id && unit.type === 'UP3')
          if (!up3?.legacyKey || row.contract_code !== 'pelayanan-teknik') continue
          const key = `${row.internal_ul_id}:${row.contract_id}:${row.operational_up3_id}`
          scopeByKey.set(key, {
            key,
            contractId: row.contract_id,
            contractCode: row.contract_code,
            up3Uuid: row.operational_up3_id,
            up3Id: up3.legacyKey,
            up3Name: up3.displayName ?? currentNameOf(units.find((unit) => unit.id === up3.legacyKey)),
            internalUlId: row.internal_ul_id,
            internalUlName: row.internal_ul_name,
            internalUpId: row.internal_up_id,
            internalUpName: row.internal_up_name,
            organizationRole: row.organization_role,
            childUlpCount: orgUnits.filter((unit) => unit.type === 'ULP' && unit.parentUuid === up3.uuid && unit.status === 'Aktif').length,
          })
        }
        const nextScopes = [...scopeByKey.values()]
        setManagementScopes(nextScopes)
        setSelectedManagementScopeKey((current) => nextScopes.some((scope) => scope.key === current)
          ? current
          : (nextScopes[0]?.key ?? ''))
        setManagementScopesLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setManagementScopes([])
        setSelectedManagementScopeKey('')
        setManagementScopesLoaded(true)
      })
    return () => { cancelled = true }
  }, [isManagementUserRaw])

  useEffect(() => {
    setManagementUnitId(selectedManagementScope?.up3Id ?? '')
  }, [selectedManagementScope?.key, selectedManagementScope?.up3Id])

  const isRealScopedUser = !isSuperAdmin && (realScope !== null || isManagementUserRaw)
  const isManagementUser = !isSuperAdmin && isManagementUserRaw
  const actualRole = selectedManagementScope ? 'up3' : isRealScopedUser && realScope ? realScope.role : role
  const actualUp3Id = selectedManagementScope ? selectedManagementScope.up3Id : isRealScopedUser && realScope ? realScope.up3Id : up3Id
  const actualUnitId = selectedManagementScope ? managementUnitId : isRealScopedUser && realScope ? realScope.unitId : unitId
  const authorizedContractIds = isSuperAdmin
    ? null
    : realScope
      ? [realScope.contractId]
      : selectedManagementScope
        ? [selectedManagementScope.contractCode]
        : []
  const isActiveContractAuthorized = !activeContractId || isSuperAdmin || authorizedContractIds.includes(activeContractId)

  useEffect(() => {
    if (currentPage === 'pengguna-akses' && !isSuperAdmin) setCurrentPage(null)
    else if (currentPage === 'analisis-finansial' && !canAccessFinancial) setCurrentPage(null)
    if (!isActiveContractAuthorized) setActiveContractId(null)
  }, [canAccessFinancial, currentPage, isActiveContractAuthorized, isSuperAdmin])

  // Terapkan rute dari URL hash ke state (dipakai saat refresh & Back/Forward).
  // Mengembalikan representasi kanonik untuk penulisan URL.
  const applyHashRoute = useCallback(() => {
    const { segments, periode } = parseRouteHash()
    const [first, second] = segments
    let nextContract = null
    let nextPage = null
    let nextModule = null
    let nextPeriode = null
    if (first === 'pengguna-akses' && isSuperAdmin) {
      nextPage = 'pengguna-akses'
    } else if (first === 'analisis-finansial' && canAccessFinancial) {
      nextPage = 'analisis-finansial'
      if (periode && slaPeriods.includes(periode)) nextPeriode = periode
    } else if (first) {
      const contract = contracts.find((entry) => entry.id === first)
      if (contract && (isSuperAdmin || authorizedContractIds.includes(contract.id))) {
        nextContract = contract.id
        if (contract.id === 'pelayanan-teknik') {
          if (second && pelayananTeknikModules.some((module) => module.id === second)) nextModule = second
          if (periode && slaPeriods.includes(periode)) nextPeriode = periode
        }
      }
    }
    setActiveContractId(nextContract)
    setCurrentPage(nextPage)
    setSlaActiveModule(nextContract === 'pelayanan-teknik' ? (nextModule ?? 'sla') : 'sla')
    if (nextContract === 'pelayanan-teknik') {
      setSlaRouteRequest({ module: nextModule, periode: nextPeriode, token: Date.now() })
    }
    if (nextPage === 'analisis-finansial' && nextPeriode) {
      setFinRouteRequest({ periode: nextPeriode, token: Date.now() })
    }
    return {
      segments: nextPage ? [nextPage] : nextContract ? [nextContract, ...(nextModule ? [nextModule] : [])] : [],
      periode: nextPeriode,
    }
  }, [isSuperAdmin, canAccessFinancial, authorizedContractIds])

  // Pulihkan posisi sekali setelah sesi, otoritas, DAN pemetaan scope
  // (Admin UP3/ULP, manajemen) siap; kanonikalisasi URL.
  useEffect(() => {
    if (routeRestoredRef.current) return
    if (!authority || authority.loading) return
    if (!realScopeLoaded || !managementScopesLoaded) return
    routeRestoredRef.current = true
    const canonical = applyHashRoute()
    writeRouteHash(canonical, { push: false })
  }, [authority, realScopeLoaded, managementScopesLoaded, applyHashRoute])

  // Back/Forward browser.
  useEffect(() => {
    const onHashChange = () => {
      if (!routeRestoredRef.current) return
      applyHashRoute()
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [applyHashRoute])

  const navigate = (contractId) => {
    if (contractId && !isSuperAdmin && !authorizedContractIds.includes(contractId)) return
    setActiveContractId(contractId)
    setCurrentPage(null)
    setSlaRouteRequest(null)
    setSlaActiveModule('sla')
    setSlaVariableRejected(0)
    setFinRouteRequest(null)
    writeRouteHash({ segments: contractId ? [contractId] : [], periode: null }, { push: true })
  }

  const navigatePage = (pageId) => {
    if (!pageId) {
      setCurrentPage(null)
      setActiveContractId(null)
      setSlaRouteRequest(null)
      setFinRouteRequest(null)
      writeRouteHash({ segments: [], periode: null }, { push: true })
      return
    }
    if (pageId === 'pengguna-akses' && !isSuperAdmin) return
    if (pageId === 'analisis-finansial' && !canAccessFinancial) return
    if (pageId !== 'pengguna-akses' && pageId !== 'analisis-finansial' && !isSuperAdmin) return
    setCurrentPage(pageId)
    setActiveContractId(null)
    setSlaActiveModule('sla')
    setSlaVariableRejected(0)
    if (pageId !== 'analisis-finansial') setFinRouteRequest(null)
    setSlaRouteRequest(null)
    writeRouteHash({ segments: [pageId], periode: null }, { push: true })
  }

  const openApprovalNotification = (item) => {
    if (!effectiveApprovalAccess) return
    if (item.managementScopeKey) setSelectedManagementScopeKey(item.managementScopeKey)
    const contractCode = adminUp3Access?.contract_code ?? 'pelayanan-teknik'
    setApprovalTarget({ ...item, token: `${item.source}:${item.id}:${Date.now()}` })
    setActiveContractId(contractCode)
    setCurrentPage(null)
    setSlaActiveModule('sla')
    setSlaRouteRequest(null)
    setFinRouteRequest(null)
    writeRouteHash({ segments: [contractCode], periode: null }, { push: true })
  }

  const handleRoleChange = (nextRole) => {
    if (isRealScopedUser) return
    setRole(nextRole)
    if (nextRole === 'ulp') {
      const staysUlp =
        units.some(
          (unit) => unit.id === unitId && unit.type === 'ULP' && unit.parentUnitId === up3Id,
        ) && activeUlps.some((unit) => unit.id === unitId)
      if (!staysUlp) setUnitId(activeUlps[0]?.id ?? '')
    } else {
      setUnitId(up3Id)
    }
  }

  const handleUp3Change = (nextUp3Id) => {
    if (isRealScopedUser) return
    setSelectedUp3Id(nextUp3Id)
    if (role === 'ulp') {
      const childUlps = units.filter(
        (unit) =>
          unit.type === 'ULP' &&
          unit.parentUnitId === nextUp3Id &&
          effectiveStatusOf(units, unit.id) === 'Aktif',
      )
      setUnitId(childUlps[0]?.id ?? '')
    } else {
      setUnitId(nextUp3Id)
    }
  }

  const handleUnitChange = (nextUnitId) => {
    if (selectedManagementScope) {
      setManagementUnitId(nextUnitId)
      return
    }
    if (!isRealScopedUser) setUnitId(nextUnitId)
  }

  const navigateSlaModule = (moduleId) => {
    if (!moduleId) return
    setCurrentPage(null)
    setActiveContractId('pelayanan-teknik')
    setSlaActiveModule(moduleId)
    setSlaRouteRequest({ module: moduleId, periode: null, token: Date.now() })
  }

  const activeContract = contracts.find((contract) =>
    contract.id === activeContractId && (isSuperAdmin || authorizedContractIds.includes(contract.id)),
  )
  const visibleApprovalNotifications = (adminUp3Access && isRealScopedUser && approvalNotifications.scopeKey === adminUp3ScopeKey) || (isManagementUser && approvalNotifications.scopeKey === managementScopeKey)
    ? approvalNotifications
    : null
  const slaApprovalCounts = Object.fromEntries(
    (visibleApprovalNotifications?.groups ?? []).map((group) => [group.id, group.count]),
  )
  const slaModuleBadges = {
    'variable-cost': (slaApprovalCounts.variable ?? 0) + slaVariableRejected,
    lembur: slaApprovalCounts.lembur ?? 0,
  }

  const preview = {
    role: actualRole,
    onRoleChange: handleRoleChange,
    unitId: actualUnitId,
    onUnitChange: handleUnitChange,
    up3Id: actualUp3Id,
    onUp3Change: handleUp3Change,
    units,
  }

  return (
    <SlaPreviewContext.Provider value={preview}>
      <AppLayout
        activeContractId={activeContractId}
        currentPage={currentPage}
        onNavigate={navigate}
        onNavigatePage={navigatePage}
        preview={preview}
        approvalNotifications={visibleApprovalNotifications}
        approvalNotificationError={approvalNotificationError}
        onRefreshApprovalNotifications={refreshApprovalNotifications}
        onOpenApprovalNotification={openApprovalNotification}
        slaPrimaryModules={slaPrimaryModules}
        slaConfigurationModules={slaConfigurationModules}
        slaActiveModule={slaActiveModule}
        slaModuleBadges={slaModuleBadges}
        onNavigateModule={navigateSlaModule}
      >
        {currentPage === 'pengguna-akses' ? (
          <UserListPage onBack={() => navigatePage(null)} />
        ) : currentPage === 'analisis-finansial' ? (
          <FinancialAnalysisPage
            initialPeriode={finRouteRequest?.periode ?? null}
            routeRequest={finRouteRequest}
            onRouteChange={({ periode }) => writeRouteHash({ segments: ['analisis-finansial'], periode }, { push: false })}
          />
        ) : activeContract ? (
          activeContract.id === 'pelayanan-teknik' ? (
            <SLAPelayananTeknikPage
              key={`${activeContractId}:${actualRole}:${actualUp3Id}:${actualUnitId}:${isManagementUser ? 'mgmt' : ''}`}
              contractId={activeContractId}
              onBack={() => navigate(null)}
              role={actualRole}
              onRoleChange={handleRoleChange}
              unitId={actualUnitId}
              onUnitChange={handleUnitChange}
              up3Id={actualUp3Id}
              units={units}
              onUnitsChange={setUnits}
              isRealScopedUser={isRealScopedUser}
              isManagementUser={isManagementUser}
              organizationAccess={organizationAccess}
              managementScopes={managementScopes}
              selectedManagementScopeKey={selectedManagementScope?.key ?? ''}
              onManagementScopeChange={setSelectedManagementScopeKey}
              approvalNotifications={visibleApprovalNotifications ?? EMPTY_APPROVAL_NOTIFICATIONS}
              approvalTarget={approvalTarget}
              onApprovalTargetHandled={() => setApprovalTarget(null)}
              onApprovalChange={refreshApprovalNotifications}
              initialModule={slaRouteRequest?.module ?? null}
              initialPeriode={slaRouteRequest?.periode ?? null}
              routeRequest={slaRouteRequest}
              customMenuAccess={customMenuAccess}
              onSlaVariableRejectedChange={setSlaVariableRejected}
              onRouteChange={({ module, periode }) => {
                setSlaActiveModule(module ?? 'sla')
                writeRouteHash(
                  { segments: ['pelayanan-teknik', ...(module && module !== 'sla' ? [module] : [])], periode },
                  { push: false },
                )
              }}
            />
          ) : (
            <ContractPage contract={activeContract} onBack={() => navigate(null)} />
          )
        ) : (
          <DashboardPage
            onSelectContract={navigate}
            authorizedContractIds={authorizedContractIds}
          />
        )}
      </AppLayout>
    </SlaPreviewContext.Provider>
  )
}
