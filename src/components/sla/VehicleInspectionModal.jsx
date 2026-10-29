import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { Alert, Button, FormField, Input, Modal, Textarea } from '../ui/Primitives.jsx'
import { prepareVehicleEvidence } from '../../data/toolEvidence.js'
import { submitVehicleInspection, uploadVehicleInspectionPhoto } from '../../data/toolInspectionRepository.js'
import { inputValueToIso, pontianakInputValue } from './ToolEvidence.jsx'

// Empat slot wajib, tiap slot tepat satu foto; server menegakkan aturan yang sama.
export const VEHICLE_PHOTO_SLOTS = [
  { key: 'SIDE_RIGHT', label: 'Samping kanan' },
  { key: 'SIDE_LEFT', label: 'Samping kiri' },
  { key: 'FRONT', label: 'Tampak depan' },
  { key: 'REAR', label: 'Tampak belakang' },
]

const MAX_VEHICLE_PHOTO_BYTES = 500 * 1024

function formatKb(size) {
  if (!Number.isFinite(size)) return ''
  return `${Math.max(1, Math.round(size / 1024))} KB`
}

export default function VehicleInspectionModal({
  contractUuid, up3Uuid, ulpId, vehicle, onClose, onSaved, onEditorStateChange,
}) {
  const initRef = useRef({ condition: 'GOOD', inspectedAt: pontianakInputValue(), note: '' })
  const [condition, setCondition] = useState(initRef.current.condition)
  const [inspectedAt, setInspectedAt] = useState(initRef.current.inspectedAt)
  const [note, setNote] = useState('')
  const [slots, setSlots] = useState({})
  const [compressing, setCompressing] = useState('')
  const [uploadingSlot, setUploadingSlot] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const objectUrlsRef = useRef(new Set())
  const uploadedRef = useRef({})

  const filledCount = VEHICLE_PHOTO_SLOTS.reduce((total, slot) => (slots[slot.key] ? total + 1 : total), 0)
  const ready = filledCount === VEHICLE_PHOTO_SLOTS.length && Boolean(inspectedAt) && condition
  const dirty = condition !== initRef.current.condition
    || inspectedAt !== initRef.current.inspectedAt
    || note !== initRef.current.note
    || filledCount > 0

  useEffect(() => {
    const urls = objectUrlsRef.current
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  useEffect(() => {
    onEditorStateChange?.({ dirty, busy })
    return () => onEditorStateChange?.({ dirty: false, busy: false })
  }, [dirty, busy, onEditorStateChange])

  const rememberUrl = (url) => {
    objectUrlsRef.current.add(url)
    return url
  }

  const pickPhoto = async (slotKey, event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFormError('')
    setCompressing(slotKey)
    let prepared
    try {
      prepared = await prepareVehicleEvidence(file)
    } catch (pickError) {
      setFormError(pickError.message)
      setCompressing('')
      return
    }
    setCompressing('')
    delete uploadedRef.current[slotKey]
    setSlots((prev) => {
      const replaced = prev[slotKey]
      if (replaced?.url) {
        URL.revokeObjectURL(replaced.url)
        objectUrlsRef.current.delete(replaced.url)
      }
      return { ...prev, [slotKey]: { file: prepared, url: rememberUrl(URL.createObjectURL(prepared)), size: prepared.size } }
    })
  }

  const removePhoto = (slotKey) => {
    setSlots((prev) => {
      const removed = prev[slotKey]
      if (removed?.url) {
        URL.revokeObjectURL(removed.url)
        objectUrlsRef.current.delete(removed.url)
      }
      const next = { ...prev }
      delete next[slotKey]
      return next
    })
    delete uploadedRef.current[slotKey]
    setFormError('')
  }

  const requestClose = () => {
    if (busy) return
    if (dirty && !window.confirm('Isian belum disimpan. Tutup formulir?')) return
    onClose?.()
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (busy) return
    setFormError('')
    const missing = VEHICLE_PHOTO_SLOTS.find((slot) => !slots[slot.key])
    if (missing) {
      setFormError(`Foto ${missing.label} wajib diunggah; setiap slot tepat satu foto.`)
      return
    }
    const inspectedIso = inputValueToIso(inspectedAt)
    if (!inspectedIso) {
      setFormError('Tanggal dan waktu inspeksi wajib diisi.')
      return
    }
    setBusy(true)
    try {
      const photoPaths = {}
      for (const slot of VEHICLE_PHOTO_SLOTS) {
        const reused = uploadedRef.current[slot.key]
        if (reused) {
          photoPaths[slot.key] = reused
          continue
        }
        setUploadingSlot(slot.label)
        photoPaths[slot.key] = await uploadVehicleInspectionPhoto({
          contractId: contractUuid,
          up3Id: up3Uuid,
          ulpId,
          vehicleId: vehicle.id,
          slotKey: slot.key,
          file: slots[slot.key].file,
        })
        uploadedRef.current[slot.key] = photoPaths[slot.key]
      }
      setUploadingSlot('')
      const saved = await submitVehicleInspection({
        slotId: vehicle.id,
        inspectedAt: inspectedIso,
        condition,
        note: note.trim(),
        photoPaths,
      })
      onSaved?.(saved)
    } catch (submitError) {
      setFormError(submitError.message)
    } finally {
      setUploadingSlot('')
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      size="large"
      title={`Inspeksi Kendaraan · ${vehicle?.plate_display || vehicle?.label || 'Kendaraan'}`}
      onClose={requestClose}
      dismissDisabled={busy}
      footer={(
        <div className="tool-modal-actions">
          <span className="vehicle-inspection-progress" aria-live="polite">
            {busy
              ? (uploadingSlot ? `Mengunggah foto ${uploadingSlot}...` : 'Menyimpan...')
              : `${filledCount}/${VEHICLE_PHOTO_SLOTS.length} foto siap · maksimal ${formatKb(MAX_VEHICLE_PHOTO_BYTES)} per foto`}
          </span>
          <Button variant="ghost" disabled={busy} onClick={requestClose}>Batal</Button>
          <Button variant="primary" disabled={busy || !ready} onClick={handleSubmit}>
            {busy ? 'Menyimpan...' : 'Simpan Inspeksi'}
          </Button>
        </div>
      )}
    >
      <form className="tool-form vehicle-inspection-form" onSubmit={handleSubmit}>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="tool-modal-scope vehicle-inspection-scope">
          <strong>{vehicle?.plate_display || vehicle?.label || 'Kendaraan'}</strong>
          <span>{vehicle?.vehicle_type_name || '-'} / {vehicle?.assignment_name || '-'}</span>
          <span>Wajib 4 foto: samping kanan, samping kiri, tampak depan, tampak belakang. Setiap foto dikompresi otomatis maksimal 500 KB.</span>
        </div>
        <div className="tool-form-grid">
          <FormField label="Kondisi kendaraan" required>
            <div className="uc-condition-options" role="radiogroup" aria-label="Kondisi kendaraan">
              {[['Baik', 'GOOD', 'check'], ['Rusak', 'DAMAGED', 'alert-triangle']].map(([label, value, icon]) => (
                <label key={value}>
                  <input type="radio" name="vehicle-inspection-condition" checked={condition === value} onChange={() => setCondition(value)} />
                  <Icon name={icon} size={13} />
                  {label}
                </label>
              ))}
            </div>
          </FormField>
          <FormField label="Tanggal & waktu inspeksi" required>
            <Input
              type="datetime-local"
              value={inspectedAt}
              max={pontianakInputValue()}
              onChange={(event) => setInspectedAt(event.target.value)}
            />
          </FormField>
          <FormField label="Catatan" helper="Catatan pemeriksaan kendaraan (opsional, maksimal 2000 karakter)">
            <Textarea
              rows={3}
              maxLength={2000}
              value={note}
              placeholder="Contoh: baret depan kanan, ban depan sudah tipis"
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
        </div>
        <div className="vehicle-photo-grid">
          {VEHICLE_PHOTO_SLOTS.map((slot) => {
            const entry = slots[slot.key]
            return (
              <div className={`vehicle-photo-slot ${entry ? 'has-photo' : ''}`} key={slot.key}>
                <span className="vehicle-photo-slot-label">{slot.label}<em aria-hidden="true">*</em></span>
                <span className="vehicle-photo-slot-frame">
                  {entry ? <img src={entry.url} alt={`Pratinjau foto ${slot.label}`} /> : <Icon name="camera" size={22} />}
                </span>
                <label className="vehicle-photo-slot-input" aria-label={`Pilih foto ${slot.label}`}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy || compressing !== ''}
                    onChange={(event) => pickPhoto(slot.key, event)}
                  />
                  {compressing === slot.key ? 'Mengompres...' : entry ? 'Ganti foto' : 'Pilih foto'}
                </label>
                <span className="vehicle-photo-slot-size">
                  {entry
                    ? `${formatKb(entry.size)} · JPG ≤ ${formatKb(MAX_VEHICLE_PHOTO_BYTES)}`
                    : `JPG/PNG/WebP, maksimal 12 MB sebelum dikompresi`}
                </span>
                {entry && (
                  <button
                    type="button"
                    className="vehicle-photo-slot-clear"
                    disabled={busy}
                    aria-label={`Hapus foto ${slot.label}`}
                    onClick={() => removePhoto(slot.key)}
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {!ready && <Alert tone="warning">Simpan Inspeksi aktif setelah kondisi, waktu, dan keempat foto siap masing-masing satu.</Alert>}
      </form>
    </Modal>
  )
}
