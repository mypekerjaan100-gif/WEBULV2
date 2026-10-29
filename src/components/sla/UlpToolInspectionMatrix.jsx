import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import {
  Alert,
  Button,
  FormField,
  Input,
  Modal,
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

function ModalScope({ editor, vehicleLabel }) {
  const asset = editor.asset
  return (
    <p className="tool-modal-scope">
      <strong>Unit {asset.asset_sequence}</strong>
      <span>{vehicleLabel ? `${vehicleLabel} · ` : ''}{asset.equipment_name}</span>
      <span>
        {asset.commissioned_at
          ? `Mulai pakai ${formatDateTime(asset.commissioned_at)}`
          : 'Awal masa pakai belum tercatat'}
      </span>
    </p>
  )
}

function agePhrase(months, label = 'Umur') {
  return months == null ? `${label} belum diketahui` : `${label} ${ageLabel(months)}`
}

function UnitDetailCard({ asset, highlightedIssueId }) {
  const status = assetStatus(asset)
  const issue = asset.open_issue
  const age = issue ? issue.age_at_failure_months : asset.age_months
  const life = issue ? issue.standard_life_months : asset.useful_life_months
  return (
    <div className={`tool-unit-card ${issue ? 'is-issue' : ''} ${issue && String(issue.id) === String(highlightedIssueId) ? 'is-highlighted' : ''}`}>
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
        {agePhrase(age)} · standar {life == null ? 'belum diisi' : ageLabel(life)}
        {!issue && asset.remaining_months != null ? ` · sisa ${ageLabel(Math.max(0, asset.remaining_months))}` : ''}
      </span>
      {issue?.note && <span className="tool-unit-note">{issue.note}</span>}
      {issue?.damaged_before_life && <span className="tool-warning">Rusak sebelum masa pakai</span>}
      <EvidenceThumbs paths={asset.latest_inspection?.photo_paths || []} />
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
  vehicleLabel = '',
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
  const [expandedUnitsKey, setExpandedUnitsKey] = useState(null)
  const [query, setQuery] = useState('')
  const [onlyAttention, setOnlyAttention] = useState(false)
  const quantityRefs = useRef(new Map())
  const detailRefs = useRef(new Map())
  const editorInitRef = useRef(null)
  const columnCount = showInspections ? 8 : 7

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return groupConditionItems(items)
      .map(([category, rows]) => [
        category,
        rows.filter((item) => {
          if (onlyAttention) {
            const result = evaluateCondition(item)
            const hasIssue = assets.some(
              (asset) => asset.equipment_id === item.equipment_id && asset.open_issue,
            )
            if (!hasIssue && !['non_compliant', 'invalid'].includes(result.status)) return false
          }
          if (!needle) return true
          return [item.name, item.specification, item.unit, category]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle))
        }),
      ])
      .filter(([, rows]) => rows.length > 0)
  }, [assets, items, onlyAttention, query])
  const visibleItemCount = groups.reduce((total, [, rows]) => total + rows.length, 0)
  const editorItem = editor ? items.find((item) => item.key === editor.itemKey) || null : null

  useEffect(() => {
    onEditorStateChange?.({ dirty: Boolean(editor), busy: submitting })
    return () => onEditorStateChange?.({ dirty: false, busy: false })
  }, [editor, submitting, onEditorStateChange])

  useEffect(() => {
    if (!expandedUnitsKey) return
    detailRefs.current.get(expandedUnitsKey)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [expandedUnitsKey])

  const formDirty = (() => {
    if (!editor) return false
    const init = editorInitRef.current || {}
    if (editor.mode === 'inspect') {
      return inspectForm.condition !== init.condition
        || inspectForm.inspectedAt !== init.inspectedAt
        || inspectForm.note !== init.note
        || inspectForm.files.length > 0
    }
    return resolveForm.resolvedAt !== init.resolvedAt
      || resolveForm.note !== init.note
      || resolveForm.files.length > 0
  })()

  const confirmSwitch = (assetId) => {
    if (!editor || editor.asset.id === assetId) return true
    return window.confirm('Isian unit ini belum disimpan. Pindah ke unit lain?')
  }

  const openInspect = (item, asset) => {
    if (submitting || !canInspect || asset.open_issue || future) return
    if (!confirmSwitch(asset.id)) return
    const init = { condition: 'GOOD', inspectedAt: pontianakInputValue(), note: '' }
    editorInitRef.current = init
    setEditor({ mode: 'inspect', itemKey: item.key, asset })
    setInspectForm({ ...init, files: [] })
    setFormError('')
  }

  const openResolve = (item, asset) => {
    if (submitting || !canResolveIssue || !asset.open_issue || future) return
    if (!confirmSwitch(asset.id)) return
    const init = {
      resolvedAt: pontianakInputValue(),
      note: 'Serah terima alat pengganti kepada ULP.',
    }
    editorInitRef.current = init
    setEditor({ mode: 'resolve', itemKey: item.key, asset })
    setResolveForm({ ...init, files: [] })
    setFormError('')
  }

  const closeEditor = () => {
    setEditor(null)
    setFormError('')
  }

  const requestEditorClose = () => {
    if (submitting) return
    if (formDirty && !window.confirm('Isian belum disimpan. Tutup formulir?')) return
    closeEditor()
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

  if (!items.length) {
    return <p className="tool-empty">Tidak ada peralatan pada template kendaraan ini.</p>
  }

  return (
    <div className="tool-sheet">
      <div className="tool-sheet-toolbar">
        <div className="tool-sheet-search">
          <Icon name="search" size={14} />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari alat atau spesifikasi"
            aria-label="Cari alat"
          />
          {query && (
            <button type="button" className="tool-sheet-clear" onClick={() => setQuery('')} aria-label="Hapus pencarian">
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
        <label className={`tool-sheet-toggle ${onlyAttention ? 'is-active' : ''}`}>
          <input type="checkbox" checked={onlyAttention} onChange={(event) => setOnlyAttention(event.target.checked)} />
          <Icon name="filter" size={13} />
          Hanya perlu perhatian
        </label>
        <span className="tool-sheet-count">{visibleItemCount} dari {items.length} alat</span>
      </div>
      <div className="tool-matrix-wrap">
        <table className={`tool-matrix ${showInspections ? 'has-inspections' : 'no-inspections'}`} aria-label="Rekap peralatan dan inspeksi">
          <thead>
            <tr>
              <th scope="col">
                <span className="tool-matrix-th"><Icon name="operations" size={13} /> Peralatan</span>
              </th>
              <th scope="col" className="is-num tool-matrix-contract">
                <span className="tool-matrix-th"><Icon name="layers" size={13} /> Jumlah dalam Kontrak</span>
              </th>
              <th scope="col" className="is-num tool-matrix-present">
                <span className="tool-matrix-th"><Icon name="dashboard" size={13} /> Ada di ULP</span>
              </th>
              <th scope="col" className="is-num tool-matrix-qty">
                <span className="tool-matrix-th"><Icon name="check-circle" size={13} />Baik</span>
              </th>
              <th scope="col" className="is-num tool-matrix-qty">
                <span className="tool-matrix-th"><Icon name="alert-triangle" size={13} />Rusak</span>
              </th>
              <th scope="col" className="is-num">
                <span className="tool-matrix-th"><Icon name="pie-chart" size={13} />%</span>
              </th>
              {showInspections && (
                <th scope="col" className="tool-matrix-inspection">
                  <span className="tool-matrix-th"><Icon name="shield" size={13} /> Inspeksi per unit</span>
                </th>
              )}
              <th scope="col" className="tool-matrix-status">
                <span className="tool-matrix-th"><Icon name="info" size={13} /> Status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([category, rows]) => (
              <Fragment key={category}>
                <tr className="tool-matrix-category">
                  <th colSpan={columnCount}>{category}<span>{rows.length} jenis</span></th>
                </tr>
              {rows.map((item, rowIndex) => {
                const result = evaluateCondition(item)
                const unitAssets = assets.filter((asset) => asset.equipment_id === item.equipment_id)
                const issueCount = unitAssets.filter((asset) => asset.open_issue).length
                const itemHistory = history.filter((entry) => entry.equipment_name === item.name)
                const percentage = result.percentage == null
                  ? null
                  : Math.max(0, Math.min(100, Number(result.percentage.toFixed(1))))
                const percentageTone = percentage == null ? '' : percentage >= 100 ? '' : percentage >= 50 ? 'is-warning' : 'is-danger'
                const unitsExpanded = expandedUnitsKey === item.key
                return (
                  <Fragment key={item.key}>
                    <tr className={`tool-matrix-row ${result.status === 'non_compliant' ? 'is-non-compliant' : ''} ${rowIndex % 2 === 1 ? 'is-zebra' : ''}`}>
                      <td className="tool-matrix-tool">
                        <div className="tool-name">
                          <span className="tool-name-icon"><Icon name="operations" size={13} /></span>
                          <div className="tool-name-body">
                            <strong>{item.name}</strong>
                            <span className="tool-muted">{item.unit}{item.specification ? ` · ${item.specification}` : ''}</span>
                          </div>
                        </div>
                        <details className="uc-note">
                          <summary><Icon name="info" size={11} /> Catatan{item.note ? ' terisi' : ''}</summary>
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
                      <td className="tool-matrix-number tool-matrix-contract"><span className="tool-qty-value">{item.required_qty}</span></td>
                      <td className="tool-matrix-number tool-matrix-present"><span className="tool-qty-value">{item.required_qty}</span></td>
                      <td className="tool-matrix-number tool-matrix-qty">
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
                        ) : <span className="tool-qty-value">{item.good_qty ?? '-'}</span>}
                      </td>
                      <td className="tool-matrix-number tool-matrix-qty">
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
                        ) : <span className="tool-qty-value">{item.bad_qty ?? '-'}</span>}
                      </td>
                      <td className="tool-matrix-number tool-matrix-percent">
                        {percentage == null ? (
                          <span className="tool-percent-value is-muted">-</span>
                        ) : (
                          <span className="tool-percent">
                            <span className="tool-percent-track" aria-hidden="true">
                              <span className={`tool-percent-fill ${percentageTone}`} style={{ width: `${percentage}%` }} />
                            </span>
                            <span className="tool-percent-value">{percentage}%</span>
                          </span>
                        )}
                      </td>
                      {showInspections && (
                        <td className="tool-matrix-inspection">
                          {(inspectionStatus === 'idle' || inspectionStatus === 'loading') && <span className="tool-muted">Memuat rincian unit…</span>}
                          {inspectionStatus === 'error' && <span className="tool-muted">Rincian unit tidak tersedia.</span>}
                          {inspectionStatus === 'ready' && (
                            <>
                              {unitAssets.map((asset) => {
                                const status = assetStatus(asset)
                                const issue = asset.open_issue
                                return (
                                  <div className="tool-unit-summary" key={asset.id}>
                                    <span className="tool-unit-id">Unit {asset.asset_sequence}</span>
                                    <span className={`tool-unit-state tool-unit-state--${status.tone}`}>{status.label}</span>
                                    <span className="tool-unit-summary-actions">
                                      {issue && canResolveIssue && !future && (
                                        <button type="button" className="tool-action-btn is-warning" disabled={submitting} onClick={() => openResolve(item, asset)}>
                                          <Icon name="refresh-cw" size={12} /> Serah Terima
                                        </button>
                                      )}
                                      {!issue && canInspect && !future && (
                                        <button type="button" className="tool-action-btn" disabled={submitting} onClick={() => openInspect(item, asset)}>
                                          <Icon name="shield" size={12} /> Inspeksi
                                        </button>
                                      )}
                                      {issue && !canResolveIssue && <span className="tool-unit-hint"><Icon name="clock" size={11} /> Issue terbuka</span>}
                                      {!issue && !canInspect && <span className="tool-unit-hint"><Icon name="shield" size={11} /> Hanya lihat</span>}
                                    </span>
                                  </div>
                                )
                              })}
                              {!unitAssets.length && <span className="tool-muted">Belum ada unit fisik.</span>}
                              {unitAssets.length > 0 && (
                                <button
                                  type="button"
                                  className={`tool-expand-btn ${unitsExpanded ? 'is-open' : ''}`}
                                  aria-expanded={unitsExpanded}
                                  onClick={() => setExpandedUnitsKey((value) => value === item.key ? null : item.key)}
                                >
                                  <Icon name="chevron-right" size={11} />
                                  {unitsExpanded ? 'Tutup rincian unit' : 'Rincian umur & bukti'}
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      )}
                      <td className="tool-matrix-status">
                        <div className="tool-status-block">
                          <ConditionBadge status={result.status} />
                          {result.status === 'non_compliant' && (
                            <span className="tool-status-note is-danger">
                              <Icon name="alert-triangle" size={11} />
                              {Number(item.bad_qty) > 0 ? 'Ada kondisi rusak' : 'Jumlah baik kurang'}
                            </span>
                          )}
                          {result.status === 'invalid' && (
                            <span className="tool-status-note is-danger">
                              <Icon name="x-circle" size={11} />
                              {result.issue || 'Periksa jumlah kondisi.'}
                            </span>
                          )}
                          {isDefaultVehicle && (
                            <span className="tool-status-note">
                              <Icon name="info" size={11} />
                              Default rekap · belum disimpan bulan ini
                            </span>
                          )}
                          {showInspections && issueCount > 0 && (
                            <span className="tool-status-note is-warning">
                              <Icon name="alert-triangle" size={11} />
                              {issueCount} issue unit terbuka
                            </span>
                          )}
                          {showInspections && itemHistory.length > 0 && (
                            <button
                              type="button"
                              className="tool-link-button"
                              onClick={() => setExpandedHistoryKey((value) => value === item.key ? null : item.key)}
                            >
                              <Icon name="refresh-cw" size={11} />
                              Riwayat penggantian ({itemHistory.length})
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {showInspections && unitsExpanded && unitAssets.length > 0 && (
                      <tr
                        className="tool-matrix-detail-row"
                        ref={(node) => {
                          if (node) detailRefs.current.set(item.key, node)
                          else detailRefs.current.delete(item.key)
                        }}
                      >
                        <td colSpan={columnCount}>
                          <div className="tool-matrix-detail">
                            <div className="tool-matrix-detail-head">
                              <strong>Rincian unit · {item.name}</strong>
                              <button type="button" className="tool-matrix-detail-close" onClick={() => setExpandedUnitsKey(null)}>
                                Tutup rincian
                              </button>
                            </div>
                            <div className="tool-matrix-units">
                              {unitAssets.map((asset) => (
                                <UnitDetailCard key={asset.id} asset={asset} highlightedIssueId={highlightedIssueId} />
                              ))}
                            </div>
                          </div>
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
                                  <span className="tool-muted">{agePhrase(entry.age_at_failure_months, 'Umur saat rusak')} · standar {entry.standard_life_months == null ? 'belum diisi' : ageLabel(entry.standard_life_months)}</span>
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
          {!groups.length && (
            <tr>
              <td className="tool-sheet-empty" colSpan={columnCount}>
                <Icon name="search" size={15} /> Tidak ada alat yang cocok dengan pencarian atau filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      <Modal
        open={Boolean(editor)}
        onClose={requestEditorClose}
        size="large"
        dismissDisabled={submitting}
        title={editor?.mode === 'inspect'
          ? `Isi Inspeksi · ${editorItem?.name || editor?.asset.equipment_name || 'Alat'}`
          : `Serah Terima Pengganti · ${editorItem?.name || editor?.asset.equipment_name || 'Alat'}`}
        footer={(
          <div className="tool-modal-actions">
            <Button variant="ghost" disabled={submitting} onClick={requestEditorClose}>Batal</Button>
            <Button
              variant="primary"
              disabled={submitting}
              onClick={editor?.mode === 'inspect' ? submitInspection : submitResolution}
            >
              {submitting ? 'Menyimpan...' : editor?.mode === 'inspect' ? 'Simpan Inspeksi' : 'Simpan Serah Terima'}
            </Button>
          </div>
        )}
      >
        {editor && (
          editor.mode === 'inspect' ? (
            <form className="tool-form" onSubmit={submitInspection}>
              {formError && <Alert tone="danger">{formError}</Alert>}
              <ModalScope editor={editor} vehicleLabel={vehicleLabel} />
              <div className="tool-form-grid">
                <FormField label="Kondisi alat" required>
                  <Select value={inspectForm.condition} onChange={(event) => setInspectForm((current) => ({ ...current, condition: event.target.value }))}>
                    <option value="GOOD">Baik</option>
                    <option value="DAMAGED">Rusak</option>
                  </Select>
                </FormField>
                <FormField label="Tanggal & waktu inspeksi" required>
                  <Input
                    type="datetime-local"
                    value={inspectForm.inspectedAt}
                    min={editor.asset.commissioned_at ? pontianakInputValue(new Date(editor.asset.commissioned_at)) : undefined}
                    max={pontianakInputValue()}
                    onChange={(event) => setInspectForm((current) => ({ ...current, inspectedAt: event.target.value }))}
                  />
                </FormField>
                <FormField label={inspectForm.condition === 'DAMAGED' ? 'Catatan kerusakan' : 'Catatan'} required={inspectForm.condition === 'DAMAGED'}>
                  <Textarea
                    rows={2}
                    maxLength={2000}
                    value={inspectForm.note}
                    onChange={(event) => setInspectForm((current) => ({ ...current, note: event.target.value }))}
                    placeholder={inspectForm.condition === 'DAMAGED' ? 'Jelaskan kerusakan yang ditemukan' : 'Catatan pemeriksaan (opsional)'}
                  />
                </FormField>
                <FormField label="Foto bukti" required>
                  <PhotoPicker
                    files={inspectForm.files}
                    disabled={submitting}
                    onChange={(files) => setInspectForm((current) => ({ ...current, files }))}
                  />
                </FormField>
              </div>
              {inspectForm.condition === 'DAMAGED' && (
                <Alert tone="warning">
                  Kondisi Rusak membuka issue. Issue tetap terbuka sampai penggantian diserahkan dengan bukti foto.
                </Alert>
              )}
            </form>
          ) : (
            <form className="tool-form" onSubmit={submitResolution}>
              {formError && <Alert tone="danger">{formError}</Alert>}
              <ModalScope editor={editor} vehicleLabel={vehicleLabel} />
              <div className="tool-issue-scope">
                <span>Ditemukan {formatDateTime(editor.asset.open_issue?.opened_at)}</span>
                <span>{agePhrase(editor.asset.open_issue?.age_at_failure_months, 'Umur saat rusak')} · standar {editor.asset.open_issue?.standard_life_months == null ? 'belum diisi' : ageLabel(editor.asset.open_issue.standard_life_months)}</span>
                {editor.asset.open_issue?.damaged_before_life && <span className="tool-warning">Rusak sebelum masa pakai standar</span>}
                {editor.asset.open_issue?.note && <span>{editor.asset.open_issue.note}</span>}
              </div>
              <div className="tool-form-grid">
                <FormField label="Tanggal & waktu serah terima" required>
                  <Input
                    type="datetime-local"
                    value={resolveForm.resolvedAt}
                    min={editor.asset.open_issue?.opened_at ? pontianakInputValue(new Date(editor.asset.open_issue.opened_at)) : undefined}
                    max={pontianakInputValue()}
                    onChange={(event) => setResolveForm((current) => ({ ...current, resolvedAt: event.target.value }))}
                  />
                </FormField>
                <FormField label="Catatan serah terima" required>
                  <Input
                    value={resolveForm.note}
                    maxLength={2000}
                    onChange={(event) => setResolveForm((current) => ({ ...current, note: event.target.value }))}
                  />
                </FormField>
              </div>
              <FormField label="Foto alat pengganti" required>
                <PhotoPicker
                  files={resolveForm.files}
                  disabled={submitting}
                  onChange={(files) => setResolveForm((current) => ({ ...current, files }))}
                />
              </FormField>
              <Alert tone="info">
                Waktu serah terima menjadi awal masa pakai alat pengganti dan bukti penyerahan dari K3 ke ULP.
              </Alert>
            </form>
          )
        )}
      </Modal>
    </div>
  )
}
