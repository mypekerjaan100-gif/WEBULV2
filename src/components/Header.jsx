import { useState } from 'react'
import { contracts, siteTitle } from '../data/contracts.js'
import SlaPreviewBar from './sla/SlaPreviewBar.jsx'
import { useAuth } from '../lib/AppAuth.jsx'

const PAGE_TITLES = {
  'pengguna-akses': 'Pengguna & Akses',
}

export default function Header({ activeContractId, currentPage, onOpenSidebar, preview }) {
  const { authority, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const isSuperAdmin = authority?.actor?.is_super_admin === true
  const loginRole = isSuperAdmin
    ? 'SUPER_ADMIN'
    : authority?.actor?.contract_access?.[0]?.role ?? 'Akses terverifikasi'
  const activeContract = contracts.find(
    (contract) => contract.id === activeContractId,
  )

  const title = currentPage
    ? (PAGE_TITLES[currentPage] || currentPage)
    : activeContract
      ? activeContract.title
      : 'Dashboard'

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    setSigningOut(false)
  }

  return (
    <header className="header">
      <button
        type="button"
        className="header-menu-button"
        onClick={onOpenSidebar}
        aria-label="Buka menu"
      >
        &#9776;
      </button>
      <div className="header-title">
        <span className="header-title-main">{title}</span>
        <span className="header-title-sub">{siteTitle}</span>
      </div>
      <div className="header-right">
        <span className="header-login-status">
          Login: {loginRole}
        </span>
        {isSuperAdmin && preview && <SlaPreviewBar preview={preview} />}
        <button
          type="button"
          className="header-logout-button"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? 'Keluar...' : 'Keluar'}
        </button>
        <div className="header-placeholder" style={{ display: 'none' }} aria-hidden="true"></div>
      </div>
    </header>
  )
}
