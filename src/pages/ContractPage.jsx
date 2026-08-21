export default function ContractPage({ contract, onBack }) {
  return (
    <div className="page">
      <button type="button" className="back-button" onClick={onBack}>
        &larr; Kembali ke Dashboard
      </button>
      <section className="page-hero">
        <h1 className="page-title">{contract.title}</h1>
        <p className="page-description">{contract.description}</p>
      </section>
      <section className="placeholder">
        <div className="placeholder-icon" aria-hidden="true">
          {iconMark(contract.icon)}
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