import { contracts } from '../data/contracts.js'
import ContractCard from '../components/ContractCard.jsx'

export default function DashboardPage({ onSelectContract, authorizedContractIds }) {
  const visibleContracts = authorizedContractIds === null
    ? contracts
    : contracts.filter((contract) => authorizedContractIds.includes(contract.id))

  return (
    <div className="page dashboard-page">
      <header className="dashboard-page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-description">
          Pilih kontrak untuk mengakses modul pelaporan dan monitoring pekerjaan.
        </p>
      </header>
      <section className="contract-grid">
        {visibleContracts.map((contract) => (
          <ContractCard
            key={contract.id}
            contract={contract}
            onSelect={onSelectContract}
          />
        ))}
      </section>
    </div>
  )
}
