import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AppAuth.jsx'
import Icon from './Icon.jsx'

export default function Sidebar({ open, collapsed, onToggleCollapse, activeContractId, currentPage, onNavigate, onNavigatePage, onNavigateModule, slaPrimaryModules = [], slaConfigurationModules = [], slaActiveModule = 'sla', slaModuleBadges = {}, previewActive = false, previewLabel = '', onClose }) {
  const { authority } = useAuth()
  const isSuperAdmin = authority?.actor?.is_super_admin === true
  const allowedContractCodes = new Set(
    (authority?.actor?.contract_access ?? []).map((access) => access.contract_code),
  )
  const organizationAccess = authority?.actor?.organization_access ?? []
  const MANAGEMENT_ROLES = ['TEAM_LEADER','MANAGER_UNIT','MANAGER_UP','ASMAN_OPERASI','ASMAN_KEUANGAN']
  const FINANCIAL_ROLES = ['TEAM_LEADER','MANAGER_UNIT','MANAGER_UP']
  const isManagementUser = organizationAccess.some((a) => MANAGEMENT_ROLES.includes(a.organization_role))
  const canAccessFinancial = !previewActive && (isSuperAdmin || organizationAccess.some((a) => FINANCIAL_ROLES.includes(a.organization_role)))
  if (isManagementUser) allowedContractCodes.add('pelayanan-teknik')

  const pelayananTeknik = { id: 'pelayanan-teknik', title: 'Pelayanan Teknik', icon: 'operations' }
  const kontrakLain = [
    { id: 'billing-management', title: 'Billing Management', icon: 'billing' },
    { id: 'operator-gardu-induk', title: 'Operator Gardu Induk', icon: 'substation' },
    { id: 'ground-patrol', title: 'Ground Patrol', icon: 'patrol' },
  ]

  const showPelayananTeknik = previewActive || isSuperAdmin || allowedContractCodes.has(pelayananTeknik.id)
  const kontrakLainFiltered = kontrakLain.filter((c) => !previewActive && (isSuperAdmin || allowedContractCodes.has(c.id)))
  const actorEmail = authority?.actor?.email ?? authority?.actor?.user_email ?? ''
  const customRoleLabel = authority?.actor?.custom_role?.display_name
  const actorLabel = previewActive
    ? (previewLabel || 'Pratinjau')
    : isSuperAdmin ? 'Super Admin' : customRoleLabel ?? organizationAccess[0]?.organization_role?.replaceAll('_',' ') ?? allowedContractCodes.has('pelayanan-teknik') ? 'Manajemen' : 'Pengguna'

  const [pelayananOpen, setPelayananOpen] = useState(activeContractId === pelayananTeknik.id)
  const [masterOpen, setMasterOpen] = useState(false)
  useEffect(() => {
    if (activeContractId === pelayananTeknik.id) setPelayananOpen(true)
  }, [activeContractId])
  useEffect(() => {
    if (activeContractId === pelayananTeknik.id
      && slaConfigurationModules.some((module) => module.id === slaActiveModule)) {
      setMasterOpen(true)
    }
  }, [activeContractId, slaActiveModule, slaConfigurationModules])

  const handlePelayananClick = () => {
    if (collapsed) {
      onNavigate(pelayananTeknik.id)
      return
    }
    if (!pelayananOpen) {
      setPelayananOpen(true)
      if (activeContractId !== pelayananTeknik.id) onNavigate(pelayananTeknik.id)
    } else {
      setPelayananOpen(false)
    }
  }

  const handleMasterClick = () => {
    if (collapsed) {
      const first = slaConfigurationModules[0]
      if (first) onNavigateModule?.(first.id)
      return
    }
    setMasterOpen((value) => !value)
  }

  const renderSlaSubmenu = (modules, id) => (
    <div className="nav-submenu" id={id}>
      {modules.map((module) => {
        const active = activeContractId === pelayananTeknik.id && slaActiveModule === module.id
        const badge = slaModuleBadges[module.id] ?? 0
        return (
          <button
            key={module.id}
            type="button"
            className={`nav-submenu-item ${active ? 'nav-submenu-item-active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigateModule?.(module.id)}
          >
            <span className="nav-submenu-dot" aria-hidden="true" />
            <span className="nav-submenu-label">{module.name}</span>
            {badge > 0 && <span className="nav-count-badge">{badge}</span>}
          </button>
        )
      })}
    </div>
  )
  const masterGroupActive = activeContractId === pelayananTeknik.id
    && slaConfigurationModules.some((module) => module.id === slaActiveModule)

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-brand">
        <span className="sidebar-logo-frame">
          <img src="/plns%20PNG.png" alt="PLN Services" className="sidebar-logo" />
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
              {!collapsed && <span className="nav-section-badge"><Icon name="shield" size={10} /> Akses Manajemen</span>}
            </div>
            <button
              type="button"
              className={`nav-item nav-item-financial ${currentPage === 'analisis-finansial' ? 'nav-item-active' : ''}`}
              onClick={() => onNavigatePage('analisis-finansial')}
            >
              <span className="nav-icon"><Icon name="chart-bar" /></span>
              <span className="nav-item-label">Dashboard Finansial</span>
            </button>
          </>
        )}

        {showPelayananTeknik && (
          <>
            <div className="nav-section-title">Operasional</div>
            <button
              type="button"
              className={`nav-item nav-item-parent ${activeContractId === pelayananTeknik.id ? 'nav-item-group-active' : ''}`}
              aria-expanded={pelayananOpen}
              aria-controls="nav-submenu-pelayanan-teknik"
              onClick={handlePelayananClick}
            >
              <span className="nav-icon"><Icon name={pelayananTeknik.icon} /></span>
              <span className="nav-item-label">{pelayananTeknik.title}</span>
              <span className={`nav-chevron ${pelayananOpen && !collapsed ? 'is-open' : ''}`} aria-hidden="true">
                <Icon name="chevron-right" size={13} />
              </span>
            </button>
            {pelayananOpen && !collapsed && renderSlaSubmenu(slaPrimaryModules, 'nav-submenu-pelayanan-teknik')}
            {slaConfigurationModules.length > 0 && (
              <>
                <button
                  type="button"
                  className={`nav-item nav-item-parent ${masterGroupActive ? 'nav-item-group-active' : ''}`}
                  aria-expanded={masterOpen}
                  aria-controls="nav-submenu-master-pengaturan"
                  onClick={handleMasterClick}
                >
                  <span className="nav-icon"><Icon name="layers" /></span>
                  <span className="nav-item-label">Master &amp; Pengaturan</span>
                  <span className={`nav-chevron ${masterOpen && !collapsed ? 'is-open' : ''}`} aria-hidden="true">
                    <Icon name="chevron-right" size={13} />
                  </span>
                </button>
                {masterOpen && !collapsed && renderSlaSubmenu(slaConfigurationModules, 'nav-submenu-master-pengaturan')}
              </>
            )}
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

        {isSuperAdmin && !previewActive && (
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
