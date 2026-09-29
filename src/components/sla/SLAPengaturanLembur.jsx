import { useEffect, useRef, useState } from 'react'
import {
  getOvertimeInitialDeadlineConfig,
  setOvertimeInitialDeadlineConfig,
} from '../../data/overtimeReplacementRepository.js'
import Icon from '../Icon.jsx'
import { Alert, Button, Input, StatePanel, Textarea } from '../ui/Primitives.jsx'

const PONTIANAK_TIME_ZONE = 'Asia/Pontianak'
const MAX_TIMEOUT_MS = 2147483647

function pontianakParts(value = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: PONTIANAK_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value).map((part) => [part.type, part.value]),
  )
}

function pontianakDateKey(value = new Date()) {
  const parts = pontianakParts(value)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function pontianakDateTimeInput(value) {
  if (!value) return ''
  const parts = pontianakParts(new Date(value))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function formatDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeZone: PONTIANAK_TIME_ZONE,
  }).format(new Date(`${value}T12:00:00+07:00`))
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: PONTIANAK_TIME_ZONE,
  }).format(new Date(value))
}

function validDays(value) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 1 && number <= 30
}

export default function SLAPengaturanLembur({ contractId, up3Id, up3Name, isSuperAdmin }) {
  const [config, setConfig] = useState(null)
  const [normalDays, setNormalDays] = useState('7')
  const [temporaryEnabled, setTemporaryEnabled] = useState(false)
  const [temporaryDays, setTemporaryDays] = useState('')
  const [temporaryUntil, setTemporaryUntil] = useState('')
  const [temporaryReason, setTemporaryReason] = useState('')
  const [loadStatus, setLoadStatus] = useState('loading')
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [serverClockOffset, setServerClockOffset] = useState(0)
  const dirtyRef = useRef(false)
  const sampleDate = pontianakDateKey()

  const applyConfig = (next, { preserveDirty = false } = {}) => {
    setConfig(next)
    if (preserveDirty && dirtyRef.current) {
      if (!next.temporaryIsActive) {
        setTemporaryEnabled(false)
        setTemporaryDays('')
        setTemporaryUntil('')
        setTemporaryReason('')
      }
      return
    }
    setNormalDays(String(next.initialSubmissionDays))
    setTemporaryEnabled(next.temporaryIsActive)
    setTemporaryDays(next.temporaryIsActive ? String(next.temporarySubmissionDays) : '')
    setTemporaryUntil(next.temporaryIsActive ? pontianakDateTimeInput(next.temporaryEffectiveUntil) : '')
    setTemporaryReason(next.temporaryIsActive ? (next.temporaryReason ?? '') : '')
    dirtyRef.current = false
    setDirty(false)
  }

  const markDirty = () => {
    dirtyRef.current = true
    setDirty(true)
    setFeedback(null)
  }

  useEffect(() => {
    dirtyRef.current = false
    setDirty(false)
  }, [contractId, up3Id])

  useEffect(() => {
    if (!contractId || !up3Id) return undefined
    let cancelled = false
    const requestedAt = Date.now()
    setLoadStatus('loading')
    setLoadError('')
    getOvertimeInitialDeadlineConfig({ contractId, up3Id, overtimeDate: sampleDate })
      .then((next) => {
        if (cancelled) return
        if (!next) throw new Error('Konfigurasi deadline tidak tersedia.')
        const receivedAt = Date.now()
        setServerClockOffset(new Date(next.asOf).getTime() - Math.round((requestedAt + receivedAt) / 2))
        applyConfig(next, { preserveDirty: true })
        setLoadStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setLoadError(error.message || 'Gagal memuat konfigurasi deadline Lembur.')
        setLoadStatus('error')
      })
    return () => { cancelled = true }
  }, [contractId, up3Id, sampleDate, reloadToken])

  useEffect(() => {
    if (!config?.temporaryIsActive || !config.temporaryEffectiveUntil) return undefined
    const delay = new Date(config.temporaryEffectiveUntil).getTime() - (Date.now() + serverClockOffset) + 1000
    if (delay <= 0) {
      setReloadToken((value) => value + 1)
      return undefined
    }
    const timeoutId = window.setTimeout(
      () => setReloadToken((value) => value + 1),
      Math.min(delay, MAX_TIMEOUT_MS),
    )
    return () => window.clearTimeout(timeoutId)
  }, [config?.temporaryIsActive, config?.temporaryEffectiveUntil, serverClockOffset])

  const handleSave = async (event) => {
    event.preventDefault()
    setFeedback(null)
    if (!validDays(normalDays)) {
      setFeedback({ type: 'error', text: 'Batas normal wajib berupa 1 sampai 30 hari.' })
      return
    }
    if (temporaryEnabled && !validDays(temporaryDays)) {
      setFeedback({ type: 'error', text: 'Batas sementara wajib berupa 1 sampai 30 hari.' })
      return
    }
    if (temporaryEnabled && (!temporaryUntil || !temporaryReason.trim())) {
      setFeedback({ type: 'error', text: 'Masa berlaku dan alasan toleransi sementara wajib diisi.' })
      return
    }

    setSaving(true)
    try {
      await setOvertimeInitialDeadlineConfig({
        contractId,
        up3Id,
        initialSubmissionDays: Number(normalDays),
        temporarySubmissionDays: temporaryEnabled ? Number(temporaryDays) : null,
        temporaryEffectiveUntil: temporaryEnabled ? `${temporaryUntil}:00+07:00` : null,
        temporaryReason: temporaryEnabled ? temporaryReason.trim() : null,
      })
      dirtyRef.current = false
      const requestedAt = Date.now()
      const next = await getOvertimeInitialDeadlineConfig({ contractId, up3Id, overtimeDate: sampleDate })
      const receivedAt = Date.now()
      setServerClockOffset(new Date(next.asOf).getTime() - Math.round((requestedAt + receivedAt) / 2))
      applyConfig(next)
      setFeedback({ type: 'success', text: 'Pengaturan deadline Lembur berhasil disimpan dan dicatat dalam audit.' })
    } catch (error) {
      setFeedback({ type: 'error', text: error.message || 'Gagal menyimpan pengaturan deadline Lembur.' })
    } finally {
      setSaving(false)
    }
  }

  if (loadStatus === 'loading') {
    return <StatePanel state="loading" title="Memuat pengaturan Lembur" />
  }
  if (loadStatus === 'error') {
    return (
      <StatePanel
        state="error"
        title="Pengaturan Lembur tidak dapat dimuat"
        action={<Button variant="secondary" onClick={() => setReloadToken((value) => value + 1)}>Coba Lagi</Button>}
      >
        {loadError}
      </StatePanel>
    )
  }

  return (
    <section className="overtime-deadline-settings">
      <header className="overtime-deadline-settings-header">
        <div>
          <span className="overtime-deadline-settings-kicker">Aturan Pengajuan Awal</span>
          <h2>Pengaturan Lembur</h2>
          <p>{up3Name || 'UP3 terpilih'} · berlaku untuk seluruh kategori Lembur dalam kontrak ini.</p>
        </div>
        <span className={`overtime-deadline-access ${isSuperAdmin ? 'is-editable' : ''}`}>
          <Icon name="shield" size={15} />
          {isSuperAdmin ? 'Akses SUPER_ADMIN' : 'Hanya baca'}
        </span>
      </header>

      <div className="overtime-deadline-summary">
        <article>
          <span>Batas normal</span>
          <strong>H+{config.initialSubmissionDays}</strong>
          <small>{config.configExists ? `Revisi konfigurasi ${config.revision}` : 'Default sistem'}</small>
        </article>
        <article className={config.temporaryIsActive ? 'is-temporary' : ''}>
          <span>Batas efektif saat ini</span>
          <strong>H+{config.effectiveSubmissionDays}</strong>
          <small>{config.temporaryIsActive ? 'Toleransi sementara aktif' : 'Mengikuti batas normal'}</small>
        </article>
        <article>
          <span>Contoh cutoff</span>
          <strong>{formatDate(config.effectiveDeadlineDate)}</strong>
          <small>Mulai {formatDate(sampleDate)}, pukul 23:59 WITA</small>
        </article>
      </div>

      {config.temporaryIsActive && (
        <Alert tone="warning" title={`Toleransi H+${config.temporarySubmissionDays} sedang aktif`}>
          Berlaku sampai {formatDateTime(config.temporaryEffectiveUntil)} WITA. Setelah itu sistem otomatis kembali ke H+{config.initialSubmissionDays}. Alasan: {config.temporaryReason}
        </Alert>
      )}
      {!isSuperAdmin && (
        <Alert tone="info">Konfigurasi ditampilkan sebagai referensi. Perubahan hanya dapat dilakukan oleh SUPER_ADMIN.</Alert>
      )}
      {feedback && <Alert tone={feedback.type === 'error' ? 'danger' : 'success'}>{feedback.text}</Alert>}

      <form className="overtime-deadline-form" onSubmit={handleSave}>
        <div className="overtime-deadline-form-section">
          <div className="overtime-deadline-form-heading">
            <span>01</span>
            <div><h3>Batas Normal</h3><p>Deadline standar untuk Draft awal, evidence, dan pengajuan pertama.</p></div>
          </div>
          <label className="overtime-deadline-field">
            <span>Jumlah hari setelah tanggal mulai</span>
            <div className="overtime-deadline-days-input">
              <strong>H+</strong>
              <Input type="number" min="1" max="30" step="1" value={normalDays} disabled={!isSuperAdmin || saving} onChange={(event) => { markDirty(); setNormalDays(event.target.value) }} />
              <small>hari</small>
            </div>
            <small>Nilai yang diperbolehkan: 1 sampai 30 hari.</small>
          </label>
        </div>

        <div className="overtime-deadline-form-section">
          <div className="overtime-deadline-form-heading">
            <span>02</span>
            <div><h3>Toleransi Sementara</h3><p>Override berbatas waktu untuk kebutuhan operasional khusus.</p></div>
          </div>
          <label className="overtime-deadline-toggle">
            <input type="checkbox" checked={temporaryEnabled} disabled={!isSuperAdmin || saving} onChange={(event) => { markDirty(); setTemporaryEnabled(event.target.checked) }} />
            <span><strong>Aktifkan toleransi sementara</strong><small>Fallback ke batas normal berlangsung otomatis saat masa berlaku berakhir.</small></span>
          </label>
          {temporaryEnabled && (
            <div className="overtime-deadline-temporary-grid">
              <label className="overtime-deadline-field">
                <span>Batas sementara</span>
                <div className="overtime-deadline-days-input">
                  <strong>H+</strong>
                  <Input type="number" min="1" max="30" step="1" value={temporaryDays} disabled={!isSuperAdmin || saving} onChange={(event) => { markDirty(); setTemporaryDays(event.target.value) }} />
                  <small>hari</small>
                </div>
              </label>
              <label className="overtime-deadline-field">
                <span>Berlaku sampai (WITA)</span>
                <Input type="datetime-local" value={temporaryUntil} disabled={!isSuperAdmin || saving} onChange={(event) => { markDirty(); setTemporaryUntil(event.target.value) }} />
              </label>
              <label className="overtime-deadline-field is-wide">
                <span>Alasan toleransi</span>
                <Textarea rows="3" maxLength="500" value={temporaryReason} disabled={!isSuperAdmin || saving} placeholder="Contoh: gangguan sistem atau kebijakan operasional sementara" onChange={(event) => { markDirty(); setTemporaryReason(event.target.value) }} />
              </label>
            </div>
          )}
        </div>

        <footer className="overtime-deadline-form-footer">
          <div>
            <Icon name="info" size={15} />
            <span>{dirty ? 'Ada perubahan yang belum disimpan. ' : ''}Perubahan berlaku untuk Draft aktif yang belum kedaluwarsa. Data CLOSED/EXPIRED tidak dibuka kembali dan batas revisi H+3 tidak berubah.</span>
          </div>
          {isSuperAdmin && <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan Pengaturan'}</Button>}
        </footer>
      </form>

      {config.updatedAt && (
        <p className="overtime-deadline-audit-note">Terakhir diperbarui {formatDateTime(config.updatedAt)} WITA · audit revision {config.revision}</p>
      )}
    </section>
  )
}
