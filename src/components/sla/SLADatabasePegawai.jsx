import { useState, useMemo, useEffect, useRef } from 'react'
import {
  currentNameOf,
  ulpIdsOfUp3,
} from '../../data/organisasiPelayananTeknik.js'
import { jabatanOfScope } from '../../data/jabatanPelayananTeknik.js'
import {
  DEFAULT_POSITION_ID,
  applyProposedChange,
  buildNewEmployee,
  hourlyRateFor,
  today,
} from '../../data/pegawaiPelayananTeknik.js'
import {
  activePensionPolicy,
  ageAt,
  changePensionPolicy,
  effectiveEmploymentStatusOf,
  effectiveStatusHistoryOf,
  lastWorkingDateFor,
  monthsBetween,
  pensionStateOf,
  retirementAgeDateFor,
  retirementEffectiveDateFor,
} from '../../data/pensiunPelayananTeknik.js'
import { currentLocationNameOf } from '../../data/lokasiPelayananTeknik.js'
import { downloadExportFile } from '../../utils/slaExportFile.js'
import ModernDatePicker from './ModernDatePicker.jsx'
import {
  approveEmployeeChange,
  downloadImportTemplate,
  importEmployeesBulk,
  normalizeImportRow,
  parseImportFile,
  rejectEmployeeChange,
  resolvePositionUuid,
  setPensionPolicy,
  submitAddWithSnapshot,
  submitEditWithSnapshot,
  toRpcProposed,
} from '../../data/employeeMutationRepository.js'

const inputClass = 'sla-input sla-input-text'
const PAGE_SIZE = 20
const STATUS_REASONS = ['Pensiun', 'Resign', 'PHK', 'Lainnya']
const BANKS = ['BRI', 'BNI', 'MANDIRI', 'BSI']
const TABS = ['utama', 'pembayaran', 'riwayat', 'approval']
const TAB_LABEL = {
  utama: 'Data Utama',
  pembayaran: 'Data Pembayaran',
  riwayat: 'Riwayat',
  approval: 'Approval',
}
const PENSION_BADGE = {
  Normal: 'sla-status-active',
  'Mendekati Pensiun': 'sla-status-warning',
  Peringatan: 'sla-status-danger',
  'Segera Pensiun': 'sla-status-danger',
  Pensiun: 'sla-status-archive',
}

const emptyForm = (defaultUnitId, up3Id) => ({
  nip: '',
  name: '',
  up3Id,
  unitId: defaultUnitId,
  workLocationId: '',
  positionId: DEFAULT_POSITION_ID,
  bank: BANKS[0],
  accountNumber: '',
  hourlyRate: '',
  birthDate: '',
  retirementDateOverride: '',
  pensionOverrideReason: '',
  employmentStatus: 'Aktif',
  statusReason: '',
  statusReasonNote: '',
  statusEffectiveDate: '',
  photoAssetId: '',
  existingPhotoId: '',
  hasExistingPhoto: false,
})

function photoInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

const formatPeriod = (from, to) =>
  `${from ?? 'sejak awal'} \u2014 ${to == null ? 'sekarang' : to}`

