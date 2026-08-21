import {
  buildSlaExportDoc,
  buildXlsx,
  buildPdf,
  downloadExportFile,
  exportFileName,
} from '../../utils/slaExportFile.js'

export default function SLAExportPreview({
  period,
  version,
  role,
  unitId,
  up3Id,
  units,
  contractId,
  documentScope,
  indicators,
  targets,
  ulpEntries,
  signatureGroups,
  onExported,
  onClose,
}) {
  const doc = buildSlaExportDoc({
    period,
    version,
    role,
    unitId,
    up3Id,
    units,
    contractId,
    documentScope,
    indicators,
    targets,
    ulpEntries,
    signatureGroups,
  })

  if (!doc.ok) {
    return (
      <div className="sla-modal-overlay" onClick={onClose}>
        <div className="sla-modal" onClick={(event) => event.stopPropagation()}>
          <div className="sla-modal-header">
            <h3 className="sla-modal-title">Export Ditolak</h3>
            <button type="button" className="sla-modal-close" onClick={onClose}>
              &times;
            </button>
          </div>
          <div className="sla-export-doc">
            <p className="sla-export-scope">{doc.message}</p>
            <div className="sla-modal-actions">
              <button type="button" className="sla-btn sla-btn-primary" onClick={onClose}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const handleDownload = (extension) => {
    const bytes = extension === 'xlsx' ? buildXlsx(doc) : buildPdf(doc)
    downloadExportFile(bytes, exportFileName(doc, extension))
    onExported?.()
  }

  return (
    <div className="sla-modal-overlay" onClick={onClose}>
      <div className="sla-modal" onClick={(event) => event.stopPropagation()}>
        <div className="sla-modal-header">
          <h3 className="sla-modal-title">Preview Export {'\u2014'} {doc.scope}</h3>
          <button type="button" className="sla-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="sla-export-doc">
          <h4 className="sla-export-title">{doc.title}</h4>
          <div className="sla-export-meta">
            <div>
              Periode Pekerjaan: <strong>{doc.period}</strong>
            </div>
            <div>
              Tanggal Laporan (N+1): <strong>{doc.reportDate}</strong>
            </div>
            <div>
              Scope Laporan: <strong>{doc.scope}</strong>
            </div>
          </div>
          {doc.opening && <p className="sla-export-opening">{doc.opening}</p>}
          <div className="sla-export-signatures">
            <h5 className="sla-export-signatures-title">
              Penandatangan yang berlaku pada periode {doc.period}
            </h5>
            <div className="sla-sign-blocks">
              {doc.signatureGroups.map((group) => (
                <div key={`${group.title}-${group.institution}`} className="sla-sign-block">
                  <h6 className="sla-sign-party">{group.title}</h6>
                  <p className="sla-sign-institution">{group.institution}</p>
                  {group.members.length === 0 && (
                    <p className="sla-sign-empty">
                      Tidak ada penandatangan yang berlaku pada periode ini.
                    </p>
                  )}
                  {group.members.map((member) => (
                    <div key={member.id} className="sla-sign-item">
                      <div className="sla-sign-info">
                        <strong>{member.name}</strong>
                        <div>{member.position}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="sla-modal-actions">
            <button
              type="button"
              className="sla-btn sla-btn-primary"
              onClick={() => handleDownload('xlsx')}
            >
              Download Excel
            </button>
            <button
              type="button"
              className="sla-btn sla-btn-primary"
              onClick={() => handleDownload('pdf')}
            >
              Download PDF
            </button>
            <span className="sla-export-note">
              File .xlsx dan .pdf dibuat langsung di browser dari data SLA yang sedang dipilih
              (periode, versi, scope, seluruh section aktif, indikator, total denda, dan grup
              penandatangan yang berlaku pada periode tersebut).
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}