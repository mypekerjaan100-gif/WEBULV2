import { useEffect, useRef, useState } from 'react'
import { listReplacementEmployees, approveOvertime, rejectOvertime, resubmitOvertime, listOvertimeHistory } from '../../data/overtimeReplacementRepository.js'
import {
  automaticReplacementDescription,
  buildPontianakRange,
  formatDurationMinutes,
  pontianakFormValues,
  REPLACEMENT_TYPES,
} from '../../data/overtimeReplacementL2.js'
import { WORK_CATEGORIES } from '../../data/overtimeWorkL3.js'

const formatRp = (value) => Number(value ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })
const DAY_MS = 24 * 60 * 60 * 1000

function initialDeadlineFor(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return null
  return new Date(new Date(`${date}T00:00:00+07:00`).getTime() + (8 * DAY_MS) - 1)
}

function formatPontianakDate(value) {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Pontianak',
  }).format(value)
}

function initialDeadlineMessage(date) {
  const deadline = initialDeadlineFor(date)
  if (!deadline) return ''
  return `Lembur tanggal ${formatPontianakDate(new Date(`${date}T12:00:00+07:00`))} hanya dapat diajukan sampai ${formatPontianakDate(deadline)} pukul 23:59.`
}

function recordIsExpired(record) {
  if (record.status === 'CLOSED' && record.closureReason === 'EXPIRED') return true
  if (record.status === 'DRAFT' && record.submissionDeadlineAt) {
    return new Date(record.submissionDeadlineAt) < new Date()
  }
  return record.status === 'CORRECTION_REQUIRED'
    && record.revisionDeadlineAt
    && new Date(record.revisionDeadlineAt) < new Date()
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
  if (recordIsExpired(record)) return 'Kedaluwarsa'
  if (record.status==='DRAFT') return 'Draft'
  if (record.status==='SUBMITTED'){
    if (record.rejectionCount===1) return 'Menunggu Approval — Revisi 1'
    if (record.rejectionCount===2) return 'Menunggu Approval — Revisi Terakhir'
    return 'Menunggu Approval'
  }
  if (record.status==='CORRECTION_REQUIRED'){
    if (record.rejectionCount===2) return 'Revisi Terakhir'
    return 'Perlu Revisi'
  }
  if (record.status==='APPROVED') return 'Disetujui'
  if (record.status==='CLOSED' && record.closureReason==='FINAL_REJECTED') return 'Ditolak Final'
  if (record.status==='CLOSED' && record.closureReason==='EXPIRED') return 'Kedaluwarsa'
  if (record.status==='CLOSED') return 'Ditutup'
  return record.status
}

function isWorkType(lemburType) {
  return lemburType?.startsWith('WORK:')
}
function workCategoryOf(lemburType) {
  if (!isWorkType(lemburType)) return null
  return lemburType.split(':')[1]
}

