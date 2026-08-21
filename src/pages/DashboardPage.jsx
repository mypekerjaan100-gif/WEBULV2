import { contracts, siteTitle, siteSubtitle } from '../data/contracts.js'
import ContractCard from '../components/ContractCard.jsx'

export default function DashboardPage({ onSelectContract }) {
  return (
    <div className="page">
      <section className="page-hero">
        <h1 className="page-title">{siteTitle}</h1>
        <p className="page-subtitle">{siteSubtitle}</p>
        <p className="page-description">
          Pilih salah satu kontrak di bawah untuk melihat halaman modul.
          Modul laporan dan data akan dikembangkan pada tahap berikutnya.
        </p>
      </section>
      <section className="contract-grid">
        {contracts.map((contract) => (
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