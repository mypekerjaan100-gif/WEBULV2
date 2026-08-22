import { useEffect, useState } from 'react'
import AppLayout from './layout/AppLayout.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ContractPage from './pages/ContractPage.jsx'
import SLAPelayananTeknikPage from './pages/sla/SLAPelayananTeknikPage.jsx'
import UserListPage from './pages/user-management/UserListPage.jsx'
import { SlaPreviewContext } from './context/SlaPreviewContext.js'
import {
  effectiveStatusOf,
  initialOrganizationUnits,
} from './data/organisasiPelayananTeknik.js'
import { contracts } from './data/contracts.js'
import { getOrgUnits } from './data/orgIdMap.js'
import { useAuth } from './lib/AppAuth.jsx'

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
  const isSuperAdmin = authority?.actor?.is_super_admin === true
  const contractAccess = authority?.actor?.contract_access ?? []

  useEffect(() => {
    let cancelled = false
    if (isSuperAdmin) {
      setRealScope(null)
      return undefined
    }
    const access = contractAccess.length === 1 && contractAccess[0]?.role === 'ADMIN_ULP'
      ? contractAccess[0]
      : null
    if (!access?.contract_code || !access.operational_up3_id || !access.operational_unit_id) {
      setRealScope(null)
      return undefined
    }
    getOrgUnits()
      .then((orgUnits) => {
        if (cancelled) return
        const up3 = orgUnits.find((unit) => unit.uuid === access.operational_up3_id && unit.type === 'UP3')
        const unit = orgUnits.find(
          (entry) => entry.uuid === access.operational_unit_id && entry.type === 'ULP' && entry.parentUuid === up3?.uuid,
        )
        const contract = contracts.find((entry) => entry.id === access.contract_code)
        if (!up3?.legacyKey || !unit?.legacyKey || !contract) {
          setRealScope(null)
          return
        }
        setRealScope({ contractId: contract.id, up3Id: up3.legacyKey, unitId: unit.legacyKey })
      })
      .catch(() => {
        if (!cancelled) setRealScope(null)
      })
    return () => { cancelled = true }
  }, [isSuperAdmin, contractAccess])

  const isRealScopedUser = !isSuperAdmin && realScope !== null
  const actualRole = isRealScopedUser ? 'ulp' : role
  const actualUp3Id = isRealScopedUser ? realScope.up3Id : up3Id
  const actualUnitId = isRealScopedUser ? realScope.unitId : unitId
  const authorizedContractIds = isSuperAdmin
    ? null
    : realScope
      ? [realScope.contractId]
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

  const activeContract = contracts.find((contract) =>
    contract.id === activeContractId && (isSuperAdmin || authorizedContractIds.includes(contract.id)),
  )

  const preview = {
    role: actualRole,
    onRoleChange: handleRoleChange,
    unitId: actualUnitId,
    onUnitChange: isRealScopedUser ? () => {} : setUnitId,
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
      >
        {currentPage === 'pengguna-akses' ? (
          <UserListPage onBack={() => navigatePage(null)} />
        ) : activeContract ? (
          activeContract.id === 'pelayanan-teknik' ? (
            <SLAPelayananTeknikPage
              key={`${activeContractId}:${actualRole}:${actualUp3Id}:${actualUnitId}`}
              contractId={activeContractId}
              onBack={() => navigate(null)}
              role={actualRole}
              onRoleChange={handleRoleChange}
              unitId={actualUnitId}
              onUnitChange={isRealScopedUser ? () => {} : setUnitId}
              up3Id={actualUp3Id}
              units={units}
              onUnitsChange={setUnits}
              isRealScopedUser={isRealScopedUser}
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
