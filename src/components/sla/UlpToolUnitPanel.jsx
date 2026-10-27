import { useEffect, useState } from 'react'
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
  getToolEvidenceUrl,
  resolveToolIssue,
  submitToolInspection,
  uploadToolEvidence,
} from '../../data/toolInspectionRepository.js'
import { prepareToolEvidence } from '../../data/toolEvidence.js'

const MAX_PHOTOS = 5

function formatDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Pontianak',
  }).format(new Date(value))
}

function pontianakParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Pontianak',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]))
}

function pontianakInputValue(value = new Date()) {
  const parts = pontianakParts(value)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function inputValueToIso(value) {
  if (!value) return null
  const parsed = new Date(`${value}:00+07:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function ageLabel(months) {
  if (months == null) return 'Umur belum diketahui'
  if (months < 12) return `${months} bulan`
  const years = Math.floor(months / 12)
  const rest = months % 12
  return rest ? `${years} tahun ${rest} bulan` : `${years} tahun`
}

function assetStatus(asset) {
  if (asset.open_issue) return { tone: 'danger', label: 'Rusak · issue terbuka' }
  if (asset.latest_inspection?.condition === 'DAMAGED') return { tone: 'danger', label: 'Rusak' }
  if (asset.latest_inspection?.condition === 'GOOD') return { tone: 'success', label: 'Baik' }
  return { tone: 'neutral', label: 'Belum diperiksa' }
}

function EvidenceThumbs({ paths = [] }) {
  const key = paths.join('|')
  const [urls, setUrls] = useState([])
  useEffect(() => {
    let cancelled = false
    if (!paths.length) { setUrls([]); return undefined }
    Promise.all(paths.slice(0, MAX_PHOTOS).map(async (path) => {
      try { return await getToolEvidenceUrl(path) } catch { return '' }
    })).then((rows) => {
      if (!cancelled) setUrls(rows.filter(Boolean))
    })
    return () => { cancelled = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!paths.length) return null
  if (!urls.length) return <span className="tool-muted">Memuat foto…</span>
  return (
    <span className="tool-evidence-thumbs">
      {urls.map((url, index) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" title={`Bukti ${index + 1}`}>
          <img src={url} alt={`Bukti ${index + 1}`} loading="lazy" />
        </a>
      ))}
    </span>
  )
}

function PhotoPicker({ files, onChange, disabled }) {
  return (
    <div className="tool-photo-picker">
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={disabled}
        onChange={(event) => {
          onChange(Array.from(event.target.files || []).slice(0, MAX_PHOTOS))
          event.target.value = ''
        }}
      />
      <span className="tool-muted">Wajib 1–{MAX_PHOTOS} foto. JPG/PNG/WebP, maksimal 12 MB per foto.</span>
      {files.length > 0 && (
        <ul className="tool-file-list">
          {files.map((file) => <li key={`${file.name}:${file.size}`}>{file.name}</li>)}
        </ul>
      )}
    </div>
  )
}

export default function UlpToolUnitPanel({
  contractUuid,
  up3Uuid,
  ulpId,
  vehicle,
  assets = [],
  history = [],
  canInspect = false,
  canResolveIssue = false,
  highlightedIssueId = null,
  onChanged,
  onMessage,
  onEditorStateChange,
}) {
  const [inspectTarget, setInspectTarget] = useState(null)
  const [inspectForm, setInspectForm] = useState({ condition: 'GOOD', inspectedAt: pontianakInputValue(), note: '', files: [] })
  const [inspectError, setInspectError] = useState('')
  const [resolveTarget, setResolveTarget] = useState(null)
  const [resolveForm, setResolveForm] = useState({ resolvedAt: pontianakInputValue(), note: '', files: [] })
  const [resolveError, setResolveError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    onEditorStateChange?.({ dirty: Boolean(inspectTarget || resolveTarget), busy: submitting })
    return () => onEditorStateChange?.({ dirty: false, busy: false })
  }, [inspectTarget, resolveTarget, submitting, onEditorStateChange])

  const checkedCount = assets.filter((asset) => asset.latest_inspection).length
  const issueCount = assets.filter((asset) => asset.open_issue).length

  const openInspect = (asset) => {
    if (!canInspect || asset.open_issue) return
    setInspectTarget({ asset })
    setInspectForm({ condition: 'GOOD', inspectedAt: pontianakInputValue(), note: '', files: [] })
    setInspectError('')
  }

  const submitInspection = async (event) => {
    event.preventDefault()
    if (!inspectTarget) return
    setInspectError('')
    if (!inspectForm.inspectedAt) { setInspectError('Tanggal dan waktu inspeksi wajib diisi.'); return }
    if (inspectForm.condition === 'DAMAGED' && !inspectForm.note.trim()) {
      setInspectError('Catatan kerusakan wajib diisi.')
      return
    }
    if (!inspectForm.files.length) { setInspectError('Minimal satu foto bukti wajib diunggah.'); return }
    setSubmitting(true)
    try {
      const paths = []
      for (const file of inspectForm.files) {
        const prepared = await prepareToolEvidence(file)
        paths.push(await uploadToolEvidence({
          contractId: contractUuid,
          up3Id: up3Uuid,
          ulpId,
          assetId: inspectTarget.asset.id,
          file: prepared,
        }))
      }
      const result = await submitToolInspection({
        assetId: inspectTarget.asset.id,
        inspectedAt: inputValueToIso(inspectForm.inspectedAt),
        condition: inspectForm.condition,
        note: inspectForm.note.trim(),
        photoPaths: paths,
      })
      onMessage?.(result?.issue
        ? `Kerusakan ${inspectTarget.asset.equipment_name} dicatat. Issue terbuka dan notifikasi dikirim ke Admin UP3 serta manajemen terkait.`
        : `Kondisi ${inspectTarget.asset.equipment_name} tersimpan sebagai Baik.`)
      setInspectTarget(null)
      onChanged?.()
    } catch (submitError) {
      setInspectError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const openResolve = (asset) => {
    if (!canResolveIssue || !asset.open_issue) return
    setResolveTarget({
      ...asset.open_issue,
      asset_id: asset.id,
      equipment_name: asset.equipment_name,
      vehicle_label: vehicle?.label || '',
      plate_display: vehicle?.plate_display || '',
    })
    setResolveForm({
      resolvedAt: pontianakInputValue(),
      note: 'Serah terima alat pengganti kepada ULP.',
      files: [],
    })
    setResolveError('')
  }

  const submitResolution = async (event) => {
    event.preventDefault()
    if (!resolveTarget) return
    setResolveError('')
    if (!resolveForm.resolvedAt) { setResolveError('Tanggal dan waktu serah terima wajib diisi.'); return }
    if (!resolveForm.note.trim()) { setResolveError('Catatan serah terima wajib diisi.'); return }
    if (!resolveForm.files.length) { setResolveError('Minimal satu foto alat pengganti wajib diunggah.'); return }
    setSubmitting(true)
    try {
      const paths = []
      for (const file of resolveForm.files) {
        const prepared = await prepareToolEvidence(file)
        paths.push(await uploadToolEvidence({
          contractId: contractUuid,
          up3Id: up3Uuid,
          ulpId,
          assetId: resolveTarget.asset_id,
          file: prepared,
        }))
      }
      await resolveToolIssue({
        issueId: resolveTarget.id,
        resolvedAt: inputValueToIso(resolveForm.resolvedAt),
        note: resolveForm.note.trim(),
        photoPaths: paths,
        expectedRevision: resolveTarget.revision,
      })
      onMessage?.(`Issue ${resolveTarget.equipment_name} selesai. Masa pakai alat pengganti dimulai dari waktu serah terima.`)
      setResolveTarget(null)
      onChanged?.()
    } catch (submitError) {
      setResolveError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="tool-unit-panel">
      <div className="tool-section-heading">
        <h3>Unit alat</h3>
        <span>{checkedCount}/{assets.length} unit diperiksa · {issueCount} issue terbuka</span>
      </div>
      <p className="tool-muted">
        Rincian ini tambahan. Rekap jumlah Baik/Rusak di atas tetap menjadi laporan bulanan.
      </p>

      <div className="tool-table-wrap">
        <table className="tool-table">
          <thead>
            <tr>
              <th>Alat</th>
              <th>Kondisi</th>
              <th>Inspeksi terakhir</th>
              <th>Masa pakai</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const status = assetStatus(asset)
              const issue = asset.open_issue
              const age = issue ? issue.age_at_failure_months : asset.age_months
              const life = issue ? issue.standard_life_months : asset.useful_life_months
              const beforeLife = issue?.damaged_before_life
              const highlighted = issue && String(issue.id) === String(highlightedIssueId)
              return (
                <tr key={asset.id} className={`${issue ? 'is-issue' : ''} ${highlighted ? 'is-highlighted' : ''}`}>
                  <td data-label="Alat">
                    <strong>{asset.equipment_name}</strong>
                    <span className="tool-muted">{asset.equipment_code} · Unit {asset.asset_sequence}</span>
                    {asset.specification && <span className="tool-muted">{asset.specification}</span>}
                  </td>
                  <td data-label="Kondisi">
                    <span className={`tool-badge tool-badge-${status.tone}`}>{status.label}</span>
                    {beforeLife && <span className="tool-warning">Rusak sebelum masa pakai</span>}
                    {issue && issue.damaged_before_life === false && <span className="tool-muted">Masih dalam masa pakai</span>}
                    {issue && issue.age_at_failure_months == null && <span className="tool-muted">Umur saat rusak belum diketahui</span>}
                    {issue?.note && <span className="tool-note">{issue.note}</span>}
                  </td>
                  <td data-label="Inspeksi terakhir">
                    {asset.latest_inspection ? (
                      <>
                        <span>{formatDateTime(asset.latest_inspection.inspected_at)}</span>
                        <span className="tool-muted">{asset.latest_inspection.inspected_by_name || 'Petugas inspeksi'}</span>
                        <EvidenceThumbs paths={asset.latest_inspection.photo_paths || []} />
                      </>
                    ) : <span className="tool-muted">Belum ada inspeksi</span>}
                  </td>
                  <td data-label="Masa pakai">
                    <span>{ageLabel(age)}</span>
                    <span className="tool-muted">
                      Standar {life == null ? 'belum diisi' : ageLabel(life)}
                      {asset.remaining_months != null && !issue ? ` · sisa ${ageLabel(Math.max(0, asset.remaining_months))}` : ''}
                    </span>
                    <span className="tool-muted">
                      {asset.commissioned_at
                        ? `Mulai pakai ${formatDateTime(asset.commissioned_at)}`
                        : 'Awal masa pakai belum tercatat'}
                    </span>
                  </td>
                  <td data-label="Aksi">
                    {issue && canResolveIssue && (
                      <Button variant="primary" size="small" onClick={() => openResolve(asset)}>Selesaikan</Button>
                    )}
                    {!issue && canInspect && (
                      <Button variant="secondary" size="small" disabled={!asset.id} onClick={() => openInspect(asset)}>
                        Inspeksi
                      </Button>
                    )}
                    {!issue && !canInspect && <span className="tool-muted">Hanya lihat</span>}
                    {issue && !canResolveIssue && <span className="tool-muted">Menunggu K3/Admin</span>}
                  </td>
                </tr>
              )
            })}
            {!assets.length && (
              <tr><td colSpan={5} className="tool-empty">Belum ada alat pada kendaraan ini.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="tool-history">
        <div className="tool-section-heading">
          <h3>Riwayat penggantian</h3>
          <span>{history.length} catatan</span>
        </div>
        {history.length === 0 ? (
          <p className="tool-muted">Belum ada alat yang diganti pada kendaraan ini.</p>
        ) : (
          <ul className="tool-history-list">
            {history.map((entry) => (
              <li key={entry.issue_id}>
                <div>
                  <strong>{entry.equipment_name}</strong>
                  <span>Rusak {formatDateTime(entry.opened_at)} · diganti {formatDateTime(entry.resolved_at)}</span>
                </div>
                <div>
                  <span className="tool-muted">Umur saat rusak {ageLabel(entry.age_at_failure_months)} · standar {entry.standard_life_months == null ? 'belum diisi' : ageLabel(entry.standard_life_months)}</span>
                  {entry.damaged_before_life && <span className="tool-warning">Rusak sebelum masa pakai</span>}
                  {entry.resolution_note && <span className="tool-note">{entry.resolution_note}</span>}
                  {entry.inspection_photo_paths?.length > 0 && (
                    <span className="tool-muted">Bukti kerusakan</span>
                  )}
                  <EvidenceThumbs paths={entry.inspection_photo_paths || []} />
                  <span className="tool-muted">Bukti serah terima</span>
                  <EvidenceThumbs paths={entry.handover_photo_paths || []} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={Boolean(inspectTarget)}
        onClose={() => { if (!submitting) setInspectTarget(null) }}
        title={`Inspeksi ${inspectTarget?.asset?.equipment_name || 'alat'}`}
        size="large"
        dismissDisabled={submitting}
        footer={(
          <>
            <Button variant="ghost" disabled={submitting} onClick={() => setInspectTarget(null)}>Batal</Button>
            <Button variant="primary" disabled={submitting} onClick={submitInspection}>
              {submitting ? 'Menyimpan...' : 'Simpan Inspeksi'}
            </Button>
          </>
        )}
      >
        <form className="tool-form" onSubmit={submitInspection}>
          {inspectError && <Alert tone="danger">{inspectError}</Alert>}
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
                min={inspectTarget?.asset?.commissioned_at ? pontianakInputValue(new Date(inspectTarget.asset.commissioned_at)) : undefined}
                max={pontianakInputValue()}
                onChange={(event) => setInspectForm((current) => ({ ...current, inspectedAt: event.target.value }))}
              />
            </FormField>
          </div>
          <FormField label={inspectForm.condition === 'DAMAGED' ? 'Catatan kerusakan' : 'Catatan'} required={inspectForm.condition === 'DAMAGED'}>
            <Textarea
              rows={3}
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
          {inspectForm.condition === 'DAMAGED' && (
            <Alert tone="warning">
              Menyimpan kondisi Rusak akan membuka issue dan mengirim notifikasi. Issue tetap terbuka sampai
              penggantian diserahkan dengan bukti foto.
            </Alert>
          )}
        </form>
      </Modal>

      <Modal
        open={Boolean(resolveTarget)}
        onClose={() => { if (!submitting) setResolveTarget(null) }}
        title={`Selesaikan issue ${resolveTarget?.equipment_name || 'alat'}`}
        size="large"
        dismissDisabled={submitting}
        footer={(
          <>
            <Button variant="ghost" disabled={submitting} onClick={() => setResolveTarget(null)}>Batal</Button>
            <Button variant="primary" disabled={submitting} onClick={submitResolution}>
              {submitting ? 'Menyimpan...' : 'Simpan Serah Terima'}
            </Button>
          </>
        )}
      >
        <form className="tool-form" onSubmit={submitResolution}>
          {resolveError && <Alert tone="danger">{resolveError}</Alert>}
          <div className="tool-issue-scope">
            <span>Ditemukan {formatDateTime(resolveTarget?.opened_at)}</span>
            <span>{resolveTarget?.vehicle_label}{resolveTarget?.plate_display ? ` · ${resolveTarget.plate_display}` : ''}</span>
            <span>Umur saat rusak {ageLabel(resolveTarget?.age_at_failure_months)} · standar {resolveTarget?.standard_life_months == null ? 'belum diisi' : ageLabel(resolveTarget.standard_life_months)}</span>
            {resolveTarget?.damaged_before_life && <span className="tool-warning">Rusak sebelum masa pakai standar</span>}
          </div>
          <div className="tool-form-grid">
            <FormField label="Tanggal & waktu serah terima" required>
              <Input
                type="datetime-local"
                value={resolveForm.resolvedAt}
                min={resolveTarget?.opened_at ? pontianakInputValue(new Date(resolveTarget.opened_at)) : undefined}
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
            Waktu serah terima ini menjadi awal masa pakai alat pengganti dan bukti penyerahan dari K3 ke ULP.
          </Alert>
        </form>
      </Modal>
    </div>
  )
}
