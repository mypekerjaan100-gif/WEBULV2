import { useEffect, useRef, useState } from 'react'
import {
  approveOvertime,
  approveOvertimeEntry,
  getOvertimeInitialDeadlineConfig,
  listOvertimeHistory,
  listReplacementEmployees,
  rejectOvertime,
  rejectOvertimeEntry,
  resubmitOvertime,
  softDeleteOvertimeActivity,
} from '../../data/overtimeReplacementRepository.js'
import {
  automaticReplacementDescription,
  buildPontianakRange,
  formatDurationMinutes,
  pontianakFormValues,
  REPLACEMENT_TYPES,
} from '../../data/overtimeReplacementL2.js'
import { WORK_CATEGORIES } from '../../data/overtimeWorkL3.js'
import { buildTableXlsx, downloadExportFile } from '../../utils/slaExportFile.js'
import Icon from '../Icon.jsx'
import {
  Alert,
  Button,
  FilterBar,
  FilterField,
  IconButton,
  ProcessModal,
  SearchInput,
  Select,
  StatePanel,
  StatusBadge,
} from '../ui/Primitives.jsx'

const formatRp = (value) => Number(value ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })
const MAX_TIMEOUT_MS = 2147483647
const WORK_TITLE_PLACEHOLDERS = {
  GARDU: 'Contoh: Pemeliharaan Gardu',
  JTM: 'Contoh: Penanganan Tiang Tumbang',
  JTR: 'Contoh: Perbaikan JTR',
  ROW: 'Contoh: Pembersihan ROW',
}

function formatPontianakDate(value) {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Pontianak',
  }).format(value)
}

function initialDeadlineMessage(date, deadlineInfo) {
  if (!deadlineInfo?.effectiveDeadlineAt || deadlineInfo.overtimeDate !== date) return ''
  return `Batas H+${deadlineInfo.effectiveSubmissionDays} lembur ${formatPontianakDate(new Date(`${date}T12:00:00+07:00`))}: ${formatPontianakDate(new Date(deadlineInfo.effectiveDeadlineAt))}, pukul 23:59 WITA.`
}

function friendlyDeadlineError(message) {
  const text = String(message ?? '')
  if (/schema cache|could not find the function|failed to fetch|networkerror|timeout|aborterror|http \d{3}/i.test(text)) {
    return 'Konfigurasi batas pengajuan belum bisa dimuat dari server. Coba lagi sesaat.'
  }
  return text || 'Gagal memverifikasi deadline pengajuan.'
}

function recordIsExpired(record) {
  const status = recordReviewStatus(record)
  if (status === 'CLOSED' && record.closureReason === 'EXPIRED') return true
  return status === 'CORRECTION_REQUIRED'
    && record.revisionDeadlineAt
    && new Date(record.revisionDeadlineAt) < new Date()
}

function recordReviewStatus(record) {
  return record?.type === 'WORK'
    ? record.entryStatus ?? record.status
    : record?.status
}

const initialDraft = (periodMonth) => ({
  lemburType: '',
  date: periodMonth ?? '',
  replacedEmployeeId: '',
  participantEmployeeId: '',
  startTime: '08:00',
  endTime: '16:00',
  description: '',
  workTitle: '',
  workLocation: '',
  participants: [{ tempId: 'p1', employeeId: '', startTime: '18:00', endTime: '22:00' }],
})

function displayStatus(record){
  const status = recordReviewStatus(record)
  if (recordIsExpired(record)) return 'Kedaluwarsa'
  if (status==='DRAFT') return 'Draft'
  if (status==='SUBMITTED'){
    if (record.rejectionCount===1) return 'Menunggu Approval — Revisi 1'
    if (record.rejectionCount===2) return 'Menunggu Approval — Revisi Terakhir'
    return 'Menunggu Approval'
  }
  if (status==='CORRECTION_REQUIRED'){
    if (record.rejectionCount===2) return 'Revisi Terakhir'
    return 'Perlu Revisi'
  }
  if (status==='APPROVED') return 'Disetujui'
  if (status==='CLOSED' && record.closureReason==='FINAL_REJECTED') return 'Ditolak Final'
  if (status==='CLOSED' && record.closureReason==='EXPIRED') return 'Kedaluwarsa'
  if (status==='CLOSED') return 'Ditutup'
  return status
}

function statusTone(record) {
  const status = recordReviewStatus(record)
  if (recordIsExpired(record)) return 'neutral'
  if (status === 'APPROVED') return 'success'
  if (status === 'SUBMITTED') return 'info'
  if (status === 'CORRECTION_REQUIRED') return 'warning'
  if (status === 'CLOSED' && record.closureReason === 'FINAL_REJECTED') return 'danger'
  return 'neutral'
}

function statusBadgeKey(record) {
  const status = recordReviewStatus(record)
  if (recordIsExpired(record)) return 'EXPIRED'
  if (status === 'CLOSED' && record.closureReason === 'FINAL_REJECTED') return 'REJECTED'
  return status
}

function isWorkType(lemburType) {
  return lemburType?.startsWith('WORK:')
}
function workCategoryOf(lemburType) {
  if (!isWorkType(lemburType)) return null
  return lemburType.split(':')[1]
}

function isImageEvidence(entry) {
  return entry?.storedMimeType?.startsWith('image/')
    || ['FORM_CUTI', 'FORM_SAKIT', 'SURAT_SAKIT', 'FORM_IZIN', 'SURAT_IZIN', 'SPK'].includes(entry?.evidenceType)
    || entry?.evidenceType?.startsWith('FOTO_')
}

function isPdfEvidence(entry) {
  return entry?.storedMimeType === 'application/pdf'
}

function evidenceLabel(type) {
  const requirements = [
    ...Object.values(REPLACEMENT_TYPES).flatMap((config) => config.evidence),
    ...Object.values(WORK_CATEGORIES).flatMap((config) => config.evidence),
  ]
  return requirements.find((requirement) => requirement.type === type)?.label ?? type
}

