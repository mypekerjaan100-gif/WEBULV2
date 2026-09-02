import { useEffect, useState } from 'react'
import { contracts } from '../data/contracts.js'
import ContractCard from '../components/ContractCard.jsx'
import FinancialComparisonDashboard from '../components/sla/FinancialComparisonDashboard.jsx'
import { slaPeriods } from '../data/slaPelayananTeknik.js'
import { getOrganizationScope } from '../data/orgIdMap.js'
import { useAuth } from '../lib/AppAuth.jsx'
import { useSlaPreview } from '../context/SlaPreviewContext.js'

export default function DashboardPage({ onSelectContract, authorizedContractIds }) {
  const visibleContracts = authorizedContractIds === null
    ? contracts
    : contracts.filter((contract) => authorizedContractIds.includes(contract.id))
  const { authority } = useAuth()
  const preview = useSlaPreview()
  const actor = authority?.actor
  const isSuperAdmin = actor?.is_super_admin === true
  const contractAccess = actor?.contract_access ?? []
  const orgAccess = actor?.organization_access ?? []
  const isAdminUlp = contractAccess.some((a) => a.role === 'ADMIN_ULP')
  const MANAGEMENT_ROLES = ['TEAM_LEADER','MANAGER_UNIT','MANAGER_UP','ASMAN_OPERASI','ASMAN_KEUANGAN']
  const isManagement = orgAccess.some((a) => MANAGEMENT_ROLES.includes(a.organization_role))
  const isAdminUp3 = contractAccess.some((a) => a.role === 'ADMIN_UP3')
  const canViewFinancial = isSuperAdmin || isAdminUp3 || isManagement
  const [period, setPeriod] = useState('Agustus 2026')
  const [orgMap, setOrgMap] = useState(null)
  const [orgMapError, setOrgMapError] = useState('')
  const up3Id = preview?.up3Id ?? 'up3'
  const units = preview?.units ?? []

  useEffect(() => {
    if (!canViewFinancial) return
    let cancelled = false
    setOrgMapError('')
    getOrganizationScope({ up3Id, contractCode: 'pelayanan-teknik' })
      .then((scope) => { if (!cancelled) setOrgMap(scope) })
      .catch((e) => { if (!cancelled) setOrgMapError(e.message || 'Gagal memuat scope finansial.') })
    return () => { cancelled = true }
  }, [canViewFinancial, up3Id])

  return (
    <div className="page dashboard-page">
      <header className="dashboard-page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-description">
          Pilih kontrak untuk mengakses modul pelaporan dan monitoring pekerjaan.
        </p>
      </header>
      <section className="contract-grid">
        {visibleContracts.map((contract) => (
          <ContractCard
            key={contract.id}
            contract={contract}
            onSelect={onSelectContract}
          />
        ))}
      </section>

      {canViewFinancial ? (
        <section className="dashboard-fincomp-wrap" style={{ marginTop: 28 }}>
          {!orgMap && !orgMapError && <div className="ui-state-panel ui-state-loading" role="status"><strong>Memuat Financial Comparison</strong></div>}
          {orgMapError && <div className="ui-alert ui-alert-danger" role="alert">{orgMapError}</div>}
          {orgMap && (
            <FinancialComparisonDashboard
              contractId="pelayanan-teknik"
              up3Id={up3Id}
              period={period}
              periods={slaPeriods}
              onPeriodChange={setPeriod}
              units={orgMap.units}
              orgMap={orgMap}
            />
          )}
        </section>
      ) : isAdminUlp ? (
        <section className="dashboard-fincomp-wrap" style={{ marginTop: 28 }}>
          <div className="ui-alert ui-alert-info" role="status">Dashboard Financial Comparison tidak tersedia untuk peran Admin ULP - Data tersinkron.</div>
        </section>
      ) : null}
    </div>
  )
}
