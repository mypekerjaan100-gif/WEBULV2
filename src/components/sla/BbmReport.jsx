import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import { Button, ConfirmationDialog, Modal } from '../ui/Primitives.jsx'
import { BBM_SAMPLING_CHECKS, BBM_SAMPLING_NOTES, BBM_SAMPLING_RESULTS, BBM_TYPES, bbmToday, bbmReportDate, bbmNumber as fmt, bbmPlaceOptions, bbmRupiah, bbmVehicleLabel, calculateBbm, validateBbm, purchaseTotal } from '../../data/bbmDomain.js'
import { listBbmVehicles, getBbmSheet, saveBbmSheet, uploadBbmPhoto, getBbmPhoto } from '../../data/bbmRepository.js'
import { getAiPublicStatus, validateBbmOdometer } from '../../data/aiRepository.js'
import { aiCheckMeta, describeAiFailure } from '../../data/aiValidation.js'
import BbmMonthPicker from './BbmMonthPicker.jsx'
import BbmSelect from './BbmSelect.jsx'
import ModernDatePicker from './ModernDatePicker.jsx'
import './BbmReport.css'

const SAMPLING_OTHER = '__other__'
const samplingOptions = (choices) => [
  ...choices.map((choice) => ({ value: choice, label: choice })),
  { value: SAMPLING_OTHER, label: 'Lainnya' },
]

