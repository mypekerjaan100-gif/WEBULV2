import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  correctOpsVehicleUlp,
  displayPlate,
  getOpsVehicle,
  listOpsVehicleHistory,
  listOpsVehicles,
  listTemplateItemsForVehicle,
  listVehicleTemplateCandidates,
  normalizePlate,
  saveOpsVehicle,
  setOpsVehicleStatus,
} from '../../data/opsVehicleRepository.js'

const PAGE_SIZE = 25

const ACTION_LABEL = {
  CREATED: 'Registrasi kendaraan',
  UPDATED: 'Perubahan identitas',
  ASSIGNED: 'Penetapan acuan',
  STATUS_CHANGED: 'Perubahan status',
  CORRECTED_ULP: 'Koreksi ULP',
}

const ROLE_LABEL = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN_UP3: 'Admin UP3',
  ADMIN_ULP: 'Admin ULP',
  USER: 'Pengguna',
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function candidateLabel(candidate) {
  const variant = candidate.vehicleVariant ? ` (${candidate.vehicleVariant})` : ''
  return `${candidate.vehicleTypeName} — ${candidate.assignmentName}${variant} · v${candidate.versionNumber}`
}

function statusBadgeClass(status) {
  return status === 'Aktif' ? 'sla-status-active' : 'sla-status-archive'
}

