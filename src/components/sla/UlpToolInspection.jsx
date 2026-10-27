import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  FormField,
  Input,
  Modal,
  Select,
  StatePanel,
  Textarea,
} from '../ui/Primitives.jsx'
import {
  correctPrescribedVehiclePlate,
  setPrescribedVehiclePlate,
} from '../../data/ulpConditionRepository.js'
import {
  getToolEvidenceUrl,
  getToolInspectionBundle,
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

function vehicleLocationLabel(vehicle) {
  if (!vehicle?.location_name) return ''
  return vehicle.location_type === 'KANTOR_JAGA' ? `KJ ${vehicle.location_name}` : vehicle.location_name
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

export default function UlpToolInspection({
  contractUuid,
  up3Uuid,
  ownUlpUuid,
  canPickUlp = false,
  units = [],
  canManagePlate = false,
  canInspect = false,
  canResolveIssue = false,
  issueTarget = null,
  onEditorStateChange,
  onOpenStandards,
}) {
  const ulps = useMemo(() => units.filter((unit) => unit.type === 'ULP'), [units])
  const [ulpId, setUlpId] = useState(() => (
    canPickUlp ? (units.find((unit) => unit.type === 'ULP')?.uuid ?? '') : (ownUlpUuid || '')
  ))
  const [bundle, setBundle] = useState({ vehicles: [], history: [], openIssues: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [selectedVehicleId, setSelectedVehicleId] = useState(null)
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [plates, setPlates] = useState({})
  const [plateEdit, setPlateEdit] = useState(null)
  const [plateBusy, setPlateBusy] = useState(false)
  const [plateError, setPlateError] = useState('')
  const [inspectTarget, setInspectTarget] = useState(null)
  const [inspectForm, setInspectForm] = useState({ condition: 'GOOD', inspectedAt: pontianakInputValue(), note: '', files: [] })
  const [inspectError, setInspectError] = useState('')
  const [resolveTarget, setResolveTarget] = useState(null)
  const [resolveForm, setResolveForm] = useState({ resolvedAt: pontianakInputValue(), note: '', files: [] })
  const [resolveError, setResolveError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [highlightIssueId, setHighlightIssueId] = useState(null)
  const requestRef = useRef(0)

  useEffect(() => {
    if (!canPickUlp) setUlpId(ownUlpUuid || '')
  }, [canPickUlp, ownUlpUuid])

  useEffect(() => {
    if (!ulpId && canPickUlp && ulps.length) setUlpId(ulps[0].uuid)
  }, [canPickUlp, ulpId, ulps])

  useEffect(() => {
    if (!issueTarget?.token) return
    if (issueTarget.ulpId) setUlpId(issueTarget.ulpId)
    setHighlightIssueId(issueTarget.issueId ?? null)
  }, [issueTarget?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true
    const token = ++requestRef.current
    if (!contractUuid || !up3Uuid || !ulpId) {
      if (!canPickUlp || ulpId) {
        setError('Scope ULP belum tersedia. Muat ulang halaman atau hubungi administrator.')
      }
      setLoading(false)
      return undefined
    }
    setLoading(true)
    setError('')
    getToolInspectionBundle({ contractId: contractUuid, up3Id: up3Uuid, ulpId })
      .then((data) => {
        if (!active || token !== requestRef.current) return
        setBundle(data)
        setPlates(Object.fromEntries(data.vehicles.map((vehicle) => [vehicle.id, vehicle.plate_display || ''])))
      })
      .catch((loadError) => {
        if (active && token === requestRef.current) {
          setBundle({ vehicles: [], history: [], openIssues: [] })
          setError(loadError.message)
        }
      })
      .finally(() => {
        if (active && token === requestRef.current) setLoading(false)
      })
    return () => { active = false }
  }, [canPickUlp, contractUuid, reloadToken, ulpId, up3Uuid])

  useEffect(() => {
    if (!issueTarget?.issueId || !bundle.openIssues.length) return
    const issue = bundle.openIssues.find((row) => String(row.id) === String(issueTarget.issueId))
    if (issue) {
      setSelectedVehicleId(issue.vehicle_id)
      setHighlightIssueId(issue.id)
    }
  }, [bundle.openIssues, issueTarget?.issueId])

  useEffect(() => {
    onEditorStateChange?.({ dirty: Boolean(inspectTarget || resolveTarget), busy: submitting })
    return () => onEditorStateChange?.({ dirty: false, busy: false })
  }, [inspectTarget, resolveTarget, submitting, onEditorStateChange])

  const assets = useMemo(() => bundle.vehicles.flatMap((vehicle) => (
    vehicle.assets.map((asset) => ({ ...asset, vehicle }))
  )), [bundle.vehicles])
  const openIssueCount = assets.filter((asset) => asset.open_issue).length
  const goodCount = assets.filter((asset) => !asset.open_issue && asset.latest_inspection?.condition === 'GOOD').length
  const uncheckedCount = assets.filter((asset) => !asset.latest_inspection).length
  const selectedVehicle = bundle.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || null
  const selectedHistory = selectedVehicle
    ? bundle.history.filter((entry) => entry.vehicle_id === selectedVehicle.id)
    : []
  const filteredVehicles = bundle.vehicles.filter((vehicle) => {
    const query = vehicleSearch.trim().toLowerCase()
    if (!query) return true
    return `${vehicle.label} ${vehicle.plate_display || ''} ${vehicle.template_name || ''}`.toLowerCase().includes(query)
  })

  const changeUlp = (value) => {
    setUlpId(value)
    setSelectedVehicleId(null)
    setVehicleSearch('')
    setMessage('')
    setError('')
    setPlateEdit(null)
  }

  const openInspect = (asset, vehicle) => {
    if (!canInspect || asset.open_issue) return
    setInspectTarget({ asset, vehicle })
    setInspectForm({ condition: 'GOOD', inspectedAt: pontianakInputValue(), note: '', files: [] })
    setInspectError('')
    setMessage('')
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
      setMessage(result?.issue
        ? `Kerusakan ${inspectTarget.asset.equipment_name} dicatat. Issue terbuka dan notifikasi dikirim ke Admin UP3 serta manajemen terkait.`
        : `Kondisi ${inspectTarget.asset.equipment_name} tersimpan sebagai Baik.`)
      setInspectTarget(null)
      setReloadToken((value) => value + 1)
    } catch (submitError) {
      setInspectError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const openResolve = (issue) => {
    if (!canResolveIssue) return
    setResolveTarget(issue)
    setResolveForm({
      resolvedAt: pontianakInputValue(),
      note: 'Serah terima alat pengganti kepada ULP.',
      files: [],
    })
    setResolveError('')
    setMessage('')
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
      setMessage(`Issue ${resolveTarget.equipment_name} selesai. Masa pakai alat pengganti dimulai dari waktu serah terima.`)
      setResolveTarget(null)
      setReloadToken((value) => value + 1)
    } catch (submitError) {
      setResolveError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const savePlate = async (vehicle) => {
    const plate = (plates[vehicle.id] || '').trim()
    if (!plate) { setPlateError('Nomor polisi wajib diisi.'); return }
    setPlateBusy(true)
    setPlateError('')
    setMessage('')
    try {
      const saved = await setPrescribedVehiclePlate(vehicle, plate)
      setBundle((current) => ({
        ...current,
        vehicles: current.vehicles.map((row) => row.id === vehicle.id
          ? { ...row, plate_display: saved.plate_display, plate_normalized: saved.plate_normalized, revision: saved.revision }
          : row),
      }))
      setPlates((current) => ({ ...current, [vehicle.id]: saved.plate_display }))
      setMessage(`Nopol ${saved.plate_display} tersimpan.`)
    } catch (saveError) {
      setPlateError(saveError.message)
    } finally {
      setPlateBusy(false)
    }
  }

  const savePlateCorrection = async () => {
    if (!plateEdit) return
    const plate = plateEdit.plate.trim()
    const reason = plateEdit.reason.trim()
    if (!plate) { setPlateError('Nomor polisi baru wajib diisi.'); return }
    if (!reason) { setPlateError('Alasan koreksi wajib diisi.'); return }
    setPlateBusy(true)
    setPlateError('')
    setMessage('')
    try {
      const saved = await correctPrescribedVehiclePlate(
        { id: plateEdit.vehicleId, revision: plateEdit.revision },
        plate,
        reason,
      )
      const fixed = saved?.slot || {}
      setBundle((current) => ({
        ...current,
        vehicles: current.vehicles.map((row) => row.id === fixed.id
          ? { ...row, plate_display: fixed.plate_display, plate_normalized: fixed.plate_normalized, revision: fixed.revision }
          : row),
      }))
      setPlates((current) => ({ ...current, [fixed.id]: fixed.plate_display }))
      setPlateEdit(null)
      setMessage(`Nopol dikoreksi menjadi ${fixed.plate_display}.`)
    } catch (saveError) {
      setPlateError(saveError.message)
    } finally {
      setPlateBusy(false)
    }
  }

  if (loading) return <StatePanel state="loading" title="Memuat inspeksi alat" />
  if (error) {
    return (
      <StatePanel state="error" title="Inspeksi alat tidak tersedia">
        <p>{error}</p>
        <Button variant="secondary" onClick={() => setReloadToken((value) => value + 1)}>Muat ulang</Button>
      </StatePanel>
    )
  }

  return (
    <div className="tool-inspection">
      <header className="uc-header">
        <div>
          <span className="uc-eyebrow">INSPEKSI PER ALAT</span>
          <h2>Alat &amp; Kendaraan</h2>
          <p>
            Periksa setiap alat satu per satu. Kerusakan membuka issue sampai alat pengganti diserahkan
            dengan bukti foto; waktu serah terima menjadi awal masa pakai alat baru.
          </p>
        </div>
        <div className="uc-context">
          {onOpenStandards && (
            <Button variant="secondary" size="small" onClick={onOpenStandards}>Kelola Template &amp; Kendaraan</Button>
          )}
          <label className="tool-scope-select">
            <span>ULP</span>
            <Select value={ulpId} disabled={!canPickUlp} onChange={(event) => changeUlp(event.target.value)}>
              {!canPickUlp && <option value={ulpId}>{ulps.find((unit) => unit.uuid === ulpId)?.displayName || 'ULP'}</option>}
              {canPickUlp && ulps.map((unit) => <option key={unit.uuid} value={unit.uuid}>{unit.displayName}</option>)}
            </Select>
          </label>
          <Button variant="secondary" size="small" onClick={() => setReloadToken((value) => value + 1)}>Muat ulang</Button>
        </div>
      </header>

      {message && <Alert tone="success" className="tool-alert">{message}</Alert>}
      {plateError && <Alert tone="danger" className="tool-alert">{plateError}</Alert>}

      <div className="tool-summary-grid">
        <div className="tool-summary-card"><span>Total alat</span><strong>{assets.length}</strong></div>
        <div className="tool-summary-card tool-summary-ok"><span>Baik</span><strong>{goodCount}</strong></div>
        <div className="tool-summary-card tool-summary-danger"><span>Issue terbuka</span><strong>{openIssueCount}</strong></div>
        <div className="tool-summary-card"><span>Belum diperiksa</span><strong>{uncheckedCount}</strong></div>
      </div>

      {bundle.openIssues.length > 0 && (
        <section className="tool-issues">
          <div className="tool-section-heading">
            <h3>Temuan terbuka</h3>
            <span>{bundle.openIssues.length} issue menunggu penggantian</span>
          </div>
          <div className="tool-issue-grid">
            {bundle.openIssues.map((issue) => (
              <article className={`tool-issue-card ${String(issue.id) === String(highlightIssueId) ? 'is-highlighted' : ''}`} key={issue.id}>
                <div>
                  <strong>{issue.equipment_name}</strong>
                  <span>{issue.vehicle_label}{issue.plate_display ? ` · ${issue.plate_display}` : ''}</span>
                </div>
                <dl>
                  <div><dt>Ditemukan</dt><dd>{formatDateTime(issue.opened_at)}</dd></div>
                  <div><dt>Umur saat rusak</dt><dd>{ageLabel(issue.age_at_failure_months)}</dd></div>
                  <div><dt>Standar</dt><dd>{issue.standard_life_months == null ? 'Belum diisi' : ageLabel(issue.standard_life_months)}</dd></div>
                </dl>
                {issue.damaged_before_life && <span className="tool-warning">Rusak sebelum masa pakai standar</span>}
                {issue.damaged_before_life === false && <span className="tool-muted">Masih dalam masa pakai standar</span>}
                {issue.age_at_failure_months == null && <span className="tool-muted">Umur saat rusak belum diketahui</span>}
                {issue.note && <p>{issue.note}</p>}
                <EvidenceThumbs paths={assets.find((asset) => asset.id === issue.asset_id)?.latest_inspection?.photo_paths || []} />
                <div className="tool-issue-actions">
                  <Button variant="secondary" size="small" onClick={() => setSelectedVehicleId(issue.vehicle_id)}>Lihat kendaraan</Button>
                  {canResolveIssue && <Button variant="primary" size="small" onClick={() => openResolve(issue)}>Selesaikan</Button>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {!selectedVehicle ? (
        <section className="tool-vehicle-section">
          <div className="tool-section-heading">
            <h3>Kendaraan &amp; alat</h3>
            <Input
              className="tool-search"
              value={vehicleSearch}
              onChange={(event) => setVehicleSearch(event.target.value)}
              placeholder="Cari nopol, kendaraan, atau template"
              aria-label="Cari kendaraan"
            />
          </div>
          <div className="tool-vehicle-grid">
            {filteredVehicles.map((vehicle) => {
              const toolCount = vehicle.assets.length
              const issues = vehicle.assets.filter((asset) => asset.open_issue).length
              const checked = vehicle.assets.filter((asset) => asset.latest_inspection).length
              return (
                <button type="button" className="tool-vehicle-card" key={vehicle.id} onClick={() => setSelectedVehicleId(vehicle.id)}>
                  <span className="tool-vehicle-title">
                    <strong>{vehicle.plate_display || 'Nopol belum diisi'}</strong>
                    <span>{vehicle.label}</span>
                  </span>
                  <span className="tool-vehicle-meta">{vehicle.template_name} · Versi {vehicle.template_version}</span>
                  <span className="tool-vehicle-meta">{vehicleLocationLabel(vehicle) || 'Lokasi belum diisi'}</span>
                  <span className="tool-vehicle-stats">
                    <span>{checked}/{toolCount} diperiksa</span>
                    {issues > 0
                      ? <span className="tool-badge tool-badge-danger">{issues} issue</span>
                      : <span className="tool-badge tool-badge-success">Tidak ada issue</span>}
                  </span>
                </button>
              )
            })}
            {!filteredVehicles.length && <p className="tool-empty">Tidak ada kendaraan yang cocok.</p>}
          </div>
        </section>
      ) : (
        <section className="tool-detail">
          <div className="tool-detail-head">
            <Button variant="ghost" size="small" onClick={() => setSelectedVehicleId(null)}>← Kembali</Button>
            <div>
              <h3>{selectedVehicle.plate_display || 'Nopol belum diisi'}</h3>
              <span>{selectedVehicle.label} · {selectedVehicle.template_name} · Versi {selectedVehicle.template_version}</span>
              <span>{vehicleLocationLabel(selectedVehicle) || 'Lokasi belum diisi'}</span>
            </div>
          </div>

          <div className="tool-plate-box">
            <div>
              <span className="tool-label">Nomor polisi</span>
              <strong>{selectedVehicle.plate_display || 'Belum diisi'}</strong>
            </div>
            {canManagePlate && !selectedVehicle.plate_display && (
              <div className="tool-plate-form">
                <Input
                  value={plates[selectedVehicle.id] || ''}
                  onChange={(event) => setPlates((current) => ({ ...current, [selectedVehicle.id]: event.target.value }))}
                  placeholder="Contoh: KB 1234 XX"
                  maxLength={30}
                />
                <Button variant="primary" size="small" disabled={plateBusy} onClick={() => savePlate(selectedVehicle)}>
                  {plateBusy ? 'Menyimpan...' : 'Simpan Nopol'}
                </Button>
              </div>
            )}
            {canManagePlate && selectedVehicle.plate_display && !plateEdit && (
              <Button
                variant="secondary"
                size="small"
                onClick={() => {
                  setPlateEdit({
                    vehicleId: selectedVehicle.id,
                    revision: selectedVehicle.revision,
                    plate: selectedVehicle.plate_display,
                    reason: '',
                  })
                  setPlateError('')
                }}
              >
                Koreksi Nopol
              </Button>
            )}
            {plateEdit?.vehicleId === selectedVehicle.id && (
              <div className="tool-plate-correction">
                <FormField label="Nomor polisi baru" required>
                  <Input value={plateEdit.plate} maxLength={30} onChange={(event) => setPlateEdit((current) => ({ ...current, plate: event.target.value }))} />
                </FormField>
                <FormField label="Alasan koreksi" required>
                  <Textarea rows={2} maxLength={500} value={plateEdit.reason} onChange={(event) => setPlateEdit((current) => ({ ...current, reason: event.target.value }))} />
                </FormField>
                <div className="tool-plate-actions">
                  <Button variant="ghost" size="small" onClick={() => setPlateEdit(null)}>Batal</Button>
                  <Button variant="primary" size="small" disabled={plateBusy} onClick={savePlateCorrection}>Simpan Koreksi</Button>
                </div>
              </div>
            )}
          </div>

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
                {selectedVehicle.assets.map((asset) => {
                  const status = assetStatus(asset)
                  const issue = asset.open_issue
                  const age = issue ? issue.age_at_failure_months : asset.age_months
                  const life = issue ? issue.standard_life_months : asset.useful_life_months
                  const beforeLife = issue?.damaged_before_life
                  return (
                    <tr key={asset.id} className={issue ? 'is-issue' : ''}>
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
                          <Button variant="primary" size="small" onClick={() => openResolve(issue)}>Selesaikan</Button>
                        )}
                        {!issue && canInspect && (
                          <Button variant="secondary" size="small" disabled={!asset.id} onClick={() => openInspect(asset, selectedVehicle)}>
                            Inspeksi
                          </Button>
                        )}
                        {!issue && !canInspect && <span className="tool-muted">Hanya lihat</span>}
                      </td>
                    </tr>
                  )
                })}
                {!selectedVehicle.assets.length && (
                  <tr><td colSpan={5} className="tool-empty">Belum ada alat pada kendaraan ini.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <section className="tool-history">
            <div className="tool-section-heading">
              <h3>Riwayat penggantian</h3>
              <span>{selectedHistory.length} catatan</span>
            </div>
            {selectedHistory.length === 0 ? (
              <p className="tool-muted">Belum ada alat yang diganti pada kendaraan ini.</p>
            ) : (
              <ul className="tool-history-list">
                {selectedHistory.map((entry) => (
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
        </section>
      )}

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
