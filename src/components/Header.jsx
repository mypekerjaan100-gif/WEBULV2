import { contracts, siteTitle } from '../data/contracts.js'
import SlaPreviewBar from './sla/SlaPreviewBar.jsx'
import { useAuth } from '../lib/AppAuth.jsx'

const PAGE_TITLES = {
  'pengguna-akses': 'Pengguna & Akses',
}

export default function Header({ activeContractId, currentPage, onOpenSidebar, preview }) {
  const { authority } = useAuth()
  const activeContract = contracts.find(
    (contract) => contract.id === activeContractId,
  )

  const title = currentPage
    ? (PAGE_TITLES[currentPage] || currentPage)
    : activeContract
      ? activeContract.title
      : 'Dashboard'

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
          Login: {authority?.actor?.is_super_admin ? 'SUPER_ADMIN' : 'Authenticated'}
        </span>
        {preview && <SlaPreviewBar preview={preview} />}
        <div className="header-placeholder">Prototype &middot; Dummy Data</div>
      </div>
    </header>
  )
}
