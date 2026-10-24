import { useEffect, useRef, useState } from 'react'
import { conditionMonthLabel, currentConditionMonth, parseConditionCount } from '../../data/ulpConditionDomain.js'
import { createPrescribedVehicles, endPrescribedVehicle, listPrescribedVehicles } from '../../data/ulpConditionRepository.js'
import AlkesModal from './AlkesModal.jsx'
import SearchSelect from './SearchSelect.jsx'

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
  const [formError, setFormError] = useState('')
  const [endError, setEndError] = useState('')
  const [message, setMessage] = useState('')
  const [discardPrompt, setDiscardPrompt] = useState(false)
  const [reload, setReload] = useState(0)
  const lock = useRef(false)
  const discardRef = useRef(null)
  const dirty = Boolean(form && JSON.stringify(form) !== baseline) || Boolean(ending)
  const ulps = units.filter((unit) => unit.type === 'ULP')
  const activeTemplates = templates.filter((template) => template.status === 'Aktif')
  const ulpName = (id) => ulps.find((unit) => unit.uuid === id)?.displayName || 'ULP'
  const typeName = (id) => types.find((type) => type.id === id)?.name || '-'
  const assignmentName = (id) => assignments.find((assignment) => assignment.id === id)?.name || '-'
  const selectedTemplate = form?.templateId
    ? activeTemplates.find((template) => template.id === form.templateId) || null
    : null
  const ulpOptions = ulps.map((unit) => ({ value: unit.uuid, label: unit.displayName || unit.legacyKey }))
  const templateOptions = activeTemplates.map((template) => ({
    value: template.id,
    label: template.templateName,
    description: `${typeName(template.vehicleTypeId)} / ${assignmentName(template.assignmentId)} · Versi ${template.versionNumber}`,
  }))

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
  useEffect(() => {
    if (!discardPrompt) return
    window.requestAnimationFrame(() => {
      discardRef.current?.scrollIntoView({ block: 'nearest' })
      discardRef.current?.querySelector('button')?.focus()
    })
  }, [discardPrompt])

  const openForm = () => {
    if (lock.current) return
    const next = { ulpId: ulpFilter, templateId: '', count: '1', label: '', contractReference: '', month }
    setForm(next)
    setBaseline(JSON.stringify(next))
    setEnding(null)
    setError('')
    setFormError('')
    setEndError('')
    setMessage('')
    setDiscardPrompt(false)
  }
  const closeForm = (force = false) => {
    if (lock.current) return
    if (dirty && !force) {
      setDiscardPrompt(true)
      return
    }
    setForm(null)
    setBaseline('')
    setFormError('')
    setDiscardPrompt(false)
  }
  const openEnding = (slot) => {
    if (lock.current) return
    setForm(null)
    setBaseline('')
    setEnding({ slot, month: '' })
    setFormError('')
    setEndError('')
    setMessage('')
  }
  const closeEnding = () => {
    if (lock.current) return
    setEnding(null)
    setEndError('')
  }
  const save = async () => {
    if (!form || lock.current) return
    const count = parseConditionCount(form.count)
    if (!form.ulpId || !form.templateId || !form.month || count == null || Number.isNaN(count) || count < 1 || count > 50) {
      setFormError('Pilih ULP, template Aktif, bulan mulai, dan jumlah kendaraan 1 sampai 50.')
      return
    }
    lock.current = true
    setBusy(true)
    setFormError('')
    setDiscardPrompt(false)
    try {
      await createPrescribedVehicles({ contractId: contractUuid, up3Id: up3Uuid }, form)
      setMessage(`${count} kendaraan ditetapkan untuk ${ulpName(form.ulpId)} mulai ${conditionMonthLabel(form.month)}. Admin ULP dapat melengkapi nopol dan mengisi kondisinya.`)
      setMonth(form.month)
      setForm(null)
      setBaseline('')
      setReload((value) => value + 1)
    } catch (saveError) {
      setFormError(saveError.message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const end = async () => {
    if (!ending?.month || lock.current) return
    if (`${ending.month}-01` <= ending.slot.effective_month) {
      setEndError('Bulan akhir harus sesudah bulan mulai penetapan.')
      return
    }
    lock.current = true
    setBusy(true)
    setEndError('')
    try {
      await endPrescribedVehicle(ending.slot, ending.month)
      setEnding(null)
      setMessage('Penetapan diakhiri. Kendaraan tidak diwajibkan sejak bulan akhir yang dipilih.')
      setReload((value) => value + 1)
    } catch (endFailure) {
      setEndError(endFailure.message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  if (!canManage) return <p className="sla-flat-note">Daftar kendaraan dan penugasannya ditetapkan Admin UP3/Super Admin. Admin ULP hanya melengkapi nopol dan laporan kondisi.</p>

  return (
    <fieldset className="uc-fields uc-admin" disabled={busy} aria-busy={busy}>
      <header className="uc-admin-header">
        <div>
          <span className="uc-eyebrow">PENETAPAN OLEH UP3</span>
          <h3>Kendaraan untuk Setiap ULP</h3>
          <p>Gunakan template kendaraan yang sudah ada. Pilih ULP dan jumlah kendaraan; nopol diisi Admin ULP.</p>
        </div>
        <button type="button" className="sla-btn sla-btn-primary" onClick={openForm}>Tetapkan Kendaraan</button>
      </header>
      {error && (
        <p className="uc-alert uc-alert--error" role="alert">
          {error}
          <button type="button" className="sla-btn" onClick={() => setReload((value) => value + 1)}>Muat Ulang</button>
        </p>
      )}
      {message && <p className="uc-alert" role="status">{message}</p>}
      <div className="uc-context">
        <label>Tampilkan Bulan<input type="month" value={month} onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value) }} /></label>
        <label>ULP<select value={ulpFilter} onChange={(event) => setUlpFilter(event.target.value)}><option value="">Semua ULP</option>{ulps.map((unit) => <option key={unit.uuid} value={unit.uuid}>{unit.displayName || unit.legacyKey}</option>)}</select></label>
      </div>
      {loading ? <p role="status">Memuat penetapan kendaraan...</p> : (
        <div className="uc-scroll">
          <table className="uc-table">
            <thead><tr><th>Kendaraan / ULP</th><th>Jenis dan Penugasan</th><th>Template Alat</th><th>Nopol</th><th>Berlaku Mulai</th><th /></tr></thead>
            <tbody>
              {fleet.filter((slot) => !ulpFilter || slot.ulp_id === ulpFilter).map((slot) => (
                <tr key={slot.id}>
                  <td><strong>{slot.label}</strong><span className="uc-item-unit">{ulpName(slot.ulp_id)}</span></td>
                  <td>{slot.vehicle_type_name}<span className="uc-item-unit">{slot.assignment_name}</span></td>
                  <td>{slot.template_name}<span className="uc-item-unit">Versi {slot.template_version}</span></td>
                  <td>{slot.plate_display || <span className="uc-status uc-status--draft">Belum Diisi ULP</span>}</td>
                  <td>{conditionMonthLabel(slot.effective_month)}</td>
                  <td>{!slot.end_month && <button type="button" className="sla-btn" onClick={() => openEnding(slot)}>Akhiri</button>}</td>
                </tr>
              ))}
              {!fleet.some((slot) => !ulpFilter || slot.ulp_id === ulpFilter) && <tr><td colSpan={6}>Belum ada kendaraan yang ditetapkan untuk pilihan ini.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="uc-footnote">Penetapan kendaraan dan pemeriksaan alat tidak mengubah indikator atau perhitungan SLA.</p>

      {form && (
        <AlkesModal
          open
          onClose={() => closeForm()}
          eyebrow="PENETAPAN KENDARAAN"
          title="Tetapkan Kendaraan ke ULP"
          subtitle="Tentukan ULP, template, dan masa berlaku. Nopol dilengkapi Admin ULP."
          size="medium"
          dismissDisabled={busy}
          footer={(
            <div className="uc-modal-footer">
              <span>{busy ? 'Menyimpan...' : dirty ? 'Ada perubahan belum disimpan' : 'Lengkapi data penetapan'}</span>
              <div className="alkes-modal-actions">
                <button type="button" className="sla-btn" disabled={busy} onClick={() => closeForm()}>Batal</button>
                <button type="button" className="sla-btn sla-btn-primary" disabled={busy || !activeTemplates.length || !form.ulpId || !form.templateId} onClick={save}>
                  {busy ? 'Menyimpan...' : 'Simpan Penetapan'}
                </button>
              </div>
            </div>
          )}
        >
          <div className="alkes-modal-form">
            {formError && <p className="alkes-modal-alert" role="alert">{formError}</p>}
            <section className="alkes-modal-section">
              <div className="alkes-modal-section-head">
                <div>
                  <h3>Unit dan Acuan</h3>
                  <p>Pilih ULP tujuan dan template kendaraan yang sudah diterbitkan.</p>
                </div>
              </div>
              <div className="uc-form-grid uc-form-grid--single">
                <div className="uc-field">
                  <span>ULP Tujuan *</span>
                  <SearchSelect
                    options={ulpOptions}
                    value={form.ulpId}
                    onChange={(value) => setForm((prev) => ({ ...prev, ulpId: value }))}
                    placeholder="Pilih ULP"
                    searchPlaceholder="Cari ULP..."
                    emptyText="ULP tidak ditemukan."
                    disabled={busy}
                    ariaLabel="ULP Tujuan"
                    autoFocusTrigger
                  />
                </div>
                <div className="uc-field">
                  <span>Template Kendaraan *</span>
                  <SearchSelect
                    options={templateOptions}
                    value={form.templateId}
                    onChange={(value) => setForm((prev) => ({ ...prev, templateId: value }))}
                    placeholder="Pilih template"
                    searchPlaceholder="Cari template, jenis, atau penugasan..."
                    emptyText="Template Aktif tidak ditemukan."
                    disabled={busy || !activeTemplates.length}
                    ariaLabel="Template Kendaraan"
                  />
                </div>
              </div>
              {!activeTemplates.length && <p className="uc-alert">Belum ada template Aktif. Buat dan terbitkan melalui tab Template Kebutuhan terlebih dahulu.</p>}
            </section>

            <section className="alkes-modal-section">
              <div className="alkes-modal-section-head">
                <div>
                  <h3>Rincian Template</h3>
                  <p>Jenis dan penugasan otomatis mengikuti template terpilih.</p>
                </div>
              </div>
              {selectedTemplate ? (
                <div className="uc-assignment-summary-grid">
                  <div><span>Jenis Kendaraan</span><strong>{typeName(selectedTemplate.vehicleTypeId)}</strong></div>
                  <div><span>Penugasan</span><strong>{assignmentName(selectedTemplate.assignmentId)}</strong></div>
                  <div><span>Varian / Model</span><strong>{selectedTemplate.vehicleVariant || 'Umum'}</strong></div>
                  <div><span>Versi Template</span><strong>Versi {selectedTemplate.versionNumber}</strong></div>
                </div>
              ) : (
                <p className="uc-assignment-empty">Pilih template untuk melihat jenis kendaraan dan penugasannya.</p>
              )}
            </section>

            <section className="alkes-modal-section">
              <div className="alkes-modal-section-head">
                <div>
                  <h3>Jumlah dan Masa Berlaku</h3>
                  <p>Satu penetapan mewakili satu kendaraan. Nopol dan kondisi dicatat terpisah per kendaraan.</p>
                </div>
              </div>
              <div className="uc-form-grid">
                <label className="uc-field">Jumlah Kendaraan *
                  <input inputMode="numeric" value={form.count} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, count: event.target.value }))} placeholder="1 - 50" />
                </label>
                <label className="uc-field">Mulai Berlaku *
                  <input type="month" value={form.month} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, month: event.target.value }))} />
                </label>
              </div>
              <p className="uc-assignment-note">
                {form.ulpId ? ulpName(form.ulpId) : 'ULP belum dipilih'} · {form.count || '0'} kendaraan · mulai {form.month ? conditionMonthLabel(form.month) : 'belum dipilih'}
              </p>
              <details className="alkes-advanced">
                <summary>Informasi tambahan (opsional)</summary>
                <div className="uc-form-grid">
                  <label className="uc-field">Nama / Pembeda Kendaraan
                    <input maxLength={190} value={form.label} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))} placeholder="Otomatis mengikuti jenis dan penugasan" />
                  </label>
                  <label className="uc-field">Acuan Kontrak / Addendum
                    <input maxLength={500} value={form.contractReference} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, contractReference: event.target.value }))} placeholder="Nomor dokumen acuan, jika diperlukan" />
                  </label>
                </div>
              </details>
            </section>

            {discardPrompt && (
              <div ref={discardRef} className="alkes-modal-discard" role="alert">
                <div>
                  <strong>Penetapan belum disimpan</strong>
                  <span>Perubahan terbaru akan hilang jika modal ditutup sekarang.</span>
                </div>
                <div className="alkes-modal-actions">
                  <button type="button" className="sla-btn" disabled={busy} onClick={() => setDiscardPrompt(false)}>Tetap Mengedit</button>
                  <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={() => closeForm(true)}>Tutup Tanpa Menyimpan</button>
                </div>
              </div>
            )}
          </div>
        </AlkesModal>
      )}

      {ending && (
        <AlkesModal
          open
          onClose={closeEnding}
          eyebrow="AKHIRI PENETAPAN"
          title="Akhiri Penetapan Kendaraan"
          subtitle="Kendaraan tidak lagi diwajibkan sejak bulan akhir yang dipilih. Riwayat lama tetap tersimpan."
          size="medium"
          dismissDisabled={busy}
          footer={(
            <div className="uc-modal-footer">
              <span>{busy ? 'Menyimpan...' : 'Penetapan akan diakhiri'}</span>
              <div className="alkes-modal-actions">
                <button type="button" className="sla-btn" disabled={busy} onClick={closeEnding}>Batal</button>
                <button type="button" className="sla-btn sla-btn-primary" disabled={busy || !ending.month} onClick={end}>
                  {busy ? 'Menyimpan...' : 'Akhiri Penetapan'}
                </button>
              </div>
            </div>
          )}
        >
          <div className="alkes-modal-form">
            {endError && <p className="alkes-modal-alert" role="alert">{endError}</p>}
            <section className="alkes-modal-section">
              <div className="alkes-modal-section-head">
                <div>
                  <h3>Kendaraan yang Diakhiri</h3>
                  <p>Periksa kembali kendaraan dan masa berlakunya.</p>
                </div>
              </div>
              <div className="uc-assignment-summary-grid">
                <div><span>Kendaraan</span><strong>{ending.slot.label}</strong></div>
                <div><span>ULP</span><strong>{ulpName(ending.slot.ulp_id)}</strong></div>
                <div><span>Jenis Kendaraan</span><strong>{ending.slot.vehicle_type_name || '-'}</strong></div>
                <div><span>Template</span><strong>{ending.slot.template_name || '-'}</strong></div>
                <div><span>Berlaku Mulai</span><strong>{conditionMonthLabel(ending.slot.effective_month)}</strong></div>
              </div>
            </section>
            <section className="alkes-modal-section">
              <label className="uc-field">Tidak Berlaku Mulai *
                <input data-autofocus type="month" value={ending.month} disabled={busy} onChange={(event) => setEnding((prev) => ({ ...prev, month: event.target.value }))} />
              </label>
              <p className="uc-footnote">Gunakan penetapan baru jika kendaraan atau templatenya berubah.</p>
            </section>
          </div>
        </AlkesModal>
      )}
    </fieldset>
  )
}
