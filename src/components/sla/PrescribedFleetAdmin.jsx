import { useEffect, useMemo, useRef, useState } from 'react'
import { conditionMonthLabel, currentConditionMonth, parseConditionCount } from '../../data/ulpConditionDomain.js'
import { createPrescribedVehiclesBatch, endPrescribedVehicle, listAffectedVehicleReports, listPrescribedVehicles } from '../../data/ulpConditionRepository.js'
import { fetchLocationsFromSupabase } from '../../data/locationRepository.js'
import { currentLocationNameOf } from '../../data/lokasiPelayananTeknik.js'
import AlkesModal from './AlkesModal.jsx'
import SearchSelect from './SearchSelect.jsx'

const REPORT_STATUS_LABEL = {
  draft: 'Belum Lengkap',
  compliant: 'Memenuhi',
  non_compliant: 'Tidak Memenuhi',
}

function newRow() {
  return { key: `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`, templateId: '', locationId: '', count: '1' }
}

function locationLabel(name, type) {
  return type === 'KANTOR_JAGA' ? `KJ ${name}` : name
}

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
  const [affectedReports, setAffectedReports] = useState([])
  const [affectedLoading, setAffectedLoading] = useState(false)
  const [affectedError, setAffectedError] = useState('')
  const [affectedRetry, setAffectedRetry] = useState(0)
  const [locations, setLocations] = useState([])
  const [locationsLoading, setLocationsLoading] = useState(true)
  const [locationsError, setLocationsError] = useState('')
  const [reload, setReload] = useState(0)
  const lock = useRef(false)
  const discardRef = useRef(null)
  const dirty = Boolean(form && JSON.stringify(form) !== baseline) || Boolean(ending)
  const ulps = units.filter((unit) => unit.type === 'ULP')
  const activeTemplates = templates.filter((template) => template.status === 'Aktif')
  const ulpName = (id) => ulps.find((unit) => unit.uuid === id)?.displayName || 'ULP'
  const typeName = (id) => types.find((type) => type.id === id)?.name || '-'
  const assignmentName = (id) => assignments.find((assignment) => assignment.id === id)?.name || '-'
  const ulpOptions = ulps.map((unit) => ({ value: unit.uuid, label: unit.displayName || unit.legacyKey }))
  const templateOptions = activeTemplates.map((template) => ({
    value: template.id,
    label: template.templateName,
    description: `${typeName(template.vehicleTypeId)} / ${assignmentName(template.assignmentId)} · Versi ${template.versionNumber}`,
  }))
  const selectedTemplate = (templateId) => activeTemplates.find((template) => template.id === templateId) || null
  const selectedLocation = (locationId) => locations.find((location) => location.id === locationId) || null
  const slotLocation = (slot) => slot.location_id
    ? locationLabel(slot.location_name || 'Kantor', slot.location_type)
    : 'Belum ditetapkan'
  const locationOptions = useMemo(() => {
    if (!form?.ulpId) return []
    return locations
      .filter((location) => location.contractId === contractUuid && location.up3Id === up3Uuid
        && location.unitId === form.ulpId && location.ownStatus === 'Aktif'
        && (location.type === 'UNIT_OFFICE' || location.type === 'KANTOR_JAGA'))
      .map((location) => {
        const name = currentLocationNameOf(location)
        return {
          value: location.id,
          label: locationLabel(name, location.type),
          description: location.type === 'KANTOR_JAGA' ? 'Kantor Jaga' : 'Kantor ULP',
          type: location.type,
          sortOrder: location.sortOrder ?? 0,
        }
      })
      .sort((a, b) => (a.type === 'UNIT_OFFICE' ? 0 : 1) - (b.type === 'UNIT_OFFICE' ? 0 : 1)
        || a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
  }, [locations, form?.ulpId, contractUuid, up3Uuid])
  const totalVehicles = (form?.rows || []).reduce((total, row) => {
    const count = parseConditionCount(row.count)
    return total + (count != null && !Number.isNaN(count) ? count : 0)
  }, 0)

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

  useEffect(() => {
    if (!canManage) {
      setLocationsLoading(false)
      return undefined
    }
    let cancelled = false
    setLocationsLoading(true)
    setLocationsError('')
    fetchLocationsFromSupabase().then((rows) => {
      if (!cancelled) setLocations(rows || [])
    }).catch((loadError) => {
      if (!cancelled) {
        setLocations([])
        setLocationsError(loadError.message || 'Daftar kantor gagal dimuat.')
      }
    }).finally(() => {
      if (!cancelled) setLocationsLoading(false)
    })
    return () => { cancelled = true }
  }, [canManage])

  useEffect(() => {
    if (!canManage || !form?.ulpId || !form?.month) {
      setAffectedReports([])
      setAffectedError('')
      setAffectedLoading(false)
      return undefined
    }
    let cancelled = false
    setAffectedLoading(true)
    setAffectedError('')
    listAffectedVehicleReports({ contractId: contractUuid, up3Id: up3Uuid, ulpId: form.ulpId, month: form.month })
      .then((rows) => { if (!cancelled) setAffectedReports(rows || []) })
      .catch((loadError) => {
        if (!cancelled) {
          setAffectedReports([])
          setAffectedError(loadError.message)
        }
      })
      .finally(() => { if (!cancelled) setAffectedLoading(false) })
    return () => { cancelled = true }
  }, [contractUuid, up3Uuid, canManage, form?.ulpId, form?.month, affectedRetry])

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
    const next = { ulpId: ulpFilter, month, contractReference: '', rows: [newRow()] }
    setForm(next)
    setBaseline(JSON.stringify(next))
    setEnding(null)
    setError('')
    setFormError('')
    setEndError('')
    setMessage('')
    setDiscardPrompt(false)
    setAffectedReports([])
    setAffectedError('')
    setAffectedLoading(Boolean(next.ulpId && next.month))
  }
  const changeFormContext = (patch) => {
    const changesUlp = Object.prototype.hasOwnProperty.call(patch, 'ulpId')
    setForm((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        ...patch,
        ...(changesUlp ? { rows: prev.rows.map((row) => ({ ...row, locationId: '' })) } : {}),
      }
    })
    setAffectedReports([])
    setAffectedError('')
    setAffectedLoading(Boolean((patch.ulpId ?? form?.ulpId) && (patch.month ?? form?.month)))
    setFormError('')
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
  const updateRow = (key, patch) => {
    setForm((prev) => ({ ...prev, rows: prev.rows.map((row) => row.key === key ? { ...row, ...patch } : row) }))
    setFormError('')
  }
  const addRow = () => {
    setForm((prev) => ({ ...prev, rows: [...prev.rows, newRow()] }))
    setFormError('')
  }
  const removeRow = (key) => {
    setForm((prev) => ({ ...prev, rows: prev.rows.filter((row) => row.key !== key) }))
    setFormError('')
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
    if (!form.ulpId || !form.month) {
      setFormError('Pilih ULP tujuan dan bulan mulai berlaku.')
      return
    }
    if (!form.rows.length) {
      setFormError('Tambahkan minimal satu baris kendaraan.')
      return
    }
    const invalidRow = form.rows.find((row) => {
      const count = parseConditionCount(row.count)
      return !row.templateId || !row.locationId || count == null || Number.isNaN(count) || count < 1 || count > 50
    })
    if (invalidRow) {
      setFormError('Setiap baris harus memiliki template, lokasi tujuan, dan jumlah kendaraan 1 sampai 50.')
      return
    }
    const combinations = form.rows.map((row) => `${row.templateId}|${row.locationId}`)
    if (new Set(combinations).size !== combinations.length) {
      setFormError('Template yang sama boleh dipakai di lokasi berbeda, tetapi kombinasi template dan lokasi tidak boleh duplikat.')
      return
    }
    if (locationsError) {
      setFormError('Daftar lokasi belum berhasil dimuat. Muat ulang halaman sebelum menyimpan.')
      return
    }
    if (totalVehicles > 200) {
      setFormError('Total kendaraan dalam satu penetapan maksimal 200.')
      return
    }
    if (affectedLoading) {
      setFormError('Tunggu pemeriksaan laporan tersimpan selesai.')
      return
    }
    if (affectedError) {
      setFormError('Dampak laporan belum dapat diperiksa. Gunakan Periksa Lagi sebelum menyimpan.')
      return
    }
    lock.current = true
    setBusy(true)
    setFormError('')
    setDiscardPrompt(false)
    try {
      const result = await createPrescribedVehiclesBatch({ contractId: contractUuid, up3Id: up3Uuid }, form)
      const revised = result.reports_revised
        ? ` ${result.reports_revised} laporan tersimpan direvisi; kendaraan baru menunggu nopol dan isian kondisi Admin ULP.`
        : ''
      setMessage(`${result.vehicles_created} kendaraan ditetapkan untuk ${ulpName(form.ulpId)} mulai ${conditionMonthLabel(form.month)}.${revised}`)
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
          <p>Gunakan template kendaraan yang sudah ada. Satu ULP dapat memiliki beberapa kendaraan; nopol diisi Admin ULP.</p>
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
          <table className="uc-table uc-table--fleet">
            <thead><tr><th>Kendaraan / ULP</th><th>Lokasi Tujuan</th><th>Jenis dan Penugasan</th><th>Template Alat</th><th>Nopol</th><th>Berlaku Mulai</th><th /></tr></thead>
            <tbody>
              {fleet.filter((slot) => !ulpFilter || slot.ulp_id === ulpFilter).map((slot) => (
                <tr key={slot.id}>
                  <td><strong>{slot.label}</strong><span className="uc-item-unit">{ulpName(slot.ulp_id)}</span></td>
                  <td>{slot.location_id ? <strong>{slotLocation(slot)}</strong> : <span className="uc-status uc-status--draft">Belum ditetapkan</span>}</td>
                  <td>{slot.vehicle_type_name}<span className="uc-item-unit">{slot.assignment_name}</span></td>
                  <td>{slot.template_name}<span className="uc-item-unit">Versi {slot.template_version}</span></td>
                  <td>{slot.plate_display || <span className="uc-status uc-status--draft">Belum Diisi ULP</span>}</td>
                  <td>{conditionMonthLabel(slot.effective_month)}</td>
                  <td>{!slot.end_month && <button type="button" className="sla-btn" onClick={() => openEnding(slot)}>Akhiri</button>}</td>
                </tr>
              ))}
              {!fleet.some((slot) => !ulpFilter || slot.ulp_id === ulpFilter) && <tr><td colSpan={7}>Belum ada kendaraan yang ditetapkan untuk pilihan ini.</td></tr>}
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
          subtitle="Pilih template dan lokasi tujuan untuk setiap kendaraan. Lokasi mengikuti kantor ULP dan kantor jaga aktif."
          size="wide"
          dismissDisabled={busy}
          footer={(
            <div className="uc-modal-footer">
              <span>{busy ? 'Menyimpan...' : !totalVehicles ? 'Lengkapi daftar kendaraan' : dirty ? `${totalVehicles} kendaraan · ada perubahan belum disimpan` : `${totalVehicles} kendaraan siap ditetapkan`}</span>
              <div className="alkes-modal-actions">
                <button type="button" className="sla-btn" disabled={busy} onClick={() => closeForm()}>Batal</button>
                <button
                  type="button"
                  className="sla-btn sla-btn-primary"
                  disabled={busy || affectedLoading || Boolean(affectedError) || locationsLoading || Boolean(locationsError) || !form.rows.length}
                  onClick={save}
                >
                  {busy ? 'Menyimpan...' : affectedReports.length ? 'Simpan & Revisi Laporan' : 'Simpan Penetapan'}
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
                  <h3>ULP dan Masa Berlaku</h3>
                  <p>Pilih ULP dan bulan mulai satu kali untuk seluruh kendaraan di bawah.</p>
                </div>
              </div>
              <div className="uc-form-grid">
                <div className="uc-field">
                  <span>ULP Tujuan *</span>
                  <SearchSelect
                    options={ulpOptions}
                    value={form.ulpId}
                    onChange={(value) => changeFormContext({ ulpId: value })}
                    placeholder="Pilih ULP"
                    searchPlaceholder="Cari ULP..."
                    emptyText="ULP tidak ditemukan."
                    disabled={busy}
                    ariaLabel="ULP Tujuan"
                    autoFocusTrigger
                  />
                </div>
                <label className="uc-field">Mulai Berlaku *
                  <input type="month" value={form.month} disabled={busy} onChange={(event) => changeFormContext({ month: event.target.value })} />
                </label>
              </div>
            </section>

            <section className="alkes-modal-section">
              <div className="alkes-modal-section-head">
                <div>
                  <h3>Daftar Kendaraan</h3>
                  <p>Setiap baris menentukan template, kantor tujuan, dan jumlah kendaraan.</p>
                </div>
                <span className="sla-table-hint">{form.rows.length} baris · {totalVehicles} kendaraan</span>
              </div>
              {!activeTemplates.length && <p className="uc-alert">Belum ada template Aktif. Buat dan terbitkan melalui tab Template Kebutuhan terlebih dahulu.</p>}
              {locationsLoading && <p className="uc-assignment-empty" role="status">Memuat daftar kantor ULP...</p>}
              {locationsError && <p className="uc-alert uc-alert--error" role="alert">{locationsError}</p>}
              {!locationsLoading && !locationsError && form.ulpId && !locationOptions.length && (
                <p className="uc-alert">Belum ada kantor aktif untuk ULP ini. Lengkapi Master Lokasi terlebih dahulu.</p>
              )}
              <div className="uc-assignment-rows">
                {form.rows.map((row, index) => {
                  const template = selectedTemplate(row.templateId)
                  const location = selectedLocation(row.locationId)
                  return (
                    <div key={row.key} className="uc-assignment-row">
                      <div className="uc-assignment-row-head">
                        <span>Kendaraan {index + 1}</span>
                        <button type="button" className="sla-btn" disabled={busy || form.rows.length === 1} onClick={() => removeRow(row.key)}>Hapus</button>
                      </div>
                      <div className="uc-assignment-row-grid">
                        <div className="uc-field">
                          <span>Template Kendaraan *</span>
                          <SearchSelect
                            options={templateOptions}
                            value={row.templateId}
                            onChange={(value) => updateRow(row.key, { templateId: value })}
                            placeholder="Pilih template"
                            searchPlaceholder="Cari template, jenis, atau penugasan..."
                            emptyText="Template Aktif tidak ditemukan."
                            disabled={busy || !activeTemplates.length}
                            ariaLabel={`Template Kendaraan ${index + 1}`}
                          />
                        </div>
                        <div className="uc-field">
                          <span>Lokasi Tujuan *</span>
                          <SearchSelect
                            options={locationOptions}
                            value={row.locationId}
                            onChange={(value) => updateRow(row.key, { locationId: value })}
                            placeholder={form.ulpId ? 'Pilih kantor tujuan' : 'Pilih ULP dahulu'}
                            searchPlaceholder="Cari kantor ULP atau kantor jaga..."
                            emptyText="Belum ada kantor aktif untuk ULP ini."
                            disabled={busy || !form.ulpId || locationsLoading || !locationOptions.length}
                            ariaLabel={`Lokasi Tujuan ${index + 1}`}
                          />
                        </div>
                        <label className="uc-field">Jumlah *
                          <input inputMode="numeric" value={row.count} disabled={busy} onChange={(event) => updateRow(row.key, { count: event.target.value })} placeholder="1 - 50" />
                        </label>
                      </div>
                      {(template || location) && (
                        <div className="uc-assignment-row-summary">
                          {template && <><span>{typeName(template.vehicleTypeId)}</span><span>{assignmentName(template.assignmentId)}</span><span>{template.vehicleVariant || 'Umum'}</span><span>Versi {template.versionNumber}</span></>}
                          {location && <span>{location.label}</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <button type="button" className="sla-btn uc-add-row" disabled={busy || !activeTemplates.length} onClick={addRow}>+ Tambah Baris Kendaraan</button>
              <div className="uc-assignment-total"><span>Total kendaraan</span><strong>{totalVehicles}</strong></div>
            </section>

            <section className="alkes-modal-section">
              <div className="alkes-modal-section-head">
                <div>
                  <h3>Dampak pada Laporan</h3>
                  <p>Laporan tersimpan tidak akan kehilangan isian kondisi yang sudah ada.</p>
                </div>
              </div>
              {!form.ulpId || !form.month ? (
                <p className="uc-assignment-empty">Pilih ULP dan bulan mulai untuk memeriksa laporan tersimpan.</p>
              ) : affectedLoading ? (
                <p className="uc-assignment-empty" role="status">Memeriksa laporan tersimpan...</p>
              ) : affectedError ? (
                <div className="uc-alert uc-alert--error" role="alert">
                  {affectedError}
                  <button type="button" className="sla-btn" disabled={busy} onClick={() => setAffectedRetry((value) => value + 1)}>Periksa Lagi</button>
                </div>
              ) : affectedReports.length ? (
                <div className="uc-report-impact">
                  <strong>{affectedReports.length} laporan tersimpan akan direvisi</strong>
                  <ul>
                    {affectedReports.map((report) => (
                      <li key={report.period_month}>
                        {conditionMonthLabel(report.period_month)}
                        <span>{REPORT_STATUS_LABEL[report.status] || report.status}</span>
                      </li>
                    ))}
                  </ul>
                  <p>Kondisi kendaraan lama tetap utuh. Kendaraan baru masuk tanpa nopol dan kondisi, lalu laporan kembali berstatus Belum Lengkap untuk dilengkapi Admin ULP.</p>
                </div>
              ) : (
                <div className="uc-report-impact is-clear">
                  <strong>Belum ada laporan tersimpan</strong>
                  <p>Penetapan ini akan menjadi daftar kendaraan awal untuk periode tersebut.</p>
                </div>
              )}
            </section>

            <section className="alkes-modal-section">
              <details className="alkes-advanced">
                <summary>Informasi tambahan (opsional)</summary>
                <label className="uc-field">Acuan Kontrak / Addendum
                  <input maxLength={500} value={form.contractReference} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, contractReference: event.target.value }))} placeholder="Nomor dokumen acuan, jika diperlukan" />
                </label>
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
                <div><span>Lokasi Tujuan</span><strong>{slotLocation(ending.slot)}</strong></div>
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