const labelDate = (date, options) => {
  const parsed = new Date(`${date}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('id-ID', options).format(parsed)
}
const emptyPurchase = () => ({ fuel: '', liters: '', price: '', place: '', photo: '' })
const ZOOM_LEVELS = [70, 80, 90, 100, 110]
const ZOOM_STORAGE_KEY = 'bbm-table-zoom'
const readStoredZoom = () => {
  if (typeof window === 'undefined') return null
  try {
    const value = Number(window.localStorage.getItem(ZOOM_STORAGE_KEY))
    return ZOOM_LEVELS.includes(value) ? value : null
  } catch {
    return null
  }
}
const initialZoom = () => {
  const stored = readStoredZoom()
  if (stored != null) return stored
  const width = typeof window !== 'undefined' ? window.innerWidth : 1600
  if (width <= 1366) return 70
  if (width <= 1536) return 80
  return 100
}

export default function BbmReport({ contractId, up3Id, units, ownUlpId, canWrite = false, previewActive = false, initialMonth, onMonthChange, onEditorStateChange }) {
  const [month, setMonth] = useState(initialMonth.slice(0, 7))
  const [ulp, setUlp] = useState(ownUlpId || '')
  const [vehicles, setVehicles] = useState([])
  const [vehicleId, setVehicleId] = useState('')
  const [sheet, setSheet] = useState(null)
  const [rows, setRows] = useState([])
  const [details, setDetails] = useState({})
  const [initial, setInitial] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [reload, setReload] = useState(0)
  const [photo, setPhoto] = useState(null)
  const [zoom, setZoom] = useState(initialZoom)
  const [aiReady, setAiReady] = useState(false)
  const [aiChecks, setAiChecks] = useState({})
  const [aiDetailDate, setAiDetailDate] = useState(null)
  const lock = useRef(false)
  const noticeTimer = useRef(null)
  const aiTokensRef = useRef(new Map())
  const aiQueueRef = useRef([])
  const aiRunningRef = useRef(false)
  const aiReadyRef = useRef(false)
  const aiStatusLoadedRef = useRef(false)
  const aiDisabledNotifiedRef = useRef(false)
  const rowsRef = useRef(rows)
  const vehicleRef = useRef(vehicleId)
  const aiChecksRef = useRef(aiChecks)
  rowsRef.current = rows
  vehicleRef.current = vehicleId
  aiChecksRef.current = aiChecks
  const vehicle = vehicles.find((v) => v.id === vehicleId)
  const ulpName = units.find((u) => u.uuid === (vehicle?.ulp_id || ulp))?.displayName || 'ULP'
  const selectedVehicles = vehicles.filter((v) => !ulp || v.ulp_id === ulp)
  const editable = canWrite && !previewActive && sheet?.can_write && !busy && !loading
  const calculated = calculateBbm(month, rows, initial, sheet?.previous)
  const periodLabel = labelDate(`${month}-01`, { month: 'long', year: 'numeric' })
  const today = bbmToday()
  const autoReportDate = bbmReportDate(month, rows, today)
  const reportDate = details.report_date || autoReportDate || ''
  const lastDay = calculated.days.at(-1)?.date
  const sampleDateMax = month === today.slice(0, 7) ? today : lastDay
  const zoomIndex = ZOOM_LEVELS.indexOf(zoom)
  const changeZoom = (next) => {
    if (!ZOOM_LEVELS.includes(next)) return
    setZoom(next)
    try { window.localStorage.setItem(ZOOM_STORAGE_KEY, String(next)) } catch { /* penyimpanan lokal tidak tersedia */ }
  }
  const stepZoom = (direction) => {
    const nextIndex = Math.min(Math.max(zoomIndex + direction, 0), ZOOM_LEVELS.length - 1)
    changeZoom(ZOOM_LEVELS[nextIndex])
  }
  const apply = (data) => {
    const nextRows = data.rows || []
    rowsRef.current = nextRows
    setSheet(data); setRows(nextRows); setDetails(data.details || {}); setInitial(data.initial_odometer ?? ''); setDirty(false)
  }
  const dismissNotice = useCallback(() => {
    window.clearTimeout(noticeTimer.current)
    setNotice(null)
  }, [])
  const showNotice = useCallback((tone, message, title) => {
    window.clearTimeout(noticeTimer.current)
    const fallback = tone === 'success' ? 'Tersimpan' : tone === 'warning' ? 'Perlu diperhatikan' : tone === 'info' ? 'Informasi' : 'Laporan BBM'
    setNotice({ tone, message, title: title || fallback })
    if (tone !== 'danger') {
      noticeTimer.current = window.setTimeout(() => setNotice(null), tone === 'success' ? 4800 : 6500)
    }
  }, [])
  const showError = useCallback((message, title) => {
    setError(message)
    showNotice('danger', message, title)
  }, [showNotice])

  // Pemeriksaan odometer berjalan otomatis setelah foto diunggah atau setelah
  // Stand Akhir diisi. Permintaan dijalankan berurutan agar layanan tidak
  // dibanjiri saat banyak foto diunggah berdekatan.
  const aiCheckAllowed = Boolean(canWrite && !previewActive && sheet?.can_write)
  const invalidateAiCheck = (date) => {
    aiTokensRef.current.set(date, (aiTokensRef.current.get(date) ?? 0) + 1)
    aiQueueRef.current = aiQueueRef.current.filter((task) => task.date !== date)
    setAiChecks((old) => {
      if (!(date in old)) return old
      const next = { ...old }
      delete next[date]
      return next
    })
    setAiDetailDate((current) => (current === date ? null : current))
  }
  const aiTargetValid = (task) => {
    if (vehicleRef.current !== task.vehicleId) return false
    const row = rowsRef.current.find((item) => item.date === task.date)
    if (!row?.photo || row.photo !== task.photo) return false
    return row.end !== '' && row.end != null && Number(row.end) === task.expected
  }
  const performAiCheck = async (task) => {
    try {
      dismissNotice()
      const result = await validateBbmOdometer({
        vehicleId: task.vehicleId,
        date: task.date,
        path: task.photo,
        expected: task.expected,
      })
      if (!aiTargetValid(task)) return
      const check = { ...result, photo: task.photo, expected: task.expected, checkedAt: Date.now() }
      if (result?.status === 'match' || result?.status === 'mismatch' || result?.status === 'unreadable') {
        setAiChecks((old) => ({ ...old, [task.date]: check }))
        if (result.status === 'match') {
          const reading = Number(result.reading)
          const readingText = Number.isFinite(reading) ? fmt(reading, 1) : fmt(task.expected, 1)
          showNotice('success', `Angka pada foto terbaca ${readingText} dan sesuai dengan Stand Akhir ${fmt(task.expected, 1)}.`, 'Angka odometer sesuai')
        } else {
          setAiDetailDate((current) => current ?? task.date)
        }
        return
      }
      const info = describeAiFailure('')
      setAiChecks((old) => ({ ...old, [task.date]: { status: 'error', ...info, photo: task.photo, expected: task.expected, checkedAt: Date.now() } }))
      showNotice('warning', info.message, info.title)
    } catch (error) {
      if (!aiTargetValid(task)) return
      const info = describeAiFailure(error instanceof Error ? error.message : String(error))
      setAiChecks((old) => ({ ...old, [task.date]: { status: 'error', ...info, photo: task.photo, expected: task.expected, checkedAt: Date.now() } }))
      if (/belum aktif/i.test(info.title)) {
        aiStatusLoadedRef.current = false
        aiReadyRef.current = false
        setAiReady(false)
      }
      showNotice('warning', info.message, info.title)
    }
  }
  const drainAiQueue = async () => {
    if (aiRunningRef.current) return
    aiRunningRef.current = true
    try {
      while (aiQueueRef.current.length) {
        const task = aiQueueRef.current.shift()
        if (!task) continue
        if (aiTokensRef.current.get(task.date) !== task.token) continue
        if (!aiTargetValid(task)) {
          setAiChecks((old) => {
            if (!(task.date in old)) return old
            const next = { ...old }
            delete next[task.date]
            return next
          })
          continue
        }
        await performAiCheck(task)
      }
    } finally {
      aiRunningRef.current = false
    }
  }
  const enqueueAiCheck = ({ date, photo, expected }) => {
    dismissNotice()
    const token = (aiTokensRef.current.get(date) ?? 0) + 1
    aiTokensRef.current.set(date, token)
    aiQueueRef.current = aiQueueRef.current.filter((task) => task.date !== date)
    aiQueueRef.current.push({ date, photo, expected, vehicleId: vehicleRef.current, token })
    setAiChecks((old) => ({ ...old, [date]: { status: 'checking', photo, expected, startedAt: Date.now() } }))
    void drainAiQueue()
  }
  const resolveAiEnabled = async () => {
    if (aiStatusLoadedRef.current) return aiReadyRef.current ? 'enabled' : 'disabled'
    try {
      const status = await getAiPublicStatus()
      const enabled = Boolean(status?.enabled)
      aiStatusLoadedRef.current = true
      aiReadyRef.current = enabled
      setAiReady(enabled)
      return enabled ? 'enabled' : 'disabled'
    } catch {
      return 'unknown'
    }
  }
  const requestAiCheck = async ({ date, photo, expected }) => {
    if (!aiCheckAllowed || !photo) return
    if (expected === '' || expected == null || !Number.isFinite(Number(expected))) {
      showNotice('info', 'Isi Stand Akhir pada baris ini agar angka pada foto dapat dibandingkan.', 'Pemeriksaan menunggu angka')
      return
    }
    const availability = await resolveAiEnabled()
    if (availability !== 'enabled') {
      if (!aiDisabledNotifiedRef.current) {
        aiDisabledNotifiedRef.current = true
        if (availability === 'disabled') {
          showNotice('info', 'Pemeriksaan angka belum diaktifkan oleh Super Admin. Foto tetap tersimpan dan laporan dapat dilanjutkan tanpa pemeriksaan otomatis.', 'Pemeriksaan belum aktif')
        } else {
          showNotice('warning', 'Status layanan pemeriksaan belum dapat diperiksa. Foto tetap tersimpan; silakan coba periksa lagi nanti.', 'Pemeriksaan belum tersedia')
        }
      }
      return
    }
    enqueueAiCheck({ date, photo, expected: Number(expected) })
  }
  const shouldAutoCheck = (date) => {
    const row = rowsRef.current.find((item) => item.date === date)
    if (!row?.photo || row.end === '' || row.end == null) return false
    const check = aiChecksRef.current[date]
    if (check && check.photo === row.photo && Number(check.expected) === Number(row.end)) return false
    return true
  }
  const handleEndBlur = (date) => {
    if (!editable || !shouldAutoCheck(date)) return
    const row = rowsRef.current.find((item) => item.date === date)
    if (!row) return
    void requestAiCheck({ date, photo: row.photo, expected: row.end })
  }
  const openAiDetail = (date) => {
    const check = aiChecksRef.current[date]
    if (!check || check.status === 'checking') return
    setAiDetailDate(date)
  }
  const retryAiDetail = () => {
    const date = aiDetailDate
    const row = rowsRef.current.find((item) => item.date === date)
    setAiDetailDate(null)
    if (!row?.photo) {
      showNotice('warning', 'Foto odometer tidak ditemukan pada baris ini. Unggah foto terlebih dahulu.', 'Foto belum tersedia')
      return
    }
    void requestAiCheck({ date, photo: row.photo, expected: row.end })
  }

  const askConfirm = (options) => setConfirm(options)
  const resolveConfirm = (accepted) => {
    const current = confirm
    setConfirm(null)
    if (accepted) current?.onConfirm?.()
    else current?.onCancel?.()
  }
  const guardUnsaved = (action) => {
    if (lock.current) return false
    if (!dirty) { action(); return true }
    askConfirm({
      title: 'Perubahan belum disimpan',
      description: 'Perubahan laporan BBM belum disimpan. Tinggalkan perubahan?',
      confirmLabel: 'Tinggalkan',
      cancelLabel: 'Tetap di laporan',
      tone: 'danger',
      icon: 'alert-triangle',
      onConfirm: action,
    })
    return false
  }
  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])
  useEffect(() => {
    onEditorStateChange?.({ dirty, busy })
    const prevent = (e) => { if (dirty || busy) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', prevent)
    return () => { window.removeEventListener('beforeunload', prevent); onEditorStateChange?.({ dirty: false, busy: false }) }
  }, [dirty, busy, onEditorStateChange])
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setVehicles([]); setSheet(null); dismissNotice()
    listBbmVehicles({ contractId, up3Id, month }).then((data) => {
      if (!active) return
      const allowed = ownUlpId ? data.filter((v) => v.ulp_id === ownUlpId) : data
      setVehicles(allowed)
      setVehicleId((id) => allowed.some((v) => v.id === id && (!ulp || v.ulp_id === ulp)) ? id : (allowed.find((v) => !ulp || v.ulp_id === ulp)?.id || ''))
    }).catch((e) => { if (active) showError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [contractId, up3Id, month, ownUlpId, ulp, reload, dismissNotice, showError])
  useEffect(() => {
    let active = true
    rowsRef.current = []
    setSheet(null); setRows([]); setDetails({}); setInitial(''); setDirty(false); dismissNotice(); setAiChecks({}); setAiDetailDate(null)
    aiQueueRef.current = []
    aiTokensRef.current.clear()
    if (!vehicleId || !vehicles.some((v) => v.id === vehicleId)) return
    setLoading(true); setError('')
    getBbmSheet(vehicleId, month).then((data) => { if (active) apply(data) })
      .catch((e) => { if (active) showError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [vehicleId, vehicles, month, dismissNotice, showError])
  useEffect(() => {
    let active = true
    aiStatusLoadedRef.current = false
    getAiPublicStatus()
      .then((status) => {
        if (!active) return
        const enabled = Boolean(status?.enabled)
        aiStatusLoadedRef.current = true
        aiReadyRef.current = enabled
        setAiReady(enabled)
      })
      .catch(() => {
        if (!active) return
        aiReadyRef.current = false
        setAiReady(false)
      })
    return () => { active = false }
  }, [reload])
  const updateRow = (date, changes) => {
    const old = rowsRef.current
    const existing = old.find((r) => r.date === date) || { date, end: '', photo: '', purchases: [] }
    const next = [...old.filter((r) => r.date !== date), { ...existing, ...changes }].sort((a, b) => a.date.localeCompare(b.date))
    rowsRef.current = next
    setRows(next)
    if ('end' in changes || 'photo' in changes) invalidateAiCheck(date)
    setDirty(true); dismissNotice()
  }
  const updatePurchase = (date, index, changes) => {
    const purchases = [...(rowsRef.current.find((r) => r.date === date)?.purchases || [])]
    purchases[index] = { ...purchases[index], ...changes }
    updateRow(date, { purchases })
  }
  const clearRow = (date) => {
    const next = rowsRef.current.filter((r) => r.date !== date)
    rowsRef.current = next
    setRows(next)
    invalidateAiCheck(date)
    setDirty(true); dismissNotice()
  }
  const updateDetails = (key, value) => { setDetails((old) => ({ ...old, [key]: value })); setDirty(true); dismissNotice() }
  const upload = async (date, index, file) => {
    if (!file || lock.current || !editable) return
    lock.current = true; setBusy(true); setError('')
    try {
      const path = await uploadBbmPhoto(vehicleId, date, index == null ? 'odometer' : 'receipt', file)
      if (index == null) {
        const row = rowsRef.current.find((item) => item.date === date)
        const expected = row?.end ?? ''
        updateRow(date, { photo: path })
        if (expected !== '' && expected != null && Number.isFinite(Number(expected))) {
          void requestAiCheck({ date, photo: path, expected })
        } else {
          showNotice('info', 'Foto odometer terunggah. Isi Stand Akhir pada baris ini agar kecocokan angkanya dapat diperiksa.', 'Foto odometer tersimpan')
        }
      } else {
        updatePurchase(date, index, { photo: path })
      }
    } catch (e) { showError(e.message, 'Foto gagal diunggah') } finally { lock.current = false; setBusy(false) }
  }
  const showPhoto = async (path) => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { setPhoto(await getBbmPhoto(path)) } catch (e) { showError(e.message, 'Foto tidak dapat dibuka') }
    finally { lock.current = false; setBusy(false) }
  }
  const save = async () => {
    if (!editable || lock.current) return
    setError(''); dismissNotice()
    try { validateBbm(rows, initial, sheet.previous) } catch (e) { showError(e.message, 'Laporan belum lengkap'); return }
    lock.current = true; setBusy(true)
    try {
      apply(await saveBbmSheet(vehicleId, month, sheet.revision, initial, rows, details))
      showNotice('success', 'Laporan BBM tersimpan.')
    } catch (e) { showError(e.message, 'Laporan gagal disimpan') }
    finally { lock.current = false; setBusy(false) }
  }
  const aiStatusChip = (date) => {
    const check = aiChecks[date]
    if (!check) return null
    const meta = aiCheckMeta(check.status)
    const spinning = check.status === 'checking'
    const reading = Number(check.reading)
    const detail = !spinning && check.status !== 'error' && Number.isFinite(reading) ? ` · terbaca ${fmt(reading, 1)}` : ''
    const title = spinning
      ? 'Sedang membaca angka pada foto odometer'
      : check.status === 'error'
        ? `${meta.label}: ${check.message || 'Coba periksa lagi.'}`
        : `Hasil pemeriksaan: ${meta.label}${detail}`
    return <button
      type="button"
      className={`bbm-ai-chip is-${check.status}`}
      disabled={spinning}
      title={title}
      aria-label={`Lihat hasil pemeriksaan ${date}: ${meta.label}`}
      onClick={() => openAiDetail(date)}
    >
      <Icon name={meta.icon} size={12} className={spinning ? 'bbm-ai-spin' : ''} />
    </button>
  }
  const photoCell = (date, path, index = null) => <span className="bbm-photo">
    {path && <button type="button" disabled={busy} title="Lihat foto" aria-label={`Lihat foto ${index == null ? 'odometer' : 'struk'} ${date}`} onClick={() => showPhoto(path)}><Icon name="check-circle" size={14} /></button>}
    {editable && date <= today && <label title={path ? 'Ganti foto' : 'Unggah foto wajib'}><Icon name="camera" size={14} /><input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Foto ${index == null ? 'odometer' : `struk ${index + 1}`} ${date}`} onChange={(e) => { upload(date, index, e.target.files?.[0]); e.target.value = '' }} /></label>}
    {!path && !editable && <span>—</span>}
  </span>
  const meta = (key, placeholder, type = 'text') => <input type={type} maxLength={160} aria-label={placeholder} placeholder={placeholder} value={details[key] || ''} disabled={!editable} onChange={(e) => updateDetails(key, e.target.value)} />
  const samplingField = (index, base, label, choices, placeholder) => {
    const key = `sample_${base}_${index}`
    const customKey = `${key}__other`
    const value = details[key] || ''
    const custom = details[customKey] === '1' || (value !== '' && !choices.includes(value))
    return <div className="bbm-sampling-field">
      <BbmSelect
        compact
        ariaLabel={`${label} sampling ${index + 1}`}
        value={custom ? SAMPLING_OTHER : value}
        disabled={!editable}
        placeholder={placeholder}
        options={samplingOptions(choices)}
        onChange={(next) => {
          if (next === SAMPLING_OTHER) {
            updateDetails(customKey, '1')
            if (choices.includes(value)) updateDetails(key, '')
          } else {
            updateDetails(customKey, '')
            updateDetails(key, next)
          }
        }}
      />
      {custom && <input className="bbm-sampling-custom" maxLength={160} aria-label={`Penjelasan ${label.toLowerCase()} sampling ${index + 1}`} placeholder="Tulis penjelasan" value={value} disabled={!editable} onChange={(e) => updateDetails(key, e.target.value)} />}
    </div>
  }
  const aiDetailCheck = aiDetailDate ? aiChecks[aiDetailDate] : null
  const aiDetailMeta = aiCheckMeta(aiDetailCheck?.status)
  const aiDetailTitle = aiDetailCheck?.status === 'match'
    ? 'Angka odometer sesuai'
    : aiDetailCheck?.status === 'mismatch'
      ? 'Angka odometer berbeda'
      : aiDetailCheck?.status === 'unreadable'
        ? 'Angka odometer tidak terbaca'
        : aiDetailCheck?.status === 'error'
          ? (aiDetailCheck.title || 'Pemeriksaan belum berhasil')
          : 'Hasil pemeriksaan odometer'
  const aiDetailDescription = aiDetailCheck?.status === 'match'
    ? 'Angka pada foto sesuai dengan Stand Akhir yang Anda isi.'
    : aiDetailCheck?.status === 'mismatch'
      ? 'Angka pada foto berbeda dari Stand Akhir pada baris ini. Periksa kembali foto dan angka sebelum menyimpan laporan.'
      : aiDetailCheck?.status === 'unreadable'
        ? 'Angka pada foto belum dapat dibaca dengan jelas. Foto tetap tersimpan; unggah ulang foto yang lebih jelas bila perlu.'
        : aiDetailCheck?.status === 'error'
          ? (aiDetailCheck.message || 'Angka pada foto belum dapat diperiksa.')
          : ''
  const aiDetailReading = Number(aiDetailCheck?.reading)
  const aiDetailExpected = Number(aiDetailCheck?.expected)
  const navigateCells = (event) => {
    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key) || event.target.tagName !== 'INPUT' || event.target.type !== 'number') return
    const prefix = event.target.getAttribute('aria-label')?.replace(/\d{4}-\d{2}-\d{2}.*$/, '')
    const inputs = [...event.currentTarget.querySelectorAll('input[type="number"]:not(:disabled)')].filter((input) => input.getAttribute('aria-label')?.startsWith(prefix))
    const next = inputs[inputs.indexOf(event.target) + (event.key === 'ArrowUp' || event.shiftKey ? -1 : 1)]
    event.preventDefault(); next?.focus(); next?.select()
  }
  return <section className="bbm-report">
    <div className="bbm-toolbar">
      <div><Icon name="fuel" /><strong>Laporan BBM</strong><span className="bbm-mode">{canWrite && !previewActive ? 'Lembar kerja harian' : 'Hanya lihat'}</span></div>
      <div>
        <label>Periode <BbmMonthPicker ariaLabel="Periode BBM" value={month} max={today.slice(0, 7)} disabled={busy} onChange={(next) => guardUnsaved(() => { setVehicleId(''); setMonth(next); onMonthChange?.(next) })} /></label>
        {!ownUlpId && <label>ULP <BbmSelect
          ariaLabel="ULP laporan BBM"
          value={ulp}
          disabled={busy}
          searchable
          searchLabel="Cari ULP"
          options={[{ value: '', label: 'Semua ULP' }, ...units.filter((u) => u.type === 'ULP').map((u) => ({ value: u.uuid, label: u.displayName }))]}
          onChange={(next) => guardUnsaved(() => { setVehicleId(''); setUlp(next) })}
        /></label>}
        <label>Nopol <BbmSelect
          ariaLabel="Kendaraan BBM"
          value={vehicleId}
          disabled={busy || loading}
          searchable
          searchLabel="Cari kendaraan"
          placeholder="Pilih kendaraan"
          options={[{ value: '', label: 'Pilih kendaraan' }, ...selectedVehicles.map((v) => ({ value: v.id, label: bbmVehicleLabel(v) }))]}
          onChange={(next) => guardUnsaved(() => setVehicleId(next))}
        /></label>
        <button type="button" disabled={busy || loading} onClick={() => guardUnsaved(() => setReload((n) => n + 1))}><Icon name="refresh-cw" size={16} /> Muat ulang</button>
        {canWrite && !previewActive && <button className="bbm-save" type="button" disabled={!editable || !dirty || !vehicle?.plate_display} onClick={save}><Icon name="save" size={16} />{busy ? 'Memproses…' : 'Simpan laporan'}</button>}
      </div>
    </div>
    {loading ? <p role="status">Memuat lembar kerja BBM…</p> : !sheet ? <p>{error ? 'Laporan belum dapat dimuat. Gunakan Muat ulang.' : 'Belum ada kendaraan pada ULP/periode ini.'}</p> : <>
      <div className="bbm-help"><span><Icon name="pencil" size={14} /> Sel putih: isian</span><span><Icon name="lock" size={14} /> Sel abu-abu: otomatis</span><span><Icon name="camera" size={14} /> Foto wajib setiap hari</span>{aiReady && !previewActive && <span><Icon name="sparkles" size={14} /> Pemeriksaan odometer otomatis</span>}<span>{calculated.recorded}/{calculated.days.length} hari tercatat{dirty ? ' · Belum disimpan' : ''}</span>
        <div className="bbm-zoom" role="group" aria-label="Zoom tabel BBM">
          <span>Zoom</span>
          <button type="button" aria-label="Perkecil tabel" title="Perkecil tabel" disabled={zoomIndex <= 0} onClick={() => stepZoom(-1)}>−</button>
          <output aria-live="polite">{zoom}%</output>
          <button type="button" aria-label="Perbesar tabel" title="Perbesar tabel" disabled={zoomIndex >= ZOOM_LEVELS.length - 1} onClick={() => stepZoom(1)}>+</button>
          {zoom !== 100 && <button type="button" className="bbm-zoom-reset" aria-label="Reset zoom tabel" title="Kembali ke ukuran 100%" onClick={() => changeZoom(100)}>Reset</button>}
        </div>
      </div>
      {!vehicle?.plate_display && <p className="bbm-error">Isi nopol kendaraan pada Alat & Kendaraan terlebih dahulu.</p>}
      {calculated.gaps > 0 && <p className="bbm-warning">Ada tanggal yang belum dicatat. Stand awal memakai catatan terakhir yang tersedia; sel bertanda ! mencakup jarak beberapa hari. Lengkapi tanggal kosong agar rekap harian akurat.</p>}
      <div className="bbm-scroll" tabIndex={0} aria-label="Lembar kerja BBM, geser horizontal untuk seluruh kolom">
        <div className="bbm-paper" style={{ zoom: `${zoom}%` }} data-zoom={zoom}>
          <header className="bbm-heading"><h2>BERITA ACARA VERIFIKASI PEMAKAIAN BAHAN BAKAR MINYAK (BBM)</h2><h3>KENDARAAN OPERASIONAL PELAYANAN TEKNIK</h3><h3>{ulpName.toUpperCase()}</h3></header>
          <p className="bbm-intro">Pada hari ini, <input className="bbm-inline-date" type="date" aria-label="Tanggal berita acara" title={!details.report_date && autoReportDate ? 'Otomatis: seluruh odometer dan foto bulan ini sudah lengkap' : undefined} value={reportDate} disabled={!editable} onChange={(e) => updateDetails('report_date', e.target.value)} />, dilakukan verifikasi terhadap pemakaian dan biaya bahan bakar minyak (BBM) kendaraan operasional<br />Pelayanan Teknik (Yantek) {ulpName}, selama bulan <strong>{periodLabel.toUpperCase()}</strong>, dengan data sebagai berikut:</p>
          <table className="bbm-grid" onKeyDown={navigateCells}><colgroup>{[34,72,52,90,126,76,96,94,90,100,74,38,80,104,118].map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
            <thead>
              <tr><th rowSpan={3}>No</th><th rowSpan={3}><Icon name="calendar" size={14} /> Hari</th><th rowSpan={3}>Tgl</th><th colSpan={4}><Icon name="vehicle" size={16} /> {vehicle?.label}</th><th colSpan={2} rowSpan={2}><Icon name="fuel" size={16} /> Jenis BBM</th><th colSpan={2} rowSpan={2}>Pembelian *)</th><th rowSpan={3}>STN</th><th rowSpan={3}>Jml Vol</th><th rowSpan={3}>Harga Satuan Beli</th><th rowSpan={3}><Icon name="wallet" size={14} /> Jumlah Harga</th></tr>
              <tr><th colSpan={2}>{vehicle?.plate_display || 'NOPOL BELUM DIISI'}</th><th colSpan={2}>Jumlah</th></tr>
              <tr><th><Icon name="gauge" size={14} /> Stand Awal</th><th><Icon name="gauge" size={14} /> Stand Akhir / Foto</th><th>ltr</th><th>Harga / ltr</th><th colSpan={2}>Jenis</th><th>Tempat</th><th><Icon name="billing" size={14} /> Struk</th></tr>
            </thead>
            <tbody>{calculated.days.flatMap((day, dayIndex) => {
              const r = day.row || { purchases: [] }
              const ps = r.purchases.length ? r.purchases : [null]
              const firstRecord = dayIndex === 0
              return ps.map((p, pi) => <tr key={`${day.date}:${pi}`} className={`${day.date > today ? 'bbm-future' : ''} ${day.date === today ? 'bbm-today' : ''}`}>
                {pi === 0 && <><td rowSpan={ps.length} className="bbm-auto">{dayIndex + 1}{editable && day.row && !sheet.rows.some((saved) => saved.date === day.date) && <button type="button" className="bbm-clear" title="Kosongkan baris baru" aria-label={`Kosongkan baris ${day.date}`} onClick={() => askConfirm({ title: 'Kosongkan baris?', description: `Isian baru pada ${labelDate(day.date, { day: 'numeric', month: 'long', year: 'numeric' })} akan dihapus.`, confirmLabel: 'Kosongkan', cancelLabel: 'Batal', tone: 'danger', icon: 'alert-triangle', onConfirm: () => clearRow(day.date) })}>×</button>}</td><td rowSpan={ps.length} className="bbm-auto">{labelDate(day.date, { weekday: 'long' }).toUpperCase()}</td><td rowSpan={ps.length} className="bbm-auto">{dayIndex + 1}</td>
                  <td rowSpan={ps.length} className="bbm-auto bbm-num" title={day.gap ? `Catatan terakhir: ${day.priorDate}` : 'Stand akhir catatan sebelumnya'}>
                    {sheet.revision === 0 && firstRecord ? <input aria-label={`Stand awal pertama ${day.date}`} type="number" step="0.1" min="0" value={initial} disabled={!editable || day.date > today} onChange={(e) => { setInitial(e.target.value); setDirty(true) }} /> : <>{day.showStart ? fmt(day.start, 1) : '—'}{day.gap ? ' !' : ''}</>}
                  </td>
                  <td rowSpan={ps.length} className="bbm-num"><div className="bbm-odo"><input aria-label={`Stand akhir ${day.date}`} type="number" step="0.1" min="0" value={r.end ?? ''} disabled={!editable || day.date > today} onChange={(e) => updateRow(day.date, { end: e.target.value })} onBlur={() => handleEndBlur(day.date)} />{photoCell(day.date, r.photo)}{aiStatusChip(day.date)}</div></td></>}
                <td>{p ? <input aria-label={`Liter ${day.date} ${pi + 1}`} type="number" min="0" step="0.001" value={p.liters} disabled={!editable} onChange={(e) => updatePurchase(day.date, pi, { liters: e.target.value })} /> : '—'}</td>
                <td>{p ? <div className="bbm-money"><span aria-hidden="true">Rp</span><input aria-label={`Harga per liter ${day.date} ${pi + 1}`} type="number" min="0" step="0.01" value={p.price} disabled={!editable} onChange={(e) => updatePurchase(day.date, pi, { price: e.target.value })} /></div> : '—'}</td>
                <td colSpan={2}>{p ? <BbmSelect compact ariaLabel={`Jenis BBM ${day.date} ${pi + 1}`} value={p.fuel} disabled={!editable} placeholder="Pilih BBM" options={BBM_TYPES.map((fuel) => ({ value: fuel, label: fuel }))} onChange={(fuel) => updatePurchase(day.date, pi, { fuel })} /> : '—'}</td>
                <td>{p ? <BbmSelect compact ariaLabel={`Tempat pembelian ${day.date} ${pi + 1}`} value={p.place || ''} disabled={!editable} placeholder="Pilih" options={bbmPlaceOptions(p.place)} onChange={(place) => updatePurchase(day.date, pi, { place })} /> : '—'}</td>
                <td>{p ? photoCell(day.date, p.photo, pi) : '—'}</td>
                <td className="bbm-auto">Ltr</td><td className="bbm-auto bbm-num">{p ? fmt(p.liters, 3) : '—'}</td><td className="bbm-auto bbm-num">{p ? bbmRupiah(p.price) : '—'}</td>
                <td className="bbm-amount"><span>{p ? bbmRupiah(purchaseTotal(p)) : '—'}</span>{editable && day.date <= today && <span className="bbm-row-actions">
                  {pi === ps.length - 1 && r.purchases.length < 10 && <button type="button" className="bbm-add" title="Tambah pembelian" aria-label={`Tambah pembelian ${day.date}`} onClick={() => updateRow(day.date, { purchases: [...r.purchases, emptyPurchase()] })}><Icon name="plus" size={13} /></button>}
                  {p && <button type="button" className="bbm-remove" title="Hapus pembelian" aria-label={`Hapus pembelian ${day.date} ${pi + 1}`} onClick={() => askConfirm({ title: 'Hapus pembelian?', description: `Pembelian ${pi + 1} pada ${labelDate(day.date, { day: 'numeric', month: 'long', year: 'numeric' })} akan dihapus dari laporan.`, confirmLabel: 'Hapus', cancelLabel: 'Batal', tone: 'danger', icon: 'alert-triangle', onConfirm: () => updateRow(day.date, { purchases: r.purchases.filter((_, i) => i !== pi) }) })}><Icon name="close" size={13} /></button>}
                </span>}</td>
              </tr>)
            })}</tbody>
            <tfoot><tr><th rowSpan={3} colSpan={2}>TOTAL</th><th colSpan={2}>KILOMETER</th><td colSpan={3} className="bbm-num">{fmt(calculated.km, 1)} km</td><td colSpan={7}></td><td className="bbm-num">{bbmRupiah(calculated.total)}</td></tr><tr><th colSpan={2}>LITER</th><td colSpan={3} className="bbm-num">{fmt(calculated.liters, 3)}</td><td colSpan={5}></td><td className="bbm-num">{fmt(calculated.liters, 3)}</td><td colSpan={2}></td></tr><tr><th colSpan={2}>RASIO</th><td colSpan={3} className="bbm-num">{fmt(calculated.ratio, 3)} km/liter</td><td colSpan={8}>Rasio periode = kilometer tercatat ÷ liter dibeli</td></tr></tfoot>
          </table>
          <h4>SAMPLING **)</h4>
          <table className="bbm-grid bbm-sampling"><thead><tr><th>No</th><th>Hari</th><th>Tanggal</th><th>{vehicle?.label}<br />{vehicle?.plate_display}</th><th>Keterangan</th><th>Kesimpulan</th></tr></thead><tbody>{[0, 1, 2].map((i) => <tr key={i}><td>{i + 1}</td><td>{details[`sample_date_${i}`] ? labelDate(details[`sample_date_${i}`], { weekday: 'long' }) : '—'}</td><td><ModernDatePicker compact ariaLabel={`Tanggal sampling ${i + 1}`} value={details[`sample_date_${i}`] || ''} min={`${month}-01`} max={sampleDateMax} disabled={!editable} placeholder="Pilih tanggal" onChange={(date) => updateDetails(`sample_date_${i}`, date)} /></td><td>{samplingField(i, 'check', 'Hasil pemeriksaan', BBM_SAMPLING_CHECKS, 'Pilih hasil')}</td><td>{samplingField(i, 'note', 'Keterangan', BBM_SAMPLING_NOTES, 'Pilih keterangan')}</td><td>{samplingField(i, 'result', 'Kesimpulan', BBM_SAMPLING_RESULTS, 'Pilih kesimpulan')}</td></tr>)}</tbody></table>
          <div className="bbm-notes"><div><strong>Keterangan:</strong><p>*) Pembelian sesuai transaksi pada struk.</p><p>**) Sampling diisi berdasarkan hasil pemeriksa dari Rayon. Pilih template yang sesuai atau Lainnya.</p><p>Stand awal otomatis dari catatan terakhir. Hari tanpa pembelian tetap wajib diisi odometer dan fotonya.</p><p>Tanggal berita acara otomatis di akhir bulan setelah seluruh odometer dan foto bulan itu lengkap.</p><p><Icon name="plus" size={14} /> Tambah transaksi · <Icon name="camera" size={14} /> Unggah foto · <Icon name="check-circle" size={14} /> Lihat foto</p></div><div><p>PTMX : Pertamax · PTLT : Pertalite · PREM : Premium</p><label>Tempat Pembelian BBM {meta('purchase_note', 'Keterangan tempat pembelian BBM')}</label><label>Nota / Kuitansi Pembelian BBM {meta('receipt_note', 'Keterangan nota / kuitansi')}</label></div></div>
          <div className="bbm-signatures"><div><p>Diperiksa,</p>{meta('inspector_title', 'Jabatan pemeriksa (TL Teknik)')}<div className="bbm-sign-space" />{meta('inspector_name', 'Nama pemeriksa')}</div><div><div className="bbm-sign-date">{meta('city', 'Tempat berita acara')}<span>{reportDate ? labelDate(reportDate, { day: 'numeric', month: 'long', year: 'numeric' }) : '____'}</span></div>{meta('coordinator_title', `Jabatan (Koordinator Yantek ${ulpName})`)}<div className="bbm-sign-space" />{meta('coordinator_name', 'Nama koordinator')}</div><div className="bbm-manager"><p>Mengetahui,</p><p>PT. PLN (Persero) {ulpName.toUpperCase()}</p>{meta('manager_title', 'Jabatan (Manager)')}<div className="bbm-sign-space" />{meta('manager_name', 'Nama manager')}</div></div>
          <p className="bbm-footnote">Format berita acara · Nama/jabatan diisi Admin ULP · Bukan persetujuan digital · Periode sampai {labelDate(lastDay, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>
    </>}
    {photo && <div className="bbm-lightbox" role="dialog" aria-modal="true" aria-label="Foto bukti BBM" onClick={() => setPhoto(null)}><button autoFocus onClick={() => setPhoto(null)} onKeyDown={(e) => { if (e.key === 'Escape') setPhoto(null) }}>Tutup <Icon name="close" /></button><img src={photo} alt="Foto bukti laporan BBM" onClick={(e) => e.stopPropagation()} /></div>}
    {notice && typeof document !== 'undefined' && createPortal(
      <div className={`bbm-toast bbm-toast-${notice.tone}`} role={notice.tone === 'danger' ? 'alert' : 'status'} aria-live={notice.tone === 'danger' ? 'assertive' : 'polite'}>
        <span className="bbm-toast-icon" aria-hidden="true"><Icon name={notice.tone === 'success' ? 'check-circle' : notice.tone === 'info' ? 'info' : 'alert-triangle'} size={18} /></span>
        <div className="bbm-toast-copy"><strong>{notice.title}</strong><span>{notice.message}</span></div>
        <button type="button" className="bbm-toast-close" aria-label="Tutup notifikasi" onClick={dismissNotice}><Icon name="close" size={14} /></button>
      </div>,
      document.body,
    )}
    <Modal
      open={Boolean(aiDetailDate && aiDetailCheck)}
      onClose={() => setAiDetailDate(null)}
      title="Pemeriksaan odometer"
      size="small"
      className={`bbm-ai-dialog is-${aiDetailMeta.tone}`}
      footer={aiDetailCheck ? (
        <>
          {aiDetailCheck.photo && <Button variant="secondary" onClick={() => showPhoto(aiDetailCheck.photo)} icon={<Icon name="camera" size={15} />}>Lihat foto</Button>}
          <Button variant="secondary" onClick={() => setAiDetailDate(null)}>Tutup</Button>
          {aiDetailCheck.status !== 'checking' && aiCheckAllowed && (
            <Button variant="primary" onClick={retryAiDetail}>{aiDetailCheck.status === 'error' ? 'Coba lagi' : 'Periksa lagi'}</Button>
          )}
        </>
      ) : null}
    >
      {aiDetailCheck && (
        <>
          <div className="bbm-ai-dialog-head">
            <span className="bbm-ai-dialog-icon" aria-hidden="true">
              <Icon name={aiDetailMeta.icon} size={22} className={aiDetailCheck.status === 'checking' ? 'bbm-ai-spin' : ''} />
            </span>
            <div>
              <strong>{aiDetailTitle}</strong>
              <p>{aiDetailDescription}</p>
            </div>
          </div>
          <dl className="bbm-ai-dialog-facts">
            <div><dt>Tanggal</dt><dd>{labelDate(aiDetailDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>
            {Number.isFinite(aiDetailReading) && <div><dt>Angka pada foto</dt><dd>{fmt(aiDetailReading, 1)}</dd></div>}
            {Number.isFinite(aiDetailExpected) && <div><dt>Stand akhir diisi</dt><dd>{fmt(aiDetailExpected, 1)}</dd></div>}
            {aiDetailCheck.status === 'mismatch' && Number.isFinite(aiDetailReading) && Number.isFinite(aiDetailExpected) && (
              <div className="is-difference"><dt>Selisih</dt><dd>{fmt(Math.abs(aiDetailReading - aiDetailExpected), 1)}</dd></div>
            )}
          </dl>
          {aiDetailCheck.message && aiDetailCheck.status === 'unreadable' && (
            <p className="bbm-ai-dialog-note"><Icon name="info" size={14} /> {aiDetailCheck.message}</p>
          )}
          {aiDetailCheck.status === 'mismatch' && (
            <ul className="bbm-ai-dialog-guide">
              <li>Cocokkan angka pada foto dengan Stand Akhir yang Anda isi.</li>
              <li>Perbaiki Stand Akhir bila angkanya salah, atau unggah ulang foto bila tidak sesuai.</li>
              <li>Hasil pemeriksaan bersifat pendamping; laporan tetap dapat disimpan setelah Anda memeriksanya.</li>
            </ul>
          )}
          {aiDetailCheck.status === 'unreadable' && (
            <ul className="bbm-ai-dialog-guide">
              <li>Pastikan seluruh angka odometer terlihat dan tidak terpotong.</li>
              <li>Hindari foto buram, gelap, atau terhalang benda lain.</li>
              <li>Unggah ulang foto yang lebih jelas; pemeriksaan akan dijalankan otomatis.</li>
            </ul>
          )}
          {aiDetailCheck.status === 'error' && (
            <ul className="bbm-ai-dialog-guide">
              <li>Foto sudah tersimpan dan laporan tetap dapat dilanjutkan.</li>
              <li>Coba periksa lagi beberapa saat lagi.</li>
              <li>Jika masalah berulang, hubungi Super Admin untuk memeriksa pengaturan layanan.</li>
            </ul>
          )}
          <p className="bbm-ai-dialog-footnote">
            <Icon name="shield" size={13} /> Pemeriksaan otomatis dapat salah membaca foto buram atau terhalang. Hasil ini tidak mengubah angka laporan dan bukan bukti keaslian foto.
          </p>
        </>
      )}
    </Modal>
    <ConfirmationDialog
      open={Boolean(confirm)}
      title={confirm?.title || 'Konfirmasi'}
      description={confirm?.description || ''}
      confirmLabel={confirm?.confirmLabel || 'Lanjutkan'}
      cancelLabel={confirm?.cancelLabel || 'Batal'}
      confirmTone={confirm?.tone || 'danger'}
      icon={confirm?.icon || 'alert-triangle'}
      className="bbm-confirm"
      backdropClassName="bbm-confirm-backdrop"
      onConfirm={() => resolveConfirm(true)}
      onCancel={() => resolveConfirm(false)}
    />
  </section>
}
