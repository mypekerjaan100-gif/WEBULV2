import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { BBM_TYPES, bbmToday, bbmNumber as fmt, calculateBbm, validateBbm, purchaseTotal } from '../../data/bbmDomain.js'
import { listBbmVehicles, getBbmSheet, saveBbmSheet, uploadBbmPhoto, getBbmPhoto } from '../../data/bbmRepository.js'
import './BbmReport.css'

const labelDate = (date, options) => {
  const parsed = new Date(`${date}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('id-ID', options).format(parsed)
}
const emptyPurchase = () => ({ fuel: '', liters: '', price: '', place: '', photo: '' })

export default function BbmReport({ contractId, up3Id, units, ownUlpId, canWrite = false, previewActive = false, initialMonth, onMonthChange, onEditorStateChange }) {
  const [month, setMonth] = useState(initialMonth.slice(0, 7))
  const [ulp, setUlp] = useState(ownUlpId || '')
  const [vehicles, setVehicles] = useState([])
  const [vehicleId, setVehicleId] = useState('')
  const [sheet, setSheet] = useState(null)
  const [rows, setRows] = useState([])
  const [details, setDetails] = useState({})
  const [initial, setInitial] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const [photo, setPhoto] = useState(null)
  const lock = useRef(false)
  const vehicle = vehicles.find((v) => v.id === vehicleId)
  const ulpName = units.find((u) => u.uuid === (vehicle?.ulp_id || ulp))?.displayName || 'ULP'
  const selectedVehicles = vehicles.filter((v) => !ulp || v.ulp_id === ulp)
  const editable = canWrite && !previewActive && sheet?.can_write && !busy && !loading
  const calculated = calculateBbm(month, rows, initial, sheet?.previous)
  const periodLabel = labelDate(`${month}-01`, { month: 'long', year: 'numeric' })
  const today = bbmToday()
  const lastDay = calculated.days.at(-1)?.date
  const apply = (data) => { setSheet(data); setRows(data.rows || []); setDetails(data.details || {}); setInitial(data.initial_odometer ?? ''); setDirty(false) }
  const mayLeave = () => !lock.current && (!dirty || window.confirm('Perubahan laporan BBM belum disimpan. Tinggalkan perubahan?'))
  useEffect(() => {
    onEditorStateChange?.({ dirty, busy })
    const prevent = (e) => { if (dirty || busy) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', prevent)
    return () => { window.removeEventListener('beforeunload', prevent); onEditorStateChange?.({ dirty: false, busy: false }) }
  }, [dirty, busy, onEditorStateChange])
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setVehicles([]); setSheet(null)
    listBbmVehicles({ contractId, up3Id, month }).then((data) => {
      if (!active) return
      const allowed = ownUlpId ? data.filter((v) => v.ulp_id === ownUlpId) : data
      setVehicles(allowed)
      setVehicleId((id) => allowed.some((v) => v.id === id && (!ulp || v.ulp_id === ulp)) ? id : (allowed.find((v) => !ulp || v.ulp_id === ulp)?.id || ''))
    }).catch((e) => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [contractId, up3Id, month, ownUlpId, ulp, reload])
  useEffect(() => {
    let active = true
    setSheet(null); setRows([]); setDetails({}); setInitial(''); setDirty(false); setMessage('')
    if (!vehicleId || !vehicles.some((v) => v.id === vehicleId)) return
    setLoading(true); setError('')
    getBbmSheet(vehicleId, month).then((data) => { if (active) apply(data) })
      .catch((e) => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [vehicleId, vehicles, month])
  const updateRow = (date, changes) => {
    setRows((old) => {
      const existing = old.find((r) => r.date === date) || { date, end: '', photo: '', purchases: [] }
      return [...old.filter((r) => r.date !== date), { ...existing, ...changes }].sort((a, b) => a.date.localeCompare(b.date))
    }); setDirty(true); setMessage('')
  }
  const updatePurchase = (date, index, changes) => {
    const purchases = [...(rows.find((r) => r.date === date)?.purchases || [])]
    purchases[index] = { ...purchases[index], ...changes }
    updateRow(date, { purchases })
  }
  const updateDetails = (key, value) => { setDetails((old) => ({ ...old, [key]: value })); setDirty(true); setMessage('') }
  const upload = async (date, index, file) => {
    if (!file || lock.current || !editable) return
    lock.current = true; setBusy(true); setError('')
    try {
      const path = await uploadBbmPhoto(vehicleId, date, index == null ? 'odometer' : 'receipt', file)
      if (index == null) updateRow(date, { photo: path }); else updatePurchase(date, index, { photo: path })
    } catch (e) { setError(e.message) } finally { lock.current = false; setBusy(false) }
  }
  const showPhoto = async (path) => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { setPhoto(await getBbmPhoto(path)) } catch (e) { setError(e.message) }
    finally { lock.current = false; setBusy(false) }
  }
  const save = async () => {
    if (!editable || lock.current) return
    setError(''); setMessage('')
    try { validateBbm(rows, initial, sheet.previous) } catch (e) { setError(e.message); return }
    lock.current = true; setBusy(true)
    try {
      apply(await saveBbmSheet(vehicleId, month, sheet.revision, initial, rows, details))
      setMessage('Laporan BBM tersimpan.')
    } catch (e) { setError(e.message) }
    finally { lock.current = false; setBusy(false) }
  }
  const photoCell = (date, path, index = null) => <span className="bbm-photo">
    {path && <button type="button" disabled={busy} title="Lihat foto" aria-label={`Lihat foto ${index == null ? 'odometer' : 'struk'} ${date}`} onClick={() => showPhoto(path)}><Icon name="check-circle" size={14} /></button>}
    {editable && date <= today && <label title={path ? 'Ganti foto' : 'Unggah foto wajib'}><Icon name="camera" size={14} /><input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Foto ${index == null ? 'odometer' : `struk ${index + 1}`} ${date}`} onChange={(e) => { upload(date, index, e.target.files?.[0]); e.target.value = '' }} /></label>}
    {!path && !editable && <span>—</span>}
  </span>
  const meta = (key, placeholder, type = 'text') => <input type={type} maxLength={160} aria-label={placeholder} placeholder={placeholder} value={details[key] || ''} disabled={!editable} onChange={(e) => updateDetails(key, e.target.value)} />
  const navigateCells = (event) => {
    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key) || event.target.tagName !== 'INPUT' || event.target.type !== 'number') return
    const prefix = event.target.getAttribute('aria-label')?.replace(/\d{4}-\d{2}-\d{2}.*$/, '')
    const inputs = [...event.currentTarget.querySelectorAll('input[type="number"]:not(:disabled)')].filter((input) => input.getAttribute('aria-label')?.startsWith(prefix))
    const next = inputs[inputs.indexOf(event.target) + (event.key === 'ArrowUp' || event.shiftKey ? -1 : 1)]
    event.preventDefault(); next?.focus(); next?.select()
  }
  return <section className="bbm-report">
    <div className="bbm-toolbar">
      <div><Icon name="fuel" /><strong>Laporan BBM</strong><span className="bbm-mode">{canWrite && !previewActive ? 'Lembar kerja harian' : 'Hanya lihat'}</span></div>
      <div>
        <label>Periode <input aria-label="Periode BBM" type="month" value={month} max={today.slice(0, 7)} disabled={busy} onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value) && e.target.value <= today.slice(0, 7) && mayLeave()) { setVehicleId(''); setMonth(e.target.value); onMonthChange?.(e.target.value) } }} /></label>
        {!ownUlpId && <label>ULP <select aria-label="ULP laporan BBM" value={ulp} disabled={busy} onChange={(e) => { if (mayLeave()) { setVehicleId(''); setUlp(e.target.value) } }}><option value="">Semua ULP</option>{units.filter((u) => u.type === 'ULP').map((u) => <option key={u.uuid} value={u.uuid}>{u.displayName}</option>)}</select></label>}
        <label>Nopol <select aria-label="Kendaraan BBM" value={vehicleId} disabled={busy || loading} onChange={(e) => { if (mayLeave()) setVehicleId(e.target.value) }}><option value="">Pilih kendaraan</option>{selectedVehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_display || 'Nopol belum diisi'} · {v.label}</option>)}</select></label>
        <button type="button" disabled={busy || loading} onClick={() => { if (mayLeave()) setReload((n) => n + 1) }}><Icon name="refresh-cw" size={16} /> Muat ulang</button>
        {canWrite && !previewActive && <button className="bbm-save" type="button" disabled={!editable || !dirty || !vehicle?.plate_display} onClick={save}><Icon name="save" size={16} />{busy ? 'Memproses…' : 'Simpan laporan'}</button>}
      </div>
    </div>
    {error && <p role="alert" className="bbm-error">{error}</p>}
    {message && <p role="status" className="bbm-success">{message}</p>}
    {loading ? <p role="status">Memuat lembar kerja BBM…</p> : !sheet ? <p>{error ? 'Laporan belum dapat dimuat. Gunakan Muat ulang.' : 'Belum ada kendaraan pada ULP/periode ini.'}</p> : <>
      <div className="bbm-help"><span><Icon name="pencil" size={14} /> Sel putih: isian</span><span><Icon name="lock" size={14} /> Sel abu-abu: otomatis</span><span><Icon name="camera" size={14} /> Foto wajib setiap hari</span><span>{calculated.recorded}/{calculated.days.length} hari tercatat{dirty ? ' · Belum disimpan' : ''}</span></div>
      {!vehicle?.plate_display && <p className="bbm-error">Isi nopol kendaraan pada Alat & Kendaraan terlebih dahulu.</p>}
      {calculated.gaps > 0 && <p className="bbm-warning">Ada tanggal yang belum dicatat. Stand awal memakai catatan terakhir yang tersedia; sel bertanda ! mencakup jarak beberapa hari. Lengkapi tanggal kosong agar rekap harian akurat.</p>}
      <div className="bbm-scroll" tabIndex={0} aria-label="Lembar kerja BBM, geser horizontal untuk seluruh kolom">
        <div className="bbm-paper">
          <header className="bbm-heading"><h2>BERITA ACARA VERIFIKASI PEMAKAIAN BAHAN BAKAR MINYAK (BBM)</h2><h3>KENDARAAN OPERASIONAL PELAYANAN TEKNIK</h3><h3>{ulpName.toUpperCase()}</h3></header>
          <p className="bbm-intro">Pada hari ini, <input className="bbm-inline-date" type="date" aria-label="Tanggal berita acara" value={details.report_date || ''} disabled={!editable} onChange={(e) => updateDetails('report_date', e.target.value)} />, dilakukan verifikasi terhadap pemakaian dan biaya bahan bakar minyak (BBM) kendaraan operasional<br />Pelayanan Teknik (Yantek) {ulpName}, selama bulan <strong>{periodLabel.toUpperCase()}</strong>, dengan data sebagai berikut:</p>
          <table className="bbm-grid" onKeyDown={navigateCells}><colgroup>{[34,72,52,90,126,76,96,94,90,100,74,38,80,104,118].map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
            <thead>
              <tr><th rowSpan={3}>No</th><th rowSpan={3}><Icon name="calendar" size={14} /> Hari</th><th rowSpan={3}>Tgl</th><th colSpan={4}><Icon name="vehicle" size={16} /> {vehicle?.label}</th><th colSpan={2} rowSpan={2}><Icon name="fuel" size={16} /> Jenis BBM</th><th colSpan={2} rowSpan={2}>Pembelian *)</th><th rowSpan={3}>STN</th><th rowSpan={3}>Jml Vol</th><th rowSpan={3}>Harga Satuan Beli</th><th rowSpan={3}><Icon name="wallet" size={14} /> Jumlah Harga</th></tr>
              <tr><th colSpan={2}>{vehicle?.plate_display || 'NOPOL BELUM DIISI'}</th><th colSpan={2}>Jumlah</th></tr>
              <tr><th><Icon name="gauge" size={14} /> Stand Awal</th><th><Icon name="gauge" size={14} /> Stand Akhir / Foto</th><th>ltr</th><th>Harga / ltr</th><th colSpan={2}>Jenis</th><th>Tempat</th><th><Icon name="billing" size={14} /> Struk</th></tr>
            </thead>
            <tbody>{calculated.days.flatMap((day, dayIndex) => {
              const r = day.row || { purchases: [] }
              const ps = r.purchases.length ? r.purchases : [null]
              const firstRecord = dayIndex === 0
              return ps.map((p, pi) => <tr key={`${day.date}:${pi}`} className={`${day.date > today ? 'bbm-future' : ''} ${day.date === today ? 'bbm-today' : ''}`}>
                {pi === 0 && <><td rowSpan={ps.length} className="bbm-auto">{dayIndex + 1}{editable && day.row && !sheet.rows.some((saved) => saved.date === day.date) && <button type="button" className="bbm-clear" title="Kosongkan baris baru" aria-label={`Kosongkan baris ${day.date}`} onClick={() => { if (window.confirm('Kosongkan isian baru pada tanggal ini?')) { setRows((old) => old.filter((r) => r.date !== day.date)); setDirty(true) } }}>×</button>}</td><td rowSpan={ps.length} className="bbm-auto">{labelDate(day.date, { weekday: 'long' }).toUpperCase()}</td><td rowSpan={ps.length} className="bbm-auto">{dayIndex + 1}</td>
                  <td rowSpan={ps.length} className="bbm-auto bbm-num" title={day.gap ? `Catatan terakhir: ${day.priorDate}` : 'Stand akhir catatan sebelumnya'}>
                    {sheet.revision === 0 && firstRecord ? <input aria-label={`Stand awal pertama ${day.date}`} type="number" step="0.1" min="0" value={initial} disabled={!editable || day.date > today} onChange={(e) => { setInitial(e.target.value); setDirty(true) }} /> : <>{day.showStart ? fmt(day.start, 1) : '—'}{day.gap ? ' !' : ''}</>}
                  </td>
                  <td rowSpan={ps.length} className="bbm-num"><div className="bbm-odo"><input aria-label={`Stand akhir ${day.date}`} type="number" step="0.1" min="0" value={r.end ?? ''} disabled={!editable || day.date > today} onChange={(e) => updateRow(day.date, { end: e.target.value })} />{photoCell(day.date, r.photo)}</div></td></>}
                <td>{p ? <input aria-label={`Liter ${day.date} ${pi + 1}`} type="number" min="0" step="0.001" value={p.liters} disabled={!editable} onChange={(e) => updatePurchase(day.date, pi, { liters: e.target.value })} /> : '—'}</td>
                <td>{p ? <input aria-label={`Harga per liter ${day.date} ${pi + 1}`} type="number" min="0" step="0.01" value={p.price} disabled={!editable} onChange={(e) => updatePurchase(day.date, pi, { price: e.target.value })} /> : '—'}</td>
                <td colSpan={2}>{p ? <select aria-label={`Jenis BBM ${day.date} ${pi + 1}`} value={p.fuel} disabled={!editable} onChange={(e) => updatePurchase(day.date, pi, { fuel: e.target.value })}><option value="">Pilih BBM</option>{BBM_TYPES.map((f) => <option key={f}>{f}</option>)}</select> : '—'}</td>
                <td>{p ? <input aria-label={`Tempat pembelian ${day.date} ${pi + 1}`} maxLength={200} placeholder="SPBU / eceran" value={p.place || ''} disabled={!editable} onChange={(e) => updatePurchase(day.date, pi, { place: e.target.value })} /> : '—'}</td>
                <td>{p ? photoCell(day.date, p.photo, pi) : '—'}</td>
                <td className="bbm-auto">Ltr</td><td className="bbm-auto bbm-num">{p ? fmt(p.liters, 3) : '—'}</td><td className="bbm-auto bbm-num">{p ? fmt(p.price) : '—'}</td>
                <td className="bbm-amount"><span>{p ? fmt(purchaseTotal(p)) : '—'}</span>{editable && day.date <= today && <span className="bbm-row-actions">
                  {pi === ps.length - 1 && r.purchases.length < 10 && <button type="button" title="Tambah pembelian" aria-label={`Tambah pembelian ${day.date}`} onClick={() => updateRow(day.date, { purchases: [...r.purchases, emptyPurchase()] })}><Icon name="plus" size={13} /></button>}
                  {p && <button type="button" title="Hapus pembelian" aria-label={`Hapus pembelian ${day.date} ${pi + 1}`} onClick={() => { if (window.confirm('Hapus transaksi pembelian ini dari laporan?')) updateRow(day.date, { purchases: r.purchases.filter((_, i) => i !== pi) }) }}><Icon name="close" size={13} /></button>}
                </span>}</td>
              </tr>)
            })}</tbody>
            <tfoot><tr><th rowSpan={3} colSpan={2}>TOTAL</th><th colSpan={2}>KILOMETER</th><td colSpan={3} className="bbm-num">{fmt(calculated.km, 1)} km</td><td colSpan={7}></td><td className="bbm-num">{fmt(calculated.total)}</td></tr><tr><th colSpan={2}>LITER</th><td colSpan={3} className="bbm-num">{fmt(calculated.liters, 3)}</td><td colSpan={5}></td><td className="bbm-num">{fmt(calculated.liters, 3)}</td><td colSpan={2}></td></tr><tr><th colSpan={2}>RASIO</th><td colSpan={3} className="bbm-num">{fmt(calculated.ratio, 3)} km/liter</td><td colSpan={8}>Rasio periode = kilometer tercatat ÷ liter dibeli</td></tr></tfoot>
          </table>
          <h4>SAMPLING **)</h4>
          <table className="bbm-grid bbm-sampling"><thead><tr><th>No</th><th>Hari</th><th>Tanggal</th><th>{vehicle?.label}<br />{vehicle?.plate_display}</th><th>Keterangan</th><th>Kesimpulan</th></tr></thead><tbody>{[0, 1, 2].map((i) => <tr key={i}><td>{i + 1}</td><td>{details[`sample_date_${i}`] ? labelDate(details[`sample_date_${i}`], { weekday: 'long' }) : '—'}</td><td>{meta(`sample_date_${i}`, `Tanggal sampling ${i + 1}`, 'date')}</td><td>{meta(`sample_check_${i}`, `Hasil pemeriksaan ${i + 1}`)}</td><td>{meta(`sample_note_${i}`, `Keterangan sampling ${i + 1}`)}</td><td>{meta(`sample_result_${i}`, `Kesimpulan sampling ${i + 1}`)}</td></tr>)}</tbody></table>
          <div className="bbm-notes"><div><strong>Keterangan:</strong><p>*) Pembelian sesuai transaksi pada struk.</p><p>**) Sampling diisi berdasarkan hasil pemeriksa dari Rayon.</p><p>Stand awal otomatis dari catatan terakhir. Hari tanpa pembelian tetap wajib diisi odometer dan fotonya.</p><p><Icon name="plus" size={14} /> Tambah transaksi · <Icon name="camera" size={14} /> Unggah foto · <Icon name="check-circle" size={14} /> Lihat foto</p></div><div><p>PTMX : Pertamax · PTLT : Pertalite · PREM : Premium</p><label>Tempat Pembelian BBM {meta('purchase_note', 'Keterangan tempat pembelian BBM')}</label><label>Nota / Kuitansi Pembelian BBM {meta('receipt_note', 'Keterangan nota / kuitansi')}</label></div></div>
          <div className="bbm-signatures"><div><p>Diperiksa,</p>{meta('inspector_title', 'Jabatan pemeriksa (TL Teknik)')}<div className="bbm-sign-space" />{meta('inspector_name', 'Nama pemeriksa')}</div><div><div className="bbm-sign-date">{meta('city', 'Tempat berita acara')}<span>{details.report_date ? labelDate(details.report_date, { day: 'numeric', month: 'long', year: 'numeric' }) : '____'}</span></div>{meta('coordinator_title', `Jabatan (Koordinator Yantek ${ulpName})`)}<div className="bbm-sign-space" />{meta('coordinator_name', 'Nama koordinator')}</div><div className="bbm-manager"><p>Mengetahui,</p><p>PT. PLN (Persero) {ulpName.toUpperCase()}</p>{meta('manager_title', 'Jabatan (Manager)')}<div className="bbm-sign-space" />{meta('manager_name', 'Nama manager')}</div></div>
          <p className="bbm-footnote">Format berita acara · Nama/jabatan diisi Admin ULP · Bukan persetujuan digital · Periode sampai {labelDate(lastDay, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>
    </>}
    {photo && <div className="bbm-lightbox" role="dialog" aria-modal="true" aria-label="Foto bukti BBM" onClick={() => setPhoto(null)}><button autoFocus onClick={() => setPhoto(null)} onKeyDown={(e) => { if (e.key === 'Escape') setPhoto(null) }}>Tutup <Icon name="close" /></button><img src={photo} alt="Foto bukti laporan BBM" onClick={(e) => e.stopPropagation()} /></div>}
  </section>
}
