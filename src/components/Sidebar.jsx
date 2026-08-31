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
  const isManagementUser = organizationAccess.some((a) => MANAGEMENT_ROLES.includes(a.organization_role))
  if (isManagementUser) allowedContractCodes.add('pelayanan-teknik')

  const pelayananTeknik = { id: 'pelayanan-teknik', title: 'Pelayanan Teknik', icon: 'operations' }
  const kontrakLain = [
    { id: 'billing-management', title: 'Billing Management', icon: 'billing' },
    { id: 'operator-gardu-induk', title: 'Operator Gardu Induk', icon: 'substation' },
    { id: 'ground-patrol', title: 'Ground Patrol', icon: 'patrol' },
  ]

  const showPelayananTeknik = isSuperAdmin || allowedContractCodes.has(pelayananTeknik.id)
  const kontrakLainFiltered = kontrakLain.filter((c) => isSuperAdmin || allowedContractCodes.has(c.id))

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
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

        {showPelayananTeknik && (
          <>
            <div className="nav-section-title">Pelayanan Teknik</div>
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

        {isSuperAdmin && (
          <>
            <div className="nav-section-title">Manajemen</div>
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
    </aside>
  )
}
