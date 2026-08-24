import { useEffect, useRef, useState } from 'react'
import { listReplacementEmployees } from '../../data/overtimeReplacementRepository.js'
import {
  automaticReplacementDescription,
  buildPontianakRange,
  formatDurationMinutes,
  pontianakFormValues,
  REPLACEMENT_TYPES,
} from '../../data/overtimeReplacementL2.js'

const formatRp = (value) => Number(value ?? 0).toLocaleString('id-ID', {
  maximumFractionDigits: 0,
})

const initialDraft = (periodMonth) => ({
  type: '',
  date: periodMonth ?? '',
  replacedEmployeeId: '',
  participantEmployeeId: '',
  startTime: '08:00',
  endTime: '16:00',
})

function statusLabel(status) {
  if (status === 'SUBMITTED') return 'MENUNGGU APPROVAL'
  return status
}

export default function SLALembur({
  contractScope,
  up3Id,
  unitId,
  periodMonth,
  records,
  canMutate,
  loading,
  loadError,
  onRetry,
  onSaveDraft,
  onSubmit,
}) {
  const [draft, setDraft] = useState(() => initialDraft(periodMonth))
  const [activeActivityId, setActiveActivityId] = useState(null)
  const [employeeOptions, setEmployeeOptions] = useState([])
  const [employeeLoading, setEmployeeLoading] = useState(false)
  const [evidence, setEvidence] = useState([])
  const [files, setFiles] = useState({})
  const [message, setMessage] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [dirty, setDirty] = useState(true)
  const activeActivityIdRef = useRef(activeActivityId)
  activeActivityIdRef.current = activeActivityId

  const range = buildPontianakRange(draft.date, draft.startTime, draft.endTime)
  const replacedEmployee = employeeOptions.find((entry) => entry.id === draft.replacedEmployeeId)
  const participantEmployee = employeeOptions.find((entry) => entry.id === draft.participantEmployeeId)
  const participantOptions = replacedEmployee
    ? employeeOptions.filter((entry) => entry.unitId === replacedEmployee.unitId && entry.id !== replacedEmployee.id)
    : []
  const description = automaticReplacementDescription({
    type: draft.type,
    participantName: participantEmployee?.name,
    replacedName: replacedEmployee?.name,
    date: draft.date,
    startTime: draft.startTime,
    endTime: draft.endTime,
  })
  const evidenceRequirements = REPLACEMENT_TYPES[draft.type]?.evidence ?? []
  const evidenceByType = Object.fromEntries(evidence.map((entry) => [entry.evidenceType, entry]))
  const evidenceComplete = evidenceRequirements.length > 0 &&
    evidenceRequirements.every((requirement) => evidenceByType[requirement.type]?.status === 'ACTIVE')

  useEffect(() => {
    if (!canMutate || !range?.startedAt || !contractScope.contractId || !up3Id) {
      setEmployeeOptions([])
      return undefined
    }
    let cancelled = false
    setEmployeeLoading(true)
    setEmployeeOptions([])
    listReplacementEmployees({
      contractId: contractScope.contractId,
      up3Id,
      startedAt: range.startedAt,
    })
      .then((rows) => {
        if (!cancelled) setEmployeeOptions(rows)
      })
      .catch((error) => {
        if (!cancelled) setMessage(error.message || 'Gagal memuat pegawai Lembur.')
      })
      .finally(() => {
        if (!cancelled) setEmployeeLoading(false)
      })
    return () => { cancelled = true }
  }, [canMutate, contractScope.contractId, up3Id, range?.startedAt])

  const refreshEvidence = async (activityId = activeActivityId) => {
    if (!activityId) {
      setEvidence([])
      return
    }
    const { listOvertimeEvidence } = await import('../../data/overtimeEvidenceRepository.js')
    const rows = await listOvertimeEvidence(activityId)
    if (activeActivityIdRef.current === activityId) setEvidence(rows)
  }

  useEffect(() => {
    let cancelled = false
    if (!activeActivityId) {
      setEvidence([])
      return undefined
    }
    setEvidence([])
    import('../../data/overtimeEvidenceRepository.js')
      .then(({ listOvertimeEvidence }) => listOvertimeEvidence(activeActivityId))
      .then((rows) => {
        if (!cancelled) setEvidence(rows)
      })
      .catch((error) => {
        if (!cancelled) setMessage(error.message || 'Gagal memuat evidence.')
      })
    return () => { cancelled = true }
  }, [activeActivityId])

  const updateDraft = (patch) => {
    setDraft((current) => ({ ...current, ...patch }))
    setDirty(true)
    setMessage(null)
  }

  const resetForm = () => {
    setDraft(initialDraft(periodMonth))
    setActiveActivityId(null)
    setEvidence([])
    setFiles({})
    setDirty(true)
    setMessage(null)
  }

  const editDraft = (record) => {
    const time = pontianakFormValues(record.startedAt, record.endedAt)
    setDraft({
      type: record.type,
      date: time.date,
      replacedEmployeeId: record.replacedEmployeeId,
      participantEmployeeId: record.participantEmployeeId,
      startTime: time.startTime,
      endTime: time.endTime,
    })
    setActiveActivityId(record.id)
    setEvidence([])
    setFiles({})
    setDirty(false)
    setMessage(null)
  }

  const validateDraft = () => {
    if (!REPLACEMENT_TYPES[draft.type]) return 'Pilih jenis Pengganti Cuti, Sakit, atau Izin.'
    if (!range || range.durationMinutes < 1) return 'Tanggal dan jam lembur tidak valid.'
    if (!draft.date.startsWith(String(periodMonth).slice(0, 7))) {
      return 'Tanggal lembur harus berada dalam periode yang dipilih.'
    }
    if (!replacedEmployee || !participantEmployee) return 'Pilih kedua pegawai.'
    if (replacedEmployee.id === participantEmployee.id) return 'Pegawai yang digantikan dan pengganti harus berbeda.'
    if (replacedEmployee.unitId !== participantEmployee.unitId) return 'Kedua pegawai harus berasal dari ULP yang sama.'
    if (unitId && replacedEmployee.unitId !== unitId) return 'Pegawai berada di luar ULP akun.'
    return null
  }

  const saveDraft = async () => {
    const validation = validateDraft()
    if (validation) {
      setMessage(validation)
      return
    }
    setSubmitting(true)
    try {
      const result = await onSaveDraft(activeActivityId, {
        unitId: replacedEmployee.unitId,
        type: draft.type,
        replacedEmployeeId: replacedEmployee.id,
        participantEmployeeId: participantEmployee.id,
        startedAt: range.startedAt,
        endedAt: range.endedAt,
      })
      setMessage(result.message)
      if (result.ok) {
        setActiveActivityId(result.activityId)
        setDirty(false)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const uploadEvidence = async (requirement) => {
    const file = files[requirement.type]
    if (!file || !activeActivityId) return
    setSubmitting(true)
    try {
      const { uploadOvertimeEvidence } = await import('../../data/overtimeEvidenceRepository.js')
      const existing = evidenceByType[requirement.type]
      await uploadOvertimeEvidence({
        activityId: activeActivityId,
        evidenceType: requirement.type,
        file,
        supersedesEvidenceId: existing?.id ?? null,
      })
      setFiles((current) => ({ ...current, [requirement.type]: null }))
      await refreshEvidence(activeActivityId)
      setMessage(`${requirement.label} tersimpan di private Storage.`)
    } catch (error) {
      setMessage(error.message || `Gagal mengunggah ${requirement.label}.`)
    } finally {
      setSubmitting(false)
    }
  }

  const previewEvidence = async (entry) => {
    const preview = window.open('about:blank', '_blank')
    if (!preview) {
      setMessage('Browser memblokir jendela preview. Izinkan pop-up untuk aplikasi ini.')
      return
    }
    preview.opener = null
    try {
      const { createOvertimeEvidenceSignedUrl } = await import('../../data/overtimeEvidenceRepository.js')
      const signed = await createOvertimeEvidenceSignedUrl(entry.id)
      preview.location.replace(signed.signedUrl)
    } catch (error) {
      preview.close()
      setMessage(error.message || 'Preview evidence gagal.')
    }
  }

  const removeEvidence = async (entry) => {
    if (!window.confirm(`Hapus ${entry.originalFilename}?`)) return
    setSubmitting(true)
    try {
      const { deleteOvertimeEvidence } = await import('../../data/overtimeEvidenceRepository.js')
      await deleteOvertimeEvidence(entry.id)
      await refreshEvidence(activeActivityId)
      setMessage('Evidence dihapus.')
    } catch (error) {
      setMessage(error.message || 'Evidence gagal dihapus.')
    } finally {
      setSubmitting(false)
    }
  }

  const submitDraft = async () => {
    if (dirty) {
      setMessage('Simpan perubahan Draft sebelum mengajukan Lembur.')
      return
    }
    if (!evidenceComplete) {
      setMessage('Lengkapi seluruh evidence wajib sebelum mengajukan Lembur.')
      return
    }
    setSubmitting(true)
    try {
      const result = await onSubmit(activeActivityId)
      if (result.ok) resetForm()
      setMessage(result.message)
    } finally {
      setSubmitting(false)
    }
  }

  const sorted = [...records].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))

  const changeType = (type) => {
    if (activeActivityId && evidence.length && type !== draft.type) {
      setMessage('Hapus evidence Draft sebelum mengubah Jenis Lembur.')
      return
    }
    updateDraft({ type })
  }

  return (
    <section className="sla-module-panel lembur-l2">
      <div className="sla-export-bar">
        <span className="sla-export-scope">
          Lembur Pengganti Cuti, Sakit, dan Izin. Waktu bisnis: Asia/Pontianak.
        </span>
      </div>

      {loadError ? (
        <div className="placeholder">
          <h2 className="placeholder-title">Data lembur gagal dimuat</h2>
          <p className="placeholder-text">{loadError}</p>
          <button type="button" className="sla-btn" onClick={onRetry}>Coba Lagi</button>
        </div>
      ) : loading ? (
        <div className="placeholder"><h2 className="placeholder-title">Memuat data lembur...</h2></div>
      ) : (
        <>
          {canMutate && (
            <div className="lembur-form-card">
              <div className="lembur-form-heading">
                <div>
                  <span className="lembur-kicker">Tambah Lembur</span>
                  <h2>{activeActivityId ? 'Lanjutkan Draft' : 'Transaksi Pengganti'}</h2>
                </div>
                {activeActivityId && <button type="button" className="sla-btn" disabled={submitting} onClick={resetForm}>Draft Baru</button>}
              </div>

              <div className="lembur-form-grid">
                <label className="sla-context-field">
                  <span className="sla-context-label">Jenis Lembur *</span>
                  <select className="sla-context-select" value={draft.type} onChange={(event) => changeType(event.target.value)}>
                    <option value="">Pilih jenis lembur</option>
                    {Object.entries(REPLACEMENT_TYPES).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
                    <option value="WORK" disabled>Lembur Pekerjaan (segera di L3)</option>
                  </select>
                </label>
                <label className="sla-context-field">
                  <span className="sla-context-label">Tanggal Lembur *</span>
                  <input type="date" className="sla-context-select" value={draft.date} onChange={(event) => updateDraft({ date: event.target.value })} />
                </label>
                <label className="sla-context-field">
                  <span className="sla-context-label">Pegawai yang Digantikan *</span>
                  <select
                    className="sla-context-select"
                    value={draft.replacedEmployeeId}
                    disabled={employeeLoading}
                    onChange={(event) => updateDraft({ replacedEmployeeId: event.target.value, participantEmployeeId: '' })}
                  >
                    <option value="">{employeeLoading ? 'Memuat pegawai...' : 'Pilih pegawai'}</option>
                    {employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                  </select>
                </label>
                <label className="sla-context-field">
                  <span className="sla-context-label">Pegawai yang Lembur / Pengganti *</span>
                  <select className="sla-context-select" value={draft.participantEmployeeId} disabled={!replacedEmployee} onChange={(event) => updateDraft({ participantEmployeeId: event.target.value })}>
                    <option value="">Pilih pegawai pengganti</option>
                    {participantOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                  </select>
                </label>
                <label className="sla-context-field">
                  <span className="sla-context-label">Jam Mulai *</span>
                  <input type="time" className="sla-context-select" value={draft.startTime} onChange={(event) => updateDraft({ startTime: event.target.value })} />
                </label>
                <label className="sla-context-field">
                  <span className="sla-context-label">Jam Selesai *</span>
                  <input type="time" className="sla-context-select" value={draft.endTime} onChange={(event) => updateDraft({ endTime: event.target.value })} />
                </label>
              </div>

              <div className="lembur-duration-strip">
                <span>Durasi otomatis</span>
                <strong>{range ? formatDurationMinutes(range.durationMinutes) : '–'}</strong>
                {range && draft.endTime <= draft.startTime && <small>Selesai pada hari berikutnya</small>}
              </div>
              {description && <p className="lembur-description-preview">{description}</p>}

              <div className="lembur-form-actions">
                <button type="button" className="sla-btn sla-btn-primary" disabled={submitting} onClick={saveDraft}>
                  {submitting ? 'Memproses...' : 'Simpan Draft'}
                </button>
              </div>

              {activeActivityId && (
                <div className="lembur-evidence-panel">
                  <div>
                    <span className="lembur-kicker">Evidence Wajib</span>
                    <p>File diproses dan disimpan privat, maksimum 1 MB per evidence.</p>
                  </div>
                  {evidenceRequirements.map((requirement) => {
                    const existing = evidenceByType[requirement.type]
                    return (
                      <div className="lembur-evidence-row" key={requirement.type}>
                        <div>
                          <strong>{requirement.label} *</strong>
                          <small>{existing ? `${existing.originalFilename} · ${(existing.storedSizeBytes / 1024).toFixed(0)} KB` : 'Belum lengkap'}</small>
                        </div>
                        <input
                          key={`${requirement.type}-${existing?.id ?? 'empty'}`}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx"
                          onChange={(event) => setFiles((current) => ({ ...current, [requirement.type]: event.target.files?.[0] ?? null }))}
                        />
                        <button type="button" className="sla-btn" disabled={submitting || !files[requirement.type]} onClick={() => uploadEvidence(requirement)}>
                          {existing ? 'Ganti File' : 'Upload'}
                        </button>
                        {existing && <button type="button" className="sla-btn" onClick={() => previewEvidence(existing)}>Preview</button>}
                        {existing && <button type="button" className="sla-btn" disabled={submitting} onClick={() => removeEvidence(existing)}>Hapus</button>}
                      </div>
                    )
                  })}
                  <button type="button" className="sla-btn sla-btn-primary" disabled={submitting || dirty || !evidenceComplete} onClick={submitDraft}>
                    Ajukan Lembur
                  </button>
                </div>
              )}
              {message && <p className="lembur-message">{message}</p>}
            </div>
          )}

          {!canMutate && <p className="sla-blocked-note">Akses ini menampilkan Rekap Lembur dalam scope UP3. Input dan approval tidak tersedia pada L2.</p>}

          <div className="sla-table-wrap">
            <table className="sla-table">
              <thead>
                <tr>
                  <th>Tanggal</th><th>Jenis</th><th>Pegawai</th><th>Waktu/Jam</th>
                  <th>Total Rp</th><th>Keterangan</th><th>Status</th>{canMutate && <th>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {!sorted.length && <tr><td colSpan={canMutate ? 8 : 7}>Belum ada record Lembur pada periode ini.</td></tr>}
                {sorted.map((record) => {
                  const time = pontianakFormValues(record.startedAt, record.endedAt)
                  return (
                    <tr key={record.id}>
                      <td>{record.date}</td>
                      <td>{REPLACEMENT_TYPES[record.type]?.label ?? record.type}</td>
                      <td>{record.participantName}</td>
                      <td>{time.startTime}–{time.endTime}{time.endTime <= time.startTime ? ' (+1 hari)' : ''} · {formatDurationMinutes(record.durationHours * 60)}</td>
                      <td>Rp {formatRp(record.total)}</td>
                      <td>{record.description}</td>
                      <td>{statusLabel(record.status)}</td>
                      {canMutate && <td>{record.status === 'DRAFT' ? <button type="button" className="sla-btn" disabled={submitting} onClick={() => editDraft(record)}>Lanjutkan Draft</button> : '–'}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
