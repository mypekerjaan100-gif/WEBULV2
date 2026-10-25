import { Fragment, useMemo } from 'react'
import AlkesModal from './AlkesModal.jsx'

const STATUS_CLASS = {
  Draft: 'sla-status-draft',
  Aktif: 'sla-status-active',
  Diarsipkan: 'sla-status-archive',
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00+07:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Pontianak',
  }).format(date)
}

function formatTimestamp(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Pontianak',
  }).format(date)
}

function groupItems(items, equipmentById, categoryById) {
  const groups = new Map()
  for (const item of items) {
    const equipment = equipmentById.get(item.equipmentId) || null
    const category = categoryById.get(equipment?.categoryId) || null
    const snapshotName = item.categoryName || ''
    const key = snapshotName ? `snapshot:${snapshotName}` : (category?.id || '__uncategorized__')
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: snapshotName || category?.name || 'Tanpa Kategori',
        sortOrder: snapshotName ? Number.MAX_SAFE_INTEGER : (category?.sortOrder ?? Number.MAX_SAFE_INTEGER),
        items: [],
      })
    }
    groups.get(key).items.push({ ...item, equipment })
  }
  return [...groups.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => (
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
        || String(a.equipmentName ?? '').localeCompare(String(b.equipmentName ?? ''))
      )),
    }))
}

export default function TemplateDetailModal({
  open, template, items, loading, error, busy, canManage,
  equipmentById, categoryById, typeById, assignmentById,
  onClose, onEdit, onRetry,
}) {
  const safeItems = items || []
  const groups = useMemo(
    () => groupItems(safeItems, equipmentById, categoryById),
    [safeItems, equipmentById, categoryById],
  )
  if (!template) return null
  const typeName = typeById.get(template.vehicleTypeId)?.name || '—'
  const assignmentName = assignmentById.get(template.assignmentId)?.name || '—'
  const hasLegacy = safeItems.some((item) => item.legacyMetadata)
  const editable = canManage && template.status !== 'Diarsipkan'
  const footerText = template.status === 'Draft'
    ? (canManage ? 'Draft masih dapat diubah.' : 'Draft ini belum diterbitkan.')
    : template.status === 'Aktif'
      ? (canManage ? 'Perubahan akan memperbarui template ini; laporan yang sudah tersimpan tetap utuh.' : 'Template aktif ini bersifat baca saja.')
      : 'Template arsip bersifat baca saja.'

  return (
    <AlkesModal
      open={open}
      onClose={onClose}
      eyebrow="DETAIL TEMPLATE KEBUTUHAN"
      title={template.templateName}
      subtitle="Ringkasan standar alat untuk kendaraan dengan jenis dan penugasan ini."
      size="detail"
      dismissDisabled={busy}
      meta={(
        <>
          <span className={`sla-status-badge ${STATUS_CLASS[template.status] || 'sla-status-draft'}`}>{template.status}</span>
          <span>{template.templateCode}</span>
          <span>Versi {template.versionNumber}</span>
        </>
      )}
      footer={(
        <div className="alkes-detail-footer">
          <span>{footerText}</span>
          <div className="alkes-modal-actions">
            <button type="button" className="sla-btn" disabled={busy} onClick={onClose}>Tutup</button>
            {editable && (
              <button type="button" className="sla-btn sla-btn-primary" disabled={busy || loading} onClick={onEdit}>
                {template.status === 'Draft' ? 'Edit Draft' : 'Edit Template'}
              </button>
            )}
          </div>
        </div>
      )}
    >
      <div className="alkes-detail-summary">
        <div>
          <span>Status</span>
          <span className={`sla-status-badge ${STATUS_CLASS[template.status] || 'sla-status-draft'}`}>{template.status}</span>
        </div>
        <div><span>Jenis Kendaraan</span><strong>{typeName}</strong></div>
        <div><span>Penugasan</span><strong>{assignmentName}</strong></div>
        <div><span>Jumlah Alat</span><strong>{loading ? '…' : `${safeItems.length} jenis`}</strong></div>
        <div><span>Kategori</span><strong>{loading ? '…' : `${groups.length} kategori`}</strong></div>
      </div>

      <div className="alkes-detail-grid">
        <div><span>Varian / Model</span><strong>{template.vehicleVariant || 'Umum'}</strong></div>
        <div><span>Tanggal Berlaku</span><strong>{formatDate(template.effectiveFrom)}</strong></div>
        <div><span>Dibuat</span><strong>{formatTimestamp(template.createdAt)}</strong></div>
        <div><span>Diperbarui</span><strong>{formatTimestamp(template.updatedAt)}</strong></div>
        {template.publishedAt && (
          <div><span>Diterbitkan</span><strong>{formatTimestamp(template.publishedAt)}</strong></div>
        )}
      </div>

      {template.description && (
        <section className="alkes-detail-section">
          <div className="alkes-detail-section-head"><h3>Deskripsi Template</h3></div>
          <p className="alkes-detail-description">{template.description}</p>
        </section>
      )}

      <section className="alkes-detail-section">
        <div className="alkes-detail-section-head">
          <div>
            <h3>Daftar Kebutuhan Alat</h3>
            <p>Jumlah kuantitas tidak dijumlahkan lintas satuan yang berbeda.</p>
          </div>
          {!loading && !error && <span>{safeItems.length} jenis · {groups.length} kategori</span>}
        </div>
        {hasLegacy && (
          <p className="alkes-detail-warning">
            Template lama: nama dan satuan alat mengikuti katalog saat ini sampai versi baru diterbitkan.
          </p>
        )}
        {loading ? (
          <div className="alkes-detail-state" role="status">
            <span className="alkes-detail-spinner" aria-hidden="true" />
            Memuat rincian kebutuhan template...
          </div>
        ) : error ? (
          <div className="alkes-detail-state is-error" role="alert">
            <span>{error}</span>
            <button type="button" className="sla-btn" onClick={onRetry}>Coba Lagi</button>
          </div>
        ) : !safeItems.length ? (
          <div className="alkes-detail-state">Template belum memiliki daftar alat.</div>
        ) : (
          <div className="sla-preview-scroll alkes-detail-table-wrap">
            <table className="sla-preview-table alkes-table alkes-detail-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Peralatan</th>
                  <th>Satuan</th>
                  <th>Jumlah Kebutuhan</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.key}>
                    <tr className="alkes-group-row">
                      <td colSpan={5}>
                        {group.name}
                        <span className="alkes-group-count">{group.items.length} jenis</span>
                      </td>
                    </tr>
                    {group.items.map((item, index) => (
                      <tr key={`${item.equipmentId}-${index}`}>
                        <td className="alkes-detail-number">{index + 1}</td>
                        <td>
                          <strong>{item.equipmentName || 'Alat tidak ditemukan'}</strong>
                          {item.equipmentCode && <div className="sla-table-sub">{item.equipmentCode}</div>}
                        </td>
                        <td>{item.unit || 'unit'}</td>
                        <td className="alkes-detail-qty">{item.requiredQty}</td>
                        <td>{item.note || '—'}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AlkesModal>
  )
}
