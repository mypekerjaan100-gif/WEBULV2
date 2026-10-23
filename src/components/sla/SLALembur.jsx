import { useEffect, useRef, useState } from 'react'
import {
  approveOvertime,
  approveOvertimeEntry,
  finalRejectOvertime,
  finalRejectOvertimeEntry,
  getOvertimeInitialDeadlineConfig,
  listOvertimeEmployeeHistory,
  listOvertimeHistory,
  listOvertimeReplacements,
  listOvertimeWork,
  listReplacementEmployees,
  rejectOvertime,
  rejectOvertimeEntry,
  resubmitOvertime,
  softDeleteOvertimeActivity,
  softDeleteOvertimeEntry,
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
import EvidenceUploadCard from './EvidenceUploadCard.jsx'
import Icon from '../Icon.jsx'
import {
  Alert,
  Button,
  ConfirmationDialog,
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

// Alasan penutupan milik peserta ini; tidak mewarisi alasan aktivitas
// milik peserta lain (batch campuran Disetujui + Ditutup).
function recordClosureReason(record) {
  return record?.entryClosureReason ?? record?.closureReason ?? null
}

// Cakupan Tolak Final (diputuskan bersama pengguna, sementara):
// Lembur Administrasi, Pengganti Izin, Pengganti Sakit.
function recordSupportsFinalReject(record) {
  if (!record) return false
  if (record.type === 'WORK') return record.workCategory === 'ADMINISTRASI'
  return ['REPLACEMENT_PERMISSION', 'REPLACEMENT_SICK'].includes(record.type)
}

// Baris riwayat lembur pegawai dipetakan ke bentuk record agar display
// StatusBadge/tone sama persis dengan daftar rekap (per peserta, bukan
// mewarisi status aktivitas milik peserta lain pada batch campuran).
function employeeHistoryPseudoRecord(historyRow) {
  if (!historyRow) return null
  return {
    type: historyRow.type,
    workCategory: historyRow.workCategory,
    status: historyRow.type === 'WORK' ? historyRow.status : (historyRow.approvalStatus ?? historyRow.status),
    entryStatus: historyRow.type === 'WORK' ? historyRow.approvalStatus : undefined,
    entryClosureReason: historyRow.type === 'WORK' ? historyRow.closureReason : undefined,
    closureReason: historyRow.closureReason ?? historyRow.activityClosureReason ?? null,
    rejectionCount: historyRow.rejectionCount ?? 0,
    revisionDeadlineAt: historyRow.revisionDeadlineAt ?? null,
  }
}

function recordIsExpired(record) {
  const status = recordReviewStatus(record)
  if (status === 'CLOSED' && recordClosureReason(record) === 'EXPIRED') return true
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
  rowVarSpanCount: '',
  rowPruningSpanCount: '',
  rowFelling2040Count: '',
  rowFelling4160Count: '',
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
  if (status==='CLOSED' && recordClosureReason(record)==='FINAL_REJECTED') return 'Ditolak Final'
  if (status==='CLOSED' && recordClosureReason(record)==='EXPIRED') return 'Kedaluwarsa'
  if (status==='CLOSED') return 'Ditutup'
  return status
}

function statusTone(record) {
  const status = recordReviewStatus(record)
  if (recordIsExpired(record)) return 'neutral'
  if (status === 'APPROVED') return 'success'
  if (status === 'SUBMITTED') return 'info'
  if (status === 'CORRECTION_REQUIRED') return 'warning'
  if (status === 'CLOSED' && recordClosureReason(record) === 'FINAL_REJECTED') return 'danger'
  return 'neutral'
}

function statusBadgeKey(record) {
  const status = recordReviewStatus(record)
  if (recordIsExpired(record)) return 'EXPIRED'
  if (status === 'CLOSED' && recordClosureReason(record) === 'FINAL_REJECTED') return 'REJECTED'
  return status
}

function historyStatusLabel(status) {
  return {
    DRAFT: 'Draft',
    SUBMITTED: 'Dikirim',
    CORRECTION_REQUIRED: 'Perlu Revisi',
    APPROVED: 'Disetujui',
    CLOSED: 'Ditutup',
  }[status ?? ''] ?? (status || '–')
}

// Marker revisi lama: RESUBMITTED berstatus tetap tanpa entry_id.
// Dibuat sebelum pencatatan per entry; kepemilikannya diatribusikan ke
// peserta yang pernah ditolak (rejectionCount > 0), bukan semua peserta.
function isLegacyRevisionMarker(h) {
  return (h.entry_id ?? null) == null
    && h.event === 'RESUBMITTED'
    && (h.previous_status ?? null) === (h.new_status ?? null)
}

// Judul + keterangan riwayat berbahasa Indonesia. Baris lama
// 'RESUBMITTED + status tetap + Revision updated' dipetakan sebagai
// Revisi Disimpan tanpa menghapus catatan audit.
function historyEventText(h) {
  switch (h.event) {
    case 'CREATED':
      return { title: 'Draft Dibuat', desc: 'Pengajuan dibuat sebagai draft.' }
    case 'SUBMITTED':
      return {
        title: h.previous_status === 'CORRECTION_REQUIRED' ? 'Diajukan Ulang' : 'Pengajuan Dikirim',
        desc: 'Menunggu persetujuan.',
      }
    case 'REJECTED':
      return { title: 'Dikembalikan Untuk Revisi', desc: null }
    case 'RESUBMITTED':
      if ((h.previous_status ?? null) === (h.new_status ?? null)
        && (h.notes ?? '') === 'Revision updated') {
        return { title: 'Revisi Disimpan', desc: 'Perubahan disimpan, belum diajukan ulang.' }
      }
      return { title: 'Diajukan Ulang', desc: 'Dikirim untuk persetujuan.' }
    case 'REVISION_SAVED':
      return { title: 'Revisi Disimpan', desc: 'Perubahan disimpan, belum diajukan ulang.' }
    case 'CORRECTED':
      return { title: 'Koreksi Data Disetujui', desc: null }
    case 'UPDATED':
      return { title: 'Draft Diperbarui', desc: 'Perubahan draft disimpan.' }
    case 'APPROVED':
      return { title: 'Disetujui', desc: null }
    case 'CLOSED':
      if ((h.notes ?? '').includes('Penolakan final')) return { title: 'Ditolak Final', desc: h.reason ?? null }
      return { title: 'Ditutup', desc: h.reason ?? null }
    case 'DELETED':
      return { title: 'Dihapus', desc: h.reason ?? null }
    default:
      return { title: h.event, desc: null }
  }
}

function isWorkType(lemburType) {
  return lemburType?.startsWith('WORK:')
}
function workCategoryOf(lemburType) {
  if (!isWorkType(lemburType)) return null
  return lemburType.split(':')[1]
}

const ROW_OPTIONAL_COUNT_LABELS = {
  rowPruningSpanCount: 'Jumlah gawang pangkas',
  rowFelling2040Count: 'Jumlah tebang 20–40 cm',
  rowFelling4160Count: 'Jumlah tebang 41–60 cm',
}

// Angka volume ROW disimpan sebagai integer; input kosong berarti tidak
// diisi (null) dan angka non-bulat ditolak saat validasi.
function parseRowCount(value) {
  if (value === '' || value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  const number = Number(text)
  return Number.isInteger(number) ? number : NaN
}

function formatRowUnit(value, unit) {
  if (value === null || value === undefined || value === '') return '—'
  return `${Number(value).toLocaleString('id-ID')} ${unit}`
}

function isImageEvidence(entry) {
  return entry?.storedMimeType?.startsWith('image/')
    || ['FORM_CUTI', 'FORM_SAKIT', 'SURAT_SAKIT', 'FORM_IZIN', 'SURAT_IZIN', 'SPK'].includes(entry?.evidenceType)
    || entry?.evidenceType?.startsWith('FOTO_')
}

function isPdfEvidence(entry) {
  return entry?.storedMimeType === 'application/pdf'
}

function profileInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
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
  isExactAdminUp3 = false,
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
  canCorrectApprovedWork = false,
}) {
  const [draft, setDraft] = useState(() => initialDraft(periodMonth))
  const [activeActivityId, setActiveActivityId] = useState(null)
  const [activeRevisionEntryId, setActiveRevisionEntryId] = useState(null)
  const [activeWorkCategory, setActiveWorkCategory] = useState(null)
  const [employeeOptions, setEmployeeOptions] = useState([])
  const [employeeLoading, setEmployeeLoading] = useState(false)
  const [evidence, setEvidence] = useState([])
  const [files, setFiles] = useState({})
  // Evidence per peserta (PARTICIPANT_V2): entry ID permanen + mode aktivitas.
  const [participantEntries, setParticipantEntries] = useState([])
  const [evidenceMode, setEvidenceMode] = useState('LEGACY_SHARED')
  // Token reload: setiap pembukaan form memicu pemuatan evidence ulang,
  // termasuk saat aktivitas + peserta sama (efek deps tidak berubah).
  const [evidenceReloadToken, setEvidenceReloadToken] = useState(0)
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  // Model evidence V2: SPK/Proses/Selesai diunggah sekali sebagai evidence
  // bersama; Foto Briefing wajib diunggah per pegawai (scoped).
  const [message, setMessage] = useState(null)
  // Warning data belum lengkap: { message, target } dengan target = kunci
  // field pertama yang bermasalah agar dapat ditandai dan difokuskan.
  const [validationError, setValidationError] = useState(null)
  const fieldRefs = useRef({})
  const [isSubmitting, setSubmitting] = useState(false)
  const [dirty, setDirty] = useState(true)
  const activeActivityIdRef = useRef(activeActivityId)
  activeActivityIdRef.current = activeActivityId
  const activeRevisionEntryIdRef = useRef(activeRevisionEntryId)
  activeRevisionEntryIdRef.current = activeRevisionEntryId
  const [filters, setFilters] = useState({ ulp: '', unitLayanan: '', jenis: 'Semua', pegawai: '', status: 'Semua', periode: '' })
  const canViewFinancial = isAdminUp3 || isSuperAdmin || isManagement
  const isReadOnlyManagement = isManagement
  // Lembur kantor UP3: pegawai bertugas langsung di unit UP3 diajukan Admin
  // UP3 (exact membership); keputusan & koreksinya hanya Super Admin.
  const canInputOffice = canMutate && isExactAdminUp3 && !!up3Id
  const officeRecordGuard = (record) => !isExactAdminUp3 || record?.unitId === up3Id
  const [rowsPerPage, setRowsPerPage] = useState(30)
  const [currentPage, setCurrentPage] = useState(1)
  const [detailActivityId, setDetailActivityId] = useState(null)
  const [detailEntryId, setDetailEntryId] = useState(null)

  const openDetail = (record) => {
    setDetailActivityId(record?.id ?? null)
    setDetailEntryId(record?.entryId ?? null)
    setDetailTab('submission')
    setEmpHistory([])
    setEmpHistoryError('')
    setEmpHistoryPage(1)
    setEmpHistoryTotal(0)
  }
  const closeDetail = () => {
    setDetailActivityId(null)
    setDetailEntryId(null)
    setShowReject(null)
    setRejectReason('')
    setRejectMode('REVISION')
    setApproveTarget(null)
    setApproveError('')
    setFinalRejectTarget(null)
    setFinalRejectError('')
    setDetailTab('submission')
    setEmpHistory([])
    setEmpHistoryLoading(false)
    setEmpHistoryError('')
    setEmpHistoryPage(1)
    setEmpHistoryTotal(0)
  }
  const [detailEvidence, setDetailEvidence] = useState([])
  const [detailEntries, setDetailEntries] = useState([])
  const [detailHistory, setDetailHistory] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(null)
  const [rejectMode, setRejectMode] = useState('REVISION')
  const [finalRejectTarget, setFinalRejectTarget] = useState(null)
  const [finalRejectError, setFinalRejectError] = useState('')
  // Tab Detail Lembur + riwayat lembur pegawai (semua jenis/periode).
  const [detailTab, setDetailTab] = useState('submission')
  const [empHistory, setEmpHistory] = useState([])
  const [empHistoryLoading, setEmpHistoryLoading] = useState(false)
  const [empHistoryError, setEmpHistoryError] = useState('')
  const [empHistoryPage, setEmpHistoryPage] = useState(1)
  const [empHistoryTotal, setEmpHistoryTotal] = useState(0)
  const [empHistoryTick, setEmpHistoryTick] = useState(0)
  const empHistoryPageSize = 10
  const [formOpen, setFormOpen] = useState(false)
  const [formStep, setFormStep] = useState('main')
  const [evidenceUrls, setEvidenceUrls] = useState({})
  const [detailEvidenceUrls, setDetailEvidenceUrls] = useState({})
  const [detailFinancial, setDetailFinancial] = useState([])
  const [evidencePreview, setEvidencePreview] = useState(null)
  // Foto profil peserta pada Detail Lembur (referensi pencocokan wajah,
  // bukan evidence): aktif per employeeId + signed URL per photoId.
  const [detailProfileByEmployee, setDetailProfileByEmployee] = useState({})
  const [detailProfileUrls, setDetailProfileUrls] = useState({})
  const [profilePreview, setProfilePreview] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  // Koreksi tanggal/jam pengajuan WORK yang sudah fully APPROVED
  // (Super Admin / Admin UP3; status tetap Disetujui).
  const [correctTarget, setCorrectTarget] = useState(null)
  const [correctDate, setCorrectDate] = useState('')
  const [correctTimes, setCorrectTimes] = useState({})
  const [correctReason, setCorrectReason] = useState('')
  const [correctError, setCorrectError] = useState('')
  const [correctBusy, setCorrectBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const showToast = (message, tone = 'success') => setToast(message ? { message, tone } : null)
  const [submitProcess, setSubmitProcess] = useState(null)
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [approvalError, setApprovalError] = useState('')
  // Target konfirmasi Approve: { record, entryId, participantName }.
  const [approveTarget, setApproveTarget] = useState(null)
  const [approveError, setApproveError] = useState('')
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
    setDetailEntryId(approvalTarget.entryId ?? null)
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
    setApproveTarget(null)
    setApproveError('')
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
  const isRowWork = workCategory === 'ROW'
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
  // Status revisi mengikuti peserta yang dipilih, bukan baris koreksi pertama.
  const activeRecord = (activeRevisionEntryId
    ? activeRecords.find((record) => record.entryId === activeRevisionEntryId) ?? null
    : null)
    ?? activeRecords.find((record) => recordReviewStatus(record) === 'CORRECTION_REQUIRED')
    ?? activeRecords[0] ?? null
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
  const activeRevisionRecord = activeRevisionEntryId
    ? activeRecords.find((entry) => entry.entryId === activeRevisionEntryId) ?? null
    : null
  const activeRevisionParticipantName = activeRevisionRecord?.participantName
    ?? activeRecords.find((entry) => recordReviewStatus(entry) === 'CORRECTION_REQUIRED')?.participantName
    ?? ''
  const isPartialApprovalRevision = Boolean(isRevision && activeHasApproved && (activeRevisionEntryId ?? activeRevisionRecord))
  const formReadOnly = activeInitialExpired || activeRevisionExpired
  const isEvidenceOnlyRevision = Boolean(isPartialApprovalRevision)
  // Model evidence per peserta: aktivitas V2, atau draft pekerjaan baru
  // (selalu tersimpan sebagai V2). Revisi selalu berbasis entry.
  const isV2Work = Boolean(isWork && (evidenceMode === 'PARTICIPANT_V2' || !activeActivityId))
  const isEntryRevision = Boolean(isWork && (activeRevisionEntryId ?? activeRevisionRecord))
  const correctionEntryId = activeRevisionEntryIdRef.current ?? activeRevisionEntryId
  // Revisi V2 mengunci baris peserta lain; hanya peserta yang ditolak yang
  // dapat diubah jamnya. Server juga menolak perubahan jam APPROVED/SUBMITTED.
  const isParticipantLocked = (tempId) => {
    if (!isV2Work || !isRevision || !correctionEntryId) return false
    const participant = (draft.participants ?? []).find((item) => item.tempId === tempId)
    const entry = participantEntries.find((item) => item.employeeId === participant?.employeeId)
    return (entry?.entryId ?? null) !== correctionEntryId
  }
  const SHARED_EVIDENCE_KEY = 'shared'
  const v2Participants = (isV2Work ? draft.participants ?? [] : []).map((participant) => {
    const entry = participantEntries.find((item) => item.employeeId === participant.employeeId)
    const employee = employeeOptions.find((item) => item.id === participant.employeeId)
    return {
      key: entry?.entryId ?? participant.tempId,
      tempId: participant.tempId,
      employeeId: participant.employeeId,
      entryId: entry?.entryId ?? null,
      name: entry?.employeeName ?? employee?.name ?? 'Peserta',
      approvalStatus: entry?.approvalStatus ?? null,
      startTime: participant.startTime ?? '',
      endTime: participant.endTime ?? '',
    }
  })
  const stagedKeyFor = (participantKey, evidenceType) => (
    isV2Work ? `${participantKey}:${evidenceType}` : evidenceType
  )
  const sharedStagedKey = (evidenceType) => `${SHARED_EVIDENCE_KEY}:${evidenceType}`
  // Kepemilikan baris mengacu ke kolom entry_id (row.entryId), bukan
  // _scopeEntryId yang hanya konteks query effective-evidence.
  const ownerEntryIdOf = (row) => row.entryId ?? null
  // Briefing selalu milik entry peserta; tipe lain memakai evidence bersama
  // pada pengajuan awal. Revisi menilai efektif (scoped menimpa shared).
  const briefingRequirementComplete = (participant, requirement) => {
    const scope = participant.entryId ?? participant.key
    const activeCount = scopedExistingFor(scope, requirement.type).length
    const stagedCount = (files[stagedKeyFor(participant.key, requirement.type)] ?? []).length
    return requirement.allowMultiple
      ? activeCount + stagedCount > 0
      : stagedCount > 0 || activeCount === 1
  }
  const effectiveRequirementComplete = (participant, requirement) => {
    const scope = participant.entryId ?? participant.key
    const scopedActive = scopedExistingFor(scope, requirement.type).length
    const sharedActive = sharedExistingFor(requirement.type).length
    const activeCount = scopedActive > 0 ? scopedActive : sharedActive
    const stagedCount = (files[stagedKeyFor(participant.key, requirement.type)] ?? []).length
      + (files[sharedStagedKey(requirement.type)] ?? []).length
    return requirement.allowMultiple
      ? activeCount + stagedCount > 0
      : stagedCount > 0 || activeCount === 1
  }
  const isRevisionTarget = (participant) => {
    const target = correctionEntryId
    return (participant.entryId ?? null) === target
      || (participant.entryId ?? participant.key) === target
  }
  const participantComplete = (participant) => {
    if (isRevision) {
      if (!isRevisionTarget(participant)) return true
      return evidenceRequirements.every((requirement) => effectiveRequirementComplete(participant, requirement))
    }
    return sharedComplete
      && briefingRequirements.every((requirement) => briefingRequirementComplete(participant, requirement))
  }

  const evidenceByType = evidence.reduce((acc, r) => {
    acc[r.evidenceType] = acc[r.evidenceType] || []
    acc[r.evidenceType].push(r)
    return acc
  }, {})
  const evidenceSingle = Object.fromEntries(Object.entries(evidenceByType).map(([k,v])=>[k, v.find(x=>x.status==='ACTIVE')||null]))
  // Dihitung setelah evidenceByType ada (menghindari akses sebelum inisialisasi).
  const sharedExistingFor = (evidenceType) => (
    (evidenceByType[evidenceType] ?? []).filter(
      (row) => row.status === 'ACTIVE' && ownerEntryIdOf(row) == null,
    )
  )
  const scopedExistingFor = (scopeEntryId, evidenceType) => (
    (evidenceByType[evidenceType] ?? []).filter(
      (row) => row.status === 'ACTIVE' && ownerEntryIdOf(row) != null && ownerEntryIdOf(row) === scopeEntryId,
    )
  )
  // Evidence efektif target revisi: override khusus bila ada, jika belum
  // ada pakai file bersama yang berlaku untuknya. Tampil sekali per tipe.
  const effectiveExistingFor = (participant, evidenceType) => {
    const scope = participant.entryId ?? participant.key
    const scoped = scopedExistingFor(scope, evidenceType)
    return scoped.length > 0 ? scoped : sharedExistingFor(evidenceType)
  }
  // Foto Briefing selalu per pegawai; tipe lain evidence bersama.
  const briefingRequirements = evidenceRequirements.filter((requirement) => requirement.type === 'FOTO_BRIEFING')
  const sharedRequirements = evidenceRequirements.filter((requirement) => requirement.type !== 'FOTO_BRIEFING')
  // Urutan deklarasi penting: sharedComplete dipakai participantComplete
  // yang dieksekusi v2CompleteCount/evidenceComplete di bawahnya.
  const sharedRequirementComplete = (requirement) => {
    const activeCount = sharedExistingFor(requirement.type).length
    const stagedCount = (files[sharedStagedKey(requirement.type)] ?? []).length
    return requirement.allowMultiple ? activeCount + stagedCount > 0 : stagedCount > 0 || activeCount === 1
  }
  const sharedCompleteCount = sharedRequirements.filter(sharedRequirementComplete).length
  const sharedComplete = sharedRequirements.length > 0 && sharedRequirements.every(sharedRequirementComplete)
  const v2CompleteCount = v2Participants.filter(participantComplete).length

  const legacyRequirementComplete = (requirement) => {
    const activeCount = (evidenceByType[requirement.type] ?? []).filter((row) => row.status === 'ACTIVE').length
    const stagedCount = (files[requirement.type] ?? []).length
    return requirement.allowMultiple ? activeCount + stagedCount > 0 : stagedCount > 0 || activeCount === 1
  }
  const evidenceComplete = isV2Work
    ? v2Participants.length > 0 && v2Participants.every(participantComplete)
    : evidenceRequirements.length > 0 && evidenceRequirements.every(legacyRequirementComplete)
  const evidenceRequirementComplete = (requirement) => {
    if (!isV2Work) return legacyRequirementComplete(requirement)
    return v2Participants.length > 0 && v2Participants.every((participant) => {
      if (isRevision && !isRevisionTarget(participant)) return true
      if (isRevision) return effectiveRequirementComplete(participant, requirement)
      if (requirement.type === 'FOTO_BRIEFING') return briefingRequirementComplete(participant, requirement)
      return sharedRequirementComplete(requirement)
    })
  }
  const evidenceDoneCount = evidenceRequirements.filter(evidenceRequirementComplete).length

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
      .then(rows => { if(!cancelled) setEmployeeOptions(canInputOffice ? rows.filter((row) => row.unitId === up3Id) : rows) })
      .catch(err => { if(!cancelled) setMessage(err.message || 'Gagal memuat pegawai Lembur.') })
      .finally(() => { if(!cancelled) setEmployeeLoading(false) })
    return () => { cancelled = true }
  }, [canMutate, canInputOffice, contractScope.contractId, up3Id, employeeQueryDate])

  const tagScopedRows = (rows, scopeEntryId) => rows.map((row) => ({
    ...row,
    _scopeEntryId: row.entry_id ?? scopeEntryId,
  }))
  // Effective-evidence per entry memuat ulang baris shared untuk tiap peserta;
  // dedupe berdasarkan id agar tidak terhitung ganda.
  const dedupeEvidenceRows = (rows) => {
    const seen = new Set()
    return (rows ?? []).filter((row) => {
      if (row?.id == null) return true
      if (seen.has(row.id)) return false
      seen.add(row.id)
      return true
    })
  }

  const refreshParticipantEntries = async (activityId) => {
    if (!activityId) {
      setParticipantEntries([])
      setEvidenceMode('LEGACY_SHARED')
      return { entries: [], mode: 'LEGACY_SHARED' }
    }
    try {
      const { listOvertimeActivityEntries } = await import('../../data/overtimeReplacementRepository.js')
      const rows = await listOvertimeActivityEntries(activityId)
      const mode = rows[0]?.evidenceMode ?? 'LEGACY_SHARED'
      setParticipantEntries(rows)
      setEvidenceMode(mode)
      return { entries: rows, mode }
    } catch {
      return { entries: participantEntries, mode: evidenceMode }
    }
  }

  const refreshEvidence = async (activityId = activeActivityId, entryId = activeRevisionEntryIdRef.current) => {
    if (!activityId) { setEvidence([]); return }
    const { listOvertimeEvidence, listOvertimeEntryEffectiveEvidence } = await import('../../data/overtimeEvidenceRepository.js')
    if (isV2Work) {
      const { entries } = await refreshParticipantEntries(activityId)
      const targets = entryId
        ? entries.filter((item) => item.entryId === entryId)
        : entries
      const merged = []
      for (const target of targets) {
        const rows = await listOvertimeEntryEffectiveEvidence(activityId, target.entryId)
        merged.push(...tagScopedRows(rows, target.entryId))
      }
      if (activeActivityIdRef.current === activityId) setEvidence(dedupeEvidenceRows(merged))
      return
    }
    const rows = entryId
      ? await listOvertimeEntryEffectiveEvidence(activityId, entryId)
      : await listOvertimeEvidence(activityId)
    if (activeActivityIdRef.current === activityId
      && (activeRevisionEntryIdRef.current ?? null) === (entryId ?? null)) setEvidence(rows)
  }

  useEffect(() => {
    let cancelled=false
    if (!activeActivityId) { setEvidence([]); setEvidenceLoading(false); return undefined }
    const requestActivityId = activeActivityId
    const requestEntryId = activeRevisionEntryId
    setEvidence([])
    setEvidenceLoading(true)
    import('../../data/overtimeEvidenceRepository.js')
      .then(async ({ listOvertimeEvidence, listOvertimeEntryEffectiveEvidence }) => {
        if (isV2Work) {
          const { entries } = await refreshParticipantEntries(requestActivityId)
          if (cancelled) return []
          const targets = requestEntryId
            ? entries.filter((item) => item.entryId === requestEntryId)
            : entries
          const merged = []
          for (const target of targets) {
            const rows = await listOvertimeEntryEffectiveEvidence(requestActivityId, target.entryId)
            merged.push(...tagScopedRows(rows, target.entryId))
          }
          return dedupeEvidenceRows(merged)
        }
        if (requestEntryId) {
          return listOvertimeEntryEffectiveEvidence(requestActivityId, requestEntryId)
        }
        return listOvertimeEvidence(requestActivityId)
      })
      .then(rows => {
        if (cancelled) return
        // Abaikan respons basi bila target sudah berganti (buka-tutup cepat
        // atau pindah peserta sebelum fetch selesai).
        if (activeActivityIdRef.current !== requestActivityId
          || (activeRevisionEntryIdRef.current ?? null) !== (requestEntryId ?? null)) return
        setEvidence(rows)
        setEvidenceLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        if (activeActivityIdRef.current !== requestActivityId
          || (activeRevisionEntryIdRef.current ?? null) !== (requestEntryId ?? null)) return
        setEvidenceLoading(false)
        setMessage(err.message || 'Gagal memuat evidence.')
      })
    return () => { cancelled=true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeActivityId, activeRevisionEntryId, evidenceMode, evidenceReloadToken])

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

  const fieldRef = (key) => (node) => {
    if (node) fieldRefs.current[key] = node
    else delete fieldRefs.current[key]
  }
  const fieldInvalidClass = (key) => (validationError?.target === key ? ' is-invalid' : '')
  const dismissFieldError = (...keys) => {
    if (!keys.length) return
    setValidationError((current) => (current && keys.includes(current.target) ? null : current))
  }
  const failValidation = (result) => {
    const error = result?.message ? { message: result.message, target: result.target ?? null } : null
    setValidationError(error)
    if (!error) return
    // Arahkan pengguna ke field pertama yang belum lengkap; bila tidak ada
    // field spesifik, arahkan ke banner warning.
    requestAnimationFrame(() => {
      const anchor = (error.target && fieldRefs.current[error.target]) || fieldRefs.current['validation-banner']
      anchor?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      if (anchor && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(anchor.tagName ?? '')) {
        try { anchor.focus({ preventScroll: true }) } catch (focusError) { anchor.focus() }
      }
    })
  }

  const DRAFT_PATCH_ERROR_KEYS = {
    date: 'date',
    workTitle: 'workTitle',
    workLocation: 'workLocation',
    description: 'description',
    replacedEmployeeId: 'replacedEmployee',
    participantEmployeeId: 'participantEmployee',
    startTime: 'time',
    endTime: 'time',
    rowVarSpanCount: 'rowVarSpanCount',
    rowPruningSpanCount: 'rowPruningSpanCount',
    rowFelling2040Count: 'rowFelling2040Count',
    rowFelling4160Count: 'rowFelling4160Count',
  }
  const updateDraft = (patch) => {
    setDraft(c=>({ ...c, ...patch }))
    setDirty(true)
    setMessage(null)
    dismissFieldError(...Object.keys(patch ?? {}).map((key) => DRAFT_PATCH_ERROR_KEYS[key]).filter(Boolean))
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
    setActiveRevisionEntryId(null)
    setActiveWorkCategory(null)
    setEvidence([])
    setFiles({})
    setParticipantEntries([])
    setEvidenceMode('LEGACY_SHARED')
    setDirty(true)
    setMessage(null)
    setValidationError(null)
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
    setValidationError(null)
  }

  const editDraft = (record) => {
    if (!record) return
    if (!officeRecordGuard(record)) {
      setMessage('Lembur ini bukan untuk pegawai kantor UP3 Anda.')
      return
    }
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
        rowVarSpanCount: first.rowVarSpanCount == null ? '' : String(first.rowVarSpanCount),
        rowPruningSpanCount: first.rowPruningSpanCount == null ? '' : String(first.rowPruningSpanCount),
        rowFelling2040Count: first.rowFelling2040Count == null ? '' : String(first.rowFelling2040Count),
        rowFelling4160Count: first.rowFelling4160Count == null ? '' : String(first.rowFelling4160Count),
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
        rowVarSpanCount: '',
        rowPruningSpanCount: '',
        rowFelling2040Count: '',
        rowFelling4160Count: '',
        participants: [{ tempId:'p1', employeeId:'', startTime:'18:00', endTime:'22:00'}],
      })
    }
    setActiveActivityId(first.id)
    setActiveRevisionEntryId(clickedStatus === 'CORRECTION_REQUIRED' ? (record.entryId ?? null) : null)
    setEvidence([])
    setEvidenceLoading(true)
    // Paksa muat ulang meski aktivitas + peserta sama dengan sesi sebelumnya.
    setEvidenceReloadToken((token) => token + 1)
    setFiles({})
    setParticipantEntries([])
    setEvidenceMode(first.evidenceMode ?? 'LEGACY_SHARED')
    setDirty(false)
    setMessage(null)
    setValidationError(null)
    setFormStep('form')
    setFormOpen(true)
    refreshParticipantEntries(first.id).catch(() => {})
  }

  // Validasi terstruktur: pesan + kunci field pertama yang belum lengkap
  // agar form dapat menampilkan warning, menandai field, dan fokus ke sana.
  const invalid = (message, target = null) => ({ message, target })
  const participantLabel = (participant, index) => {
    const employeeName = employeeOptions.find((option) => option.id === participant.employeeId)?.name
    return `Peserta ${index + 1}${employeeName ? ` (${employeeName})` : ''}`
  }

  const validateReplacement = () => {
    if (!REPLACEMENT_TYPES[draft.lemburType]) return invalid('Pilih jenis Pengganti Cuti, Sakit, atau Izin.')
    if (!draft.date) return invalid('Tanggal lembur wajib diisi.', 'date')
    if (!range || range.durationMinutes <1) return invalid('Jam mulai dan jam selesai tidak valid.', 'time')
    if (!draft.date.startsWith(String(periodMonth).slice(0,7))) return invalid('Tanggal lembur harus berada dalam periode yang dipilih.', 'date')
    if (!replacedEmployee) return invalid('Pilih pegawai yang digantikan.', 'replacedEmployee')
    if (!participantEmployee) return invalid('Pilih pegawai pengganti.', 'participantEmployee')
    if (replacedEmployee.id===participantEmployee.id) return invalid('Pegawai yang digantikan dan pengganti harus berbeda.', 'participantEmployee')
    if (replacedEmployee.unitId !== participantEmployee.unitId) return invalid('Kedua pegawai harus berasal dari ULP yang sama.', 'participantEmployee')
    if (unitId && replacedEmployee.unitId !== unitId) return invalid('Pegawai berada di luar ULP akun.', 'replacedEmployee')
    return null
  }

  const validateWork = () => {
    if (!workCategory) return invalid('Pilih kategori pekerjaan.')
    if (!draft.date) return invalid('Tanggal wajib diisi.', 'date')
    // Revisi satu peserta boleh memindahkan tanggal batch (lintas periode);
    // server memvalidasi deadline, eligibility, dan tarif tanggal baru.
    if (!isEntryRevision && !draft.date.startsWith(String(periodMonth).slice(0,7))) return invalid('Tanggal lembur harus berada dalam periode yang dipilih.', 'date')
    if (!draft.description || !draft.description.trim()) return invalid('Keterangan pekerjaan wajib diisi.', 'description')
    if (isRowWork) {
      const varSpan = parseRowCount(draft.rowVarSpanCount)
      // Revisi data ROW lama: angka volume boleh kosong karena input
      // terkunci dan memang belum pernah terisi; peserta hanya memperbaiki
      // jam dan evidence. Pengajuan baru tetap wajib Var ROW minimal 1.
      if (isRevision) {
        if (varSpan != null && (!Number.isInteger(varSpan) || varSpan < 1)) return invalid('Jumlah gawang Var ROW harus bilangan bulat minimal 1.', 'rowVarSpanCount')
      } else {
        if (varSpan == null) return invalid('Jumlah gawang Var ROW wajib diisi.', 'rowVarSpanCount')
        if (!Number.isInteger(varSpan) || varSpan < 1) return invalid('Jumlah gawang Var ROW harus bilangan bulat minimal 1.', 'rowVarSpanCount')
      }
      for (const [key, label] of Object.entries(ROW_OPTIONAL_COUNT_LABELS)) {
        const count = parseRowCount(draft[key])
        if (count != null && (!Number.isInteger(count) || count < 0)) {
          return invalid(`${label} harus bilangan bulat minimal 0.`, key)
        }
      }
    }
    if (isMultiWork) {
      if (!draft.workTitle?.trim()) return invalid('Uraian pekerjaan wajib diisi.', 'workTitle')
      if (!draft.workLocation?.trim()) return invalid('Lokasi pekerjaan wajib diisi.', 'workLocation')
      if (!draft.participants?.length) return invalid('Tambahkan minimal satu pegawai.', 'participants')
      const seen=new Set()
      for (let index = 0; index < draft.participants.length; index += 1) {
        const p = draft.participants[index]
        const label = participantLabel(p, index)
        const employeeKey = `p-${p.tempId}-employee`
        const timeKey = `p-${p.tempId}-time`
        if (!p.employeeId) return invalid(`Pilih pegawai untuk ${label}.`, employeeKey)
        if (seen.has(p.employeeId)) return invalid(`${label}: pegawai tidak boleh duplikat dalam satu aktivitas.`, employeeKey)
        seen.add(p.employeeId)
        const emp = employeeOptions.find(e=>e.id===p.employeeId)
        if (!emp) return invalid(`${label} tidak ditemukan dalam scope.`, employeeKey)
        if (unitId && emp.unitId !== unitId) return invalid(`${label} berada di luar ULP akun.`, employeeKey)
        const r = buildPontianakRange(draft.date, p.startTime, p.endTime)
        if (!r || r.durationMinutes<1) return invalid(`Jam ${label} tidak valid. Periksa jam mulai dan jam selesai.`, timeKey)
      }
      const units = draft.participants.map(p=> employeeOptions.find(e=>e.id===p.employeeId)?.unitId).filter(Boolean)
      if (new Set(units).size>1) return invalid('Semua peserta harus dari ULP yang sama.', 'participants')
      if (unitId && units[0]!==unitId) return invalid('Peserta berada di luar ULP akun.', `p-${draft.participants[0].tempId}-employee`)
    } else if (isAdministrasi) {
      const p = draft.participants[0] || { employeeId: draft.participantEmployeeId, startTime: draft.startTime, endTime: draft.endTime }
      const empId = p.employeeId || draft.participantEmployeeId
      if (!empId) return invalid('Pilih pegawai lembur.', 'admin-employee')
      const emp = employeeOptions.find(e=>e.id===empId)
      if (!emp) return invalid('Pegawai tidak ditemukan.', 'admin-employee')
      if (unitId && emp.unitId!==unitId) return invalid('Pegawai berada di luar ULP akun.', 'admin-employee')
      const r = buildPontianakRange(draft.date, p.startTime||draft.startTime, p.endTime||draft.endTime)
      if (!r || r.durationMinutes<1) return invalid('Jam lembur tidak valid. Periksa jam mulai dan jam selesai.', 'admin-time')
    }
    return null
  }

  const validateDraft = () => {
    if (!isRevision && draft.date && !deadlineReady) return invalid(deadlineLoadError || 'Deadline pengajuan masih diverifikasi. Coba lagi setelah proses selesai.')
    if (initialDeadlinePassed) return invalid(`Batas pengajuan telah lewat. ${initialDeadlineMessage(draft.date, deadlineInfo)} Silakan pilih tanggal lembur yang masih berada dalam batas pengajuan H+${deadlineInfo.effectiveSubmissionDays}.`, 'date')
    if (isReplacement) return validateReplacement()
    if (isWork) return validateWork()
    return invalid('Pilih jenis lembur.')
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
        rowVarSpanCount: isRowWork ? parseRowCount(draft.rowVarSpanCount) : null,
        rowPruningSpanCount: isRowWork ? parseRowCount(draft.rowPruningSpanCount) : null,
        rowFelling2040Count: isRowWork ? parseRowCount(draft.rowFelling2040Count) : null,
        rowFelling4160Count: isRowWork ? parseRowCount(draft.rowFelling4160Count) : null,
        participants,
        // Target revisi eksplisit: server hanya menulis ulang entry ini.
        revisionEntryId: isEntryRevision
          ? (activeRevisionEntryIdRef.current ?? activeRevisionEntryId)
          : null,
      }, { skipRefresh: true })
    }
    if (!result?.ok || !result.activityId) throw new Error(result?.message || 'Draft Lembur gagal disimpan.')
    setActiveActivityId(result.activityId)
    activeActivityIdRef.current = result.activityId
    if (isWork) setActiveWorkCategory(workCategory)
    if (isWork) {
      const revisionId = activeRevisionEntryIdRef.current ?? activeRevisionEntryId
      const revisionEmployee = revisionId
        ? participantEntries.find((item) => item.entryId === revisionId)?.employeeId ?? null
        : null
      const { entries } = await refreshParticipantEntries(result.activityId)
      // Legacy save membuat ulang entry (ID baru); petakan ulang target revisi
      // berdasarkan pegawai agar upload tidak salah sasaran.
      if (revisionId && revisionEmployee) {
        const remapped = entries.find((item) => item.employeeId === revisionEmployee)?.entryId ?? null
        if (remapped && remapped !== revisionId) {
          setActiveRevisionEntryId(remapped)
          activeRevisionEntryIdRef.current = remapped
        }
      }
    }
    return result.activityId
  }

  // Jalur revisi satu peserta: hanya jam target dari form; tanggal baru
  // berlaku untuk seluruh batch; jam peserta lain diturunkan server dari
  // data tersimpan sehingga tidak ikut berubah.
  const persistRevision = async () => {
    const revisionId = activeRevisionEntryIdRef.current ?? activeRevisionEntryId
    if (!activeActivityId || !revisionId) throw new Error('Peserta revisi tidak ditemukan.')
    const revisionRecord = activeRecords.find((record) => record.entryId === revisionId) ?? activeRecord
    const revisionEmployee = participantEntries.find((item) => item.entryId === revisionId)?.employeeId
      ?? revisionRecord?.participantEmployeeId ?? null
    const targetPart = (draft.participants ?? []).find((item) => item.employeeId && item.employeeId === revisionEmployee)
      ?? draft.participants[0]
    if (!targetPart) throw new Error('Peserta revisi tidak ditemukan.')
    const targetRange = buildPontianakRange(draft.date, targetPart.startTime, targetPart.endTime)
    if (!targetRange || targetRange.durationMinutes < 1) throw new Error('Jam peserta revisi tidak valid.')
    const originalDate = activeRecords[0]?.date ?? draft.date
    if (draft.date !== originalDate) {
      const others = activeRecords
        .filter((record) => record.entryId !== revisionId)
        .map((record) => record.participantName)
        .filter(Boolean)
      const confirmed = window.confirm(
        `Tanggal ${revisionRecord?.participantName ?? 'peserta revisi'}${others.length ? ` dan ${others.length} peserta lain (${others.join(', ')})` : ''} akan berubah dari ${originalDate} menjadi ${draft.date}. Jam dan evidence peserta lain tetap. Lanjutkan?`,
      )
      if (!confirmed) return null
    }
    const { saveOvertimeWorkRevision } = await import('../../data/overtimeReplacementRepository.js')
    const activityId = await saveOvertimeWorkRevision({
      activityId: activeActivityId,
      revisionEntryId: revisionId,
      overtimeDate: draft.date,
      startedAt: targetRange.startedAt,
      endedAt: targetRange.endedAt,
      expectedUpdatedAt: revisionRecord?.updatedAt ?? activeRecord?.updatedAt ?? null,
    })
    if (!activityId) throw new Error('Revisi gagal disimpan.')
    setActiveActivityId(activityId)
    activeActivityIdRef.current = activityId
    // ID entry permanen pada jalur ini; cukup segarkan tanpa remap.
    await refreshParticipantEntries(activityId)
    return activityId
  }

  const stageEvidence = async (requirement, fileOrFiles, participantKey = null) => {
    const incoming = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles]
    const pending = incoming.filter(Boolean)
    if (!pending.length || initialDeadlinePassed || deadlineUnavailable || formReadOnly) return
    // Foto Briefing wajib per pegawai (server menolak baris bersama).
    if (participantKey === SHARED_EVIDENCE_KEY && requirement.type === 'FOTO_BRIEFING') {
      setMessage('Foto Briefing wajib diunggah pada kartu masing-masing pegawai.')
      return
    }
    // Evidence bersama tidak dapat diubah saat revisi (server menolak).
    if (participantKey === SHARED_EVIDENCE_KEY && isRevision) {
      setMessage('Evidence bersama dikunci saat revisi. Unggah evidence khusus peserta revisi.')
      return
    }
    const queue = requirement.allowMultiple ? pending : pending.slice(0, 1)
    const storageKey = participantKey === SHARED_EVIDENCE_KEY
      ? sharedStagedKey(requirement.type)
      : (isV2Work && participantKey ? `${participantKey}:${requirement.type}` : requirement.type)
    setSubmitting(true)
    setMessage(`Memproses ${requirement.label}...`)
    try {
      const { prepareOvertimeEvidenceFile } = await import('../../data/overtimeEvidenceRepository.js')
      const stagedItems = []
      for (const file of queue) {
        const processed = await prepareOvertimeEvidenceFile(file, requirement.type)
        stagedItems.push({
          id: `${requirement.type}-${Date.now()}-${Math.random()}`,
          participantKey: isV2Work ? participantKey : null,
          processed,
          previewUrl: processed.file.type.startsWith('image/') ? URL.createObjectURL(processed.file) : null,
        })
      }
      setFiles((current) => ({
        ...current,
        [storageKey]: requirement.allowMultiple
          ? [...(current[storageKey] ?? []), ...stagedItems]
          : (() => {
              (current[storageKey] ?? []).forEach((entry) => {
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

  const removeStagedEvidence = (storageKeyOrType, stagedId) => {
    setFiles((current) => {
      const removed = (current[storageKeyOrType] ?? []).find((item) => item.id === stagedId)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return {
        ...current,
        [storageKeyOrType]: (current[storageKeyOrType] ?? []).filter((item) => item.id !== stagedId),
      }
    })
  }

  const uploadStagedEvidence = async (activityId) => {
    const { listOvertimeEvidence, listOvertimeEntryEffectiveEvidence, uploadOvertimeEvidence } = await import('../../data/overtimeEvidenceRepository.js')
    // Model V2: evidence bersama (non-briefing) diunggah sekali dengan
    // entryId null pada draft awal; Foto Briefing selalu scoped per entry.
    // Revisi hanya mengunggah scoped milik target (semua tipe) sebagai
    // override agar peserta lain tidak ikut berubah.
    if (isV2Work) {
      const { entries } = await refreshParticipantEntries(activityId)
      if (!entries.length) throw new Error('Peserta lembur belum tersedia. Simpan draft ulang.')
      const removeStagedItem = (storageKey, staged) => {
        if (staged.previewUrl) URL.revokeObjectURL(staged.previewUrl)
        setFiles((current) => ({
          ...current,
          [storageKey]: (current[storageKey] ?? []).filter((item) => item.id !== staged.id),
        }))
      }
      const uploadScopedStaged = async (entryId, participantKey, requirement) => {
        const storageKey = stagedKeyFor(participantKey, requirement.type)
        const stagedItems = files[storageKey] ?? []
        // Hanya evidence yang benar-benar milik entry ini yang boleh
        // digantikan (server menolak supersede baris shared).
        const scopedExisting = (evidenceByType[requirement.type] ?? []).filter(
          (row) => row.status === 'ACTIVE' && ownerEntryIdOf(row) === entryId,
        )
        for (let index = 0; index < stagedItems.length; index += 1) {
          const staged = stagedItems[index]
          await uploadOvertimeEvidence({
            activityId,
            entryId,
            evidenceType: requirement.type,
            file: staged.processed.file,
            processedFile: staged.processed,
            sortOrder: requirement.allowMultiple
              ? scopedExisting.length + index
              : 0,
            supersedesEvidenceId: requirement.allowMultiple
              ? null
              : (scopedExisting.find((row) => row.evidenceType === requirement.type)?.id ?? null),
          })
          removeStagedItem(storageKey, staged)
        }
      }
      const resolveEntryId = (participant) => {
        const target = entries.find((item) => item.employeeId === participant.employeeId)
        const entryId = target?.entryId ?? participant.entryId
        if (!entryId) throw new Error(`Entry peserta ${participant.name} belum tersedia. Simpan draft ulang.`)
        return entryId
      }
      if (!isRevision) {
        for (const requirement of sharedRequirements) {
          const storageKey = sharedStagedKey(requirement.type)
          const stagedItems = files[storageKey] ?? []
          const sharedActive = (evidenceByType[requirement.type] ?? []).filter(
            (row) => row.status === 'ACTIVE' && ownerEntryIdOf(row) == null,
          )
          for (let index = 0; index < stagedItems.length; index += 1) {
            const staged = stagedItems[index]
            await uploadOvertimeEvidence({
              activityId,
              entryId: null,
              evidenceType: requirement.type,
              file: staged.processed.file,
              processedFile: staged.processed,
              sortOrder: requirement.allowMultiple
                ? sharedActive.length + index
                : 0,
              supersedesEvidenceId: requirement.allowMultiple
                ? null
                : (sharedActive.find((row) => row.evidenceType === requirement.type)?.id ?? null),
            })
            removeStagedItem(storageKey, staged)
          }
        }
        for (const participant of v2Participants) {
          const entryId = resolveEntryId(participant)
          for (const requirement of briefingRequirements) {
            await uploadScopedStaged(entryId, participant.key, requirement)
          }
        }
      } else {
        const participant = v2Participants.find(isRevisionTarget)
        if (!participant) throw new Error('Peserta revisi tidak ditemukan. Muat ulang lalu coba lagi.')
        const entryId = resolveEntryId(participant)
        for (const requirement of evidenceRequirements) {
          await uploadScopedStaged(entryId, participant.key, requirement)
        }
      }
      const merged = []
      for (const target of entries) {
        const rows = await listOvertimeEntryEffectiveEvidence(activityId, target.entryId)
        merged.push(...tagScopedRows(rows, target.entryId))
      }
      setEvidence(dedupeEvidenceRows(merged))
      return
    }
    // Revisi pekerjaan selalu berbasis entry agar peserta lain tidak ikut berubah.
    const revisionEntryId = isWork
      ? (activeRevisionEntryIdRef.current ?? activeRevisionEntryId)
      : null
    for (const requirement of evidenceRequirements) {
      const stagedItems = files[requirement.type] ?? []
      for (let index = 0; index < stagedItems.length; index += 1) {
        const staged = stagedItems[index]
        const scopedExisting = (evidenceByType[requirement.type] ?? []).filter((row) => row.status === 'ACTIVE' && row.entryId != null)
        const sharedExisting = evidenceSingle[requirement.type] ?? null
        await uploadOvertimeEvidence({
          activityId,
          entryId: revisionEntryId,
          evidenceType: requirement.type,
          file: staged.processed.file,
          processedFile: staged.processed,
          sortOrder: requirement.allowMultiple
            ? (evidenceByType[requirement.type] ?? []).filter((row) => row.status === 'ACTIVE').length + index
            : 0,
          supersedesEvidenceId: requirement.allowMultiple
            ? null
            : (revisionEntryId
              ? (scopedExisting.find((row) => row.evidenceType === requirement.type)?.id ?? null)
              : (sharedExisting?.entryId == null ? (sharedExisting?.id ?? null) : null)),
        })
        if (staged.previewUrl) URL.revokeObjectURL(staged.previewUrl)
        setFiles((current) => ({
          ...current,
          [requirement.type]: (current[requirement.type] ?? []).filter((item) => item.id !== staged.id),
        }))
      }
    }
    const refreshed = revisionEntryId
      ? await listOvertimeEntryEffectiveEvidence(activityId, revisionEntryId)
      : await listOvertimeEvidence(activityId)
    setEvidence(refreshed)
  }

  const saveDraft = async () => {
    const validation = validateDraft()
    if (validation) { failValidation(validation); return }
    setValidationError(null)
    setSubmitting(true)
    try {
      if (isEntryRevision) {
        const activityId = await persistRevision()
        if (!activityId) return
        try {
          await uploadStagedEvidence(activityId)
        } catch (uploadError) {
          setDirty(false)
          await onRefresh?.().catch(() => {})
          throw new Error(`Revisi tanggal/jam tersimpan, tetapi evidence gagal disimpan: ${uploadError?.message || 'coba unggah lagi.'} Jangan ajukan ulang sebelum evidence lengkap.`)
        }
        setDirty(false)
        setMessage('Revisi tersimpan — Data tersinkron.')
        await onRefresh?.()
        return
      }
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
    // Evidence bersama V2 boleh dihapus pada draft awal; server menolak bila
    // status tak memungkinkan (mis. revisi atau sebagian peserta approved).
    if (isV2Work && !entry.entryId && isRevision) {
      setMessage('Evidence bersama dikunci saat revisi. Unggah evidence khusus peserta revisi.')
      return
    }
    if (isPartialApprovalRevision && !entry.entryId) {
      setMessage('Evidence awal tidak dapat dihapus karena sebagian peserta sudah disetujui. Unggah foto pengganti khusus peserta revisi.')
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
    if (validation) { failValidation(validation); return false }
    // Simpan Draft boleh tanpa evidence lengkap; evidence wajib hanya
    // untuk Ajukan Lembur.
    if (!evidenceComplete) { failValidation({ message: 'Lengkapi seluruh evidence wajib sebelum mengajukan Lembur.', target: 'evidence' }); return false }
    setValidationError(null)
    setSubmitting(true)
    setSubmitProcess({ status: 'loading', error: '' })
    try {
      const resubmitting = isRevision
      let activityId = activeActivityId
      if (isEntryRevision && (!activityId || dirty)) {
        activityId = await persistRevision()
        if (!activityId) { setSubmitProcess(null); return false }
      } else if (!activityId || dirty) {
        activityId = await persistDraft()
      }
      await uploadStagedEvidence(activityId)
      // Resolve ulang target revisi setelah simpan: legacy membuat ulang
      // entry (ID baru) dan persistDraft memetakan ulang targetnya.
      const partialResubmitEntryId = (resubmitting && isEntryRevision)
        ? (activeRevisionEntryIdRef.current ?? activeRevisionEntryId)
        : null
      const result = resubmitting && partialResubmitEntryId
        ? await (await import('../../data/overtimeReplacementRepository.js')).resubmitOvertimeEntry(partialResubmitEntryId).then((entryId) => ({ ok: true, entryId })).catch((error) => ({ ok: false, message: error?.message }))
        : resubmitting
          ? await resubmitOvertime(activityId)
          : isReplacement
            ? await onSubmit(activityId, { skipRefresh: true })
            : await onSubmitWork(activityId, { skipRefresh: true })
      if (resubmitting && partialResubmitEntryId && !result?.ok) throw new Error(result?.message || 'Revisi peserta gagal diajukan.')
      if (!resubmitting && !result?.ok) throw new Error(result?.message || 'Lembur gagal diajukan.')
      const revisionName = isPartialApprovalRevision ? activeRevisionParticipantName : ''
      resetForm()
      setFormOpen(false)
      setMessage(resubmitting && revisionName ? `Revisi ${revisionName} berhasil diajukan kembali. Evidence peserta yang sudah disetujui tidak berubah.` : resubmitting ? 'Revisi Lembur berhasil diajukan kembali.' : 'Lembur diajukan dan menunggu approval.')
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
    if (/hanya peserta yang belum disetujui/i.test(text)) {
      return 'Peserta ini tidak dapat dihapus karena sudah disetujui atau sudah final.'
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

  // null = belum terverifikasi (scope hilang/gagal baca); false = terbukti
  // belum sesuai; true = terverifikasi sesuai.
  const verifyParticipantStatus = async (record, entryId, expectedStatuses) => {
    try {
      const contractId = record.contractId ?? contractScope?.contractId
      const scopeUp3Id = record.up3Id ?? up3Id
      if (!contractId || !scopeUp3Id) return null
      const rows = record.type === 'WORK'
        ? await listOvertimeWork({ contractId, up3Id: scopeUp3Id, unitId: null, periodMonth: record.periodMonth ?? periodMonth ?? null })
        : await listOvertimeReplacements({ contractId, up3Id: scopeUp3Id, unitId: null, periodMonth: record.periodMonth ?? periodMonth ?? null })
      const match = rows.find((row) => row.id === record.id && (entryId == null || row.entryId === entryId))
      if (!match) return false
      return expectedStatuses.includes(recordReviewStatus(match))
    } catch {
      return null
    }
  }

  const openApproveConfirm = (record, entryIdOverride)=>{
    if(!record || approvalBusy) return
    const entryId = entryIdOverride ?? (record.type === 'WORK' ? record.entryId : null)
    const participantName = record.participantName ?? ''
    setApproveError('')
    setApproveTarget({ record, entryId, participantName })
  }
  const closeApproveConfirm = ()=>{
    if (approvalBusy) return
    setApproveTarget(null)
    setApproveError('')
  }
  const confirmApprove = async ()=>{
    const target = approveTarget
    if(!target || approvalBusy) return
    const { record, entryId, participantName } = target
    setApprovalBusy(true)
    setApprovalError('')
    setApproveError('')
    try{
      if (record.type === 'WORK') {
        if (!entryId) throw new Error('Data peserta tidak valid. Tutup detail lalu buka kembali dari baris peserta.')
        const resultId = await approveOvertimeEntry(entryId)
        if (resultId && String(resultId) !== String(entryId)) throw new Error('Approval peserta belum tersimpan. Muat ulang lalu coba lagi.')
      } else {
        await approveOvertime(record.id)
      }
      await onRefresh?.()
      const verified = await verifyParticipantStatus(record, entryId, ['APPROVED'])
      if (verified === false) throw new Error('Approval peserta belum tersimpan. Muat ulang lalu coba lagi.')
      setApproveTarget(null)
      closeDetail()
      showToast(participantName ? `${participantName} berhasil disetujui.` : 'Lembur berhasil disetujui.', 'success')
    }catch(e){
      const message = friendlyApprovalError(e.message, 'Lembur gagal disetujui.')
      setApprovalError(message)
      setApproveError(message)
      showToast(message, 'danger')
    } finally{ setApprovalBusy(false) }
  }
  const handleReject = async (record, entryIdOverride)=>{
    if(!record) return
    if(!rejectReason.trim()){ setApprovalError('Alasan penolakan wajib diisi.'); return }
    const entryId = entryIdOverride ?? (record.type === 'WORK' ? record.entryId : null)
    setApprovalBusy(true)
    setApprovalError('')
    try{
      let res = null
      if (record.type === 'WORK') {
        if (!entryId) throw new Error('Data peserta tidak valid. Tutup detail lalu buka kembali dari baris peserta.')
        res = await rejectOvertimeEntry(entryId, rejectReason)
      } else {
        res = await rejectOvertime(record.id, rejectReason)
      }
      await onRefresh?.()
      const verified = await verifyParticipantStatus(record, entryId, ['CORRECTION_REQUIRED', 'CLOSED'])
      if (verified === false) throw new Error('Penolakan peserta belum tersimpan. Muat ulang lalu coba lagi.')
      closeDetail()
      showToast(res?.message || 'Lembur ditolak dan dikembalikan untuk revisi.', 'success')
    }catch(e){ setApprovalError(friendlyApprovalError(e.message, 'Lembur gagal ditolak.')) } finally{ setApprovalBusy(false) }
  }

  // Tolak Final: penolakan langsung untuk Administrasi, Pengganti Izin,
  // Pengganti Sakit. Menutup pengajuan permanen; dikecualikan dari rekap
  // pembayaran. Alasan wajib + dialog konfirmasi per peserta/pengajuan.
  const openRejectBox = (mode)=>{
    setShowReject(detailApprovalKey)
    setRejectMode(mode)
    setApprovalError('')
  }
  const openFinalRejectConfirm = (record, entryId)=>{
    if(!record || approvalBusy) return
    if(!rejectReason.trim()){ setApprovalError('Alasan penolakan final wajib diisi.'); return }
    setFinalRejectError('')
    setFinalRejectTarget({ record, entryId, participantName: record.participantName ?? '' })
  }
  const closeFinalRejectConfirm = ()=>{
    if (approvalBusy) return
    setFinalRejectTarget(null)
    setFinalRejectError('')
  }
  const confirmFinalReject = async ()=>{
    const target = finalRejectTarget
    if(!target || approvalBusy) return
    const { record, entryId, participantName } = target
    const reason = rejectReason.trim()
    if(!reason){ setFinalRejectError('Alasan penolakan final wajib diisi.'); return }
    setApprovalBusy(true)
    setFinalRejectError('')
    try{
      if (record.type === 'WORK') {
        if (!entryId) throw new Error('Data peserta tidak valid. Tutup detail lalu buka kembali dari baris peserta.')
        const resultId = await finalRejectOvertimeEntry(entryId, reason)
        if (resultId && String(resultId) !== String(entryId)) throw new Error('Penolakan final belum tersimpan. Muat ulang lalu coba lagi.')
      } else {
        await finalRejectOvertime(record.id, reason)
      }
      await onRefresh?.()
      const verified = await verifyParticipantStatus(record, entryId, ['CLOSED'])
      if (verified === false) throw new Error('Penolakan final belum tersimpan. Muat ulang lalu coba lagi.')
      setFinalRejectTarget(null)
      closeDetail()
      showToast(participantName ? `${participantName} ditolak final. Tidak masuk rekap pembayaran.` : 'Lembur ditolak final. Tidak masuk rekap pembayaran.', 'success')
    }catch(e){
      const message = friendlyFinalRejectError(e.message)
      setFinalRejectError(message)
      showToast(message, 'danger')
    } finally{ setApprovalBusy(false) }
  }
  function friendlyFinalRejectError(message) {
    const text = String(message ?? '')
    if (/hanya-sama|only for|administrasi|hanya tersedia/i.test(text)) {
      return 'Tolak Final hanya tersedia untuk Lembur Administrasi, Pengganti Izin, atau Pengganti Sakit.'
    }
    if (/hanya dapat diputuskan oleh|only super admin/i.test(text)) {
      return 'Kantor UP3 hanya dapat diputuskan oleh Super Admin.'
    }
    if (/not authorized|42501|permission|scope/i.test(text)) {
      return 'Akun Anda tidak memiliki akses approval untuk scope lembur ini.'
    }
    if (/only submitted|status/i.test(text)) {
      return 'Data sudah berubah status. Tutup detail lalu buka kembali untuk memuat status terbaru.'
    }
    if (/reason/i.test(text)) {
      return 'Alasan penolakan final wajib diisi.'
    }
    if (/failed to fetch|networkerror|timeout|aborterror|http \d{3}/i.test(text)) {
      return 'Terjadi gangguan jaringan. Periksa koneksi lalu coba lagi.'
    }
    return text || 'Lembur gagal ditolak final.'
  }

  // Hapus per peserta: baris tabel = satu entry. Peserta lain dalam batch
  // tidak ikut terhapus (server menjaga scope + status target).
  const canDeleteRecord = (record) => {
    if (!record) return false
    if (isSuperAdmin) return true
    if (!canMutate) return false
    if (!officeRecordGuard(record)) return false
    return ['DRAFT', 'SUBMITTED', 'CORRECTION_REQUIRED'].includes(recordReviewStatus(record))
  }

  const handleDelete = async () => {
    if ((!isSuperAdmin && !canMutate) || !deleteTarget) return
    const reason = deleteReason.trim()
    if (!reason) { setDeleteError('Alasan hapus wajib diisi.'); return }
    setDeleteBusy(true)
    setDeleteError('')
    try {
      let storageCleanupFailed = false
      if (deleteTarget.entryId) {
        // Kumpulkan file khusus peserta ini dahulu (semua status, termasuk
        // PENDING); evidence bersama/milik peserta lain tidak ikut.
        let storagePaths = []
        try {
          const { listOvertimeEvidence } = await import('../../data/overtimeEvidenceRepository.js')
          const rows = await listOvertimeEvidence(deleteTarget.id, { includeHistory: true })
          storagePaths = [...new Set(
            rows
              .filter((row) => row.entryId === deleteTarget.entryId && row.storagePath)
              .map((row) => row.storagePath),
          )]
        } catch {
          storagePaths = []
        }
        await softDeleteOvertimeEntry(deleteTarget.entryId, reason)
        // File Storage dihapus via Storage API (server dilarang menyentuh
        // storage.objects langsung). Metadata sudah terhapus di server.
        if (storagePaths.length) {
          try {
            const { removeOvertimeEvidenceFiles } = await import('../../data/overtimeEvidenceRepository.js')
            await removeOvertimeEvidenceFiles(storagePaths)
          } catch {
            storageCleanupFailed = true
          }
        }
      } else {
        await softDeleteOvertimeActivity(deleteTarget.id, reason)
      }
      const deletedName = deleteTarget.participantName ? `Peserta ${deleteTarget.participantName} dihapus. ` : ''
      setDeleteTarget(null)
      setDeleteReason('')
      showToast(storageCleanupFailed
        ? `${deletedName}Data dihapus, tetapi sebagian file evidence gagal dibersihkan dari Storage.`
        : `${deletedName}Data Lembur berhasil dihapus.`, 'success')
      await onRefresh?.()
    } catch (error) {
      setDeleteError(friendlyDeleteError(error?.message))
    } finally {
      setDeleteBusy(false)
    }
  }

  // Koreksi approved: seluruh batch harus WORK + fully APPROVED; hanya
  // Super Admin / Admin UP3 (prop canCorrectApprovedWork dari parent).
  const correctActivityRows = (activityId) => records.filter((record) => record.id === activityId)
  const canCorrectRecord = (record) => {
    if (!record || record.type !== 'WORK' || !canCorrectApprovedWork) return false
    if (!isSuperAdmin && record.unitId === up3Id) return false
    if (record.status !== 'APPROVED') return false
    const rows = correctActivityRows(record.id)
    if (!rows.length) return false
    return rows.every((row) => recordReviewStatus(row) === 'APPROVED')
  }

  const openCorrection = (record) => {
    if (!canCorrectRecord(record)) return
    const rows = correctActivityRows(record.id)
    const times = {}
    for (const row of rows) {
      const t = pontianakFormValues(row.startedAt, row.endedAt)
      times[row.entryId] = { startTime: t.startTime, endTime: t.endTime }
    }
    setCorrectTarget(record)
    setCorrectDate(record.date)
    setCorrectTimes(times)
    setCorrectReason('')
    setCorrectError('')
  }

  const closeCorrection = () => {
    if (correctBusy) return
    setCorrectTarget(null)
    setCorrectDate('')
    setCorrectTimes({})
    setCorrectReason('')
    setCorrectError('')
  }

  const handleCorrection = async () => {
    if (!correctTarget || correctBusy) return
    const reason = correctReason.trim()
    if (!reason) { setCorrectError('Alasan koreksi wajib diisi.'); return }
    if (!correctDate) { setCorrectError('Tanggal lembur wajib diisi.'); return }
    const rows = correctActivityRows(correctTarget.id)
    const participants = []
    for (const row of rows) {
      const time = correctTimes[row.entryId]
      if (!time?.startTime || !time?.endTime) {
        setCorrectError(`Jam ${row.participantName} belum lengkap.`)
        return
      }
      const range = buildPontianakRange(correctDate, time.startTime, time.endTime)
      if (!range || range.durationMinutes < 1) {
        setCorrectError(`Jam ${row.participantName} tidak valid.`)
        return
      }
      participants.push({ entry_id: row.entryId, started_at: range.startedAt, ended_at: range.endedAt })
    }
    setCorrectBusy(true)
    setCorrectError('')
    try {
      const { correctApprovedOvertimeWork } = await import('../../data/overtimeReplacementRepository.js')
      await correctApprovedOvertimeWork({
        activityId: correctTarget.id,
        overtimeDate: correctDate,
        participants,
        reason,
        expectedUpdatedAt: correctTarget.updatedAt,
      })
      const movedPeriod = correctDate.slice(0, 7) !== String(correctTarget.date ?? '').slice(0, 7)
      setCorrectTarget(null)
      setCorrectDate('')
      setCorrectTimes({})
      setCorrectReason('')
      showToast(movedPeriod
        ? 'Koreksi tersimpan. Status tetap Disetujui. Tanggal pindah periode — data tampil pada periode baru.'
        : 'Koreksi tersimpan. Status tetap Disetujui; nominal dihitung ulang.', 'success')
      await onRefresh?.()
    } catch (error) {
      setCorrectError(error?.message || 'Koreksi gagal disimpan.')
    } finally {
      setCorrectBusy(false)
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
  const loadDetailData = async (activityId, entryIdForDetail) => {
    const evidenceModule = await import('../../data/overtimeEvidenceRepository.js')
    let evidenceResult
    if (entryIdForDetail) {
      evidenceResult = {
        entries: [],
        grouped: false,
        evidence: await evidenceModule.listOvertimeEntryEffectiveEvidence(activityId, entryIdForDetail),
      }
    } else {
      const { listOvertimeActivityEntries } = await import('../../data/overtimeReplacementRepository.js')
      const entries = await listOvertimeActivityEntries(activityId).catch(() => [])
      const mode = entries[0]?.evidenceMode ?? 'LEGACY_SHARED'
      if (mode !== 'PARTICIPANT_V2' || entries.length <= 1) {
        evidenceResult = {
          entries: [],
          grouped: false,
          evidence: await evidenceModule.listOvertimeEvidence(activityId),
        }
      } else {
        const merged = []
        for (const target of entries) {
          const rows = await evidenceModule.listOvertimeEntryEffectiveEvidence(activityId, target.entryId)
          merged.push(...rows.map((row) => ({ ...row, _scopeEntryId: row.entry_id ?? target.entryId })))
        }
        evidenceResult = { entries, grouped: true, evidence: merged }
      }
    }
    const [hist, fin] = await Promise.all([
      listOvertimeHistory(activityId).catch(() => []),
      canViewFinancial
        ? import('../../data/overtimeReplacementRepository.js').then(m => m.listOvertimeEntryFinancial(activityId)).catch(() => [])
        : Promise.resolve([]),
    ])
    return { ...evidenceResult, history: hist || [], financial: fin || [] }
  }
  useEffect(()=>{
    if (!detailActivityId) { setDetailEvidence([]); setDetailEntries([]); setDetailHistory([]); setDetailEvidenceUrls({}); setDetailFinancial([]); return undefined }
    let cancelled=false
    setDetailLoading(true)
    loadDetailData(detailActivityId, detailEntryId)
      .then(({ evidence: evs, entries, grouped, history, financial })=>{ if(!cancelled){ setDetailEvidence(evs); setDetailEntries(grouped ? entries : []); setDetailHistory(history); setDetailFinancial(financial) } })
      .catch(()=>{ if(!cancelled){ setDetailEvidence([]); setDetailEntries([]); setDetailHistory([]); setDetailFinancial([]) } })
      .finally(()=>{ if(!cancelled) setDetailLoading(false) })
    return ()=>{ cancelled=true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailActivityId, detailEntryId, canViewFinancial])
  // Perubahan status oleh role lain (mis. UP3 approve saat detail terbuka di
  // sesi ULP) memuat ulang evidence + riwayat tanpa spinner.
  const openDetailSignature = detailActivityId
    ? records.filter((record) => record.id === detailActivityId).map((record) => `${record.entryId}:${recordReviewStatus(record)}:${record.updatedAt ?? ''}`).join('|')
    : ''
  const prevDetailSignatureRef = useRef('')
  useEffect(() => {
    if (!detailActivityId) { prevDetailSignatureRef.current = ''; return undefined }
    let cancelled = false
    if (prevDetailSignatureRef.current && prevDetailSignatureRef.current !== openDetailSignature) {
      loadDetailData(detailActivityId, detailEntryId)
        .then(({ evidence: evs, entries, grouped, history, financial })=>{ if(!cancelled){ setDetailEvidence(evs); setDetailEntries(grouped ? entries : []); setDetailHistory(history); setDetailFinancial(financial) } })
        .catch(() => {})
    }
    prevDetailSignatureRef.current = openDetailSignature
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDetailSignature, detailActivityId, detailEntryId])
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
  // Foto profil peserta yang tampil pada detail: hanya ID peserta yang
  // tampil, hanya foto ACTIVE, URL baru saat detail dibuka/berganti.
  useEffect(() => {
    setDetailProfileByEmployee({})
    setDetailProfileUrls({})
    setProfilePreview(null)
    if (!detailActivityId) return undefined
    let cancelled = false
    const ids = [...new Set(
      (records ?? [])
        .filter((record) => record.id === detailActivityId
          && (detailEntryId == null || record.entryId === detailEntryId))
        .map((record) => record.participantEmployeeId)
        .filter(Boolean),
    )]
    if (!ids.length) return undefined
    import('../../data/employeePhotoRepository.js')
      .then(({ listEmployeePhotos, createEmployeePhotoSignedUrls }) => listEmployeePhotos(ids)
        .then((photos) => {
          if (cancelled) return null
          const active = {}
          for (const photo of photos) {
            if (!photo?.employeeId || photo.status !== 'ACTIVE') continue
            active[photo.employeeId] ??= photo
          }
          setDetailProfileByEmployee(active)
          return createEmployeePhotoSignedUrls(Object.values(active).map((photo) => photo.id))
        })
        .then((urls) => {
          if (!cancelled && urls) setDetailProfileUrls((prev) => ({ ...prev, ...urls }))
        })
        .catch(() => { if (!cancelled) setDetailProfileByEmployee({}) }))
      .catch(() => { if (!cancelled) setDetailProfileByEmployee({}) })
    return () => { cancelled = true }
  }, [detailActivityId, detailEntryId, records])
  // Riwayat lembur pegawai: dimuat hanya saat tab dibuka / pindah halaman
  // (RPC read-only per-baris scope; tidak menjalankan mutasi apa pun).
  useEffect(() => {
    if (!detailActivityId || detailTab !== 'employee-history') return undefined
    const entryId = detailEntryId ?? detailRecords?.[0]?.entryId ?? null
    let cancelled = false
    if (!entryId) {
      setEmpHistory([])
      setEmpHistoryTotal(0)
      setEmpHistoryLoading(false)
      setEmpHistoryError('Peserta tidak valid. Tutup detail lalu buka kembali dari baris peserta.')
      return undefined
    }
    setEmpHistoryLoading(true)
    setEmpHistoryError('')
    listOvertimeEmployeeHistory({ entryId, limit: empHistoryPageSize, offset: (empHistoryPage - 1) * empHistoryPageSize })
      .then((rows) => {
        if (cancelled) return
        setEmpHistory(rows)
        setEmpHistoryTotal(rows[0]?.totalCount ?? 0)
      })
      .catch((e) => {
        if (cancelled) return
        setEmpHistory([])
        setEmpHistoryTotal(0)
        setEmpHistoryError(friendlyEmployeeHistoryError(e?.message))
      })
      .finally(() => {
        if (!cancelled) setEmpHistoryLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailActivityId, detailEntryId, detailTab, empHistoryPage, empHistoryTick])
  function friendlyEmployeeHistoryError(message) {
    const text = String(message ?? '')
    if (/participant not found/i.test(text)) return 'Peserta tidak ditemukan. Muat ulang daftar lembur.'
    if (/activity not found|not available/i.test(text)) return 'Data sudah tidak tersedia. Muat ulang daftar lembur.'
    if (/not authorized|42501|permission|scope/i.test(text)) return 'Akun Anda tidak memiliki akses membaca riwayat unit lembur ini.'
    if (/failed to fetch|networkerror|timeout|aborterror|http \d{3}/i.test(text)) return 'Terjadi gangguan jaringan. Periksa koneksi lalu coba lagi.'
    return text || 'Gagal memuat riwayat lembur pegawai.'
  }
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
  // Atribusi marker revisi lama: catatan batch bersama (dibuat/dikirim)
  // tetap tampil untuk semua; marker revisi tanpa pemilik hanya tampil
  // pada peserta yang pernah ditolak agar tidak bocor ke peserta lain.
  const detailEntryRejectionCount = detailRecords[0]?.rejectionCount ?? 0
  const visibleDetailHistory = detailEntryId != null
    ? dedupedDetailHistory.filter((h) => {
      if ((h.entry_id ?? null) != null) return h.entry_id === detailEntryId
      if (isLegacyRevisionMarker(h)) return detailEntryRejectionCount > 0
      return true
    })
    : dedupedDetailHistory
  const detailActivity = detailRecords[0] || null
  const detailIsSingleParticipant = detailEntryId != null && detailActivityRecords.length > 1
  const detailApprovalKey = detailActivity ? `${detailActivity.id}:${detailActivity.entryId ?? 'activity'}` : ''
  const detailCanApprove = detailActivity && recordReviewStatus(detailActivity) === 'SUBMITTED' && detailRecords.length === 1
  // Kantor UP3: keputusan hanya Super Admin; sembunyikan tombol untuk lainnya.
  const detailOfficeBlocked = Boolean(detailActivity && up3Id && detailActivity.unitId === up3Id && !isSuperAdmin)
  // Tolak Final sementara hanya Administrasi, Pengganti Izin, Pengganti Sakit.
  const detailSupportsFinalReject = detailActivity ? recordSupportsFinalReject(detailActivity) : false
  const empHistoryTotalPages = Math.max(1, Math.ceil(empHistoryTotal / empHistoryPageSize))

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
    setValidationError(null)
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

  const PARTICIPANT_PATCH_ERROR_SUFFIX = { employeeId: 'employee', startTime: 'time', endTime: 'time' }
  const addParticipant = () => {
    setDraft(c=>({ ...c, participants: [...c.participants, { tempId:`p${Date.now()}`, employeeId:'', startTime:'18:00', endTime:'22:00'}] }))
    setDirty(true)
    dismissFieldError('participants')
  }
  const updateParticipant = (tempId, patch) => {
    setDraft(c=>({ ...c, participants: c.participants.map(p=> p.tempId===tempId ? { ...p, ...patch } : p)}))
    setDirty(true)
    const suffixes = Object.keys(patch ?? {}).map((key) => PARTICIPANT_PATCH_ERROR_SUFFIX[key]).filter(Boolean)
    dismissFieldError(
      ...suffixes.flatMap((suffix) => [`p-${tempId}-${suffix}`, `admin-${suffix}`]),
    )
  }
  const removeParticipant = (tempId) => {
    setValidationError((current) => (
      current && (current.target === 'participants' || String(current.target ?? '').startsWith(`p-${tempId}-`))
        ? null
        : current
    ))
    setDraft(c=>({ ...c, participants: c.participants.filter(p=>p.tempId!==tempId)}))
    setFiles((current) => {
      const next = { ...current }
      let changed = false
      Object.keys(next).forEach((key) => {
        if (key === tempId || key.startsWith(`${tempId}:`)) {
          (next[key] ?? []).forEach((item) => {
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
          })
          delete next[key]
          changed = true
        }
      })
      return changed ? next : current
    })
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
  // Detail V2: evidence bersama tampil sekali sebagai grup sendiri, bukan
  // diulang di setiap peserta; grup peserta hanya berisi override khusus.
  const detailSharedEvidence = activeDetailEvidence.filter(
    (entry, index, list) => (entry.entryId ?? null) == null
      && list.findIndex((item) => item.id === entry.id) === index,
  )
  const detailEvidenceGroups = detailEntries.map((target) => ({
    name: target.employeeName ?? 'Peserta',
    items: activeDetailEvidence.filter(
      (entry) => (entry.entryId ?? null) === target.entryId,
    ),
  }))
  const detailEvidenceDisplayGroups = [
    ...(detailSharedEvidence.length
      ? [{ name: 'Evidence Bersama', items: detailSharedEvidence, shared: true }]
      : []),
    ...detailEvidenceGroups,
  ]
  const ulpCount = (orgUnits ?? []).filter((unit) => unit.type === 'ULP').length
  const up3ScopeName = (orgUnits ?? []).find((unit) => unit.uuid === up3Id || unit.legacyKey === up3Id)?.displayName
  const showUlpColumn = isSuperAdmin || isManagement || !canMutate || isExactAdminUp3
  // Dialog hapus selalu satu peserta (baris yang diklik).
  const deleteParticipantName = deleteTarget?.participantName || '-'
  const deleteTotal = Number(deleteTarget?.total ?? 0)

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
      {toast && <div className={`lembur-toast${toast.tone === 'danger' ? ' lembur-toast-danger' : ''}`} role={toast.tone === 'danger' ? 'alert' : 'status'}><Icon name={toast.tone === 'danger' ? 'x-circle' : 'check-circle'} size={17} />{toast.message}</div>}
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
                  <div><span className="lembur-kicker">{isRevision && activeRevisionParticipantName ? `Revisi Pengajuan · ${activeRevisionParticipantName}` : activeActivityId ? 'Lanjutkan Draft' : 'Tambah Lembur'}</span><h2>{currentTypeLabel}</h2></div>
                 <div className="lembur-heading-actions">
                   {!activeActivityId && <Button variant="ghost" size="small" disabled={submitting} onClick={()=>setFormStep(isWork ? 'work' : 'main')}>← Ubah Jenis</Button>}
                   {activeActivityId && <Button variant="secondary" size="small" disabled={submitting} onClick={openNewForm}>Draft Baru</Button>}
                   <IconButton label="Tutup" className="lembur-icon-button" onClick={closeForm}><Icon name="close" size={17} /></IconButton>
                 </div>
               </div>
              {validationError && (
                <Alert tone="warning" title="Data Belum Lengkap" className="lembur-validation-alert">
                  <span ref={fieldRef('validation-banner')}>{validationError.message}</span>
                </Alert>
              )}

              <fieldset disabled={formReadOnly} className="lembur-form-fieldset">
                <div className={`lembur-form-workspace ${formLayoutClass}`}>
                <div className="lembur-form-left">
                 <section className="lembur-form-section">
                  <div className="lembur-section-heading"><span className="lembur-step-badge" aria-hidden="true">A</span><div className="lembur-section-heading-text"><h3>Informasi Lembur</h3><p>Jenis, tanggal, dan keterangan pengajuan</p></div></div>
                   <div className={`lembur-form-grid ${formLayoutClass}`}>
                      <div className="sla-context-field"><span className="sla-context-label">Jenis Lembur</span><div className="lembur-readonly-value">{currentTypeLabel}</div></div>
                      <label className="sla-context-field"><span className="sla-context-label">Tanggal Lembur{isEntryRevision ? ' Batch' : ''} *</span><input type="date" ref={fieldRef('date')} className={`sla-context-select${fieldInvalidClass('date')}`} value={draft.date} disabled={isEvidenceOnlyRevision} onChange={e=>updateDraft({ date:e.target.value })} /></label>
                      {isEntryRevision && !isEvidenceOnlyRevision && <p className="sla-table-hint">Perubahan tanggal berlaku untuk seluruh peserta batch. Jam dan evidence peserta lain tetap.</p>}
                      {isMultiWork && <><label className="sla-context-field"><span className="sla-context-label">Uraian / Nama Pekerjaan *</span><input ref={fieldRef('workTitle')} className={`sla-context-select${fieldInvalidClass('workTitle')}`} value={draft.workTitle} disabled={isEvidenceOnlyRevision} onChange={e=>updateDraft({ workTitle:e.target.value })} placeholder={WORK_TITLE_PLACEHOLDERS[workCategory] ?? 'Contoh: Nama pekerjaan'} /></label><label className="sla-context-field"><span className="sla-context-label">Lokasi *</span><input ref={fieldRef('workLocation')} className={`sla-context-select${fieldInvalidClass('workLocation')}`} value={draft.workLocation} disabled={isEvidenceOnlyRevision} onChange={e=>updateDraft({ workLocation:e.target.value })} placeholder="Contoh: Desa Sungai Raya" /></label></>}
                       {isWork && <label className="sla-context-field lembur-grid-full"><span className="sla-context-label">Keterangan Pekerjaan *</span><textarea ref={fieldRef('description')} className={`sla-context-select${fieldInvalidClass('description')}`} value={draft.description} disabled={isEvidenceOnlyRevision} onChange={e=>updateDraft({ description:e.target.value })} placeholder="Jelaskan pekerjaan lembur" rows={2} /></label>}
                      {isEvidenceOnlyRevision && <Alert tone="info" className="lembur-deadline-helper">Revisi khusus evidence untuk {activeRevisionParticipantName}. Data pekerjaan dan peserta dikunci agar evidence peserta yang sudah disetujui tidak berubah.</Alert>}
                      {replacementDescription && <div className="lembur-description-preview lembur-grid-full"><span>Keterangan otomatis</span>{replacementDescription}</div>}
                      {isRowWork && (
                        <div className="lembur-row-volume lembur-grid-full">
                          <div className="lembur-row-volume-heading">
                            <strong>Volume Pekerjaan ROW</strong>
                            <span>Isi hasil pekerjaan dalam satuan gawang dan batang.{isRevision ? ' Volume pekerjaan dikunci saat revisi.' : ''}</span>
                          </div>
                          <div className="lembur-row-volume-grid">
                            <label className="sla-context-field">
                              <span className="sla-context-label">Jumlah Gawang Var ROW *</span>
                              <div className="lembur-row-count">
                                <input type="number" min="1" step="1" inputMode="numeric" ref={fieldRef('rowVarSpanCount')} className={`sla-context-select${fieldInvalidClass('rowVarSpanCount')}`} value={draft.rowVarSpanCount} disabled={isEvidenceOnlyRevision || isRevision} onChange={e=>updateDraft({ rowVarSpanCount:e.target.value })} placeholder="0" />
                                <span>gawang</span>
                              </div>
                            </label>
                            <label className="sla-context-field">
                              <span className="sla-context-label">Jumlah Gawang Pangkas</span>
                              <div className="lembur-row-count">
                                <input type="number" min="0" step="1" inputMode="numeric" ref={fieldRef('rowPruningSpanCount')} className={`sla-context-select${fieldInvalidClass('rowPruningSpanCount')}`} value={draft.rowPruningSpanCount} disabled={isEvidenceOnlyRevision || isRevision} onChange={e=>updateDraft({ rowPruningSpanCount:e.target.value })} placeholder="0" />
                                <span>gawang</span>
                              </div>
                            </label>
                            <label className="sla-context-field">
                              <span className="sla-context-label">Jumlah Tebang Diameter 20–40 cm</span>
                              <div className="lembur-row-count">
                                <input type="number" min="0" step="1" inputMode="numeric" ref={fieldRef('rowFelling2040Count')} className={`sla-context-select${fieldInvalidClass('rowFelling2040Count')}`} value={draft.rowFelling2040Count} disabled={isEvidenceOnlyRevision || isRevision} onChange={e=>updateDraft({ rowFelling2040Count:e.target.value })} placeholder="0" />
                                <span>batang</span>
                              </div>
                            </label>
                            <label className="sla-context-field">
                              <span className="sla-context-label">Jumlah Tebang Diameter 41–60 cm</span>
                              <div className="lembur-row-count">
                                <input type="number" min="0" step="1" inputMode="numeric" ref={fieldRef('rowFelling4160Count')} className={`sla-context-select${fieldInvalidClass('rowFelling4160Count')}`} value={draft.rowFelling4160Count} disabled={isEvidenceOnlyRevision || isRevision} onChange={e=>updateDraft({ rowFelling4160Count:e.target.value })} placeholder="0" />
                                <span>batang</span>
                              </div>
                            </label>
                          </div>
                        </div>
                      )}
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

                <section className="lembur-form-section" ref={fieldRef('participants')}>
                   <div className="lembur-section-heading"><span className="lembur-step-badge" aria-hidden="true">B</span><div className="lembur-section-heading-text"><h3>{isMultiWork && isV2Work ? 'Pegawai, Waktu & Foto Briefing' : 'Pegawai & Waktu'}</h3><p>{isMultiWork && isV2Work ? 'Satu kartu per pegawai: data, jam kerja, dan foto briefing' : 'Peserta, jam kerja, dan durasi otomatis'}</p></div></div>
                  {isReplacement && <div className="lembur-time-grid is-replacement">
                    <label className="sla-context-field"><span className="sla-context-label">Pegawai yang Digantikan *</span><select ref={fieldRef('replacedEmployee')} className={`sla-context-select${fieldInvalidClass('replacedEmployee')}`} value={draft.replacedEmployeeId} disabled={employeeLoading} onChange={e=>updateDraft({ replacedEmployeeId:e.target.value, participantEmployeeId:'' })}><option value="">{employeeLoading ? 'Memuat pegawai...' : 'Pilih pegawai'}</option>{employeeOptions.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}</select></label>
                    <label className="sla-context-field"><span className="sla-context-label">Pegawai Pengganti *</span><select ref={fieldRef('participantEmployee')} className={`sla-context-select${fieldInvalidClass('participantEmployee')}`} value={draft.participantEmployeeId} disabled={!replacedEmployee} onChange={e=>updateDraft({ participantEmployeeId:e.target.value })}><option value="">Pilih pegawai pengganti</option>{participantOptions.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}</select></label>
                    <label className="sla-context-field"><span className="sla-context-label">Jam Mulai *</span><input type="time" ref={fieldRef('time')} className={`sla-context-select${fieldInvalidClass('time')}`} value={draft.startTime} onChange={e=>updateDraft({ startTime:e.target.value })} /></label>
                    <label className="sla-context-field"><span className="sla-context-label">Jam Selesai *</span><input type="time" className={`sla-context-select${fieldInvalidClass('time')}`} value={draft.endTime} onChange={e=>updateDraft({ endTime:e.target.value })} /></label>
                    <div className="lembur-duration-compact"><span>Durasi</span><strong>{range ? formatDurationMinutes(range.durationMinutes) : '–'}</strong>{draft.endTime <= draft.startTime && <small>+1 hari</small>}</div>
                  </div>}
                  {isAdministrasi && (()=>{ const participant=draft.participants[0]; const participantRange=buildPontianakRange(draft.date, participant?.startTime||draft.startTime, participant?.endTime||draft.endTime); return <div className="lembur-time-grid is-single"><label className="sla-context-field"><span className="sla-context-label">Pegawai Lembur *</span><select ref={fieldRef('admin-employee')} className={`sla-context-select${fieldInvalidClass('admin-employee')}`} value={participant?.employeeId || ''} disabled={employeeLoading} onChange={e=>updateParticipant(participant.tempId,{employeeId:e.target.value})}><option value="">{employeeLoading?'Memuat pegawai...':'Pilih pegawai'}</option>{employeeOptions.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}</select></label><label className="sla-context-field"><span className="sla-context-label">Jam Mulai *</span><input type="time" ref={fieldRef('admin-time')} className={`sla-context-select${fieldInvalidClass('admin-time')}`} value={participant?.startTime||draft.startTime} onChange={e=>updateParticipant(participant.tempId,{startTime:e.target.value})} /></label><label className="sla-context-field"><span className="sla-context-label">Jam Selesai *</span><input type="time" className={`sla-context-select${fieldInvalidClass('admin-time')}`} value={participant?.endTime||draft.endTime} onChange={e=>updateParticipant(participant.tempId,{endTime:e.target.value})} /></label><div className="lembur-duration-compact"><span>Durasi</span><strong>{participantRange?formatDurationMinutes(participantRange.durationMinutes):'–'}</strong>{participant?.endTime<=participant?.startTime&&<small>+1 hari</small>}</div></div>})()}
                   {isMultiWork && isV2Work ? (
                    <div className="lembur-member-list">
                      <div className="lembur-participants-heading"><strong>Peserta Lembur{isRevision && activeRevisionParticipantName ? ` · revisi ${activeRevisionParticipantName}` : ''}</strong><Button variant="secondary" size="small" disabled={isEvidenceOnlyRevision || (isRevision && isV2Work)} onClick={addParticipant}>+ Tambah Pegawai</Button></div>
                      {draft.participants.filter((member) => {
                        if (!isRevision || !isV2Work) return true
                        const info = v2Participants.find((item) => item.tempId === member.tempId)
                        return (info?.entryId ?? null) === (activeRevisionEntryIdRef.current ?? activeRevisionEntryId)
                      }).map((member) => {
                        const v2info = v2Participants.find((item) => item.tempId === member.tempId) ?? { key: member.tempId, tempId: member.tempId, employeeId: member.employeeId, entryId: null, name: 'Peserta', startTime: member.startTime, endTime: member.endTime }
                        const memberRange = buildPontianakRange(draft.date, member.startTime, member.endTime)
                        const otherIds = draft.participants.filter((item) => item.tempId !== member.tempId).map((item) => item.employeeId)
                        const memberOptions = employeeOptions.filter((employee) => !otherIds.includes(employee.id))
                        // Target revisi boleh mengubah jamnya; identitas pegawai
                        // tetap dikunci. Server menolak perubahan jam
                        // APPROVED/SUBMITTED dan data pekerjaan bersama.
                        const memberIsRevisionTarget = Boolean(isRevision)
                          && (v2info.entryId ?? null) === (activeRevisionEntryIdRef.current ?? activeRevisionEntryId)
                        const memberLocked = isEvidenceOnlyRevision || isParticipantLocked(member.tempId)
                        const memberTimeLocked = memberLocked && !(isRevision && memberIsRevisionTarget)
                        const briefingDone = briefingRequirements.every((requirement) => briefingRequirementComplete(v2info, requirement))
                        return (
                          <div key={member.tempId} className="lembur-member-card">
                            <div className="lembur-member-fields">
                              <label className="sla-context-field"><span className="sla-context-label">Pegawai *</span><select ref={fieldRef(`p-${member.tempId}-employee`)} className={`sla-context-select${fieldInvalidClass(`p-${member.tempId}-employee`)}`} value={member.employeeId} disabled={employeeLoading || memberLocked} onChange={e=>updateParticipant(member.tempId,{employeeId:e.target.value})}><option value="">{employeeLoading ? 'Memuat pegawai...' : 'Pilih pegawai'}</option>{memberOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
                              <label className="sla-context-field"><span className="sla-context-label">Jam Mulai *</span><input type="time" ref={fieldRef(`p-${member.tempId}-time`)} className={`sla-context-select${fieldInvalidClass(`p-${member.tempId}-time`)}`} value={member.startTime} disabled={memberTimeLocked} onChange={e=>updateParticipant(member.tempId,{startTime:e.target.value})} /></label>
                              <label className="sla-context-field"><span className="sla-context-label">Jam Selesai *</span><input type="time" className={`sla-context-select${fieldInvalidClass(`p-${member.tempId}-time`)}`} value={member.endTime} disabled={memberTimeLocked} onChange={e=>updateParticipant(member.tempId,{endTime:e.target.value})} /></label>
                              <div className="lembur-duration-compact"><span>Durasi</span><strong>{memberRange ? formatDurationMinutes(memberRange.durationMinutes) : '–'}</strong>{member.endTime <= member.startTime && <small>+1 hari</small>}</div>
                              {draft.participants.length > 1 ? <IconButton label="Hapus peserta" className="lembur-row-remove" disabled={isEvidenceOnlyRevision || (isRevision && isV2Work)} onClick={()=>removeParticipant(member.tempId)}><Icon name="close" size={15} /></IconButton> : <span />}
                            </div>
                            {(!isRevision || isRevisionTarget(v2info)) ? (
                              <div className="lembur-member-briefing">
                                <p className="sla-table-hint">Foto briefing wajib diunggah untuk {v2info.name} · Status: {evidenceLoading ? 'Memuat...' : briefingDone ? 'Lengkap' : 'Belum lengkap'}{isRevision ? ` · revisi ${v2info.name}` : ''}</p>
                                <div className="lembur-upload-grid lembur-evidence-grid">
                                  {briefingRequirements.map((requirement) => (
                                    <EvidenceUploadCard
                                      key={`${v2info.key}-${requirement.type}`}
                                      requirement={requirement}
                                      position={1}
                                      existingList={isRevision ? effectiveExistingFor(v2info, requirement.type) : scopedExistingFor(v2info.entryId ?? v2info.key, requirement.type)}
                                      stagedList={files[stagedKeyFor(v2info.key, requirement.type)] ?? []}
                                      evidenceUrls={evidenceUrls}
                                      isImageEvidence={isImageEvidence}
                                      inputDisabled={submitting || initialDeadlinePassed || formReadOnly}
                                      actionDisabled={submitting || formReadOnly}
                                      locked={false}
                                      isPartialRevision={Boolean(isRevision)}
                                      revisionParticipantName={isRevision ? v2info.name : undefined}
                                      onStage={(req, stagedFiles) => stageEvidence(req, stagedFiles, v2info.key)}
                                      onRemoveStaged={(_type, stagedId) => removeStagedEvidence(stagedKeyFor(v2info.key, requirement.type), stagedId)}
                                      onPreview={previewEvidence}
                                      onRemoveSaved={removeEvidence}
                                    />
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <p className="lembur-evidence-locked-note">{`Dikunci. Evidence milik ${v2info.name} tidak ikut direvisi.`}</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                   ) : isMultiWork && <div className="lembur-participants"><div className="lembur-participants-heading"><strong>Peserta Lembur{isEvidenceOnlyRevision && activeRevisionParticipantName ? ` · revisi ${activeRevisionParticipantName}` : ''}</strong><Button variant="secondary" size="small" disabled={isEvidenceOnlyRevision || (isRevision && isV2Work)} onClick={addParticipant}>+ Tambah Pegawai</Button></div><div className="lembur-participant-labels"><span>Pegawai</span><span>Jam Mulai</span><span>Jam Selesai</span><span>Durasi</span><span></span></div>{draft.participants.map((participant)=>{ const participantRange=buildPontianakRange(draft.date,participant.startTime,participant.endTime); const otherIds=draft.participants.filter(item=>item.tempId!==participant.tempId).map(item=>item.employeeId); const options=employeeOptions.filter(employee=>!otherIds.includes(employee.id)); return <div key={participant.tempId} className="lembur-participant-row"><select ref={fieldRef(`p-${participant.tempId}-employee`)} className={`sla-context-select${fieldInvalidClass(`p-${participant.tempId}-employee`)}`} value={participant.employeeId} disabled={employeeLoading || isEvidenceOnlyRevision || isParticipantLocked(participant.tempId)} onChange={e=>updateParticipant(participant.tempId,{employeeId:e.target.value})}><option value="">{employeeLoading?'Memuat...':'Pilih pegawai'}</option>{options.map(employee=><option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><input type="time" ref={fieldRef(`p-${participant.tempId}-time`)} className={`sla-context-select${fieldInvalidClass(`p-${participant.tempId}-time`)}`} value={participant.startTime} disabled={isEvidenceOnlyRevision || isParticipantLocked(participant.tempId)} onChange={e=>updateParticipant(participant.tempId,{startTime:e.target.value})} /><input type="time" className={`sla-context-select${fieldInvalidClass(`p-${participant.tempId}-time`)}`} value={participant.endTime} disabled={isEvidenceOnlyRevision || isParticipantLocked(participant.tempId)} onChange={e=>updateParticipant(participant.tempId,{endTime:e.target.value})} /><strong>{participantRange?formatDurationMinutes(participantRange.durationMinutes):'–'}</strong>{draft.participants.length>1?<IconButton label="Hapus peserta" className="lembur-row-remove" disabled={isEvidenceOnlyRevision || (isRevision && isV2Work)} onClick={()=>removeParticipant(participant.tempId)}><Icon name="close" size={15} /></IconButton>:<span />}</div>})}</div>}
                </section>

                </div>
                 <section className="lembur-form-section lembur-evidence-section" ref={fieldRef('evidence')}>
                    <div className="lembur-section-heading lembur-evidence-heading"><span className="lembur-step-badge" aria-hidden="true">C</span><div className="lembur-section-heading-text"><h3>{isV2Work ? 'Evidence Bersama' : 'Evidence'}</h3><p>Foto JPG, PNG, atau WebP · dikompres otomatis maks. 1 MB{isV2Work ? ' · SPK, proses & selesai diunggah sekali untuk semua pegawai; foto briefing ada di kartu tiap pegawai' : ''}{(isPartialApprovalRevision || isEntryRevision) && activeRevisionParticipantName ? ` · revisi ${activeRevisionParticipantName}` : ''} · simpan lewat Simpan Draft atau Ajukan Lembur.</p></div><span className={`lembur-evidence-progress${evidenceComplete ? ' is-complete' : ''}`}>{isV2Work ? `${v2CompleteCount}/${v2Participants.length} peserta lengkap` : `${evidenceDoneCount}/${evidenceRequirements.length} lengkap`}</span></div>
                    {isPartialApprovalRevision && <p className="lembur-evidence-locked-note">Revisi evidence khusus {activeRevisionParticipantName}. Evidence awal milik peserta yang sudah disetujui tidak berubah dan tidak dapat dihapus.</p>}
                    {!isPartialApprovalRevision && activeHasApproved && <p className="lembur-evidence-locked-note">Evidence dikunci karena sebagian peserta sudah disetujui.</p>}
                    {isV2Work && isRevision && <p className="lembur-evidence-locked-note">Revisi khusus {activeRevisionParticipantName || 'peserta yang ditolak'}. Evidence peserta lain dikunci dan tidak ikut berubah.</p>}
                    {evidenceLoading && <p className="sla-table-hint">Memuat evidence...</p>}
                    {isV2Work ? (
                      <>
                      {!isRevision && (
                      <div className="lembur-shared-evidence">
                        <div className="lembur-participant-evidence-heading">
                          <strong>Evidence Bersama</strong>
                          <span className={`lembur-evidence-status is-${sharedComplete ? 'complete' : 'partial'}`}>
                            {sharedComplete ? 'Lengkap' : `${sharedCompleteCount}/${sharedRequirements.length}`}
                          </span>
                        </div>
                        <p className="sla-table-hint">Satu upload berlaku untuk seluruh pegawai dalam pengajuan ini.{isRevision ? ' Dikunci saat revisi.' : ''}</p>
                        <div className="lembur-upload-grid lembur-evidence-grid">
                          {sharedRequirements.map((requirement, cardIndex) => (
                            <EvidenceUploadCard
                              key={`shared-${requirement.type}`}
                              requirement={requirement}
                              position={cardIndex + 1}
                              existingList={sharedExistingFor(requirement.type)}
                              stagedList={files[sharedStagedKey(requirement.type)] ?? []}
                              evidenceUrls={evidenceUrls}
                              isImageEvidence={isImageEvidence}
                              inputDisabled={submitting || initialDeadlinePassed || formReadOnly || isRevision}
                              actionDisabled={submitting || formReadOnly || isRevision}
                              locked={false}
                              isPartialRevision={false}
                              onStage={(req, stagedFiles) => stageEvidence(req, stagedFiles, SHARED_EVIDENCE_KEY)}
                              onRemoveStaged={(_type, stagedId) => removeStagedEvidence(sharedStagedKey(requirement.type), stagedId)}
                              onPreview={previewEvidence}
                              onRemoveSaved={removeEvidence}
                            />
                          ))}
                        </div>
                      </div>
                      )}
                      {isRevision && (
                      <div className="lembur-participant-evidence-list">
                        {v2Participants.map((participant, participantIndex) => {
                          const complete = participantComplete(participant)
                          const targetRevision = isRevisionTarget(participant)
                          // Revisi: hanya target yang mengganti (SPK/proses/
                          // selesai sebagai override khusus); peserta lain
                          // ringkasan terkunci. Foto briefing tetap di kartu
                          // pegawai bagian B, tidak pindah ke bagian C.
                          const visibleRequirements = sharedRequirements
                          if (!targetRevision) {
                            return (
                              <div key={participant.key} className="lembur-participant-evidence">
                                <div className="lembur-participant-evidence-heading">
                                  <span className="lembur-evidence-position" aria-hidden="true">{participantIndex + 1}</span>
                                  <strong>{participant.name}</strong>
                                </div>
                                <p className="lembur-evidence-locked-note">Dikunci. Evidence milik {participant.name} tidak ikut direvisi.</p>
                              </div>
                            )
                          }
                          return (
                            <div key={participant.key} className={`lembur-participant-evidence${complete ? ' is-complete' : ''}`}>
                              <div className="lembur-participant-evidence-heading">
                                <span className="lembur-evidence-position" aria-hidden="true">{participantIndex + 1}</span>
                                <strong>{participant.name}</strong>
                                <span className={`lembur-evidence-status is-${complete ? 'complete' : 'partial'}`}>
                                  {complete ? 'Lengkap' : 'Belum lengkap'}
                                </span>
                              </div>
                              {(participant.startTime || participant.endTime) && (
                                <p className="sla-table-hint">Jam {participant.startTime || '–'}–{participant.endTime || '–'}</p>
                              )}
                              <p className="lembur-evidence-locked-note">Revisi khusus {participant.name}. Yang tampil di bawah adalah SPK, proses, dan selesai yang berlaku untuk {participant.name} saat ini; foto briefing tetap di kartu {participant.name} pada bagian B. Yang diganti hanya berlaku untuk {participant.name}, evidence bersama dan peserta lain tidak berubah.</p>
                              <div className="lembur-upload-grid lembur-evidence-grid">
                                {visibleRequirements.map((requirement, cardIndex) => {
                                  const existingList = effectiveExistingFor(participant, requirement.type)
                                  const stagedList = files[stagedKeyFor(participant.key, requirement.type)] ?? []
                                  return (
                                    <EvidenceUploadCard
                                      key={`${participant.key}-${requirement.type}`}
                                      requirement={requirement}
                                      position={cardIndex + 1}
                                      existingList={existingList}
                                      stagedList={stagedList}
                                      evidenceUrls={evidenceUrls}
                                      isImageEvidence={isImageEvidence}
                                      inputDisabled={submitting || initialDeadlinePassed || formReadOnly}
                                      actionDisabled={submitting || formReadOnly}
                                      locked={false}
                                      isPartialRevision={Boolean(isRevision)}
                                      revisionParticipantName={participant.name}
                                      onStage={(req, stagedFiles) => stageEvidence(req, stagedFiles, participant.key)}
                                      onRemoveStaged={(_type, stagedId) => removeStagedEvidence(stagedKeyFor(participant.key, requirement.type), stagedId)}
                                      onPreview={previewEvidence}
                                      onRemoveSaved={removeEvidence}
                                    />
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      )}
                      </>
                    ) : (
                   <div className="lembur-upload-grid lembur-evidence-grid">
                     {evidenceRequirements.map((requirement, cardIndex) => {
                       const existingList = (evidenceByType[requirement.type] || []).filter((entry) => entry.status === 'ACTIVE')
                       const stagedList = files[requirement.type] ?? []
                       return (
                         <EvidenceUploadCard
                           key={requirement.type}
                           requirement={requirement}
                           position={cardIndex + 1}
                           existingList={existingList}
                           stagedList={stagedList}
                           evidenceUrls={evidenceUrls}
                           isImageEvidence={isImageEvidence}
                           inputDisabled={submitting || initialDeadlinePassed || formReadOnly}
                           actionDisabled={submitting || formReadOnly}
                           locked={false}
                           isPartialRevision={isPartialApprovalRevision}
                           revisionParticipantName={activeRevisionParticipantName}
                           onStage={stageEvidence}
                           onRemoveStaged={removeStagedEvidence}
                           onPreview={previewEvidence}
                           onRemoveSaved={removeEvidence}
                         />
                       )
                     })}
                   </div>
                    )}
                  </section>
                </div>

                  {message && !(initialDeadlinePassed && message.startsWith('Batas pengajuan')) && <Alert tone="info" className="lembur-message">{message}</Alert>}
                   <div className="lembur-form-actions"><Button variant="secondary" disabled={submitting||initialDeadlinePassed||deadlineUnavailable||formReadOnly} onClick={saveDraft}>{isSubmitting ? 'Memproses...' : isEntryRevision && activeRevisionParticipantName ? `Simpan Revisi ${activeRevisionParticipantName}` : 'Simpan Draft'}</Button><div className="lembur-form-actions-right"><Button variant="ghost" onClick={closeForm}>Batal</Button><Button variant="primary" disabled={submitting||initialDeadlinePassed||deadlineUnavailable||formReadOnly||!evidenceComplete} onClick={submitDraft}>{isEntryRevision && activeRevisionParticipantName ? `Ajukan Ulang ${activeRevisionParticipantName}` : 'Ajukan Lembur'}</Button></div></div>
              </fieldset>
              </>
              )}
            </div>
            </div>
          )}

          {isExactAdminUp3 && canMutate && <Alert tone="info" className="lembur-readonly-notice">Anda dapat mengajukan lembur untuk pegawai yang bertugas di kantor UP3. Pegawai ULP tetap diajukan Admin ULP masing-masing; lembur kantor UP3 disetujui atau ditolak Super Admin, sedangkan lembur ULP tetap dapat Anda proses di Detail berstatus Diajukan.</Alert>}
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
                  {(orgUnits||[]).filter((u)=> u.type==='ULP' || (u.type==='UP3' && u.uuid===up3Id)).map(u=> <option key={u.uuid} value={u.uuid}>{u.displayName}</option>)}
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
                {paginated.map((record, recordIndex)=>{
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
                          {canMutate && canEdit && !isExpired && <Button variant="secondary" size="small" disabled={isSubmitting} onClick={()=>editDraft(record)}>{recordReviewStatus(record) === 'CORRECTION_REQUIRED' ? 'Revisi Pengajuan' : 'Lanjutkan Draft'}</Button>}
                           {canCorrectRecord(record) && paginated.findIndex((row) => row.id === record.id) === recordIndex && <Button variant="secondary" size="small" onClick={()=>openCorrection(record)}>Koreksi</Button>}
                           <Button variant="secondary" size="small" onClick={()=>openDetail(record)}>Lihat Detail</Button>
                            {canDeleteRecord(record) && <Button variant="danger" size="small" disabled={deleteBusy} onClick={()=>{setDeleteTarget(record);setDeleteReason('');setDeleteError('')}}>Hapus Peserta</Button>}
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
                <div className="lembur-delete-header"><div><span className="lembur-kicker">{isSuperAdmin ? 'SUPER ADMIN' : (deleteTarget?.unitId === up3Id ? 'ADMIN UP3' : 'ADMIN ULP')}</span><h2 id="lembur-delete-title">Hapus Peserta Lembur</h2></div><IconButton label="Tutup" className="lembur-icon-button" disabled={deleteBusy} onClick={()=>{setDeleteTarget(null);setDeleteReason('');setDeleteError('')}}><Icon name="close" size={17} /></IconButton></div>
                <Alert tone="danger" title="Konfirmasi hapus peserta">Hanya peserta ini yang dihapus dari Rekap Lembur normal. Peserta lain dalam batch tidak berubah; audit tetap tersimpan.</Alert>
                <dl className="lembur-delete-summary"><div><dt>Jenis</dt><dd>{jenisLabel(deleteTarget)}</dd></div><div><dt>Tanggal</dt><dd>{deleteTarget.date}</dd></div><div><dt>Peserta</dt><dd>{deleteParticipantName}</dd></div><div><dt>Total</dt><dd>Rp {formatRp(deleteTotal)}</dd></div><div><dt>Keterangan</dt><dd>{deleteTarget.description}</dd></div></dl>
                <label className="sla-context-field"><span className="sla-context-label">Alasan Hapus *</span><textarea className="sla-context-select" rows={3} value={deleteReason} disabled={deleteBusy} onChange={event=>{setDeleteReason(event.target.value);setDeleteError('')}} placeholder="Jelaskan alasan penghapusan data Lembur" /></label>
                {deleteError && <Alert tone="danger">{deleteError}</Alert>}
                <div className="lembur-delete-actions"><Button variant="ghost" disabled={deleteBusy} onClick={()=>{setDeleteTarget(null);setDeleteReason('');setDeleteError('')}}>Batal</Button><Button variant="danger" disabled={deleteBusy||!deleteReason.trim()} onClick={handleDelete}>{deleteBusy?'Menghapus...':'Hapus Data'}</Button></div>
              </div>
            </div>
          )}
          {canCorrectApprovedWork && correctTarget && (
            <div className="rekap-detail-overlay" onClick={closeCorrection}>
              <div className="rekap-detail-modal lembur-correct-modal" role="dialog" aria-modal="true" aria-labelledby="lembur-correct-title" onClick={event=>event.stopPropagation()}>
                <div className="lembur-delete-header"><div><span className="lembur-kicker">{isSuperAdmin ? 'SUPER ADMIN' : 'ADMIN UP3'} · STATUS TETAP DISETUJUI</span><h2 id="lembur-correct-title">Koreksi Tanggal & Jam</h2></div><IconButton label="Tutup" className="lembur-icon-button" disabled={correctBusy} onClick={closeCorrection}><Icon name="close" size={17} /></IconButton></div>
                <Alert tone="warning" title="Koreksi data yang sudah disetujui">Tanggal berlaku untuk seluruh {correctActivityRows(correctTarget.id).length} peserta batch ini. Kategori, pekerjaan, peserta, dan evidence dikunci. Nominal dihitung ulang otomatis.</Alert>
                <dl className="lembur-delete-summary"><div><dt>Jenis</dt><dd>{jenisLabel(correctTarget)}</dd></div><div><dt>Tanggal semula</dt><dd>{correctTarget.date}</dd></div><div><dt>Keterangan</dt><dd>{correctTarget.description}</dd></div></dl>
                <label className="sla-context-field"><span className="sla-context-label">Tanggal Lembur *</span><input type="date" className="sla-context-select" value={correctDate} disabled={correctBusy} onChange={event=>{setCorrectDate(event.target.value);setCorrectError('')}} /></label>
                <div className="lembur-correct-list">
                  {correctActivityRows(correctTarget.id).map((row) => {
                    const time = correctTimes[row.entryId] ?? { startTime: '', endTime: '' }
                    const range = correctDate && time.startTime && time.endTime ? buildPontianakRange(correctDate, time.startTime, time.endTime) : null
                    return (
                      <div key={row.entryId} className="lembur-correct-row">
                        <strong>{row.participantName}</strong>
                        <div className="lembur-correct-times">
                          <label className="sla-context-field"><span className="sla-context-label">Jam Mulai *</span><input type="time" className="sla-context-select" value={time.startTime} disabled={correctBusy} onChange={event=>{setCorrectTimes((prev)=>({ ...prev, [row.entryId]: { ...time, startTime: event.target.value } }));setCorrectError('')}} /></label>
                          <label className="sla-context-field"><span className="sla-context-label">Jam Selesai *</span><input type="time" className="sla-context-select" value={time.endTime} disabled={correctBusy} onChange={event=>{setCorrectTimes((prev)=>({ ...prev, [row.entryId]: { ...time, endTime: event.target.value } }));setCorrectError('')}} /></label>
                          <div className="lembur-duration-compact"><span>Durasi baru</span><strong>{range ? formatDurationMinutes(range.durationMinutes) : '–'}</strong>{time.endTime <= time.startTime && time.startTime && time.endTime && <small>+1 hari</small>}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <label className="sla-context-field"><span className="sla-context-label">Alasan Koreksi *</span><textarea className="sla-context-select" rows={3} value={correctReason} disabled={correctBusy} onChange={event=>{setCorrectReason(event.target.value);setCorrectError('')}} placeholder="Jelaskan alasan koreksi tanggal/jam" /></label>
                {correctError && <Alert tone="danger">{correctError}</Alert>}
                <div className="lembur-delete-actions"><Button variant="ghost" disabled={correctBusy} onClick={closeCorrection}>Batal</Button><Button variant="primary" disabled={correctBusy||!correctReason.trim()} onClick={handleCorrection}>{correctBusy?'Menyimpan...':'Simpan Koreksi'}</Button></div>
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
                            const profilePhoto = r.participantEmployeeId ? detailProfileByEmployee[r.participantEmployeeId] : null
                            const profileUrl = profilePhoto ? detailProfileUrls[profilePhoto.id] : null
                            return <tr key={r.entryId}><td><span className="lembur-participant-identity">{profilePhoto && profileUrl ? <button type="button" className="sp-pegawai-photo-thumb lembur-profile-thumb" onClick={()=>setProfilePreview({ name: r.participantName, url: profileUrl })} aria-label={`Lihat foto profil ${r.participantName}`} title={`Lihat foto profil ${r.participantName}`}><img src={profileUrl} alt={`Foto profil ${r.participantName}`} /></button> : <span className="sp-pegawai-photo sp-pegawai-photo-thumb sp-pegawai-photo-placeholder" role="img" aria-label="Foto profil belum tersedia" title="Foto profil belum tersedia">{profileInitials(r.participantName)}</span>}<span>{r.participantName}</span></span></td><td>{t.startTime}–{t.endTime} · {formatDurationMinutes(r.durationHours*60)}</td><td>Rp {formatRp(r.total)}</td>{canViewFinancial && <td>{fin ? `Rp ${formatRp(fin.hourlyRate)}/jam` : '—'}</td>}{canViewFinancial && <td>{fin ? `${fin.durationHours.toFixed(2)} jam · ${fin.multiplierHours.toFixed(2)} jam × Rp ${formatRp(fin.total)}` : '—'}</td>}</tr>
                          })}
                        </tbody>
                      </table></div>
                    </section>
                    <section className="lembur-detail-section"><h3>Keterangan</h3><div className="lembur-detail-description">{detailActivity.workTitle&&<strong>{detailActivity.workTitle}</strong>}{detailActivity.workLocation&&<span>{detailActivity.workLocation}</span>}<p>{detailActivity.description}</p></div></section>
                    {detailActivity.type === 'WORK' && detailActivity.workCategory === 'ROW' && (
                      <section className="lembur-detail-section"><h3>Hasil Pekerjaan ROW</h3>
                        {detailActivity.rowVarSpanCount == null && detailActivity.rowPruningSpanCount == null && detailActivity.rowFelling2040Count == null && detailActivity.rowFelling4160Count == null
                          ? <div className="lembur-detail-empty">Rincian volume belum tersedia pada data lama.</div>
                          : <dl className="lembur-row-detail-grid">
                              <div><dt>Gawang Var ROW</dt><dd>{formatRowUnit(detailActivity.rowVarSpanCount, 'gawang')}</dd></div>
                              <div><dt>Gawang Pangkas</dt><dd>{formatRowUnit(detailActivity.rowPruningSpanCount, 'gawang')}</dd></div>
                              <div><dt>Tebang 20–40 cm</dt><dd>{formatRowUnit(detailActivity.rowFelling2040Count, 'batang')}</dd></div>
                              <div><dt>Tebang 41–60 cm</dt><dd>{formatRowUnit(detailActivity.rowFelling4160Count, 'batang')}</dd></div>
                            </dl>}
                      </section>
                    )}
                                         <div className="lembur-detail-tabs" role="tablist" aria-label="Tab Detail Lembur">
                       <button type="button" className={detailTab==='submission'?'lembur-detail-tab is-active':'lembur-detail-tab'} onClick={()=>setDetailTab('submission')}>Pengajuan Ini</button>
                       <button type="button" className={detailTab==='employee-history'?'lembur-detail-tab is-active':'lembur-detail-tab'} onClick={()=>setDetailTab('employee-history')}>Riwayat Lembur Pegawai</button>
                     </div>
                     {detailTab==='submission' && (<>
                      <section className="lembur-detail-section"><h3>Evidence{detailEvidenceGroups.length ? ' · per peserta' : ''}</h3>{detailLoading?<div className="lembur-detail-empty">Memuat evidence...</div>:detailEvidenceGroups.length ? <div className="lembur-participant-evidence-list">{detailEvidenceDisplayGroups.map((group)=><div key={`${group.shared ? 'bersama' : 'peserta'}-${group.name}`} className="lembur-participant-evidence"><div className="lembur-participant-evidence-heading"><strong>{group.name}</strong><span className="lembur-evidence-status is-complete">{group.items.length} file</span></div>{group.items.length?<div className="lembur-detail-evidence-grid">{group.items.map((entry)=>isImageEvidence(entry)?<button type="button" className="lembur-detail-photo" key={entry.id} onClick={()=>previewEvidence(entry,photoDetailEvidence)}>{detailEvidenceUrls[entry.id]?<img src={detailEvidenceUrls[entry.id]} alt={entry.originalFilename} />:<span className="lembur-evidence-loading">Memuat foto...</span>}<span><strong>{evidenceLabel(entry.evidenceType)}</strong><small>{entry.originalFilename} · {(entry.storedSizeBytes/1024).toFixed(0)} KB</small></span></button>:<button type="button" className="lembur-detail-document" key={entry.id} onClick={()=>previewEvidence(entry)}><span className="lembur-doc-icon">DOC</span><span><strong>{evidenceLabel(entry.evidenceType)}</strong><small>{entry.originalFilename} · {(entry.storedSizeBytes/1024).toFixed(0)} KB</small></span><b>Preview</b></button>)}</div>:<div className="lembur-detail-empty">{group.shared ? 'Belum ada evidence bersama.' : detailSharedEvidence.length ? 'Memakai evidence bersama di atas.' : 'Belum ada evidence peserta ini.'}</div>}</div>)}</div>:activeDetailEvidence.length?<div className="lembur-detail-evidence-grid">{activeDetailEvidence.map((entry)=>isImageEvidence(entry)?<button type="button" className="lembur-detail-photo" key={entry.id} onClick={()=>previewEvidence(entry,photoDetailEvidence)}>{detailEvidenceUrls[entry.id]?<img src={detailEvidenceUrls[entry.id]} alt={entry.originalFilename} />:<span className="lembur-evidence-loading">Memuat foto...</span>}<span><strong>{evidenceLabel(entry.evidenceType)}</strong><small>{entry.originalFilename} · {(entry.storedSizeBytes/1024).toFixed(0)} KB</small></span></button>:<button type="button" className="lembur-detail-document" key={entry.id} onClick={()=>previewEvidence(entry)}><span className="lembur-doc-icon">DOC</span><span><strong>{evidenceLabel(entry.evidenceType)}</strong><small>{entry.originalFilename} · {(entry.storedSizeBytes/1024).toFixed(0)} KB</small></span><b>Preview</b></button>)}</div>:<div className="lembur-detail-empty">Belum ada evidence.</div>}</section>
                    <section className="lembur-detail-section"><h3>Riwayat Pengajuan Ini{detailEntryId != null && detailActivityRecords.length > 1 ? ` · ${detailActivity?.participantName ?? ''}` : ''}</h3>
                      {visibleDetailHistory.length ? (
                        <div className="lembur-history-timeline">
                          {visibleDetailHistory.map(h=>{
                            const text = historyEventText(h)
                            const statusChanged = (h.previous_status ?? null) !== (h.new_status ?? null)
                            const showNotes = h.notes
                              && h.notes !== 'Revision updated'
                              && h.notes !== 'Draft updated'
                            return (
                              <div key={h.id} className="lembur-history-item">
                                <span className="lembur-history-dot" /><div><small>{new Date(h.occurred_at).toLocaleString('id-ID',{timeZone:'Asia/Pontianak'})}</small><strong>{text.title}</strong>
                                {statusChanged && <p>{historyStatusLabel(h.previous_status)} → {historyStatusLabel(h.new_status)}</p>}
                                {h.event === 'REJECTED' && h.reason ? <p className="lembur-history-reason">Alasan: {h.reason}</p> : null}
                                {h.event !== 'REJECTED' && h.reason ? <p>{h.reason}</p> : null}
                                {text.desc && <p>{text.desc}</p>}
                                {showNotes && <p>{h.notes}</p>}
                                {isLegacyRevisionMarker(h) && detailEntryId == null && <p className="sla-table-hint">Catatan lama: peserta tidak tercatat.</p>}</div>
                              </div>
                            )
                          })}
                        </div>
                      ) : <div className="lembur-detail-empty">Belum ada riwayat.</div>}
                    </section>
                      {(isAdminUp3||isSuperAdmin) && detailCanApprove && !detailOfficeBlocked && (
                       <section className="lembur-detail-section lembur-approval-section"><h3>Approval</h3>{detailActivity.type==='WORK'&&<p className="lembur-approval-scope-note">Persetujuan berlaku hanya untuk peserta ini: {detailActivity.participantName}.</p>}{approvalError&&<Alert tone="danger" className="lembur-approval-alert">{approvalError}</Alert>}{showReject===detailApprovalKey&&<div className="lembur-reject-box">{rejectMode==='FINAL'&&<Alert tone="warning" className="lembur-approval-alert">Tolak Final menutup pengajuan ini secara permanen: tidak dapat direvisi dan tidak masuk rekap pembayaran.</Alert>}<label className="sla-context-field"><span className="sla-context-label">{rejectMode==='FINAL'?'Alasan Penolakan Final *':'Alasan Penolakan *'}</span><textarea className="sla-context-select" rows={3} value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder={rejectMode==='FINAL'?'Jelaskan dasar penolakan final':'Jelaskan bagian yang perlu diperbaiki'} /></label><div><Button variant="ghost" disabled={approvalBusy} onClick={()=>{setShowReject(null);setRejectMode('REVISION');setRejectReason('');setApprovalError('')}}>Batal</Button><Button variant="danger" disabled={approvalBusy||!rejectReason.trim()} onClick={()=>rejectMode==='FINAL'?openFinalRejectConfirm(detailActivity, detailEntryId):handleReject(detailActivity, detailEntryId)}>{approvalBusy?'Memproses...':(rejectMode==='FINAL'?'Tolak Final':'Kirim Penolakan')}</Button></div></div>}<div className="lembur-approval-actions"><Button variant="danger" disabled={approvalBusy} onClick={()=>openRejectBox('REVISION')}>Tolak</Button>{detailSupportsFinalReject&&<Button variant="danger" disabled={approvalBusy} onClick={()=>openRejectBox('FINAL')}>Tolak Final</Button>}<Button variant="primary" disabled={approvalBusy} onClick={()=>openApproveConfirm(detailActivity, detailEntryId)}>{approvalBusy?'Memproses...':'Setujui'}</Button></div></section>
                      )}
                      {(isAdminUp3||isSuperAdmin) && !detailOfficeBlocked && !detailCanApprove && recordReviewStatus(detailActivity)==='SUBMITTED' && detailRecords.length>1 && <Alert tone="info" className="lembur-approval-alert">Buka detail dari baris peserta tertentu untuk menyetujui atau menolak per peserta.</Alert>}
                       {detailOfficeBlocked && recordReviewStatus(detailActivity)==='SUBMITTED' && <Alert tone="info" className="lembur-approval-alert">Lembur kantor UP3 hanya dapat disetujui atau ditolak oleh Super Admin.</Alert>}
                     </>)}
                     {detailTab==='employee-history' && (
                       <section className="lembur-detail-section lembur-employee-history-section"><h3>Riwayat Lembur Pegawai{detailRecords[0]?.participantName ? ` · ${detailRecords[0].participantName}` : ''}</h3>
                       <p className="sla-table-hint lembur-employee-history-hint">Semua jenis lembur, semua periode. Hanya pengajuan yang pernah dikirim; pengajuan yang sedang dibuka tidak ditampilkan.</p>
                       {empHistoryLoading ? <div className="lembur-detail-empty">Memuat riwayat pegawai...</div>
                       : empHistoryError ? <div className="lembur-detail-empty"><span>{empHistoryError}</span><div style={{ marginTop: 10 }}><Button variant="secondary" size="small" onClick={()=>setEmpHistoryTick(t=>t+1)}>Coba Lagi</Button></div></div>
                       : empHistory.length ? (<>
                        <div className="lembur-employee-history-wrap"><table className="sla-table lembur-employee-history-table">
                          <thead><tr><th>Tanggal</th><th>Jenis</th><th>Waktu / Durasi</th><th>Unit</th><th>Keterangan</th><th>Status</th></tr></thead>
                          <tbody>
                            {empHistory.map((row) => {
                              const pseudo = employeeHistoryPseudoRecord(row)
                              const time = pontianakFormValues(row.startedAt, row.endedAt)
                              return (
                                <tr key={`${row.activityId}-${row.entryId}`}>
                                  <td>{row.date ?? '—'}</td>
                                  <td>{jenisLabel(pseudo)}</td>
                                  <td className="lembur-table-time">{time.startTime}–{time.endTime}{time.endTime <= time.startTime ? ' (+1 hari)' : ''} · {formatDurationMinutes((row.durationHours ?? 0) * 60)}</td>
                                  <td>{getUlpName(row.unitId) ?? '—'}</td>
                                  <td className="lembur-employee-history-keterangan">{row.workTitle && <strong>{row.workTitle}</strong>}<span>{row.description || '—'}</span></td>
                                  <td className="lembur-table-status"><StatusBadge status={statusBadgeKey(pseudo)} tone={statusTone(pseudo)}>{displayStatus(pseudo)}</StatusBadge></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table></div>
                        {empHistoryTotalPages > 1 && (
                          <div className="lembur-employee-history-pagination">
                            <span>Halaman {empHistoryPage} dari {empHistoryTotalPages}</span>
                            <Button variant="secondary" size="small" disabled={empHistoryPage<=1 || empHistoryLoading} onClick={()=>setEmpHistoryPage(p=>Math.max(1,p-1))}>Sebelumnya</Button>
                            <Button variant="secondary" size="small" disabled={empHistoryPage>=empHistoryTotalPages || empHistoryLoading} onClick={()=>setEmpHistoryPage(p=>p+1)}>Berikutnya</Button>
                          </div>
                        )}
                       </>)
                       : <div className="lembur-detail-empty">Belum ada pengajuan lembur lain untuk pegawai ini dalam akses Anda.</div>}
                       </section>
                     )}
                   </>
                )}
              </div>
            </div>
          )}
          {profilePreview && <div className="lembur-preview-overlay" onClick={()=>setProfilePreview(null)}><div className="lembur-preview-modal" onClick={event=>event.stopPropagation()}><div className="lembur-preview-header"><div><strong>Foto Profil Pegawai</strong><span>{profilePreview.name}</span></div><IconButton label="Tutup preview" className="lembur-icon-button" onClick={()=>setProfilePreview(null)}><Icon name="close" size={17} /></IconButton></div><div className="lembur-preview-body"><img src={profilePreview.url} alt={`Foto profil ${profilePreview.name}`} className="lembur-profile-full" /></div><p className="sla-table-hint lembur-profile-hint">Bandingkan wajah pada foto profil dengan foto evidence (briefing/proses/selesai).</p></div></div>}
          <ConfirmationDialog
            open={Boolean(approveTarget)}
            title="Konfirmasi Persetujuan"
            description={`Setujui pengajuan lembur${approveTarget?.participantName ? ` ${approveTarget.record.type === 'WORK' ? 'peserta' : 'pegawai pengganti'} ${approveTarget.participantName}` : ''} ini? Pengajuan yang disetujui tercatat final dan diteruskan ke perhitungan.`}
            summary={approveTarget ? [
              { label: 'Jenis', value: jenisLabel(approveTarget.record) },
              { label: approveTarget.record.type === 'WORK' ? 'Peserta' : 'Pegawai Pengganti', value: approveTarget.participantName || '—' },
              { label: 'Unit & Tanggal', value: `${getUlpName(approveTarget.record.unitId)} · ${approveTarget.record.date}` },
            ] : []}
            confirmLabel="Konfirmasi"
            cancelLabel="Batal"
            confirmTone="primary"
            icon="shield"
            loading={approvalBusy}
            error={approveError}
            backdropClassName="lembur-confirm-backdrop"
            onConfirm={confirmApprove}
            onCancel={closeApproveConfirm}
          />
          <ConfirmationDialog
            open={Boolean(finalRejectTarget)}
            title="Konfirmasi Tolak Final"
            description="Penolakan final bersifat permanen: tidak dapat direvisi dan tidak masuk rekap pembayaran. Data serta evidence tetap tersimpan untuk audit."
            summary={finalRejectTarget ? [
              { label: 'Jenis', value: jenisLabel(finalRejectTarget.record) },
              { label: finalRejectTarget.record.type === 'WORK' ? 'Peserta' : 'Pegawai Pengganti', value: finalRejectTarget.participantName || '—' },
              { label: 'Unit & Tanggal', value: `${getUlpName(finalRejectTarget.record.unitId)} · ${finalRejectTarget.record.date}` },
              { label: 'Alasan', value: rejectReason.trim() || '—' },
            ] : []}
            confirmLabel="Tolak Final"
            cancelLabel="Batal"
            confirmTone="danger"
            icon="close"
            loading={approvalBusy}
            error={finalRejectError}
            backdropClassName="lembur-confirm-backdrop"
            onConfirm={confirmFinalReject}
            onCancel={closeFinalRejectConfirm}
          />
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
