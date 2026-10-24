import { Fragment, useEffect, useRef, useState } from 'react'
import {
  CONDITION_LABELS, conditionMonthLabel, conditionSnapshot, currentConditionMonth,
  evaluateCondition, groupVehicleConditions, parseConditionCount, summarizeConditions, summarizeFleet,
} from '../../data/ulpConditionDomain.js'
import { getUlpConditionReport, listUlpConditionOverview, saveUlpConditionReport, setPrescribedVehiclePlate } from '../../data/ulpConditionRepository.js'

function Status({ value }) {
  return <span className={`uc-status uc-status--${value || 'unfilled'}`}>{CONDITION_LABELS[value] || 'Belum Diisi'}</span>
}

function timestamp(value) {
  return value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Pontianak' }).format(new Date(value)) : ''
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
  const [plates, setPlates] = useState({})
  const [overview, setOverview] = useState([])
  const [baseline, setBaseline] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [historical, setHistorical] = useState(null)
  const request = useRef(0)
  const saveLock = useRef(false)
  const inputRefs = useRef(new Map())
  const vehicleMetadataDirty = Boolean(bundle?.report && bundle.vehicles.some((vehicle) =>
    (bundle.report.vehicles.find((saved) => saved.id === vehicle.id)?.plate_display || '') !== (vehicle.plate_display || '')))
  const reportDirty = Boolean(canManage && ((baseline && conditionSnapshot(items) !== baseline) || vehicleMetadataDirty))
  const plateDirty = Boolean(canManage && bundle && bundle.vehicles.some((vehicle) => (plates[vehicle.id] || '').trim() !== (vehicle.plate_display || '')))
  const dirty = reportDirty || plateDirty
  const isOverview = canPickUlp && !ulpId
  const future = month > currentConditionMonth()
  const editable = canManage && !future && !historical
  const shownItems = historical?.snapshot.items || items
  const shownVehicles = historical?.snapshot.vehicles || bundle?.vehicles || []
  const grouped = groupVehicleConditions(shownVehicles, shownItems)
  const summary = summarizeFleet(shownVehicles, shownItems)
  const unitName = ulps.find((unit) => unit.uuid === ulpId)?.displayName || 'ULP'

  const applyBundle = (data) => {
    setBundle(data)
    setItems(data.items || [])
    setBaseline(conditionSnapshot(data.items || []))
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
    setPlates({})
    setBaseline('')
    setHistorical(null)
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

  const canChangeContext = () => !saveLock.current && (!dirty || window.confirm('Isian nopol/kondisi belum disimpan. Tinggalkan perubahan?'))
  const changeUlp = (value) => { if (value !== ulpId && canChangeContext()) setUlpId(value) }
  const changeMonth = (value) => {
    if (!/^\d{4}-\d{2}$/.test(value) || value === month || !canChangeContext()) return
    setMonth(value)
    onMonthChange?.(`${value}-01`)
  }
  const updateItem = (key, patch) => {
    if (saveLock.current) return
    setItems((prev) => prev.map((item) => item.key === key ? { ...item, ...patch } : item))
    setMessage('')
  }
  const moveFocus = (event, key, field) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const ordered = grouped.flatMap(({ groups }) => groups.flatMap(([, rows]) => rows))
    const next = field === 'good_qty' ? `${key}:bad_qty` : `${ordered[ordered.findIndex((item) => item.key === key) + 1]?.key}:good_qty`
    inputRefs.current.get(next)?.focus()
  }
  const savePlate = async (vehicle) => {
    if (!editable || saveLock.current) return
    const plate = (plates[vehicle.id] || '').trim()
    const normalized = plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (normalized.length < 2 || normalized.length > 12) { setError('Isi nomor polisi yang valid (2 sampai 12 huruf/angka).'); return }
    saveLock.current = true
    setSaving(true)
    setError('')
    setMessage('')
    const token = request.current
    try {
      const saved = await setPrescribedVehiclePlate(vehicle, plate)
      if (token !== request.current) return
      setBundle((prev) => ({ ...prev, vehicles: prev.vehicles.map((row) => row.id === vehicle.id ? { ...row, plate_display: saved.plate_display, plate_normalized: saved.plate_normalized, revision: saved.revision } : row) }))
      setPlates((prev) => ({ ...prev, [vehicle.id]: saved.plate_display }))
      setMessage(`Nopol ${saved.plate_display} tersimpan. Lanjutkan pengisian kondisi kendaraan dan alatnya.`)
    } catch (saveError) { if (token === request.current) setError(saveError.message) }
    finally { saveLock.current = false; setSaving(false) }
  }
  const save = async () => {
    if (saveLock.current || !editable || !bundle?.vehicles.length) return
    if (plateDirty) { setError('Simpan nopol yang sedang diketik terlebih dahulu. Isian kondisi tetap tersimpan di form.'); return }
    const invalid = items.find((item) => evaluateCondition(item).status === 'invalid')
    if (invalid) {
      setError('Periksa angka yang tidak valid. Gunakan bilangan bulat 0 sampai 2147483647; kondisi kendaraan hanya satu pilihan Baik atau Rusak.')
      const field = Number.isNaN(parseConditionCount(invalid.good_qty)) ? 'good_qty' : 'bad_qty'
      inputRefs.current.get(`${invalid.key}:${field}`)?.focus()
      return
    }
    saveLock.current = true
    setSaving(true)
    setError('')
    setMessage('')
    const token = request.current
    try {
      const saved = await saveUlpConditionReport({ contractId: contractUuid, up3Id: up3Uuid, ulpId, month }, bundle, items)
      if (token !== request.current) return
      applyBundle(saved)
      setMessage(saved.report.status === 'draft' ? 'Draft tersimpan. Lengkapi nopol dan pemeriksaan yang belum diisi.' : 'Laporan kondisi per kendaraan tersimpan beserta riwayatnya.')
    } catch (saveError) { if (token === request.current) setError(saveError.message) }
    finally { saveLock.current = false; setSaving(false) }
  }

  return <section className="uc-workspace">
    <header className="uc-header"><div><span className="uc-eyebrow">PEMERIKSAAN BULANAN</span><h2>Alat & Kendaraan</h2><p>{isOverview ? 'Pantau kendaraan, nopol, dan kelengkapan pemeriksaan setiap ULP.' : 'Kendaraan dan penugasan ditetapkan UP3. Lengkapi nopol, lalu isi kondisi alat di kendaraan tersebut.'}</p></div><div className="uc-context">
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
      <div className="uc-reference"><div><span>Unit Layanan</span><strong>{unitName}</strong></div><div><span>Periode</span><strong>{conditionMonthLabel(month)}</strong></div><div><span>{historical ? `Riwayat revisi ${historical.revision}` : 'Hasil Pemeriksaan'}</span><Status value={historical?.snapshot.status || (!bundle.report && !dirty ? 'unfilled' : summary.status)} /></div></div>
      <div className="uc-summary" aria-live="polite"><div><strong>{summary.vehicleCount}</strong><span>Kendaraan Ditetapkan</span></div><div><strong>{summary.filled}<small>/{summary.total}</small></strong><span>Pemeriksaan Terisi</span></div><div className={summary.failed ? 'uc-summary--danger' : ''}><strong>{summary.failed}</strong><span>Tidak Memenuhi</span></div><div><strong>{summary.missingPlates}</strong><span>Nopol Belum Dilengkapi</span></div></div>
      <p className="uc-instruction">Alat mengikuti kendaraan masing-masing. Kondisi baik di kendaraan lain tidak menutupi kekurangan atau kerusakan di kendaraan ini. Isi <strong>0</strong> bila tidak ada; kosong berarti belum diisi.</p>
      {future && <p className="uc-alert">Periode mendatang hanya untuk melihat penetapan. Nopol dan kondisi belum dapat disimpan dari periode ini.</p>}
      {historical && <p className="uc-alert">Melihat riwayat {timestamp(historical.created_at)}. <button type="button" className="sla-btn" onClick={() => setHistorical(null)}>Kembali ke Laporan Terkini</button></p>}
      <fieldset className="uc-fields uc-fleet-report" disabled={saving} aria-busy={saving}>
        {grouped.map(({ vehicle, condition, groups }) => {
          const vehicleItems = shownItems.filter((item) => item.vehicle_id === vehicle.id)
          const vehicleSummary = summarizeConditions(vehicleItems)
          return <section className="uc-vehicle" key={vehicle.id}>
            <header className="uc-vehicle-heading"><div><span className="uc-eyebrow">{vehicle.label}</span><h3>{vehicle.plate_display || 'Nopol Belum Dilengkapi'}</h3><p>{vehicle.vehicle_type_name} / <strong>{vehicle.assignment_name}</strong></p></div>{vehicle.plate_display ? <Status value={vehicleSummary.status} /> : <span className="uc-status uc-status--draft">Belum Dilengkapi</span>}</header>
            <div className="uc-vehicle-reference"><span>Template: <strong>{vehicle.template_name}</strong> / versi {vehicle.template_version}</span>{vehicle.contract_reference && <span>Acuan: {vehicle.contract_reference}</span>}{vehicle.legacy_metadata && <span>Template lama: metadata katalog dibekukan saat laporan pertama disimpan.</span>}</div>
            {!vehicle.plate_display && (editable ? <div className="uc-plate-entry"><label htmlFor={`plate-${vehicle.id}`}>Nomor Polisi *<input id={`plate-${vehicle.id}`} maxLength={30} autoComplete="off" value={plates[vehicle.id] || ''} placeholder="Contoh: KB 1234 XX" onChange={(event) => { setPlates((prev) => ({ ...prev, [vehicle.id]: event.target.value })); setMessage('') }} /></label><button type="button" className="sla-btn sla-btn-primary" disabled={!(plates[vehicle.id] || '').trim()} onClick={() => savePlate(vehicle)}>Simpan Nopol</button><p>Diisi sekali oleh Admin ULP. Jenis, penugasan, dan daftar alat sudah ditentukan UP3.</p></div> : <p className="uc-alert">Admin ULP belum melengkapi nomor polisi kendaraan ini.</p>)}
            {condition && <div className="uc-vehicle-condition"><span>Kondisi Kendaraan *</span>{editable ? <div className="uc-condition-options">{[['Baik', 1, 0], ['Rusak', 0, 1]].map(([label, good, bad]) => <label key={label}><input type="radio" name={`condition-${vehicle.id}`} checked={Number(condition.good_qty) === good && Number(condition.bad_qty) === bad && condition.good_qty != null && condition.bad_qty != null} onChange={() => updateItem(condition.key, { good_qty: good, bad_qty: bad })} />{label}</label>)}</div> : <Status value={evaluateCondition(condition).status} />}</div>}
            <div className="uc-scroll"><table className="uc-table uc-table--conditions"><thead><tr><th>Peralatan di Kendaraan</th><th>Kebutuhan</th><th>Baik</th><th>Rusak</th><th>Ada</th><th>Pemenuhan Baik</th><th>Status</th></tr></thead><tbody>{groups.map(([category, rows]) => <Fragment key={category}>
              <tr className="uc-category"><th colSpan={7}>{category}<span>{rows.length} jenis</span></th></tr>
              {rows.map((item) => {
                const result = evaluateCondition(item)
                return <tr key={item.key} className={result.status === 'non_compliant' ? 'uc-row--failed' : ''}>
                  <td data-label="Peralatan"><strong>{item.name}</strong><span className="uc-item-unit">{item.unit}{item.specification ? ` / ${item.specification}` : ''}</span><details className="uc-note"><summary>Catatan{item.note ? ' terisi' : ''}</summary>{editable ? <textarea aria-label={`Catatan ${item.name} ${vehicle.plate_display || vehicle.label}`} maxLength={2000} value={item.note || ''} onChange={(event) => updateItem(item.key, { note: event.target.value })} /> : <p>{item.note || 'Tidak ada catatan.'}</p>}</details></td>
                  <td data-label="Kebutuhan">{item.required_qty} <span className="uc-muted">{item.unit}</span></td>
                  {['good_qty', 'bad_qty'].map((field) => <td key={field} data-label={field === 'good_qty' ? 'Baik' : 'Rusak'}>{editable ? <input ref={(node) => { if (node) inputRefs.current.set(`${item.key}:${field}`, node); else inputRefs.current.delete(`${item.key}:${field}`) }} className="uc-count" inputMode="numeric" autoComplete="off" value={item[field] ?? ''} placeholder="Isi" aria-label={`${field === 'good_qty' ? 'Baik' : 'Rusak'} ${item.name} ${vehicle.plate_display || vehicle.label}`} aria-invalid={Number.isNaN(parseConditionCount(item[field]))} onChange={(event) => updateItem(item.key, { [field]: event.target.value })} onKeyDown={(event) => moveFocus(event, item.key, field)} /> : (item[field] ?? '-')}</td>)}
                  <td data-label="Ada">{result.available ?? '-'}</td><td data-label="Pemenuhan Baik">{result.percentage == null ? '-' : `${Number(result.percentage.toFixed(1))}%`}</td><td data-label="Status"><Status value={result.status} />{result.status === 'non_compliant' && <small className="uc-row-reason">{Number(item.bad_qty) > 0 ? 'Ada kondisi rusak' : 'Jumlah baik kurang'}</small>}{result.status === 'invalid' && <small className="uc-row-reason">Gunakan bilangan bulat 0 atau lebih.</small>}</td>
                </tr>
              })}
            </Fragment>)}</tbody></table></div>
          </section>
        })}
        {!historical && <div className="uc-savebar"><div aria-live="polite"><strong>{saving ? 'Menyimpan...' : dirty ? 'Ada perubahan belum disimpan' : bundle.report ? 'Laporan Tersimpan' : 'Belum ada laporan tersimpan'}</strong><span>{bundle.report ? `Revisi ${bundle.report.revision} / ${timestamp(bundle.report.updated_at)}` : 'Nopol belum diisi dan kondisi kosong tidak dianggap memenuhi.'}</span></div>{canManage && !future && <button type="button" className="sla-btn sla-btn-primary" disabled={saving || !reportDirty || summary.invalid > 0 || plateDirty} onClick={save}>{saving ? 'Menyimpan...' : summary.status === 'draft' ? 'Simpan Draft' : 'Simpan Laporan'}</button>}</div>}
      </fieldset>
      <details className="uc-history"><summary>Riwayat laporan{bundle.history.length ? ` (${bundle.history.length} revisi terbaru)` : ''}</summary>{bundle.history.length ? <div className="uc-history-list">{bundle.history.map((entry) => <div key={entry.revision}><div><strong>Revisi {entry.revision}</strong><span>{timestamp(entry.created_at)} / {entry.actor_role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin ULP'}</span></div><Status value={entry.snapshot.status} /><button type="button" className="sla-btn" disabled={saving} onClick={() => { if (canChangeContext()) setHistorical(entry) }}>Lihat</button></div>)}</div> : <p>Riwayat tersedia setelah laporan disimpan.</p>}</details>
      <p className="uc-footnote">Pemenuhan baik dihitung per alat, maksimal 100%. Kerusakan tetap membuat status Tidak Memenuhi. Tidak ada sinkronisasi indikator atau denda SLA.</p>
    </> : null}
  </section>
}
