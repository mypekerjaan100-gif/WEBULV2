import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { Alert, Button, Modal } from '../ui/Primitives.jsx'
import { getVehicleInspectionPhotoUrl } from '../../data/toolInspectionRepository.js'
import { VEHICLE_PHOTO_SLOTS } from './VehicleInspectionModal.jsx'

function timestamp(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Pontianak' }).format(new Date(value))
}

// Modal baca-saja: hasil inspeksi terakhir kendaraan beserta keempat foto
// berlabelnya. Foto diambil lewat signed URL bucket privat; kegagalan satu
// foto tidak mengunci slot lain dan dapat dimuat ulang.
export default function VehicleInspectionResultModal({ inspection, vehicle, onClose }) {
  const [attempt, setAttempt] = useState(0)
  const [photos, setPhotos] = useState({})
  const [loading, setLoading] = useState(true)
  const paths = inspection?.photo_paths || {}

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setPhotos({})
    const pending = VEHICLE_PHOTO_SLOTS.filter((slot) => paths[slot.key])
    Promise.all(pending.map(async (slot) => {
      try {
        const url = await getVehicleInspectionPhotoUrl(paths[slot.key])
        if (cancelled) return null
        return url ? [slot.key, { status: 'ready', url }] : [slot.key, { status: 'error', message: 'URL foto tidak tersedia.' }]
      } catch (loadError) {
        if (cancelled) return null
        return [slot.key, { status: 'error', message: loadError.message }]
      }
    }))
      .then((entries) => {
        if (cancelled) return
        setPhotos(Object.fromEntries(entries.filter(Boolean)))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [inspection, attempt])

  const damaged = inspection?.condition === 'DAMAGED'
  const note = String(inspection?.note || '').trim()
  const recordedCount = VEHICLE_PHOTO_SLOTS.filter((slot) => paths[slot.key]).length
  const failedCount = VEHICLE_PHOTO_SLOTS.filter((slot) => photos[slot.key]?.status === 'error').length
  const loadedCount = VEHICLE_PHOTO_SLOTS.filter((slot) => photos[slot.key]?.status === 'ready').length

  return (
    <Modal
      open
      size="large"
      className="ui-modal-vehicle-result"
      title={`Hasil Inspeksi · ${vehicle?.plate_display || vehicle?.label || 'Kendaraan'}`}
      onClose={onClose}
      footer={(
        <div className="tool-modal-actions">
          <span className="vehicle-inspection-progress" aria-live="polite">
            {loading ? 'Memuat foto...' : `${loadedCount}/${VEHICLE_PHOTO_SLOTS.length} foto dimuat`}
          </span>
          {failedCount > 0 && !loading && (
            <Button variant="ghost" onClick={() => setAttempt((value) => value + 1)}>Muat Ulang Foto</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Tutup</Button>
        </div>
      )}
    >
      <div className="tool-modal-scope vehicle-inspection-scope">
        <span className={`vehicle-result-badge vehicle-result-badge--${damaged ? 'damaged' : 'good'}`}>
          <Icon name={damaged ? 'alert-triangle' : 'check'} size={13} />
          Kondisi {damaged ? 'Rusak' : 'Baik'}
        </span>
        <span><Icon name="clock" size={12} /> Inspeksi {timestamp(inspection?.inspected_at)}</span>
        <span><Icon name="users" size={12} /> Petugas: {inspection?.inspected_by_name || 'Petugas'}</span>
        <span><Icon name="file-text" size={12} /> Catatan: {note ? note : 'Tidak ada catatan.'}</span>
      </div>
      <div className="vehicle-photo-grid vehicle-result-grid">
        {VEHICLE_PHOTO_SLOTS.map((slot) => {
          const entry = photos[slot.key]
          const path = paths[slot.key]
          return (
            <div className="vehicle-photo-slot" key={slot.key}>
              <span className="vehicle-photo-slot-label">{slot.label}</span>
              <span className="vehicle-photo-slot-frame">
                {!path ? 'Foto tidak tersedia.'
                  : entry?.status === 'ready' ? (
                    <a href={entry.url} target="_blank" rel="noreferrer" title={`Lihat foto ${slot.label} ukuran penuh`}>
                      <img src={entry.url} alt={`Foto inspeksi ${slot.label}`} loading="lazy" />
                    </a>
                  )
                  : entry?.status === 'error' ? (
                    <button
                      type="button"
                      className="vehicle-photo-retry"
                      disabled={loading}
                      onClick={() => setAttempt((value) => value + 1)}
                    >
                      <Icon name="refresh-cw" size={13} />
                      Muat ulang
                      <span>{entry.message}</span>
                    </button>
                  )
                  : (
                    <>
                      <Icon name="loader" size={16} className="ui-icon-spin" />
                      <span>Memuat...</span>
                    </>
                  )}
              </span>
            </div>
          )
        })}
      </div>
      {loading && <Alert tone="info">Memuat foto hasil inspeksi dari penyimpanan...</Alert>}
      {!loading && recordedCount < VEHICLE_PHOTO_SLOTS.length && (
        <Alert tone="warning">Hanya {recordedCount} dari 4 foto tercatat pada inspeksi ini.</Alert>
      )}
    </Modal>
  )
}
