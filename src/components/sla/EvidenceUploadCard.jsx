function formatKilobytes(bytes) {
  const value = Number(bytes ?? 0) / 1024
  if (!Number.isFinite(value) || value <= 0) return '0 KB'
  return `${value >= 100 ? Math.round(value) : value.toFixed(0)} KB`
}

export default function EvidenceUploadCard({
  requirement,
  position,
  existingList,
  stagedList,
  evidenceUrls,
  isImageEvidence,
  inputDisabled,
  actionDisabled,
  locked,
  onStage,
  onRemoveStaged,
  onPreview,
  onRemoveSaved,
}) {
  const hasTimeMark = requirement.helpers?.[0] === 'TimeMark Wajib'
  const hints = requirement.helpers?.slice(hasTimeMark ? 1 : 0) ?? []
  const totalCount = existingList.length + stagedList.length
  const complete = requirement.allowMultiple
    ? totalCount > 0
    : stagedList.length > 0 || existingList.length === 1
  const status = locked ? 'locked' : complete ? 'complete' : totalCount > 0 ? 'partial' : 'empty'
  const statusLabel = locked
    ? 'Terkunci'
    : complete
      ? 'Lengkap'
      : totalCount > 0
        ? `${totalCount} foto`
        : 'Belum diisi'
  const dropLabel = !requirement.allowMultiple && existingList.length > 0
    ? 'Klik untuk ganti foto'
    : requirement.allowMultiple && totalCount > 0
      ? 'Tambah foto atau tarik ke sini'
      : 'Pilih foto atau tarik ke sini'

  return (
    <div className={`lembur-upload-card is-${status}`}>
      <div className="lembur-upload-card-heading">
        <span className="lembur-evidence-position" aria-hidden="true">{position}</span>
        <strong>{requirement.label} *</strong>
        <span className="lembur-evidence-badges">
          {hasTimeMark && <span className="lembur-timemark-badge">TimeMark Wajib</span>}
          <span className={`lembur-evidence-status is-${status}`}>{statusLabel}</span>
        </span>
      </div>
      {hints.length > 0 && (
        <ul className="lembur-evidence-hints">
          {hints.map((hint) => <li key={hint}>{hint}</li>)}
        </ul>
      )}
      <label
        className="lembur-dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          onStage(requirement, Array.from(event.dataTransfer.files ?? []))
        }}
      >
        <input
          key={`${requirement.type}-${stagedList.length}-${existingList.length}`}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          multiple={!!requirement.allowMultiple}
          disabled={inputDisabled}
          onChange={(event) => onStage(requirement, Array.from(event.target.files ?? []))}
        />
        <span className="lembur-upload-icon" aria-hidden="true">↑</span>
        <span className="lembur-dropzone-text">
          <strong>{dropLabel}</strong>
          <small>
            JPG, PNG, WebP · dikompres otomatis · maks. 1 MB
            {requirement.allowMultiple && ' · bisa lebih dari 1 foto'}
          </small>
        </span>
      </label>
      {totalCount > 0 && (
        <ul className="lembur-selected-files">
          {existingList.map((entry) => (
            <li className="lembur-selected-file" key={entry.id}>
              {isImageEvidence(entry) && evidenceUrls[entry.id] ? (
                <button
                  type="button"
                  className="lembur-thumb-button"
                  onClick={() => onPreview(entry, existingList)}
                  aria-label={`Preview ${entry.originalFilename}`}
                >
                  <img src={evidenceUrls[entry.id]} alt={entry.originalFilename} />
                </button>
              ) : (
                <span className="lembur-doc-icon">DOC</span>
              )}
              <div className="lembur-selected-file-meta">
                <strong>{entry.originalFilename}</strong>
                <small>{formatKilobytes(entry.storedSizeBytes)} · tersimpan</small>
              </div>
              <div className="lembur-selected-file-actions">
                <button type="button" className="sla-btn lembur-evidence-action" onClick={() => onPreview(entry, existingList)}>
                  Preview
                </button>
                <button
                  type="button"
                  className="sla-btn lembur-evidence-action is-danger"
                  disabled={actionDisabled || locked}
                  onClick={() => onRemoveSaved(entry)}
                >
                  Hapus
                </button>
              </div>
            </li>
          ))}
          {stagedList.map((entry) => (
            <li className="lembur-selected-file is-staged" key={entry.id}>
              {entry.previewUrl
                ? <img src={entry.previewUrl} alt="" />
                : <span className="lembur-doc-icon">DOC</span>}
              <div className="lembur-selected-file-meta">
                <strong>{entry.processed.original.filename}</strong>
                <small>{formatKilobytes(entry.processed.stored.sizeBytes)} · siap disimpan</small>
              </div>
              <div className="lembur-selected-file-actions">
                <button
                  type="button"
                  className="sla-btn lembur-evidence-action is-danger"
                  disabled={actionDisabled}
                  onClick={() => onRemoveStaged(requirement.type, entry.id)}
                >
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {locked && (
        <p className="lembur-evidence-locked-note">Dikunci karena sebagian peserta sudah disetujui.</p>
      )}
    </div>
  )
}
