import { useCallback, useEffect, useRef, useState } from 'react'
import AppLayout from './layout/AppLayout.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ContractPage from './pages/ContractPage.jsx'
import SLAPelayananTeknikPage from './pages/sla/SLAPelayananTeknikPage.jsx'
import UserListPage from './pages/user-management/UserListPage.jsx'
import { SlaPreviewContext } from './context/SlaPreviewContext.js'
import {
  currentNameOf,
  effectiveStatusOf,
  initialOrganizationUnits,
} from './data/organisasiPelayananTeknik.js'
import { contracts } from './data/contracts.js'
import { getOrgUnits } from './data/orgIdMap.js'
import { useAuth } from './lib/AppAuth.jsx'
import {
  listAdminUp3ApprovalNotifications,
  listManagementApprovalNotifications,
} from './data/approvalNotificationRepository.js'
import { listManagementOperationalScopes } from './data/managementScopeRepository.js'

const EMPTY_APPROVAL_NOTIFICATIONS = { scopeKey: null, count: 0, groups: [] }

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
  const [approvalNotifications, setApprovalNotifications] = useState(EMPTY_APPROVAL_NOTIFICATIONS)
  const [approvalNotificationError, setApprovalNotificationError] = useState('')
  const [approvalTarget, setApprovalTarget] = useState(null)
  const approvalRequestId = useRef(0)
  const isSuperAdmin = authority?.actor?.is_super_admin === true
  const contractAccess = authority?.actor?.contract_access ?? []
  const organizationAccess = authority?.actor?.organization_access ?? []
  const MANAGEMENT_ROLES = ['TEAM_LEADER','MANAGER_UNIT','MANAGER_UP','ASMAN_OPERASI','ASMAN_KEUANGAN']
  const isManagementUserRaw = !isSuperAdmin && organizationAccess.some((a) => MANAGEMENT_ROLES.includes(a.organization_role))
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
    const requestId = ++approvalRequestId.current
    if (!adminUp3Access && !managementScopes.length) {
      setApprovalNotifications(EMPTY_APPROVAL_NOTIFICATIONS)
      setApprovalNotificationError('')
      return
    }
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
    }
  }, [adminUp3Access?.contract_id, adminUp3Access?.operational_up3_id, effectiveApprovalScopeKey, managementScopes])

  useEffect(() => {
    refreshApprovalNotifications()
    return () => { approvalRequestId.current += 1 }
  }, [refreshApprovalNotifications])

  useEffect(() => {
    if (!effectiveApprovalAccess) return undefined
    const refreshOnFocus = () => refreshApprovalNotifications()
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [effectiveApprovalAccess, refreshApprovalNotifications])

  useEffect(() => {
    let cancelled = false
    if (isSuperAdmin) {
      setRealScope(null)
      return undefined
    }
    const access = contractAccess.length === 1 && ['ADMIN_UP3', 'ADMIN_ULP'].includes(contractAccess[0]?.role)
      ? contractAccess[0]
      : null
    if (!access?.contract_code || !access.operational_up3_id ||
      (access.role === 'ADMIN_ULP' && !access.operational_unit_id)) {
      setRealScope(null)
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
          return
        }
        setRealScope({
          contractId: contract.id,
          up3Id: up3.legacyKey,
          unitId: unit.legacyKey,
          role: access.role === 'ADMIN_UP3' ? 'up3' : 'ulp',
        })
      })
      .catch(() => {
        if (!cancelled) setRealScope(null)
      })
    return () => { cancelled = true }
  }, [isSuperAdmin, contractAccess])

  useEffect(() => {
    let cancelled = false
    if (!isManagementUserRaw) {
      setManagementScopes([])
      setSelectedManagementScopeKey('')
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
      })
      .catch(() => {
        if (!cancelled) {
          setManagementScopes([])
          setSelectedManagementScopeKey('')
        }
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

  const navigate = (contractId) => {
    if (contractId && !isSuperAdmin && !authorizedContractIds.includes(contractId)) return
    setActiveContractId(contractId)
    setCurrentPage(null)
  }

  const navigatePage = (pageId) => {
    if (pageId && !isSuperAdmin) return
    setCurrentPage(pageId)
    setActiveContractId(null)
  }

  const openApprovalNotification = (item) => {
    if (!effectiveApprovalAccess) return
    if (item.managementScopeKey) setSelectedManagementScopeKey(item.managementScopeKey)
    const contractCode = adminUp3Access?.contract_code ?? 'pelayanan-teknik'
    setApprovalTarget({ ...item, token: `${item.source}:${item.id}:${Date.now()}` })
    setActiveContractId(contractCode)
    setCurrentPage(null)
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

  const activeContract = contracts.find((contract) =>
    contract.id === activeContractId && (isSuperAdmin || authorizedContractIds.includes(contract.id)),
  )
  const visibleApprovalNotifications = (adminUp3Access && isRealScopedUser && approvalNotifications.scopeKey === adminUp3ScopeKey) || (isManagementUser && approvalNotifications.scopeKey === managementScopeKey)
    ? approvalNotifications
    : null

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
      >
        {currentPage === 'pengguna-akses' ? (
          <UserListPage onBack={() => navigatePage(null)} />
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
