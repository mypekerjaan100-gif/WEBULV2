import { useEffect, useState } from 'react'
import { getToolEvidenceUrl } from '../../data/toolInspectionRepository.js'

export const MAX_PHOTOS = 5

export function formatDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Pontianak',
  }).format(new Date(value))
}

function pontianakParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Pontianak',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]))
}

export function pontianakInputValue(value = new Date()) {
  const parts = pontianakParts(value)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function inputValueToIso(value) {
  if (!value) return null
  const parsed = new Date(`${value}:00+07:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function ageLabel(months) {
  if (months == null) return 'Umur belum diketahui'
  if (months < 12) return `${months} bulan`
  const years = Math.floor(months / 12)
  const rest = months % 12
  return rest ? `${years} tahun ${rest} bulan` : `${years} tahun`
}

export function assetStatus(asset) {
  if (asset.open_issue) return { tone: 'danger', label: 'Rusak · issue terbuka' }
  if (asset.latest_inspection?.condition === 'DAMAGED') return { tone: 'danger', label: 'Rusak' }
  if (asset.latest_inspection?.condition === 'GOOD') return { tone: 'success', label: 'Baik' }
  return { tone: 'neutral', label: 'Belum diperiksa' }
}

export function EvidenceThumbs({ paths = [] }) {
  const key = paths.join('|')
  const [urls, setUrls] = useState([])
  useEffect(() => {
    let cancelled = false
    if (!paths.length) { setUrls([]); return undefined }
    Promise.all(paths.slice(0, MAX_PHOTOS).map(async (path) => {
      try { return await getToolEvidenceUrl(path) } catch { return '' }
    })).then((rows) => {
      if (!cancelled) setUrls(rows.filter(Boolean))
    })
    return () => { cancelled = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!paths.length) return null
  if (!urls.length) return <span className="tool-muted">Memuat foto…</span>
  return (
    <span className="tool-evidence-thumbs">
      {urls.map((url, index) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" title={`Bukti ${index + 1}`}>
          <img src={url} alt={`Bukti ${index + 1}`} loading="lazy" />
        </a>
      ))}
    </span>
  )
}

export function PhotoPicker({ files, onChange, disabled }) {
  return (
    <div className="tool-photo-picker">
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={disabled}
        onChange={(event) => {
          onChange(Array.from(event.target.files || []).slice(0, MAX_PHOTOS))
          event.target.value = ''
        }}
      />
      <span className="tool-muted">Wajib 1–{MAX_PHOTOS} foto. JPG/PNG/WebP, maksimal 12 MB per foto.</span>
      {files.length > 0 && (
        <ul className="tool-file-list">
          {files.map((file) => <li key={`${file.name}:${file.size}`}>{file.name}</li>)}
        </ul>
      )}
    </div>
  )
}
