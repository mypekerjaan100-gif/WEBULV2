import { useEffect, useState } from 'react'
import FinancialComparisonDashboard from '../components/sla/FinancialComparisonDashboard.jsx'
import { slaPeriods } from '../data/slaPelayananTeknik.js'
import { getOrganizationScope } from '../data/orgIdMap.js'
import { useAuth } from '../lib/AppAuth.jsx'
import { useSlaPreview } from '../context/SlaPreviewContext.js'

export default function FinancialAnalysisPage() {
  const { authority } = useAuth()
  const preview = useSlaPreview()
  const actor = authority?.actor
  const isSuperAdmin = actor?.is_super_admin === true
  const orgAccess = actor?.organization_access ?? []
  const FINANCIAL_ROLES = ['TEAM_LEADER', 'MANAGER_UNIT', 'MANAGER_UP']
  const canAccess = isSuperAdmin || orgAccess.some((a) => FINANCIAL_ROLES.includes(a.organization_role))

  const [period, setPeriod] = useState('Agustus 2026')
  const [orgMap, setOrgMap] = useState(null)
  const [orgMapError, setOrgMapError] = useState('')
  const up3Id = preview?.up3Id ?? 'up3'

  useEffect(() => {
    if (!canAccess) return
    let cancelled = false
    setOrgMapError('')
    setOrgMap(null)
    getOrganizationScope({ up3Id, contractCode: 'pelayanan-teknik' })
      .then((scope) => { if (!cancelled) setOrgMap(scope) })
      .catch((e) => { if (!cancelled) setOrgMapError(e.message || 'Gagal memuat scope finansial.') })
    return () => { cancelled = true }
  }, [canAccess, up3Id])

  if (!canAccess) {
    return (
      <div className="page fin-analysis-page">
        <div className="ui-state-panel ui-state-error" role="alert">
          <strong>Akses dibatasi</strong>
          <div className="ui-state-content">Halaman Analisis Finansial hanya tersedia untuk TL, Manager, dan MUP.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page fin-analysis-page">
      <header className="fin-analysis-header">
        <div>
          <div className="fin-analysis-title-row">
            <h1 className="page-title">Dashboard Finansial</h1>
            <span className="fin-analysis-badge" title="Perbandingan akumulasi pendapatan terpilih terhadap biaya terpilih">i</span>
          </div>
          <p className="page-description">Perbandingan akumulasi pendapatan terpilih terhadap akumulasi biaya terpilih.</p>
        </div>
      </header>

      <div className="fin-analysis-body">
        {!orgMap && !orgMapError && (
          <div className="ui-state-panel ui-state-loading" role="status"><strong>Memuat Dashboard Finansial</strong></div>
        )}
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
      </div>
    </div>
  )
}
