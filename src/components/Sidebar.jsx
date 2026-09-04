import { useAuth } from '../lib/AppAuth.jsx'
import Icon from './Icon.jsx'

export default function Sidebar({ open, collapsed, onToggleCollapse, activeContractId, currentPage, onNavigate, onNavigatePage, onClose }) {
  const { authority } = useAuth()
  const isSuperAdmin = authority?.actor?.is_super_admin === true
  const allowedContractCodes = new Set(
    (authority?.actor?.contract_access ?? []).map((access) => access.contract_code),
  )
  const organizationAccess = authority?.actor?.organization_access ?? []
  const MANAGEMENT_ROLES = ['TEAM_LEADER','MANAGER_UNIT','MANAGER_UP','ASMAN_OPERASI','ASMAN_KEUANGAN']
  const FINANCIAL_ROLES = ['TEAM_LEADER','MANAGER_UNIT','MANAGER_UP']
  const isManagementUser = organizationAccess.some((a) => MANAGEMENT_ROLES.includes(a.organization_role))
  const canAccessFinancial = isSuperAdmin || organizationAccess.some((a) => FINANCIAL_ROLES.includes(a.organization_role))
  if (isManagementUser) allowedContractCodes.add('pelayanan-teknik')

  const pelayananTeknik = { id: 'pelayanan-teknik', title: 'Pelayanan Teknik', icon: 'operations' }
  const kontrakLain = [
    { id: 'billing-management', title: 'Billing Management', icon: 'billing' },
    { id: 'operator-gardu-induk', title: 'Operator Gardu Induk', icon: 'substation' },
    { id: 'ground-patrol', title: 'Ground Patrol', icon: 'patrol' },
  ]

  const showPelayananTeknik = isSuperAdmin || allowedContractCodes.has(pelayananTeknik.id)
  const kontrakLainFiltered = kontrakLain.filter((c) => isSuperAdmin || allowedContractCodes.has(c.id))
  const actorEmail = authority?.actor?.email ?? authority?.actor?.user_email ?? ''
  const actorLabel = isSuperAdmin ? 'Super Admin' : organizationAccess[0]?.organization_role?.replaceAll('_',' ') ?? allowedContractCodes.has('pelayanan-teknik') ? 'Manajemen' : 'Pengguna'

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-brand">
        <span className="sidebar-logo-frame">
          <img src="/logo-pln-nusa-daya.png" alt="PLN Nusa Daya" className="sidebar-logo" />
        </span>
        <button type="button" className="sidebar-collapse-btn" onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand' : 'Collapse'}>
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={16} />
        </button>
        <button type="button" className="sidebar-close" onClick={onClose} aria-label="Tutup menu"><Icon name="close" size={20} /></button>
      </div>
      <nav className="sidebar-nav">
        <button
          type="button"
          className={`nav-item ${activeContractId === null && currentPage === null ? 'nav-item-active' : ''}`}
          onClick={() => onNavigate(null)}
        >
          <span className="nav-icon"><Icon name="dashboard" /></span>
          <span className="nav-item-label">Dashboard</span>
        </button>

        {canAccessFinancial && (
          <>
            <div className="nav-section-title nav-section-financial">
              <span>Analisis Finansial</span>
              {!collapsed && <span className="nav-section-badge"><Icon name="shield" size={10} /> Akses: TL Manager - MUP</span>}
            </div>
            <button
              type="button"
              className={`nav-item nav-item-financial ${currentPage === 'analisis-finansial' ? 'nav-item-active' : ''}`}
              onClick={() => onNavigatePage('analisis-finansial')}
            >
              <span className="nav-icon"><Icon name="chart-bar" /></span>
              <span className="nav-item-label">Dashboard Finansial</span>
            </button>
            <button type="button" className="nav-item nav-item-coming" title="Segera hadir" disabled aria-disabled="true">
              <span className="nav-icon"><Icon name="trend-up" size={16} /></span>
              <span className="nav-item-label">Pendapatan</span>
              <span className="nav-coming">Soon</span>
            </button>
            <button type="button" className="nav-item nav-item-coming" title="Segera hadir" disabled aria-disabled="true">
              <span className="nav-icon"><Icon name="wallet" size={16} /></span>
              <span className="nav-item-label">Biaya</span>
              <span className="nav-coming">Soon</span>
            </button>
            <button type="button" className="nav-item nav-item-coming" title="Segera hadir" disabled aria-disabled="true">
              <span className="nav-icon"><Icon name="pie-chart" size={16} /></span>
              <span className="nav-item-label">Realisasi vs Target</span>
              <span className="nav-coming">Soon</span>
            </button>
            <button type="button" className="nav-item nav-item-coming" title="Segera hadir" disabled aria-disabled="true">
              <span className="nav-icon"><Icon name="layers" size={16} /></span>
              <span className="nav-item-label">Perbandingan Unit</span>
              <span className="nav-coming">Soon</span>
            </button>
          </>
        )}

        {showPelayananTeknik && (
          <>
            <div className="nav-section-title">Operasional</div>
            <button
              type="button"
              className={`nav-item ${activeContractId === pelayananTeknik.id ? 'nav-item-active' : ''}`}
              onClick={() => onNavigate(pelayananTeknik.id)}
            >
              <span className="nav-icon"><Icon name={pelayananTeknik.icon} /></span>
              <span className="nav-item-label">{pelayananTeknik.title}</span>
            </button>
          </>
        )}

        {kontrakLainFiltered.length > 0 && (
          <>
            <div className="nav-section-title">Kontrak Lain</div>
            {kontrakLainFiltered.map((contract) => (
              <button
                key={contract.id}
                type="button"
                className={`nav-item ${activeContractId === contract.id ? 'nav-item-active' : ''}`}
                onClick={() => onNavigate(contract.id)}
              >
                <span className="nav-icon"><Icon name={contract.icon} /></span>
                <span className="nav-item-label">{contract.title}</span>
              </button>
            ))}
          </>
        )}

        <div className="nav-section-title">Master Data</div>
        <div className="nav-item nav-item-disabled" title="Kelola via Pelayanan Teknik">
          <span className="nav-icon"><Icon name="layers" /></span>
          <span className="nav-item-label">Komponen &amp; Unit</span>
        </div>

        {isSuperAdmin && (
          <>
            <div className="nav-section-title">Pengguna &amp; Akses</div>
            <button
              type="button"
              className={`nav-item ${currentPage === 'pengguna-akses' ? 'nav-item-active' : ''}`}
              onClick={() => onNavigatePage('pengguna-akses')}
            >
              <span className="nav-icon"><Icon name="users" /></span>
              <span className="nav-item-label">Pengguna &amp; Akses</span>
            </button>
          </>
        )}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span className="sidebar-user-avatar">{(actorLabel[0] ?? 'U').toUpperCase()}</span>
          <span className="sidebar-user-meta">
            <strong>{actorLabel}</strong>
            <small>{actorEmail || (isSuperAdmin ? 'super.admin@pln.co.id' : 'Akses terverifikasi')}</small>
          </span>
        </div>
      </div>
    </aside>
  )
}
