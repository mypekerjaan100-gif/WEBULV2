import { Fragment, useState } from 'react'
import { currentNameOf, effectiveStatusOf } from '../../data/organisasiPelayananTeknik.js'
import {
  collectLocationReferences,
  currentLocationNameOf,
  currentLocationUsers,
  effectiveStatusOfLocation,
  today,
} from '../../data/lokasiPelayananTeknik.js'

const inputClass = 'sla-input sla-input-text'

const REFERENCE_LABEL = {
  pegawai: 'pegawai',
  'pegawai-riwayat': 'riwayat pegawai',
  pengajuan: 'pengajuan',
}

const referenceText = (refs) =>
  refs.map((ref) => `${REFERENCE_LABEL[ref.kind] ?? ref.kind} "${ref.label}"`).join(', ')

export default function SLAMasterLokasi({
  contractScope,
  up3Id,
  units,
  locations,
  role,
  unitId,
  canMutate,
  onCreateLocation,
  onRenameLocation,
  onStatusLocation,
  onDeleteLocation,
  referencesContext = {},
}) {
  const [expanded, setExpanded] = useState(() => new Set())
  const [addingFor, setAddingFor] = useState(null)
  const [form, setForm] = useState({
    up3Id: '',
    unitId: '',
    name: '',
    effectiveFrom: today(),
  })
  const [editingId, setEditingId] = useState(null)
  const [historyId, setHistoryId] = useState(null)
  const [menuFor, setMenuFor] = useState(null)
  const [blocked, setBlocked] = useState(null)
  const [mutationError, setMutationError] = useState('')
  const [saving, setSaving] = useState(false)

  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  const unitName = (id) => currentNameOf(unitById.get(id)) ?? id
  const up3Units = units.filter((unit) => unit.type === 'UP3' && unit.id === up3Id)
  const isUp3Preview = role === 'up3'
  const visibleLocations = locations.filter(
    (location) =>
      (location.contractId == null ||
        location.contractId === contractScope.contractId) &&
      (location.up3Id == null || location.up3Id === up3Id) &&
      (isUp3Preview || location.unitId === unitId),
  )
  const employees = referencesContext.employees ?? []

  const toggleExpand = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const resetForms = () => {
    setAddingFor(null)
    setForm({ up3Id: '', unitId: '', name: '', effectiveFrom: today() })
    setEditingId(null)
    setHistoryId(null)
    setMenuFor(null)
    setBlocked(null)
    setMutationError('')
  }

  const startAdd = (unit) => {
    resetForms()
    const up3 = unit.type === 'UP3' ? unit : unitById.get(unit.parentUnitId)
    const firstUlp =
      unit.type === 'UP3'
        ? units.find((item) => item.type === 'ULP' && item.parentUnitId === unit.id)?.id ?? ''
        : unit.id
    setForm({
      up3Id: up3?.id ?? unit.id,
      unitId: firstUlp,
      name: '',
      effectiveFrom: today(),
    })
    setAddingFor(unit.id)
    setExpanded((prev) => new Set(prev).add(unit.id))
  }

  const startEdit = (location) => {
    resetForms()
    setEditingId(location.id)
    setForm({
      up3Id: '',
      unitId: '',
      name: currentLocationNameOf(location),
      effectiveFrom: today(),
    })
  }

  const startHistory = (location) => {
    resetForms()
    setHistoryId(location.id)
  }

  const submitAdd = async () => {
    if (!canMutate || form.up3Id !== up3Id) return
    const name = form.name.trim()
    if (!name || !form.unitId || !form.effectiveFrom || !addingFor) return
    setSaving(true)
    setMutationError('')
    try {
      await onCreateLocation({
        unitId: form.unitId,
        name,
        effectiveFrom: form.effectiveFrom,
      })
      resetForms()
    } catch (error) {
      setMutationError(error.message || 'Gagal menambah Kantor Jaga.')
    } finally {
      setSaving(false)
    }
  }

  const submitRename = async (location) => {
    if (!canMutate || location.up3Id !== up3Id) return
    if (!form.name.trim() || !form.effectiveFrom) return
    setSaving(true)
    setMutationError('')
    try {
      await onRenameLocation({
        locationId: location.id,
        name: form.name.trim(),
        effectiveFrom: form.effectiveFrom,
      })
      resetForms()
    } catch (error) {
      setMutationError(error.message || 'Gagal mengubah nama Kantor Jaga.')
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (location) => {
    if (!canMutate || location.up3Id !== up3Id) return
    setSaving(true)
    setMutationError('')
    try {
      await onStatusLocation({
        locationId: location.id,
        ownStatus: location.ownStatus === 'Aktif' ? 'Nonaktif' : 'Aktif',
      })
    } catch (error) {
      setMutationError(error.message || 'Gagal mengubah status Kantor Jaga.')
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = async (location) => {
    if (!canMutate || location.up3Id !== up3Id) return
    const refs = collectLocationReferences(location.id, referencesContext)
    if (refs.length) {
      setMenuFor(null)
      setBlocked({ locationId: location.id, refs })
      return
    }
    setMenuFor(null)
    const ok = window.confirm(`Hapus permanen lokasi "${currentLocationNameOf(location)}"?`)
    if (!ok) return
    setSaving(true)
    setMutationError('')
    try {
      await onDeleteLocation(location.id)
      resetForms()
    } catch (error) {
      setMutationError(error.message || 'Gagal menghapus Kantor Jaga.')
    } finally {
      setSaving(false)
    }
  }

  const renderStatusBadge = (ownStatus) => (
    <span
      className={`sla-status-badge ${ownStatus === 'Aktif' ? 'sla-status-active' : 'sla-status-archive'}`}
    >
      {ownStatus}
    </span>
  )

  const renderEffectiveHint = (ownStatus, effective) =>
    effective !== ownStatus ? (
      <div className="sla-loc-hint">eff: {effective} — karena parent nonaktif</div>
    ) : null

  const renderLocationStatus = (location) => {
    const effective = effectiveStatusOfLocation(locations, units, location.id)
    return (
      <>
        {renderStatusBadge(location.ownStatus)}
        {renderEffectiveHint(location.ownStatus, effective)}
      </>
    )
  }

  const renderUnitStatus = (unit) => {
    const effective = effectiveStatusOf(units, unit.id)
    return (
      <>
        {renderStatusBadge(unit.status)}
        {renderEffectiveHint(unit.status, effective)}
      </>
    )
  }

  const renderKjActions = (location) => {
    if (!canMutate) return <span className="sla-loc-hint">read-only</span>
    return (
      <div className="sla-loc-actions">
        <button type="button" className="sla-btn" disabled={saving} onClick={() => startEdit(location)}>
          Edit
        </button>
        <button type="button" className="sla-btn" disabled={saving} onClick={() => toggleStatus(location)}>
          {location.ownStatus === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}
        </button>
        <div className="sla-loc-menu-wrap">
          <button
            type="button"
            className="sla-btn"
            onClick={() => setMenuFor(menuFor === location.id ? null : location.id)}
          >
            {'\u22ee'}
          </button>
          {menuFor === location.id && (
            <div className="sla-loc-menu">
              <button type="button" className="sla-loc-menu-item" onClick={() => startHistory(location)}>
                Riwayat
              </button>
              <button type="button" className="sla-loc-menu-item" disabled={saving} onClick={() => requestDelete(location)}>
                Hapus
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderLocationCard = (location) => {
    const typeLabel = location.type === 'UNIT_OFFICE' ? 'UNIT OFFICE' : 'KANTOR JAGA'
    const typeClass = location.type === 'UNIT_OFFICE' ? 'sla-loc-badge-office' : 'sla-loc-badge-kj'
    const empCount = currentLocationUsers(employees, location.id)
    const isUnitOffice = location.type === 'UNIT_OFFICE'

    return (
      <Fragment key={location.id}>
        <div className="sla-loc-card sla-loc-card-loc">
          <div className="sla-loc-card-header">
            <div className="sla-loc-card-name-row">
              <span className={`sla-loc-badge ${typeClass}`}>{typeLabel}</span>
              <span className="sla-loc-card-name">{currentLocationNameOf(location)}</span>
            </div>
            <div className="sla-loc-card-meta">
              <span className="sla-loc-card-emp">{empCount} pegawai</span>
              {renderLocationStatus(location)}
            </div>
          </div>
          <div className="sla-loc-card-actions">
            {isUnitOffice ? (
              canMutate ? (
                <button type="button" className="sla-btn" onClick={() => startHistory(location)}>
                  Riwayat
                </button>
              ) : (
                <span className="sla-loc-hint">read-only</span>
              )
            ) : (
              renderKjActions(location)
            )}
          </div>
          {editingId === location.id && (
            <div className="sla-loc-edit-form">
              <div className="sla-context-field">
                <span className="sla-context-label">Nama baru</span>
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <div className="sla-context-field">
                <span className="sla-context-label">Berlaku mulai</span>
                <input
                  className={inputClass}
                  type="date"
                  value={form.effectiveFrom}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))
                  }
                />
              </div>
              <div className="sla-master-actions">
                <button type="button" className="sla-btn sla-btn-primary" disabled={saving} onClick={() => submitRename(location)}>
                  Simpan
                </button>
                <button type="button" className="sla-btn" onClick={resetForms}>
                  Batal
                </button>
              </div>
            </div>
          )}
          {historyId === location.id && (
            <div className="sla-loc-history">
              <div className="sla-history-list">
                {[...(location.nameHistory ?? [])]
                  .sort((a, b) => ((a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1))
                  .map((entry) => (
                    <div key={entry.id}>
                      {entry.name} (sejak {entry.validFrom ?? 'awal'} {'\u2014'}{' '}
                      {entry.validTo == null ? 'sekarang' : entry.validTo})
                    </div>
                  ))}
              </div>
            </div>
          )}
          {blocked?.locationId === location.id && (
            <div className="sla-blocked-row">
              <p className="sla-blocked-note">
                Lokasi sudah digunakan oleh {referenceText(blocked.refs)}. Tidak dapat
                dihapus permanen. Gunakan Nonaktifkan agar lokasi tidak aktif secara
                efektif.
              </p>
              <button type="button" className="sla-btn" onClick={() => setBlocked(null)}>
                Tutup
              </button>
            </div>
          )}
        </div>
      </Fragment>
    )
  }

  const renderAddForm = () => {
    if (!addingFor) return null
    const ulpOptions = units.filter(
      (unit) =>
        unit.type === 'ULP' &&
        (form.up3Id ? unit.parentUnitId === form.up3Id : true) &&
        (isUp3Preview || unit.id === unitId),
    )
    return (
      <div className="sla-loc-card sla-loc-card-add">
        <div className="sla-loc-card-header">
          <span className="sla-loc-badge sla-loc-badge-add">Tambah Kantor Jaga</span>
        </div>
        <div className="sla-loc-add-form">
          <div className="sla-context-field">
            <span className="sla-context-label">UP3</span>
            <select
              className="sla-context-select"
              value={form.up3Id}
              disabled={!canMutate}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, up3Id: event.target.value, unitId: '' }))
              }
            >
              {up3Units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {currentNameOf(unit)}
                </option>
              ))}
            </select>
          </div>
          <div className="sla-context-field">
            <span className="sla-context-label">ULP</span>
            <select
              className="sla-context-select"
              value={form.unitId}
              disabled={!canMutate}
              onChange={(event) => setForm((prev) => ({ ...prev, unitId: event.target.value }))}
            >
              {ulpOptions.length ? (
                <option value="" disabled>
                  Pilih ULP
                </option>
              ) : null}
              {ulpOptions.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {currentNameOf(unit)}
                </option>
              ))}
            </select>
          </div>
          <div className="sla-context-field">
            <span className="sla-context-label">Nama Kantor Jaga</span>
            <input
              className={inputClass}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div className="sla-context-field">
            <span className="sla-context-label">Berlaku mulai</span>
            <input
              className={inputClass}
              type="date"
              value={form.effectiveFrom}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))
              }
            />
          </div>
          <div className="sla-master-actions">
            <button type="button" className="sla-btn sla-btn-primary" disabled={saving} onClick={submitAdd}>
              Simpan
            </button>
            <button type="button" className="sla-btn" onClick={resetForms}>
              Batal
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderUp3Card = (up3) => {
    const ulps = units.filter((unit) => unit.type === 'ULP' && unit.parentUnitId === up3.id)
    const visibleUlps = isUp3Preview ? ulps : ulps.filter((ulp) => ulp.id === unitId)
    const ulpCount = ulps.length
    const totalKjCount = units.filter(
      (unit) => unit.type === 'ULP' && unit.parentUnitId === up3.id
    ).reduce((sum, ulp) => sum + (visibleLocations.filter((loc) => loc.unitId === ulp.id && loc.type === 'KANTOR_JAGA').length), 0)

    const isExpanded = expanded.has(up3.id)

    return (
      <Fragment key={up3.id}>
        <div className="sla-loc-card sla-loc-card-up3">
          <div className="sla-loc-card-header up3" onClick={() => toggleExpand(up3.id)}>
            <div className="sla-loc-card-name-row">
              <span className="sla-tree-toggle" aria-hidden="true">
                {isExpanded ? '\u25be' : '\u25b8'}
              </span>
              <span className="sla-loc-badge sla-loc-badge-up3">UP3</span>
              <span className="sla-loc-card-name">{currentNameOf(up3)}</span>
            </div>
            <div className="sla-loc-card-meta up3">
              <span className="sla-loc-summary">{ulpCount} ULP · {totalKjCount} Kantor Jaga</span>
              {renderUnitStatus(up3)}
            </div>
          </div>
          <div className="sla-loc-card-actions">
            {canMutate && (
              <button type="button" className="sla-btn" onClick={() => startAdd(up3)}>
                + Tambah Kantor Jaga
              </button>
            )}
          </div>
          {addingFor === up3.id && renderAddForm()}
          {isExpanded && (
            <div className="sla-up3-children">
              <div className="sla-up3-locations">
                {visibleLocations
                  .filter((location) => location.unitId === up3.id)
                  .map(renderLocationCard)}
              </div>
              {visibleUlps.map((ulp) => {
                const kjCount = visibleLocations.filter(
                  (location) => location.unitId === ulp.id && location.type === 'KANTOR_JAGA',
                ).length
                const isUlpExpanded = expanded.has(ulp.id)

                return (
                  <Fragment key={ulp.id}>
                    <div className="sla-loc-card sla-loc-card-ulp">
                      <div className="sla-loc-card-header ulp" onClick={() => toggleExpand(ulp.id)}>
                        <div className="sla-loc-card-name-row">
                          <span className="sla-tree-toggle" aria-hidden="true">
                            {isUlpExpanded ? '\u25be' : '\u25b8'}
                          </span>
                          <span className="sla-loc-badge sla-loc-badge-ulp">ULP</span>
                          <span className="sla-loc-card-name">{currentNameOf(ulp)}</span>
                        </div>
                        <div className="sla-loc-card-meta ulp">
                          <span className="sla-loc-summary">{kjCount} Kantor Jaga</span>
                          {renderUnitStatus(ulp)}
                        </div>
                      </div>
                      <div className="sla-loc-card-actions">
                        {canMutate && (
                          <button type="button" className="sla-btn" onClick={() => startAdd(ulp)}>
                            + Tambah Kantor Jaga
                          </button>
                        )}
                      </div>
                      {addingFor === ulp.id && renderAddForm()}
                      {isUlpExpanded && (
                        <div className="sla-ulp-children">
                          {visibleLocations
                            .filter((location) => location.unitId === ulp.id)
                            .map(renderLocationCard)}
                        </div>
                      )}
                    </div>
                  </Fragment>
                )
              })}
            </div>
          )}
        </div>
      </Fragment>
    )
  }

  return (
    <section className="sla-settings">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Master Lokasi</h2>
        <span className="sla-status-badge sla-status-active">Supabase</span>
      </div>
      <p className="sla-flat-note">
        Lokasi penempatan kerja pegawai ({contractScope.contractName}). UNIT_OFFICE
        adalah lokasi bawaan otomatis yang namanya mengikuti Master Organisasi
        (sinkron otomatis, tidak dapat di-rename manual). KANTOR_JAGA dikelola
        SUPER_ADMIN pada fase bootstrap. Effective Status lokasi mengikuti parent
        tanpa menimpa own status. Lokasi yang sudah digunakan pegawai tidak dapat dihapus permanen.
        {role === 'ulp' && ' Admin ULP hanya dapat melihat lokasi unitnya sendiri.'}
      </p>
      {mutationError && <p className="sla-blocked-note">{mutationError}</p>}

      <div className="sla-loc-hierarchy">
        {up3Units.map(renderUp3Card)}
      </div>
    </section>
  )
}