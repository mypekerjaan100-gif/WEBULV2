import Icon from './Icon.jsx'

export default function ContractCard({ contract, onSelect }) {
  return (
    <button
      type="button"
      className="contract-card"
      onClick={() => onSelect(contract.id)}
    >
      <span className="contract-card-heading">
        <span className={`contract-card-icon contract-card-icon-${contract.icon}`}>
          <Icon name={iconName(contract.icon)} size={22} />
        </span>
        <span className="contract-card-title">{contract.title}</span>
      </span>
      <span className="contract-card-description">{contract.description}</span>
      <span className="contract-card-action">Buka halaman <Icon name="arrow-right" size={14} /></span>
    </button>
  )
}

function iconName(icon) {
  switch (icon) {
    case 'wrench':
      return 'operations'
    case 'receipt':
      return 'billing'
    case 'substation':
      return 'substation'
    case 'binoculars':
      return 'patrol'
    default:
      return 'dashboard'
  }
}
