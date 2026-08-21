import { contracts, siteTitle, siteSubtitle } from '../data/contracts.js'

export default function Sidebar({ open, activeContractId, onNavigate, onClose }) {
  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-title">{siteTitle}</div>
        <div className="sidebar-brand-subtitle">{siteSubtitle}</div>
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
          className={`nav-item ${activeContractId === null ? 'nav-item-active' : ''}`}
          onClick={() => onNavigate(null)}
        >
          <span className="nav-icon" aria-hidden="true">
            &#9632;
          </span>
          Dashboard
        </button>
        <div className="nav-section-title">Kontrak</div>
        {contracts.map((contract) => (
          <button
            key={contract.id}
            type="button"
            className={`nav-item ${activeContractId === contract.id ? 'nav-item-active' : ''}`}
            onClick={() => onNavigate(contract.id)}
          >
            <span className="nav-icon" aria-hidden="true">
              {iconMark(contract.icon)}
            </span>
            {contract.title}
          </button>
        ))}
      </nav>
    </aside>
  )
}

function iconMark(icon) {
  switch (icon) {
    case 'wrench':
      return '\u2692'
    case 'receipt':
      return '\u2740'
    case 'substation':
      return '\u26A1'
    case 'binoculars':
      return '\u231A'
    default:
      return '\u2022'
  }
}