function isImageEvidence(entry) {
  return entry?.storedMimeType?.startsWith('image/') || entry?.evidenceType?.startsWith('FOTO_')
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
  const [submitting, setSubmitting] = useState(false)
  const [dirty, setDirty] = useState(true)
  const activeActivityIdRef = useRef(activeActivityId)
  activeActivityIdRef.current = activeActivityId
  const [filters, setFilters] = useState({ ulp: '', unitLayanan: '', jenis: 'Semua', pegawai: '', status: 'Semua', periode: '' })
  const canViewFinancial = isAdminUp3 || isSuperAdmin || isManagement
  const isReadOnlyManagement = isManagement
  const [rowsPerPage, setRowsPerPage] = useState(30)
  const [currentPage, setCurrentPage] = useState(1)
  const [detailActivityId, setDetailActivityId] = useState(null)
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
  const handledApprovalToken = useRef(null)

  useEffect(() => {
    if (approvalTarget?.source !== 'lembur' || !approvalTarget.token || approvalTarget.token === handledApprovalToken.current) return
    handledApprovalToken.current = approvalTarget.token
    setDetailActivityId(approvalTarget.id)
    onApprovalTargetHandled?.()
  }, [approvalTarget?.token]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const activeRecord = activeActivityId ? records.find((record) => record.id === activeActivityId) : null
  const isRevision = activeRecord?.status === 'CORRECTION_REQUIRED'
  const initialDeadline = initialDeadlineFor(draft.date)
  const initialDeadlinePassed = !isRevision && initialDeadline && initialDeadline < new Date()
  const activeInitialExpired = activeRecord?.status === 'DRAFT' && recordIsExpired(activeRecord)
  const activeRevisionExpired = isRevision && recordIsExpired(activeRecord)
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
    const activityRecords = records.filter(r=>r.id===record.id)
    const first = activityRecords[0]
    if (!first) return
    const canEdit = first.status==='DRAFT' || first.status==='CORRECTION_REQUIRED'
    if (!canEdit) return
    if (recordIsExpired(first)){
      setMessage(first.status === 'DRAFT'
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
    if (initialDeadlinePassed) return `Batas pengajuan telah lewat. ${initialDeadlineMessage(draft.date)} Silakan pilih tanggal lembur yang masih berada dalam batas pengajuan 7 hari.`
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
      })
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
      })
    }
    if (!result?.ok || !result.activityId) throw new Error(result?.message || 'Draft Lembur gagal disimpan.')
    setActiveActivityId(result.activityId)
    activeActivityIdRef.current = result.activityId
    if (isWork) setActiveWorkCategory(workCategory)
    return result.activityId
  }

  const stageEvidence = async (requirement, file) => {
    if (!file || initialDeadlinePassed || formReadOnly) return
    setSubmitting(true)
    try {
      const { prepareOvertimeEvidenceFile } = await import('../../data/overtimeEvidenceRepository.js')
      const processed = await prepareOvertimeEvidenceFile(file, requirement.type)
      const staged = {
        id: `${requirement.type}-${Date.now()}-${Math.random()}`,
        processed,
        previewUrl: processed.file.type.startsWith('image/') ? URL.createObjectURL(processed.file) : null,
      }
      setFiles((current) => ({
        ...current,
        [requirement.type]: requirement.allowMultiple
          ? [...(current[requirement.type] ?? []), staged]
          : (() => {
              (current[requirement.type] ?? []).forEach((entry) => {
                if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl)
              })
              return [staged]
            })(),
      }))
      setMessage(`${requirement.label} siap disimpan (${Math.ceil(processed.stored.sizeBytes / 1024)} KB).`)
    } catch (error) {
      setMessage(error.message || `Gagal memproses ${requirement.label}.`)
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
      setMessage('Draft dan evidence berhasil disimpan di Supabase.')
      if(onRefresh) await onRefresh()
    } catch (error) {
      if (activeActivityIdRef.current) await refreshEvidence(activeActivityIdRef.current).catch(() => {})
      setMessage(error.message || 'Draft atau evidence gagal disimpan.')
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
    if (!window.confirm(`Hapus ${entry.originalFilename}?`)) return
    setSubmitting(true)
    try {
      const { deleteOvertimeEvidence } = await import('../../data/overtimeEvidenceRepository.js')
      await deleteOvertimeEvidence(entry.id)
      await refreshEvidence(activeActivityId)
      setMessage('Evidence dihapus.')
    } catch (e) { setMessage(e.message || 'Evidence gagal dihapus.') } finally { setSubmitting(false) }
  }

  const submitDraft = async () => {
    const validation = validateDraft()
    if (validation) { setMessage(validation); return }
    if (!evidenceComplete) { setMessage('Lengkapi seluruh evidence wajib sebelum mengajukan Lembur.'); return }
    setSubmitting(true)
    try {
      const resubmitting = isRevision
      let activityId = activeActivityId
      if (!activityId || dirty) activityId = await persistDraft()
      await uploadStagedEvidence(activityId)
      const result = resubmitting
        ? await resubmitOvertime(activityId)
        : isReplacement
          ? await onSubmit(activityId)
          : await onSubmitWork(activityId)
      if (!resubmitting && !result?.ok) throw new Error(result?.message || 'Lembur gagal diajukan.')
      resetForm()
      setFormOpen(false)
      setMessage(resubmitting ? 'Revisi Lembur berhasil diajukan kembali.' : 'Lembur diajukan dan menunggu approval.')
      if(onRefresh) await onRefresh()
    } catch (error) {
      if (activeActivityIdRef.current) await refreshEvidence(activeActivityIdRef.current).catch(() => {})
      setMessage(error.message || 'Draft, evidence, atau pengajuan Lembur gagal disimpan.')
    } finally { setSubmitting(false) }
  }

  const handleApprove = async (activityId)=>{
    if(!window.confirm('Setujui pengajuan lembur ini?')) return
    setSubmitting(true)
    try{
      const res = await approveOvertime(activityId)
      setMessage(res.message || 'Disetujui')
      if(onRefresh) onRefresh()
      setDetailActivityId(null)
    }catch(e){ setMessage(e.message || 'Gagal menyetujui') } finally{ setSubmitting(false) }
  }
  const handleReject = async (activityId)=>{
    if(!rejectReason.trim()){ setMessage('Alasan penolakan wajib diisi'); return }
    setSubmitting(true)
    try{
      const res = await rejectOvertime(activityId, rejectReason)
      setMessage(res.message || 'Ditolak')
      if(onRefresh) onRefresh()
      setShowReject(null); setRejectReason('')
      setDetailActivityId(null)
    }catch(e){ setMessage(e.message || 'Gagal menolak') } finally{ setSubmitting(false) }
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
  const detailRecords = detailActivityId ? sorted.filter(r=> r.id===detailActivityId) : []
  const detailActivity = detailRecords[0] || null

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

  return (
    <section className="sla-module-panel lembur-l2">
      <div className="lembur-landing-header">
        <div>
          <h1>Lembur Pelayanan Teknik</h1>
          <p>Pengajuan dan rekap lembur pegawai</p>
        </div>
        {canMutate && <button type="button" className="sla-btn sla-btn-primary" onClick={openNewForm}>+ Tambah Lembur</button>}
      </div>
      {loadError ? (
        <div className="placeholder"><h2 className="placeholder-title">Data lembur gagal dimuat</h2><p className="placeholder-text">{loadError}</p><button type="button" className="sla-btn" onClick={onRetry}>Coba Lagi</button></div>
      ) : loading ? (
        <div className="placeholder"><h2 className="placeholder-title">Memuat data lembur...</h2></div>
      ) : (
        <>
          {!formOpen && message && <p className="lembur-message lembur-landing-message">{message}</p>}
          {canMutate && formOpen && (
            <div className="rekap-detail-overlay lembur-form-overlay" onMouseDown={(event)=>{ if(event.target===event.currentTarget) closeForm() }}>
            <div className={`lembur-form-card ${formStep === 'form' ? 'lembur-form-modal-wide' : 'lembur-picker-modal'}`} onMouseDown={(event)=>event.stopPropagation()}>
              {formStep === 'main' ? (
                <>
                  <div className="lembur-modal-header">
                    <div><h2>Tambah Lembur</h2><p>Pilih jenis lembur yang akan diajukan</p></div>
                    <button type="button" className="lembur-icon-button" aria-label="Tutup" onClick={closeForm}>×</button>
                  </div>
                  <div className="lembur-type-grid">
                    <button type="button" className="lembur-type-card" onClick={()=>chooseMainType('REPLACEMENT_LEAVE')}><strong>Pengganti Cuti</strong><span>Pegawai menggantikan petugas yang cuti</span></button>
                    <button type="button" className="lembur-type-card" onClick={()=>chooseMainType('REPLACEMENT_SICK')}><strong>Pengganti Sakit</strong><span>Pegawai menggantikan petugas yang sakit</span></button>
                    <button type="button" className="lembur-type-card" onClick={()=>chooseMainType('REPLACEMENT_PERMISSION')}><strong>Pengganti Izin</strong><span>Pegawai menggantikan petugas yang izin</span></button>
                    <button type="button" className="lembur-type-card" onClick={()=>chooseMainType('WORK')}><strong>Lembur Pekerjaan</strong><span>Lembur untuk pelaksanaan pekerjaan tertentu</span></button>
                  </div>
                </>
              ) : formStep === 'work' ? (
                <>
                  <div className="lembur-modal-header">
                    <div><h2>Pilih Jenis Pekerjaan</h2><p>Tentukan kategori pekerjaan lembur</p></div>
                    <button type="button" className="lembur-icon-button" aria-label="Tutup" onClick={closeForm}>×</button>
                  </div>
                  <div className="lembur-type-grid lembur-work-type-grid">
                    {Object.entries(WORK_CATEGORIES).map(([category, config])=><button type="button" className="lembur-type-card" key={category} onClick={()=>chooseWorkType(category)}><strong>{config.label}</strong><span>Lembur pekerjaan {config.label.toLowerCase()}</span></button>)}
                  </div>
                  <button type="button" className="sla-btn lembur-back-button" onClick={()=>setFormStep('main')}>← Kembali</button>
                </>
              ) : (
              <>
              <div className="lembur-form-heading">
                <div><span className="lembur-kicker">{activeActivityId ? 'Lanjutkan Draft' : 'Tambah Lembur'}</span><h2>{currentTypeLabel}</h2></div>
                <div className="lembur-heading-actions">
                  {!activeActivityId && <button type="button" className="sla-btn" disabled={submitting} onClick={()=>setFormStep(isWork ? 'work' : 'main')}>← Ubah Jenis</button>}
                  {activeActivityId && <button type="button" className="sla-btn" disabled={submitting} onClick={openNewForm}>Draft Baru</button>}
                  <button type="button" className="lembur-icon-button" aria-label="Tutup" onClick={closeForm}>×</button>
                </div>
              </div>

              <fieldset disabled={formReadOnly} className="lembur-form-fieldset">
                <section className="lembur-form-section">
                  <div className="lembur-section-heading"><span>A</span><div><h3>Informasi Lembur</h3><p>Jenis, tanggal, dan keterangan pengajuan</p></div></div>
                  <div className="lembur-form-grid">
                    <div className="sla-context-field"><span className="sla-context-label">Jenis Lembur</span><div className="lembur-readonly-value">{currentTypeLabel}</div></div>
                    <label className="sla-context-field"><span className="sla-context-label">Tanggal Lembur *</span><input type="date" className="sla-context-select" value={draft.date} onChange={e=>updateDraft({ date:e.target.value })} /></label>
                    {draft.date && !isRevision && (initialDeadlinePassed ? (
                      <div className="lembur-deadline-card lembur-deadline-expired"><strong>Batas pengajuan telah lewat.</strong><span>{initialDeadlineMessage(draft.date)}</span><span>Silakan pilih tanggal lembur yang masih berada dalam batas pengajuan 7 hari.</span></div>
                    ) : <div className="lembur-deadline-helper">Batas pengajuan: {formatPontianakDate(initialDeadline)}, 23:59</div>)}
                    {activeRevisionExpired && <div className="lembur-deadline-card lembur-deadline-expired"><strong>Batas revisi telah lewat.</strong><span>Transaksi Lembur sudah kedaluwarsa.</span></div>}
                    {isMultiWork && <><label className="sla-context-field"><span className="sla-context-label">Uraian / Nama Pekerjaan *</span><input className="sla-context-select" value={draft.workTitle} onChange={e=>updateDraft({ workTitle:e.target.value })} placeholder="Contoh: JTM — Tiang Tumbang" /></label><label className="sla-context-field"><span className="sla-context-label">Lokasi *</span><input className="sla-context-select" value={draft.workLocation} onChange={e=>updateDraft({ workLocation:e.target.value })} placeholder="Contoh: Desa Sungai Raya" /></label></>}
                    {isWork && <label className="sla-context-field lembur-grid-full"><span className="sla-context-label">Keterangan Pekerjaan *</span><textarea className="sla-context-select" value={draft.description} onChange={e=>updateDraft({ description:e.target.value })} placeholder="Jelaskan pekerjaan lembur" rows={3} /></label>}
                    {replacementDescription && <div className="lembur-description-preview lembur-grid-full"><span>Keterangan otomatis</span>{replacementDescription}</div>}
                  </div>
                </section>

                <section className="lembur-form-section">
                  <div className="lembur-section-heading"><span>B</span><div><h3>Pegawai & Waktu</h3><p>Peserta, jam kerja, dan durasi otomatis</p></div></div>
                  {isReplacement && <div className="lembur-time-grid">
                    <label className="sla-context-field"><span className="sla-context-label">Pegawai yang Digantikan *</span><select className="sla-context-select" value={draft.replacedEmployeeId} disabled={employeeLoading} onChange={e=>updateDraft({ replacedEmployeeId:e.target.value, participantEmployeeId:'' })}><option value="">{employeeLoading ? 'Memuat pegawai...' : 'Pilih pegawai'}</option>{employeeOptions.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}</select></label>
                    <label className="sla-context-field"><span className="sla-context-label">Pegawai Pengganti *</span><select className="sla-context-select" value={draft.participantEmployeeId} disabled={!replacedEmployee} onChange={e=>updateDraft({ participantEmployeeId:e.target.value })}><option value="">Pilih pegawai pengganti</option>{participantOptions.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}</select></label>
                    <label className="sla-context-field"><span className="sla-context-label">Jam Mulai *</span><input type="time" className="sla-context-select" value={draft.startTime} onChange={e=>updateDraft({ startTime:e.target.value })} /></label>
                    <label className="sla-context-field"><span className="sla-context-label">Jam Selesai *</span><input type="time" className="sla-context-select" value={draft.endTime} onChange={e=>updateDraft({ endTime:e.target.value })} /></label>
                    <div className="lembur-duration-compact"><span>Durasi</span><strong>{range ? formatDurationMinutes(range.durationMinutes) : '–'}</strong>{draft.endTime <= draft.startTime && <small>+1 hari</small>}</div>
                  </div>}
                  {isAdministrasi && (()=>{ const participant=draft.participants[0]; const participantRange=buildPontianakRange(draft.date, participant?.startTime||draft.startTime, participant?.endTime||draft.endTime); return <div className="lembur-time-grid"><label className="sla-context-field"><span className="sla-context-label">Pegawai Lembur *</span><select className="sla-context-select" value={participant?.employeeId || ''} disabled={employeeLoading} onChange={e=>updateParticipant(participant.tempId,{employeeId:e.target.value})}><option value="">{employeeLoading?'Memuat pegawai...':'Pilih pegawai'}</option>{employeeOptions.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}</select></label><label className="sla-context-field"><span className="sla-context-label">Jam Mulai *</span><input type="time" className="sla-context-select" value={participant?.startTime||draft.startTime} onChange={e=>updateParticipant(participant.tempId,{startTime:e.target.value})} /></label><label className="sla-context-field"><span className="sla-context-label">Jam Selesai *</span><input type="time" className="sla-context-select" value={participant?.endTime||draft.endTime} onChange={e=>updateParticipant(participant.tempId,{endTime:e.target.value})} /></label><div className="lembur-duration-compact"><span>Durasi</span><strong>{participantRange?formatDurationMinutes(participantRange.durationMinutes):'–'}</strong>{participant?.endTime<=participant?.startTime&&<small>+1 hari</small>}</div></div>})()}
                  {isMultiWork && <div className="lembur-participants"><div className="lembur-participants-heading"><strong>Peserta Lembur</strong><button type="button" className="sla-btn" onClick={addParticipant}>+ Tambah Pegawai</button></div><div className="lembur-participant-labels"><span>Pegawai</span><span>Jam Mulai</span><span>Jam Selesai</span><span>Durasi</span><span></span></div>{draft.participants.map((participant)=>{ const participantRange=buildPontianakRange(draft.date,participant.startTime,participant.endTime); const otherIds=draft.participants.filter(item=>item.tempId!==participant.tempId).map(item=>item.employeeId); const options=employeeOptions.filter(employee=>!otherIds.includes(employee.id)); return <div key={participant.tempId} className="lembur-participant-row"><select className="sla-context-select" value={participant.employeeId} disabled={employeeLoading} onChange={e=>updateParticipant(participant.tempId,{employeeId:e.target.value})}><option value="">{employeeLoading?'Memuat...':'Pilih pegawai'}</option>{options.map(employee=><option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><input type="time" className="sla-context-select" value={participant.startTime} onChange={e=>updateParticipant(participant.tempId,{startTime:e.target.value})} /><input type="time" className="sla-context-select" value={participant.endTime} onChange={e=>updateParticipant(participant.tempId,{endTime:e.target.value})} /><strong>{participantRange?formatDurationMinutes(participantRange.durationMinutes):'–'}</strong>{draft.participants.length>1?<button type="button" className="lembur-row-remove" aria-label="Hapus peserta" onClick={()=>removeParticipant(participant.tempId)}>×</button>:<span />}</div>})}</div>}
                </section>

                <section className="lembur-form-section">
                  <div className="lembur-section-heading"><span>C</span><div><h3>Evidence</h3><p>File diproses sebelum disimpan, maksimum 1 MB</p></div></div>
                  <div className="lembur-upload-grid">{evidenceRequirements.map((requirement)=>{ const existingList=(evidenceByType[requirement.type]||[]).filter(entry=>entry.status==='ACTIVE'); const stagedList=files[requirement.type]??[]; const hasTimeMark=requirement.helpers?.[0]==='TimeMark Wajib'; return <div className="lembur-upload-card" key={requirement.type}><div className="lembur-upload-card-heading"><strong>{requirement.label} *</strong>{hasTimeMark&&<span className="lembur-timemark-badge">TimeMark Wajib</span>}</div>{requirement.helpers?.slice(hasTimeMark?1:0).map((helper)=><small key={helper}>{helper}</small>)}<label className="lembur-dropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();stageEvidence(requirement,e.dataTransfer.files?.[0])}}><input key={`${requirement.type}-${stagedList.length}-${existingList.length}`} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx" disabled={submitting||initialDeadlinePassed||formReadOnly} onChange={e=>stageEvidence(requirement,e.target.files?.[0])} /><span className="lembur-upload-icon">↑</span><strong>Pilih atau tarik {isImageEvidence({evidenceType:requirement.type})?'foto':'dokumen'} ke sini</strong><small>Maksimal 1 MB</small></label><div className="lembur-selected-files">{stagedList.map((entry)=><div className="lembur-selected-file" key={entry.id}>{entry.previewUrl?<img src={entry.previewUrl} alt="" />:<span className="lembur-doc-icon">DOC</span>}<div><strong>{entry.processed.original.filename}</strong><small>{Math.ceil(entry.processed.stored.sizeBytes/1024)} KB · siap disimpan</small></div><button type="button" className="sla-btn" disabled={submitting||formReadOnly} onClick={()=>removeStagedEvidence(requirement.type,entry.id)}>Hapus</button></div>)}{existingList.map((entry)=><div className="lembur-selected-file" key={entry.id}>{isImageEvidence(entry)&&evidenceUrls[entry.id]?<button type="button" className="lembur-thumb-button" onClick={()=>previewEvidence(entry,existingList)}><img src={evidenceUrls[entry.id]} alt={entry.originalFilename} /></button>:<span className="lembur-doc-icon">DOC</span>}<div><strong>{entry.originalFilename}</strong><small>{(entry.storedSizeBytes/1024).toFixed(0)} KB · tersimpan</small></div><button type="button" className="sla-btn" onClick={()=>previewEvidence(entry,existingList)}>Preview</button><button type="button" className="sla-btn" disabled={submitting||formReadOnly} onClick={()=>removeEvidence(entry)}>Hapus</button></div>)}</div></div>})}</div>
                </section>

                {message && !(initialDeadlinePassed && message.startsWith('Batas pengajuan')) && <p className="lembur-message">{message}</p>}
                <div className="lembur-form-actions"><button type="button" className="sla-btn" disabled={submitting||initialDeadlinePassed||formReadOnly} onClick={saveDraft}>{submitting?'Memproses...':'Simpan Draft'}</button><button type="button" className="sla-btn sla-btn-primary" disabled={submitting||initialDeadlinePassed||formReadOnly||!evidenceComplete} onClick={submitDraft}>Ajukan Lembur</button></div>
              </fieldset>
              </>
              )}
            </div>
            </div>
          )}

          {!canMutate && !isManagement && <p className="sla-blocked-note">Akses ini menampilkan Rekap Lembur dalam scope UP3. Input dan approval tidak tersedia pada tahap ini.</p>}
          {isUlManagement && <p className="sla-blocked-note">Unit Layanan Singkawang · 6 ULP — monitoring read-only (Total Rp, Tarif/Jam, dan rincian 1.5x/2x tersedia di Detail)</p>}
          {isUpManagement && <p className="sla-blocked-note">Unit Pelaksana Kalimantan 1 · 1 Unit Layanan terhubung (Singkawang) · monitoring read-only</p>}
          {isManagement && !records.length && !loading && !loadError && (
            <p className="sla-blocked-note">Belum ada Unit Layanan yang terhubung dengan scope Pelayanan Teknik untuk akun ini.</p>
          )}

          <div className="rekap-filters">
            <label className="sla-context-field">Periode
              <select className="sla-context-select" value={filters.periode} onChange={e=> setFilters(f=>({ ...f, periode: e.target.value }))}>
                <option value="">Semua</option>
                {uniquePeriods.map(p=> <option key={p} value={p.slice(0,7)}>{p}</option>)}
              </select>
            </label>
            {isUpManagement && (
              <label className="sla-context-field">Unit Layanan
                <select className="sla-context-select" value={filters.unitLayanan} onChange={e=> setFilters(f=>({ ...f, unitLayanan: e.target.value }))}>
                  <option value="">Semua</option>
                  {unitLayananOptions.map(u=> <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            )}
            {(isManagement || !canMutate) && (
              <label className="sla-context-field">ULP
                <select className="sla-context-select" value={filters.ulp} onChange={e=> setFilters(f=>({ ...f, ulp: e.target.value }))}>
                  <option value="">Semua</option>
                  {(orgUnits||[]).filter(u=>u.type==='ULP' || u.type==='ULP').map(u=> <option key={u.uuid} value={u.uuid}>{u.displayName}</option>)}
                </select>
              </label>
            )}
            <label className="sla-context-field">Jenis
              <select className="sla-context-select" value={filters.jenis} onChange={e=> setFilters(f=>({ ...f, jenis: e.target.value }))}>
                <option value="Semua">Semua</option>
                <option value="Pengganti Cuti">Pengganti Cuti</option>
                <option value="Pengganti Sakit">Pengganti Sakit</option>
                <option value="Pengganti Izin">Pengganti Izin</option>
                <option value="Administrasi">Administrasi</option>
                <option value="Gardu">Gardu</option>
                <option value="JTM">JTM</option>
                <option value="JTR">JTR</option>
              </select>
            </label>
            <label className="sla-context-field">Pegawai
              <input className="sla-context-select" value={filters.pegawai} onChange={e=> setFilters(f=>({ ...f, pegawai: e.target.value }))} placeholder="Cari pegawai" />
            </label>
            <label className="sla-context-field">Status
              <select className="sla-context-select" value={filters.status} onChange={e=> setFilters(f=>({ ...f, status: e.target.value }))}>
                <option value="Semua">Semua</option>
                {uniqueStatuses.map(s=> <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <div className="lembur-rekap-heading"><span className="lembur-kicker">Rekap Lembur</span><strong>{filtered.length} baris pegawai</strong></div>

          <div className="sla-table-wrap">
            <table className="sla-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  {!canMutate && <th>ULP</th>}
                  <th>Jenis</th><th>Pegawai</th><th>Waktu/Jam</th><th>Total Rp</th><th>Keterangan</th><th>Status</th><th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {!paginated.length && <tr><td colSpan={!canMutate ? 9 : 8}>Belum ada record Lembur pada periode ini.</td></tr>}
                {paginated.map(record=>{
                  const time = pontianakFormValues(record.startedAt, record.endedAt)
                  const jenis = record.type==='WORK' ? (WORK_CATEGORIES[record.workCategory]?.label || record.workCategory) : (REPLACEMENT_TYPES[record.type]?.label || record.type)
                  const ulpName = !canMutate ? getUlpName(record.unitId) : null
                  const canEdit = record.status==='DRAFT' || record.status==='CORRECTION_REQUIRED'
                  const isExpired = recordIsExpired(record)
                  const display = displayStatus(record)
                  return (
                    <tr key={`${record.id}-${record.entryId}`}>
                      <td>{record.date}</td>
                      {!canMutate && <td>{ulpName}</td>}
                      <td>{jenis}</td>
                      <td>{record.participantName}</td>
                      <td>{time.startTime}–{time.endTime}{time.endTime <= time.startTime ? ' (+1 hari)' : ''} · {formatDurationMinutes(record.durationHours*60)}</td>
                      <td>Rp {formatRp(record.total)}</td>
                      <td><span className="rekap-keterangan">{record.description}</span></td>
                      <td><span className={`status-badge status-${record.status}`}>{display}</span>{record.status==='CORRECTION_REQUIRED' && record.revisionDeadlineAt && <><br/><small>Batas: {new Date(record.revisionDeadlineAt).toLocaleString('id-ID', { timeZone: 'Asia/Pontianak' })}</small>{record.rejectionCount===2 && <small style={{display:'block', color:'#842029', fontWeight:700}}>REVISI TERAKHIR</small>}</>}</td>
                      <td>
                        <div style={{display:'flex', gap:'6px', flexWrap:'wrap'}}>
                          {canMutate && canEdit && !isExpired && <button type="button" className="sla-btn" disabled={submitting} onClick={()=>editDraft(record)}>Lanjutkan Draft</button>}
                          <button type="button" className="sla-btn" onClick={()=>setDetailActivityId(record.id)}>Lihat Detail</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="rekap-pagination">
            <span>{filtered.length} data · Halaman {currentPage} dari {totalPages}</span>
            <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
              <button type="button" className="sla-btn" disabled={currentPage<=1} onClick={()=>setCurrentPage(p=>Math.max(1,p-1))}>Prev</button>
              <button type="button" className="sla-btn" disabled={currentPage>=totalPages} onClick={()=>setCurrentPage(p=>Math.min(totalPages,p+1))}>Next</button>
              <label>Baris per halaman
                <select className="sla-context-select" value={rowsPerPage} onChange={e=>setRowsPerPage(Number(e.target.value))} style={{marginLeft:'6px'}}>
                  <option value={10}>10</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                </select>
              </label>
            </div>
          </div>
          {detailActivityId && (
            <div className="rekap-detail-overlay" data-approval-id={detailActivityId} onClick={()=>{setDetailActivityId(null);setShowReject(null);setRejectReason('')}}>
              <div className="rekap-detail-modal lembur-detail-modal" onClick={e=>e.stopPropagation()}>
                {detailActivity && (
                  <>
                    <div className="lembur-detail-header">
                      <div><span className="lembur-kicker">Detail Lembur</span><h2>{jenisLabel(detailActivity)}</h2><p>{!canMutate ? `${getUlpName(detailActivity.unitId)} · ` : ''}{detailActivity.date}</p></div>
                      <div className="lembur-detail-header-actions"><span className={`status-badge status-${detailActivity.status}`}>{displayStatus(detailActivity)}</span><button type="button" className="lembur-icon-button" aria-label="Tutup" onClick={()=>{setDetailActivityId(null);setShowReject(null);setRejectReason('')}}>×</button></div>
                    </div>
                    {detailActivity.revisionDeadlineAt && detailActivity.status==='CORRECTION_REQUIRED' && <div className="lembur-detail-alert"><strong>Batas Revisi</strong><span>{new Date(detailActivity.revisionDeadlineAt).toLocaleString('id-ID',{timeZone:'Asia/Pontianak'})} · sisa {Math.max(0,Math.ceil((new Date(detailActivity.revisionDeadlineAt)-new Date())/3600000))} jam</span>{detailActivity.rejectionCount===2&&<small>Revisi terakhir. Jika ditolak kembali, status menjadi Ditolak Final.</small>}</div>}
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
                    <section className="lembur-detail-section"><h3>Riwayat</h3>
                      {detailHistory.length ? (
                        <div className="lembur-history-timeline">
                          {detailHistory.map(h=>(
                            <div key={h.id} className="lembur-history-item">
                              <span className="lembur-history-dot" /><div><small>{new Date(h.occurred_at).toLocaleString('id-ID',{timeZone:'Asia/Pontianak'})} · {h.actor_user_id?.slice(0,8)}</small><strong>{h.event}</strong><p>{h.previous_status} → {h.new_status}{h.reason&&` · ${h.reason}`}</p>{h.notes&&<p>{h.notes}</p>}</div>
                            </div>
                          ))}
                        </div>
                      ) : <div className="lembur-detail-empty">Belum ada riwayat.</div>}
                    </section>
                    {(isAdminUp3||isSuperAdmin) && detailActivity.status==='SUBMITTED' && (
                      <section className="lembur-detail-section lembur-approval-section"><h3>Approval</h3>{showReject===detailActivity.id&&<div className="lembur-reject-box"><label className="sla-context-field"><span className="sla-context-label">Alasan Penolakan *</span><textarea className="sla-context-select" rows={3} value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="Jelaskan bagian yang perlu diperbaiki" /></label><div><button type="button" className="sla-btn" onClick={()=>{setShowReject(null);setRejectReason('')}}>Batal</button><button type="button" className="sla-btn" disabled={submitting||!rejectReason.trim()} onClick={()=>handleReject(detailActivity.id)}>Kirim Penolakan</button></div></div>}<div className="lembur-approval-actions"><button type="button" className="sla-btn" disabled={submitting} onClick={()=>setShowReject(detailActivity.id)}>Tolak Pengajuan</button><button type="button" className="sla-btn sla-btn-primary" disabled={submitting} onClick={()=>handleApprove(detailActivity.id)}>Setujui</button></div></section>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          {evidencePreview && <div className="lembur-preview-overlay" onClick={()=>setEvidencePreview(null)}><div className="lembur-preview-modal" onClick={event=>event.stopPropagation()}><div className="lembur-preview-header"><div><strong>{evidenceLabel(evidencePreview.entry.evidenceType)}</strong><span>{evidencePreview.entry.originalFilename}</span></div><button type="button" className="lembur-icon-button" aria-label="Tutup preview" onClick={()=>setEvidencePreview(null)}>×</button></div><div className="lembur-preview-body">{evidencePreview.loading?<div className="lembur-detail-empty">Menyiapkan preview aman...</div>:isImageEvidence(evidencePreview.entry)?<img src={evidencePreview.url} alt={evidencePreview.entry.originalFilename} />:isPdfEvidence(evidencePreview.entry)?<iframe src={evidencePreview.url} title={evidencePreview.entry.originalFilename} />:<div className="lembur-document-fallback"><span className="lembur-doc-icon">DOC</span><strong>Pratinjau dokumen tidak didukung browser.</strong><p>Dokumen tetap tersimpan aman. Tutup viewer untuk kembali ke Detail Lembur.</p></div>}</div>{isImageEvidence(evidencePreview.entry)&&evidencePreview.entries.length>1&&<div className="lembur-preview-nav"><button type="button" className="sla-btn" onClick={()=>moveEvidencePreview(-1)}>← Sebelumnya</button><span>{evidencePreview.index+1} / {evidencePreview.entries.length}</span><button type="button" className="sla-btn" onClick={()=>moveEvidencePreview(1)}>Berikutnya →</button></div>}</div></div>}
        </>
      )}
    </section>
  )
}