const csvEscape = (value) => {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export default function SLADatabasePegawai({
  contractScope,
  up3Id,
  units,
  employees,
  onEmployeesChange,
  changeRequests,
  onChangeRequestsChange,
  jabatan,
  role,
  unitId,
  pensionPolicies,
  onPensionPoliciesChange,
  locations,
  orgMap,
  onRefreshEmployees,
  onRefreshChangeRequests,
  onRefreshPensionPolicies,
}) {
  const [search, setSearch] = useState('')
  const [filterJabatan, setFilterJabatan] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterApproval, setFilterApproval] = useState('')
  const [filterUnit, setFilterUnit] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterPension, setFilterPension] = useState('')
  const [pensionForm, setPensionForm] = useState({
    retirementAge: '',
    periodStart: today(),
    keterangan: '',
  })
  const [pensionOpen, setPensionOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [tab, setTab] = useState('utama')
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState(() =>
    emptyForm(
      role === 'ulp'
        ? unitId
        : ulpIdsOfUp3(units, up3Id)[0] ?? up3Id ?? '',
      up3Id,
    ),
  )
  const [formError, setFormError] = useState('')
  const [rejectNotes, setRejectNotes] = useState({})
  const [saving, setSaving] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importRows, setImportRows] = useState([])
  const [importFileName, setImportFileName] = useState('')
  const [importParsing, setImportParsing] = useState(false)
  const [importProcessing, setImportProcessing] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [photoByEmployee, setPhotoByEmployee] = useState({})
  const [photoUrls, setPhotoUrls] = useState({})
  // Signed URL kedaluwarsa 300 detik; refresh berkala agar foto tidak hilang
  // di halaman idle setelah approval/foto baru muncul.
  const [photoUrlToken, setPhotoUrlToken] = useState(0)
  // Viewer foto profil pada detail: { name, photoId, url, loading, error }.
  const [photoViewer, setPhotoViewer] = useState(null)
  useEffect(() => {
    const timer = setInterval(() => setPhotoUrlToken((t) => t + 1), 240000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!photoViewer) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setPhotoViewer(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photoViewer])

  const openPhotoViewer = (name, photo) => {
    if (!photo) return
    const cached = photoUrls[photo.id] ?? null
    setPhotoViewer({ name, photoId: photo.id, url: cached, loading: !cached, error: '' })
    import('../../data/employeePhotoRepository.js')
      .then(({ createEmployeePhotoSignedUrl }) => createEmployeePhotoSignedUrl(photo.id))
      .then(({ signedUrl }) => {
        setPhotoViewer((prev) => (prev?.photoId === photo.id ? { ...prev, url: signedUrl, loading: false } : prev))
      })
      .catch((error) => {
        setPhotoViewer((prev) => (prev?.photoId === photo.id
          ? { ...prev, loading: false, error: error.message || 'Foto gagal dimuat.' }
          : prev))
      })
  }
  const [photoStaged, setPhotoStaged] = useState(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [photoDragOver, setPhotoDragOver] = useState(false)
  const photoStagedUrl = useMemo(
    () => (photoStaged?.previewUrl ? photoStaged.previewUrl : ''),
    [photoStaged],
  )
  const photoObjectUrlRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const ids = [...new Set([
      ...employees.map((e) => e.id).filter(Boolean),
      ...changeRequests
        .filter((r) => r.status === 'Pending' && r.employeeId)
        .map((r) => r.employeeId),
    ])]
    if (!ids.length) {
      setPhotoByEmployee({})
      return undefined
    }
    import('../../data/employeePhotoRepository.js')
      .then(({ listEmployeePhotos }) => listEmployeePhotos(ids))
      .then((photos) => {
        if (cancelled) return
        const grouped = {}
        for (const photo of photos) {
          if (!photo.employeeId) continue
          ;(grouped[photo.employeeId] ??= []).push(photo)
        }
        setPhotoByEmployee(grouped)
      })
      .catch(() => {
        if (!cancelled) setPhotoByEmployee({})
      })
    return () => { cancelled = true }
  }, [employees, changeRequests])

  useEffect(() => () => {
    if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current)
    if (photoStaged?.previewUrl) URL.revokeObjectURL(photoStaged.previewUrl)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const activePhotoOf = (employeeId) =>
    (photoByEmployee[employeeId] ?? []).find((photo) => photo.status === 'ACTIVE') ?? null
  const stagedPhotoOfRequest = (requestId) =>
    Object.values(photoByEmployee).flat().find(
      (photo) => photo.status === 'STAGED' && photo.changeRequestId === requestId,
    ) ?? null

  const unitById = new Map(units.map((u) => [u.id, u]))
  const orgUnitByUuid = orgMap
    ? new Map(orgMap.units.map((u) => [u.uuid, u]))
    : new Map()
  const orgUnitByKey = orgMap
    ? new Map(orgMap.units.map((u) => [u.legacyKey, u]))
    : new Map()
  const resolveUnitUuid = (id) =>
    orgUnitByUuid.get(id)?.uuid ?? orgUnitByKey.get(id)?.uuid ?? null
  const resolvedContractUuid = orgMap?.contractUuid ?? null
  const resolvedUp3Uuid = orgMap?.up3Uuid ?? null
  const selectedPreviewUnitUuid = resolveUnitUuid(unitId)
  const resolvedUnitUuids = orgMap?.scopedUnitUuids ?? []
  const scopeUnitIds = role === 'ulp'
    ? [selectedPreviewUnitUuid]
    : resolvedUnitUuids
  const scopedUnitIds = scopeUnitIds.filter(Boolean)
  const scopedJabatan = jabatanOfScope(jabatan, contractScope.contractId, up3Id)
  const jabatanById = new Map(scopedJabatan.map((j) => [j.id, j]))
  // Positions dari Supabase memakai UUID + contract_id/up3_id UUID sehingga
  // lolos dari filter scope string lokal. Lookup khusus agar position_id
  // yang tersimpan di DB tetap terresolve ke nama jabatan.
  const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const supabaseJabatan = (jabatan ?? [])
    .filter((j) => UUID_LIKE.test(j.id ?? '') && (j.status ?? 'Aktif') === 'Aktif')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name < b.name ? -1 : 1))
  const supabaseJabatanById = new Map(supabaseJabatan.map((j) => [j.id, j]))
  const jabatanOptions = [...supabaseJabatan, ...scopedJabatan.filter((j) => !UUID_LIKE.test(j.id ?? ''))]
  const scopedLocations = locations.filter(
    (l) =>
      l.contractId === resolvedContractUuid &&
      l.up3Id === resolvedUp3Uuid &&
      scopedUnitIds.includes(l.unitId),
  )
  const locationById = new Map(scopedLocations.map((l) => [l.id, l]))
  const unitName = (id) => {
    if (!id) return ''
    const orgUnit = orgUnitByUuid.get(id)
    if (orgUnit) return orgUnit.displayName
    const legacyUnit = orgUnitByKey.get(id)
    if (legacyUnit) return legacyUnit.displayName
    const localUnit = unitById.get(id)
    if (localUnit) return currentNameOf(localUnit) || id
    return id
  }
  const positionName = (posId) => {
    if (!posId) return null
    if (UUID_LIKE.test(String(posId))) return supabaseJabatanById.get(posId)?.name ?? null
    return jabatanById.get(posId)?.name ?? null
  }
  const isUuidLike = (value) => UUID_LIKE.test(String(value ?? ''))
  const displaySourcePosition = (source) =>
    source && !isUuidLike(source) ? source : ''
  const locationName = (locId) => {
    const location = locationById.get(locId)
    if (!location) return null
    return (
      currentLocationNameOf(location) ||
      (location.type === 'UNIT_OFFICE' ? unitName(location.unitId) : location.legacyKey) ||
      location.id
    )
  }
  const todayStr = today()
  const pensionPolicy = activePensionPolicy(pensionPolicies, contractScope.contractId, up3Id, todayStr)
  const activeScopedLocations = scopedLocations.filter(
    (location) =>
      location.ownStatus === 'Aktif' &&
      orgUnitByUuid.get(location.unitId)?.status === 'Aktif',
  )
  const locationOptionsFor = (unitId) =>
    activeScopedLocations.filter((location) => location.unitId === unitId)
  const filterLocationOptions = scopeUnitIds
    .flatMap((unitId) =>
      locationOptionsFor(unitId)
        .map((l) => ({ id: l.id, label: `${locationName(l.id)} (${unitName(unitId)})` })),
    )
    .sort((a, b) => (a.label < b.label ? -1 : 1))

  // req.contractId adalah UUID Supabase; bandingkan dengan resolvedContractUuid
  // (contractScope.contractId adalah kode lokal sehingga filter Pending selalu gagal).
  const pendingByEmployee = {}
  changeRequests.forEach((req) => {
    if (
      req.type === 'edit' &&
      req.status === 'Pending' &&
      req.employeeId &&
      req.contractId === resolvedContractUuid &&
      req.up3Id === resolvedUp3Uuid
    ) {
      ;(pendingByEmployee[req.employeeId] ??= []).push(req)
    }
  })
  const pendingAdds = changeRequests.filter(
    (req) =>
      req.type === 'add' &&
      req.status === 'Pending' &&
      req.contractId === resolvedContractUuid &&
      req.up3Id === resolvedUp3Uuid,
  )

  const approvalOf = (row) =>
    row.addPending
      ? 'Pending'
      : pendingByEmployee[row.employee.id]?.length
        ? 'Pending'
        : 'Approved'

  const allRows = [
    ...employees
      .filter(
        (employee) =>
          (employee.contractId == null ||
            employee.contractId === resolvedContractUuid) &&
          (employee.up3Id == null || employee.up3Id === resolvedUp3Uuid),
      )
      .map((employee) => ({ key: employee.id, employee, request: null, addPending: false })),
    ...pendingAdds.map((request) => ({
      key: `req-${request.id}`,
      employee: null,
      request,
      addPending: true,
    })),
  ].filter((row) =>
    scopedUnitIds.includes(row.employee ? row.employee.unitId : row.request.proposed.unitId),
  )

  const query = search.trim().toLowerCase()
  const filtered = allRows.filter((row) => {
    const data = row.employee ?? row.request.proposed
    if (query && !(data.name.toLowerCase().includes(query) || String(data.nip).includes(query))) {
      return false
    }
    if (filterJabatan && data.positionId !== filterJabatan) return false
    if (filterStatus && data.employmentStatus !== filterStatus) return false
    if (filterApproval && approvalOf(row) !== filterApproval) return false
    if (filterUnit && role === 'up3' && data.unitId !== filterUnit) return false
    if (filterLocation && data.workLocationId !== filterLocation) return false
    if (filterPension) {
      const st = pensionStateOf(data, todayStr, pensionPolicy).state
      const eff = effectiveEmploymentStatusOf(data, todayStr, pensionPolicy)
      if (filterPension === 'aktif' && eff.status !== 'Aktif') return false
      if (
        filterPension === 'mendekati-pensiun' &&
        !['Mendekati Pensiun', 'Peringatan', 'Segera Pensiun'].includes(st)
      ) {
        return false
      }
      if (filterPension === 'pensiun' && st !== 'Pensiun') return false
    }
    return true
  })
  const [pageSize, setPageSize] = useState(30)
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const startRow = filtered.length > 0 ? (currentPage - 1) * pageSize + 1 : 0
  const endRow = Math.min(currentPage * pageSize, filtered.length)

  // Signed URL dimuat per halaman terlihat, bukan 60 foto pertama global,
  // agar foto pegawai di halaman/filter mana pun tetap muncul.
  const visiblePhotoIds = useMemo(() => {
    const ids = []
    for (const row of visibleRows) {
      if (row.employee) {
        const active = (photoByEmployee[row.employee.id] ?? []).find((photo) => photo.status === 'ACTIVE')
        if (active) ids.push(active.id)
      } else if (row.addPending) {
        const pendingId = row.request.rawProposed?.photo_asset_id ?? row.request.proposed?.photoAssetId ?? ''
        if (pendingId) ids.push(pendingId)
      }
    }
    return [...new Set(ids)]
  }, [visibleRows, photoByEmployee])
  const visiblePhotoKey = visiblePhotoIds.join(',')
  useEffect(() => {
    let cancelled = false
    if (!visiblePhotoKey) return undefined
    import('../../data/employeePhotoRepository.js')
      .then(({ createEmployeePhotoSignedUrls }) => createEmployeePhotoSignedUrls(visiblePhotoKey.split(',')))
      .then((urls) => {
        if (cancelled) return
        // Pertahankan URL lama bila refresh gagal sebagian agar foto tidak kedip hilang.
        setPhotoUrls((prev) => ({ ...prev, ...urls }))
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePhotoKey, photoUrlToken])

  const exportMasterPegawai = () => {
    const columns = [
      { label: 'No', width: 8 },
      { label: 'Foto', width: 12 },
      { label: 'NIP', width: 18 },
      { label: 'Nama', width: 28 },
      { label: 'Unit', width: 22 },
      { label: 'Lokasi Penempatan', width: 26 },
      { label: 'Jabatan', width: 26 },
      { label: 'Tanggal Lahir', width: 16 },
      { label: 'Masa Pensiun', width: 24 },
      { label: 'Bank', width: 14 },
      { label: 'No Rekening', width: 22 },
      { label: 'Tarif Lembur/Jam', width: 20 },
      { label: 'Status', width: 14 },
      { label: 'Approval', width: 14 },
    ]
    const rows = filtered.map((row, index) => {
      const data = row.employee ?? row.request.proposed
      const pension = pensionStateOf(data, todayStr, pensionPolicy)
      const pensionLabel = pension.retirementDate
        ? `${pension.state} (${pension.retirementDate})`
        : (pension.state ?? '')
      const exportPhoto = row.employee ? activePhotoOf(row.employee.id) : null
      return [
        { value: String(index + 1) },
        { value: exportPhoto ? 'Ada' : 'Belum ada' },
        { value: data.nip ?? '' },
        { value: data.name ?? '' },
        { value: unitName(data.unitId) },
        { value: data.workLocationId ? (locationName(data.workLocationId) ?? 'Belum Ditentukan') : 'Belum ditentukan' },
        { value: positionName(data.positionId) ?? 'Belum Ditentukan' },
        { value: data.birthDate ?? '', type: 'date' },
        { value: pensionLabel },
        { value: data.bank ?? '' },
        { value: data.accountNumber ?? '' },
        { value: data.hourlyRate && data.hourlyRate > 0 ? `Rp ${Number(data.hourlyRate).toLocaleString('id-ID')}/jam` : '\u2014' },
        { value: data.employmentStatus ?? '' },
        { value: approvalOf(row) },
      ]
    })
    const scopeName = role === 'ulp'
      ? `ULP_${unitName(selectedPreviewUnitUuid)}`
      : `UP3_${unitName(resolvedUp3Uuid)}`
    const filenameScope = scopeName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const csv = [
      columns.map((column) => csvEscape(column.label)).join(','),
      ...rows.map((row) => row.map((cell) => csvEscape(cell.value)).join(',')),
    ].join('\r\n')
    downloadExportFile(
      new TextEncoder().encode(`\uFEFF${csv}`),
      `Master_Pegawai_${filenameScope}_${todayStr}.csv`,
    )
  }

  const resetPage = () => setPage(1)

  const snapshotOf = (employee) => ({
    nip: employee.nip,
    name: employee.name,
    up3Id: employee.up3Id ?? '',
    unitId: employee.unitId,
    workLocationId: employee.workLocationId ?? '',
    positionId: employee.positionId,
    bank: employee.bank,
    accountNumber: employee.accountNumber,
    hourlyRate: hourlyRateFor(employee, today()),
    birthDate: employee.birthDate ?? '',
    retirementDateOverride: employee.retirementDateOverride ?? '',
    pensionOverrideReason: employee.pensionOverrideReason ?? '',
    employmentStatus: employee.employmentStatus,
    statusReason: employee.statusReason ?? '',
    statusReasonNote: employee.statusReasonNote ?? '',
    statusEffectiveDate: employee.statusEffectiveDate ?? '',
  })

  const closeDetail = () => {
    if (photoStaged?.previewUrl) URL.revokeObjectURL(photoStaged.previewUrl)
    photoObjectUrlRef.current = null
    setPhotoStaged(null)
    setPhotoError('')
    setPhotoViewer(null)
    setDetail(null)
  }

  const openDetail = (row) => {
    setTab('utama')
    setFormError('')
    if (photoStaged?.previewUrl) URL.revokeObjectURL(photoStaged.previewUrl)
    setPhotoStaged(null)
    setPhotoError('')
    setDetail({ mode: 'view', row })
  }

  const openEdit = (row) => {
    const e = row.employee
    const existingActive = activePhotoOf(e.id)
    setForm({
      nip: e.nip,
      name: e.name,
      up3Id: e.up3Id ?? resolvedUp3Uuid,
      unitId: e.unitId,
      workLocationId: e.workLocationId ?? '',
      positionId: e.positionId,
      bank: e.bank,
      accountNumber: e.accountNumber,
      hourlyRate: String(hourlyRateFor(e, today())),
      birthDate: e.birthDate ?? '',
      retirementDateOverride: e.retirementDateOverride ?? '',
      pensionOverrideReason: e.pensionOverrideReason ?? '',
      employmentStatus: e.employmentStatus,
      statusReason: e.statusReason ?? '',
      statusReasonNote: e.statusReasonNote ?? '',
      statusEffectiveDate: e.statusEffectiveDate ?? '',
      photoAssetId: '',
      existingPhotoId: existingActive?.id ?? '',
      hasExistingPhoto: Boolean(existingActive),
    })
    if (photoStaged?.previewUrl) URL.revokeObjectURL(photoStaged.previewUrl)
    setPhotoStaged(null)
    setPhotoError('')
    setTab('utama')
    setFormError('')
    setDetail({ mode: 'edit', row })
  }

  const openAdd = () => {
    const defaultUnitId =
      role === 'ulp'
        ? selectedPreviewUnitUuid
        : resolvedUnitUuids.filter((uuid) => uuid !== resolvedUp3Uuid)[0] ?? resolvedUp3Uuid ?? ''
    setForm(emptyForm(defaultUnitId, resolvedUp3Uuid))
    if (photoStaged?.previewUrl) URL.revokeObjectURL(photoStaged.previewUrl)
    setPhotoStaged(null)
    setPhotoError('')
    setTab('utama')
    setFormError('')
    setDetail({ mode: 'add', row: null })
  }

  const validate = () => {
    if (!form.name.trim()) return 'Nama wajib diisi.'
    if (!form.nip.trim()) return 'NIP wajib diisi.'
    if (form.birthDate && form.birthDate > todayStr) {
      return 'Tanggal lahir tidak boleh melebihi hari ini.'
    }
    if (form.workLocationId) {
      const location = locationById.get(form.workLocationId)
      if (!location || location.unitId !== form.unitId) {
        return 'Lokasi Penempatan tidak valid untuk unit ini.'
      }
    }
    if (form.employmentStatus === 'Nonaktif') {
      if (!form.statusReason) return 'Alasan Nonaktif wajib diisi.'
      if (form.statusReason === 'Lainnya' && !form.statusReasonNote.trim()) {
        return 'Keterangan wajib diisi untuk alasan Lainnya.'
      }
      if (!form.statusEffectiveDate) return 'Tanggal Efektif wajib diisi.'
    }
    if (detail?.mode === 'add' && !photoStaged && !form.photoAssetId) {
      return 'Foto pegawai wajib diunggah untuk pegawai baru.'
    }
    if (detail?.mode === 'edit' && !photoStaged && !form.photoAssetId && !form.hasExistingPhoto) {
      return 'Foto pegawai wajib diunggah karena pegawai ini belum memiliki foto.'
    }
    if (detail?.mode === 'edit' && detail.row.employee?._financialsLoaded === false) {
      return 'Data bank/rekening/tarif belum termuat. Muat ulang halaman sebelum menyimpan agar data valid tidak terhapus.'
    }
    return null
  }

  const handlePhotoSelect = async (file) => {
    if (!file) return
    setPhotoBusy(true)
    setPhotoError('')
    try {
      const { processEmployeePhotoFile } = await import('../../data/employeePhotoProcessor.js')
      const processed = await processEmployeePhotoFile(file)
      if (photoStaged?.previewUrl) URL.revokeObjectURL(photoStaged.previewUrl)
      const previewUrl = processed.file.type.startsWith('image/')
        ? URL.createObjectURL(processed.file)
        : null
      photoObjectUrlRef.current = previewUrl
      setPhotoStaged({ processed, previewUrl, filename: processed.original.filename })
      setForm((prev) => ({ ...prev, photoAssetId: '' }))
    } catch (error) {
      setPhotoError(error.message || 'Gagal memproses foto pegawai.')
    } finally {
      setPhotoBusy(false)
    }
  }

  const clearPhotoStaged = () => {
    if (photoStaged?.previewUrl) URL.revokeObjectURL(photoStaged.previewUrl)
    photoObjectUrlRef.current = null
    setPhotoStaged(null)
    setForm((prev) => ({ ...prev, photoAssetId: '' }))
  }

  const formatPhotoSize = (bytes) => {
    if (bytes == null || Number.isNaN(Number(bytes))) return ''
    const size = Number(bytes)
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`
    if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`
    return `${size} B`
  }

  const handlePhotoDrop = (event) => {
    event.preventDefault()
    setPhotoDragOver(false)
    if (photoBusy || saving) return
    handlePhotoSelect(event.dataTransfer.files?.[0])
  }

  const proposedOf = () => ({
    nip: form.nip.trim(),
    name: form.name.trim(),
    up3Id: form.up3Id || resolvedUp3Uuid,
    unitId: form.unitId,
    workLocationId: form.workLocationId.trim() || null,
    positionId: form.positionId,
    sourcePosition: positionName(form.positionId),
    bank: form.bank,
    accountNumber: form.accountNumber.trim(),
    hourlyRate: Number(form.hourlyRate) || 0,
    birthDate: form.birthDate.trim(),
    retirementDateOverride: form.retirementDateOverride.trim() || null,
    pensionOverrideReason: form.pensionOverrideReason.trim() || null,
    employmentStatus: form.employmentStatus,
    statusReason: form.employmentStatus === 'Nonaktif' ? form.statusReason : null,
    statusReasonNote:
      form.employmentStatus === 'Nonaktif' ? form.statusReasonNote.trim() : null,
    statusEffectiveDate: form.employmentStatus === 'Nonaktif' ? form.statusEffectiveDate : null,
    photoAssetId: form.photoAssetId || '',
  })

  const buildRpcCtx = () => {
    // Hanya UUID positions (master Supabase) yang valid untuk server.
    // ID legacy lokal tidak bisa dikirim sebagai position_id (kolom UUID).
    const positions = supabaseJabatan.map((j) => ({ id: j.id, name: j.name }))
    return {
      positions,
      jabatanById,
      locations: scopedLocations,
      orgMap,
      units,
    }
  }

  const submitChange = async (mode) => {
    const error = validate()
    if (error) {
      setFormError(error)
      return
    }
    if (mode === 'edit' && detail.row.employee?.up3Id !== resolvedUp3Uuid) {
      setFormError('Pegawai berada di luar scope UP3 yang dipilih.')
      return
    }
    if (!resolvedContractUuid || !resolvedUp3Uuid) {
      setFormError('Scope kontrak/UP3 belum siap. Muat ulang halaman.')
      return
    }
    const proposed = proposedOf()
    const rpcProposed = toRpcProposed(proposed, buildRpcCtx())
    if (!rpcProposed.unit_id) {
      setFormError('Unit tidak valid.')
      return
    }
    setSaving(true)
    setFormError('')
    setActionError('')
    setActionMessage('')
    try {
      if (photoStaged) {
        const { uploadEmployeePhoto } = await import('../../data/employeePhotoRepository.js')
        const uploaded = await uploadEmployeePhoto({
          contractId: resolvedContractUuid,
          up3Id: resolvedUp3Uuid,
          unitId: rpcProposed.unit_id,
          employeeId: mode === 'edit' ? (detail.row.employee?.id ?? null) : null,
          processedFile: photoStaged.processed,
          file: photoStaged.processed.file,
          supersedesPhotoId: mode === 'edit' ? (form.existingPhotoId || null) : null,
        })
        rpcProposed.photo_asset_id = uploaded.id
        setForm((prev) => ({ ...prev, photoAssetId: uploaded.id }))
        clearPhotoStaged()
      }
      if (mode === 'add') {
        await submitAddWithSnapshot({
          proposedRpc: rpcProposed,
          contractId: resolvedContractUuid,
          up3Id: resolvedUp3Uuid,
        })
        setActionMessage(role === 'ulp' ? 'Pegawai baru tersimpan langsung.' : 'Pegawai baru tersimpan ke Supabase.')
      } else {
        await submitEditWithSnapshot({
          employee: detail.row.employee,
          proposedRpc: rpcProposed,
          contractId: resolvedContractUuid,
          up3Id: resolvedUp3Uuid,
        })
        setActionMessage(role === 'ulp' ? 'Perubahan pegawai berhasil disimpan langsung.' : 'Perubahan pegawai tersimpan ke Supabase.')
      }
      closeDetail()
      await onRefreshEmployees?.()
    } catch (e) {
      setFormError(e.message || 'Gagal menyimpan pegawai.')
    } finally {
      setSaving(false)
    }
  }

  const submitPensionPolicy = async () => {
    const age = Number(pensionForm.retirementAge)
    const start = pensionForm.periodStart.trim()
    if (!Number.isFinite(age) || age < 1) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return
    if (!resolvedContractUuid || !resolvedUp3Uuid) {
      setActionError('Scope kontrak/UP3 belum siap.')
      return
    }
    setSaving(true)
    setActionError('')
    try {
      await setPensionPolicy({
        contractId: resolvedContractUuid,
        up3Id: resolvedUp3Uuid,
        retirementAge: age,
        periodStart: start,
        note: pensionForm.keterangan.trim(),
      })
      setPensionForm({ retirementAge: '', periodStart: start, keterangan: '' })
      setActionMessage('Kebijakan pensiun tersimpan ke Supabase.')
      await onRefreshPensionPolicies?.()
    } catch (e) {
      setActionError(e.message || 'Gagal menyimpan kebijakan pensiun.')
    } finally {
      setSaving(false)
    }
  }

  const approveRequest = async (req) => {
    if (role !== 'up3' || req.status !== 'Pending') return
    setSaving(true)
    setActionError('')
    try {
      await approveEmployeeChange(req.id)
      setActionMessage(`Pengajuan ${req.proposed?.nip ?? ''} disetujui dan tersimpan.`)
      await onRefreshEmployees?.()
    } catch (e) {
      setActionError(e.message || 'Gagal approve.')
    } finally {
      setSaving(false)
    }
  }

  const rejectRequest = async (req) => {
    if (role !== 'up3' || req.status !== 'Pending') return
    const note = rejectNotes[req.id]?.trim()
    if (!note) {
      setActionError('Catatan wajib diisi untuk Reject.')
      return
    }
    setSaving(true)
    setActionError('')
    try {
      await rejectEmployeeChange(req.id, note)
      setActionMessage(`Pengajuan ${req.proposed?.nip ?? ''} ditolak.`)
      await onRefreshChangeRequests?.()
    } catch (e) {
      setActionError(e.message || 'Gagal reject.')
    } finally {
      setSaving(false)
    }
  }

  const pendingRequests = changeRequests
    .filter(
      (req) =>
        req.status === 'Pending' &&
        req.contractId === resolvedContractUuid &&
        req.up3Id === resolvedUp3Uuid &&
        scopedUnitIds.includes(req.proposed.unitId),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))

  const diffSummary = (oldSnap, proposed) => {
    const labels = {
      nip: 'NIP',
      name: 'Nama',
      unitId: 'Unit',
      workLocationId: 'Lokasi Penempatan',
      positionId: 'Jabatan',
      bank: 'Bank',
      accountNumber: 'No Rekening',
      hourlyRate: 'Tarif/Jam',
      birthDate: 'Tgl Lahir',
      retirementDateOverride: 'Tgl Pensiun (Override)',
      pensionOverrideReason: 'Keterangan Override',
      employmentStatus: 'Status',
      statusReason: 'Alasan',
      statusEffectiveDate: 'Tgl Efektif',
      photoAssetId: 'Foto',
    }
    const format = (key, value) =>
      key === 'photoAssetId'
        ? (value ? 'Foto baru diunggah' : 'Tetap')
        : key === 'unitId'
        ? unitName(value)
        : key === 'positionId'
          ? (positionName(value) ?? 'Belum Ditentukan')
          : key === 'workLocationId'
            ? value
              ? (locationName(value) ?? 'Belum Ditentukan')
              : 'Belum ditentukan'
            : value
    return Object.keys(labels)
      .filter((key) => oldSnap[key] !== proposed[key])
      .map(
        (key) =>
          `${labels[key]}: ${format(key, oldSnap[key] ?? '\u2014')} \u2192 ${format(key, proposed[key] ?? '\u2014')}`,
      )
  }

  const requestsOfEmployee = (employeeId, nip) =>
    changeRequests.filter(
      (req) =>
        req.contractId === resolvedContractUuid &&
        req.up3Id === resolvedUp3Uuid &&
        ((req.type === 'edit' && req.employeeId === employeeId) ||
          (req.type === 'add' && req.proposed.nip === nip)),
    )

  const getData = () => {
    if (!detail) return null
    if (detail.mode === 'add') return form
    return detail.row?.employee ?? detail.row?.request?.proposed ?? null
  }

  const renderTabContent = () => {
    if (tab === 'riwayat') return renderRiwayat()
    if (tab === 'approval') return renderApprovalTab()
    if (tab === 'pembayaran') return renderPembayaran()
    return renderUtama()
  }

  const renderUtama = () => {
    const editing = detail.mode !== 'view'
    const data = getData()
    if (!editing) {
      if (!data) {
        return <p className="sla-flat-note">Data belum tersedia.</p>
      }
      const policyAge = pensionPolicy?.retirementAge ?? 56
      const age = ageAt(data.birthDate, todayStr)
      const retirementAgeDate = data.birthDate
        ? retirementAgeDateFor(data.birthDate, policyAge)
        : null
      const lastWorking = data.birthDate
        ? lastWorkingDateFor(data.birthDate, policyAge)
        : null
      const pension = pensionStateOf(data, todayStr, pensionPolicy)
      const monthsLeft = pension.retirementDate
        ? monthsBetween(todayStr, pension.retirementDate)
        : null
      const hasOverride = Boolean(data.retirementDateOverride)
      const effectiveDateShown = hasOverride
        ? data.retirementDateOverride
        : retirementEffectiveDateFor(data.birthDate, policyAge)
      const viewPhoto = data.id ? activePhotoOf(data.id) : null
      const viewPhotoUrl = viewPhoto ? photoUrls[viewPhoto.id] : null
      const viewPending = data.id ? (pendingByEmployee[data.id] ?? []) : []
      const latestPending = viewPending[viewPending.length - 1] ?? null
      const pendingPhotoId = latestPending?.rawProposed?.photo_asset_id
        ?? latestPending?.proposed?.photoAssetId ?? ''
      const pendingPhotoUrl = pendingPhotoId ? photoUrls[pendingPhotoId] : null
      const pendingBirth = latestPending?.proposed?.birthDate ?? ''
      return (
        <div className="sla-detail-fields">
          {latestPending && (
            <div className="sla-context-field sp-pegawai-photo-field">
              <span className="sla-status-badge sla-status-draft">Menunggu Approval</span>
              <span className="sla-table-hint">
                Ada {viewPending.length} pengajuan perubahan menunggu persetujuan Admin UP3. Lihat tab Approval untuk foto dan data usulan.
                {pendingBirth && pendingBirth !== data.birthDate ? ` Tgl lahir usulan: ${pendingBirth}.` : ''}
              </span>
              {pendingPhotoId && (
                <div className="sp-pegawai-photo-actions">
                  <span className="sla-context-label">Foto usulan</span>
                  {pendingPhotoUrl ? (
                    <img src={pendingPhotoUrl} alt="Foto usulan pegawai" className="sp-pegawai-photo sp-pegawai-photo-thumb" />
                  ) : (
                    <span className="sp-pegawai-photo sp-pegawai-photo-thumb sp-pegawai-photo-placeholder">?</span>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="sla-context-field sp-pegawai-photo-field">
            <span className="sla-context-label">Foto Pegawai</span>
            {viewPhoto && viewPhotoUrl ? (
              <button
                type="button"
                className="sp-pegawai-photo-zoom"
                onClick={() => openPhotoViewer(data.name, viewPhoto)}
                aria-label={`Perbesar foto pegawai ${data.name}`}
                title="Klik untuk memperbesar"
              >
                <img
                  src={viewPhotoUrl}
                  alt={`Foto pegawai ${data.name}`}
                  className="sp-pegawai-photo sp-pegawai-photo-large"
                />
                <span className="sla-table-hint">Klik untuk memperbesar</span>
              </button>
            ) : (
              <span className="sp-pegawai-photo sp-pegawai-photo-placeholder" aria-label="Foto belum tersedia">
                {photoInitials(data.name)}
              </span>
            )}
            {!viewPhoto && (
              <span className="sla-table-hint">Foto belum tersedia. Tambahkan saat edit data.</span>
            )}
          </div>
          <Field label="NIP" value={data.nip} />
          <Field label="Nama" value={data.name} />
          <Field label="UP3" value={unitName(data.up3Id) || up3Id} />
          <Field label="Unit" value={unitName(data.unitId)} />
          <Field
            label="Lokasi Penempatan"
            value={
              data.workLocationId
                ? (locationName(data.workLocationId) ?? 'Belum Ditentukan')
                : 'Belum ditentukan'
            }
          />
          <Field label="Jabatan" value={positionName(data.positionId) ?? 'Belum Ditentukan'} />
          <Field label="Status Pegawai" value={data.employmentStatus} />
          {data.employmentStatus === 'Nonaktif' && (
            <>
              <Field label="Alasan Nonaktif" value={data.statusReason ?? '\u2014'} />
              <Field label="Keterangan" value={data.statusReasonNote || '\u2014'} />
              <Field label="Tanggal Efektif" value={data.statusEffectiveDate ?? '\u2014'} />
            </>
          )}
          <Field label="Tanggal Lahir" value={data.birthDate || '\u2014'} />
          <Field label="Usia Saat Ini" value={age == null ? '\u2014' : `${age} tahun`} />
          <Field label="Memenuhi Usia Pensiun" value={retirementAgeDate ?? '\u2014'} />
          <Field label="Terakhir Bekerja" value={hasOverride ? '\u2014' : (lastWorking ?? '\u2014')} />
          <Field label="Efektif Pensiun" value={effectiveDateShown ?? '\u2014'} />
          <Field
            label="Sisa Masa Kerja"
            value={
              monthsLeft == null ? '\u2014' : monthsLeft <= 0 ? '0 bulan' : `${monthsLeft} bulan`
            }
          />
          <div className="sla-context-field">
            <span className="sla-context-label">Kondisi Pensiun</span>
            {pension.state ? (
              <span className={`sla-status-badge ${PENSION_BADGE[pension.state]}`}>
                {pension.state}
              </span>
            ) : (
              <span className="sla-detail-value">{'\u2014'}</span>
            )}
          </div>
          {hasOverride && (
            <Field
              label="Override Tgl Pensiun"
              value={`${data.retirementDateOverride} (${data.pensionOverrideReason || 'tanpa keterangan'})`}
            />
          )}
        </div>
      )
    }
    const editExistingPhoto = detail.mode === 'edit' && detail.row.employee
      ? activePhotoOf(detail.row.employee.id)
      : null
    const editExistingUrl = editExistingPhoto ? photoUrls[editExistingPhoto.id] : null
    return (
      <div className="sla-detail-fields">
        <div className="sla-context-field sp-pegawai-photo-field">
          <span className="sla-context-label">Foto Pegawai *</span>
          <div
            className={`sp-pegawai-photo-dropzone${photoDragOver ? ' is-dragover' : ''}${photoBusy ? ' is-busy' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              if (!photoBusy && !saving) setPhotoDragOver(true)
            }}
            onDragLeave={() => setPhotoDragOver(false)}
            onDrop={handlePhotoDrop}
          >
            <input
              id="sp-pegawai-photo-input"
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              hidden
              disabled={photoBusy || saving}
              aria-label="Pilih foto pegawai"
              onChange={(e) => {
                handlePhotoSelect(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <label className="sp-pegawai-photo-dropzone-main" htmlFor="sp-pegawai-photo-input">
              <span className="sp-pegawai-photo-dropzone-preview">
                {photoStaged?.previewUrl ? (
                  <img
                    src={photoStaged.previewUrl}
                    alt="Preview foto pegawai baru"
                    className="sp-pegawai-photo sp-pegawai-photo-drop"
                  />
                ) : editExistingPhoto && editExistingUrl ? (
                  <img
                    src={editExistingUrl}
                    alt={`Foto pegawai ${form.name || ''}`}
                    className="sp-pegawai-photo sp-pegawai-photo-drop"
                  />
                ) : (
                  <span className="sp-pegawai-photo sp-pegawai-photo-drop sp-pegawai-photo-placeholder" aria-label="Foto belum tersedia">
                    {photoInitials(form.name)}
                  </span>
                )}
                {photoBusy && (
                  <span className="sp-pegawai-photo-loading" aria-live="polite">Memproses…</span>
                )}
              </span>
              <span className="sp-pegawai-photo-dropzone-text">
                <span className="sp-pegawai-photo-icon" aria-hidden="true">↑</span>
                <strong>
                  {photoBusy
                    ? 'Memproses dan mengompresi foto…'
                    : photoStaged
                      ? 'Foto siap disimpan'
                      : editExistingPhoto
                        ? 'Klik atau tarik foto untuk mengganti'
                        : 'Klik atau tarik foto ke sini'}
                </strong>
                <small>JPG, PNG, atau WebP · dikompres otomatis · hasil maks. 2 MB</small>
                {photoStaged && (
                  <small className="sp-pegawai-photo-filename">
                    {photoStaged.filename} · {formatPhotoSize(photoStaged.processed?.stored?.sizeBytes)} · WebP
                  </small>
                )}
              </span>
            </label>
            <div className="sp-pegawai-photo-actions">
              <label className="sla-btn sp-pegawai-photo-btn" htmlFor="sp-pegawai-photo-input">
                {photoStaged || editExistingPhoto ? 'Ganti Foto' : 'Pilih Foto'}
              </label>
              {photoStaged && (
                <button type="button" className="sla-btn sp-pegawai-photo-btn is-ghost" disabled={photoBusy || saving} onClick={clearPhotoStaged}>
                  Batalkan
                </button>
              )}
            </div>
            {photoError && <p className="sla-blocked-note">{photoError}</p>}
          </div>
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">NIP</span>
          <input
            className={inputClass}
            value={form.nip}
            onChange={(e) => setForm((prev) => ({ ...prev, nip: e.target.value }))}
          />
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Nama</span>
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          />
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Unit</span>
          <select
            className="sla-context-select"
            value={form.unitId}
            disabled={role === 'ulp'}
            onChange={(e) =>
              setForm((prev) => {
                const nextUnitId = e.target.value
                const location = prev.workLocationId
                  ? locationById.get(prev.workLocationId)
                  : null
                return {
                  ...prev,
                  unitId: nextUnitId,
                  workLocationId:
                    location && location.unitId === nextUnitId ? prev.workLocationId : '',
                }
              })
            }
          >
            {scopeUnitIds.map((u) => (
              <option key={u} value={u}>
                {unitName(u)}
              </option>
            ))}
          </select>
          {role === 'ulp' && (
            <span className="sla-table-hint">Terikat unit login Admin ULP</span>
          )}
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Lokasi Penempatan</span>
          <select
            className="sla-context-select"
            value={form.workLocationId ?? ''}
            onChange={(e) => setForm((prev) => ({ ...prev, workLocationId: e.target.value }))}
          >
            <option value="">Belum ditentukan</option>
            {locationOptionsFor(form.unitId).map((l) => (
              <option key={l.id} value={l.id}>
                {locationName(l.id)}
              </option>
            ))}
          </select>
          {role === 'ulp' && (
            <span className="sla-table-hint">
              Perpindahan Kantor Jaga dalam unit ini langsung tersimpan.
              Transfer antar-ULP hanya Admin UP3.
            </span>
          )}
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Jabatan (Master Jabatan)</span>
          <select
            className="sla-context-select"
            value={form.positionId ?? ''}
            onChange={(e) => setForm((prev) => ({ ...prev, positionId: e.target.value }))}
          >
            {jabatanOptions.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Status Pegawai</span>
          <select
            className="sla-context-select"
            value={form.employmentStatus}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, employmentStatus: e.target.value }))
            }
          >
            <option value="Aktif">Aktif</option>
            <option value="Nonaktif">Nonaktif</option>
          </select>
        </div>
        {form.employmentStatus === 'Nonaktif' && (
          <>
            <div className="sla-context-field">
              <span className="sla-context-label">Alasan Nonaktif</span>
              <select
                className="sla-context-select"
                value={form.statusReason ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, statusReason: e.target.value }))}
              >
                <option value="">Pilih alasan</option>
                {STATUS_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </div>
            {form.statusReason === 'Lainnya' && (
              <div className="sla-context-field">
                <span className="sla-context-label">Keterangan (wajib)</span>
                <input
                  className={inputClass}
                  value={form.statusReasonNote}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, statusReasonNote: e.target.value }))
                  }
                />
              </div>
            )}
            <div className="sla-context-field">
              <span className="sla-context-label">Tanggal Efektif (YYYY-MM-DD)</span>
              <input
                className={inputClass}
                value={form.statusEffectiveDate}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, statusEffectiveDate: e.target.value }))
                }
              />
            </div>
          </>
        )}
        <div className="sla-context-field">
          <span className="sla-context-label">Tanggal Lahir</span>
          <ModernDatePicker
            value={form.birthDate}
            max={todayStr}
            placeholder="Pilih tanggal lahir"
            ariaLabel="Pilih tanggal lahir pegawai"
            onChange={(next) => setForm((prev) => ({ ...prev, birthDate: next }))}
          />
        </div>
        {role === 'up3' && (
          <>
            <div className="sla-context-field">
              <span className="sla-context-label">Override Tanggal Pensiun (kosongkan = standar)</span>
              <input
                className={inputClass}
                value={form.retirementDateOverride}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, retirementDateOverride: e.target.value }))
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Keterangan Override</span>
              <input
                className={inputClass}
                value={form.pensionOverrideReason}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, pensionOverrideReason: e.target.value }))
                }
              />
            </div>
          </>
        )}
        {role === 'ulp' && (
          <p className="sla-table-hint">
            Perpanjangan/override tanggal pensiun hanya dapat dilakukan Admin UP3.
          </p>
        )}
      </div>
    )
  }

  const renderPembayaran = () => {
    const editing = detail.mode !== 'view'
    const data = getData()
    if (!data) {
      return <p className="sla-flat-note">Data belum tersedia.</p>
    }
    const currentRate = data.hourlyRateHistory
      ? hourlyRateFor(data, today())
      : data.hourlyRate
    if (!editing) {
      return (
        <div className="sla-detail-fields">
          <Field label="Bank" value={data.bank || '\u2014'} />
          <Field label="No Rekening" value={data.accountNumber || '\u2014'} />
          <Field
            label="Tarif Lembur/Jam aktif"
            value={currentRate && currentRate > 0 ? `Rp ${Number(currentRate).toLocaleString('id-ID')}` : '\u2014'}
          />
        </div>
      )
    }
    return (
      <div className="sla-detail-fields">
        <div className="sla-context-field">
          <span className="sla-context-label">Bank</span>
          <select
            className="sla-context-select"
            value={form.bank}
            onChange={(e) => setForm((prev) => ({ ...prev, bank: e.target.value }))}
          >
            {BANKS.map((bank) => (
              <option key={bank} value={bank}>
                {bank}
              </option>
            ))}
          </select>
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">No Rekening</span>
          <input
            className={inputClass}
            value={form.accountNumber}
            onChange={(e) => setForm((prev) => ({ ...prev, accountNumber: e.target.value }))}
          />
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Tarif Lembur/Jam (Rupiah)</span>
          <input
            className={inputClass}
            value={form.hourlyRate}
            onChange={(e) => setForm((prev) => ({ ...prev, hourlyRate: e.target.value }))}
          />
        </div>
      </div>
    )
  }

  const renderRiwayat = () => {
    const data = getData()
    if (!data) {
      return <p className="sla-flat-note">Belum ada riwayat. Simpan pegawai terlebih dahulu.</p>
    }
    if (!data.unitHistory) {
      return <p className="sla-flat-note">Belum ada riwayat (menunggu approval).</p>
    }
    const historyBlock = (title, entries, formatEntry) =>
      entries.length ? (
        <div className="sla-history-list">
          <strong>{title}</strong>
          {entries.map((entry) => (
            <div key={entry.id}>
              {formatEntry(entry)} — {formatPeriod(entry.validFrom, entry.validTo)}
            </div>
          ))}
        </div>
      ) : (
        <div className="sla-history-list">
          <strong>{title}</strong>
          <div>{'\u2014'}</div>
        </div>
      )
    return (
      <div className="sla-history-grid">
        {historyBlock('Riwayat Unit', data.unitHistory, (e) => unitName(e.unitId))}
        {historyBlock(
          'Riwayat Lokasi Penempatan',
          data.workLocationHistory ?? [],
          (e) => (e.workLocationId ? locationName(e.workLocationId) : 'Belum ditentukan'),
        )}
        {historyBlock('Riwayat Jabatan', data.positionHistory, (e) => positionName(e.positionId))}
        {historyBlock('Riwayat Tarif Lembur', data.hourlyRateHistory, (e) =>
          `Rp ${Number(e.rate || 0).toLocaleString('id-ID')}/jam`,
        )}
        {historyBlock(
          'Riwayat Status (efektif)',
          effectiveStatusHistoryOf(data, pensionPolicy),
          (e) =>
            `${e.status}${e.reason ? ` (${e.reason}${e.note ? `: ${e.note}` : ''})` : ''}${e.effectiveDate ? ` — efektif ${e.effectiveDate}` : ''}${e.derived ? ' — otomatis' : ''}`,
        )}
      </div>
    )
  }

  const renderApprovalTab = () => {
    const data = getData()
    if (!data) {
      return <p className="sla-flat-note">Status approval akan tersedia setelah data pegawai disimpan.</p>
    }
    if (detail.row?.addPending) {
      const stagedId = detail.row.request.rawProposed?.photo_asset_id
        ?? detail.row.request.proposed?.photoAssetId ?? ''
      const stagedUrl = stagedId ? photoUrls[stagedId] : null
      return (
        <div className="sla-approval-req">
          <RequestMeta req={detail.row.request} />
          <div className="sla-context-field sp-pegawai-photo-field">
            <span className="sla-context-label">Foto Pegawai (pengajuan)</span>
            {stagedUrl ? (
              <img src={stagedUrl} alt={`Foto pengajuan ${data.name}`} className="sp-pegawai-photo sp-pegawai-photo-large" />
            ) : (
              <span className="sp-pegawai-photo sp-pegawai-photo-placeholder">{photoInitials(data.name)}</span>
            )}
          </div>
          <div className="sla-detail-fields">
            <Field label="NIP" value={data.nip} />
            <Field label="Nama" value={data.name} />
            <Field label="Unit" value={unitName(data.unitId)} />
            <Field
              label="Lokasi Penempatan"
              value={data.workLocationId ? locationName(data.workLocationId) : 'Belum ditentukan'}
            />
          <Field label="Jabatan" value={positionName(data.positionId) ?? 'Belum Ditentukan'} />
            <Field label="Bank" value={data.bank} />
            <Field label="No Rekening" value={data.accountNumber} />
            <Field label="Tarif/Jam" value={data.hourlyRate && data.hourlyRate > 0 ? `Rp ${Number(data.hourlyRate).toLocaleString('id-ID')}` : '\u2014'} />
          </div>
        </div>
      )
    }
    const requests = requestsOfEmployee(data.id, data.nip)
    if (!requests.length) {
      return <p className="sla-flat-note">Belum ada pengajuan approval.</p>
    }
    return (
      <div className="sla-history-grid">
        {requests.map((req) => {
          const reqStagedId = req.rawProposed?.photo_asset_id ?? req.proposed?.photoAssetId ?? ''
          const reqStagedUrl = reqStagedId ? photoUrls[reqStagedId] : null
          const reqStagedMeta = reqStagedId ? stagedPhotoOfRequest(req.id) : null
          return (
          <div key={req.id} className="sla-approval-req">
            <RequestMeta req={req} />
            {(reqStagedUrl || reqStagedMeta || reqStagedId) && (
              <div className="sla-context-field sp-pegawai-photo-field">
                <span className="sla-context-label">Foto Pegawai (pengajuan)</span>
                {reqStagedUrl ? (
                  <img src={reqStagedUrl} alt="Foto pengajuan pegawai" className="sp-pegawai-photo sp-pegawai-photo-large" />
                ) : (
                  <span className="sp-pegawai-photo sp-pegawai-photo-placeholder">?</span>
                )}
              </div>
            )}
            {req.type === 'edit' && req.old && (
              <div className="sla-history-list">
                <strong>Data lama {'\u2192'} Data baru</strong>
                {diffSummary(req.old, req.proposed).map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            )}
            {req.note && (
              <p className="sla-table-hint">Catatan: {req.note}</p>
            )}
          </div>
          )
        })}
      </div>
    )
  }

  const RequestMeta = ({ req }) => (
    <>
      <div className="sla-approval-meta">
        <span>
          {req.type === 'add' ? 'Tambah Pegawai' : 'Edit Pegawai'} —{' '}
          {req.proposed.nip} ({req.proposed.name})
        </span>
        <span
          className={`sla-status-badge ${
            req.status === 'Approved'
              ? 'sla-status-active'
              : req.status === 'Rejected'
                ? 'sla-status-rejected'
                : 'sla-status-draft'
          }`}
        >
          {req.status}
        </span>
      </div>
      <p className="sla-table-hint">
        Diajukan oleh {req.createdBy} pada {req.createdAt}
        {req.decidedBy && ` · Diputuskan oleh ${req.decidedBy} pada ${req.decidedAt}`}
      </p>
    </>
  )

  const Field = ({ label, value }) => (
    <div className="sla-context-field">
      <span className="sla-context-label">{label}</span>
      <span className="sla-detail-value">{value}</span>
    </div>
  )

  const handleImportFile = async (file) => {
    if (!file) return
    setImportParsing(true)
    setImportResult(null)
    setActionError('')
    try {
      const rawRows = await parseImportFile(file)
      const ctx = buildRpcCtx()
      const parsed = rawRows.map((raw) => {
        const { rpc, errors } = normalizeImportRow(raw, ctx)
        return { row: raw.__row, rpc, errors, raw }
      })
      setImportRows(parsed)
      setImportFileName(file.name)
    } catch (e) {
      setActionError(e.message || 'Gagal membaca file import.')
      setImportRows([])
    } finally {
      setImportParsing(false)
    }
  }

  const handleDownloadTemplateWithData = () => {
    const rows = filtered.map((row) => {
      const data = row.employee ?? row.request.proposed
      const rate = data.hourlyRateHistory ? hourlyRateFor(data, today()) : (data.hourlyRate ?? '')
      return {
        nip: data.nip ?? '',
        nama: data.name ?? '',
        unit_id: isUuidLike(data.unitId) ? data.unitId : '',
        unit: unitName(data.unitId),
        lokasi_id: isUuidLike(data.workLocationId) ? data.workLocationId : '',
        lokasi_penempatan: data.workLocationId ? (locationName(data.workLocationId) ?? '') : '',
        jabatan_id: isUuidLike(data.positionId) ? data.positionId : '',
        jabatan: positionName(data.positionId) ?? displaySourcePosition(data.sourcePosition),
        tanggal_lahir: data.birthDate ?? '',
        bank: data.bank ?? '',
        no_rekening: data.accountNumber ?? '',
        tarif_lembur_jam: rate === '' || rate == null ? '' : rate,
        status: data.employmentStatus ?? 'Aktif',
        alasan_nonaktif: data.statusReason ?? '',
        keterangan_nonaktif: data.statusReasonNote ?? '',
        tanggal_efektif_status: data.statusEffectiveDate ?? '',
        override_tanggal_pensiun: data.retirementDateOverride ?? '',
        keterangan_override_pensiun: data.pensionOverrideReason ?? '',
      }
    })
    downloadImportTemplate(rows)
  }

  const handleProcessImport = async () => {
    const valid = importRows.filter((r) => r.errors.length === 0)
    if (!valid.length) {
      setActionError('Tidak ada baris valid untuk diimport.')
      return
    }
    if (!resolvedContractUuid || !resolvedUp3Uuid) {
      setActionError('Scope kontrak/UP3 belum siap.')
      return
    }
    setImportProcessing(true)
    setActionError('')
    try {
      const result = await importEmployeesBulk({
        contractId: resolvedContractUuid,
        up3Id: resolvedUp3Uuid,
        rows: valid.map((r) => r.rpc),
      })
      setImportResult(result)
      setActionMessage(`Import selesai: ${result.inserted ?? 0} baru, ${result.updated ?? 0} update.`)
      await onRefreshEmployees?.()
      if ((result.errors ?? []).length === 0) {
        setImportOpen(false)
        setImportRows([])
        setImportFileName('')
      }
    } catch (e) {
      setActionError(e.message || 'Gagal import.')
    } finally {
      setImportProcessing(false)
    }
  }

  return (
    <section className="sla-settings">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Master Pegawai</h2>
        <div className="sla-toolbar-actions">
          {role === 'up3' && (
            <button
              type="button"
              className="sla-btn"
              onClick={() => setPensionOpen((prev) => !prev)}
            >
              {pensionOpen ? 'Tutup Pengaturan Pensiun' : 'Pengaturan Pensiun'}
            </button>
          )}
          {scopedUnitIds.length > 0 && (
            <button type="button" className="sla-btn" onClick={exportMasterPegawai}>
              Export CSV
            </button>
          )}
          <button type="button" className="sla-btn" onClick={handleDownloadTemplateWithData}>
            Template Excel ({filtered.length} data)
          </button>
          <button type="button" className="sla-btn" onClick={() => { setImportOpen(true); setImportResult(null) }}>
            Import Data
          </button>
          <button type="button" className="sla-btn sla-btn-primary" onClick={openAdd}>
            + Tambah Pegawai
          </button>
          <span className="sla-status-badge sla-status-active">Data tersinkron</span>
        </div>
      </div>
      <p className="sla-flat-note">
        Data TAD Pelayanan Teknik (Data tersinkron Supabase, NIP sebagai kunci stabil) untuk kontrak{' '}
        {contractScope.contractName}. Unit/jabatan di-resolve dari Master
        Organisasi/Master Jabatan via unitId/positionId. Tarif Lembur/Jam
        disimpan sebagai histori. Admin ULP hanya mengelola unit sendiri dan
        tambah/edit langsung tersimpan tanpa approval.
        Perpindahan antar-ULP hanya Admin UP3. Tambah/edit
        kini tersimpan ke Supabase.
      </p>
      {actionMessage && <p className="sla-flat-note" style={{ color: 'var(--sla-success, #1a7f37)' }}>{actionMessage}</p>}
      {actionError && <p className="sla-blocked-note">{actionError}</p>}
      {orgMap?.warning && (
        <p className="sla-blocked-note">
          Nama organisasi tidak dapat dimuat — Data tersinkron: {orgMap.warning}
        </p>
      )}

      {role === 'up3' && pensionOpen && (
        <div className="sla-approval-panel sla-pension-panel">
          <h3 className="sla-settings-title">Kebijakan Pensiun</h3>
          {pensionPolicy ? (
            <p className="sla-flat-note">
              Kebijakan aktif: usia pensiun{' '}
              <strong>{pensionPolicy.retirementAge} tahun</strong> — berlaku{' '}
              {pensionPolicy.periodStart ?? 'sejak awal'} s.d.{' '}
              {pensionPolicy.periodEnd ?? 'sekarang'}.
            </p>
          ) : (
            <p className="sla-flat-note">Belum ada kebijakan pensiun aktif.</p>
          )}
          <div className="sla-sign-group-head">
            <div className="sla-context-field">
              <span className="sla-context-label">Usia pensiun baru (tahun)</span>
              <input
                className={inputClass}
                value={pensionForm.retirementAge}
                onChange={(e) =>
                  setPensionForm((prev) => ({ ...prev, retirementAge: e.target.value }))
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Berlaku mulai (YYYY-MM-DD)</span>
              <input
                className={inputClass}
                value={pensionForm.periodStart}
                onChange={(e) =>
                  setPensionForm((prev) => ({ ...prev, periodStart: e.target.value }))
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Keterangan</span>
              <input
                className={inputClass}
                value={pensionForm.keterangan}
                onChange={(e) =>
                  setPensionForm((prev) => ({ ...prev, keterangan: e.target.value }))
                }
              />
            </div>
            <div className="sla-master-actions">
              <button type="button" className="sla-btn sla-btn-primary" onClick={submitPensionPolicy}>
                Simpan Kebijakan
              </button>
            </div>
          </div>
          <div className="sla-history-list">
            <strong>Histori kebijakan</strong>
            {pensionPolicies
              .filter(
                (p) =>
                  p.contractId === contractScope.contractId &&
                  (p.up3Id == null || p.up3Id === up3Id),
              )
              .map((p) => (
                <div key={p.id}>
                  {p.retirementAge} tahun — {p.periodStart ?? 'sejak awal'} s.d.{' '}
                  {p.periodEnd ?? 'sekarang'}
                  {p.keterangan ? ` (${p.keterangan})` : ''} — {p.status}
                </div>
              ))}
          </div>
        </div>
      )}

      {detail && (
        <div className="sla-modal-overlay" onClick={() => closeDetail()}>
          <div className="sla-modal sp-pegawai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sla-modal-header">
              <h3 className="sla-modal-title">
                {detail.mode === 'add'
                  ? 'Tambah Pegawai'
                  : `${detail.mode === 'edit' ? 'Edit Pegawai' : 'Detail Pegawai'} \u2014 ${(detail.row.employee ?? detail.row.request.proposed).nip}`}
              </h3>
              <button type="button" className="sla-modal-close" onClick={() => closeDetail()}>{'\u00d7'}</button>
            </div>
            <div className="sla-modal-body">
              <div className="sla-detail-tabs">
                {TABS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`sla-detail-tab ${tab === key ? 'sla-detail-tab-active' : ''}`}
                    onClick={() => setTab(key)}
                  >
                    {TAB_LABEL[key]}
                  </button>
                ))}
              </div>
              {formError && <p className="sla-blocked-note">{formError}</p>}
              {renderTabContent()}
            </div>
            <div className="sla-modal-actions">
              {detail.mode === 'view' && !detail.row.addPending && (
                <button type="button" className="sla-btn" onClick={() => openEdit(detail.row)}>
                  Edit
                </button>
              )}
              {detail.mode !== 'view' && (
                <>
                  {role === 'ulp' && (
                    <span className="sla-export-note">
                      {detail.mode === 'add'
                        ? 'Tambah pegawai unit ini langsung tersimpan tanpa approval.'
                        : 'Edit pegawai unit ini langsung tersimpan tanpa approval.'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="sla-btn sla-btn-primary"
                    disabled={saving}
                    onClick={() => submitChange(detail.mode)}
                  >
                    {saving ? 'Menyimpan...' : detail.mode === 'add' ? 'Simpan Pegawai' : 'Simpan Perubahan'}
                  </button>
                </>
              )}
              <button type="button" className="sla-btn" onClick={() => closeDetail()}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {photoViewer && (
        <div className="sla-modal-overlay" onClick={() => setPhotoViewer(null)}>
          <div
            className="sla-modal sp-pegawai-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={`Foto pegawai ${photoViewer.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sla-modal-header">
              <h3 className="sla-modal-title">Foto Pegawai — {photoViewer.name}</h3>
              <button type="button" className="sla-modal-close" onClick={() => setPhotoViewer(null)}>{'\u00d7'}</button>
            </div>
            <div className="sla-modal-body sp-pegawai-viewer-body">
              {photoViewer.loading && !photoViewer.url ? (
                <span className="sp-pegawai-photo-loading" aria-live="polite">Memuat foto...</span>
              ) : photoViewer.url ? (
                <img src={photoViewer.url} alt={`Foto pegawai ${photoViewer.name}`} className="sp-pegawai-viewer-img" />
              ) : (
                <p className="sla-blocked-note">{photoViewer.error || 'Foto tidak tersedia.'}</p>
              )}
            </div>
            <div className="sla-modal-actions">
              <button type="button" className="sla-btn" onClick={() => setPhotoViewer(null)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {role === 'up3' && pendingRequests.length > 0 && (
        <div className="sla-approval-panel">
          <h3 className="sla-settings-title">
            Pengajuan Approval ({pendingRequests.length})
          </h3>
          {pendingRequests.map((req) => (
            <div key={req.id} className="sla-approval-req">
              <RequestMeta req={req} />
              <div className="sla-history-list">
                <strong>Data lama {'\u2192'} Data baru</strong>
                {req.type === 'edit' && req.old
                  ? diffSummary(req.old, req.proposed).map((line) => (
                      <div key={line}>{line}</div>
                    ))
                  : `Tambah pegawai baru: ${req.proposed.name} (${req.proposed.nip}) — unit ${unitName(req.proposed.unitId)}, jabatan ${positionName(req.proposed.positionId)}, tarif Rp ${Number(req.proposed.hourlyRate || 0).toLocaleString('id-ID')}/jam`}
              </div>
              <div className="sla-master-actions">
                <div className="sla-context-field">
                  <span className="sla-context-label">Catatan (wajib untuk Reject)</span>
                  <input
                    className={inputClass}
                    value={rejectNotes[req.id] ?? ''}
                    onChange={(e) =>
                      setRejectNotes((prev) => ({ ...prev, [req.id]: e.target.value }))
                    }
                  />
                </div>
                <button type="button" className="sla-btn sla-btn-primary" disabled={saving} onClick={() => approveRequest(req)}>
                  {saving ? 'Memproses...' : 'Approve'}
                </button>
                <button type="button" className="sla-btn" disabled={saving} onClick={() => rejectRequest(req)}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {importOpen && (
        <div className="sla-modal-overlay" onClick={() => setImportOpen(false)}>
          <div className="sla-modal sp-pegawai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sla-modal-header">
              <h3 className="sla-modal-title">Import Data Pegawai (.xlsx / .csv)</h3>
              <button type="button" className="sla-modal-close" onClick={() => setImportOpen(false)}>×</button>
            </div>
            <div className="sla-modal-body">
              <p className="sla-flat-note">
                Template sudah berisi <strong>{filtered.length} data lama</strong> sesuai filter — tinggal edit lalu import ulang.
                Kunci: <strong>NIP</strong>. NIP baru = tambah, NIP existing = update.
                Tanggal lahir format <strong>YYYY-MM-DD</strong>.
                {role === 'ulp' ? ' Import ULP langsung tersimpan ke Supabase (NIP baru wajib lewat form agar foto terunggah).' : ' Import UP3 langsung tersimpan ke Supabase.'}
              </p>
              <div className="sla-master-actions" style={{ marginBottom: 12 }}>
                <button type="button" className="sla-btn" onClick={handleDownloadTemplateWithData}>
                  Download Template Excel ({filtered.length} data)
                </button>
                <label className="sla-btn" style={{ cursor: 'pointer' }}>
                  Pilih File
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    onChange={(e) => handleImportFile(e.target.files?.[0])}
                  />
                </label>
                {importFileName && <span className="sla-table-hint">{importFileName}</span>}
              </div>
              {importParsing && <p className="sla-flat-note">Membaca file...</p>}
              {importRows.length > 0 && (
                <div className="sla-history-list">
                  <strong>Preview: {importRows.length} baris ({importRows.filter((r) => r.errors.length === 0).length} valid, {importRows.filter((r) => r.errors.length > 0).length} error)</strong>
                  {importRows.slice(0, 20).map((r) => (
                    <div key={r.row}>
                      Baris {r.row}: {r.rpc.nip} — {r.rpc.name}{' '}
                      {r.errors.length ? <span className="sla-status-badge sla-status-rejected">{r.errors.join('; ')}</span> : <span className="sla-status-badge sla-status-active">Valid</span>}
                    </div>
                  ))}
                  {importRows.length > 20 && <div>... {importRows.length - 20} baris lain</div>}
                </div>
              )}
              {importResult && (
                <div className="sla-history-list">
                  <strong>Hasil import</strong>
                  <div>Baru: {importResult.inserted ?? 0} · Update: {importResult.updated ?? 0} · Pending: {importResult.pending ?? 0}</div>
                  {(importResult.errors ?? []).slice(0, 10).map((e, i) => (
                    <div key={i}>Baris {e.row} ({e.nip}): {e.error}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="sla-modal-actions">
              <button type="button" className="sla-btn" onClick={() => setImportOpen(false)}>
                Tutup
              </button>
              <button
                type="button"
                className="sla-btn sla-btn-primary"
                disabled={importProcessing || !importRows.some((r) => r.errors.length === 0)}
                onClick={handleProcessImport}
              >
                {importProcessing ? 'Mengimport...' : 'Proses Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="sla-filter-panel">
        <div className="sla-filter-grid">
          <div className="sla-filter-field">
            <span className="sla-filter-label">Cari Nama/NIP</span>
            <input
              className={inputClass}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                resetPage()
              }}
              placeholder="Cari..."
            />
          </div>
          <div className="sla-filter-field">
            <span className="sla-filter-label">Jabatan</span>
            <select
              className="sla-filter-select"
              value={filterJabatan}
              onChange={(e) => {
                setFilterJabatan(e.target.value)
                resetPage()
              }}
            >
              <option value="">Semua</option>
              {jabatanOptions.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sla-filter-field">
            <span className="sla-filter-label">Status</span>
            <select
              className="sla-filter-select"
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value)
                resetPage()
              }}
            >
              <option value="">Semua</option>
              <option value="Aktif">Aktif</option>
              <option value="Nonaktif">Nonaktif</option>
            </select>
          </div>
          <div className="sla-filter-field">
            <span className="sla-filter-label">Pensiun</span>
            <select
              className="sla-filter-select"
              value={filterPension}
              onChange={(e) => {
                setFilterPension(e.target.value)
                resetPage()
              }}
            >
              <option value="">Semua</option>
              <option value="aktif">Aktif</option>
              <option value="mendekati-pensiun">Mendekati Pensiun</option>
              <option value="pensiun">Pensiun</option>
            </select>
          </div>
          <div className="sla-filter-field">
            <span className="sla-filter-label">Lokasi Penempatan</span>
            <select
              className="sla-filter-select"
              value={filterLocation}
              onChange={(e) => {
                setFilterLocation(e.target.value)
                resetPage()
              }}
            >
              <option value="">Semua</option>
              {filterLocationOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sla-filter-field">
            <span className="sla-filter-label">Approval</span>
            <select
              className="sla-filter-select"
              value={filterApproval}
              onChange={(e) => {
                setFilterApproval(e.target.value)
                resetPage()
              }}
            >
              <option value="">Semua</option>
              <option value="Approved">Approved</option>
              <option value="Pending">Pending</option>
            </select>
          </div>
          {role === 'up3' && (
            <div className="sla-filter-field">
              <span className="sla-filter-label">Unit</span>
              <select
                className="sla-filter-select"
                value={filterUnit}
                onChange={(e) => {
                  setFilterUnit(e.target.value)
                  resetPage()
                }}
              >
                <option value="">Semua</option>
                {scopeUnitIds.map((u) => (
                  <option key={u} value={u}>
                    {unitName(u)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="sla-table-wrap sla-pegawai-table-wrap">
        <table className="sla-preview-table sla-pegawai-table">
          <thead>
            <tr>
              <th>Foto</th>
              <th>NIP</th>
              <th>Nama</th>
              <th>Unit</th>
              <th>Lokasi Penempatan</th>
              <th>Jabatan</th>
              <th>Tgl Lahir</th>
              <th>Masa Pensiun</th>
              <th>Bank</th>
              <th>No Rekening</th>
              <th>Tarif Lembur/Jam</th>
              <th>Status</th>
              <th>Approval</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const data = row.employee ?? row.request.proposed
              const pension = pensionStateOf(data, todayStr, pensionPolicy)
              const pensionMonths = pension.retirementDate
                ? monthsBetween(todayStr, pension.retirementDate)
                : null
              const rowPhoto = row.employee ? activePhotoOf(row.employee.id) : null
              const rowPhotoUrl = rowPhoto ? photoUrls[rowPhoto.id] : null
              const pendingAddPhotoId = row.addPending
                ? (row.request.rawProposed?.photo_asset_id ?? row.request.proposed?.photoAssetId ?? '')
                : ''
              const pendingAddPhotoUrl = pendingAddPhotoId ? photoUrls[pendingAddPhotoId] : null
              return (
                <tr key={row.key}>
                  <td>
                    {rowPhoto && rowPhotoUrl ? (
                      <img
                        src={rowPhotoUrl}
                        alt={`Foto ${data.name}`}
                        className="sp-pegawai-photo sp-pegawai-photo-thumb"
                      />
                    ) : pendingAddPhotoUrl ? (
                      <img
                        src={pendingAddPhotoUrl}
                        alt={`Foto ${data.name}`}
                        className="sp-pegawai-photo sp-pegawai-photo-thumb"
                      />
                    ) : (
                      <span
                        className="sp-pegawai-photo sp-pegawai-photo-thumb sp-pegawai-photo-placeholder"
                        title={row.employee ? 'Foto belum tersedia' : 'Menunggu approval'}
                      >
                        {photoInitials(data.name)}
                      </span>
                    )}
                  </td>
                  <td>{data.nip}</td>
                  <td>
                    <button
                      type="button"
                      className="sla-link"
                      onClick={() => openDetail(row)}
                    >
                      {data.name}
                    </button>
                  </td>
                  <td>{unitName(data.unitId)}</td>
                  <td>
                    {data.workLocationId ? (
                      locationName(data.workLocationId) ?? (
                        <span className="sla-status-badge sla-status-draft">Belum Ditentukan</span>
                      )
                    ) : (
                      <span className="sla-status-badge sla-status-draft">Belum ditentukan</span>
                    )}
                  </td>
                  <td>
                    {positionName(data.positionId) ?? (
                      <span className="sla-status-badge sla-status-draft">Belum Ditentukan</span>
                    )}
                    {displaySourcePosition(data.sourcePosition) && displaySourcePosition(data.sourcePosition) !== (positionName(data.positionId) ?? '') && (
                      <div className="sla-table-sub">CSV: {displaySourcePosition(data.sourcePosition)}</div>
                    )}
                  </td>
                  <td>{data.birthDate || '\u2014'}</td>
                  <td>
                    {pension.state ? (
                      <>
                        <span className={`sla-status-badge ${PENSION_BADGE[pension.state]}`}>
                          {pension.state}
                        </span>
                        {pension.state !== 'Normal' && pension.state !== 'Pensiun' && (
                          <div className="sla-table-sub">
                            {pensionMonths == null || pensionMonths <= 0
                              ? '0 bulan'
                              : `${pensionMonths} bln`}
                          </div>
                        )}
                      </>
                    ) : (
                      '\u2014'
                    )}
                  </td>
                  <td>{data.bank || '\u2014'}</td>
                  <td>{data.accountNumber || '\u2014'}</td>
                  <td>
                    {data.hourlyRate && data.hourlyRate > 0
                      ? `Rp ${Number(data.hourlyRate).toLocaleString('id-ID')}/jam`
                      : '\u2014'}
                  </td>
                  <td>
                    <span
                      className={`sla-status-badge ${data.employmentStatus === 'Aktif' ? 'sla-status-active' : 'sla-status-archive'}`}
                    >
                      {data.employmentStatus}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`sla-status-badge ${approvalOf(row) === 'Approved' ? 'sla-status-active' : 'sla-status-draft'}`}
                    >
                      {approvalOf(row)}
                    </span>
                  </td>
                  <td>
                    <div className="sla-master-actions">
                      <button type="button" className="sla-btn" onClick={() => openDetail(row)}>
                        Detail
                      </button>
                      {!row.addPending && (
                        <button type="button" className="sla-btn" onClick={() => openEdit(row)}>
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {!visibleRows.length && (
              <tr>
                <td colSpan={14} className="sla-table-hint">
                  Tidak ada pegawai yang cocok dengan filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="sla-pagination">
        <div className="sla-pagination-info">
          <span>{startRow}\u2013{endRow} dari {filtered.length} pegawai</span>
          <span className="sla-pagination-sep">|</span>
          <span>Halaman {currentPage} dari {pageCount}</span>
        </div>
        <div className="sla-pagination-controls">
          <div className="sla-page-size">
            <span className="sla-page-size-label">Tampilkan</span>
            <select
              className="sla-page-size-select"
              value={pageSize}
              onChange={(e) => {
                const newSize = Number(e.target.value)
                setPageSize(newSize)
                setPage(1)
              }}
            >
              <option value={10}>10</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
            </select>
            <span className="sla-page-size-label">baris</span>
          </div>
          <button
            type="button"
            className="sla-btn"
            disabled={currentPage <= 1}
            onClick={() => setPage((prev) => prev - 1)}
          >
            &lsaquo; Sebelumnya
          </button>
          <button
            type="button"
            className="sla-btn"
            disabled={currentPage >= pageCount}
            onClick={() => setPage((prev) => prev + 1)}
          >
            Berikutnya &rsaquo;
          </button>
        </div>
      </div>
    </section>
  )
}
