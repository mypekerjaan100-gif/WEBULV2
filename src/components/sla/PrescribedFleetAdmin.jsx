import { useEffect, useRef, useState } from 'react'
import { conditionMonthLabel, currentConditionMonth, parseConditionCount } from '../../data/ulpConditionDomain.js'
import { createPrescribedVehicles, endPrescribedVehicle, listPrescribedVehicles } from '../../data/ulpConditionRepository.js'

export default function PrescribedFleetAdmin({ contractUuid, up3Uuid, templates, types, assignments, units, canManage, onDirtyChange, onBusyChange }) {
  const [month, setMonth] = useState(currentConditionMonth())
  const [ulpFilter, setUlpFilter] = useState('')
  const [fleet, setFleet] = useState([])
  const [form, setForm] = useState(null)
  const [baseline, setBaseline] = useState('')
  const [ending, setEnding] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const lock = useRef(false)
  const dirty = Boolean(form && JSON.stringify(form) !== baseline) || Boolean(ending)
  const ulps = units.filter((unit) => unit.type === 'ULP')
  const activeTemplates = templates.filter((template) => template.status === 'Aktif')
  const templateLabel = (template) => `${template.templateName} / ${types.find((type) => type.id === template.vehicleTypeId)?.name || '-'} / ${assignments.find((assignment) => assignment.id === template.assignmentId)?.name || '-'}`
  const ulpName = (id) => ulps.find((unit) => unit.uuid === id)?.displayName || 'ULP'

  useEffect(() => {
    if (!canManage) { setLoading(false); return undefined }
    let cancelled = false
    setLoading(true)
    setError('')
    listPrescribedVehicles({ contractId: contractUuid, up3Id: up3Uuid, month }).then((rows) => {
      if (!cancelled) setFleet(rows || [])
    }).catch((loadError) => { if (!cancelled) setError(loadError.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [contractUuid, up3Uuid, month, reload, canManage])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    onBusyChange?.(busy)
    return () => onBusyChange?.(false)
  }, [busy, onBusyChange])

  const canDiscard = () => !lock.current && (!dirty || window.confirm('Penetapan kendaraan belum disimpan. Lanjutkan?'))
  const openForm = () => {
    if (!canDiscard()) return
    const next = { ulpId: ulpFilter, templateId: '', count: '1', label: '', contractReference: '', month }
    setForm(next)
    setBaseline(JSON.stringify(next))
    setEnding(null)
    setError('')
    setMessage('')
  }
  const closeForm = () => { if (canDiscard()) { setForm(null); setEnding(null); setBaseline('') } }
  const save = async () => {
    if (!form || lock.current) return
    const count = parseConditionCount(form.count)
    if (!form.ulpId || !form.templateId || !form.month || count == null || Number.isNaN(count) || count < 1 || count > 50) {
      setError('Pilih ULP, template Aktif, bulan mulai, dan jumlah kendaraan 1 sampai 50.')
      return
    }
    if (!window.confirm(`Tetapkan ${count} kendaraan untuk ${ulpName(form.ulpId)}? Admin ULP akan melengkapi nopolnya.`)) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await createPrescribedVehicles({ contractId: contractUuid, up3Id: up3Uuid }, form)
      setMessage(`${count} kendaraan ditetapkan untuk ${ulpName(form.ulpId)} mulai ${conditionMonthLabel(form.month)}. ULP dapat melengkapi nopol dan mengisi kondisinya.`)
      setMonth(form.month)
      setForm(null)
      setBaseline('')
      setReload((value) => value + 1)
    } catch (saveError) { setError(saveError.message) }
    finally { lock.current = false; setBusy(false) }
  }
  const end = async () => {
    if (!ending?.month || lock.current) return
    if (`${ending.month}-01` <= ending.slot.effective_month) { setError('Bulan akhir harus sesudah bulan mulai.'); return }
    if (!window.confirm(`Akhiri penetapan ${ending.slot.label} mulai ${conditionMonthLabel(ending.month)}? Riwayat lama tetap disimpan.`)) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await endPrescribedVehicle(ending.slot, ending.month)
      setEnding(null)
      setMessage('Penetapan diakhiri. Kendaraan tidak diwajibkan sejak bulan akhir yang dipilih.')
      setReload((value) => value + 1)
    } catch (endError) { setError(endError.message) }
    finally { lock.current = false; setBusy(false) }
  }

  if (!canManage) return <p className="sla-flat-note">Daftar kendaraan dan penugasannya ditetapkan Admin UP3/Super Admin. Admin ULP hanya melengkapi nopol dan laporan kondisi.</p>
  return <fieldset className="uc-fields uc-admin" disabled={busy} aria-busy={busy}>
    <header className="uc-admin-header"><div><span className="uc-eyebrow">PENETAPAN OLEH UP3</span><h3>Kendaraan untuk Setiap ULP</h3><p>Gunakan template kendaraan yang sudah ada. Pilih ULP dan jumlah kendaraan; nopol diisi Admin ULP.</p></div><button type="button" className="sla-btn sla-btn-primary" onClick={openForm}>Tetapkan Kendaraan</button></header>
    {error && <p className="uc-alert uc-alert--error" role="alert">{error}<button type="button" className="sla-btn" onClick={() => { if (canDiscard()) { setForm(null); setEnding(null); setReload((value) => value + 1) } }}>Muat Ulang</button></p>}
    {message && <p className="uc-alert" role="status">{message}</p>}
    {form && <section className="uc-admin-form"><div className="uc-section-title"><h3>Penetapan Kendaraan Baru</h3><button type="button" className="sla-btn" onClick={closeForm}>Tutup</button></div><div className="uc-form-grid">
      <label className="uc-field">ULP Tujuan *<select value={form.ulpId} onChange={(event) => setForm((prev) => ({ ...prev, ulpId: event.target.value }))}><option value="">Pilih ULP</option>{ulps.map((unit) => <option key={unit.uuid} value={unit.uuid}>{unit.displayName || unit.legacyKey}</option>)}</select></label>
      <label className="uc-field">Template Kendaraan dan Penugasan *<select value={form.templateId} onChange={(event) => setForm((prev) => ({ ...prev, templateId: event.target.value }))}><option value="">Pilih template yang sudah diterbitkan</option>{activeTemplates.map((template) => <option key={template.id} value={template.id}>{templateLabel(template)}</option>)}</select></label>
      <label className="uc-field">Jumlah Kendaraan *<input inputMode="numeric" value={form.count} onChange={(event) => setForm((prev) => ({ ...prev, count: event.target.value }))} /></label>
      <label className="uc-field">Mulai Berlaku *<input type="month" value={form.month} onChange={(event) => setForm((prev) => ({ ...prev, month: event.target.value }))} /></label>
    </div><details className="uc-history"><summary>Informasi tambahan (opsional)</summary><div className="uc-form-grid"><label className="uc-field">Nama/Pembeda Kendaraan<input maxLength={190} value={form.label} onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))} placeholder="Otomatis mengikuti jenis dan penugasan" /></label><label className="uc-field">Acuan Kontrak/Addendum<input maxLength={500} value={form.contractReference} onChange={(event) => setForm((prev) => ({ ...prev, contractReference: event.target.value }))} /></label></div></details>
      {!activeTemplates.length && <p className="uc-alert">Belum ada template Aktif. Buat dan terbitkan melalui tab Template Kebutuhan terlebih dahulu.</p>}
      <p className="uc-footnote">Satu penetapan mewakili satu kendaraan. Alat mengikuti template yang sama, tetapi nopol dan kondisi setiap kendaraan dicatat terpisah.</p><div className="uc-savebar"><span>{dirty ? 'Ada perubahan belum disimpan' : 'Lengkapi penetapan kendaraan'}</span><button type="button" className="sla-btn sla-btn-primary" disabled={!activeTemplates.length} onClick={save}>Simpan Penetapan</button></div></section>}
    {ending && <section className="uc-admin-form"><h3>Akhiri: {ending.slot.label}</h3><label className="uc-field">Tidak Berlaku Mulai<input type="month" value={ending.month} onChange={(event) => setEnding((prev) => ({ ...prev, month: event.target.value }))} /></label><p>Gunakan penetapan baru jika kendaraan atau templatenya berubah. Data laporan lama tidak dihapus.</p><div className="uc-template-actions"><button type="button" className="sla-btn" onClick={closeForm}>Batal</button><button type="button" className="sla-btn sla-btn-primary" onClick={end}>Akhiri Penetapan</button></div></section>}
    <div className="uc-context"><label>Tampilkan Bulan<input type="month" value={month} onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value) }} /></label><label>ULP<select value={ulpFilter} onChange={(event) => setUlpFilter(event.target.value)}><option value="">Semua ULP</option>{ulps.map((unit) => <option key={unit.uuid} value={unit.uuid}>{unit.displayName || unit.legacyKey}</option>)}</select></label></div>
    {loading ? <p role="status">Memuat penetapan kendaraan...</p> : <div className="uc-scroll"><table className="uc-table"><thead><tr><th>Kendaraan / ULP</th><th>Jenis dan Penugasan</th><th>Template Alat</th><th>Nopol</th><th>Berlaku Mulai</th><th /></tr></thead><tbody>{fleet.filter((slot) => !ulpFilter || slot.ulp_id === ulpFilter).map((slot) => <tr key={slot.id}><td><strong>{slot.label}</strong><span className="uc-item-unit">{ulpName(slot.ulp_id)}</span></td><td>{slot.vehicle_type_name}<span className="uc-item-unit">{slot.assignment_name}</span></td><td>{slot.template_name}<span className="uc-item-unit">Versi {slot.template_version}</span></td><td>{slot.plate_display || <span className="uc-status uc-status--draft">Belum Diisi ULP</span>}</td><td>{conditionMonthLabel(slot.effective_month)}</td><td>{!slot.end_month && <button type="button" className="sla-btn" onClick={() => { if (canDiscard()) { setForm(null); setBaseline(''); setEnding({ slot, month: '' }); setError('') } }}>Akhiri</button>}</td></tr>)}{!fleet.some((slot) => !ulpFilter || slot.ulp_id === ulpFilter) && <tr><td colSpan={6}>Belum ada kendaraan yang ditetapkan untuk pilihan ini.</td></tr>}</tbody></table></div>}
    <p className="uc-footnote">Penetapan kendaraan dan pemeriksaan alat tidak mengubah indikator atau perhitungan SLA.</p>
  </fieldset>
}
