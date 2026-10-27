import { Fragment, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  FormField,
  Input,
  Select,
  Textarea,
} from '../ui/Primitives.jsx'
import {
  CONDITION_LABELS,
  evaluateCondition,
  groupConditionItems,
} from '../../data/ulpConditionDomain.js'
import {
  resolveToolIssue,
  submitToolInspection,
  uploadToolEvidence,
} from '../../data/toolInspectionRepository.js'
import { prepareToolEvidence } from '../../data/toolEvidence.js'
import {
  EvidenceThumbs,
  PhotoPicker,
  ageLabel,
  assetStatus,
  formatDateTime,
  inputValueToIso,
  pontianakInputValue,
} from './ToolEvidence.jsx'

function ConditionBadge({ status }) {
  return (
    <span className={`uc-status uc-status--${status || 'unfilled'}`}>
      {CONDITION_LABELS[status] || 'Belum Diisi'}
    </span>
  )
}

function InlineEditor({
  editor,
  item,
  inspectForm,
  resolveForm,
  error,
  submitting,
  onInspectChange,
  onResolveChange,
  onCancel,
  onSubmitInspection,
  onSubmitResolution,
}) {
  if (!editor) return null
  const asset = editor.asset
  const isInspect = editor.mode === 'inspect'
  const issue = asset.open_issue
  return (
    <div className="tool-inline-form">
      <div className="tool-inline-form-head">
        <div>
          <strong>{isInspect ? 'Inspeksi unit' : 'Serah terima pengganti'} · Unit {asset.asset_sequence} · {item.name}</strong>
          <span>
            {asset.commissioned_at
              ? `Mulai pakai ${formatDateTime(asset.commissioned_at)}`
              : 'Awal masa pakai belum tercatat'}
          </span>
        </div>
        <button type="button" className="tool-link-button" disabled={submitting} onClick={onCancel}>Tutup</button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {isInspect ? (
        <form className="tool-inline-form-body" onSubmit={onSubmitInspection}>
          <div className="tool-inline-grid">
            <FormField label="Kondisi alat" required>
              <Select value={inspectForm.condition} onChange={(event) => onInspectChange({ condition: event.target.value })}>
                <option value="GOOD">Baik</option>
                <option value="DAMAGED">Rusak</option>
              </Select>
            </FormField>
            <FormField label="Tanggal & waktu inspeksi" required>
              <Input
                type="datetime-local"
                value={inspectForm.inspectedAt}
                min={asset.commissioned_at ? pontianakInputValue(new Date(asset.commissioned_at)) : undefined}
                max={pontianakInputValue()}
                onChange={(event) => onInspectChange({ inspectedAt: event.target.value })}
              />
            </FormField>
            <FormField label={inspectForm.condition === 'DAMAGED' ? 'Catatan kerusakan' : 'Catatan'} required={inspectForm.condition === 'DAMAGED'}>
              <Textarea
                rows={2}
                maxLength={2000}
                value={inspectForm.note}
                onChange={(event) => onInspectChange({ note: event.target.value })}
                placeholder={inspectForm.condition === 'DAMAGED' ? 'Jelaskan kerusakan yang ditemukan' : 'Catatan pemeriksaan (opsional)'}
              />
            </FormField>
            <FormField label="Foto bukti" required>
              <PhotoPicker
                files={inspectForm.files}
                disabled={submitting}
                onChange={(files) => onInspectChange({ files })}
              />
            </FormField>
          </div>
          {inspectForm.condition === 'DAMAGED' && (
            <Alert tone="warning">
              Kondisi Rusak membuka issue. Issue tetap terbuka sampai penggantian diserahkan dengan bukti foto.
            </Alert>
          )}
          <div className="tool-inline-actions">
            <Button variant="ghost" disabled={submitting} onClick={onCancel}>Batal</Button>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan Inspeksi'}
            </Button>
          </div>
        </form>
      ) : (
        <form className="tool-inline-form-body" onSubmit={onSubmitResolution}>
          <div className="tool-issue-scope">
            <span>Ditemukan {formatDateTime(issue?.opened_at)}</span>
            <span>Umur saat rusak {ageLabel(issue?.age_at_failure_months)} · standar {issue?.standard_life_months == null ? 'belum diisi' : ageLabel(issue.standard_life_months)}</span>
            {issue?.damaged_before_life && <span className="tool-warning">Rusak sebelum masa pakai standar</span>}
            {issue?.note && <span>{issue.note}</span>}
          </div>
          <div className="tool-inline-grid tool-inline-grid--resolve">
            <FormField label="Tanggal & waktu serah terima" required>
              <Input
                type="datetime-local"
                value={resolveForm.resolvedAt}
                min={issue?.opened_at ? pontianakInputValue(new Date(issue.opened_at)) : undefined}
                max={pontianakInputValue()}
                onChange={(event) => onResolveChange({ resolvedAt: event.target.value })}
              />
            </FormField>
            <FormField label="Catatan serah terima" required>
              <Input
                value={resolveForm.note}
                maxLength={2000}
                onChange={(event) => onResolveChange({ note: event.target.value })}
              />
            </FormField>
            <FormField label="Foto alat pengganti" required>
              <PhotoPicker
                files={resolveForm.files}
                disabled={submitting}
                onChange={(files) => onResolveChange({ files })}
              />
            </FormField>
          </div>
          <Alert tone="info">
            Waktu serah terima menjadi awal masa pakai alat pengganti dan bukti penyerahan dari K3 ke ULP.
          </Alert>
          <div className="tool-inline-actions">
            <Button variant="ghost" disabled={submitting} onClick={onCancel}>Batal</Button>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan Serah Terima'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

export default function UlpToolInspectionMatrix({
  items = [],
  assets = [],
  history = [],
  canManage = false,
  canInspect = false,
  canResolveIssue = false,
  showInspections = true,
  future = false,
  inspectionStatus = 'ready',
  isDefaultVehicle = false,
  contractUuid,
  up3Uuid,
  ulpId,
  highlightedIssueId = null,
  onQuantityChange,
  onNoteChange,
  onChanged,
  onMessage,
  onEditorStateChange,
}) {
  const [editor, setEditor] = useState(null)
  const [inspectForm, setInspectForm] = useState({ condition: 'GOOD', inspectedAt: pontianakInputValue(), note: '', files: [] })
  const [resolveForm, setResolveForm] = useState({ resolvedAt: pontianakInputValue(), note: 'Serah terima alat pengganti kepada ULP.', files: [] })
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [expandedHistoryKey, setExpandedHistoryKey] = useState(null)
  const quantityRefs = useRef(new Map())
  const formRowRef = useRef(null)
  const groups = groupConditionItems(items)
  const columnCount = showInspections ? 8 : 7

  useEffect(() => {
    if (!editor) return
    window.requestAnimationFrame(() => {
      formRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [editor])

  useEffect(() => {
    onEditorStateChange?.({ dirty: Boolean(editor), busy: submitting })
    return () => onEditorStateChange?.({ dirty: false, busy: false })
  }, [editor, submitting, onEditorStateChange])

  const confirmSwitch = (assetId) => {
    if (!editor || editor.asset.id === assetId) return true
    return window.confirm('Isian unit ini belum disimpan. Pindah ke unit lain?')
  }

  const openInspect = (item, asset) => {
    if (submitting || !canInspect || asset.open_issue || future) return
    if (!confirmSwitch(asset.id)) return
    setEditor({ mode: 'inspect', itemKey: item.key, asset })
    setInspectForm({ condition: 'GOOD', inspectedAt: pontianakInputValue(), note: '', files: [] })
    setFormError('')
  }

  const openResolve = (item, asset) => {
    if (submitting || !canResolveIssue || !asset.open_issue || future) return
    if (!confirmSwitch(asset.id)) return
    setEditor({ mode: 'resolve', itemKey: item.key, asset })
    setResolveForm({
      resolvedAt: pontianakInputValue(),
      note: 'Serah terima alat pengganti kepada ULP.',
      files: [],
    })
    setFormError('')
  }

  const closeEditor = () => {
    if (submitting) return
    setEditor(null)
    setFormError('')
  }

  const submitInspection = async (event) => {
    event.preventDefault()
    if (!editor) return
    setFormError('')
    if (!inspectForm.inspectedAt) { setFormError('Tanggal dan waktu inspeksi wajib diisi.'); return }
    if (inspectForm.condition === 'DAMAGED' && !inspectForm.note.trim()) {
      setFormError('Catatan kerusakan wajib diisi.')
      return
    }
    if (!inspectForm.files.length) { setFormError('Minimal satu foto bukti wajib diunggah.'); return }
    setSubmitting(true)
    try {
      const paths = []
      for (const file of inspectForm.files) {
        const prepared = await prepareToolEvidence(file)
        paths.push(await uploadToolEvidence({
          contractId: contractUuid,
          up3Id: up3Uuid,
          ulpId,
          assetId: editor.asset.id,
          file: prepared,
        }))
      }
      const result = await submitToolInspection({
        assetId: editor.asset.id,
        inspectedAt: inputValueToIso(inspectForm.inspectedAt),
        condition: inspectForm.condition,
        note: inspectForm.note.trim(),
        photoPaths: paths,
      })
      onMessage?.(result?.issue
        ? `Kerusakan ${editor.asset.equipment_name} dicatat. Issue terbuka sampai penggantian diserahkan.`
        : `Kondisi ${editor.asset.equipment_name} unit ${editor.asset.asset_sequence} tersimpan sebagai Baik.`)
      setEditor(null)
      onChanged?.()
    } catch (submitError) {
      setFormError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const submitResolution = async (event) => {
    event.preventDefault()
    if (!editor?.asset?.open_issue) return
    setFormError('')
    if (!resolveForm.resolvedAt) { setFormError('Tanggal dan waktu serah terima wajib diisi.'); return }
    if (!resolveForm.note.trim()) { setFormError('Catatan serah terima wajib diisi.'); return }
    if (!resolveForm.files.length) { setFormError('Minimal satu foto alat pengganti wajib diunggah.'); return }
    setSubmitting(true)
    try {
      const issue = editor.asset.open_issue
      const paths = []
      for (const file of resolveForm.files) {
        const prepared = await prepareToolEvidence(file)
        paths.push(await uploadToolEvidence({
          contractId: contractUuid,
          up3Id: up3Uuid,
          ulpId,
          assetId: editor.asset.id,
          file: prepared,
        }))
      }
      await resolveToolIssue({
        issueId: issue.id,
        resolvedAt: inputValueToIso(resolveForm.resolvedAt),
        note: resolveForm.note.trim(),
        photoPaths: paths,
        expectedRevision: issue.revision,
      })
      onMessage?.(`Issue ${editor.asset.equipment_name} unit ${editor.asset.asset_sequence} selesai. Masa pakai alat pengganti dimulai dari waktu serah terima.`)
      setEditor(null)
      onChanged?.()
    } catch (submitError) {
      setFormError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const moveQuantityFocus = (event, item, field) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const ordered = items
    const index = ordered.findIndex((row) => row.key === item.key)
    const next = field === 'good_qty'
      ? `${item.key}:bad_qty`
      : `${ordered[index + 1]?.key}:good_qty`
    quantityRefs.current.get(next)?.focus()
  }

  if (!groups.length) {
    return <p className="tool-empty">Tidak ada peralatan pada template kendaraan ini.</p>
  }

  return (
    <div className="tool-matrix-wrap">
      <table className={`tool-matrix ${showInspections ? 'has-inspections' : 'no-inspections'}`}>
        <thead>
          <tr>
            <th>Peralatan</th>
            <th>Jumlah dalam Kontrak</th>
            <th>Ada di ULP</th>
            <th>Baik</th>
            <th>Rusak</th>
            <th>%</th>
            {showInspections && <th>Inspeksi per unit</th>}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([category, rows]) => (
            <Fragment key={category}>
              <tr className="tool-matrix-category">
                <th colSpan={columnCount}>{category}<span>{rows.length} jenis</span></th>
              </tr>
              {rows.map((item) => {
                const result = evaluateCondition(item)
                const unitAssets = assets.filter((asset) => asset.equipment_id === item.equipment_id)
                const issueCount = unitAssets.filter((asset) => asset.open_issue).length
                const itemHistory = history.filter((entry) => entry.equipment_name === item.name)
                const editing = editor?.itemKey === item.key
                return (
                  <Fragment key={item.key}>
                    <tr className={`tool-matrix-row ${result.status === 'non_compliant' ? 'is-non-compliant' : ''}`}>
                      <td className="tool-matrix-tool">
                        <strong>{item.name}</strong>
                        <span className="tool-muted">{item.unit}{item.specification ? ` · ${item.specification}` : ''}</span>
                        <details className="uc-note">
                          <summary>Catatan{item.note ? ' terisi' : ''}</summary>
                          {canManage ? (
                            <textarea
                              aria-label={`Catatan ${item.name}`}
                              maxLength={2000}
                              value={item.note || ''}
                              onChange={(event) => onNoteChange?.(item, event.target.value)}
                            />
                          ) : <p>{item.note || 'Tidak ada catatan.'}</p>}
                        </details>
                      </td>
                      <td className="tool-matrix-number">{item.required_qty}</td>
                      <td className="tool-matrix-number">{item.required_qty}</td>
                      <td className="tool-matrix-number">
                        {canManage ? (
                          <input
                            ref={(node) => {
                              if (node) quantityRefs.current.set(`${item.key}:good_qty`, node)
                              else quantityRefs.current.delete(`${item.key}:good_qty`)
                            }}
                            className="uc-count tool-matrix-input"
                            inputMode="numeric"
                            autoComplete="off"
                            value={item.good_qty ?? ''}
                            placeholder="Isi"
                            aria-label={`Baik ${item.name}`}
                            aria-invalid={result.status === 'invalid'}
                            onChange={(event) => onQuantityChange?.(item, 'good_qty', event.target.value)}
                            onKeyDown={(event) => moveQuantityFocus(event, item, 'good_qty')}
                          />
                        ) : (item.good_qty ?? '-')}
                      </td>
                      <td className="tool-matrix-number">
                        {canManage ? (
                          <input
                            ref={(node) => {
                              if (node) quantityRefs.current.set(`${item.key}:bad_qty`, node)
                              else quantityRefs.current.delete(`${item.key}:bad_qty`)
                            }}
                            className="uc-count tool-matrix-input"
                            inputMode="numeric"
                            autoComplete="off"
                            value={item.bad_qty ?? ''}
                            placeholder="Isi"
                            aria-label={`Rusak ${item.name}`}
                            aria-invalid={result.status === 'invalid'}
                            onChange={(event) => onQuantityChange?.(item, 'bad_qty', event.target.value)}
                            onKeyDown={(event) => moveQuantityFocus(event, item, 'bad_qty')}
                          />
                        ) : (item.bad_qty ?? '-')}
                      </td>
                      <td className="tool-matrix-number">{result.percentage == null ? '-' : `${Number(result.percentage.toFixed(1))}%`}</td>
                      {showInspections && (
                        <td className="tool-matrix-inspection">
                          {(inspectionStatus === 'idle' || inspectionStatus === 'loading') && <span className="tool-muted">Memuat rincian unit…</span>}
                          {inspectionStatus === 'error' && <span className="tool-muted">Rincian unit tidak tersedia.</span>}
                          {inspectionStatus === 'ready' && (
                            <div className="tool-matrix-units">
                              {unitAssets.map((asset) => {
                              const status = assetStatus(asset)
                              const issue = asset.open_issue
                              const age = issue ? issue.age_at_failure_months : asset.age_months
                              const life = issue ? issue.standard_life_months : asset.useful_life_months
                              return (
                                <div
                                  className={`tool-unit-card ${issue ? 'is-issue' : ''} ${issue && String(issue.id) === String(highlightedIssueId) ? 'is-highlighted' : ''}`}
                                  key={asset.id}
                                >
                                  <div className="tool-unit-card-head">
                                    <strong>Unit {asset.asset_sequence}</strong>
                                    <span className={`tool-badge tool-badge-${status.tone}`}>{status.label}</span>
                                  </div>
                                  <span className="tool-muted">
                                    {asset.latest_inspection ? formatDateTime(asset.latest_inspection.inspected_at) : 'Belum ada inspeksi'}
                                  </span>
                                  {asset.latest_inspection && (
                                    <span className="tool-muted">{asset.latest_inspection.inspected_by_name || 'Petugas inspeksi'}</span>
                                  )}
                                  <span className="tool-muted">
                                    Umur {ageLabel(age)} · standar {life == null ? 'belum diisi' : ageLabel(life)}
                                    {!issue && asset.remaining_months != null ? ` · sisa ${ageLabel(Math.max(0, asset.remaining_months))}` : ''}
                                  </span>
                                  {issue?.note && <span className="tool-unit-note">{issue.note}</span>}
                                  {issue?.damaged_before_life && <span className="tool-warning">Rusak sebelum masa pakai</span>}
                                  <EvidenceThumbs paths={asset.latest_inspection?.photo_paths || []} />
                                  <div className="tool-unit-card-actions">
                                    {issue && canResolveIssue && !future && (
                                      <button type="button" className="sla-btn" disabled={submitting} onClick={() => openResolve(item, asset)}>Serah Terima</button>
                                    )}
                                    {!issue && canInspect && !future && (
                                      <button type="button" className="sla-btn" disabled={submitting} onClick={() => openInspect(item, asset)}>Inspeksi</button>
                                    )}
                                    {issue && !canResolveIssue && <span className="tool-muted">Issue terbuka</span>}
                                    {!issue && !canInspect && <span className="tool-muted">Hanya lihat</span>}
                                  </div>
                                </div>
                              )
                            })}
                            {!unitAssets.length && <span className="tool-muted">Belum ada unit fisik.</span>}
                            </div>
                          )}
                        </td>
                      )}
                      <td className="tool-matrix-status">
                        <ConditionBadge status={result.status} />
                        {result.status === 'non_compliant' && (
                          <small className="uc-row-reason">{Number(item.bad_qty) > 0 ? 'Ada kondisi rusak' : 'Jumlah baik kurang'}</small>
                        )}
                        {result.status === 'invalid' && <small className="uc-row-reason">{result.issue || 'Periksa jumlah kondisi.'}</small>}
                        {isDefaultVehicle && <small className="uc-row-reason">Default rekap · unit belum diinspeksi</small>}
                        {showInspections && issueCount > 0 && <small className="uc-row-reason">{issueCount} issue unit terbuka</small>}
                        {showInspections && itemHistory.length > 0 && (
                          <button
                            type="button"
                            className="tool-link-button"
                            onClick={() => setExpandedHistoryKey((value) => value === item.key ? null : item.key)}
                          >
                            Riwayat penggantian ({itemHistory.length})
                          </button>
                        )}
                      </td>
                    </tr>
                    {editing && (
                      <tr className="tool-matrix-form-row" ref={formRowRef}>
                        <td colSpan={columnCount}>
                          <InlineEditor
                            editor={editor}
                            item={item}
                            inspectForm={inspectForm}
                            resolveForm={resolveForm}
                            error={formError}
                            submitting={submitting}
                            onInspectChange={(patch) => setInspectForm((current) => ({ ...current, ...patch }))}
                            onResolveChange={(patch) => setResolveForm((current) => ({ ...current, ...patch }))}
                            onCancel={closeEditor}
                            onSubmitInspection={submitInspection}
                            onSubmitResolution={submitResolution}
                          />
                        </td>
                      </tr>
                    )}
                    {expandedHistoryKey === item.key && itemHistory.length > 0 && (
                      <tr className="tool-matrix-history-row">
                        <td colSpan={columnCount}>
                          <ul className="tool-history-list">
                            {itemHistory.map((entry) => (
                              <li key={entry.issue_id}>
                                <div>
                                  <strong>{entry.equipment_name}</strong>
                                  <span>Rusak {formatDateTime(entry.opened_at)} · diganti {formatDateTime(entry.resolved_at)}</span>
                                </div>
                                <div>
                                  <span className="tool-muted">Umur saat rusak {ageLabel(entry.age_at_failure_months)} · standar {entry.standard_life_months == null ? 'belum diisi' : ageLabel(entry.standard_life_months)}</span>
                                  {entry.damaged_before_life && <span className="tool-warning">Rusak sebelum masa pakai</span>}
                                  {entry.resolution_note && <span className="tool-note">{entry.resolution_note}</span>}
                                  {entry.inspection_photo_paths?.length > 0 && <span className="tool-muted">Bukti kerusakan</span>}
                                  <EvidenceThumbs paths={entry.inspection_photo_paths || []} />
                                  <span className="tool-muted">Bukti serah terima</span>
                                  <EvidenceThumbs paths={entry.handover_photo_paths || []} />
                                </div>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
