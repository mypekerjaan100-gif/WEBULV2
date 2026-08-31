import Icon from '../components/Icon.jsx'

export default function ContractPage({ contract, onBack }) {
  return (
    <div className="page">
      <button type="button" className="back-button" onClick={onBack}>
        <Icon name="arrow-left" size={16} /> Kembali ke Dashboard
      </button>
      <section className="page-hero">
        <h1 className="page-title">{contract.title}</h1>
        <p className="page-description">{contract.description}</p>
      </section>
      <section className="placeholder">
        <div className="placeholder-icon" aria-hidden="true">
          <Icon name={iconName(contract.icon)} size={32} />
        </div>
        <h2 className="placeholder-title">Halaman placeholder</h2>
        <p className="placeholder-text">
          Modul <strong>{contract.title}</strong> akan diisi pada tahap
          pengembangan berikutnya. Saat ini halaman ini hanya menampilkan
          kerangka awal dengan dummy data.
        </p>
        <div className="placeholder-dummy">
          <span>Dummy status: &ldquo;Modul belum dikembangkan&rdquo;</span>
          <span>Tanggal dummy: 18 Agustus 2026</span>
        </div>
      </section>
    </div>
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
