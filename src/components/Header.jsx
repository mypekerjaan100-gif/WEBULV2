import { contracts, siteTitle } from '../data/contracts.js'
import SlaPreviewBar from './sla/SlaPreviewBar.jsx'

export default function Header({ activeContractId, onOpenSidebar, preview }) {
  const activeContract = contracts.find(
    (contract) => contract.id === activeContractId,
  )

  const title = activeContract ? activeContract.title : 'Dashboard'

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
        {preview && <SlaPreviewBar preview={preview} />}
        <div className="header-placeholder">Prototype &middot; Dummy Data</div>
      </div>
    </header>
  )
}