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
  const [filters, setFilters] = useState({ ulp: '', jenis: 'Semua', pegawai: '', status: 'Semua', periode: '' })
  const [rowsPerPage, setRowsPerPage] = useState(30)
  const [currentPage, setCurrentPage] = useState(1)
  const [detailActivityId, setDetailActivityId] = useState(null)
  const [detailEvidence, setDetailEvidence] = useState([])
  const [detailHistory, setDetailHistory] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(null)

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

  const updateDraft = (patch) => {
    setDraft(c=>({ ...c, ...patch }))
    setDirty(true)
    setMessage(null)
  }

  const resetForm = () => {
    setDraft(initialDraft(periodMonth))
    setActiveActivityId(null)
    setActiveWorkCategory(null)
    setEvidence([])
    setFiles({})
    setDirty(true)
    setMessage(null)
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
      const staged = { id: `${requirement.type}-${Date.now()}-${Math.random()}`, processed }
      setFiles((current) => ({
        ...current,
        [requirement.type]: requirement.allowMultiple
          ? [...(current[requirement.type] ?? []), staged]
          : [staged],
      }))
      setMessage(`${requirement.label} siap disimpan (${Math.ceil(processed.stored.sizeBytes / 1024)} KB).`)
    } catch (error) {
      setMessage(error.message || `Gagal memproses ${requirement.label}.`)
    } finally {
      setSubmitting(false)
    }
  }

  const removeStagedEvidence = (evidenceType, stagedId) => {
    setFiles((current) => ({
      ...current,
      [evidenceType]: (current[evidenceType] ?? []).filter((item) => item.id !== stagedId),
    }))
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

  const previewEvidence = async (entry) => {
    const preview = window.open('about:blank','_blank')
    if (!preview) { setMessage('Browser memblokir jendela preview. Izinkan pop-up untuk aplikasi ini.'); return }
    preview.opener=null
    try {
      const { createOvertimeEvidenceSignedUrl } = await import('../../data/overtimeEvidenceRepository.js')
      const signed = await createOvertimeEvidenceSignedUrl(entry.id)
      preview.location.replace(signed.signedUrl)
    } catch (e) { preview.close(); setMessage(e.message || 'Preview evidence gagal.') }
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
  const filtered = sorted.filter(r=>{
    if (filters.jenis !== 'Semua' && jenisLabel(r) !== filters.jenis) return false
    if (filters.status !== 'Semua' && displayStatus(r) !== filters.status) return false
    if (filters.pegawai && !String(r.participantName||'').toLowerCase().includes(filters.pegawai.toLowerCase())) return false
    if (filters.ulp && String(r.unitId||'') !== filters.ulp) return false
    if (filters.periode && String(r.periodMonth||'').slice(0,7) !== filters.periode && String(r.date||'').slice(0,7) !== filters.periode) return false
    return true
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage))
  const paginated = filtered.slice((currentPage-1)*rowsPerPage, currentPage*rowsPerPage)
  useEffect(()=>{ setCurrentPage(1) }, [filters, rowsPerPage, records.length])
  useEffect(()=>{
    if (!detailActivityId) { setDetailEvidence([]); setDetailHistory([]); return }
    let cancelled=false
    setDetailLoading(true)
    Promise.all([
      import('../../data/overtimeEvidenceRepository.js').then(m=>m.listOvertimeEvidence(detailActivityId)),
      listOvertimeHistory(detailActivityId).catch(()=>[])
    ]).then(([evs, hist])=>{ if(!cancelled){ setDetailEvidence(evs); setDetailHistory(hist||[]) } }).catch(()=>{ if(!cancelled){ setDetailEvidence([]); setDetailHistory([]) } }).finally(()=>{ if(!cancelled) setDetailLoading(false) })
    return ()=>{ cancelled=true }
  }, [detailActivityId])
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
    setFiles({})
    setDirty(true)
    setMessage(null)
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

  return (
    <section className="sla-module-panel lembur-l2">
      <div className="sla-export-bar">
        <span className="sla-export-scope">Lembur Pengganti dan Pekerjaan. Waktu bisnis: Asia/Pontianak.</span>
      </div>
      {loadError ? (
        <div className="placeholder"><h2 className="placeholder-title">Data lembur gagal dimuat</h2><p className="placeholder-text">{loadError}</p><button type="button" className="sla-btn" onClick={onRetry}>Coba Lagi</button></div>
      ) : loading ? (
        <div className="placeholder"><h2 className="placeholder-title">Memuat data lembur...</h2></div>
      ) : (
        <>
          {canMutate && (
            <div className="lembur-form-card">
              <div className="lembur-form-heading">
                <div><span className="lembur-kicker">Tambah Lembur</span><h2>{activeActivityId ? 'Lanjutkan Draft' : 'Transaksi Lembur'}</h2></div>
                {activeActivityId && <button type="button" className="sla-btn" disabled={submitting} onClick={resetForm}>Draft Baru</button>}
              </div>

              <fieldset disabled={formReadOnly} style={{border:0, padding:0, margin:0, minWidth:0}}>
              <div className="lembur-form-grid">
                <label className="sla-context-field">
                  <span className="sla-context-label">Jenis Lembur *</span>
                  <select className="sla-context-select" value={draft.lemburType} onChange={e=>changeType(e.target.value)}>
                    <option value="">Pilih jenis lembur</option>
                    <optgroup label="Pengganti">
                      {Object.entries(REPLACEMENT_TYPES).map(([v,c])=> <option key={v} value={v}>{c.label}</option>)}
                    </optgroup>
                    <optgroup label="Pekerjaan">
                      {Object.entries(WORK_CATEGORIES).map(([k,c])=> <option key={k} value={`WORK:${k}`}>{c.label}</option>)}
                    </optgroup>
                  </select>
                </label>
                <label className="sla-context-field">
                  <span className="sla-context-label">Tanggal Lembur *</span>
                  <input type="date" className="sla-context-select" value={draft.date} onChange={e=>updateDraft({ date:e.target.value })} />
                </label>
                {draft.date && !isRevision && (
                  <div style={{gridColumn:'1 / -1', color: initialDeadlinePassed ? '#842029' : '#5f4b2e', fontSize:'13px'}}>
                    {initialDeadlinePassed ? (
                      <><strong>Batas pengajuan telah lewat.</strong> {initialDeadlineMessage(draft.date)} Silakan pilih tanggal lembur yang masih berada dalam batas pengajuan 7 hari.</>
                    ) : (
                      <>Batas pengajuan: {formatPontianakDate(initialDeadline)}, 23:59</>
                    )}
                  </div>
                )}

                {isReplacement && (
                  <>
                    <label className="sla-context-field">
                      <span className="sla-context-label">Pegawai yang Digantikan *</span>
                      <select className="sla-context-select" value={draft.replacedEmployeeId} disabled={employeeLoading} onChange={e=>updateDraft({ replacedEmployeeId:e.target.value, participantEmployeeId:'' })}>
                        <option value="">{employeeLoading ? 'Memuat pegawai...' : 'Pilih pegawai'}</option>
                        {employeeOptions.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                      </select>
                    </label>
                    <label className="sla-context-field">
                      <span className="sla-context-label">Pegawai yang Lembur / Pengganti *</span>
                      <select className="sla-context-select" value={draft.participantEmployeeId} disabled={!replacedEmployee} onChange={e=>updateDraft({ participantEmployeeId:e.target.value })}>
                        <option value="">Pilih pegawai pengganti</option>
                        {participantOptions.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                      </select>
                    </label>
                    <label className="sla-context-field">
                      <span className="sla-context-label">Jam Mulai *</span>
                      <input type="time" className="sla-context-select" value={draft.startTime} onChange={e=>updateDraft({ startTime:e.target.value })} />
                    </label>
                    <label className="sla-context-field">
                      <span className="sla-context-label">Jam Selesai *</span>
                      <input type="time" className="sla-context-select" value={draft.endTime} onChange={e=>updateDraft({ endTime:e.target.value })} />
                    </label>
                  </>
                )}

                {isWork && (
                  <>
                    {isMultiWork && (
                      <>
                        <label className="sla-context-field">
                          <span className="sla-context-label">Uraian / Nama Pekerjaan *</span>
                          <input className="sla-context-select" value={draft.workTitle} onChange={e=>updateDraft({ workTitle:e.target.value })} placeholder="Contoh: JTM — Tiang Tumbang" />
                        </label>
                        <label className="sla-context-field">
                          <span className="sla-context-label">Lokasi *</span>
                          <input className="sla-context-select" value={draft.workLocation} onChange={e=>updateDraft({ workLocation:e.target.value })} placeholder="Contoh: Desa Sungai Raya" />
                        </label>
                      </>
                    )}
                    <label className="sla-context-field" style={{gridColumn:'1 / -1'}}>
                      <span className="sla-context-label">Keterangan Pekerjaan *</span>
                      <textarea className="sla-context-select" value={draft.description} onChange={e=>updateDraft({ description:e.target.value })} placeholder="Jelaskan pekerjaan lembur" rows={2} style={{resize:'vertical'}} />
                    </label>
                    {isAdministrasi ? (
                      <>
                        <label className="sla-context-field">
                          <span className="sla-context-label">Pegawai Lembur *</span>
                          <select className="sla-context-select" value={draft.participants[0]?.employeeId || ''} disabled={employeeLoading} onChange={e=>updateParticipant(draft.participants[0].tempId, { employeeId:e.target.value })}>
                            <option value="">{employeeLoading?'Memuat pegawai...':'Pilih pegawai'}</option>
                            {employeeOptions.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                          </select>
                        </label>
                        <label className="sla-context-field">
                          <span className="sla-context-label">Jam Mulai *</span>
                          <input type="time" className="sla-context-select" value={draft.participants[0]?.startTime || draft.startTime} onChange={e=>updateParticipant(draft.participants[0].tempId, { startTime:e.target.value })} />
                        </label>
                        <label className="sla-context-field">
                          <span className="sla-context-label">Jam Selesai *</span>
                          <input type="time" className="sla-context-select" value={draft.participants[0]?.endTime || draft.endTime} onChange={e=>updateParticipant(draft.participants[0].tempId, { endTime:e.target.value })} />
                        </label>
                        <div className="lembur-duration-strip" style={{gridColumn:'1 / -1'}}>
                          <span>Durasi otomatis</span><strong>{(() => {
                            const p=draft.participants[0]; const r=buildPontianakRange(draft.date, p?.startTime||draft.startTime, p?.endTime||draft.endTime); return r?formatDurationMinutes(r.durationMinutes):'–'
                          })()}</strong>
                          {(() => {
                            const p=draft.participants[0]; const st=p?.startTime||draft.startTime; const en=p?.endTime||draft.endTime; return st && en && en <= st ? <small>Selesai pada hari berikutnya</small> : null
                          })()}
                        </div>
                      </>
                    ) : (
                      <div style={{gridColumn:'1 / -1'}}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', margin:'8px 0'}}>
                          <span className="lembur-kicker">Peserta ({draft.participants.length})</span>
                          <button type="button" className="sla-btn" onClick={addParticipant}>+ Tambah Pegawai</button>
                        </div>
                        {draft.participants.map((p, idx)=> {
                          const r = buildPontianakRange(draft.date, p.startTime, p.endTime)
                          const otherIds = draft.participants.filter(x=>x.tempId!==p.tempId).map(x=>x.employeeId)
                          const options = employeeOptions.filter(emp=> !otherIds.includes(emp.id))
                          return (
                            <div key={p.tempId} className="lembur-participant-row" style={{display:'grid', gridTemplateColumns:'1.2fr 0.7fr 0.7fr auto', gap:'8px', alignItems:'end', marginBottom:'10px', padding:'10px', border:'1px solid #dfe7ec', borderRadius:'8px', background:'#fff'}}>
                              <label className="sla-context-field" style={{margin:0}}>
                                <span className="sla-context-label">Pegawai *</span>
                                <select className="sla-context-select" value={p.employeeId} disabled={employeeLoading} onChange={e=>updateParticipant(p.tempId, { employeeId:e.target.value })}>
                                  <option value="">{employeeLoading?'Memuat...':'Pilih pegawai'}</option>
                                  {options.map(emp=> <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                                </select>
                              </label>
                              <label className="sla-context-field" style={{margin:0}}>
                                <span className="sla-context-label">Jam Mulai *</span>
                                <input type="time" className="sla-context-select" value={p.startTime} onChange={e=>updateParticipant(p.tempId, { startTime:e.target.value })} />
                              </label>
                              <label className="sla-context-field" style={{margin:0}}>
                                <span className="sla-context-label">Jam Selesai *</span>
                                <input type="time" className="sla-context-select" value={p.endTime} onChange={e=>updateParticipant(p.tempId, { endTime:e.target.value })} />
                              </label>
                              <div style={{display:'flex', gap:'6px', alignItems:'center'}}>
                                <span style={{fontSize:'13px', color:'#5f4b2e', minWidth:'90px'}}>{r?formatDurationMinutes(r.durationMinutes):'–'}</span>
                                {draft.participants.length>1 && <button type="button" className="sla-btn" onClick={()=>removeParticipant(p.tempId)}>Hapus</button>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

              {isReplacement && range && (
                <div className="lembur-duration-strip">
                  <span>Durasi otomatis</span><strong>{formatDurationMinutes(range.durationMinutes)}</strong>
                  {draft.endTime <= draft.startTime && <small>Selesai pada hari berikutnya</small>}
                </div>
              )}
              {replacementDescription && <p className="lembur-description-preview">{replacementDescription}</p>}

              {evidenceRequirements.length > 0 && (
                <div className="lembur-evidence-panel">
                  <div><span className="lembur-kicker">Evidence Wajib</span><p>Pilih file sekarang. File diproses di browser dan baru disimpan ke private Storage saat Simpan Draft atau Ajukan Lembur, maksimum 1 MB per evidence.</p></div>
                  {evidenceRequirements.map(req=>{
                    const allowMultiple = req.allowMultiple
                    const existingList = (evidenceByType[req.type]||[]).filter(r=>r.status==='ACTIVE')
                    const existingSingle = evidenceSingle[req.type]
                    const stagedList = files[req.type] ?? []
                    return (
                      <div className="lembur-evidence-row" key={req.type}>
                        <div style={{minWidth:'220px', flex:1}}>
                          <strong>{req.label} *</strong>
                          {req.helpers && <div style={{marginTop:'6px'}}>{req.helpers.map((h,i)=><small key={i} style={{display:'block', color:'#5f4b2e'}}>{h}</small>)}</div>}
                          {!allowMultiple && <small>{stagedList[0] ? `${stagedList[0].processed.original.filename} · ${Math.ceil(stagedList[0].processed.stored.sizeBytes/1024)} KB · siap disimpan` : existingSingle ? `${existingSingle.originalFilename} · ${(existingSingle.storedSizeBytes/1024).toFixed(0)} KB · tersimpan` : 'Belum lengkap'}</small>}
                          {allowMultiple && <small>{existingList.length + stagedList.length ? `${existingList.length} foto tersimpan · ${stagedList.length} foto siap disimpan` : 'Belum ada foto'}</small>}
                        </div>
                        <input key={`${req.type}-${stagedList.length}-${existingSingle?.id ?? 'empty'}-${existingList.length}`} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx" disabled={submitting || initialDeadlinePassed || formReadOnly} onChange={e=>stageEvidence(req, e.target.files?.[0] ?? null)} />
                        {stagedList.map((entry) => (
                          <div key={entry.id} style={{display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap'}}>
                            <span style={{fontSize:'12px'}}>{entry.processed.original.filename} · {Math.ceil(entry.processed.stored.sizeBytes/1024)} KB · siap disimpan</span>
                            <button type="button" className="sla-btn" disabled={submitting || formReadOnly} onClick={()=>removeStagedEvidence(req.type, entry.id)}>Batal</button>
                          </div>
                        ))}
                        {!allowMultiple && existingSingle && <button type="button" className="sla-btn" onClick={()=>previewEvidence(existingSingle)}>Preview</button>}
                        {!allowMultiple && existingSingle && <button type="button" className="sla-btn" disabled={submitting || formReadOnly} onClick={()=>removeEvidence(existingSingle)}>Hapus</button>}
                        {allowMultiple && existingList.map(entry=> (
                          <div key={entry.id} style={{display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap'}}>
                            <span style={{fontSize:'12px'}}>{entry.originalFilename}</span>
                            <button type="button" className="sla-btn" onClick={()=>previewEvidence(entry)}>Preview</button>
                            <button type="button" className="sla-btn" disabled={submitting || formReadOnly} onClick={()=>removeEvidence(entry)}>Hapus</button>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
              {message && <p className="lembur-message">{message}</p>}
              {(initialDeadlinePassed || formReadOnly) && (
                <p className="lembur-message">
                  <strong>{activeRevisionExpired ? 'Batas revisi telah lewat.' : 'Batas pengajuan telah lewat.'}</strong>{' '}
                  {activeRevisionExpired ? 'Transaksi Lembur sudah kedaluwarsa.' : `${initialDeadlineMessage(draft.date)} Transaksi ini tidak dapat diubah atau diajukan.`}
                </p>
              )}
              <div className="lembur-form-actions">
                <button type="button" className="sla-btn" disabled={submitting || initialDeadlinePassed || formReadOnly} onClick={saveDraft}>{submitting ? 'Memproses...' : 'Simpan Draft'}</button>
                <button type="button" className="sla-btn sla-btn-primary" disabled={submitting || initialDeadlinePassed || formReadOnly || !evidenceComplete} onClick={submitDraft}>Ajukan Lembur</button>
              </div>
              </fieldset>
            </div>
          )}

          {!canMutate && <p className="sla-blocked-note">Akses ini menampilkan Rekap Lembur dalam scope UP3. Input dan approval tidak tersedia pada tahap ini.</p>}

          <div className="rekap-filters">
            <label className="sla-context-field">Periode
              <select className="sla-context-select" value={filters.periode} onChange={e=> setFilters(f=>({ ...f, periode: e.target.value }))}>
                <option value="">Semua</option>
                {uniquePeriods.map(p=> <option key={p} value={p.slice(0,7)}>{p}</option>)}
              </select>
            </label>
            {!canMutate && (
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
            <div className="rekap-detail-overlay" onClick={()=>setDetailActivityId(null)}>
              <div className="rekap-detail-modal" onClick={e=>e.stopPropagation()}>
                <div className="rekap-detail-header">
                  <h3>Detail Lembur — {detailActivity ? (detailActivity.type==='WORK' ? (WORK_CATEGORIES[detailActivity.workCategory]?.label || detailActivity.workCategory) : (REPLACEMENT_TYPES[detailActivity.type]?.label || detailActivity.type)) : ''}</h3>
                  <button type="button" className="sla-btn" onClick={()=>setDetailActivityId(null)}>Tutup</button>
                </div>
                {detailActivity && (
                  <>
                    <div className="rekap-detail-grid">
                      <div><strong>Tanggal</strong><div>{detailActivity.date}</div></div>
                      {!canMutate && <div><strong>ULP</strong><div>{getUlpName(detailActivity.unitId)}</div></div>}
                      <div><strong>Status</strong><div>{displayStatus(detailActivity)}</div></div>
                      <div><strong>Keterangan</strong><div>{detailActivity.description}</div></div>
                      {detailActivity.workTitle && <div><strong>Uraian</strong><div>{detailActivity.workTitle}</div></div>}
                      {detailActivity.workLocation && <div><strong>Lokasi</strong><div>{detailActivity.workLocation}</div></div>}
                      {detailActivity.revisionDeadlineAt && detailActivity.status==='CORRECTION_REQUIRED' && <div><strong>Batas Revisi</strong><div>{new Date(detailActivity.revisionDeadlineAt).toLocaleString('id-ID', { timeZone: 'Asia/Pontianak' })}<br/><small>Sisa waktu: {Math.max(0, Math.ceil((new Date(detailActivity.revisionDeadlineAt) - new Date())/3600000))} jam</small>{detailActivity.rejectionCount===2 && <div style={{color:'#842029', fontWeight:700}}>REVISI TERAKHIR — Ini kesempatan terakhir. Jika ditolak kembali, status menjadi Ditolak Final.</div>}</div></div>}
                    </div>
                    <div style={{marginTop:'12px'}}>
                      <strong>Peserta ({detailRecords.length})</strong>
                      <table className="sla-table" style={{marginTop:'8px'}}>
                        <thead><tr><th>Pegawai</th><th>Waktu/Jam</th><th>Total Rp</th>{(isAdminUp3||isSuperAdmin) && <th>Tarif/Jam</th>}{(isAdminUp3||isSuperAdmin) && <th>Rincian</th>}</tr></thead>
                        <tbody>
                          {detailRecords.map(r=>{
                            const t = pontianakFormValues(r.startedAt, r.endedAt)
                            // For ADMIN_ULP, hide rate; for ADMIN_UP3 show if available via separate fetch? We keep hidden for now, but show total only. To preserve server rule, we don't fetch rate for ADMIN_ULP.
                            return <tr key={r.entryId}><td>{r.participantName}</td><td>{t.startTime}–{t.endTime} · {formatDurationMinutes(r.durationHours*60)}</td><td>Rp {formatRp(r.total)}</td>{(isAdminUp3||isSuperAdmin) && <td>—</td>}{(isAdminUp3||isSuperAdmin) && <td>—</td>}</tr>
                          })}
                        </tbody>
                      </table>
                      {(isAdminUp3||isSuperAdmin) && <small>Tarif/Jam dan rincian 1.5x/2x tersedia via Detail sesuai kewenangan.</small>}
                    </div>
                    <div style={{marginTop:'12px'}}>
                      <strong>Evidence</strong>
                      {detailLoading ? <div>Memuat evidence...</div> : detailEvidence.length ? (
                        <div style={{display:'grid', gap:'8px', marginTop:'8px'}}>
                          {detailEvidence.filter(e=>e.status==='ACTIVE').map(ev=>(
                            <div key={ev.id} style={{display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', border:'1px solid #dfe7ec', padding:'8px', borderRadius:'6px'}}>
                              <span style={{minWidth:'160px'}}>{ev.evidenceType} — {ev.originalFilename} · {(ev.storedSizeBytes/1024).toFixed(0)} KB</span>
                              <button type="button" className="sla-btn" onClick={async()=>{
                                const { createOvertimeEvidenceSignedUrl } = await import('../../data/overtimeEvidenceRepository.js')
                                const s = await createOvertimeEvidenceSignedUrl(ev.id)
                                const w = window.open('about:blank','_blank'); if(w){ w.opener=null; w.location.replace(s.signedUrl) }
                              }}>Preview</button>
                            </div>
                          ))}
                        </div>
                      ) : <div>Belum ada evidence.</div>}
                    </div>
                    <div style={{marginTop:'12px'}}>
                      <strong>Riwayat</strong>
                      {detailHistory.length ? (
                        <div style={{display:'grid', gap:'8px', marginTop:'8px'}}>
                          {detailHistory.map(h=>(
                            <div key={h.id} style={{borderLeft:'3px solid #174b63', padding:'8px 12px', background:'#f8fbfc'}}>
                              <div style={{fontSize:'12px', color:'#5f4b2e'}}>{new Date(h.occurred_at).toLocaleString('id-ID', { timeZone: 'Asia/Pontianak' })} — {h.actor_user_id?.slice(0,8)}</div>
                              <div><strong>{h.event}</strong> {h.previous_status} → {h.new_status} {h.reason && <span>— {h.reason}</span>}</div>
                              {h.notes && <div style={{fontSize:'12px'}}>{h.notes}</div>}
                            </div>
                          ))}
                        </div>
                      ) : <div>Belum ada riwayat.</div>}
                    </div>
                    {(isAdminUp3||isSuperAdmin) && detailActivity.status==='SUBMITTED' && (
                      <div style={{marginTop:'16px', display:'flex', gap:'8px', flexWrap:'wrap', alignItems:'center'}}>
                        <button type="button" className="sla-btn sla-btn-primary" disabled={submitting} onClick={()=>handleApprove(detailActivity.id)}>Setujui</button>
                        <input className="sla-context-select" placeholder="Alasan penolakan *" value={rejectReason} onChange={e=>setRejectReason(e.target.value)} style={{flex:1, minWidth:'200px'}} />
                        <button type="button" className="sla-btn" disabled={submitting || !rejectReason.trim()} onClick={()=>handleReject(detailActivity.id)}>Tolak Pengajuan</button>
                      </div>
                    )}
                    {showReject && <div style={{marginTop:'8px', color:'#842029'}}>{showReject}</div>}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
