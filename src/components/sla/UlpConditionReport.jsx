import { useEffect, useRef, useState } from 'react'
import {
  CONDITION_LABELS, applyMonthlyConditionDefaults, conditionMonthLabel, conditionSnapshot, currentConditionMonth,
  defaultVehicleIds, evaluateCondition, groupVehicleConditions, parseConditionCount,
  summarizeConditions, summarizeFleet, summarizeVehicle,
} from '../../data/ulpConditionDomain.js'
import {
  correctPrescribedVehiclePlate, getUlpConditionReport, listUlpConditionOverview, saveUlpVehicleCondition, setPrescribedVehiclePlate,
} from '../../data/ulpConditionRepository.js'
import { getToolInspectionBundle } from '../../data/toolInspectionRepository.js'
import UlpToolInspectionMatrix from './UlpToolInspectionMatrix.jsx'
import UlpToolUnitPanel from './UlpToolUnitPanel.jsx'

function Status({ value }) {
  return <span className={`uc-status uc-status--${value || 'unfilled'}`}>{CONDITION_LABELS[value] || 'Belum Diisi'}</span>
}

function timestamp(value) {
  return value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Pontianak' }).format(new Date(value)) : ''
}

function vehicleLocationLabel(vehicle) {
  if (!vehicle?.location_name) return ''
  return vehicle.location_type === 'KANTOR_JAGA' ? `KJ ${vehicle.location_name}` : vehicle.location_name
}

function historyStatus(entry) {
  const historyItems = applyMonthlyConditionDefaults(entry?.snapshot?.items || [])
  return summarizeFleet(entry?.snapshot?.vehicles || [], historyItems).status
}

function vehicleBadge(summary) {
  if (summary.hasAttention) return { tone: 'attention', label: 'Perlu Perhatian' }
  if (summary.filled === 0) return { tone: 'empty', label: 'Belum Diisi' }
  if (!summary.isComplete) return { tone: 'incomplete', label: 'Belum Lengkap' }
  return { tone: 'compliant', label: 'Memenuhi' }
}