function ItemsTable({ items }) {
  if (!items.length) {
    return <p className="sla-table-hint">Tidak ada rincian kebutuhan.</p>
  }
  return (
    <div className="sla-preview-scroll">
      <table className="sla-preview-table alkes-table">
        <thead>
          <tr>
            <th>Kategori</th>
            <th>Peralatan</th>
            <th>Satuan</th>
            <th>Jumlah Kebutuhan</th>
            <th>Keterangan</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.equipmentId}>
              <td>{item.categoryName || '—'}</td>
              <td>
                {item.equipmentName || '—'}
                <div className="sla-table-sub">{item.equipmentCode}</div>
              </td>
              <td>{item.equipmentUnit}</td>
              <td>{item.requiredQty}</td>
              <td>{item.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function KendaraanUlp({
  contractUuid,
  up3Uuid,
  ownUlpUuid = null,
  canManage = false,
  canPickUlp = false,
  units = [],
}) {
  const ulpOptions = useMemo(
    () => units
      .filter((unit) => unit.type === 'ULP')
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.legacyKey).localeCompare(String(b.legacyKey))),
    [units],
  )
  const unitLabel = useCallback(
    (uuid) => {
      const unit = units.find((entry) => entry.uuid === uuid)
      return unit?.displayName ?? unit?.legacyKey ?? '—'
    },
    [units],
  )

  const [filters, setFilters] = useState({
    ulpId: canPickUlp ? '' : (ownUlpUuid ?? ''),
    status: '',
    search: '',
  })
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState({ total: 0, rows: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState(null)
  const [formError, setFormError] = useState('')
  const [candidates, setCandidates] = useState([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidatesError, setCandidatesError] = useState('')
  const [preview, setPreview] = useState([])
  const [previewError, setPreviewError] = useState('')

  const [detail, setDetail] = useState(null)
  const [detailItems, setDetailItems] = useState([])
  const [detailTab, setDetailTab] = useState('identitas')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [history, setHistory] = useState([])
  const [statusForm, setStatusForm] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [ulpForm, setUlpForm] = useState(null)
  const [ulpError, setUlpError] = useState('')

  const scopeReady = Boolean(contractUuid && up3Uuid)

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      ulpId: canPickUlp ? prev.ulpId : (ownUlpUuid ?? ''),
    }))
    setPage(0)
  }, [ownUlpUuid, canPickUlp])

  const loadList = useCallback(async () => {
    if (!scopeReady) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await listOpsVehicles({
        contractId: contractUuid,
        up3Id: up3Uuid,
        ulpId: filters.ulpId || null,
        search: filters.search,
        status: filters.status,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      setData(result)
    } catch (loadError) {
      setError(loadError.message || 'Daftar kendaraan gagal dimuat.')
    } finally {
      setLoading(false)
    }
  }, [scopeReady, contractUuid, up3Uuid, filters.ulpId, filters.search, filters.status, page])

  useEffect(() => {
    loadList()
  }, [loadList])

  const loadCandidates = async (vehicleId) => {
    setCandidatesLoading(true)
    setCandidates([])
    setCandidatesError('')
    try {
      const rows = vehicleId
        ? await listVehicleTemplateCandidates({ vehicleId })
        : await listVehicleTemplateCandidates({ contractId: contractUuid, up3Id: up3Uuid })
      setCandidates(rows)
    } catch (loadError) {
      setCandidatesError(loadError.message || 'Acuan template gagal dimuat.')
    } finally {
      setCandidatesLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setPreview([])
    setPreviewError('')
    if (!form?.templateId) return undefined
    listTemplateItemsForVehicle(form.templateId)
      .then((items) => {
        if (!cancelled) setPreview(items)
      })
      .catch((loadError) => {
        if (!cancelled) setPreviewError(loadError.message || 'Rincian kebutuhan gagal dimuat.')
      })
    return () => { cancelled = true }
  }, [form?.templateId])

  useEffect(() => {
    let cancelled = false
    setDetailItems([])
    if (!detail || detailTab !== 'acuan' || !detail.assignment?.templateId) return undefined
    listTemplateItemsForVehicle(detail.assignment.templateId)
      .then((items) => {
        if (!cancelled) setDetailItems(items)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [detail, detailTab])

  const openCreate = () => {
    if (!canManage) return
    setFormError('')
    setCandidatesError('')
    setForm({
      id: null,
      revision: null,
      ulpId: canPickUlp ? (filters.ulpId || '') : (ownUlpUuid ?? ''),
      plate: '',
      brand: '',
      notes: '',
      templateId: '',
    })
    loadCandidates(null)
  }

  const openEdit = (row) => {
    if (!canManage) return
    setFormError('')
    setCandidatesError('')
    setForm({
      id: row.id,
      revision: row.revision,
      ulpId: row.ulpId,
      plate: row.plateDisplay ?? '',
      brand: row.brand ?? '',
      notes: row.notes ?? '',
      templateId: row.templateId ?? '',
    })
    loadCandidates(row.id)
  }

  const closeForm = () => {
    setForm(null)
    setPreview([])
    setFormError('')
  }

  const submitForm = async () => {
    if (!form) return
    const plate = displayPlate(form.plate)
    const brand = String(form.brand ?? '').trim()
    const normalized = normalizePlate(plate)
    if (!plate) { setFormError('Nomor polisi wajib diisi.'); return }
    if (normalized.length < 2) { setFormError('Nomor polisi tidak valid.'); return }
    if (!brand) { setFormError('Tipe/Merek kendaraan wajib diisi.'); return }
    if (!form.templateId) { setFormError('Acuan template wajib dipilih.'); return }
    if (!form.id && !form.ulpId) { setFormError('ULP kendaraan wajib dipilih.'); return }

    setBusy(true)
    setFormError('')
    try {
      await saveOpsVehicle({
        id: form.id,
        contractId: contractUuid,
        up3Id: up3Uuid,
        ulpId: form.ulpId,
        expectedRevision: form.id ? form.revision : null,
        plate,
        brand,
        notes: form.notes,
        templateId: form.templateId,
      })
      setNotice(form.id ? 'Kendaraan diperbarui.' : 'Kendaraan terdaftar.')
      closeForm()
      await loadList()
    } catch (saveError) {
      setFormError(saveError.message || 'Kendaraan gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  const openDetail = async (row) => {
    setDetailLoading(true)
    setDetailError('')
    setStatusForm(null)
    setUlpForm(null)
    try {
      const [detailData, historyRows] = await Promise.all([
        getOpsVehicle(row.id),
        listOpsVehicleHistory({ vehicleId: row.id }),
      ])
      setDetail(detailData)
      setHistory(historyRows)
      setDetailTab('identitas')
    } catch (loadError) {
      setDetail(null)
      setDetailError(loadError.message || 'Detail kendaraan gagal dimuat.')
    } finally {
      setDetailLoading(false)
    }
  }

  const refreshDetail = async (vehicleId) => {
    const [detailData, historyRows] = await Promise.all([
      getOpsVehicle(vehicleId),
      listOpsVehicleHistory({ vehicleId }),
    ])
    setDetail(detailData)
    setHistory(historyRows)
  }

  const submitStatus = async () => {
    if (!detail || !statusForm) return
    if (!statusForm.reason.trim()) {
      setStatusError('Alasan perubahan status wajib diisi.')
      return
    }
    setBusy(true)
    setStatusError('')
    try {
      await setOpsVehicleStatus({
        vehicleId: detail.vehicle.id,
        status: statusForm.target,
        reason: statusForm.reason.trim(),
        expectedRevision: detail.vehicle.revision,
      })
      setNotice(statusForm.target === 'Aktif' ? 'Kendaraan diaktifkan kembali.' : 'Kendaraan dinonaktifkan.')
      setStatusForm(null)
      await refreshDetail(detail.vehicle.id)
      await loadList()
    } catch (statusMutationError) {
      setStatusError(statusMutationError.message || 'Status kendaraan gagal diubah.')
    } finally {
      setBusy(false)
    }
  }

  const submitUlpCorrection = async () => {
    if (!detail || !ulpForm) return
    if (!ulpForm.newUlpId) {
      setUlpError('ULP tujuan wajib dipilih.')
      return
    }
    if (!ulpForm.reason.trim()) {
      setUlpError('Alasan koreksi ULP wajib diisi.')
      return
    }
    setBusy(true)
    setUlpError('')
    try {
      await correctOpsVehicleUlp({
        vehicleId: detail.vehicle.id,
        newUlpId: ulpForm.newUlpId,
        reason: ulpForm.reason.trim(),
        expectedRevision: detail.vehicle.revision,
      })
      setNotice('ULP kendaraan dikoreksi.')
      setUlpForm(null)
      setDetail(null)
      await loadList()
    } catch (ulpMutationError) {
      setUlpError(ulpMutationError.message || 'Koreksi ULP gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  if (!scopeReady) {
    return (
      <div className="alkes-section">
        <h2 className="sla-settings-title">Kendaraan ULP</h2>
        <p className="sla-blocked-note">Scope organisasi belum siap. Muat ulang halaman.</p>
      </div>
    )
  }

  const pageStart = data.total === 0 ? 0 : page * PAGE_SIZE + 1
  const pageEnd = Math.min(data.total, page * PAGE_SIZE + data.rows.length)
  const canGoPrev = page > 0
  const canGoNext = (page + 1) * PAGE_SIZE < data.total
  const selectedCandidate = candidates.find((candidate) => candidate.id === form?.templateId) ?? null

  return (
    <div className="alkes-section">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Kendaraan ULP</h2>
        <div className="alkes-toolbar-actions">
          {(canPickUlp || ownUlpUuid) && (
            <select
              className="sla-context-select alkes-filter"
              value={filters.ulpId}
              onChange={(event) => { setFilters((prev) => ({ ...prev, ulpId: event.target.value })); setPage(0) }}
              disabled={!canPickUlp}
            >
              {canPickUlp && <option value="">Semua ULP</option>}
              {ulpOptions
                .filter((unit) => canPickUlp || unit.uuid === ownUlpUuid)
                .map((unit) => (
                  <option key={unit.uuid} value={unit.uuid}>{unit.displayName ?? unit.legacyKey}</option>
                ))}
            </select>
          )}
          <select
            className="sla-context-select alkes-filter"
            value={filters.status}
            onChange={(event) => { setFilters((prev) => ({ ...prev, status: event.target.value })); setPage(0) }}
          >
            <option value="">Semua status</option>
            <option value="Aktif">Aktif</option>
            <option value="Tidak Aktif">Tidak Aktif</option>
          </select>
          <input
            className="sla-input sla-input-text alkes-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setFilters((prev) => ({ ...prev, search: searchInput.trim() }))
                setPage(0)
              }
            }}
            placeholder="Cari nomor polisi / tipe"
          />
          <button
            type="button"
            className="sla-btn"
            onClick={() => { setFilters((prev) => ({ ...prev, search: searchInput.trim() })); setPage(0) }}
          >
            Cari
          </button>
          {canManage && (
            <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={() => (form ? closeForm() : openCreate())}>
              {form ? 'Tutup Form' : 'Tambah Kendaraan'}
            </button>
          )}
        </div>
      </div>

      <p className="sla-flat-note">
        Registrasi kendaraan operasional per ULP dengan acuan template kebutuhan terbitan.
        {!canManage && ' Akun ini hanya dapat melihat data kendaraan.'}
      </p>

      {notice && <p className="sla-export-note">{notice}</p>}

      {form && canManage && (
        <div className="sla-sign-group ops-vehicle-form">
          <div className="sla-sign-group-head">
            <div className="sla-context-field">
              <span className="sla-context-label">Nomor Polisi *</span>
              <input
                className="sla-input sla-input-text"
                value={form.plate}
                disabled={busy}
                onChange={(event) => setForm((prev) => ({ ...prev, plate: event.target.value }))}
                placeholder="cth: B 3892 BDA"
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Tipe/Merek *</span>
              <input
                className="sla-input sla-input-text"
                value={form.brand}
                disabled={busy}
                onChange={(event) => setForm((prev) => ({ ...prev, brand: event.target.value }))}
                placeholder="cth: Type B Double Axle 2x4"
              />
            </div>
            {!form.id && canPickUlp && (
              <div className="sla-context-field">
                <span className="sla-context-label">ULP *</span>
                <select
                  className="sla-context-select"
                  value={form.ulpId}
                  disabled={busy}
                  onChange={(event) => setForm((prev) => ({ ...prev, ulpId: event.target.value }))}
                >
                  <option value="">Pilih ULP</option>
                  {ulpOptions.map((unit) => (
                    <option key={unit.uuid} value={unit.uuid}>{unit.displayName ?? unit.legacyKey}</option>
                  ))}
                </select>
              </div>
            )}
            {form.id && (
              <div className="sla-context-field">
                <span className="sla-context-label">ULP</span>
                <input className="sla-input sla-input-text" value={unitLabel(form.ulpId)} disabled />
              </div>
            )}
            <div className="sla-context-field ops-vehicle-wide">
              <span className="sla-context-label">Catatan</span>
              <input
                className="sla-input sla-input-text"
                value={form.notes}
                disabled={busy}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </div>
          </div>

          <div className="sla-context-field ops-vehicle-wide">
            <span className="sla-context-label">Acuan Template Kebutuhan *</span>
            <select
              className="sla-context-select"
              value={form.templateId}
              disabled={busy || candidatesLoading}
              onChange={(event) => setForm((prev) => ({ ...prev, templateId: event.target.value }))}
            >
              <option value="">{candidatesLoading ? 'Memuat acuan...' : 'Pilih acuan template'}</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidateLabel(candidate)}{candidate.templateLegacy ? ' · legacy' : ''}
                </option>
              ))}
            </select>
            {candidatesError && <p className="sla-blocked-note">{candidatesError}</p>}
            {!candidatesLoading && !candidatesError && !candidates.length && (
              <p className="sla-blocked-note">Belum ada template Aktif yang dapat dipakai sebagai acuan.</p>
            )}
            {form.id && !candidatesError && candidates.length > 0 && (
              <p className="sla-table-hint">Kendaraan dengan acuan hanya dapat berpindah pada jenis kendaraan dan penugasan yang sama.</p>
            )}
            {selectedCandidate?.templateLegacy && (
              <p className="sla-table-hint">Acuan versi legacy: nama peralatan mengikuti katalog saat ini sampai versi baru diterbitkan.</p>
            )}
          </div>

          <div className="sla-detail-tabs" style={{ margin: '12px 0 8px' }}>
            <strong>Pratinjau Kebutuhan Peralatan</strong>
            <span className="sla-table-hint">{preview.length} jenis peralatan</span>
          </div>
          {previewError && <p className="sla-blocked-note">{previewError}</p>}
          {!form.templateId ? (
            <p className="sla-table-hint">Pilih acuan template untuk melihat rincian kebutuhan.</p>
          ) : (
            <ItemsTable items={preview} />
          )}

          <div className="sla-master-actions ops-vehicle-form-actions">
            <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={submitForm}>
              {busy ? 'Menyimpan...' : form.id ? 'Simpan Perubahan' : 'Daftarkan Kendaraan'}
            </button>
            <button type="button" className="sla-btn" disabled={busy} onClick={closeForm}>Batal</button>
          </div>
          {formError && <p className="sla-blocked-note">{formError}</p>}
        </div>
      )}

      {detailError && <p className="sla-blocked-note">{detailError}</p>}

      {detailLoading ? (
        <p className="sla-table-hint">Memuat detail kendaraan...</p>
      ) : detail ? (
        <div className="sla-sign-group ops-vehicle-detail">
          <div className="sla-settings-toolbar">
            <h3 className="sla-settings-title">{detail.vehicle.plateDisplay}</h3>
            <div className="sla-master-actions">
              {canManage && detail.vehicle.status === 'Aktif' && (
                <button type="button" className="sla-btn" disabled={busy} onClick={() => openEdit({ ...detail.vehicle, templateId: detail.assignment?.templateId ?? '' })}>
                  Edit Kendaraan
                </button>
              )}
              {canManage && (
                <button type="button" className="sla-btn" disabled={busy} onClick={() => { setStatusError(''); setStatusForm(statusForm ? null : { target: detail.vehicle.status === 'Aktif' ? 'Tidak Aktif' : 'Aktif', reason: '' }) }}>
                  {detail.vehicle.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
              )}
              {canManage && (
                <button type="button" className="sla-btn" disabled={busy} onClick={() => { setUlpError(''); setUlpForm(ulpForm ? null : { newUlpId: '', reason: '' }) }}>
                  Koreksi ULP
                </button>
              )}
              <button type="button" className="sla-btn" disabled={busy} onClick={() => setDetail(null)}>Tutup</button>
            </div>
          </div>

          <div className="sla-detail-tabs">
            {[['identitas', 'Identitas'], ['acuan', 'Acuan'], ['riwayat', 'Riwayat']].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`sla-detail-tab ${detailTab === id ? 'sla-detail-tab-active' : ''}`}
                onClick={() => setDetailTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {detailTab === 'identitas' && (
            <div className="ops-vehicle-grid">
              <div><span className="sla-context-label">Nomor Polisi</span><strong>{detail.vehicle.plateDisplay}</strong></div>
              <div><span className="sla-context-label">Normalisasi</span><strong>{detail.vehicle.plateNormalized}</strong></div>
              <div><span className="sla-context-label">Tipe/Merek</span><strong>{detail.vehicle.brand}</strong></div>
              <div><span className="sla-context-label">ULP</span><strong>{unitLabel(detail.vehicle.ulpId)}</strong></div>
              <div>
                <span className="sla-context-label">Status</span>
                <span className={`sla-status-badge ${statusBadgeClass(detail.vehicle.status)}`}>{detail.vehicle.status}</span>
              </div>
              <div><span className="sla-context-label">Diperbarui</span><strong>{formatDateTime(detail.vehicle.updatedAt)}</strong></div>
              <div className="ops-vehicle-wide"><span className="sla-context-label">Catatan</span><strong>{detail.vehicle.notes || '—'}</strong></div>
              {detail.vehicle.status === 'Tidak Aktif' && (
                <div className="ops-vehicle-wide">
                  <span className="sla-context-label">Alasan nonaktif</span>
                  <strong>{detail.vehicle.inactiveReason || '—'}</strong>
                </div>
              )}
            </div>
          )}

          {detailTab === 'acuan' && (
            <div>
              {detail.assignment ? (
                <>
                  <div className="ops-vehicle-grid">
                    <div><span className="sla-context-label">Jenis Kendaraan</span><strong>{detail.assignment.vehicleTypeName || '—'}</strong></div>
                    <div><span className="sla-context-label">Penugasan</span><strong>{detail.assignment.assignmentName || '—'}</strong></div>
                    <div><span className="sla-context-label">Varian/Model</span><strong>{detail.assignment.vehicleVariant || 'Umum'}</strong></div>
                    <div><span className="sla-context-label">Template</span><strong>{detail.assignment.templateCode} · {detail.assignment.templateName}</strong></div>
                    <div><span className="sla-context-label">Berlaku Mulai</span><strong>{formatDate(detail.assignment.effectiveFrom)}</strong></div>
                    <div><span className="sla-context-label">Status Metadata</span><strong>{detail.assignment.templateLegacy ? 'Legacy (mengikuti katalog)' : 'Terbit terkunci'}</strong></div>
                  </div>
                  <ItemsTable items={detailItems} />
                </>
              ) : (
                <p className="sla-blocked-note">Kendaraan tidak memiliki acuan aktif.</p>
              )}
            </div>
          )}

          {detailTab === 'riwayat' && (
            <div>
              {!history.length ? (
                <p className="sla-table-hint">Belum ada riwayat.</p>
              ) : (
                <div className="sla-preview-scroll">
                  <table className="sla-preview-table alkes-table">
                    <thead>
                      <tr>
                        <th>Waktu</th>
                        <th>Tindakan</th>
                        <th>Oleh</th>
                        <th>Keterangan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((entry) => (
                        <tr key={entry.id}>
                          <td>{formatDateTime(entry.createdAt)}</td>
                          <td>{ACTION_LABEL[entry.action] ?? entry.action}</td>
                          <td>{ROLE_LABEL[entry.actorRole] ?? (entry.actorRole || '—')}</td>
                          <td>
                            {entry.detail?.reason
                              ? entry.detail.reason
                              : entry.detail?.mode
                                ? `Mode: ${entry.detail.mode}`
                                : entry.action === 'CREATED'
                                  ? `Acuan ${entry.detail?.template_code ?? '—'}`
                                  : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {statusForm && (
            <div className="sla-sign-group ops-vehicle-inline-form">
              <div className="sla-context-field ops-vehicle-wide">
                <span className="sla-context-label">Alasan {statusForm.target === 'Aktif' ? 'mengaktifkan' : 'menonaktifkan'} kendaraan *</span>
                <input
                  className="sla-input sla-input-text"
                  value={statusForm.reason}
                  disabled={busy}
                  onChange={(event) => setStatusForm((prev) => ({ ...prev, reason: event.target.value }))}
                />
              </div>
              {statusError && <p className="sla-blocked-note">{statusError}</p>}
              <div className="sla-master-actions">
                <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={submitStatus}>
                  {busy ? 'Menyimpan...' : `Simpan Status ${statusForm.target}`}
                </button>
              </div>
            </div>
          )}

          {ulpForm && (
            <div className="sla-sign-group ops-vehicle-inline-form">
              <div className="sla-context-field">
                <span className="sla-context-label">ULP Tujuan *</span>
                <select
                  className="sla-context-select"
                  value={ulpForm.newUlpId}
                  disabled={busy}
                  onChange={(event) => setUlpForm((prev) => ({ ...prev, newUlpId: event.target.value }))}
                >
                  <option value="">Pilih ULP</option>
                  {ulpOptions.filter((unit) => unit.uuid !== detail.vehicle.ulpId).map((unit) => (
                    <option key={unit.uuid} value={unit.uuid}>{unit.displayName ?? unit.legacyKey}</option>
                  ))}
                </select>
              </div>
              <div className="sla-context-field ops-vehicle-wide">
                <span className="sla-context-label">Alasan koreksi *</span>
                <input
                  className="sla-input sla-input-text"
                  value={ulpForm.reason}
                  disabled={busy}
                  onChange={(event) => setUlpForm((prev) => ({ ...prev, reason: event.target.value }))}
                />
              </div>
              {ulpError && <p className="sla-blocked-note">{ulpError}</p>}
              <div className="sla-master-actions">
                <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={submitUlpCorrection}>
                  {busy ? 'Menyimpan...' : 'Simpan Koreksi ULP'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {loading ? (
        <p className="sla-table-hint">Memuat kendaraan...</p>
      ) : error ? (
        <p className="sla-blocked-note">{error} <button type="button" className="sla-btn" onClick={loadList}>Coba lagi</button></p>
      ) : (
        <>
          <div className="sla-preview-scroll">
            <table className="sla-preview-table alkes-table alkes-table--wide">
              <thead>
                <tr>
                  <th>Nomor Polisi</th>
                  <th>Tipe/Merek</th>
                  <th>ULP</th>
                  <th>Acuan</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {!data.rows.length && (
                  <tr><td colSpan={6}>Belum ada kendaraan terdaftar pada scope ini.</td></tr>
                )}
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.plateDisplay}</strong>
                      <div className="sla-table-sub">{row.plateNormalized}</div>
                    </td>
                    <td>{row.brand}</td>
                    <td>{unitLabel(row.ulpId)}</td>
                    <td>
                      {row.templateId ? (
                        <>
                          {row.vehicleTypeName || '—'} — {row.assignmentName || '—'}
                          <div className="sla-table-sub">
                            {row.templateCode}{row.templateLegacy ? ' · legacy' : ''} · mulai {formatDate(row.effectiveFrom)}
                          </div>
                        </>
                      ) : '—'}
                    </td>
                    <td>
                      <span className={`sla-status-badge ${statusBadgeClass(row.status)}`}>{row.status}</span>
                    </td>
                    <td>
                      <div className="sla-master-actions">
                        <button type="button" className="sla-btn" disabled={detailLoading} onClick={() => openDetail(row)}>Lihat</button>
                        {canManage && row.status === 'Aktif' && (
                          <button type="button" className="sla-btn" disabled={busy} onClick={() => openEdit(row)}>Edit</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sla-settings-toolbar ops-vehicle-pagination">
            <span className="sla-table-hint">Menampilkan {pageStart}–{pageEnd} dari {data.total} kendaraan</span>
            <div className="sla-master-actions">
              <button type="button" className="sla-btn" disabled={!canGoPrev || loading} onClick={() => setPage((prev) => Math.max(0, prev - 1))}>
                Sebelumnya
              </button>
              <button type="button" className="sla-btn" disabled={!canGoNext || loading} onClick={() => setPage((prev) => prev + 1)}>
                Berikutnya
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
