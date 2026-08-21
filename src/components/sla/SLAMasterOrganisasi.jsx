import { Fragment, useState } from 'react'
import {
  collectUnitReferences,
  currentNameOf,
  effectiveStatusOf,
} from '../../data/organisasiPelayananTeknik.js'
import { authorizeScope } from '../../data/scopePelayananTeknik.js'

const inputClass = 'sla-input sla-input-text'

const prevPeriodKey = (key) => {
  const [year, month] = String(key ?? '').split('-').map(Number)
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null
  const date = new Date(year, month - 2, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const formatPeriodKey = (key) => {
  if (!key) return 'sejak awal'
  const [year, month] = key.split('-')
  return `${month}-${year}`
}

const sortHistory = (history) =>
  [...(history ?? [])].sort((a, b) =>
    (a.validFrom ?? '') < (b.validFrom ?? '') ? -1 : 1,
  )

const REFERENCE_LABEL = {
  pegawai: 'pegawai',
  penandatangan: 'penandatangan',
  sla: 'SLA/report',
}

const referenceText = (refs) =>
  refs.map((ref) => `${REFERENCE_LABEL[ref.kind] ?? ref.kind} "${ref.label}"`).join(', ')

export default function SLAMasterOrganisasi({
  contractScope,
  up3Id,
  role,
  units,
  onUnitsChange,
  referencesContext = {},
}) {
  const scopeUp3Id = up3Id
  const [expanded, setExpanded] = useState(() => new Set())
  const [form, setForm] = useState({ name: '', validFrom: '2026-08' })
  const [editingId, setEditingId] = useState(null)
  const [historyId, setHistoryId] = useState(null)
  const [addingUlpFor, setAddingUlpFor] = useState(null)
  const [blocked, setBlocked] = useState(null)

  const up3Units = units.filter(
    (unit) => unit.type === 'UP3' && unit.id === up3Id,
  )

  const inScope = (unit) =>
    unit.type === 'UP3'
      ? unit.id === up3Id
      : unit.parentUnitId === up3Id

  const scopeOk = authorizeScope({
    contractId: contractScope.contractId,
    up3Id,
    unitId: up3Id,
    role,
    units,
  }).ok

  const getRefs = (unitId) => collectUnitReferences(unitId, referencesContext)

  const updateUnit = (unitId, patch) =>
    onUnitsChange(
      units.map((unit) =>
        unit.id === unitId && inScope(unit) ? { ...unit, ...patch } : unit,
      ),
    )

  const toggleExpand = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const resetForms = () => {
    setForm({ name: '', validFrom: '2026-08' })
    setEditingId(null)
    setHistoryId(null)
    setAddingUlpFor(null)
    setBlocked(null)
  }

  const toggleStatus = (unit) => {
    if (!scopeOk || !inScope(unit)) return
    updateUnit(unit.id, {
      status: unit.status === 'Aktif' ? 'Nonaktif' : 'Aktif',
    })
  }

  const startEdit = (unit) => {
    resetForms()
    setEditingId(unit.id)
    setForm({ name: currentNameOf(unit), validFrom: '2026-08' })
  }

  const startAddUlp = (up3) => {
    resetForms()
    setAddingUlpFor(up3.id)
    setExpanded((prev) => new Set(prev).add(up3.id))
  }

  const startHistory = (unit) => {
    resetForms()
    setHistoryId(unit.id)
  }

  const submitAddUlp = (up3Id) => {
    if (!scopeOk || up3Id !== scopeUp3Id) return
    const name = form.name.trim() || 'ULP Baru'
    const id = `ulp-${Date.now().toString(36)}`
    onUnitsChange([
      ...units,
      {
        id,
        type: 'ULP',
        parentUnitId: up3Id,
        status: 'Aktif',
        nameHistory: [{ id: `nh-${Date.now()}`, name, validFrom: null, validTo: null }],
      },
    ])
    resetForms()
  }

  const submitRename = (unit) => {
    if (!scopeOk || !inScope(unit)) return
    const name = form.name.trim()
    const validFrom = form.validFrom.trim()
    if (!name || !validFrom) return
    const history = sortHistory(unit.nameHistory).map((entry) =>
      entry.validTo == null
        ? { ...entry, validTo: prevPeriodKey(validFrom) ?? entry.validTo }
        : entry,
    )
    updateUnit(unit.id, {
      nameHistory: [
        ...history,
        {
          id: `nh-${Date.now()}`,
          name,
          validFrom,
          validTo: null,
        },
      ],
    })
    resetForms()
  }

  const requestDelete = (unit) => {
    if (!scopeOk || !inScope(unit)) return
    if (unit.type === 'UP3' && unit.id === up3Id) {
      setBlocked({
        unitId: unit.id,
        kind: 'scope-root',
      })
      return
    }
    const refs = getRefs(unit.id)
    const children = units.filter(
      (item) => item.type === 'ULP' && item.parentUnitId === unit.id,
    )
    if (refs.length) {
      setBlocked({ unitId: unit.id, kind: 'referenced', refs })
      return
    }
    if (unit.type === 'UP3' && children.length) {
      const childBlocked = []
      children.forEach((child) => {
        const childRefs = getRefs(child.id)
        if (childRefs.length) childBlocked.push({ unit: child, refs: childRefs })
      })
      if (childBlocked.length) {
        setBlocked({ unitId: unit.id, kind: 'children-referenced', childBlocked })
        return
      }
      const ok = window.confirm(
        `UP3 "${currentNameOf(unit)}" masih memiliki ${children.length} child ULP yang tidak direferensikan data lain. Hapus permanen UP3 bersama seluruh child ULP?`,
      )
      if (ok) {
        onUnitsChange(
          units.filter(
            (item) => item.id !== unit.id && item.parentUnitId !== unit.id,
          ),
        )
      }
      return
    }
    const ok = window.confirm(`Hapus permanen "${currentNameOf(unit)}"?`)
    if (ok) onUnitsChange(units.filter((item) => item.id !== unit.id))
  }

  const renderStatus = (unit) => {
    const effective = effectiveStatusOf(units, unit.id)
    const inherited = unit.type === 'ULP' && effective !== unit.status
    return (
      <>
        <span
          className={`sla-status-badge ${unit.status === 'Aktif' ? 'sla-status-active' : 'sla-status-archive'}`}
        >
          {unit.status}
        </span>
        <div className="sla-table-hint">
          eff: {effective}
          {inherited ? ' (parent)' : ''}
        </div>
      </>
    )
  }

  const renderBlockedRow = (unitId) => {
    if (!blocked || blocked.unitId !== unitId) return null
    return (
      <tr className="sla-blocked-row">
        <td colSpan={6}>
          <p className="sla-blocked-note">
            {blocked.kind === 'referenced' &&
              `Unit sudah digunakan oleh ${referenceText(blocked.refs)}. Tidak dapat dihapus permanen. Gunakan Nonaktifkan agar unit tidak aktif secara efektif.`}
            {blocked.kind === 'children-referenced' &&
              `UP3 masih memiliki child ULP yang direferensikan data lain (${blocked.childBlocked
                .map((item) => `"${currentNameOf(item.unit)}"`)
                .join(', ')}). Permanent delete diblokir. Gunakan Nonaktifkan UP3; child ULP ikut effective nonaktif tanpa mengubah own status-nya.`}
            {blocked.kind === 'scope-root' &&
              `UP3 "${currentNameOf(units.find((unit) => unit.id === up3Id))}" adalah scope yang sedang dipilih dan tidak dapat dihapus. Gunakan Nonaktifkan bila diperlukan.`}
          </p>
          <button type="button" className="sla-btn" onClick={() => setBlocked(null)}>
            Tutup
          </button>
        </td>
      </tr>
    )
  }

  const renderEditRow = (unit) => {
    if (editingId !== unit.id) return null
    return (
      <tr className="sla-edit-row">
        <td colSpan={6}>
          <div className="sla-sign-group-head">
            <div className="sla-context-field">
              <span className="sla-context-label">Nama baru</span>
              <input
                className={inputClass}
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Berlaku mulai (YYYY-MM)</span>
              <input
                className={inputClass}
                value={form.validFrom}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, validFrom: event.target.value }))
                }
              />
            </div>
            <div className="sla-master-actions">
              <button type="button" className="sla-btn sla-btn-primary" onClick={() => submitRename(unit)}>
                Simpan
              </button>
              <button type="button" className="sla-btn" onClick={resetForms}>
                Batal
              </button>
            </div>
          </div>
        </td>
      </tr>
    )
  }

  const renderHistoryRow = (unit) => {
    if (historyId !== unit.id) return null
    return (
      <tr className="sla-history-row">
        <td colSpan={6}>
          <div className="sla-history-list">
            {sortHistory(unit.nameHistory).map((entry) => (
              <div key={entry.id}>
                {entry.name} ({formatPeriodKey(entry.validFrom)} {'\u2014'}{' '}
                {entry.validTo == null ? 'sekarang' : formatPeriodKey(entry.validTo)})
              </div>
            ))}
          </div>
        </td>
      </tr>
    )
  }

  const renderUlpRow = (up3) => {
    if (!expanded.has(up3.id)) return null
    const children = units.filter(
      (unit) => unit.type === 'ULP' && unit.parentUnitId === up3.id,
    )
    if (!children.length) {
      return (
        <tr className="sla-tree-empty">
          <td colSpan={6}>Belum ada ULP. Gunakan aksi &ldquo;Tambah ULP&rdquo; pada baris UP3.</td>
        </tr>
      )
    }
    return children.map((ulp) => (
      <Fragment key={ulp.id}>
        <tr className="sla-tree-child">
          <td>
            {currentNameOf(ulp)}
            <div className="sla-table-sub">ID tetap: {ulp.id}</div>
          </td>
          <td>{ulp.type}</td>
          <td>{currentNameOf(up3)}</td>
          <td>{renderStatus(ulp)}</td>
          <td>{'\u2014'}</td>
          <td>
            <div className="sla-master-actions">
              <button type="button" className="sla-btn" onClick={() => startEdit(ulp)}>
                Edit Nama
              </button>
              <button type="button" className="sla-btn" onClick={() => toggleStatus(ulp)}>
                {ulp.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}
              </button>
              <button type="button" className="sla-btn" onClick={() => startHistory(ulp)}>
                Riwayat
              </button>
              <button type="button" className="sla-btn" onClick={() => requestDelete(ulp)}>
                Hapus
              </button>
            </div>
          </td>
        </tr>
        {renderEditRow(ulp)}
        {renderHistoryRow(ulp)}
        {renderBlockedRow(ulp.id)}
      </Fragment>
    ))
  }

  return (
    <section className="sla-settings">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Master Organisasi</h2>
        <span className="sla-status-badge sla-status-draft">Prototype</span>
      </div>
      <p className="sla-flat-note">
        Hierarki kontrak {contractScope.contractName}: UP3 {'\u2192'} ULP. ID unit
        bersifat tetap (stable) dan seluruh relasi memakai unitId/up3Id, bukan
        nama. Nama mengikuti histori periode agar laporan lama tetap ter-resolve.
        Own Status adalah status milik unit; Effective Status mengikuti parent
        tanpa menimpa own status. Unit yang sudah direferensikan data lain tidak
        dapat dihapus permanen. Perubahan hanya disimpan di state lokal
        (prototype).
      </p>

      <div className="sla-preview-scroll">
        <table className="sla-preview-table">
          <thead>
            <tr>
              <th>Nama Unit</th>
              <th>Tipe</th>
              <th>Parent</th>
              <th>Status</th>
              <th>Jumlah ULP</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {up3Units.map((up3) => {
              const childCount = units.filter(
                (unit) => unit.type === 'ULP' && unit.parentUnitId === up3.id,
              ).length
              return (
                <Fragment key={up3.id}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        className="sla-tree-toggle"
                        onClick={() => toggleExpand(up3.id)}
                        aria-expanded={expanded.has(up3.id)}
                      >
                        {expanded.has(up3.id) ? '\u25be' : '\u25b8'}
                      </button>
                      {currentNameOf(up3)}
                      <div className="sla-table-sub">ID tetap: {up3.id}</div>
                    </td>
                    <td>{up3.type}</td>
                    <td>{'\u2014'}</td>
                    <td>{renderStatus(up3)}</td>
                    <td>{childCount}</td>
                    <td>
                      <div className="sla-master-actions">
                        <button type="button" className="sla-btn sla-btn-primary" onClick={() => startAddUlp(up3)}>
                          Tambah ULP
                        </button>
                        <button type="button" className="sla-btn" onClick={() => startEdit(up3)}>
                          Edit Nama
                        </button>
                        <button type="button" className="sla-btn" onClick={() => toggleStatus(up3)}>
                          {up3.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                        <button type="button" className="sla-btn" onClick={() => startHistory(up3)}>
                          Riwayat
                        </button>
                        <button type="button" className="sla-btn" onClick={() => requestDelete(up3)}>
                          Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                  {addingUlpFor === up3.id && (
                    <tr className="sla-edit-row">
                      <td colSpan={6}>
                        <div className="sla-sign-group-head">
                          <div className="sla-context-field">
                            <span className="sla-context-label">Nama ULP baru</span>
                            <input
                              className={inputClass}
                              value={form.name}
                              onChange={(event) =>
                                setForm((prev) => ({ ...prev, name: event.target.value }))
                              }
                            />
                          </div>
                          <div className="sla-master-actions">
                            <button
                              type="button"
                              className="sla-btn sla-btn-primary"
                              onClick={() => submitAddUlp(up3.id)}
                            >
                              Simpan ULP
                            </button>
                            <button type="button" className="sla-btn" onClick={resetForms}>
                              Batal
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {renderEditRow(up3)}
                  {renderHistoryRow(up3)}
                  {renderBlockedRow(up3.id)}
                  {renderUlpRow(up3)}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}