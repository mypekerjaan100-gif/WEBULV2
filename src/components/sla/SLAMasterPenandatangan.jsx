import { useState } from 'react'
import { currentNameOf } from '../../data/organisasiPelayananTeknik.js'

const pad = (value) => String(value).padStart(2, '0')

const formatDateKey = (key) => {
  if (!key) return '\u2013'
  const [year, month, day] = key.split('-')
  return `${pad(day)}-${pad(month)}-${year}`
}

const inputClass = 'sla-input sla-input-text'

export default function SLAMasterPenandatangan({
  contractScope,
  up3Id,
  units,
  signatureGroups,
  onSignatureGroupsChange,
}) {
  const up3Unit = units.find((unit) => unit.type === 'UP3' && unit.id === up3Id)
  const ulpUnits = units.filter(
    (unit) => unit.type === 'ULP' && unit.parentUnitId === up3Id,
  )
  const scopedGroups = signatureGroups.filter(
    (group) =>
      group.contractId === contractScope.contractId &&
      (group.up3Id == null || group.up3Id === up3Id),
  )
  const inScope = (groupId) =>
    scopedGroups.some((group) => group.id === groupId)
  const [addingGroup, setAddingGroup] = useState(false)
  const [newGroup, setNewGroup] = useState({
    title: '',
    institution: '',
    documentScope: 'sla-ulp',
    unitId: ulpUnits[0]?.id ?? '',
    status: 'Aktif',
    order: scopedGroups.length + 1,
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
  })
  const [signatoryGroupId, setSignatoryGroupId] = useState(null)
  const [newSignatory, setNewSignatory] = useState({
    name: '',
    position: '',
    order: 1,
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    status: 'Aktif',
  })

  const updateGroup = (groupId, patch) => {
    if (!inScope(groupId)) return
    onSignatureGroupsChange(
      signatureGroups.map((group) =>
        group.id === groupId ? { ...group, ...patch } : group,
      ),
    )
  }

  const updateSignatory = (groupId, signatoryId, patch) => {
    if (!inScope(groupId)) return
    onSignatureGroupsChange(
      signatureGroups.map((group) =>
        group.id !== groupId
          ? group
          : {
              ...group,
              signatories: group.signatories.map((signatory) =>
                signatory.id === signatoryId
                  ? { ...signatory, ...patch }
                  : signatory,
              ),
            },
      ),
    )
  }

  const handleAddGroup = () => {
    const isUlpScope = newGroup.documentScope === 'sla-ulp'
    if (!newGroup.title.trim() || !newGroup.institution.trim()) return
    if (isUlpScope && !newGroup.unitId) return
    onSignatureGroupsChange([
      ...signatureGroups,
      {
        id: `g-${Date.now()}`,
        contractId: contractScope.contractId,
        up3Id,
        documentScope: newGroup.documentScope,
        unitId: isUlpScope ? newGroup.unitId : null,
        title: newGroup.title.trim(),
        institution: newGroup.institution.trim(),
        status: newGroup.status,
        order: Number(newGroup.order) || scopedGroups.length + 1,
        periodStart: newGroup.periodStart,
        periodEnd: newGroup.periodEnd,
        signatories: [],
      },
    ])
    setAddingGroup(false)
    setNewGroup({
      title: '',
      institution: '',
      documentScope: 'sla-ulp',
      unitId: ulpUnits[0]?.id ?? '',
      status: 'Aktif',
      order: scopedGroups.length + 2,
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
    })
  }

  const handleAddSignatory = () => {
    if (!newSignatory.name.trim() || !newSignatory.position.trim()) return
    if (!inScope(signatoryGroupId)) return
    updateGroup(signatoryGroupId, {
      signatories: [
        ...(scopedGroups.find((group) => group.id === signatoryGroupId)
          ?.signatories ?? []),
        {
          id: `s-${Date.now()}`,
          name: newSignatory.name.trim(),
          position: newSignatory.position.trim(),
          order: Number(newSignatory.order) || 1,
          periodStart: newSignatory.periodStart,
          periodEnd: newSignatory.periodEnd,
          status: newSignatory.status,
        },
      ],
    })
    setSignatoryGroupId(null)
    setNewSignatory({
      name: '',
      position: '',
      order: 1,
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      status: 'Aktif',
    })
  }

  const unitLabel = (unitId) => {
    const unit = units.find((item) => item.id === unitId)
    return unit ? currentNameOf(unit) : unitId
  }

  return (
    <section className="sla-signatories">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Master Penandatangan</h2>
        <button
          type="button"
          className="sla-btn sla-btn-primary"
          onClick={() => setAddingGroup((open) => !open)}
        >
          {addingGroup ? 'Batal' : 'Tambah Grup'}
        </button>
        <span className="sla-status-badge sla-status-draft">Prototype</span>
      </div>
      <p className="sla-flat-note">
        Master penandatangan kontrak {contractScope.contractName} {'\u2014'}{' '}
        {contractScope.region}. Grup dikaitkan ke kontrak + UP3 + scope dokumen
        (SLA UP3 / SLA ULP) + unit dari Master Organisasi. Export PDF dan Excel
        memilih grup serta pejabat yang berlaku sesuai periode laporan. Perubahan
        pada modul ini hanya disimpan di state lokal (prototype).
      </p>

      {addingGroup && (
        <div className="sla-sign-group">
          <div className="sla-sign-group-head">
            <div className="sla-context-field">
              <span className="sla-context-label">Judul Grup</span>
              <input
                className={inputClass}
                value={newGroup.title}
                placeholder="cth: Pihak Pertama / Saksi"
                onChange={(event) =>
                  setNewGroup((prev) => ({ ...prev, title: event.target.value }))
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Instansi</span>
              <input
                className={inputClass}
                value={newGroup.institution}
                placeholder="cth: PT PLN (Persero) UP3 Singkawang"
                onChange={(event) =>
                  setNewGroup((prev) => ({ ...prev, institution: event.target.value }))
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Scope Dokumen</span>
              <select
                className="sla-context-select"
                value={newGroup.documentScope}
                onChange={(event) => {
                  const documentScope = event.target.value
                  setNewGroup((prev) => ({
                    ...prev,
                    documentScope,
                    unitId:
                      documentScope === 'sla-ulp'
                        ? prev.unitId || (ulpUnits[0]?.id ?? '')
                        : null,
                  }))
                }}
              >
                <option value="sla-up3">SLA UP3</option>
                <option value="sla-ulp">SLA ULP</option>
              </select>
            </div>
            {newGroup.documentScope === 'sla-ulp' && (
              <div className="sla-context-field">
                <span className="sla-context-label">Unit (dari Master Organisasi)</span>
                <select
                  className="sla-context-select"
                  value={newGroup.unitId}
                  onChange={(event) =>
                    setNewGroup((prev) => ({ ...prev, unitId: event.target.value }))
                  }
                >
                  {ulpUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {currentNameOf(unit)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="sla-context-field">
              <span className="sla-context-label">Urutan Grup</span>
              <input
                className={inputClass}
                type="number"
                value={newGroup.order}
                onChange={(event) =>
                  setNewGroup((prev) => ({ ...prev, order: event.target.value }))
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Status</span>
              <select
                className="sla-context-select"
                value={newGroup.status}
                onChange={(event) =>
                  setNewGroup((prev) => ({ ...prev, status: event.target.value }))
                }
              >
                <option value="Aktif">Aktif</option>
                <option value="Nonaktif">Nonaktif</option>
              </select>
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Berlaku Mulai</span>
              <input
                className={inputClass}
                value={newGroup.periodStart}
                placeholder="YYYY-MM-DD"
                onChange={(event) =>
                  setNewGroup((prev) => ({ ...prev, periodStart: event.target.value }))
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Berlaku Sampai</span>
              <input
                className={inputClass}
                value={newGroup.periodEnd}
                placeholder="YYYY-MM-DD"
                onChange={(event) =>
                  setNewGroup((prev) => ({ ...prev, periodEnd: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="sla-master-actions">
            <button type="button" className="sla-btn sla-btn-primary" onClick={handleAddGroup}>
              Simpan Grup
            </button>
          </div>
        </div>
      )}

      {scopedGroups.map((group) => (
        <div key={group.id} className="sla-sign-group">
          <div className="sla-sign-group-head">
            <div className="sla-context-field">
              <span className="sla-context-label">Judul Grup</span>
              <input
                className={inputClass}
                value={group.title}
                onChange={(event) => updateGroup(group.id, { title: event.target.value })}
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Instansi</span>
              <input
                className={inputClass}
                value={group.institution}
                onChange={(event) =>
                  updateGroup(group.id, { institution: event.target.value })
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Scope Dokumen</span>
              <select
                className="sla-context-select"
                value={group.documentScope}
                onChange={(event) => {
                  const documentScope = event.target.value
                  updateGroup(group.id, {
                    documentScope,
                    unitId:
                      documentScope === 'sla-ulp'
                        ? group.unitId || (ulpUnits[0]?.id ?? null)
                        : null,
                  })
                }}
              >
                <option value="sla-up3">SLA UP3</option>
                <option value="sla-ulp">SLA ULP</option>
              </select>
            </div>
            {group.documentScope === 'sla-ulp' ? (
              <div className="sla-context-field">
                <span className="sla-context-label">Unit (dari Master Organisasi)</span>
                <select
                  className="sla-context-select"
                  value={group.unitId ?? ''}
                  onChange={(event) =>
                    updateGroup(group.id, { unitId: event.target.value || null })
                  }
                >
                  {ulpUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {currentNameOf(unit)}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="sla-context-field">
                <span className="sla-context-label">Unit</span>
                <span className="sla-readonly">SLA UP3 {'\u2014'} {up3Unit ? currentNameOf(up3Unit) : ''}</span>
              </div>
            )}
            <div className="sla-context-field">
              <span className="sla-context-label">Urutan Grup</span>
              <input
                className={inputClass}
                type="number"
                value={group.order}
                onChange={(event) =>
                  updateGroup(group.id, { order: Number(event.target.value) })
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Status</span>
              <select
                className="sla-context-select"
                value={group.status ?? 'Aktif'}
                onChange={(event) => updateGroup(group.id, { status: event.target.value })}
              >
                <option value="Aktif">Aktif</option>
                <option value="Nonaktif">Nonaktif</option>
              </select>
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Berlaku Mulai</span>
              <input
                className={inputClass}
                value={group.periodStart ?? ''}
                placeholder="YYYY-MM-DD"
                onChange={(event) =>
                  updateGroup(group.id, { periodStart: event.target.value })
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Berlaku Sampai</span>
              <input
                className={inputClass}
                value={group.periodEnd ?? ''}
                placeholder="YYYY-MM-DD"
                onChange={(event) => updateGroup(group.id, { periodEnd: event.target.value })}
              />
            </div>
          </div>
          <div className="sla-preview-scroll">
            <table className="sla-preview-table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Jabatan</th>
                  <th>Urutan</th>
                  <th>Berlaku Mulai</th>
                  <th>Berlaku Sampai</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {group.signatories.map((signatory) => (
                  <tr key={signatory.id}>
                    <td>
                      <input
                        className={inputClass}
                        value={signatory.name}
                        onChange={(event) =>
                          updateSignatory(group.id, signatory.id, {
                            name: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className={inputClass}
                        value={signatory.position}
                        onChange={(event) =>
                          updateSignatory(group.id, signatory.id, {
                            position: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className={inputClass}
                        type="number"
                        value={signatory.order}
                        onChange={(event) =>
                          updateSignatory(group.id, signatory.id, {
                            order: Number(event.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className={inputClass}
                        value={signatory.periodStart}
                        placeholder="YYYY-MM-DD"
                        onChange={(event) =>
                          updateSignatory(group.id, signatory.id, {
                            periodStart: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className={inputClass}
                        value={signatory.periodEnd}
                        placeholder="YYYY-MM-DD"
                        onChange={(event) =>
                          updateSignatory(group.id, signatory.id, {
                            periodEnd: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <select
                        className="sla-context-select"
                        value={signatory.status}
                        onChange={(event) =>
                          updateSignatory(group.id, signatory.id, {
                            status: event.target.value,
                          })
                        }
                      >
                        <option value="Aktif">Aktif</option>
                        <option value="Nonaktif">Nonaktif</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sla-master-actions">
            <button
              type="button"
              className="sla-btn"
              onClick={() =>
                setSignatoryGroupId((current) =>
                  current === group.id ? null : group.id,
                )
              }
            >
              {signatoryGroupId === group.id ? 'Batal' : 'Tambah Pejabat'}
            </button>
            {signatoryGroupId === group.id && (
              <div className="sla-sign-group-head sla-sign-group-add-member">
                <div className="sla-context-field">
                  <span className="sla-context-label">Nama</span>
                  <input
                    className={inputClass}
                    value={newSignatory.name}
                    placeholder="Nama pejabat"
                    onChange={(event) =>
                      setNewSignatory((prev) => ({ ...prev, name: event.target.value }))
                    }
                  />
                </div>
                <div className="sla-context-field">
                  <span className="sla-context-label">Jabatan</span>
                  <input
                    className={inputClass}
                    value={newSignatory.position}
                    placeholder="Jabatan"
                    onChange={(event) =>
                      setNewSignatory((prev) => ({ ...prev, position: event.target.value }))
                    }
                  />
                </div>
                <div className="sla-context-field">
                  <span className="sla-context-label">Urutan</span>
                  <input
                    className={inputClass}
                    type="number"
                    value={newSignatory.order}
                    onChange={(event) =>
                      setNewSignatory((prev) => ({ ...prev, order: event.target.value }))
                    }
                  />
                </div>
                <div className="sla-context-field">
                  <span className="sla-context-label">Berlaku Mulai</span>
                  <input
                    className={inputClass}
                    value={newSignatory.periodStart}
                    placeholder="YYYY-MM-DD"
                    onChange={(event) =>
                      setNewSignatory((prev) => ({
                        ...prev,
                        periodStart: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="sla-context-field">
                  <span className="sla-context-label">Berlaku Sampai</span>
                  <input
                    className={inputClass}
                    value={newSignatory.periodEnd}
                    placeholder="YYYY-MM-DD"
                    onChange={(event) =>
                      setNewSignatory((prev) => ({
                        ...prev,
                        periodEnd: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="sla-context-field">
                  <span className="sla-context-label">Status</span>
                  <select
                    className="sla-context-select"
                    value={newSignatory.status}
                    onChange={(event) =>
                      setNewSignatory((prev) => ({ ...prev, status: event.target.value }))
                    }
                  >
                    <option value="Aktif">Aktif</option>
                    <option value="Nonaktif">Nonaktif</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="sla-btn sla-btn-primary"
                  onClick={handleAddSignatory}
                >
                  Simpan Pejabat
                </button>
              </div>
            )}
          </div>
          <p className="sla-flat-note">
            Grup: {group.title} {'\u2014'} {group.institution} {'\u2014'}{' '}
            {group.documentScope}
            {group.unitId ? ` (${unitLabel(group.unitId)})` : ''} {'\u2014'} {group.status}{' '}
            {formatDateKey(group.periodStart)} s/d {formatDateKey(group.periodEnd)}. Pejabat
            yang berstatus Aktif dan dalam periode laporan yang akan tampil di export.
          </p>
        </div>
      ))}
    </section>
  )
}