export default function UlpConditionReport({
  contractUuid, up3Uuid, ownUlpUuid, canManage, canManagePlate = false, canInspect = false,
  canResolveIssue = false, canPickUlp, units = [], initialMonth, initialUlpId = null,
  overviewEnabled = true, onMonthChange, onEditorStateChange, onOpenStandards, issueTarget = null,
}) {
  const ulps = units.filter((unit) => unit.type === 'ULP')
  const [ulpId, setUlpId] = useState(() => {
    if (!canPickUlp) return ownUlpUuid || ''
    if (initialUlpId && ulps.some((unit) => unit.uuid === initialUlpId)) return initialUlpId
    return overviewEnabled ? '' : (ulps[0]?.uuid || '')
  })
  const [month, setMonth] = useState(initialMonth?.slice(0, 7) || currentConditionMonth())
  const [bundle, setBundle] = useState(null)
  const [items, setItems] = useState([])
  const [baselineItems, setBaselineItems] = useState([])
  const [plates, setPlates] = useState({})
  const [overview, setOverview] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [modalError, setModalError] = useState('')
  const [message, setMessage] = useState('')
  const [modalMessage, setModalMessage] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [historical, setHistorical] = useState(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState(null)
  const [discardPrompt, setDiscardPrompt] = useState(false)
  const [fillPrompt, setFillPrompt] = useState(false)
  const [plateEdit, setPlateEdit] = useState(null)
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('all')
  const [focusedToolVehicleId, setFocusedToolVehicleId] = useState(null)
  const [toolBundle, setToolBundle] = useState({ vehicles: [], history: [], openIssues: [] })
  const [toolStatus, setToolStatus] = useState('idle')
  const [toolError, setToolError] = useState('')
  const [toolReloadToken, setToolReloadToken] = useState(0)
  const [highlightIssueId, setHighlightIssueId] = useState(null)
  const [panelEditor, setPanelEditor] = useState({ dirty: false, busy: false })
  const request = useRef(0)
  const saveLock = useRef(false)
  const discardRef = useRef(null)
  const isOverview = canPickUlp && !ulpId && overviewEnabled
  const future = month > currentConditionMonth()
  const editable = canManage && !future && !historical
  const canManagePlateNow = canManagePlate && !future && !historical
  const shownItems = historical?.snapshot.items ? applyMonthlyConditionDefaults(historical.snapshot.items) : items
  const shownVehicles = historical?.snapshot.vehicles || bundle?.vehicles || []
  const grouped = groupVehicleConditions(shownVehicles, shownItems)
  const summary = summarizeFleet(shownVehicles, shownItems)
  const unitName = ulps.find((unit) => unit.uuid === ulpId)?.displayName || 'ULP'
  const selectedVehicle = shownVehicles.find((vehicle) => vehicle.id === selectedVehicleId) || null
  const selectedVehicleItems = shownItems.filter((item) => item.vehicle_id === selectedVehicleId)
  const selectedToolItems = selectedVehicleItems.filter((item) => item.kind !== 'vehicle')
  const selectedToolSummary = summarizeConditions(selectedToolItems)
  const selectedCondition = selectedVehicleItems.find((item) => item.kind === 'vehicle') || null
  const selectedSummary = selectedVehicle ? summarizeVehicle(selectedVehicle, shownItems) : null
  const savedVehicle = bundle?.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || null
  const baselineVehicleItems = baselineItems.filter((item) => item.vehicle_id === selectedVehicleId)
  const defaults = defaultVehicleIds(bundle?.items || [])
  const selectedIsDefault = Boolean(!historical && selectedVehicleId && defaults.has(selectedVehicleId))
  const vehicleItemsDirty = Boolean(editable && selectedVehicle
    && conditionSnapshot(selectedVehicleItems) !== conditionSnapshot(baselineVehicleItems))
  const plateDirty = Boolean(canManagePlateNow && selectedVehicle
    && (plates[selectedVehicle.id] || '').trim() !== (savedVehicle?.plate_display || ''))
  const dirty = vehicleItemsDirty || plateDirty
  const selectedToolVehicle = toolBundle.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || null
  const selectedToolAssets = selectedToolVehicle?.assets || []
  const selectedToolHistory = toolBundle.history.filter((entry) => entry.vehicle_id === selectedVehicleId)
  const selectedOpenIssues = toolBundle.openIssues.filter((issue) => issue.vehicle_id === selectedVehicleId)
  const focusedToolVehicle = toolBundle.vehicles.find((vehicle) => vehicle.id === focusedToolVehicleId) || null
  const focusedToolHistory = toolBundle.history.filter((entry) => entry.vehicle_id === focusedToolVehicleId)

  const applyBundle = (data) => {
    const displayItems = applyMonthlyConditionDefaults(data.items || [])
    setBundle(data)
    setItems(displayItems)
    setBaselineItems(displayItems)
    setPlates(Object.fromEntries((data.vehicles || []).map((vehicle) => [vehicle.id, vehicle.plate_display || ''])))
  }

  useEffect(() => {
    if (!canPickUlp) setUlpId(ownUlpUuid || '')
  }, [ownUlpUuid, canPickUlp])

  useEffect(() => {
    if (canPickUlp && !overviewEnabled && !ulpId && ulps.length) {
      const preferred = initialUlpId && ulps.some((unit) => unit.uuid === initialUlpId)
        ? initialUlpId
        : ulps[0].uuid
      setUlpId(preferred)
    }
  }, [canPickUlp, initialUlpId, overviewEnabled, ulpId, ulps])

  useEffect(() => {
    if (!issueTarget?.token) return
    if (issueTarget.ulpId && canPickUlp && issueTarget.ulpId !== ulpId) setUlpId(issueTarget.ulpId)
    setHighlightIssueId(issueTarget.issueId ?? null)
  }, [issueTarget?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true
    if (isOverview || !contractUuid || !up3Uuid || !ulpId) {
      setToolBundle({ vehicles: [], history: [], openIssues: [] })
      setToolStatus('idle')
      setToolError('')
      return undefined
    }
    setToolStatus('loading')
    setToolError('')
    getToolInspectionBundle({ contractId: contractUuid, up3Id: up3Uuid, ulpId })
      .then((data) => {
        if (!active) return
        setToolBundle(data)
        setToolStatus('ready')
      })
      .catch((loadError) => {
        if (!active) return
        setToolBundle({ vehicles: [], history: [], openIssues: [] })
        setToolError(loadError.message)
        setToolStatus('error')
      })
    return () => { active = false }
  }, [contractUuid, up3Uuid, ulpId, isOverview, toolReloadToken])

  useEffect(() => {
    if (!bundle || !highlightIssueId) return
    const issue = toolBundle.openIssues.find((row) => String(row.id) === String(highlightIssueId))
    if (!issue) return
    const inReport = (bundle.vehicles || []).some((vehicle) => vehicle.id === issue.vehicle_id)
    if (inReport) {
      setSelectedVehicleId(issue.vehicle_id)
      setFocusedToolVehicleId(null)
    } else {
      setFocusedToolVehicleId(issue.vehicle_id)
    }
  }, [bundle, toolBundle.openIssues, highlightIssueId])

  useEffect(() => {
    onEditorStateChange?.({ dirty: dirty || panelEditor.dirty, busy: saving || panelEditor.busy })
    return () => onEditorStateChange?.({ dirty: false, busy: false })
  }, [dirty, saving, panelEditor, onEditorStateChange])

  useEffect(() => {
    let active = true
    const token = ++request.current
    setLoading(true)
    setError('')
    setMessage('')
    setBundle(null)
    setItems([])
    setBaselineItems([])
    setPlates({})
    setHistorical(null)
    setSelectedVehicleId(null)
    setDiscardPrompt(false)
    setFillPrompt(false)
    setPlateEdit(null)
    setModalError('')
    setModalMessage('')
    if (!contractUuid || !up3Uuid) {
      setError('Scope ULP belum tersedia. Muat ulang halaman atau hubungi administrator.')
      setLoading(false)
      return undefined
    }
    if (!isOverview && !ulpId) {
      if (canPickUlp && !overviewEnabled) {
        setError('')
        setLoading(true)
        return undefined
      }
      setError('Scope ULP belum tersedia. Muat ulang halaman atau hubungi administrator.')
      setLoading(false)
      return undefined
    }
    const context = { contractId: contractUuid, up3Id: up3Uuid, ulpId, month }
    const promise = isOverview ? listUlpConditionOverview(context) : getUlpConditionReport(context)
    promise.then((data) => {
      if (!active || token !== request.current) return
      if (isOverview) setOverview(data || [])
      else applyBundle(data)
    }).catch((loadError) => {
      if (active && token === request.current) setError(loadError.message)
    }).finally(() => {
      if (active && token === request.current) setLoading(false)
    })
    return () => { active = false; request.current += 1 }
  }, [canPickUlp, contractUuid, overviewEnabled, up3Uuid, ulpId, month, isOverview, reloadToken])

  useEffect(() => {
    if (!dirty && !saving && !panelEditor.dirty && !panelEditor.busy) return undefined
    const handler = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, saving, panelEditor])

  useEffect(() => {
    if (!discardPrompt) return
    window.requestAnimationFrame(() => {
      discardRef.current?.scrollIntoView({ block: 'nearest' })
      discardRef.current?.querySelector('button')?.focus()
    })
  }, [discardPrompt])

  const canChangeContext = () => !saveLock.current && !panelEditor.busy && ((!dirty && !panelEditor.dirty) || window.confirm('Isian kendaraan belum disimpan. Tinggalkan perubahan?'))
  const changeUlp = (value) => {
    if (value === ulpId || !canChangeContext()) return
    setUlpId(value)
    setVehicleSearch('')
    setVehicleFilter('all')
    setHighlightIssueId(null)
    setFocusedToolVehicleId(null)
  }
  const changeMonth = (value) => {
    if (!/^\d{4}-\d{2}$/.test(value) || value === month || !canChangeContext()) return
    setMonth(value)
    setFocusedToolVehicleId(null)
    onMonthChange?.(`${value}-01`)
  }
  const updateItem = (key, patch) => {
    if (saveLock.current || !editable) return
    setItems((prev) => prev.map((item) => item.key === key ? { ...item, ...patch } : item))
    setModalMessage('')
    setModalError('')
  }
  const updateToolQuantity = (item, field, value) => {
    if (saveLock.current || !editable) return
    const other = field === 'good_qty' ? 'bad_qty' : 'good_qty'
    const patch = { [field]: value }
    const raw = String(value ?? '').trim()
    const parsed = parseConditionCount(value)
    if (!raw) patch[other] = ''
    else if (parsed != null && !Number.isNaN(parsed)) {
      patch[other] = parsed <= item.required_qty ? String(item.required_qty - parsed) : '0'
    }
    updateItem(item.key, patch)
  }
  const selectCondition = (condition, good, bad) => updateItem(condition.key, { good_qty: good, bad_qty: bad })
  const fillAll = () => {
    if (!selectedVehicle || !editable || saveLock.current) return
    setItems((prev) => prev.map((item) => {
      if (item.vehicle_id !== selectedVehicle.id) return item
      if (item.kind === 'vehicle') return { ...item, good_qty: 1, bad_qty: 0 }
      return { ...item, good_qty: String(item.required_qty), bad_qty: '0' }
    }))
    setFillPrompt(false)
    setModalError('')
    setModalMessage('Semua alat pada kendaraan ini diisi Baik sesuai jumlah kontrak dan Rusak 0. Periksa kembali sebelum menyimpan.')
  }
  const openVehicle = (vehicleId) => {
    setSelectedVehicleId(vehicleId)
    setFocusedToolVehicleId(null)
    setHighlightIssueId(null)
    setModalError('')
    setModalMessage('')
    setDiscardPrompt(false)
    setFillPrompt(false)
    setPlateEdit(null)
  }
  const resetVehicleEdits = () => {
    if (!selectedVehicle) return
    setItems(baselineItems)
    setPlates((prev) => ({ ...prev, [selectedVehicle.id]: savedVehicle?.plate_display || '' }))
    setModalError('')
    setModalMessage('')
    setDiscardPrompt(false)
    setFillPrompt(false)
    setPlateEdit(null)
    setSelectedVehicleId(null)
    setHighlightIssueId(null)
  }
  const closeVehicle = (force = false) => {
    if (!selectedVehicle || saveLock.current || panelEditor.busy) return
    if ((dirty || panelEditor.dirty) && !force) {
      setDiscardPrompt(true)
      return
    }
    if (dirty) resetVehicleEdits()
    else {
      setDiscardPrompt(false)
      setFillPrompt(false)
      setPlateEdit(null)
      setModalError('')
      setModalMessage('')
      setSelectedVehicleId(null)
      setHighlightIssueId(null)
    }
  }
  const savePlate = async (vehicle) => {
    if (!canManagePlateNow || saveLock.current) return
    const plate = (plates[vehicle.id] || '').trim()
    const normalized = plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (normalized.length < 2 || normalized.length > 12) {
      setModalError('Isi nomor polisi yang valid (2 sampai 12 huruf/angka).')
      return
    }
    saveLock.current = true
    setSaving(true)
    setModalError('')
    setModalMessage('')
    const token = request.current
    try {
      const saved = await setPrescribedVehiclePlate(vehicle, plate)
      if (token !== request.current) return
      setBundle((prev) => ({ ...prev, vehicles: prev.vehicles.map((row) => row.id === vehicle.id
        ? { ...row, plate_display: saved.plate_display, plate_normalized: saved.plate_normalized, revision: saved.revision }
        : row) }))
      setPlates((prev) => ({ ...prev, [vehicle.id]: saved.plate_display }))
      setModalMessage(`Nopol ${saved.plate_display} tersimpan.`)
      setToolReloadToken((value) => value + 1)
    } catch (saveError) {
      if (token === request.current) setModalError(saveError.message)
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }
  const openPlateEdit = () => {
    if (!canManagePlateNow || saveLock.current || !selectedVehicle?.plate_display) return
    setPlateEdit({ plate: savedVehicle?.plate_display || selectedVehicle.plate_display, reason: '' })
    setModalError('')
    setModalMessage('')
  }
  const updatePlateEdit = (patch) => {
    setPlateEdit((prev) => (prev ? { ...prev, ...patch } : prev))
    setModalError('')
    setModalMessage('')
  }
  const savePlateCorrection = async () => {
    if (!plateEdit || !canManagePlateNow || saveLock.current) return
    const plate = plateEdit.plate.trim()
    const reason = plateEdit.reason.trim()
    const normalized = plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (normalized.length < 2 || normalized.length > 12) {
      setModalError('Isi nomor polisi yang valid (2 sampai 12 huruf/angka).')
      return
    }
    if (!reason) {
      setModalError('Tuliskan alasan koreksi nomor polisi.')
      return
    }
    saveLock.current = true
    setSaving(true)
    setModalError('')
    setModalMessage('')
    const token = request.current
    try {
      const saved = await correctPrescribedVehiclePlate(selectedVehicle, plate, reason)
      if (token !== request.current) return
      const fixed = saved?.slot || {}
      const reportsRevised = saved?.reports_revised || []
      const reportUpdate = reportsRevised.find((entry) => entry.report_id === bundle?.report?.id)
      setBundle((prev) => ({
        ...prev,
        report: reportUpdate ? { ...prev.report, revision: reportUpdate.revision } : prev.report,
        vehicles: prev.vehicles.map((row) => row.id === fixed.id
          ? { ...row, plate_display: fixed.plate_display, plate_normalized: fixed.plate_normalized, revision: fixed.revision }
          : row),
      }))
      setPlates((prev) => ({ ...prev, [fixed.id]: fixed.plate_display }))
      setPlateEdit(null)
      setToolReloadToken((value) => value + 1)
      setModalMessage(reportsRevised.length
        ? `Nopol dikoreksi menjadi ${fixed.plate_display}. Nopol pada ${reportsRevised.length} laporan bulanan tersimpan ikut diperbarui, kondisi dan status tidak berubah.`
        : `Nopol dikoreksi menjadi ${fixed.plate_display}. Tidak ada laporan tersimpan yang perlu diperbarui.`)
    } catch (saveError) {
      if (token === request.current) setModalError(saveError.message)
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }
  const saveVehicle = async () => {
    if (!selectedVehicle || !editable || saveLock.current) return
    if (panelEditor.dirty) {
      setModalError('Selesaikan atau batalkan isian inspeksi unit terlebih dahulu.')
      return
    }
    if (!selectedVehicle.plate_display) {
      setModalError('Lengkapi dan simpan nomor polisi kendaraan terlebih dahulu.')
      return
    }
    if (plateDirty) {
      setModalError('Simpan nopol yang sedang diketik terlebih dahulu.')
      return
    }
    const invalid = selectedVehicleItems.find((item) => evaluateCondition(item).status === 'invalid')
    if (invalid) {
      setModalError('Periksa angka yang tidak valid. Gunakan bilangan bulat 0 sampai 2147483647; kondisi kendaraan hanya satu pilihan Baik atau Rusak.')
      return
    }
    saveLock.current = true
    setSaving(true)
    setModalError('')
    setModalMessage('')
    const token = request.current
    try {
      const saved = await saveUlpVehicleCondition(
        { contractId: contractUuid, up3Id: up3Uuid, ulpId, month },
        bundle,
        selectedVehicle.id,
        selectedVehicleItems,
      )
      if (token !== request.current) return
      applyBundle(saved)
      setSelectedVehicleId(null)
      setDiscardPrompt(false)
      setFillPrompt(false)
      setMessage('Kondisi kendaraan tersimpan.')
    } catch (saveError) {
      if (token === request.current) setModalError(saveError.message)
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  const cards = grouped.map(({ vehicle }) => {
    const vehicleSummary = summarizeVehicle(vehicle, shownItems)
    const missing = vehicleSummary.unfilled + vehicleSummary.invalid
    const reasons = []
    if (vehicleSummary.failed) reasons.push(`${vehicleSummary.failed} item perlu perhatian`)
    if (vehicleSummary.unfilled) reasons.push(`${vehicleSummary.unfilled} isian kosong`)
    if (vehicleSummary.invalid) reasons.push(`${vehicleSummary.invalid} isian belum valid`)
    if (vehicleSummary.missingPlate) reasons.push('Nopol belum diisi')
    return { vehicle, summary: vehicleSummary, missing, reasons, isDefault: !historical && defaults.has(vehicle.id) }
  })
  const q = vehicleSearch.trim().toLowerCase()
  const filteredCards = cards.filter(({ vehicle, summary: vehicleSummary, missing }) => {
    if (q && !`${vehicle.label} ${vehicle.plate_display || ''} ${vehicle.vehicle_type_name || ''} ${vehicle.assignment_name || ''} ${vehicleLocationLabel(vehicle)}`.toLowerCase().includes(q)) return false
    if (vehicleFilter === 'attention') return vehicleSummary.hasAttention
    if (vehicleFilter === 'incomplete') return missing > 0 || vehicleSummary.missingPlate
    if (vehicleFilter === 'compliant') return !vehicleSummary.hasAttention && missing === 0 && !vehicleSummary.missingPlate
    return true
  })

  return <section className="uc-workspace">
    <header className="uc-header"><div><span className="uc-eyebrow">PEMERIKSAAN BULANAN</span><h2>Alat & Kendaraan</h2><p>{isOverview ? 'Pantau kendaraan, nopol, dan kelengkapan pemeriksaan setiap ULP.' : 'Isi jumlah kontrak, kondisi Baik/Rusak, lalu lengkapi rincian inspeksi per unit untuk foto, issue, dan masa pakai alat.'}</p></div><div className="uc-context">
      {onOpenStandards && <button type="button" className="sla-btn" disabled={saving} onClick={onOpenStandards}>Kelola Template & Kendaraan</button>}
      {canPickUlp ? <label>Unit Layanan<select value={ulpId} disabled={saving} onChange={(event) => changeUlp(event.target.value)}>{overviewEnabled && <option value="">Semua ULP</option>}{ulps.map((unit) => <option key={unit.uuid} value={unit.uuid}>{unit.displayName || unit.legacyKey}</option>)}</select></label> : <div className="uc-unit-label">{unitName}</div>}
      <label>Periode<input type="month" value={month} disabled={saving} onChange={(event) => changeMonth(event.target.value)} /></label>
    </div></header>

    {error && <div className="uc-alert uc-alert--error" role="alert">{error}<button type="button" className="sla-btn" disabled={saving} onClick={() => { if (canChangeContext()) setReloadToken((value) => value + 1) }}>Muat Ulang</button></div>}
    {message && <p className="uc-alert" role="status">{message}</p>}

    {selectedVehicle && selectedSummary ? (
      <div className="uc-vehicle-page">
        <div className="uc-page-head">
          <button type="button" className="sla-btn uc-page-back" onClick={() => closeVehicle()}>← Kembali ke daftar kendaraan</button>
          <div className="uc-page-title">
            <span className="uc-eyebrow">PEMERIKSAAN KENDARAAN</span>
            <h3>{selectedVehicle.plate_display || selectedVehicle.label}</h3>
            <p>{selectedVehicle.label} · {selectedVehicle.vehicle_type_name} / {selectedVehicle.assignment_name}{vehicleLocationLabel(selectedVehicle) ? ` · ${vehicleLocationLabel(selectedVehicle)}` : ''}</p>
          </div>
          <Status value={selectedSummary.hasAttention ? 'non_compliant' : selectedSummary.isComplete ? 'compliant' : 'draft'} />
        </div>
        {modalError && <p className="uc-alert uc-alert--error" role="alert">{modalError}</p>}
        {modalMessage && <p className="uc-alert" role="status">{modalMessage}</p>}
        {editable && selectedIsDefault && !dirty && (
          <p className="uc-alert" role="status">Kondisi awal bulan ini otomatis 100%. Simpan hanya jika ada kondisi yang perlu diubah.</p>
        )}
        <div className="alkes-modal-form">
          <section className="alkes-modal-section">
            <div className="alkes-modal-section-head">
              <div>
                <h3>Identitas dan Acuan</h3>
                <p>Jenis, penugasan, dan template ditetapkan Admin UP3.</p>
              </div>
            </div>
            <div className="uc-assignment-summary-grid">
              <div><span>Jenis Kendaraan</span><strong>{selectedVehicle.vehicle_type_name || '-'}</strong></div>
              <div><span>Penugasan</span><strong>{selectedVehicle.assignment_name || '-'}</strong></div>
              <div><span>Lokasi Tujuan</span><strong>{vehicleLocationLabel(selectedVehicle) || 'Belum ditetapkan'}</strong></div>
              <div><span>Template</span><strong>{selectedVehicle.template_name || '-'}</strong></div>
              <div><span>Versi</span><strong>Versi {selectedVehicle.template_version}</strong></div>
              <div className="uc-assignment-plate">
                <span>Nomor Polisi</span>
                {selectedVehicle.plate_display
                  ? (
                    <div className="uc-plate-inline">
                      <strong>{selectedVehicle.plate_display}</strong>
                      {canManagePlateNow && !plateEdit && (
                        <button
                          type="button"
                          className="sla-btn uc-plate-edit"
                          disabled={saving || vehicleItemsDirty}
                          title={vehicleItemsDirty ? 'Simpan kondisi yang sedang diisi terlebih dahulu.' : 'Koreksi nopol yang salah ketik'}
                          onClick={openPlateEdit}
                        >
                          Edit Nopol
                        </button>
                      )}
                    </div>
                  )
                  : <strong className="uc-plate-unset">Belum diisi</strong>}
              </div>
            </div>
            {selectedVehicle.plate_display && canManagePlateNow && !plateEdit && (
              <p className="uc-assignment-note">Nopol yang salah ketik dapat dikoreksi; laporan bulanan tersimpan ikut diperbarui.</p>
            )}
            {selectedVehicle.plate_display && canManagePlateNow && plateEdit && (
              <div className="uc-plate-correction">
                <h4>Koreksi Nomor Polisi</h4>
                <p className="uc-plate-correction-note">Hanya nopol yang berubah. Lokasi, template, kondisi, dan status tetap; laporan tersimpan yang memuat nopol lama ikut direvisi.</p>
                <div className="uc-plate-correction-fields">
                  <label className="uc-plate-correction-plate" htmlFor={`plate-edit-${selectedVehicle.id}`}>Nomor Polisi Baru *<input id={`plate-edit-${selectedVehicle.id}`} maxLength={30} autoComplete="off" data-autofocus value={plateEdit.plate} placeholder="Contoh: KB 1234 XX" onChange={(event) => updatePlateEdit({ plate: event.target.value })} /></label>
                  <label className="uc-plate-correction-reason" htmlFor={`plate-reason-${selectedVehicle.id}`}>Alasan Koreksi *<textarea id={`plate-reason-${selectedVehicle.id}`} maxLength={500} rows={2} placeholder="Contoh: salah ketik huruf akhir" value={plateEdit.reason} onChange={(event) => updatePlateEdit({ reason: event.target.value })} /></label>
                </div>
                <div className="uc-plate-correction-actions">
                  <span>Nopol saat ini: <strong>{savedVehicle?.plate_display || selectedVehicle.plate_display}</strong></span>
                  <div className="alkes-modal-actions">
                    <button type="button" className="sla-btn" disabled={saving} onClick={() => setPlateEdit(null)}>Batal</button>
                    <button type="button" className="sla-btn sla-btn-primary" disabled={saving || !plateEdit.plate.trim() || !plateEdit.reason.trim()} onClick={savePlateCorrection}>{saving ? 'Menyimpan...' : 'Simpan Koreksi'}</button>
                  </div>
                </div>
              </div>
            )}
            {!selectedVehicle.plate_display && canManagePlateNow && (
              <div className="uc-plate-entry">
                <label htmlFor={`plate-${selectedVehicle.id}`}>Nomor Polisi *<input data-autofocus id={`plate-${selectedVehicle.id}`} maxLength={30} autoComplete="off" value={plates[selectedVehicle.id] || ''} placeholder="Contoh: KB 1234 XX" onChange={(event) => { setPlates((prev) => ({ ...prev, [selectedVehicle.id]: event.target.value })); setModalError(''); setModalMessage('') }} /></label>
                <button type="button" className="sla-btn sla-btn-primary" disabled={saving || !(plates[selectedVehicle.id] || '').trim()} onClick={() => savePlate(selectedVehicle)}>Simpan Nopol</button>
                <p>Diisi sekali oleh Admin ULP. Nopol diperlukan sebelum kondisi dapat disimpan.</p>
              </div>
            )}
            {!selectedVehicle.plate_display && !canManagePlateNow && <p className="uc-alert">Nomor polisi belum dilengkapi untuk kendaraan ini. Admin ULP perlu mengisinya.</p>}
            {selectedVehicle.contract_reference && <p className="uc-footnote">Acuan: {selectedVehicle.contract_reference}</p>}
            {selectedVehicle.legacy_metadata && <p className="uc-footnote">Template lama: metadata katalog mengikuti katalog saat ini.</p>}
          </section>

          <section className="alkes-modal-section">
            <div className="alkes-modal-section-head">
              <div>
                <h3>Kondisi Kendaraan</h3>
                <p>Pilih kondisi unit kendaraan. Kondisi kendaraan memengaruhi status kendaraan ini.</p>
              </div>
            </div>
            {selectedCondition ? (
              <div className="uc-vehicle-condition">
                <span>Kondisi kendaraan *</span>
                {editable ? (
                  <>
                    <div className="uc-condition-options">
                      {[['Baik', 1, 0], ['Rusak', 0, 1]].map(([label, good, bad], index) => (
                        <label key={label}>
                          <input
                            type="radio"
                            name={`condition-${selectedVehicle.id}`}
                            data-autofocus={selectedVehicle.plate_display && index === 0 ? '' : undefined}
                            checked={Number(selectedCondition.good_qty) === good && Number(selectedCondition.bad_qty) === bad && selectedCondition.good_qty != null && selectedCondition.bad_qty != null}
                            onChange={() => selectCondition(selectedCondition, good, bad)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <Status value={evaluateCondition(selectedCondition).status} />
                  </>
                ) : <Status value={evaluateCondition(selectedCondition).status} />}
              </div>
            ) : <p className="uc-assignment-empty">Data kondisi kendaraan tidak tersedia pada laporan ini.</p>}
          </section>

          <section className="alkes-modal-section uc-tool-matrix-section">
            <div className="alkes-modal-section-head">
              <div>
                <h3>Peralatan &amp; Inspeksi</h3>
                <p>Satu baris per alat. Jumlah Baik + Rusak harus sama dengan jumlah kontrak. Ada di ULP mengikuti jumlah kontrak. Inspeksi per unit terbuka dari tombol Inspeksi pada baris alat; rekap jumlah disimpan dari tombol bawah.</p>
              </div>
              <div className="uc-tool-section-actions">
                <span className="sla-table-hint">{selectedToolSummary.filled}/{selectedToolSummary.total} alat terisi · {selectedToolSummary.failed} perlu perhatian</span>
                {editable && <button type="button" className="sla-btn" disabled={saving} onClick={() => setFillPrompt(true)}>Isi Semua 100%</button>}
              </div>
            </div>
            {fillPrompt && (
              <div className="uc-fill-prompt" role="alert">
                <div>
                  <strong>Isi seluruh peralatan sebagai Baik 100%?</strong>
                  <span>Baik akan sama dengan jumlah kontrak dan Rusak menjadi 0. Nilai kondisi yang sedang diisi akan diganti.</span>
                </div>
                <div className="alkes-modal-actions">
                  <button type="button" className="sla-btn" disabled={saving} onClick={() => setFillPrompt(false)}>Batal</button>
                  <button type="button" className="sla-btn sla-btn-primary" disabled={saving} onClick={fillAll}>Ya, Isi 100%</button>
                </div>
              </div>
            )}
            {selectedOpenIssues.length > 0 && (
              <p className="uc-alert" role="status">
                Ada {selectedOpenIssues.length} issue unit terbuka. Rekap Baik/Rusak tetap dapat diisi;
                issue hanya selesai melalui tombol Serah Terima pada unit terkait.
              </p>
            )}
            <UlpToolInspectionMatrix
              items={selectedToolItems}
              assets={selectedToolAssets}
              history={selectedToolHistory}
              canManage={editable}
              canInspect={canInspect && !future}
              canResolveIssue={canResolveIssue && !future}
              showInspections={!historical}
              future={future}
              inspectionStatus={toolStatus}
              isDefaultVehicle={selectedIsDefault && !vehicleItemsDirty}
              vehicleLabel={selectedVehicle.plate_display || selectedVehicle.label}
              contractUuid={contractUuid}
              up3Uuid={up3Uuid}
              ulpId={ulpId}
              highlightedIssueId={highlightIssueId}
              onQuantityChange={updateToolQuantity}
              onNoteChange={(item, note) => updateItem(item.key, { note })}
              onChanged={() => setToolReloadToken((value) => value + 1)}
              onMessage={(value) => { setMessage(value); setModalMessage(value) }}
              onEditorStateChange={setPanelEditor}
            />
            {toolStatus === 'error' && <p className="uc-alert">Rincian unit tidak dapat dimuat: {toolError}</p>}
            {historical && <p className="uc-alert">Arsip bulanan hanya memuat rekap jumlah. Inspeksi per unit mengikuti kondisi terkini dan tidak disimpan dalam arsip.</p>}
          </section>

          {discardPrompt && (
            <div ref={discardRef} className="alkes-modal-discard" role="alert">
              <div>
                <strong>Isian kendaraan belum disimpan</strong>
                <span>Perubahan rekap, nopol, atau isian inspeksi akan hilang jika halaman ditutup sekarang.</span>
              </div>
              <div className="alkes-modal-actions">
                <button type="button" className="sla-btn" disabled={saving} onClick={() => setDiscardPrompt(false)}>Tetap Mengisi</button>
                <button type="button" className="sla-btn sla-btn-primary" disabled={saving} onClick={() => closeVehicle(true)}>Tutup Tanpa Menyimpan</button>
              </div>
            </div>
          )}
        </div>
        <footer className="alkes-modal-footer uc-page-footer">
          <div className="uc-modal-footer">
            <span>{saving ? 'Menyimpan...' : panelEditor.busy ? 'Menyimpan inspeksi...' : !editable ? (historical ? 'Mode riwayat baca saja' : canManagePlateNow ? 'Nopol dapat dikelola; kondisi hanya baca.' : 'Hanya baca') : !selectedVehicle.plate_display ? 'Nopol belum diisi. Admin ULP perlu melengkapinya sebelum kondisi disimpan.' : (dirty || panelEditor.dirty) ? 'Ada perubahan belum disimpan' : selectedIsDefault ? 'Default bulan ini 100%' : 'Tidak ada perubahan'}</span>
            <div className="alkes-modal-actions">
              <button type="button" className="sla-btn" disabled={saving || panelEditor.busy} onClick={() => closeVehicle()}>{editable ? 'Batal' : 'Tutup'}</button>
              {editable && <button type="button" className="sla-btn sla-btn-primary" disabled={saving || panelEditor.busy || !dirty || !selectedVehicle.plate_display} onClick={saveVehicle}>{saving ? 'Menyimpan...' : 'Simpan Rekap'}</button>}
            </div>
          </div>
        </footer>
      </div>
    ) : loading ? <div className="uc-empty" role="status">Memuat penetapan dan laporan kendaraan...</div> : isOverview ? <div className="uc-overview">
      <div className="uc-section-title"><h3>Ringkasan {conditionMonthLabel(month)}</h3><span>{overview.length} ULP</span></div>
      <div className="uc-scroll"><table className="uc-table"><thead><tr><th>ULP</th><th>Kendaraan Ditetapkan</th><th>Nopol Belum Diisi</th><th>Pemeriksaan</th><th>Hasil</th><th /></tr></thead><tbody>{overview.map((row) => <tr key={row.ulp_id}><td><strong>{ulps.find((unit) => unit.uuid === row.ulp_id)?.displayName || 'ULP'}</strong></td><td>{row.vehicle_count} kendaraan</td><td>{row.missing_plates}</td><td>{row.filled_count} / {row.items_count} diisi</td><td><Status value={row.report_status} /></td><td><button type="button" className="sla-btn" onClick={() => changeUlp(row.ulp_id)}>Lihat Laporan</button></td></tr>)}{!overview.length && <tr><td colSpan={6}>Belum ada ULP pada scope ini.</td></tr>}</tbody></table></div>
      <p className="uc-footnote">Hasil hanya menunjukkan kesesuaian kendaraan dan alat terhadap template. Tidak mengubah nilai atau indikator SLA.</p>
    </div> : bundle && !bundle.vehicles.length ? <div className="uc-empty"><h3>Kendaraan belum ditetapkan</h3><p>Belum ada kendaraan untuk {unitName} pada {conditionMonthLabel(month)}. Admin UP3 perlu menetapkan kendaraan beserta penugasan dan template alatnya terlebih dahulu.</p></div> : bundle ? <>
      <div className="uc-reference"><div><span>Unit Layanan</span><strong>{unitName}</strong></div><div><span>Periode</span><strong>{conditionMonthLabel(month)}</strong></div><div><span>{historical ? `Riwayat revisi ${historical.revision}` : 'Hasil Pemeriksaan'}</span><Status value={summary.status} /></div></div>
      <div className="uc-summary" aria-live="polite"><div><strong>{summary.vehicleCount}</strong><span>Kendaraan Ditetapkan</span></div><div><strong>{summary.filled}<small>/{summary.total}</small></strong><span>Kondisi Terisi</span></div><div className={summary.failed ? 'uc-summary--danger' : ''}><strong>{summary.failed}</strong><span>Item Perlu Perhatian</span></div><div><strong>{summary.missingPlates}</strong><span>Nopol Belum Dilengkapi</span></div></div>
      <p className="uc-instruction">Kondisi awal setiap bulan otomatis 100%. Buka kendaraan hanya jika ada nopol yang perlu dilengkapi atau kondisi yang perlu diubah.</p>
      {future && <p className="uc-alert">Periode mendatang hanya untuk melihat penetapan. Nopol dan kondisi belum dapat disimpan dari periode ini.</p>}
      {historical && <p className="uc-alert">Melihat riwayat {timestamp(historical.created_at)}. <button type="button" className="sla-btn" onClick={() => setHistorical(null)}>Kembali ke Laporan Terkini</button></p>}
      {!historical && toolStatus === 'error' && <p className="uc-alert">Rincian inspeksi per unit tidak dapat dimuat: {toolError}</p>}
      {!historical && !selectedVehicle && !focusedToolVehicle && toolBundle.openIssues.length > 0 && (
        <section className="tool-issues">
          <div className="tool-section-heading">
            <h3>Temuan alat terbuka</h3>
            <span>{toolBundle.openIssues.length} issue menunggu penggantian</span>
          </div>
          <div className="tool-issue-grid">
            {toolBundle.openIssues.map((issue) => {
              const inReport = shownVehicles.some((vehicle) => vehicle.id === issue.vehicle_id)
              return (
                <article className={`tool-issue-card ${String(issue.id) === String(highlightIssueId) ? 'is-highlighted' : ''}`} key={issue.id}>
                  <div>
                    <strong>{issue.equipment_name}</strong>
                    <span>{issue.vehicle_label}{issue.plate_display ? ` · ${issue.plate_display}` : ''}</span>
                  </div>
                  <p>{issue.note || 'Kerusakan tercatat; menunggu penggantian.'}</p>
                  <div className="tool-issue-actions">
                    <button
                      type="button"
                      className="sla-btn"
                      onClick={() => {
                        setHighlightIssueId(issue.id)
                        setModalError('')
                        setModalMessage('')
                        if (inReport) {
                          setFocusedToolVehicleId(null)
                          setSelectedVehicleId(issue.vehicle_id)
                        } else {
                          setSelectedVehicleId(null)
                          setFocusedToolVehicleId(issue.vehicle_id)
                        }
                      }}
                    >
                      {inReport ? 'Lihat Kendaraan' : 'Buka Rincian Unit'}
                    </button>
                    {!inReport && <span className="tool-muted">Kendaraan tidak aktif pada periode ini; issue tetap terbuka.</span>}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}
      {focusedToolVehicle && !selectedVehicle && !historical && (
        <section className="tool-detail">
          <div className="tool-detail-head">
            <button type="button" className="sla-btn" onClick={() => { setFocusedToolVehicleId(null); setHighlightIssueId(null) }}>← Tutup rincian unit</button>
            <div>
              <h3>{focusedToolVehicle.plate_display || focusedToolVehicle.label}</h3>
              <span>{focusedToolVehicle.label} · {focusedToolVehicle.template_name} · Versi {focusedToolVehicle.template_version}</span>
              <span>{vehicleLocationLabel(focusedToolVehicle) || 'Lokasi belum diisi'}</span>
            </div>
          </div>
          <UlpToolUnitPanel
            contractUuid={contractUuid}
            up3Uuid={up3Uuid}
            ulpId={ulpId}
            vehicle={focusedToolVehicle}
            assets={focusedToolVehicle.assets}
            history={focusedToolHistory}
            canInspect={canInspect && !future}
            canResolveIssue={canResolveIssue && !future}
            highlightedIssueId={highlightIssueId}
            onChanged={() => setToolReloadToken((value) => value + 1)}
            onMessage={(value) => { setMessage(value); setModalMessage(value) }}
            onEditorStateChange={setPanelEditor}
          />
        </section>
      )}
      <div className="uc-vehicle-toolbar">
        <input value={vehicleSearch} onChange={(event) => setVehicleSearch(event.target.value)} placeholder="Cari nopol, kendaraan, atau penugasan" aria-label="Cari kendaraan" />
        <select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} aria-label="Filter kondisi kendaraan">
          <option value="all">Semua kendaraan</option>
          <option value="attention">Perlu Perhatian</option>
          <option value="incomplete">Belum Lengkap</option>
          <option value="compliant">Memenuhi</option>
        </select>
        <span>{filteredCards.length} dari {cards.length} kendaraan</span>
      </div>
      <div className="uc-vehicle-list">
        {filteredCards.map(({ vehicle, summary: vehicleSummary, missing, reasons, isDefault }) => {
          const badge = vehicleBadge(vehicleSummary)
          const percentage = vehicleSummary.total ? Math.round(vehicleSummary.filled / vehicleSummary.total * 100) : 0
          const vehicleIssueCount = historical ? 0 : toolBundle.openIssues.filter((issue) => issue.vehicle_id === vehicle.id).length
          return <button type="button" key={vehicle.id} className={`uc-vehicle-card is-${badge.tone}`} onClick={() => openVehicle(vehicle.id)}>
            <span className="uc-vehicle-card-main">
              <span className="uc-vehicle-card-label">{vehicle.label}</span>
              <strong>{vehicle.plate_display || 'Nopol belum diisi'}</strong>
              <span className="uc-vehicle-card-meta">{vehicle.vehicle_type_name} / {vehicle.assignment_name}{vehicleLocationLabel(vehicle) ? ` · ${vehicleLocationLabel(vehicle)}` : ''}</span>
            </span>
            <span className="uc-vehicle-card-status">
              {vehicleSummary.hasAttention && <span className="uc-status uc-status--non_compliant">Perlu Perhatian</span>}
              {(missing > 0 || vehicleSummary.missingPlate) && (
                <span className="uc-status uc-status--draft">{vehicleSummary.filled === 0 ? 'Belum Diisi' : 'Belum Lengkap'}</span>
              )}
              {!vehicleSummary.hasAttention && missing === 0 && !vehicleSummary.missingPlate && (
                <span className="uc-status uc-status--compliant">Memenuhi</span>
              )}
              {isDefault && <span className="uc-status uc-status--default">Default 100%</span>}
              {vehicleIssueCount > 0 && <span className="uc-status uc-status--non_compliant">{vehicleIssueCount} issue unit</span>}
              {reasons.length > 0 && <span className="uc-vehicle-card-reasons">{reasons.join(' · ')}</span>}
            </span>
            <span className="uc-vehicle-card-progress">
              <span><strong>{vehicleSummary.filled}/{vehicleSummary.total}</strong> kondisi</span>
              <span className="uc-progress-track"><span className="uc-progress-bar" style={{ width: `${percentage}%` }} /></span>
            </span>
            <span className="uc-vehicle-card-action">{editable ? 'Isi Kondisi' : 'Lihat Detail'} <span aria-hidden="true">›</span></span>
          </button>
        })}
        {!filteredCards.length && <div className="uc-empty"><h3>{cards.length ? 'Tidak ada kendaraan yang cocok' : 'Belum ada kendaraan'}</h3><p>{cards.length ? 'Ubah pencarian atau filter kondisi.' : 'Admin UP3 belum menetapkan kendaraan untuk ULP dan periode ini.'}</p></div>}
      </div>
      <details className="uc-history"><summary>Riwayat laporan{bundle.history.length ? ` (${bundle.history.length} revisi terbaru)` : ''}</summary>{bundle.history.length ? <div className="uc-history-list">{bundle.history.map((entry) => <div key={entry.revision}><div><strong>Revisi {entry.revision}</strong><span>{timestamp(entry.created_at)} / {entry.actor_role === 'SUPER_ADMIN' ? 'Super Admin' : entry.actor_role === 'ADMIN_UP3' ? 'Admin UP3' : entry.actor_role === 'INSPECTOR' ? 'Petugas Inspeksi' : 'Admin ULP'}</span></div><Status value={historyStatus(entry)} /><button type="button" className="sla-btn" disabled={saving} onClick={() => { if (canChangeContext()) { setHistorical(entry); setSelectedVehicleId(null); setFocusedToolVehicleId(null) } }}>Lihat</button></div>)}</div> : <p>Riwayat tersedia setelah laporan disimpan.</p>}</details>
      <p className="uc-footnote">Pemenuhan baik dihitung per alat. Kerusakan tetap membuat status Tidak Memenuhi. Tidak ada sinkronisasi indikator atau denda SLA.</p>
    </> : null}
  </section>
}
