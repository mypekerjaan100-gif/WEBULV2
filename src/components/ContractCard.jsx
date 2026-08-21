export default function ContractCard({ contract, onSelect }) {
  return (
    <button
      type="button"
      className="contract-card"
      onClick={() => onSelect(contract.id)}
    >
      <span className="contract-card-icon" aria-hidden="true">
        {iconMark(contract.icon)}
      </span>
      <span className="contract-card-title">{contract.title}</span>
      <span className="contract-card-description">{contract.description}</span>
      <span className="contract-card-action">Buka halaman &rarr;</span>
    </button>
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