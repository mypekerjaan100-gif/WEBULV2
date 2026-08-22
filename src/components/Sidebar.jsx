import { useAuth } from '../lib/AppAuth.jsx'
import { callUserManagement } from '../lib/userManagement.js'
import { useState, useEffect } from 'react'

export default function Sidebar({ open, activeContractId, currentPage, onNavigate, onNavigatePage, onClose }) {
  const { user } = useAuth()
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  useEffect(() => {
    if (!user) {
      setIsSuperAdmin(false)
      return
    }
    let cancelled = false
    callUserManagement('capabilities')
      .then(({ data }) => {
        if (!cancelled) setIsSuperAdmin(!!data?.actor?.is_super_admin)
      })
      .catch(() => {
        if (!cancelled) setIsSuperAdmin(false)
      })
    return () => { cancelled = true }
  }, [user])

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-title">SKW Reporting</div>
        <div className="sidebar-brand-subtitle">Sistem Pelaporan Pekerjaan Kantor</div>
        <button
          type="button"
          className="sidebar-close"
          onClick={onClose}
          aria-label="Tutup menu"
        >
          &times;
        </button>
      </div>
      <nav className="sidebar-nav">
        <button
          type="button"
          className={`nav-item ${activeContractId === null && currentPage === null ? 'nav-item-active' : ''}`}
          onClick={() => onNavigate(null)}
        >
          <span className="nav-icon" aria-hidden="true">
            &#9632;
          </span>
          Dashboard
        </button>
        <div className="nav-section-title">Kontrak</div>
        {[
          { id: 'pelayanan-teknik', title: 'Pelayanan Teknik', icon: '\u2692' },
          { id: 'billing-management', title: 'Billing Management', icon: '\u2740' },
          { id: 'operator-gardu-induk', title: 'Operator Gardu Induk', icon: '\u26A1' },
          { id: 'ground-patrol', title: 'Ground Patrol', icon: '\u231A' },
        ].map((contract) => (
          <button
            key={contract.id}
            type="button"
            className={`nav-item ${activeContractId === contract.id ? 'nav-item-active' : ''}`}
            onClick={() => onNavigate(contract.id)}
          >
            <span className="nav-icon" aria-hidden="true">
              {contract.icon}
            </span>
            {contract.title}
          </button>
        ))}
        {isSuperAdmin && (
          <>
            <div className="nav-section-title">Manajemen</div>
            <button
              type="button"
              className={`nav-item ${currentPage === 'pengguna-akses' ? 'nav-item-active' : ''}`}
              onClick={() => onNavigatePage('pengguna-akses')}
            >
              <span className="nav-icon" aria-hidden="true">
                &#128100;
              </span>
              Pengguna &amp; Akses
            </button>
          </>
        )}
      </nav>
    </aside>
  )
}
