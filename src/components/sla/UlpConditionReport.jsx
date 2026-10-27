import { Fragment, useEffect, useRef, useState } from 'react'
import {
  CONDITION_LABELS, applyMonthlyConditionDefaults, conditionMonthLabel, conditionSnapshot, currentConditionMonth,
  defaultVehicleIds, evaluateCondition, groupConditionItems, groupVehicleConditions, parseConditionCount,
  summarizeConditions, summarizeFleet, summarizeVehicle,
} from '../../data/ulpConditionDomain.js'
import {
  correctPrescribedVehiclePlate, getUlpConditionReport, listUlpConditionOverview, saveUlpVehicleCondition, setPrescribedVehiclePlate,
} from '../../data/ulpConditionRepository.js'
import AlkesModal from './AlkesModal.jsx'

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
  contractUuid, up3Uuid, ownUlpUuid, canManage, canPickUlp, units = [], initialMonth,
  onMonthChange, onEditorStateChange, onOpenStandards,
}) {
  const ulps = units.filter((unit) => unit.type === 'ULP')
  const [ulpId, setUlpId] = useState(canPickUlp ? '' : (ownUlpUuid || ''))
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
  const request = useRef(0)
  const saveLock = useRef(false)
  const inputRefs = useRef(new Map())
  const discardRef = useRef(null)
  const isOverview = canPickUlp && !ulpId
  const future = month > currentConditionMonth()
  const editable = canManage && !future && !historical
  const shownItems = historical?.snapshot.items ? applyMonthlyConditionDefaults(historical.snapshot.items) : items
  const shownVehicles = historical?.snapshot.vehicles || bundle?.vehicles || []
  const grouped = groupVehicleConditions(shownVehicles, shownItems)
  const summary = summarizeFleet(shownVehicles, shownItems)
  const unitName = ulps.find((unit) => unit.uuid === ulpId)?.displayName || 'ULP'
  const selectedVehicle = shownVehicles.find((vehicle) => vehicle.id === selectedVehicleId) || null
  const selectedVehicleItems = shownItems.filter((item) => item.vehicle_id === selectedVehicleId)
  const selectedToolItems = selectedVehicleItems.filter((item) => item.kind !== 'vehicle')
  const selectedTools = groupConditionItems(selectedToolItems)
  const selectedToolSummary = summarizeConditions(selectedToolItems)
  const selectedCondition = selectedVehicleItems.find((item) => item.kind === 'vehicle') || null
  const selectedSummary = selectedVehicle ? summarizeVehicle(selectedVehicle, shownItems) : null
  const savedVehicle = bundle?.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || null
  const baselineVehicleItems = baselineItems.filter((item) => item.vehicle_id === selectedVehicleId)
  const defaults = defaultVehicleIds(bundle?.items || [])
  const selectedIsDefault = Boolean(!historical && selectedVehicleId && defaults.has(selectedVehicleId))
  const vehicleItemsDirty = Boolean(editable && selectedVehicle
    && conditionSnapshot(selectedVehicleItems) !== conditionSnapshot(baselineVehicleItems))
  const plateDirty = Boolean(editable && selectedVehicle
    && (plates[selectedVehicle.id] || '').trim() !== (savedVehicle?.plate_display || ''))
  const dirty = vehicleItemsDirty || plateDirty

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
    if (!contractUuid || !up3Uuid || (!isOverview && !ulpId)) {
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
  }, [contractUuid, up3Uuid, ulpId, month, isOverview, reloadToken])

  useEffect(() => {
    onEditorStateChange?.({ dirty, busy: saving })
    return () => onEditorStateChange?.({ dirty: false, busy: false })
  }, [dirty, saving, onEditorStateChange])

  useEffect(() => {
    if (!dirty && !saving) return undefined
    const handler = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, saving])

  useEffect(() => {
    if (!discardPrompt) return
    window.requestAnimationFrame(() => {
      discardRef.current?.scrollIntoView({ block: 'nearest' })
      discardRef.current?.querySelector('button')?.focus()
    })
  }, [discardPrompt])

  const canChangeContext = () => !saveLock.current && (!dirty || window.confirm('Isian kendaraan belum disimpan. Tinggalkan perubahan?'))
  const changeUlp = (value) => {
    if (value === ulpId || !canChangeContext()) return
    setUlpId(value)
    setVehicleSearch('')
    setVehicleFilter('all')
  }
  const changeMonth = (value) => {
    if (!/^\d{4}-\d{2}$/.test(value) || value === month || !canChangeContext()) return
    setMonth(value)
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
  const moveFocus = (event, key, field) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const ordered = selectedTools.flatMap(([, rows]) => rows)
    const next = field === 'good_qty' ? `${key}:bad_qty` : `${ordered[ordered.findIndex((item) => item.key === key) + 1]?.key}:good_qty`
    inputRefs.current.get(next)?.focus()
  }
  const openVehicle = (vehicleId) => {
    setSelectedVehicleId(vehicleId)
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
  }
  const closeVehicle = (force = false) => {
    if (!selectedVehicle || saveLock.current) return
    if (dirty && !force) {
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
    }
  }
  const savePlate = async (vehicle) => {
    if (!editable || saveLock.current) return
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
      setModalMessage(`Nopol ${saved.plate_display} tersimpan. Lanjutkan pengisian kondisi kendaraan dan alatnya.`)
    } catch (saveError) {
      if (token === request.current) setModalError(saveError.message)
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }
  const openPlateEdit = () => {
    if (!editable || saveLock.current || !selectedVehicle?.plate_display) return
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
    if (!plateEdit || !editable || saveLock.current) return
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
      const field = Number.isNaN(parseConditionCount(invalid.good_qty)) ? 'good_qty' : 'bad_qty'
      inputRefs.current.get(`${invalid.key}:${field}`)?.focus()
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
    <header className="uc-header"><div><span className="uc-eyebrow">PEMERIKSAAN BULANAN</span><h2>Alat & Kendaraan</h2><p>{isOverview ? 'Pantau kendaraan, nopol, dan kelengkapan pemeriksaan setiap ULP.' : 'Pilih kendaraan untuk memeriksa kondisi alatnya. Data kendaraan ditetapkan oleh Admin UP3.'}</p></div><div className="uc-context">
      {onOpenStandards && <button type="button" className="sla-btn" disabled={saving} onClick={onOpenStandards}>Kelola Template & Kendaraan</button>}
      {canPickUlp ? <label>Unit Layanan<select value={ulpId} disabled={saving} onChange={(event) => changeUlp(event.target.value)}><option value="">Semua ULP</option>{ulps.map((unit) => <option key={unit.uuid} value={unit.uuid}>{unit.displayName || unit.legacyKey}</option>)}</select></label> : <div className="uc-unit-label">{unitName}</div>}
      <label>Periode<input type="month" value={month} disabled={saving} onChange={(event) => changeMonth(event.target.value)} /></label>
    </div></header>

    {error && <div className="uc-alert uc-alert--error" role="alert">{error}<button type="button" className="sla-btn" disabled={saving} onClick={() => { if (canChangeContext()) setReloadToken((value) => value + 1) }}>Muat Ulang</button></div>}
    {message && <p className="uc-alert" role="status">{message}</p>}

    {loading ? <div className="uc-empty" role="status">Memuat penetapan dan laporan kendaraan...</div> : isOverview ? <div className="uc-overview">
      <div className="uc-section-title"><h3>Ringkasan {conditionMonthLabel(month)}</h3><span>{overview.length} ULP</span></div>
      <div className="uc-scroll"><table className="uc-table"><thead><tr><th>ULP</th><th>Kendaraan Ditetapkan</th><th>Nopol Belum Diisi</th><th>Pemeriksaan</th><th>Hasil</th><th /></tr></thead><tbody>{overview.map((row) => <tr key={row.ulp_id}><td><strong>{ulps.find((unit) => unit.uuid === row.ulp_id)?.displayName || 'ULP'}</strong></td><td>{row.vehicle_count} kendaraan</td><td>{row.missing_plates}</td><td>{row.filled_count} / {row.items_count} diisi</td><td><Status value={row.report_status} /></td><td><button type="button" className="sla-btn" onClick={() => changeUlp(row.ulp_id)}>Lihat Laporan</button></td></tr>)}{!overview.length && <tr><td colSpan={6}>Belum ada ULP pada scope ini.</td></tr>}</tbody></table></div>
      <p className="uc-footnote">Hasil hanya menunjukkan kesesuaian kendaraan dan alat terhadap template. Tidak mengubah nilai atau indikator SLA.</p>
    </div> : bundle && !bundle.vehicles.length ? <div className="uc-empty"><h3>Kendaraan belum ditetapkan</h3><p>Belum ada kendaraan untuk {unitName} pada {conditionMonthLabel(month)}. Admin UP3 perlu menetapkan kendaraan beserta penugasan dan template alatnya terlebih dahulu.</p></div> : bundle ? <>
      <div className="uc-reference"><div><span>Unit Layanan</span><strong>{unitName}</strong></div><div><span>Periode</span><strong>{conditionMonthLabel(month)}</strong></div><div><span>{historical ? `Riwayat revisi ${historical.revision}` : 'Hasil Pemeriksaan'}</span><Status value={summary.status} /></div></div>
      <div className="uc-summary" aria-live="polite"><div><strong>{summary.vehicleCount}</strong><span>Kendaraan Ditetapkan</span></div><div><strong>{summary.filled}<small>/{summary.total}</small></strong><span>Kondisi Terisi</span></div><div className={summary.failed ? 'uc-summary--danger' : ''}><strong>{summary.failed}</strong><span>Item Perlu Perhatian</span></div><div><strong>{summary.missingPlates}</strong><span>Nopol Belum Dilengkapi</span></div></div>
      <p className="uc-instruction">Kondisi awal setiap bulan otomatis 100%. Buka kendaraan hanya jika ada nopol yang perlu dilengkapi atau kondisi yang perlu diubah.</p>
      {future && <p className="uc-alert">Periode mendatang hanya untuk melihat penetapan. Nopol dan kondisi belum dapat disimpan dari periode ini.</p>}
      {historical && <p className="uc-alert">Melihat riwayat {timestamp(historical.created_at)}. <button type="button" className="sla-btn" onClick={() => setHistorical(null)}>Kembali ke Laporan Terkini</button></p>}
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
      <details className="uc-history"><summary>Riwayat laporan{bundle.history.length ? ` (${bundle.history.length} revisi terbaru)` : ''}</summary>{bundle.history.length ? <div className="uc-history-list">{bundle.history.map((entry) => <div key={entry.revision}><div><strong>Revisi {entry.revision}</strong><span>{timestamp(entry.created_at)} / {entry.actor_role === 'SUPER_ADMIN' ? 'Super Admin' : entry.actor_role === 'ADMIN_UP3' ? 'Admin UP3' : 'Admin ULP'}</span></div><Status value={historyStatus(entry)} /><button type="button" className="sla-btn" disabled={saving} onClick={() => { if (canChangeContext()) { setHistorical(entry); setSelectedVehicleId(null) } }}>Lihat</button></div>)}</div> : <p>Riwayat tersedia setelah laporan disimpan.</p>}</details>
      <p className="uc-footnote">Pemenuhan baik dihitung per alat. Kerusakan tetap membuat status Tidak Memenuhi. Tidak ada sinkronisasi indikator atau denda SLA.</p>
    </> : null}

    {selectedVehicle && selectedSummary && (
      <AlkesModal
        open
        onClose={() => closeVehicle()}
        eyebrow="PEMERIKSAAN KENDARAAN"
        title={selectedVehicle.plate_display || selectedVehicle.label}
        subtitle={`${selectedVehicle.label} · ${selectedVehicle.vehicle_type_name} / ${selectedVehicle.assignment_name}${vehicleLocationLabel(selectedVehicle) ? ` · ${vehicleLocationLabel(selectedVehicle)}` : ''}`}
        size="wide"
        dismissDisabled={saving}
        meta={<Status value={selectedSummary.hasAttention ? 'non_compliant' : selectedSummary.isComplete ? 'compliant' : 'draft'} />}
        footer={(
          <div className="uc-modal-footer">
            <span>{saving ? 'Menyimpan...' : !editable ? (historical ? 'Mode riwayat baca saja' : 'Hanya baca') : !selectedVehicle.plate_display ? 'Lengkapi nopol kendaraan terlebih dahulu' : dirty ? 'Ada perubahan belum disimpan' : selectedIsDefault ? 'Default bulan ini 100%' : 'Tidak ada perubahan'}</span>
            <div className="alkes-modal-actions">
              <button type="button" className="sla-btn" disabled={saving} onClick={() => closeVehicle()}>{editable ? 'Batal' : 'Tutup'}</button>
              {editable && <button type="button" className="sla-btn sla-btn-primary" disabled={saving || !dirty || !selectedVehicle.plate_display} onClick={saveVehicle}>{saving ? 'Menyimpan...' : 'Simpan Kondisi'}</button>}
            </div>
          </div>
        )}
      >
        <div className="alkes-modal-form">
          {modalError && <p className="alkes-modal-alert" role="alert">{modalError}</p>}
          {modalMessage && <p className="uc-alert" role="status">{modalMessage}</p>}
          {selectedIsDefault && !dirty && (
            <p className="uc-alert" role="status">Kondisi awal bulan ini otomatis 100%. Simpan hanya jika ada kondisi yang perlu diubah.</p>
          )}
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
            </div>
            {selectedVehicle.plate_display && editable && !plateEdit && (
              <div className="uc-plate-entry uc-plate-entry--filled">
                <div className="uc-plate-current"><span>Nomor Polisi</span><strong>{selectedVehicle.plate_display}</strong></div>
                <button type="button" className="sla-btn" disabled={saving || vehicleItemsDirty} title={vehicleItemsDirty ? 'Simpan kondisi yang sedang diisi terlebih dahulu.' : undefined} onClick={openPlateEdit}>Edit Nopol</button>
                <p>Nopol salah ketik dapat dikoreksi di sini. Nopol pada laporan bulanan tersimpan juga akan diperbarui oleh sistem.</p>
              </div>
            )}
            {selectedVehicle.plate_display && editable && plateEdit && (
              <div className="uc-plate-entry uc-plate-entry--edit">
                <label htmlFor={`plate-edit-${selectedVehicle.id}`}>Nomor Polisi *<input id={`plate-edit-${selectedVehicle.id}`} maxLength={30} autoComplete="off" data-autofocus value={plateEdit.plate} placeholder="Contoh: KB 1234 XX" onChange={(event) => updatePlateEdit({ plate: event.target.value })} /></label>
                <div className="uc-plate-reason">
                  <label htmlFor={`plate-reason-${selectedVehicle.id}`}>Alasan Koreksi *<textarea id={`plate-reason-${selectedVehicle.id}`} maxLength={500} rows={2} placeholder="Contoh: salah ketik huruf akhir" value={plateEdit.reason} onChange={(event) => updatePlateEdit({ reason: event.target.value })} /></label>
                  <div className="alkes-modal-actions">
                    <button type="button" className="sla-btn" disabled={saving} onClick={() => setPlateEdit(null)}>Batal</button>
                    <button type="button" className="sla-btn sla-btn-primary" disabled={saving || !plateEdit.plate.trim() || !plateEdit.reason.trim()} onClick={savePlateCorrection}>{saving ? 'Menyimpan...' : 'Simpan Koreksi'}</button>
                  </div>
                </div>
                <p>Nopol baru menggantikan nopol pada penetapan ini; laporan tersimpan yang memuat nopol lama ikut diperbarui. Lokasi, template, kondisi, dan status tidak berubah.</p>
              </div>
            )}
            {!selectedVehicle.plate_display && editable && (
              <div className="uc-plate-entry">
                <label htmlFor={`plate-${selectedVehicle.id}`}>Nomor Polisi *<input data-autofocus id={`plate-${selectedVehicle.id}`} maxLength={30} autoComplete="off" value={plates[selectedVehicle.id] || ''} placeholder="Contoh: KB 1234 XX" onChange={(event) => { setPlates((prev) => ({ ...prev, [selectedVehicle.id]: event.target.value })); setModalError(''); setModalMessage('') }} /></label>
                <button type="button" className="sla-btn sla-btn-primary" disabled={saving || !(plates[selectedVehicle.id] || '').trim()} onClick={() => savePlate(selectedVehicle)}>Simpan Nopol</button>
                <p>Diisi sekali oleh Admin ULP. Nopol diperlukan sebelum kondisi dapat disimpan.</p>
              </div>
            )}
            {!selectedVehicle.plate_display && !editable && <p className="uc-alert">Nomor polisi belum dilengkapi untuk kendaraan ini.</p>}
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

          <section className="alkes-modal-section">
            <div className="alkes-modal-section-head">
              <div>
                <h3>Peralatan di Kendaraan</h3>
                <p>Jumlah Baik + Rusak harus sama dengan jumlah kontrak. Mengubah salah satu akan melengkapi kolom lainnya.</p>
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
            <div className="uc-scroll"><table className="uc-table uc-table--conditions"><thead><tr><th>Peralatan</th><th>Jumlah dalam Kontrak</th><th>Ada di ULP</th><th>Baik</th><th>Rusak</th><th>Persentase</th><th>Keterangan</th></tr></thead><tbody>
              {selectedTools.map(([category, rows]) => <Fragment key={category}>
                <tr className="uc-category"><th colSpan={7}>{category}<span>{rows.length} jenis</span></th></tr>
                {rows.map((item) => {
                  const result = evaluateCondition(item)
                  return <tr key={item.key} className={result.status === 'non_compliant' ? 'uc-row--failed' : ''}>
                    <td data-label="Peralatan"><strong>{item.name}</strong><span className="uc-item-unit">{item.unit}{item.specification ? ` / ${item.specification}` : ''}</span><details className="uc-note"><summary>Catatan{item.note ? ' terisi' : ''}</summary>{editable ? <textarea aria-label={`Catatan ${item.name} ${selectedVehicle.plate_display || selectedVehicle.label}`} maxLength={2000} value={item.note || ''} onChange={(event) => updateItem(item.key, { note: event.target.value })} /> : <p>{item.note || 'Tidak ada catatan.'}</p>}</details></td>
                    <td data-label="Jumlah dalam Kontrak">{item.required_qty} <span className="uc-muted">{item.unit}</span></td>
                    <td data-label="Ada di ULP">{item.required_qty} <span className="uc-muted">{item.unit}</span></td>
                    {['good_qty', 'bad_qty'].map((field) => <td key={field} data-label={field === 'good_qty' ? 'Baik' : 'Rusak'}>{editable ? <input ref={(node) => { if (node) inputRefs.current.set(`${item.key}:${field}`, node); else inputRefs.current.delete(`${item.key}:${field}`) }} className="uc-count" inputMode="numeric" autoComplete="off" value={item[field] ?? ''} placeholder="Isi" aria-label={`${field === 'good_qty' ? 'Baik' : 'Rusak'} ${item.name} ${selectedVehicle.plate_display || selectedVehicle.label}`} aria-invalid={result.status === 'invalid'} onChange={(event) => updateToolQuantity(item, field, event.target.value)} onKeyDown={(event) => moveFocus(event, item.key, field)} /> : (item[field] ?? '-')}</td>)}
                    <td data-label="Persentase">{result.percentage == null ? '-' : `${Number(result.percentage.toFixed(1))}%`}</td><td data-label="Keterangan"><Status value={result.status} />{result.status === 'non_compliant' && <small className="uc-row-reason">{Number(item.bad_qty) > 0 ? 'Ada kondisi rusak' : 'Jumlah baik kurang'}</small>}{result.status === 'invalid' && <small className="uc-row-reason">{result.issue || 'Periksa jumlah kondisi.'}</small>}</td>
                  </tr>
                })}
              </Fragment>)}
              {!selectedTools.length && <tr><td colSpan={7} className="uc-empty">Tidak ada peralatan pada template kendaraan ini.</td></tr>}
            </tbody></table></div>
          </section>

          {discardPrompt && (
            <div ref={discardRef} className="alkes-modal-discard" role="alert">
              <div>
                <strong>Isian kendaraan belum disimpan</strong>
                <span>Perubahan kondisi akan hilang jika modal ditutup sekarang.</span>
              </div>
              <div className="alkes-modal-actions">
                <button type="button" className="sla-btn" disabled={saving} onClick={() => setDiscardPrompt(false)}>Tetap Mengisi</button>
                <button type="button" className="sla-btn sla-btn-primary" disabled={saving} onClick={() => closeVehicle(true)}>Tutup Tanpa Menyimpan</button>
              </div>
            </div>
          )}
        </div>
      </AlkesModal>
    )}
  </section>
}