export default function SLALembur({
  contractScope,
  up3Id,
  unitId,
  periodMonth,
  records,
  canMutate,
  isAdminUp3,
  isSuperAdmin,
  loading,
  loadError,
  onRetry,
  onSaveDraft,
  onSubmit,
  onSaveWorkDraft,
  onSubmitWork,
  orgUnits,
  onRefresh,
  isManagement = false,
  isUlManagement = false,
  isUpManagement = false,
  managementScopeLabel = null,
  approvalTarget = null,
  onApprovalTargetHandled,
}) {
  const [draft, setDraft] = useState(() => initialDraft(periodMonth))
  const [activeActivityId, setActiveActivityId] = useState(null)
  const [activeWorkCategory, setActiveWorkCategory] = useState(null)
  const [employeeOptions, setEmployeeOptions] = useState([])
  const [employeeLoading, setEmployeeLoading] = useState(false)
  const [evidence, setEvidence] = useState([])
  const [files, setFiles] = useState({})
  const [message, setMessage] = useState(null)
  const [isSubmitting, setSubmitting] = useState(false)
  const [dirty, setDirty] = useState(true)
  const activeActivityIdRef = useRef(activeActivityId)
  activeActivityIdRef.current = activeActivityId
  const [filters, setFilters] = useState({ ulp: '', unitLayanan: '', jenis: 'Semua', pegawai: '', status: 'Semua', periode: '' })
  const canViewFinancial = isAdminUp3 || isSuperAdmin || isManagement
  const isReadOnlyManagement = isManagement
  const [rowsPerPage, setRowsPerPage] = useState(30)
  const [currentPage, setCurrentPage] = useState(1)
  const [detailActivityId, setDetailActivityId] = useState(null)
  const [detailEntryId, setDetailEntryId] = useState(null)

  const openDetail = (record) => {
    setDetailActivityId(record?.id ?? null)
    setDetailEntryId(record?.entryId ?? null)
  }
  const closeDetail = () => {
    setDetailActivityId(null)
    setDetailEntryId(null)
    setShowReject(null)
    setRejectReason('')
  }
  const [detailEvidence, setDetailEvidence] = useState([])
  const [detailHistory, setDetailHistory] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formStep, setFormStep] = useState('main')
  const [evidenceUrls, setEvidenceUrls] = useState({})
  const [detailEvidenceUrls, setDetailEvidenceUrls] = useState({})
  const [detailFinancial, setDetailFinancial] = useState([])
  const [evidencePreview, setEvidencePreview] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [submitProcess, setSubmitProcess] = useState(null)
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [approvalError, setApprovalError] = useState('')
  const [deadlineInfo, setDeadlineInfo] = useState(null)
  const [deadlineLoadStatus, setDeadlineLoadStatus] = useState('idle')
  const [deadlineLoadError, setDeadlineLoadError] = useState('')
  const [deadlineReloadToken, setDeadlineReloadToken] = useState(0)
  const [deadlineClock, setDeadlineClock] = useState(() => Date.now())
  const [deadlineServerOffset, setDeadlineServerOffset] = useState(0)
  const handledApprovalToken = useRef(null)

  useEffect(() => {
    if (approvalTarget?.source !== 'lembur' || !approvalTarget.token || approvalTarget.token === handledApprovalToken.current) return
    handledApprovalToken.current = approvalTarget.token
    setDetailActivityId(approvalTarget.id)
    setDetailEntryId(null)
    onApprovalTargetHandled?.()
  }, [approvalTarget?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!formOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [formOpen])

  useEffect(() => {
    if (!toast) return undefined
    const timeoutId = window.setTimeout(() => setToast(''), 3500)
    return () => window.clearTimeout(timeoutId)
  }, [toast])

  useEffect(() => {
    setApprovalError('')
    setApprovalBusy(false)
  }, [detailActivityId, detailEntryId])

  useEffect(() => {
    if (!formOpen || formStep !== 'form' || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date ?? '') || !contractScope.contractId || !up3Id) {
      setDeadlineInfo(null)
      setDeadlineLoadStatus('idle')
      setDeadlineLoadError('')
      return undefined
    }
    let cancelled = false
    const requestedAt = Date.now()
    setDeadlineInfo(null)
    setDeadlineLoadStatus('loading')
    setDeadlineLoadError('')
    getOvertimeInitialDeadlineConfig({
      contractId: contractScope.contractId,
      up3Id,
      overtimeDate: draft.date,
    })
      .then((next) => {
        if (cancelled) return
        if (!next) throw new Error('Deadline pengajuan tidak tersedia.')
        const receivedAt = Date.now()
        const serverOffset = new Date(next.asOf).getTime() - Math.round((requestedAt + receivedAt) / 2)
        setDeadlineInfo(next)
        setDeadlineServerOffset(serverOffset)
        setDeadlineClock(Date.now() + serverOffset)
        setDeadlineLoadStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setDeadlineLoadError(friendlyDeadlineError(error?.message))
        setDeadlineLoadStatus('error')
      })
    return () => { cancelled = true }
  }, [formOpen, formStep, draft.date, contractScope.contractId, up3Id, deadlineReloadToken])

  useEffect(() => {
    if (!deadlineInfo?.temporaryIsActive || !deadlineInfo.temporaryEffectiveUntil) return undefined
    const delay = new Date(deadlineInfo.temporaryEffectiveUntil).getTime() - (Date.now() + deadlineServerOffset) + 1000
    if (delay <= 0) {
      setDeadlineReloadToken((value) => value + 1)
      return undefined
    }
    const timeoutId = window.setTimeout(
      () => setDeadlineReloadToken((value) => value + 1),
      Math.min(delay, MAX_TIMEOUT_MS),
    )
    return () => window.clearTimeout(timeoutId)
  }, [deadlineInfo?.temporaryIsActive, deadlineInfo?.temporaryEffectiveUntil, deadlineServerOffset])

  useEffect(() => {
    if (!deadlineInfo?.effectiveDeadlineAt) return undefined
    const delay = new Date(deadlineInfo.effectiveDeadlineAt).getTime() - (Date.now() + deadlineServerOffset) + 1
    if (delay <= 0) return undefined
    const timeoutId = window.setTimeout(() => {
      if (delay > MAX_TIMEOUT_MS) setDeadlineReloadToken((value) => value + 1)
      else setDeadlineClock(Date.now() + deadlineServerOffset)
    }, Math.min(delay, MAX_TIMEOUT_MS))
    return () => window.clearTimeout(timeoutId)
  }, [deadlineInfo?.effectiveDeadlineAt, deadlineServerOffset])

  const range = buildPontianakRange(draft.date, draft.startTime, draft.endTime)
  const replacedEmployee = employeeOptions.find((e) => e.id === draft.replacedEmployeeId)
  const participantEmployee = employeeOptions.find((e) => e.id === draft.participantEmployeeId)
  const participantOptions = replacedEmployee
    ? employeeOptions.filter((e) => e.unitId === replacedEmployee.unitId && e.id !== replacedEmployee.id)
    : []

  const workCategory = workCategoryOf(draft.lemburType)
  const isReplacement = !!REPLACEMENT_TYPES[draft.lemburType]
  const isWork = !!workCategory
  const isAdministrasi = workCategory === 'ADMINISTRASI'
  const isMultiWork = workCategory && workCategory !== 'ADMINISTRASI'
  const formLayoutClass = isReplacement ? 'is-replacement' : isAdministrasi ? 'is-administrasi' : 'is-technical'

  const replacementDescription = automaticReplacementDescription({
    type: draft.lemburType,
    participantName: participantEmployee?.name,
    replacedName: replacedEmployee?.name,
    date: draft.date,
    startTime: draft.startTime,
    endTime: draft.endTime,
  })

  const workEvidenceReq = isWork ? (WORK_CATEGORIES[workCategory]?.evidence ?? []) : []
  const replacementEvidenceReq = isReplacement ? (REPLACEMENT_TYPES[draft.lemburType]?.evidence ?? []) : []
  const evidenceRequirements = isWork ? workEvidenceReq : replacementEvidenceReq
  const activeRecords = activeActivityId ? records.filter((record) => record.id === activeActivityId) : []
  const activeRecord = activeRecords.find((record) => recordReviewStatus(record) === 'CORRECTION_REQUIRED') ?? activeRecords[0] ?? null
  const isRevision = recordReviewStatus(activeRecord) === 'CORRECTION_REQUIRED'
  const initialDeadline = deadlineInfo?.overtimeDate === draft.date && deadlineInfo.effectiveDeadlineAt
    ? new Date(deadlineInfo.effectiveDeadlineAt)
    : null
  const deadlineReady = deadlineLoadStatus === 'ready' && deadlineInfo?.overtimeDate === draft.date
  const initialDeadlinePassed = Boolean(!isRevision && initialDeadline && initialDeadline.getTime() < deadlineClock)
  const deadlineUnavailable = Boolean(!isRevision && draft.date && !deadlineReady)
  const submitting = isSubmitting || deadlineUnavailable
  const activeInitialExpired = recordReviewStatus(activeRecord) === 'DRAFT' && initialDeadlinePassed
  const activeRevisionExpired = isRevision && recordIsExpired(activeRecord)
  const activeHasApproved = activeRecords.some((entry) => recordReviewStatus(entry) === 'APPROVED')
  const formReadOnly = activeInitialExpired || activeRevisionExpired

  const evidenceByType = evidence.reduce((acc, r) => {
    acc[r.evidenceType] = acc[r.evidenceType] || []
    acc[r.evidenceType].push(r)
    return acc
  }, {})
  const evidenceSingle = Object.fromEntries(Object.entries(evidenceByType).map(([k,v])=>[k, v.find(x=>x.status==='ACTIVE')||null]))

  const evidenceComplete = evidenceRequirements.length > 0 && evidenceRequirements.every((requirement) => {
    const activeCount = (evidenceByType[requirement.type] ?? []).filter((row) => row.status === 'ACTIVE').length
    const stagedCount = (files[requirement.type] ?? []).length
    return requirement.allowMultiple ? activeCount + stagedCount > 0 : stagedCount > 0 || activeCount === 1
  })

  const employeeQueryDate = draft.date ? `${draft.date}T12:00:00+07:00` : null
  useEffect(() => {
    if (!canMutate || !employeeQueryDate || !contractScope.contractId || !up3Id) {
      setEmployeeOptions([])
      return undefined
    }
    let cancelled = false
    setEmployeeLoading(true)
    setEmployeeOptions([])
    listReplacementEmployees({ contractId: contractScope.contractId, up3Id, startedAt: employeeQueryDate })
      .then(rows => { if(!cancelled) setEmployeeOptions(rows) })
      .catch(err => { if(!cancelled) setMessage(err.message || 'Gagal memuat pegawai Lembur.') })
      .finally(() => { if(!cancelled) setEmployeeLoading(false) })
    return () => { cancelled = true }
  }, [canMutate, contractScope.contractId, up3Id, employeeQueryDate])

  const refreshEvidence = async (activityId = activeActivityId) => {
    if (!activityId) { setEvidence([]); return }
    const { listOvertimeEvidence } = await import('../../data/overtimeEvidenceRepository.js')
    const rows = await listOvertimeEvidence(activityId)
    if (activeActivityIdRef.current === activityId) setEvidence(rows)
  }

  useEffect(() => {
    let cancelled=false
    if (!activeActivityId) { setEvidence([]); return undefined }
    setEvidence([])
    import('../../data/overtimeEvidenceRepository.js')
      .then(({ listOvertimeEvidence }) => listOvertimeEvidence(activeActivityId))
      .then(rows => { if(!cancelled) setEvidence(rows) })
      .catch(err => { if(!cancelled) setMessage(err.message || 'Gagal memuat evidence.') })
    return () => { cancelled=true }
  }, [activeActivityId])

  useEffect(() => {
    let cancelled = false
    const images = evidence.filter((entry) => entry.status === 'ACTIVE' && isImageEvidence(entry))
    if (!images.length) {
      setEvidenceUrls({})
      return undefined
    }
    import('../../data/overtimeEvidenceRepository.js')
      .then(async ({ createOvertimeEvidenceSignedUrl }) => Promise.all(images.map(async (entry) => {
        const signed = await createOvertimeEvidenceSignedUrl(entry.id)
        return [entry.id, signed.signedUrl]
      })))
      .then((urls) => { if (!cancelled) setEvidenceUrls(Object.fromEntries(urls)) })
      .catch(() => { if (!cancelled) setEvidenceUrls({}) })
    return () => { cancelled = true }
  }, [evidence])

  const updateDraft = (patch) => {
    setDraft(c=>({ ...c, ...patch }))
    setDirty(true)
    setMessage(null)
  }

  const releaseStagedFiles = (stagedFiles = files) => {
    Object.values(stagedFiles).flat().forEach((entry) => {
      if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl)
    })
  }

  const resetForm = () => {
    releaseStagedFiles()
    setDraft(initialDraft(periodMonth))
    setActiveActivityId(null)
    setActiveWorkCategory(null)
    setEvidence([])
    setFiles({})
    setDirty(true)
    setMessage(null)
  }

  const openNewForm = () => {
    resetForm()
    setFormStep('main')
    setFormOpen(true)
  }

  const closeForm = () => {
    releaseStagedFiles()
    setFormOpen(false)
    setFormStep('main')
  }

  const editDraft = (record) => {
    if (!record) return
    const activityRecords = records.filter(r=>r.id===record.id)
    const first = activityRecords[0]
    if (!first) return
    const clickedStatus = recordReviewStatus(record)
    const canEdit = clickedStatus==='DRAFT' || clickedStatus==='CORRECTION_REQUIRED'
    if (!canEdit) {
      setMessage('Data sudah berubah status. Muat ulang daftar lembur lalu buka kembali revisinya.')
      return
    }
    if (recordIsExpired(record)){
      setMessage(recordReviewStatus(record) === 'DRAFT'
        ? 'Batas pengajuan telah lewat. Draft ini sudah kedaluwarsa dan hanya dapat dilihat.'
        : 'Batas revisi telah lewat. Transaksi Lembur sudah kedaluwarsa.')
      return
    }
    if (first.type === 'WORK') {
      const cat = first.workCategory
      const time = pontianakFormValues(first.startedAt, first.endedAt)
      const participants = activityRecords.map((r,i)=> {
        const t = pontianakFormValues(r.startedAt, r.endedAt)
        return { tempId: `p${i+1}`, employeeId: r.participantEmployeeId, startTime: t.startTime, endTime: t.endTime }
      })
      setDraft({
        lemburType: `WORK:${cat}`,
        date: time.date,
        replacedEmployeeId: '',
        participantEmployeeId: cat==='ADMINISTRASI' ? first.participantEmployeeId : '',
        startTime: cat==='ADMINISTRASI' ? time.startTime : '18:00',
        endTime: cat==='ADMINISTRASI' ? time.endTime : '22:00',
        description: first.description || '',
        workTitle: first.workTitle || '',
        workLocation: first.workLocation || '',
        participants: cat==='ADMINISTRASI' ? [{ tempId:'p1', employeeId:first.participantEmployeeId, startTime: time.startTime, endTime: time.endTime }] : participants,
      })
      setActiveWorkCategory(cat)
    } else {
      const time = pontianakFormValues(first.startedAt, first.endedAt)
      setDraft({
        lemburType: first.type,
        date: time.date,
        replacedEmployeeId: first.replacedEmployeeId,
        participantEmployeeId: first.participantEmployeeId,
        startTime: time.startTime,
        endTime: time.endTime,
        description: '',
        workTitle: '',
        workLocation: '',
        participants: [{ tempId:'p1', employeeId:'', startTime:'18:00', endTime:'22:00'}],
      })
    }
    setActiveActivityId(first.id)
    setEvidence([])
    setFiles({})
    setDirty(false)
    setMessage(null)
    setFormStep('form')
    setFormOpen(true)
  }

  const validateReplacement = () => {
    if (!REPLACEMENT_TYPES[draft.lemburType]) return 'Pilih jenis Pengganti Cuti, Sakit, atau Izin.'
    if (!range || range.durationMinutes <1) return 'Tanggal dan jam lembur tidak valid.'
    if (!draft.date.startsWith(String(periodMonth).slice(0,7))) return 'Tanggal lembur harus berada dalam periode yang dipilih.'
    if (!replacedEmployee || !participantEmployee) return 'Pilih kedua pegawai.'
    if (replacedEmployee.id===participantEmployee.id) return 'Pegawai yang digantikan dan pengganti harus berbeda.'
    if (replacedEmployee.unitId !== participantEmployee.unitId) return 'Kedua pegawai harus berasal dari ULP yang sama.'
    if (unitId && replacedEmployee.unitId !== unitId) return 'Pegawai berada di luar ULP akun.'
    return null
  }

  const validateWork = () => {
    if (!workCategory) return 'Pilih kategori pekerjaan.'
    if (!draft.date) return 'Tanggal wajib diisi.'
    if (!draft.date.startsWith(String(periodMonth).slice(0,7))) return 'Tanggal lembur harus berada dalam periode yang dipilih.'
    if (!draft.description || !draft.description.trim()) return 'Keterangan pekerjaan wajib diisi.'
    if (isMultiWork) {
      if (!draft.workTitle?.trim()) return 'Uraian pekerjaan wajib diisi.'
      if (!draft.workLocation?.trim()) return 'Lokasi pekerjaan wajib diisi.'
      if (!draft.participants?.length) return 'Tambahkan minimal satu pegawai.'
      const seen=new Set()
      for (const p of draft.participants) {
        if (!p.employeeId) return 'Pilih pegawai untuk setiap peserta.'
        if (seen.has(p.employeeId)) return 'Pegawai tidak boleh duplikat dalam satu aktivitas.'
        seen.add(p.employeeId)
        const emp = employeeOptions.find(e=>e.id===p.employeeId)
        if (!emp) return 'Pegawai peserta tidak ditemukan dalam scope.'
        if (unitId && emp.unitId !== unitId) return 'Peserta berada di luar ULP akun.'
        const r = buildPontianakRange(draft.date, p.startTime, p.endTime)
        if (!r || r.durationMinutes<1) return 'Jam peserta tidak valid.'
      }
      const units = draft.participants.map(p=> employeeOptions.find(e=>e.id===p.employeeId)?.unitId).filter(Boolean)
      if (new Set(units).size>1) return 'Semua peserta harus dari ULP yang sama.'
      if (unitId && units[0]!==unitId) return 'Peserta berada di luar ULP akun.'
    } else if (isAdministrasi) {
      const p = draft.participants[0] || { employeeId: draft.participantEmployeeId, startTime: draft.startTime, endTime: draft.endTime }
      const empId = p.employeeId || draft.participantEmployeeId
      if (!empId) return 'Pilih pegawai lembur.'
      const emp = employeeOptions.find(e=>e.id===empId)
      if (!emp) return 'Pegawai tidak ditemukan.'
      if (unitId && emp.unitId!==unitId) return 'Pegawai berada di luar ULP akun.'
      const r = buildPontianakRange(draft.date, p.startTime||draft.startTime, p.endTime||draft.endTime)
      if (!r || r.durationMinutes<1) return 'Jam lembur tidak valid.'
    }
    return null
  }

  const validateDraft = () => {
    if (!isRevision && draft.date && !deadlineReady) return deadlineLoadError || 'Deadline pengajuan masih diverifikasi. Coba lagi setelah proses selesai.'
    if (initialDeadlinePassed) return `Batas pengajuan telah lewat. ${initialDeadlineMessage(draft.date, deadlineInfo)} Silakan pilih tanggal lembur yang masih berada dalam batas pengajuan H+${deadlineInfo.effectiveSubmissionDays}.`
    if (isReplacement) return validateReplacement()
    if (isWork) return validateWork()
    return 'Pilih jenis lembur.'
  }

  const persistDraft = async () => {
    let result
    if (isReplacement) {
      result = await onSaveDraft(activeActivityId, {
        unitId: replacedEmployee.unitId,
        type: draft.lemburType,
        replacedEmployeeId: replacedEmployee.id,
        participantEmployeeId: participantEmployee.id,
        startedAt: range.startedAt,
        endedAt: range.endedAt,
      }, { skipRefresh: true })
    } else {
      let participants=[]
      let unitForActivity=null
      if (isAdministrasi) {
        const p = draft.participants[0]
        const empId = p?.employeeId || draft.participantEmployeeId
        const st = p?.startTime || draft.startTime
        const en = p?.endTime || draft.endTime
        const participantRange = buildPontianakRange(draft.date, st, en)
        const employee = employeeOptions.find((option) => option.id === empId)
        unitForActivity = employee.unitId
        participants=[{ employee_id: empId, started_at: participantRange.startedAt, ended_at: participantRange.endedAt }]
      } else {
        participants = draft.participants.map((participant) => {
          const participantRange = buildPontianakRange(draft.date, participant.startTime, participant.endTime)
          return { employee_id: participant.employeeId, started_at: participantRange.startedAt, ended_at: participantRange.endedAt }
        })
        unitForActivity = employeeOptions.find((option) => option.id === participants[0].employee_id)?.unitId
      }
      result = await onSaveWorkDraft(activeActivityId, {
        unitId: unitForActivity,
        workCategory,
        description: draft.description,
        workTitle: draft.workTitle,
        workLocation: draft.workLocation,
        participants,
      }, { skipRefresh: true })
    }
    if (!result?.ok || !result.activityId) throw new Error(result?.message || 'Draft Lembur gagal disimpan.')
    setActiveActivityId(result.activityId)
    activeActivityIdRef.current = result.activityId
    if (isWork) setActiveWorkCategory(workCategory)
    return result.activityId
  }

  const stageEvidence = async (requirement, fileOrFiles) => {
    const incoming = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles]
    const pending = incoming.filter(Boolean)
    if (!pending.length || initialDeadlinePassed || deadlineUnavailable || formReadOnly) return
    if (activeHasApproved) {
      setMessage('Sebagian peserta sudah disetujui sehingga evidence tidak dapat diubah.')
      return
    }
    const queue = requirement.allowMultiple ? pending : pending.slice(0, 1)
    setSubmitting(true)
    setMessage(`Memproses ${requirement.label}...`)
    try {
      const { prepareOvertimeEvidenceFile } = await import('../../data/overtimeEvidenceRepository.js')
      const stagedItems = []
      for (const file of queue) {
        const processed = await prepareOvertimeEvidenceFile(file, requirement.type)
        stagedItems.push({
          id: `${requirement.type}-${Date.now()}-${Math.random()}`,
          processed,
          previewUrl: processed.file.type.startsWith('image/') ? URL.createObjectURL(processed.file) : null,
        })
      }
      setFiles((current) => ({
        ...current,
        [requirement.type]: requirement.allowMultiple
          ? [...(current[requirement.type] ?? []), ...stagedItems]
          : (() => {
              (current[requirement.type] ?? []).forEach((entry) => {
                if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl)
              })
              return stagedItems
            })(),
      }))
      const countText = requirement.allowMultiple && stagedItems.length > 1 ? ` (${stagedItems.length} foto)` : ''
      setMessage(`${requirement.label} siap disimpan${countText}. Klik Simpan Draft atau Ajukan Lembur.`)
    } catch (error) {
      const text = error.message || `Gagal memproses ${requirement.label}.`
      setMessage(text)
    } finally {
      setSubmitting(false)
    }
  }

  const removeStagedEvidence = (evidenceType, stagedId) => {
    setFiles((current) => {
      const removed = (current[evidenceType] ?? []).find((item) => item.id === stagedId)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return {
        ...current,
        [evidenceType]: (current[evidenceType] ?? []).filter((item) => item.id !== stagedId),
      }
    })
  }

  const uploadStagedEvidence = async (activityId) => {
    const { listOvertimeEvidence, uploadOvertimeEvidence } = await import('../../data/overtimeEvidenceRepository.js')
    for (const requirement of evidenceRequirements) {
      const stagedItems = files[requirement.type] ?? []
      for (let index = 0; index < stagedItems.length; index += 1) {
        const staged = stagedItems[index]
        await uploadOvertimeEvidence({
          activityId,
          evidenceType: requirement.type,
          file: staged.processed.file,
          processedFile: staged.processed,
          sortOrder: requirement.allowMultiple
            ? (evidenceByType[requirement.type] ?? []).filter((row) => row.status === 'ACTIVE').length + index
            : 0,
          supersedesEvidenceId: requirement.allowMultiple ? null : (evidenceSingle[requirement.type]?.id ?? null),
        })
        if (staged.previewUrl) URL.revokeObjectURL(staged.previewUrl)
        setFiles((current) => ({
          ...current,
          [requirement.type]: (current[requirement.type] ?? []).filter((item) => item.id !== staged.id),
        }))
      }
    }
    setEvidence(await listOvertimeEvidence(activityId))
  }

  const saveDraft = async () => {
    const validation = validateDraft()
    if (validation) { setMessage(validation); return }
    setSubmitting(true)
    try {
      const activityId = await persistDraft()
      await uploadStagedEvidence(activityId)
      setDirty(false)
      setMessage('Draft dan evidence berhasil disimpan — Data tersinkron.')
      if(onRefresh) await onRefresh()
    } catch (error) {
      if (activeActivityIdRef.current) await refreshEvidence(activeActivityIdRef.current).catch(() => {})
      setMessage(friendlySaveError(error?.message, 'Draft atau evidence gagal disimpan.'))
    } finally { setSubmitting(false) }
  }

  const previewEvidence = async (entry, entries = [entry]) => {
    const previewEntries = entries.filter((candidate) => candidate.status === 'ACTIVE')
    const index = Math.max(0, previewEntries.findIndex((candidate) => candidate.id === entry.id))
    setEvidencePreview({ entries: previewEntries, index, entry, url: null, loading: true })
    try {
      const { createOvertimeEvidenceSignedUrl } = await import('../../data/overtimeEvidenceRepository.js')
      const signed = await createOvertimeEvidenceSignedUrl(entry.id)
      setEvidencePreview({ entries: previewEntries, index, entry, url: signed.signedUrl, loading: false })
    } catch (e) {
      setEvidencePreview(null)
      setMessage(e.message || 'Preview evidence gagal.')
    }
  }

  const moveEvidencePreview = (direction) => {
    if (!evidencePreview?.entries?.length) return
    const nextIndex = (evidencePreview.index + direction + evidencePreview.entries.length) % evidencePreview.entries.length
    previewEvidence(evidencePreview.entries[nextIndex], evidencePreview.entries)
  }

  const removeEvidence = async (entry) => {
    if (activeHasApproved) {
      setMessage('Sebagian peserta sudah disetujui sehingga evidence tidak dapat diubah.')
      return
    }
    if (!window.confirm(`Hapus ${entry.originalFilename}?`)) return
    setSubmitting(true)
    try {
      const { deleteOvertimeEvidence } = await import('../../data/overtimeEvidenceRepository.js')
      await deleteOvertimeEvidence(entry.id)
      await refreshEvidence(activeActivityId)
      setMessage('Evidence dihapus.')
    } catch (e) { setMessage(e.message || 'Evidence gagal dihapus.') } finally { setSubmitting(false) }
  }

  const runSubmitDraft = async () => {
    const validation = validateDraft()
    if (validation) { setMessage(validation); return false }
    if (!evidenceComplete) { setMessage('Lengkapi seluruh evidence wajib sebelum mengajukan Lembur.'); return false }
    setSubmitting(true)
    setSubmitProcess({ status: 'loading', error: '' })
    try {
      const resubmitting = isRevision
      let activityId = activeActivityId
      if (!activityId || dirty) activityId = await persistDraft()
      await uploadStagedEvidence(activityId)
      const result = resubmitting
        ? await resubmitOvertime(activityId)
        : isReplacement
          ? await onSubmit(activityId, { skipRefresh: true })
          : await onSubmitWork(activityId, { skipRefresh: true })
      if (!resubmitting && !result?.ok) throw new Error(result?.message || 'Lembur gagal diajukan.')
      resetForm()
      setFormOpen(false)
      setMessage(resubmitting ? 'Revisi Lembur berhasil diajukan kembali.' : 'Lembur diajukan dan menunggu approval.')
      setSubmitProcess({ status: 'success', error: '' })
      if(onRefresh) await onRefresh({ background: true }).catch(() => {})
      return true
    } catch (error) {
      if (activeActivityIdRef.current) await refreshEvidence(activeActivityIdRef.current).catch(() => {})
      const errorMessage = friendlySaveError(error?.message, 'Draft, evidence, atau pengajuan Lembur gagal disimpan.')
      setMessage(errorMessage)
      setSubmitProcess({ status: 'error', error: errorMessage })
      return false
    } finally { setSubmitting(false) }
  }

  const submitDraft = () => {
    runSubmitDraft()
  }

  function friendlyApprovalError(message, fallback) {
    const text = String(message ?? '')
    if (/not authorized|42501|permission|scope/i.test(text)) {
      return 'Akun Anda tidak memiliki akses approval untuk scope lembur ini.'
    }
    if (/only submitted|status/i.test(text)) {
      return 'Data sudah berubah status. Tutup detail lalu buka kembali untuk memuat status terbaru.'
    }
    if (/failed to fetch|networkerror|timeout|aborterror|http \d{3}/i.test(text)) {
      return 'Terjadi gangguan jaringan. Periksa koneksi lalu coba lagi.'
    }
    return text || fallback
  }

  function friendlySaveError(message, fallback) {
    const text = String(message ?? '')
    if (/only draft replacement overtime can be changed|only draft or revision replacement/i.test(text)) {
      return 'Data sudah berubah status. Muat ulang daftar lembur lalu buka kembali revisinya.'
    }
    if (/revision deadline has expired|batas revisi telah lewat/i.test(text)) {
      return 'Batas revisi telah lewat. Transaksi Lembur sudah kedaluwarsa.'
    }
    if (/overtime activity is not available|not available to this account/i.test(text)) {
      return 'Data sudah tidak tersedia untuk akun ini. Muat ulang daftar lembur.'
    }
    if (/authentication required|42501|not authorized|not mutable by this account|permission|scope/i.test(text)) {
      return 'Akun Anda tidak memiliki akses untuk menyimpan data lembur ini.'
    }
    if (/failed to fetch|networkerror|timeout|aborterror|http \d{3}/i.test(text)) {
      return 'Terjadi gangguan jaringan. Periksa koneksi lalu coba lagi.'
    }
    return text || fallback || 'Draft atau revisi Lembur gagal disimpan.'
  }

  function friendlyDeleteError(message) {
    const text = String(message ?? '')
    if (/only super_admin may delete overtime data/i.test(text)) {
      return 'Anda hanya dapat menghapus data dari ULP sendiri yang belum disetujui. Muat ulang lalu coba lagi.'
    }
    if (/hanya pemilik data pada ulp sendiri/i.test(text)) {
      return 'Anda hanya dapat menghapus data dari ULP sendiri.'
    }
    if (/hanya lembur yang belum disetujui/i.test(text)) {
      return 'Data tidak dapat dihapus karena sudah disetujui atau sudah final.'
    }
    if (/sebagian peserta sudah disetujui/i.test(text)) {
      return 'Sebagian peserta sudah disetujui sehingga data tidak dapat dihapus.'
    }
    if (/alasan hapus wajib diisi/i.test(text)) {
      return 'Alasan hapus wajib diisi.'
    }
    if (/overtime activity is not available/i.test(text)) {
      return 'Data sudah tidak tersedia. Muat ulang daftar lembur.'
    }
    if (/authentication required|42501|not authorized|permission|scope/i.test(text)) {
      return 'Akun Anda tidak memiliki akses hapus untuk data lembur ini.'
    }
    if (/failed to fetch|networkerror|timeout|aborterror|http \d{3}/i.test(text)) {
      return 'Terjadi gangguan jaringan. Periksa koneksi lalu coba lagi.'
    }
    return text || 'Data Lembur gagal dihapus.'
  }

  const handleApprove = async (record)=>{
    if(!record) return
    const participantLabel = record.type === 'WORK' ? ` peserta ${record.participantName}` : ''
    if(!window.confirm(`Setujui pengajuan lembur${participantLabel} ini?`)) return
    setApprovalBusy(true)
    setApprovalError('')
    try{
      if (record.type === 'WORK' && record.entryId) await approveOvertimeEntry(record.entryId)
      else await approveOvertime(record.id)
      closeDetail()
      setToast('Lembur berhasil disetujui.')
      if(onRefresh) await onRefresh()
    }catch(e){ setApprovalError(friendlyApprovalError(e.message, 'Lembur gagal disetujui.')) } finally{ setApprovalBusy(false) }
  }
  const handleReject = async (record)=>{
    if(!record) return
    if(!rejectReason.trim()){ setApprovalError('Alasan penolakan wajib diisi.'); return }
    setApprovalBusy(true)
    setApprovalError('')
    try{
      const res = record.type === 'WORK' && record.entryId
        ? await rejectOvertimeEntry(record.entryId, rejectReason)
        : await rejectOvertime(record.id, rejectReason)
      closeDetail()
      setToast(res?.message || 'Lembur ditolak dan dikembalikan untuk revisi.')
      if(onRefresh) await onRefresh()
    }catch(e){ setApprovalError(friendlyApprovalError(e.message, 'Lembur gagal ditolak.')) } finally{ setApprovalBusy(false) }
  }

  const activityRowIds = (activityId) => records.filter((record) => record.id === activityId)
  const canDeleteRecord = (record) => {
    if (!record) return false
    if (isSuperAdmin) return true
    if (!canMutate) return false
    if (!['DRAFT', 'SUBMITTED', 'CORRECTION_REQUIRED'].includes(record.status)) return false
    return !activityRowIds(record.id).some((row) => recordReviewStatus(row) === 'APPROVED')
  }

  const handleDelete = async () => {
    if ((!isSuperAdmin && !canMutate) || !deleteTarget) return
    const reason = deleteReason.trim()
    if (!reason) { setDeleteError('Alasan hapus wajib diisi.'); return }
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await softDeleteOvertimeActivity(deleteTarget.id, reason)
      setDeleteTarget(null)
      setDeleteReason('')
      setToast('Data Lembur berhasil dihapus.')
      await onRefresh?.()
    } catch (error) {
      setDeleteError(friendlyDeleteError(error?.message))
    } finally {
      setDeleteBusy(false)
    }
  }

  const sorted = [...records].sort((a,b)=> String(b.startedAt).localeCompare(String(a.startedAt)))
  const jenisLabel = (record) => record.type==='WORK' ? (WORK_CATEGORIES[record.workCategory]?.label || record.workCategory) : (REPLACEMENT_TYPES[record.type]?.label || record.type)
  const uniquePeriods = [...new Set(sorted.map(r=> r.periodMonth || String(r.date||'').slice(0,7)))].filter(Boolean).sort()
  const uniqueStatuses = [...new Set(sorted.map(r=> displayStatus(r)))].filter(Boolean)
  // For UP management, unitLayanan filter currently maps 1:1 to UP3 Singkawang (only mapped). We derive options from orgUnits parent but keep simple for M4.
  const unitLayananOptions = isUpManagement ? [{ id: 'ul-singkawang', name: 'Unit Layanan Singkawang' }] : []
  const filtered = sorted.filter(r=>{
    if (filters.jenis !== 'Semua' && jenisLabel(r) !== filters.jenis) return false
    if (filters.status !== 'Semua' && displayStatus(r) !== filters.status) return false
    if (filters.pegawai && !String(r.participantName||'').toLowerCase().includes(filters.pegawai.toLowerCase())) return false
    if (filters.ulp && String(r.unitId||'') !== filters.ulp) return false
    if (filters.unitLayanan && isUpManagement) {
      // Currently only Singkawang mapped; any other selection yields no data (future multi-mapping will filter by UP3)
      if (filters.unitLayanan !== 'ul-singkawang') return false
    }
    if (filters.periode && String(r.periodMonth||'').slice(0,7) !== filters.periode && String(r.date||'').slice(0,7) !== filters.periode) return false
    return true
  })
  const exportExcel = () => {
    if (!filtered.length) {
      setMessage('Tidak ada data Rekap Lembur sesuai filter aktif untuk diexport.')
      return
    }
    const columns = [
      { label: 'No', width: 7 },
      { label: 'Tanggal', width: 14 },
      { label: 'Jenis Lembur', width: 24 },
      { label: 'Pegawai', width: 28 },
      { label: 'Waktu/Jam', width: 22 },
      { label: 'Durasi', width: 14 },
      { label: 'Total Rp', width: 18 },
      { label: 'Keterangan', width: 42 },
      { label: 'Status', width: 26 },
      { label: 'Unit/ULP', width: 28 },
    ]
    const rows = filtered.map((record, index) => {
      const time = pontianakFormValues(record.startedAt, record.endedAt)
      return [
        { value: String(index + 1) },
        { value: record.date ?? '', type: 'date' },
        { value: jenisLabel(record) },
        { value: record.participantName ?? '' },
        { value: `${time.startTime}-${time.endTime}${time.endTime <= time.startTime ? ' (+1 hari)' : ''}` },
        { value: formatDurationMinutes(Number(record.durationHours ?? 0) * 60) },
        { value: `Rp ${formatRp(record.total)}` },
        { value: record.description ?? '' },
        { value: displayStatus(record) },
        { value: getUlpName(record.unitId) ?? '' },
      ]
    })
    const periodKey = filters.periode || String(periodMonth ?? '').slice(0, 7) || String(filtered[0]?.date ?? '').slice(0, 7)
    const [year, month] = periodKey.split('-')
    const monthName = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][Number(month) - 1]
    const periodLabel = monthName && year ? `${monthName}_${year}` : 'Semua_Periode'
    downloadExportFile(buildTableXlsx(columns, rows, 'Rekap Lembur'), `rekap_lembur_${periodLabel}.xlsx`)
    setMessage(null)
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage))
  const paginated = filtered.slice((currentPage-1)*rowsPerPage, currentPage*rowsPerPage)
  useEffect(()=>{ setCurrentPage(1) }, [filters, rowsPerPage, records.length])
  useEffect(()=>{
    if (!detailActivityId) { setDetailEvidence([]); setDetailHistory([]); setDetailEvidenceUrls({}); setDetailFinancial([]); return }
    let cancelled=false
    setDetailLoading(true)
    Promise.all([
      import('../../data/overtimeEvidenceRepository.js').then(m=>m.listOvertimeEvidence(detailActivityId)),
      listOvertimeHistory(detailActivityId).catch(()=>[]),
      canViewFinancial ? import('../../data/overtimeReplacementRepository.js').then(m=>m.listOvertimeEntryFinancial(detailActivityId)).catch(()=>[]) : Promise.resolve([])
    ]).then(([evs, hist, fin])=>{ if(!cancelled){ setDetailEvidence(evs); setDetailHistory(hist||[]); setDetailFinancial(fin||[]) } }).catch(()=>{ if(!cancelled){ setDetailEvidence([]); setDetailHistory([]); setDetailFinancial([]) } }).finally(()=>{ if(!cancelled) setDetailLoading(false) })
    return ()=>{ cancelled=true }
  }, [detailActivityId, canViewFinancial])
  useEffect(() => {
    let cancelled = false
    const images = detailEvidence.filter((entry) => entry.status === 'ACTIVE' && isImageEvidence(entry))
    if (!images.length) {
      setDetailEvidenceUrls({})
      return undefined
    }
    import('../../data/overtimeEvidenceRepository.js')
      .then(async ({ createOvertimeEvidenceSignedUrl }) => Promise.all(images.map(async (entry) => {
        const signed = await createOvertimeEvidenceSignedUrl(entry.id)
        return [entry.id, signed.signedUrl]
      })))
      .then((urls) => { if (!cancelled) setDetailEvidenceUrls(Object.fromEntries(urls)) })
      .catch(() => { if (!cancelled) setDetailEvidenceUrls({}) })
    return () => { cancelled = true }
  }, [detailEvidence])
  const detailActivityRecords = detailActivityId ? sorted.filter(r=> r.id===detailActivityId) : []
  const detailEntryRecords = detailEntryId != null
    ? detailActivityRecords.filter(r=> r.entryId===detailEntryId)
    : detailActivityRecords
  const detailRecords = detailEntryRecords.length > 0 ? detailEntryRecords : detailActivityRecords
  const dedupedDetailHistory = (() => {
    const participantKeys = new Set(
      detailHistory
        .filter((h) => h.entry_id != null && ['APPROVED', 'REJECTED', 'CLOSED'].includes(h.event))
        .map((h) => `${h.event}|${h.occurred_at}`),
    )
    return detailHistory.filter((h) => {
      if (h.entry_id != null) return true
      if (!['APPROVED', 'REJECTED', 'CLOSED'].includes(h.event)) return true
      return !participantKeys.has(`${h.event}|${h.occurred_at}`)
    })
  })()
  const visibleDetailHistory = detailEntryId != null
    ? dedupedDetailHistory.filter((h) => h.entry_id == null || h.entry_id === detailEntryId)
    : dedupedDetailHistory
  const detailActivity = detailRecords[0] || null
  const detailIsSingleParticipant = detailEntryId != null && detailActivityRecords.length > 1
  const detailApprovalKey = detailActivity ? `${detailActivity.id}:${detailActivity.entryId ?? 'activity'}` : ''
  const detailCanApprove = detailActivity && recordReviewStatus(detailActivity) === 'SUBMITTED' && detailRecords.length === 1

  const changeType = (type) => {
    if (activeActivityId && evidence.length && type!==draft.lemburType) {
      setMessage('Hapus evidence Draft sebelum mengubah Jenis Lembur.')
      return
    }
    if (type.startsWith('WORK:')) {
      const cat = type.split(':')[1]
      setDraft(c=>({ ...c, lemburType: type, description: c.description, workTitle: c.workTitle, workLocation: c.workLocation, participants: cat==='ADMINISTRASI' ? [{ tempId:'p1', employeeId:'', startTime:'08:00', endTime:'16:00'}] : [{ tempId:'p1', employeeId:'', startTime:'18:00', endTime:'22:00'}] }))
    } else {
      setDraft(c=>({ ...c, lemburType: type }))
    }
    releaseStagedFiles()
    setFiles({})
    setDirty(true)
    setMessage(null)
  }

  const chooseMainType = (type) => {
    if (type === 'WORK') {
      setFormStep('work')
      return
    }
    changeType(type)
    setFormStep('form')
  }

  const chooseWorkType = (category) => {
    changeType(`WORK:${category}`)
    setFormStep('form')
  }

  const addParticipant = () => {
    setDraft(c=>({ ...c, participants: [...c.participants, { tempId:`p${Date.now()}`, employeeId:'', startTime:'18:00', endTime:'22:00'}] }))
    setDirty(true)
  }
  const updateParticipant = (tempId, patch) => {
    setDraft(c=>({ ...c, participants: c.participants.map(p=> p.tempId===tempId ? { ...p, ...patch } : p)}))
    setDirty(true)
  }
  const removeParticipant = (tempId) => {
    setDraft(c=>({ ...c, participants: c.participants.filter(p=>p.tempId!==tempId)}))
    setDirty(true)
  }

  const getUlpName = (unitId) => {
    if (!orgUnits) return unitId
    const found = orgUnits.find(u=>u.uuid===unitId || u.legacyKey===unitId)
    return found?.displayName || unitId
  }

  const currentTypeLabel = isWork
    ? WORK_CATEGORIES[workCategory]?.label
    : REPLACEMENT_TYPES[draft.lemburType]?.label
  const activeDetailEvidence = detailEvidence.filter((entry) => entry.status === 'ACTIVE')
  const photoDetailEvidence = activeDetailEvidence.filter(isImageEvidence)
  const ulpCount = (orgUnits ?? []).filter((unit) => unit.type === 'ULP').length
  const up3ScopeName = (orgUnits ?? []).find((unit) => unit.uuid === up3Id || unit.legacyKey === up3Id)?.displayName
  const showUlpColumn = isSuperAdmin || isManagement || !canMutate
  const deleteTargetRows = deleteTarget ? records.filter((record) => record.id === deleteTarget.id) : []
  const deleteParticipants = [...new Set(deleteTargetRows.map((record) => record.participantName).filter(Boolean))]
  const deleteTotal = deleteTargetRows.reduce((total, record) => total + Number(record.total ?? 0), 0)

  return (
    <section className="sla-module-panel lembur-l2">
      <div className="lembur-landing-header">
        <div>
          <span className="lembur-kicker">Workspace Operasional</span>
          <h1>LEMBUR</h1>
          <p>Pengajuan dan monitoring lembur pegawai</p>
        </div>
        <div className="lembur-landing-actions">
          {(up3ScopeName || contractScope.region || ulpCount > 0) && <span className="lembur-scope-badge">{up3ScopeName ?? contractScope.region ?? 'Scope UP3'} · {ulpCount} ULP</span>}
          {canMutate && <Button variant="primary" onClick={openNewForm}>+ Tambah Lembur</Button>}
        </div>
      </div>
      {toast && <div className="lembur-toast" role="status"><Icon name="check-circle" size={17} />{toast}</div>}
      {loadError ? (
        <StatePanel state="error" title="Data lembur gagal dimuat" action={<Button variant="secondary" onClick={onRetry}>Coba Lagi</Button>}>{loadError}</StatePanel>
      ) : loading ? (
        <StatePanel state="loading" title="Memuat data lembur" />
      ) : (
        <>
          {!formOpen && message && <Alert tone="info" className="lembur-landing-message">{message}</Alert>}
          {canMutate && formOpen && (
            <div className="rekap-detail-overlay lembur-form-overlay" onMouseDown={(event)=>{ if(event.target===event.currentTarget) closeForm() }}>
            <div className={`lembur-form-card ${formStep === 'form' ? 'lembur-form-modal-wide' : 'lembur-picker-modal'}`} onMouseDown={(event)=>event.stopPropagation()}>
              {formStep === 'main' ? (
                <>
                   <div className="lembur-modal-header">
                     <div><h2>Tambah Lembur</h2><p>Pilih jenis lembur yang akan diajukan</p></div>
                     <IconButton label="Tutup" className="lembur-icon-button" onClick={closeForm}><Icon name="close" size={17} /></IconButton>
                   </div>
                   <div className="lembur-type-grid">
                     <button type="button" className="lembur-type-card" onClick={()=>chooseMainType('REPLACEMENT_LEAVE')}><Icon name="clock" size={18} /><strong>Pengganti Cuti</strong><span>Pegawai menggantikan petugas yang cuti</span></button>
                     <button type="button" className="lembur-type-card" onClick={()=>chooseMainType('REPLACEMENT_SICK')}><Icon name="clock" size={18} /><strong>Pengganti Sakit</strong><span>Pegawai menggantikan petugas yang sakit</span></button>
                     <button type="button" className="lembur-type-card" onClick={()=>chooseMainType('REPLACEMENT_PERMISSION')}><Icon name="clock" size={18} /><strong>Pengganti Izin</strong><span>Pegawai menggantikan petugas yang izin</span></button>
                     <button type="button" className="lembur-type-card" onClick={()=>chooseMainType('WORK')}><Icon name="operations" size={18} /><strong>Lembur Pekerjaan</strong><span>Lembur untuk pelaksanaan pekerjaan tertentu</span></button>
                   </div>
                </>
              ) : formStep === 'work' ? (
                <>
                   <div className="lembur-modal-header">
                     <div><h2>Pilih Jenis Pekerjaan</h2><p>Tentukan kategori pekerjaan lembur</p></div>
                     <IconButton label="Tutup" className="lembur-icon-button" onClick={closeForm}><Icon name="close" size={17} /></IconButton>
                   </div>
                   <div className="lembur-type-grid lembur-work-type-grid">
                     {Object.entries(WORK_CATEGORIES).map(([category, config])=><button type="button" className="lembur-type-card" key={category} onClick={()=>chooseWorkType(category)}><Icon name="operations" size={18} /><strong>{config.label}</strong><span>Lembur pekerjaan {config.label.toLowerCase()}</span></button>)}
                   </div>
                   <Button variant="ghost" className="lembur-back-button" onClick={()=>setFormStep('main')}>← Kembali</Button>
                </>
              ) : (
              <>
              <div className="lembur-form-heading">
                 <div><span className="lembur-kicker">{activeActivityId ? 'Lanjutkan Draft' : 'Tambah Lembur'}</span><h2>{currentTypeLabel}</h2></div>
                 <div className="lembur-heading-actions">
                   {!activeActivityId && <Button variant="ghost" size="small" disabled={submitting} onClick={()=>setFormStep(isWork ? 'work' : 'main')}>← Ubah Jenis</Button>}
                   {activeActivityId && <Button variant="secondary" size="small" disabled={submitting} onClick={openNewForm}>Draft Baru</Button>}
                   <IconButton label="Tutup" className="lembur-icon-button" onClick={closeForm}><Icon name="close" size={17} /></IconButton>
                 </div>
              </div>

              <fieldset disabled={formReadOnly} className="lembur-form-fieldset">
                <div className={`lembur-form-workspace ${formLayoutClass}`}>
                <div className="lembur-form-left">
                 <section className="lembur-form-section">
                  <div className="lembur-section-heading"><span>A</span><div><h3>Informasi Lembur</h3><p>Jenis, tanggal, dan keterangan pengajuan</p></div></div>
                   <div className={`lembur-form-grid ${formLayoutClass}`}>
                     <div className="sla-context-field"><span className="sla-context-label">Jenis Lembur</span><div className="lembur-readonly-value">{currentTypeLabel}</div></div>
                     <label className="sla-context-field"><span className="sla-context-label">Tanggal Lembur *</span><input type="date" className="sla-context-select" value={draft.date} onChange={e=>updateDraft({ date:e.target.value })} /></label>
                     {isMultiWork && <><label className="sla-context-field"><span className="sla-context-label">Uraian / Nama Pekerjaan *</span><input className="sla-context-select" value={draft.workTitle} onChange={e=>updateDraft({ workTitle:e.target.value })} placeholder={WORK_TITLE_PLACEHOLDERS[workCategory] ?? 'Contoh: Nama pekerjaan'} /></label><label className="sla-context-field"><span className="sla-context-label">Lokasi *</span><input className="sla-context-select" value={draft.workLocation} onChange={e=>updateDraft({ workLocation:e.target.value })} placeholder="Contoh: Desa Sungai Raya" /></label></>}
                      {isWork && <label className="sla-context-field lembur-grid-full"><span className="sla-context-label">Keterangan Pekerjaan *</span><textarea className="sla-context-select" value={draft.description} onChange={e=>updateDraft({ description:e.target.value })} placeholder="Jelaskan pekerjaan lembur" rows={2} /></label>}
                     {replacementDescription && <div className="lembur-description-preview lembur-grid-full"><span>Keterangan otomatis</span>{replacementDescription}</div>}
                        {draft.date && !isRevision && !deadlineReady && deadlineLoadStatus !== 'error' && (
                          <Alert tone="info" className="lembur-deadline-helper">Memverifikasi batas pengajuan dari server...</Alert>
                        )}
                        {draft.date && !isRevision && deadlineLoadStatus === 'error' && (
                          <Alert tone="danger" title="Batas pengajuan tidak dapat diverifikasi" className="lembur-deadline-card">{deadlineLoadError} <button type="button" className="sla-btn" onClick={() => setDeadlineReloadToken((value) => value + 1)}>Coba lagi</button></Alert>
                        )}
                        {draft.date && !isRevision && deadlineReady && (initialDeadlinePassed ? (
                          <Alert tone="danger" title="Batas pengajuan telah lewat" className="lembur-deadline-card">{initialDeadlineMessage(draft.date, deadlineInfo)} Pilih tanggal yang masih dalam batas H+{deadlineInfo.effectiveSubmissionDays}.</Alert>
                        ) : <Alert tone="info" className="lembur-deadline-helper">Batas pengajuan H+{deadlineInfo.effectiveSubmissionDays}: {formatPontianakDate(initialDeadline)}, pukul 23:59 WITA{deadlineInfo.temporaryIsActive ? ' · toleransi sementara aktif' : ''}</Alert>)}
                       {activeRevisionExpired && <Alert tone="danger" title="Batas revisi telah lewat" className="lembur-deadline-card">Transaksi Lembur sudah kedaluwarsa.</Alert>}
                  </div>
                </section>

                <section className="lembur-form-section">
                  <div className="lembur-section-heading"><span>B</span><div><h3>Pegawai & Waktu</h3><p>Peserta, jam kerja, dan durasi otomatis</p></div></div>
                  {isReplacement && <div className="lembur-time-grid is-replacement">
                    <label className="sla-context-field"><span className="sla-context-label">Pegawai yang Digantikan *</span><select className="sla-context-select" value={draft.replacedEmployeeId} disabled={employeeLoading} onChange={e=>updateDraft({ replacedEmployeeId:e.target.value, participantEmployeeId:'' })}><option value="">{employeeLoading ? 'Memuat pegawai...' : 'Pilih pegawai'}</option>{employeeOptions.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}</select></label>
                    <label className="sla-context-field"><span className="sla-context-label">Pegawai Pengganti *</span><select className="sla-context-select" value={draft.participantEmployeeId} disabled={!replacedEmployee} onChange={e=>updateDraft({ participantEmployeeId:e.target.value })}><option value="">Pilih pegawai pengganti</option>{participantOptions.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}</select></label>
                    <label className="sla-context-field"><span className="sla-context-label">Jam Mulai *</span><input type="time" className="sla-context-select" value={draft.startTime} onChange={e=>updateDraft({ startTime:e.target.value })} /></label>
                    <label className="sla-context-field"><span className="sla-context-label">Jam Selesai *</span><input type="time" className="sla-context-select" value={draft.endTime} onChange={e=>updateDraft({ endTime:e.target.value })} /></label>
                    <div className="lembur-duration-compact"><span>Durasi</span><strong>{range ? formatDurationMinutes(range.durationMinutes) : '–'}</strong>{draft.endTime <= draft.startTime && <small>+1 hari</small>}</div>
                  </div>}
                  {isAdministrasi && (()=>{ const participant=draft.participants[0]; const participantRange=buildPontianakRange(draft.date, participant?.startTime||draft.startTime, participant?.endTime||draft.endTime); return <div className="lembur-time-grid is-single"><label className="sla-context-field"><span className="sla-context-label">Pegawai Lembur *</span><select className="sla-context-select" value={participant?.employeeId || ''} disabled={employeeLoading} onChange={e=>updateParticipant(participant.tempId,{employeeId:e.target.value})}><option value="">{employeeLoading?'Memuat pegawai...':'Pilih pegawai'}</option>{employeeOptions.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}</select></label><label className="sla-context-field"><span className="sla-context-label">Jam Mulai *</span><input type="time" className="sla-context-select" value={participant?.startTime||draft.startTime} onChange={e=>updateParticipant(participant.tempId,{startTime:e.target.value})} /></label><label className="sla-context-field"><span className="sla-context-label">Jam Selesai *</span><input type="time" className="sla-context-select" value={participant?.endTime||draft.endTime} onChange={e=>updateParticipant(participant.tempId,{endTime:e.target.value})} /></label><div className="lembur-duration-compact"><span>Durasi</span><strong>{participantRange?formatDurationMinutes(participantRange.durationMinutes):'–'}</strong>{participant?.endTime<=participant?.startTime&&<small>+1 hari</small>}</div></div>})()}
                   {isMultiWork && <div className="lembur-participants"><div className="lembur-participants-heading"><strong>Peserta Lembur</strong><Button variant="secondary" size="small" onClick={addParticipant}>+ Tambah Pegawai</Button></div><div className="lembur-participant-labels"><span>Pegawai</span><span>Jam Mulai</span><span>Jam Selesai</span><span>Durasi</span><span></span></div>{draft.participants.map((participant)=>{ const participantRange=buildPontianakRange(draft.date,participant.startTime,participant.endTime); const otherIds=draft.participants.filter(item=>item.tempId!==participant.tempId).map(item=>item.employeeId); const options=employeeOptions.filter(employee=>!otherIds.includes(employee.id)); return <div key={participant.tempId} className="lembur-participant-row"><select className="sla-context-select" value={participant.employeeId} disabled={employeeLoading} onChange={e=>updateParticipant(participant.tempId,{employeeId:e.target.value})}><option value="">{employeeLoading?'Memuat...':'Pilih pegawai'}</option>{options.map(employee=><option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><input type="time" className="sla-context-select" value={participant.startTime} onChange={e=>updateParticipant(participant.tempId,{startTime:e.target.value})} /><input type="time" className="sla-context-select" value={participant.endTime} onChange={e=>updateParticipant(participant.tempId,{endTime:e.target.value})} /><strong>{participantRange?formatDurationMinutes(participantRange.durationMinutes):'–'}</strong>{draft.participants.length>1?<IconButton label="Hapus peserta" className="lembur-row-remove" onClick={()=>removeParticipant(participant.tempId)}><Icon name="close" size={15} /></IconButton>:<span />}</div>})}</div>}
                </section>

                </div>
                 <section className="lembur-form-section lembur-evidence-section">
                   <div className="lembur-section-heading"><span>C</span><div><h3>Evidence</h3><p>Upload foto JPG/JPEG, PNG, atau WebP. Foto akan dikompres otomatis, lalu klik Simpan Draft atau Ajukan Lembur.{activeHasApproved && ' Evidence dikunci karena sebagian peserta sudah disetujui.'}</p></div></div>
                  <div className="lembur-upload-grid">{evidenceRequirements.map((requirement)=>{ const existingList=(evidenceByType[requirement.type]||[]).filter(entry=>entry.status==='ACTIVE'); const stagedList=files[requirement.type]??[]; const hasTimeMark=requirement.helpers?.[0]==='TimeMark Wajib'; return <div className="lembur-upload-card" key={requirement.type}><div className="lembur-upload-card-heading"><strong>{requirement.label} *</strong>{hasTimeMark&&<span className="lembur-timemark-badge">TimeMark Wajib</span>}</div>{requirement.helpers?.slice(hasTimeMark?1:0).map((helper)=><small key={helper}>{helper}</small>)}<label className="lembur-dropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();stageEvidence(requirement,Array.from(e.dataTransfer.files ?? []))}}><input key={`${requirement.type}-${stagedList.length}-${existingList.length}`} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple={!!requirement.allowMultiple} disabled={submitting||initialDeadlinePassed||formReadOnly||activeHasApproved} onChange={e=>stageEvidence(requirement,Array.from(e.target.files ?? []))} /><span className="lembur-upload-icon">↑</span><strong>Pilih atau tarik foto ke sini</strong><small>JPG/PNG/WebP · dikompres otomatis maks. 1 MB{requirement.allowMultiple ? ' · minimal 1 foto, dapat lebih dari 1' : ''}{requirement.allowMultiple && (stagedList.length + existingList.length) > 0 ? ` · ${stagedList.length + existingList.length} foto` : ''}</small></label><div className="lembur-selected-files">{stagedList.map((entry)=><div className="lembur-selected-file" key={entry.id}>{entry.previewUrl?<img src={entry.previewUrl} alt="" />:<span className="lembur-doc-icon">DOC</span>}<div><strong>{entry.processed.original.filename}</strong><small>{Math.ceil(entry.processed.stored.sizeBytes/1024)} KB · siap disimpan</small></div><button type="button" className="sla-btn" disabled={submitting||formReadOnly||activeHasApproved} onClick={()=>removeStagedEvidence(requirement.type,entry.id)}>Hapus</button></div>)}{existingList.map((entry)=><div className="lembur-selected-file" key={entry.id}>{isImageEvidence(entry)&&evidenceUrls[entry.id]?<button type="button" className="lembur-thumb-button" onClick={()=>previewEvidence(entry,existingList)}><img src={evidenceUrls[entry.id]} alt={entry.originalFilename} /></button>:<span className="lembur-doc-icon">DOC</span>}<div><strong>{entry.originalFilename}</strong><small>{(entry.storedSizeBytes/1024).toFixed(0)} KB · tersimpan</small></div><button type="button" className="sla-btn" onClick={()=>previewEvidence(entry,existingList)}>Preview</button><button type="button" className="sla-btn" disabled={submitting||formReadOnly} onClick={()=>removeEvidence(entry)}>Hapus</button></div>)}</div></div>})}</div>
                 </section>
                </div>

                 {message && !(initialDeadlinePassed && message.startsWith('Batas pengajuan')) && <Alert tone="info" className="lembur-message">{message}</Alert>}
                  <div className="lembur-form-actions"><Button variant="secondary" disabled={submitting||initialDeadlinePassed||deadlineUnavailable||formReadOnly} onClick={saveDraft}>{isSubmitting?'Memproses...':'Simpan Draft'}</Button><div className="lembur-form-actions-right"><Button variant="ghost" onClick={closeForm}>Batal</Button><Button variant="primary" disabled={submitting||initialDeadlinePassed||deadlineUnavailable||formReadOnly||!evidenceComplete} onClick={submitDraft}>Ajukan Lembur</Button></div></div>
              </fieldset>
              </>
              )}
            </div>
            </div>
          )}

          {!canMutate && !isManagement && <Alert tone="info" className="lembur-readonly-notice">Monitoring read-only · Rekap Lembur dalam scope UP3. Input dan approval tidak tersedia.</Alert>}
          {isUlManagement && <Alert tone="info" className="lembur-readonly-notice">Unit Layanan Singkawang · 6 ULP · monitoring read-only. Total Rp, Tarif/Jam, dan rincian 1.5x/2x tersedia di Detail.</Alert>}
          {isUpManagement && <Alert tone="info" className="lembur-readonly-notice">Unit Pelaksana Kalimantan 1 · 1 Unit Layanan terhubung (Singkawang) · monitoring read-only.</Alert>}
          {isManagement && !records.length && !loading && !loadError && (
            <Alert tone="warning">Belum ada Unit Layanan yang terhubung dengan scope Pelayanan Teknik untuk akun ini.</Alert>
          )}

          <FilterBar className="lembur-filter-bar">
            <FilterField label="Periode" className="lembur-filter-field">
              <Select value={filters.periode} onChange={e=> setFilters(f=>({ ...f, periode: e.target.value }))}>
                <option value="">Semua</option>
                {uniquePeriods.map(p=> <option key={p} value={p.slice(0,7)}>{p}</option>)}
              </Select>
            </FilterField>
            {isUpManagement && (
              <FilterField label="Unit Layanan" className="lembur-filter-field">
                <Select value={filters.unitLayanan} onChange={e=> setFilters(f=>({ ...f, unitLayanan: e.target.value }))}>
                  <option value="">Semua</option>
                  {unitLayananOptions.map(u=> <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </FilterField>
            )}
            {showUlpColumn && (
              <FilterField label="ULP" className="lembur-filter-field">
                <Select value={filters.ulp} onChange={e=> setFilters(f=>({ ...f, ulp: e.target.value }))}>
                  <option value="">Semua</option>
                  {(orgUnits||[]).filter(u=>u.type==='ULP' || u.type==='ULP').map(u=> <option key={u.uuid} value={u.uuid}>{u.displayName}</option>)}
                </Select>
              </FilterField>
            )}
            <FilterField label="Jenis" className="lembur-filter-field">
              <Select value={filters.jenis} onChange={e=> setFilters(f=>({ ...f, jenis: e.target.value }))}>
                <option value="Semua">Semua</option>
                <option value="Pengganti Cuti">Pengganti Cuti</option>
                <option value="Pengganti Sakit">Pengganti Sakit</option>
                <option value="Pengganti Izin">Pengganti Izin</option>
                {Object.values(WORK_CATEGORIES).map((category)=><option key={category.label} value={category.label}>{category.label}</option>)}
              </Select>
            </FilterField>
            <FilterField label="Pegawai" className="lembur-filter-field lembur-filter-search">
              <SearchInput value={filters.pegawai} onChange={e=> setFilters(f=>({ ...f, pegawai: e.target.value }))} placeholder="Cari pegawai" />
            </FilterField>
            <FilterField label="Status" className="lembur-filter-field">
              <Select value={filters.status} onChange={e=> setFilters(f=>({ ...f, status: e.target.value }))}>
                <option value="Semua">Semua</option>
                {uniqueStatuses.map(s=> <option key={s} value={s}>{s}</option>)}
              </Select>
            </FilterField>
          </FilterBar>

          <div className="lembur-rekap-heading"><span className="lembur-kicker">Rekap Lembur</span><div className="lembur-rekap-actions"><strong>{filtered.length} baris pegawai</strong><Button variant="secondary" size="small" onClick={exportExcel}>Export Excel</Button></div></div>

          <div className="sla-table-wrap lembur-table-wrap">
            <table className="sla-table lembur-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  {showUlpColumn && <th>ULP</th>}
                  <th>Jenis</th><th>Pegawai</th><th>Waktu/Jam</th><th>Total Rp</th><th>Keterangan</th><th>Status</th><th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {!paginated.length && <tr><td colSpan={showUlpColumn ? 9 : 8}>Belum ada record Lembur pada periode ini.</td></tr>}
                {paginated.map(record=>{
                  const time = pontianakFormValues(record.startedAt, record.endedAt)
                  const jenis = record.type==='WORK' ? (WORK_CATEGORIES[record.workCategory]?.label || record.workCategory) : (REPLACEMENT_TYPES[record.type]?.label || record.type)
                  const ulpName = showUlpColumn ? getUlpName(record.unitId) : null
                  const status = recordReviewStatus(record)
                  const canEdit = status==='DRAFT' || status==='CORRECTION_REQUIRED'
                  const isExpired = recordIsExpired(record)
                  const display = displayStatus(record)
                  return (
                    <tr key={`${record.id}-${record.entryId}`}>
                      <td>{record.date}</td>
                      {showUlpColumn && <td>{ulpName}</td>}
                      <td>{jenis}</td>
                      <td>{record.participantName}</td>
                      <td className="lembur-table-time">{time.startTime}–{time.endTime}{time.endTime <= time.startTime ? ' (+1 hari)' : ''} · {formatDurationMinutes(record.durationHours*60)}</td>
                      <td className="lembur-table-money">Rp {formatRp(record.total)}</td>
                      <td><span className="rekap-keterangan">{record.description}</span></td>
                      <td className="lembur-table-status"><StatusBadge status={statusBadgeKey(record)} tone={statusTone(record)}>{display}</StatusBadge>{status==='CORRECTION_REQUIRED' && record.revisionDeadlineAt && <div className="lembur-revision-meta"><small>Batas: {new Date(record.revisionDeadlineAt).toLocaleString('id-ID', { timeZone: 'Asia/Pontianak' })}</small>{record.rejectionCount===2 && <strong>REVISI TERAKHIR</strong>}</div>}</td>
                      <td className="lembur-table-actions-cell">
                        <div className="lembur-table-actions">
                          {canMutate && canEdit && !isExpired && <Button variant="secondary" size="small" disabled={isSubmitting} onClick={()=>editDraft(record)}>Lanjutkan Draft</Button>}
                           <Button variant="secondary" size="small" onClick={()=>openDetail(record)}>Lihat Detail</Button>
                           {canDeleteRecord(record) && <Button variant="danger" size="small" disabled={deleteBusy} onClick={()=>{setDeleteTarget(record);setDeleteReason('');setDeleteError('')}}>Hapus</Button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {(isSuperAdmin || canMutate) && deleteTarget && (
            <div className="rekap-detail-overlay" onClick={()=>{if(!deleteBusy){setDeleteTarget(null);setDeleteReason('');setDeleteError('')}}}>
              <div className="rekap-detail-modal lembur-delete-modal" role="dialog" aria-modal="true" aria-labelledby="lembur-delete-title" onClick={event=>event.stopPropagation()}>
                <div className="lembur-delete-header"><div><span className="lembur-kicker">{isSuperAdmin ? 'SUPER ADMIN' : 'ADMIN ULP'}</span><h2 id="lembur-delete-title">Hapus Data Lembur</h2></div><IconButton label="Tutup" className="lembur-icon-button" disabled={deleteBusy} onClick={()=>{setDeleteTarget(null);setDeleteReason('');setDeleteError('')}}><Icon name="close" size={17} /></IconButton></div>
                <Alert tone="danger" title="Konfirmasi soft delete">Data akan hilang dari Rekap Lembur normal, tetapi audit dan evidence tetap tersimpan.{deleteTargetRows.length > 1 && ` Seluruh ${deleteTargetRows.length} peserta dalam form ini ikut dihapus.`}</Alert>
                <dl className="lembur-delete-summary"><div><dt>Jenis</dt><dd>{jenisLabel(deleteTarget)}</dd></div><div><dt>Tanggal</dt><dd>{deleteTarget.date}</dd></div><div><dt>Peserta</dt><dd>{deleteParticipants.join(', ') || '-'}</dd></div><div><dt>Total</dt><dd>Rp {formatRp(deleteTotal)}</dd></div><div><dt>Keterangan</dt><dd>{deleteTarget.description}</dd></div></dl>
                <label className="sla-context-field"><span className="sla-context-label">Alasan Hapus *</span><textarea className="sla-context-select" rows={3} value={deleteReason} disabled={deleteBusy} onChange={event=>{setDeleteReason(event.target.value);setDeleteError('')}} placeholder="Jelaskan alasan penghapusan data Lembur" /></label>
                {deleteError && <Alert tone="danger">{deleteError}</Alert>}
                <div className="lembur-delete-actions"><Button variant="ghost" disabled={deleteBusy} onClick={()=>{setDeleteTarget(null);setDeleteReason('');setDeleteError('')}}>Batal</Button><Button variant="danger" disabled={deleteBusy||!deleteReason.trim()} onClick={handleDelete}>{deleteBusy?'Menghapus...':'Hapus Data'}</Button></div>
              </div>
            </div>
          )}
          <div className="rekap-pagination">
            <span>{filtered.length} data · Halaman {currentPage} dari {totalPages}</span>
            <div className="lembur-pagination-actions">
              <Button variant="secondary" size="small" disabled={currentPage<=1} onClick={()=>setCurrentPage(p=>Math.max(1,p-1))}>Prev</Button>
              <Button variant="secondary" size="small" disabled={currentPage>=totalPages} onClick={()=>setCurrentPage(p=>Math.min(totalPages,p+1))}>Next</Button>
              <label>Baris per halaman
                <select className="sla-context-select lembur-page-size" value={rowsPerPage} onChange={e=>setRowsPerPage(Number(e.target.value))}>
                  <option value={10}>10</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                </select>
              </label>
            </div>
          </div>
          {detailActivityId && (
            <div className="rekap-detail-overlay" data-approval-id={detailActivityId} onClick={closeDetail}>
              <div className="rekap-detail-modal lembur-detail-modal" onClick={e=>e.stopPropagation()}>
                {detailActivity && (
                  <>
                     <div className="lembur-detail-header">
                       <div><span className="lembur-kicker">Detail Lembur{detailIsSingleParticipant ? ` · ${detailActivity.participantName}` : ''}</span><h2>{jenisLabel(detailActivity)}</h2><p>{showUlpColumn ? `${getUlpName(detailActivity.unitId)} · ` : ''}{detailActivity.date}{detailIsSingleParticipant ? ` · 1 dari ${detailActivityRecords.length} peserta` : ''}</p></div>
                       <div className="lembur-detail-header-actions"><StatusBadge status={statusBadgeKey(detailActivity)} tone={statusTone(detailActivity)}>{displayStatus(detailActivity)}</StatusBadge><IconButton label="Tutup" className="lembur-icon-button" onClick={closeDetail}><Icon name="close" size={17} /></IconButton></div>
                     </div>
                     {detailActivity.revisionDeadlineAt && recordReviewStatus(detailActivity)==='CORRECTION_REQUIRED' && <Alert tone="warning" title="Batas Revisi" className="lembur-detail-alert"><span>{new Date(detailActivity.revisionDeadlineAt).toLocaleString('id-ID',{timeZone:'Asia/Pontianak'})} · sisa {Math.max(0,Math.ceil((new Date(detailActivity.revisionDeadlineAt)-new Date())/3600000))} jam</span>{detailActivity.rejectionCount===2&&<small>Revisi terakhir. Jika ditolak kembali, status menjadi Ditolak Final.</small>}</Alert>}
                    <section className="lembur-detail-section">
                      <h3>Pegawai & Waktu</h3>
                      <div className="lembur-detail-table-wrap"><table className="sla-table">
                        <thead><tr><th>Pegawai</th><th>Waktu/Jam</th><th>Total Rp</th>{canViewFinancial && <th>Tarif/Jam</th>}{canViewFinancial && <th>Rincian</th>}</tr></thead>
                        <tbody>
                          {detailRecords.map(r=>{
                            const t = pontianakFormValues(r.startedAt, r.endedAt)
                            const fin = detailFinancial.find(f=>f.entryId===r.entryId)
                            return <tr key={r.entryId}><td>{r.participantName}</td><td>{t.startTime}–{t.endTime} · {formatDurationMinutes(r.durationHours*60)}</td><td>Rp {formatRp(r.total)}</td>{canViewFinancial && <td>{fin ? `Rp ${formatRp(fin.hourlyRate)}/jam` : '—'}</td>}{canViewFinancial && <td>{fin ? `${fin.durationHours.toFixed(2)} jam · ${fin.multiplierHours.toFixed(2)} jam × Rp ${formatRp(fin.hourlyRate)} = Rp ${formatRp(fin.total)}` : '—'}</td>}</tr>
                          })}
                        </tbody>
                      </table></div>
                    </section>
                    <section className="lembur-detail-section"><h3>Keterangan</h3><div className="lembur-detail-description">{detailActivity.workTitle&&<strong>{detailActivity.workTitle}</strong>}{detailActivity.workLocation&&<span>{detailActivity.workLocation}</span>}<p>{detailActivity.description}</p></div></section>
                    <section className="lembur-detail-section"><h3>Evidence</h3>{detailLoading?<div className="lembur-detail-empty">Memuat evidence...</div>:activeDetailEvidence.length?<div className="lembur-detail-evidence-grid">{activeDetailEvidence.map((entry)=>isImageEvidence(entry)?<button type="button" className="lembur-detail-photo" key={entry.id} onClick={()=>previewEvidence(entry,photoDetailEvidence)}>{detailEvidenceUrls[entry.id]?<img src={detailEvidenceUrls[entry.id]} alt={entry.originalFilename} />:<span className="lembur-evidence-loading">Memuat foto...</span>}<span><strong>{evidenceLabel(entry.evidenceType)}</strong><small>{entry.originalFilename} · {(entry.storedSizeBytes/1024).toFixed(0)} KB</small></span></button>:<button type="button" className="lembur-detail-document" key={entry.id} onClick={()=>previewEvidence(entry)}><span className="lembur-doc-icon">DOC</span><span><strong>{evidenceLabel(entry.evidenceType)}</strong><small>{entry.originalFilename} · {(entry.storedSizeBytes/1024).toFixed(0)} KB</small></span><b>Preview</b></button>)}</div>:<div className="lembur-detail-empty">Belum ada evidence.</div>}</section>
                    <section className="lembur-detail-section"><h3>Riwayat{detailEntryId != null && detailActivityRecords.length > 1 ? ` · ${detailActivity?.participantName ?? ''}` : ''}</h3>
                      {visibleDetailHistory.length ? (
                        <div className="lembur-history-timeline">
                          {visibleDetailHistory.map(h=>(
                            <div key={h.id} className="lembur-history-item">
                              <span className="lembur-history-dot" /><div><small>{new Date(h.occurred_at).toLocaleString('id-ID',{timeZone:'Asia/Pontianak'})} · {h.actor_user_id?.slice(0,8)}</small><strong>{h.event}</strong><p>{h.previous_status} → {h.new_status}{h.reason&&` · ${h.reason}`}</p>{h.notes&&<p>{h.notes}</p>}</div>
                            </div>
                          ))}
                        </div>
                      ) : <div className="lembur-detail-empty">Belum ada riwayat.</div>}
                    </section>
                     {(isAdminUp3||isSuperAdmin) && detailCanApprove && (
                       <section className="lembur-detail-section lembur-approval-section"><h3>Approval</h3>{detailActivity.type==='WORK'&&<p className="lembur-approval-scope-note">Persetujuan berlaku hanya untuk peserta ini: {detailActivity.participantName}.</p>}{approvalError&&<Alert tone="danger" className="lembur-approval-alert">{approvalError}</Alert>}{showReject===detailApprovalKey&&<div className="lembur-reject-box"><label className="sla-context-field"><span className="sla-context-label">Alasan Penolakan *</span><textarea className="sla-context-select" rows={3} value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="Jelaskan bagian yang perlu diperbaiki" /></label><div><Button variant="ghost" disabled={approvalBusy} onClick={()=>{setShowReject(null);setRejectReason('');setApprovalError('')}}>Batal</Button><Button variant="danger" disabled={approvalBusy||!rejectReason.trim()} onClick={()=>handleReject(detailActivity)}>{approvalBusy?'Memproses...':'Kirim Penolakan'}</Button></div></div>}<div className="lembur-approval-actions"><Button variant="danger" disabled={approvalBusy} onClick={()=>{setShowReject(detailApprovalKey);setApprovalError('')}}>Tolak</Button><Button variant="primary" disabled={approvalBusy} onClick={()=>handleApprove(detailActivity)}>{approvalBusy?'Memproses...':'Setujui'}</Button></div></section>
                      )}
                     {(isAdminUp3||isSuperAdmin) && !detailCanApprove && recordReviewStatus(detailActivity)==='SUBMITTED' && detailRecords.length>1 && <Alert tone="info" className="lembur-approval-alert">Buka detail dari baris peserta tertentu untuk menyetujui atau menolak per peserta.</Alert>}
                  </>
                )}
              </div>
            </div>
          )}
          {evidencePreview && <div className="lembur-preview-overlay" onClick={()=>setEvidencePreview(null)}><div className="lembur-preview-modal" onClick={event=>event.stopPropagation()}><div className="lembur-preview-header"><div><strong>{evidenceLabel(evidencePreview.entry.evidenceType)}</strong><span>{evidencePreview.entry.originalFilename}</span></div><IconButton label="Tutup preview" className="lembur-icon-button" onClick={()=>setEvidencePreview(null)}><Icon name="close" size={17} /></IconButton></div><div className="lembur-preview-body">{evidencePreview.loading?<div className="lembur-detail-empty">Menyiapkan preview aman...</div>:isImageEvidence(evidencePreview.entry)?<img src={evidencePreview.url} alt={evidencePreview.entry.originalFilename} />:isPdfEvidence(evidencePreview.entry)?<iframe src={evidencePreview.url} title={evidencePreview.entry.originalFilename} />:<div className="lembur-document-fallback"><span className="lembur-doc-icon">DOC</span><strong>Pratinjau dokumen tidak didukung browser.</strong><p>Dokumen tetap tersimpan aman. Tutup viewer untuk kembali ke Detail Lembur.</p></div>}</div>{isImageEvidence(evidencePreview.entry)&&evidencePreview.entries.length>1&&<div className="lembur-preview-nav"><Button variant="secondary" size="small" onClick={()=>moveEvidencePreview(-1)}>← Sebelumnya</Button><span>{evidencePreview.index+1} / {evidencePreview.entries.length}</span><Button variant="secondary" size="small" onClick={()=>moveEvidencePreview(1)}>Berikutnya →</Button></div>}</div></div>}
        </>
      )}
      <ProcessModal
        open={Boolean(submitProcess)}
        status={submitProcess?.status ?? 'loading'}
        title="Mengajukan Lembur"
        subtitle="Menyimpan draft, mengunggah evidence, lalu mengirim pengajuan."
        successTitle="Lembur Berhasil Diajukan"
        successMessage="Pengajuan Lembur berhasil dikirim dan menunggu approval."
        error={submitProcess?.error}
        autoCloseMs={2000}
        allowClose={submitProcess?.status !== 'loading'}
        onClose={() => setSubmitProcess(null)}
        onRetry={runSubmitDraft}
      />
    </section>
  )
}
