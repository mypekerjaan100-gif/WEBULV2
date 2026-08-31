import { useAuth } from '../lib/AppAuth.jsx'

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

  const pelayananTeknik = { id: 'pelayanan-teknik', title: 'Pelayanan Teknik', icon: '\u2699' }
  const kontrakLain = [
    { id: 'billing-management', title: 'Billing Management', icon: '\u25A3' },
    { id: 'operator-gardu-induk', title: 'Operator Gardu Induk', icon: '\u26A1' },
    { id: 'ground-patrol', title: 'Ground Patrol', icon: '\u2316' },
  ]

  const showPelayananTeknik = isSuperAdmin || allowedContractCodes.has(pelayananTeknik.id)
  const kontrakLainFiltered = kontrakLain.filter((c) => isSuperAdmin || allowedContractCodes.has(c.id))

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand">
        <img src="/logo-pln-nusa-daya.png" alt="PLN Nusa Daya" className="sidebar-logo" />
        <button type="button" className="sidebar-collapse-btn" onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '\u00BB' : '\u00AB'}
        </button>
        <button type="button" className="sidebar-close" onClick={onClose} aria-label="Tutup menu">&times;</button>
      </div>
      <nav className="sidebar-nav">
        <button
          type="button"
          className={`nav-item ${activeContractId === null && currentPage === null ? 'nav-item-active' : ''}`}
          onClick={() => onNavigate(null)}
        >
          <span className="nav-icon" aria-hidden="true">&#9632;</span>
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
              <span className="nav-icon" aria-hidden="true">{pelayananTeknik.icon}</span>
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
                <span className="nav-icon" aria-hidden="true">{contract.icon}</span>
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
              <span className="nav-icon" aria-hidden="true">&#9823;</span>
              <span className="nav-item-label">Pengguna &amp; Akses</span>
            </button>
          </>
        )}
      </nav>
    </aside>
  )
}
