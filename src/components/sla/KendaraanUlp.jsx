import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const variant = candidate.vehicleVariant || 'Umum'
  return `${candidate.vehicleTypeName} — ${candidate.assignmentName} · ${variant} · v${candidate.versionNumber} · ${candidate.itemsCount} alat`
}

function variantKey(value) {
  return value ? `v:${value}` : 'v:'
}

function variantLabel(key) {
  return key === 'v:' ? 'Umum' : key.slice(2)
}

function statusBadgeClass(status) {
  return status === 'Aktif' ? 'sla-status-active' : 'sla-status-archive'
}

function vehicleSnapshot(form) {
  return JSON.stringify({
    id: form.id,
    ulpId: form.ulpId,
    plate: form.plate,
    brand: form.brand,
    notes: form.notes,
    templateId: form.templateId,
  })
}

function ItemsTable({ items, loading = false, error = '', onRetry }) {
  if (loading) return <p className="sla-table-hint" role="status">Memuat rincian kebutuhan...</p>
  if (error) return (
    <p className="sla-blocked-note" role="alert">
      {error}{' '}
      <button type="button" className="sla-btn" onClick={onRetry}>Coba lagi</button>
    </p>
  )
  if (!items.length) {
    return <p className="sla-table-hint">Tidak ada rincian kebutuhan.</p>
  }
  const groups = new Map()
  items.forEach((item, index) => {
    const key = item.categoryName || 'Tanpa Kategori'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ ...item, number: index + 1 })
  })
  return (
    <div className="sla-preview-scroll alkes-items-scroll">
      <table className="sla-preview-table alkes-table alkes-table--compact">
        <thead>
          <tr>
            <th>No.</th>
            <th>Peralatan</th>
            <th>Satuan</th>
            <th>Jumlah Kebutuhan</th>
            <th>Keterangan</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([category, rows]) => (
            <Fragment key={category}>
              <tr className="alkes-group-row">
                <td colSpan={5}>
                  {category}
                  <span className="alkes-group-count">{rows.length} jenis</span>
                </td>
              </tr>
              {rows.map((item) => (
                <tr key={item.equipmentId}>
                  <td>{item.number}</td>
                  <td>
                    {item.equipmentName || '—'}
                    <div className="sla-table-sub">{item.equipmentCode}</div>
                  </td>
                  <td>{item.equipmentUnit}</td>
                  <td>{item.requiredQty}</td>
                  <td>{item.note || '—'}</td>
                </tr>
              ))}
            </Fragment>
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
  onEditorStateChange,
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
  const mutationPending = useRef(false)
  const listRequest = useRef(0)
  const candidatesRequest = useRef(0)
  const detailRequest = useRef(0)

  const [form, setForm] = useState(null)
  const [baseline, setBaseline] = useState('')
  const [saveStatus, setSaveStatus] = useState('idle')
  const [formError, setFormError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [candidates, setCandidates] = useState([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidatesError, setCandidatesError] = useState('')
  const [preview, setPreview] = useState([])
  const [previewError, setPreviewError] = useState('')
  const [previewNonce, setPreviewNonce] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(false)
  const plateRef = useRef(null)
  const brandRef = useRef(null)
  const ulpRef = useRef(null)
  const templateRef = useRef(null)

  const [detail, setDetail] = useState(null)
  const [detailItems, setDetailItems] = useState([])
  const [detailItemsLoading, setDetailItemsLoading] = useState(false)
  const [detailItemsError, setDetailItemsError] = useState('')
  const [detailItemsNonce, setDetailItemsNonce] = useState(0)
  const [detailTab, setDetailTab] = useState('identitas')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [history, setHistory] = useState([])
  const [statusForm, setStatusForm] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [ulpForm, setUlpForm] = useState(null)
  const [ulpError, setUlpError] = useState('')

  const scopeReady = Boolean(contractUuid && up3Uuid)

  useEffect(() => () => {
    listRequest.current += 1
    candidatesRequest.current += 1
    detailRequest.current += 1
  }, [contractUuid, up3Uuid])

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      ulpId: canPickUlp ? prev.ulpId : (ownUlpUuid ?? ''),
    }))
    setPage(0)
  }, [ownUlpUuid, canPickUlp])

  const loadList = useCallback(async () => {
    const request = ++listRequest.current
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
      if (request !== listRequest.current) return
      const lastPage = Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1)
      if (page > lastPage) {
        setPage(lastPage)
        return
      }
      setData(result)
    } catch (loadError) {
      if (request === listRequest.current) setError(loadError.message || 'Daftar kendaraan gagal dimuat.')
    } finally {
      if (request === listRequest.current) setLoading(false)
    }
  }, [scopeReady, contractUuid, up3Uuid, filters.ulpId, filters.search, filters.status, page])

  useEffect(() => {
    loadList()
    return () => { listRequest.current += 1 }
  }, [loadList])

  const loadCandidates = async (vehicleId) => {
    const request = ++candidatesRequest.current
    setCandidatesLoading(true)
    setCandidates([])
    setCandidatesError('')
    try {
      const rows = vehicleId
        ? await listVehicleTemplateCandidates({ vehicleId })
        : await listVehicleTemplateCandidates({ contractId: contractUuid, up3Id: up3Uuid })
      if (request === candidatesRequest.current) setCandidates(rows)
    } catch (loadError) {
      if (request === candidatesRequest.current) setCandidatesError(loadError.message || 'Acuan template gagal dimuat.')
    } finally {
      if (request === candidatesRequest.current) setCandidatesLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setPreview([])
    setPreviewError('')
    setPreviewLoading(Boolean(form?.templateId))
    if (!form?.templateId) return undefined
    listTemplateItemsForVehicle(form.templateId)
      .then((items) => {
        if (!cancelled) setPreview(items)
      })
      .catch((loadError) => {
        if (!cancelled) setPreviewError(loadError.message || 'Rincian kebutuhan gagal dimuat.')
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [form?.templateId, previewNonce])

  useEffect(() => {
    let cancelled = false
    setDetailItems([])
    setDetailItemsError('')
    setDetailItemsLoading(Boolean(detail && detailTab === 'acuan' && detail.assignment?.templateId))
    if (!detail || detailTab !== 'acuan' || !detail.assignment?.templateId) return undefined
    listTemplateItemsForVehicle(detail.assignment.templateId)
      .then((items) => {
        if (!cancelled) setDetailItems(items)
      })
      .catch((loadError) => {
        if (!cancelled) setDetailItemsError(loadError.message || 'Rincian kebutuhan gagal dimuat.')
      })
      .finally(() => { if (!cancelled) setDetailItemsLoading(false) })
    return () => { cancelled = true }
  }, [detail, detailTab, detailItemsNonce])

  useEffect(() => {
    if (!form?.id || !form.templateId || form.vehicleTypeId || !candidates.length) return
    const candidate = candidates.find((item) => item.id === form.templateId)
    if (!candidate) return
    setForm((prev) => (prev ? {
      ...prev,
      vehicleTypeId: candidate.vehicleTypeId,
      assignmentId: candidate.assignmentId,
      variantFilter: variantKey(candidate.vehicleVariant),
    } : prev))
  }, [candidates, form?.id, form?.templateId, form?.vehicleTypeId])

  const filteredCandidates = useMemo(() => {
    if (!form) return []
    return candidates.filter((candidate) => {
      if (form.vehicleTypeId && candidate.vehicleTypeId !== form.vehicleTypeId) return false
      if (form.assignmentId && candidate.assignmentId !== form.assignmentId) return false
      if (form.variantFilter && variantKey(candidate.vehicleVariant) !== form.variantFilter) return false
      return true
    })
  }, [candidates, form?.vehicleTypeId, form?.assignmentId, form?.variantFilter])

  const typeOptions = useMemo(() => {
    const map = new Map()
    candidates.forEach((candidate) => {
      if (!map.has(candidate.vehicleTypeId)) map.set(candidate.vehicleTypeId, candidate.vehicleTypeName)
    })
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [candidates])

  const assignmentOptions = useMemo(() => {
    const map = new Map()
    candidates.forEach((candidate) => {
      if (form?.vehicleTypeId && candidate.vehicleTypeId !== form.vehicleTypeId) return
      if (!map.has(candidate.assignmentId)) map.set(candidate.assignmentId, candidate.assignmentName)
    })
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [candidates, form?.vehicleTypeId])

  const variantOptions = useMemo(() => {
    const map = new Map()
    candidates.forEach((candidate) => {
      if (form?.vehicleTypeId && candidate.vehicleTypeId !== form.vehicleTypeId) return
      if (form?.assignmentId && candidate.assignmentId !== form.assignmentId) return
      map.set(variantKey(candidate.vehicleVariant), candidate.vehicleVariant || 'Umum')
    })
    return [...map.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [candidates, form?.vehicleTypeId, form?.assignmentId])

  const selectedCandidate = candidates.find((candidate) => candidate.id === form?.templateId) ?? null
  const dirty = Boolean(form && baseline && vehicleSnapshot(form) !== baseline)
  const auxiliaryDirty = Boolean(statusForm?.reason.trim() || ulpForm?.reason.trim() || ulpForm?.newUlpId)

  useEffect(() => {
    onEditorStateChange?.({ dirty: dirty || auxiliaryDirty, busy })
    return () => onEditorStateChange?.({ dirty: false, busy: false })
  }, [dirty, auxiliaryDirty, busy, onEditorStateChange])
  const statusText = busy || saveStatus === 'saving'
    ? 'Menyimpan...'
    : dirty
      ? 'Ada perubahan belum disimpan'
      : saveStatus === 'saved'
        ? 'Tersimpan'
        : 'Belum ada perubahan'

  useEffect(() => {
    if (!dirty && !auxiliaryDirty && !busy) return undefined
    const handler = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, auxiliaryDirty, busy])

  const focusField = (key) => {
    const refs = { plate: plateRef, brand: brandRef, ulpId: ulpRef, templateId: templateRef }
    window.requestAnimationFrame(() => refs[key]?.current?.focus())
  }

  const clearFieldError = (key) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const updateVehicleField = (key, value) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
    clearFieldError(key)
    setFormError('')
  }

  const resetFormState = () => {
    candidatesRequest.current += 1
    setForm(null)
    setPreview([])
    setFormError('')
    setFieldErrors({})
    setBaseline('')
    setSaveStatus('idle')
  }

  const closeForm = () => {
    if (mutationPending.current) return
    if (dirty && !window.confirm('Perubahan kendaraan belum disimpan. Tutup form?')) return
    resetFormState()
  }

  const confirmDiscard = () => (!dirty && !auxiliaryDirty) || window.confirm('Perubahan kendaraan belum disimpan. Lanjutkan?')
  const confirmAuxiliaryDiscard = () => !auxiliaryDirty || window.confirm('Alasan/koreksi belum disimpan. Lanjutkan?')

  const openCreate = () => {
    if (!canManage || mutationPending.current || !confirmDiscard()) return
    setStatusForm(null)
    setUlpForm(null)
    setFormError('')
    setFieldErrors({})
    setCandidatesError('')
    setSaveStatus('idle')
    const next = {
      id: null,
      revision: null,
      ulpId: canPickUlp ? (filters.ulpId || '') : (ownUlpUuid ?? ''),
      plate: '',
      brand: '',
      notes: '',
      templateId: '',
      vehicleTypeId: '',
      assignmentId: '',
      variantFilter: '',
    }
    setForm(next)
    setBaseline(vehicleSnapshot(next))
    loadCandidates(null)
  }

  const openEdit = (row) => {
    if (!canManage || mutationPending.current || !confirmDiscard()) return
    setStatusForm(null)
    setUlpForm(null)
    setFormError('')
    setFieldErrors({})
    setCandidatesError('')
    setSaveStatus('idle')
    const next = {
      id: row.id,
      revision: row.revision,
      ulpId: row.ulpId,
      plate: row.plateDisplay ?? '',
      brand: row.brand ?? '',
      notes: row.notes ?? '',
      templateId: row.templateId ?? '',
      vehicleTypeId: '',
      assignmentId: '',
      variantFilter: '',
    }
    setForm(next)
    setBaseline(vehicleSnapshot(next))
    loadCandidates(row.id)
  }

  const submitForm = async () => {
    if (!form || mutationPending.current || candidatesLoading || candidatesError) return
    const plate = displayPlate(form.plate)
    const brand = String(form.brand ?? '').trim()
    const normalized = normalizePlate(plate)
    const nextErrors = {}
    if (!plate) nextErrors.plate = 'Nomor polisi wajib diisi.'
    else if (normalized.length < 2 || normalized.length > 12) nextErrors.plate = 'Nomor polisi tidak valid.'
    if (!brand) nextErrors.brand = 'Tipe/Merek wajib diisi.'
    if (!form.id && !form.ulpId) nextErrors.ulpId = 'ULP wajib dipilih.'
    if (!form.templateId) nextErrors.templateId = 'Pilih template kebutuhan.'
    else if (!candidatesLoading && !filteredCandidates.some((candidate) => candidate.id === form.templateId)) {
      nextErrors.templateId = 'Template tidak sesuai dengan jenis dan penugasan yang dipilih.'
    }
    setFieldErrors(nextErrors)
    setFormError('')
    if (Object.keys(nextErrors).length) {
      focusField(['ulpId', 'plate', 'brand', 'templateId'].find((key) => nextErrors[key]))
      return
    }

    mutationPending.current = true
    detailRequest.current += 1
    setDetailLoading(false)
    setBusy(true)
    setSaveStatus('saving')
    try {
      const saved = await saveOpsVehicle({
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
      const nextForm = {
        ...form,
        id: saved.vehicle.id,
        revision: saved.vehicle.revision,
        ulpId: saved.vehicle.ulpId,
        plate: saved.vehicle.plateDisplay,
        brand: saved.vehicle.brand,
        notes: saved.vehicle.notes ?? '',
        templateId: saved.vehicle.templateId ?? form.templateId,
      }
      setForm(nextForm)
      setBaseline(vehicleSnapshot(nextForm))
      setSaveStatus('saved')
      setDetail((prev) => prev?.vehicle.id === saved.vehicle.id ? { ...prev, vehicle: saved.vehicle, assignment: saved.assignment } : prev)
      setNotice(form.id ? 'Kendaraan diperbarui.' : 'Kendaraan terdaftar.')
      if (detail?.vehicle.id === saved.vehicle.id) await refreshDetail(saved.vehicle.id)
      await loadList()
      await loadCandidates(saved.vehicle.id)
    } catch (saveError) {
      setFormError(saveError.message || 'Kendaraan gagal disimpan.')
      setSaveStatus('dirty')
    } finally {
      mutationPending.current = false
      setBusy(false)
    }
  }

  const openDetail = async (row) => {
    if (mutationPending.current || !confirmAuxiliaryDiscard()) return
    const request = ++detailRequest.current
    setDetailLoading(true)
    setDetailError('')
    setStatusForm(null)
    setUlpForm(null)
    try {
      const [detailData, historyRows] = await Promise.all([
        getOpsVehicle(row.id),
        listOpsVehicleHistory({ vehicleId: row.id }),
      ])
      if (request !== detailRequest.current) return
      setDetail(detailData)
      setHistory(historyRows)
      setDetailTab('identitas')
    } catch (loadError) {
      if (request !== detailRequest.current) return
      setDetail(null)
      setDetailError(loadError.message || 'Detail kendaraan gagal dimuat.')
    } finally {
      if (request === detailRequest.current) setDetailLoading(false)
    }
  }

  const refreshDetail = async (vehicleId) => {
    const request = ++detailRequest.current
    setDetailError('')
    try {
      const [detailData, historyRows] = await Promise.all([
        getOpsVehicle(vehicleId),
        listOpsVehicleHistory({ vehicleId }),
      ])
      if (request !== detailRequest.current) return
      setDetail(detailData)
      setHistory(historyRows)
    } catch (loadError) {
      if (request === detailRequest.current) setDetailError(`Perubahan tersimpan, tetapi detail gagal dimuat ulang: ${loadError.message}`)
    }
  }

  const toggleAuxiliaryForm = (kind) => {
    if (mutationPending.current || form?.id === detail?.vehicle.id || !confirmAuxiliaryDiscard()) return
    setStatusError('')
    setUlpError('')
    setStatusForm(kind === 'status' && !statusForm ? { target: detail.vehicle.status === 'Aktif' ? 'Tidak Aktif' : 'Aktif', reason: '' } : null)
    setUlpForm(kind === 'ulp' && !ulpForm ? { newUlpId: '', reason: '' } : null)
  }

  const closeDetail = () => {
    if (mutationPending.current || !confirmAuxiliaryDiscard()) return
    detailRequest.current += 1
    setStatusForm(null)
    setUlpForm(null)
    setDetail(null)
  }

  const submitStatus = async () => {
    if (!detail || !statusForm || mutationPending.current || form?.id === detail.vehicle.id) return
    if (!statusForm.reason.trim()) {
      setStatusError('Alasan perubahan status wajib diisi.')
      return
    }
    mutationPending.current = true
    setBusy(true)
    setStatusError('')
    try {
      const saved = await setOpsVehicleStatus({
        vehicleId: detail.vehicle.id,
        status: statusForm.target,
        reason: statusForm.reason.trim(),
        expectedRevision: detail.vehicle.revision,
      })
      setNotice(statusForm.target === 'Aktif' ? 'Kendaraan diaktifkan kembali.' : 'Kendaraan dinonaktifkan.')
      setStatusForm(null)
      setDetail((prev) => prev ? { ...prev, vehicle: saved.vehicle, assignment: saved.assignment } : prev)
      await refreshDetail(detail.vehicle.id)
      await loadList()
    } catch (statusMutationError) {
      setStatusError(statusMutationError.message || 'Status kendaraan gagal diubah.')
    } finally {
      mutationPending.current = false
      setBusy(false)
    }
  }

  const submitUlpCorrection = async () => {
    if (!detail || !ulpForm || mutationPending.current || form?.id === detail.vehicle.id) return
    if (!ulpForm.newUlpId) {
      setUlpError('ULP tujuan wajib dipilih.')
      return
    }
    if (!ulpForm.reason.trim()) {
      setUlpError('Alasan koreksi ULP wajib diisi.')
      return
    }
    mutationPending.current = true
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
      mutationPending.current = false
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
  const hasListFilter = Boolean(filters.search || filters.status || (canPickUlp && filters.ulpId))
  const emptyListMessage = hasListFilter
    ? 'Tidak ada kendaraan yang cocok dengan pencarian/filter.'
    : 'Belum ada kendaraan terdaftar pada scope ini.'
  const contextLocked = Boolean(form?.id)
  const currentTypeName = selectedCandidate?.vehicleTypeName ?? 'Memuat...'
  const currentAssignmentName = selectedCandidate?.assignmentName ?? 'Memuat...'

  return (
    <fieldset className="alkes-section alkes-controls" disabled={busy} aria-busy={busy}>
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
        <div className="sla-sign-group ops-vehicle-form alkes-form-surface">
          <div className="alkes-form-heading">
            <div>
              <strong>{form.id ? 'Edit Kendaraan' : 'Registrasi Kendaraan'}</strong>
              <p className="sla-table-hint">Pilih konteks sekali, lalu periksa pratinjau kebutuhan sebelum menyimpan.</p>
            </div>
            {selectedCandidate && (
              <span className="alkes-meta-pill">{selectedCandidate.templateCode} · v{selectedCandidate.versionNumber}</span>
            )}
          </div>

          <div className="ops-vehicle-form-section">
            <div className="ops-vehicle-section-head">
              <strong>Identitas Kendaraan</strong>
              <span className="sla-table-hint">Nomor polisi dan tipe/merek wajib diisi.</span>
            </div>
            <div className="sla-sign-group-head">
              <div className="sla-context-field">
                <label htmlFor="vehicle-ulp" className="sla-context-label">{form.id ? 'ULP' : 'ULP *'}</label>
                {!form.id && canPickUlp ? (
                  <select id="vehicle-ulp" ref={ulpRef} className="sla-context-select" value={form.ulpId} disabled={busy} onChange={(event) => updateVehicleField('ulpId', event.target.value)} aria-invalid={Boolean(fieldErrors.ulpId)}>
                    <option value="">Pilih ULP</option>
                    {ulpOptions.map((unit) => (
                      <option key={unit.uuid} value={unit.uuid}>{unit.displayName ?? unit.legacyKey}</option>
                    ))}
                  </select>
                ) : (
                  <input id="vehicle-ulp" className="sla-input sla-input-text" value={unitLabel(form.ulpId)} disabled />
                )}
                {fieldErrors.ulpId && <p className="alkes-field-error">{fieldErrors.ulpId}</p>}
              </div>
              <div className="sla-context-field">
                <label htmlFor="vehicle-plate" className="sla-context-label">Nomor Polisi *</label>
                <input id="vehicle-plate" ref={plateRef} className="sla-input sla-input-text" value={form.plate} disabled={busy} onChange={(event) => updateVehicleField('plate', event.target.value)} placeholder="cth: B 3892 BDA" aria-invalid={Boolean(fieldErrors.plate)} />
                {fieldErrors.plate && <p className="alkes-field-error">{fieldErrors.plate}</p>}
              </div>
              <div className="sla-context-field">
                <label htmlFor="vehicle-brand" className="sla-context-label">Tipe/Merek *</label>
                <input id="vehicle-brand" ref={brandRef} className="sla-input sla-input-text" value={form.brand} disabled={busy} onChange={(event) => updateVehicleField('brand', event.target.value)} placeholder="cth: Type B Double Axle 2x4" aria-invalid={Boolean(fieldErrors.brand)} />
                {fieldErrors.brand && <p className="alkes-field-error">{fieldErrors.brand}</p>}
              </div>
            </div>
            <details className="alkes-advanced">
              <summary>Informasi tambahan</summary>
              <div className="sla-sign-group-head">
                <div className="sla-context-field ops-vehicle-wide">
                  <span className="sla-context-label">Catatan</span>
                  <input className="sla-input sla-input-text" value={form.notes} disabled={busy} onChange={(event) => updateVehicleField('notes', event.target.value)} />
                </div>
              </div>
            </details>
          </div>

          <div className="ops-vehicle-form-section">
            <div className="ops-vehicle-section-head">
              <strong>Acuan Kebutuhan</strong>
              <span className="sla-table-hint">Pilih jenis dan penugasan untuk mempersempit kandidat.</span>
            </div>
            <div className="sla-sign-group-head">
              <div className="sla-context-field">
                <label htmlFor="vehicle-type" className="sla-context-label">Jenis Kendaraan *</label>
                <select
                  id="vehicle-type"
                  className="sla-context-select"
                  value={form.vehicleTypeId}
                  disabled={busy || candidatesLoading || contextLocked}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, vehicleTypeId: event.target.value, assignmentId: '', variantFilter: '', templateId: '' }))
                    clearFieldError('templateId')
                    setFormError('')
                  }}
                >
                  {!contextLocked && <option value="">Pilih jenis</option>}
                  {contextLocked && form.vehicleTypeId && !typeOptions.some((item) => item.id === form.vehicleTypeId) && (
                    <option value={form.vehicleTypeId}>{currentTypeName}</option>
                  )}
                  {typeOptions.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
              <div className="sla-context-field">
                <label htmlFor="vehicle-assignment" className="sla-context-label">Penugasan *</label>
                <select
                  id="vehicle-assignment"
                  className="sla-context-select"
                  value={form.assignmentId}
                  disabled={busy || candidatesLoading || contextLocked}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, assignmentId: event.target.value, variantFilter: '', templateId: '' }))
                    clearFieldError('templateId')
                    setFormError('')
                  }}
                >
                  {!contextLocked && <option value="">Pilih penugasan</option>}
                  {contextLocked && form.assignmentId && !assignmentOptions.some((item) => item.id === form.assignmentId) && (
                    <option value={form.assignmentId}>{currentAssignmentName}</option>
                  )}
                  {assignmentOptions.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
              <div className="sla-context-field">
                <label htmlFor="vehicle-variant" className="sla-context-label">Varian/Model (opsional)</label>
                <select
                  id="vehicle-variant"
                  className="sla-context-select"
                  value={form.variantFilter}
                  disabled={busy || candidatesLoading}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, variantFilter: event.target.value, templateId: '' }))
                    clearFieldError('templateId')
                    setFormError('')
                  }}
                >
                  <option value="">Semua varian</option>
                  {variantOptions.map((item) => (
                    <option key={item.key} value={item.key}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="sla-context-field ops-vehicle-wide">
                <label htmlFor="vehicle-template" className="sla-context-label">Acuan Template Kebutuhan *</label>
                <select
                  id="vehicle-template"
                  ref={templateRef}
                  className="sla-context-select"
                  value={form.templateId}
                  disabled={busy || candidatesLoading || !filteredCandidates.length}
                  onChange={(event) => {
                    const candidate = candidates.find((item) => item.id === event.target.value)
                    setForm((prev) => ({
                      ...prev,
                      templateId: event.target.value,
                      ...(candidate ? {
                        vehicleTypeId: candidate.vehicleTypeId,
                        assignmentId: candidate.assignmentId,
                        variantFilter: variantKey(candidate.vehicleVariant),
                      } : {}),
                    }))
                    clearFieldError('templateId')
                    setFormError('')
                  }}
                  aria-invalid={Boolean(fieldErrors.templateId)}
                >
                  <option value="">{candidatesLoading ? 'Memuat acuan...' : 'Pilih acuan template'}</option>
                  {filteredCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidateLabel(candidate)}{candidate.templateLegacy ? ' · legacy' : ''}
                    </option>
                  ))}
                </select>
                {fieldErrors.templateId && <p className="alkes-field-error">{fieldErrors.templateId}</p>}
                {candidatesError && (
                  <p className="sla-blocked-note">
                    {candidatesError}{' '}
                    <button type="button" className="sla-btn" disabled={candidatesLoading} onClick={() => loadCandidates(form.id || null)}>
                      Coba lagi
                    </button>
                  </p>
                )}
                {!candidatesLoading && !candidatesError && !candidates.length && (
                  <p className="sla-blocked-note">Belum ada template Aktif yang dapat dipakai sebagai acuan.</p>
                )}
                {!candidatesLoading && !candidatesError && candidates.length > 0 && !filteredCandidates.length && (
                  <p className="sla-blocked-note">Tidak ada template sesuai pilihan. Ubah jenis, penugasan, atau varian.</p>
                )}
                {form.id && !candidatesError && candidates.length > 0 && (
                  <p className="sla-table-hint">Jenis dan penugasan dikunci agar acuan tetap pada kelompok yang sama.</p>
                )}
                {!form.id && filteredCandidates.length === 1 && (
                  <p className="sla-table-hint">Hanya satu template yang sesuai. Pilih template tersebut untuk melanjutkan.</p>
                )}
                {selectedCandidate?.templateLegacy && (
                  <p className="sla-table-hint">Acuan versi legacy: nama peralatan mengikuti katalog saat ini sampai versi baru diterbitkan.</p>
                )}
              </div>
            </div>

            {selectedCandidate && (
              <div className="ops-vehicle-selected-template">
                <div>
                  <strong>{selectedCandidate.templateName}</strong>
                  <div className="sla-table-sub">{selectedCandidate.templateCode} · v{selectedCandidate.versionNumber} · berlaku {formatDate(selectedCandidate.effectiveFrom)}</div>
                </div>
                <div className="ops-vehicle-selected-meta">
                  <span>{selectedCandidate.itemsCount} jenis alat</span>
                  {selectedCandidate.templateLegacy && <span className="sla-status-badge sla-status-draft">Legacy</span>}
                </div>
              </div>
            )}
          </div>

          <div className="ops-vehicle-preview">
            <div className="ops-vehicle-preview-head">
              <strong>Pratinjau Kebutuhan Peralatan</strong>
              <span className="sla-table-hint">{preview.length} jenis peralatan</span>
            </div>
            {!form.templateId ? (
              <p className="sla-table-hint">Pilih acuan template untuk melihat rincian kebutuhan.</p>
            ) : (
              <ItemsTable items={preview} loading={previewLoading} error={previewError} onRetry={() => setPreviewNonce((value) => value + 1)} />
            )}
          </div>

          {formError && <p className="sla-blocked-note">{formError}</p>}
          <div className="alkes-savebar">
            <span className={`alkes-save-status ${dirty ? 'is-dirty' : saveStatus === 'saved' ? 'is-saved' : ''}`}>{statusText}</span>
            <div className="alkes-save-actions">
              <button type="button" className="sla-btn sla-btn-primary" disabled={busy || candidatesLoading || saveStatus === 'saving'} onClick={submitForm}>
                {busy || saveStatus === 'saving' ? 'Menyimpan...' : form.id ? 'Simpan Perubahan' : 'Simpan Kendaraan'}
              </button>
              <button type="button" className="sla-btn" disabled={busy} onClick={closeForm}>Batal</button>
            </div>
          </div>
        </div>
      )}

      {detailError && <p className="sla-blocked-note" role="alert">{detailError}{' '}{detail && <button type="button" className="sla-btn" onClick={() => refreshDetail(detail.vehicle.id)}>Muat Ulang Detail</button>}</p>}

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
                <button type="button" className="sla-btn" disabled={busy || form?.id === detail.vehicle.id} onClick={() => toggleAuxiliaryForm('status')}>
                  {detail.vehicle.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
              )}
              {canManage && (
                <button type="button" className="sla-btn" disabled={busy || form?.id === detail.vehicle.id} onClick={() => toggleAuxiliaryForm('ulp')}>
                  Koreksi ULP
                </button>
              )}
              <button type="button" className="sla-btn" disabled={busy} onClick={closeDetail}>Tutup</button>
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
                  <ItemsTable items={detailItems} loading={detailItemsLoading} error={detailItemsError} onRetry={() => setDetailItemsNonce((value) => value + 1)} />
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
                  <tr><td colSpan={6}>{emptyListMessage}</td></tr>
                )}
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.plateDisplay}</strong>
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
    </fieldset>
  )
}
