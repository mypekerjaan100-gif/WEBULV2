import { useState, useMemo } from 'react'
import { currentNameOf } from '../../data/organisasiPelayananTeknik.js'

const pad = (v) => String(v).padStart(2, '0')

const formatDateKey = (key) => {
  if (!key) return '\u2013'
  const [y, m, d] = key.split('-')
  return pad(d) + '-' + pad(m) + '-' + y
}

const inputClass = 'sla-input sla-input-text'

const EMPTY_SIG = {
  name: '', position: '', order: 1,
  periodStart: '2026-01-01', periodEnd: '2026-12-31', status: 'Aktif',
}

function createDraft(ulpUnits, scopedGroups) {
  return {
    title: '', institution: '', documentScope: 'sla-ulp',
    unitId: ulpUnits[0]?.id ?? '', status: 'Aktif',
    order: scopedGroups.length + 1,
    periodStart: '2026-01-01', periodEnd: '2026-12-31', signatories: [],
  }
}

function editDraft(group) {
  return {
    title: group.title, institution: group.institution,
    documentScope: group.documentScope, unitId: group.unitId ?? '',
    status: group.status ?? 'Aktif', order: group.order ?? 1,
    periodStart: group.periodStart ?? '2026-01-01', periodEnd: group.periodEnd ?? '2026-12-31',
    signatories: (group.signatories ?? []).map((s) => ({ ...s })),
  }
}

function statusBadgeClass(status) {
  return status === 'Aktif' ? 'sp-badge sp-badge-aktif' : 'sp-badge sp-badge-nonaktif'
}

export default function SLAMasterPenandatangan({
  contractScope, up3Id, units, signatureGroups, onSignatureGroupsChange,
}) {
  const ulpUnits = units.filter((u) => u.type === 'ULP' && u.parentUnitId === up3Id)
  const scopedGroups = useMemo(
    () => signatureGroups.filter(
      (g) => g.contractId === contractScope.contractId && (g.up3Id == null || g.up3Id === up3Id),
    ),
    [signatureGroups, contractScope.contractId, up3Id],
  )

  const [activeTab, setActiveTab] = useState('sla-up3')
  const [selectedUlpId, setSelectedUlpId] = useState(ulpUnits[0]?.id ?? '')

  const filteredGroups = useMemo(() => {
    const base = activeTab === 'sla-up3'
      ? scopedGroups.filter((g) => g.documentScope === 'sla-up3')
      : scopedGroups.filter(
          (g) => g.documentScope === 'sla-ulp' && (selectedUlpId ? g.unitId === selectedUlpId : true),
        )
    return [...base].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }, [scopedGroups, activeTab, selectedUlpId])

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [editingGroupId, setEditingGroupId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [addSigOpen, setAddSigOpen] = useState(false)
  const [newSigDraft, setNewSigDraft] = useState({ ...EMPTY_SIG })
  const [kebabMenuId, setKebabMenuId] = useState(null)

  const inScope = (gId) => scopedGroups.some((g) => g.id === gId)
  const unitLabel = (uId) => {
    const u = units.find((i) => i.id === uId)
    return u ? currentNameOf(u) : uId
  }
  const sortedSigs = (g) =>
    [...(g.signatories ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const draftSortedSigs = (d) =>
    [...(d?.signatories ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))


  const openCreate = () => {
    setModalMode('create'); setEditingGroupId(null)
    setDraft(createDraft(ulpUnits, scopedGroups))
    setAddSigOpen(false); setNewSigDraft({ ...EMPTY_SIG }); setModalOpen(true)
  }

  const openEdit = (group, openAdd = false) => {
    setModalMode('edit'); setEditingGroupId(group.id); setDraft(editDraft(group))
    setAddSigOpen(openAdd); setNewSigDraft({ ...EMPTY_SIG }); setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false); setDraft(null); setEditingGroupId(null)
    setAddSigOpen(false); setNewSigDraft({ ...EMPTY_SIG }); setKebabMenuId(null)
  }

  const updateDraft = (patch) => setDraft((p) => (p ? { ...p, ...patch } : p))
  const updateDraftSig = (sigId, patch) => setDraft((p) => {
    if (!p) return p
    return { ...p, signatories: p.signatories.map((s) => s.id === sigId ? { ...s, ...patch } : s) }
  })
  const moveDraftSig = (idx, dir) => setDraft((p) => {
    if (!p) return p
    const list = [...p.signatories]; const t = idx + dir
    if (t < 0 || t >= list.length) return p
    const a = { ...list[idx] }; const b = { ...list[t] }
    const tmp = a.order; a.order = b.order; b.order = tmp
    list[idx] = b; list[t] = a
    return { ...p, signatories: list }
  })

  const addDraftSig = () => {
    if (!newSigDraft.name.trim() || !newSigDraft.position.trim()) return
    setDraft((p) => {
      if (!p) return p
      const mx = p.signatories.reduce((m, s) => Math.max(m, s.order ?? 0), 0)
      return { ...p, signatories: [...p.signatories, { ...newSigDraft, id: 's-' + Date.now(), order: mx + 1 }] }
    })
    setAddSigOpen(false); setNewSigDraft({ ...EMPTY_SIG })
  }

  const removeDraftSig = (sigId) => setDraft((p) => {
    if (!p) return p
    return { ...p, signatories: p.signatories.filter((s) => s.id !== sigId) }
  })

  const handleSave = () => {
    if (!draft) return
    if (!draft.title.trim() || !draft.institution.trim()) return
    if (draft.documentScope === 'sla-ulp' && !draft.unitId) return

    if (modalMode === 'create') {
      onSignatureGroupsChange([
        ...signatureGroups,
        {
          id: 'g-' + Date.now(), contractId: contractScope.contractId, up3Id,
          documentScope: draft.documentScope,
          unitId: draft.documentScope === 'sla-ulp' ? draft.unitId : null,
          title: draft.title.trim(), institution: draft.institution.trim(),
          status: draft.status, order: Number(draft.order) || scopedGroups.length + 1,
          periodStart: draft.periodStart, periodEnd: draft.periodEnd,
          signatories: (draft.signatories ?? []).map((s) => ({ ...s })),
        },
      ])
    } else {
      if (!inScope(editingGroupId)) return
      onSignatureGroupsChange(
        signatureGroups.map((g) =>
          g.id === editingGroupId
            ? {
                ...g, title: draft.title.trim(), institution: draft.institution.trim(),
                documentScope: draft.documentScope,
                unitId: draft.documentScope === 'sla-ulp' ? draft.unitId : null,
                order: Number(draft.order) || g.order, status: draft.status,
                periodStart: draft.periodStart, periodEnd: draft.periodEnd,
                signatories: (draft.signatories ?? []).map((s) => ({ ...s })),
              }
            : g,
        ),
      )
    }
    closeModal()
  }

  const handleToggleStatus = (group) => {
    if (!inScope(group.id)) return
    onSignatureGroupsChange(
      signatureGroups.map((g) =>
        g.id === group.id
          ? { ...g, status: g.status === 'Aktif' ? 'Nonaktif' : 'Aktif' }
          : g,
      ),
    )
    setKebabMenuId(null)
  }

  const scopeLabel = (g) =>
    g.documentScope === 'sla-up3' ? 'SLA UP3' : 'SLA ULP \u2014 ' + unitLabel(g.unitId)


  return (
    <section className="sla-signatories">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Master Penandatangan</h2>
        <div className="sp-toolbar-right">
          <div className="sp-tabs">
            <button
              type="button"
              className={'sp-tab' + (activeTab === 'sla-up3' ? ' sp-tab-active' : '')}
              onClick={() => setActiveTab('sla-up3')}
            >
              SLA UP3
            </button>
            <button
              type="button"
              className={'sp-tab' + (activeTab === 'sla-ulp' ? ' sp-tab-active' : '')}
              onClick={() => setActiveTab('sla-ulp')}
            >
              SLA ULP
            </button>
          </div>
          {activeTab === 'sla-ulp' && (
            <select
              className="sla-context-select"
              value={selectedUlpId}
              onChange={(e) => setSelectedUlpId(e.target.value)}
            >
              {ulpUnits.length === 0 && <option value="">Tidak ada ULP</option>}
              {ulpUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>{currentNameOf(unit)}</option>
              ))}
            </select>
          )}
          <button type="button" className="sla-btn sla-btn-primary" onClick={openCreate}>
            + Tambah Grup
          </button>
        </div>
      </div>

      <p className="sla-flat-note">
        Master penandatangan kontrak {contractScope.contractName} {'\u2014'}{' '}
        {contractScope.region}. Grup dikaitkan ke kontrak + UP3 + scope dokumen
        (SLA UP3 / SLA ULP) + unit dari Master Organisasi. Export PDF dan Excel
        memilih grup serta pejabat yang berlaku sesuai periode laporan. Perubahan
        pada modul ini hanya disimpan di state lokal (prototype).
      </p>

      {filteredGroups.length === 0 ? (
        <div className="sp-empty-state">
          Belum ada grup penandatangan untuk scope ini.
        </div>
      ) : (
        <div className="sp-card-grid">
          {filteredGroups.map((group) => (
            <div key={group.id} className="sp-card">
              <div className="sp-card-header">
                <div className="sp-card-title-row">
                  <h3 className="sp-card-title">{group.title}</h3>
                  <span className={statusBadgeClass(group.status ?? 'Aktif')}>
                    {group.status ?? 'Aktif'}
                  </span>
                </div>
                <p className="sp-card-instansi">{group.institution}</p>
                <p className="sp-card-meta">
                  {scopeLabel(group)}
                  {' \u00b7 '}{formatDateKey(group.periodStart)} s/d {formatDateKey(group.periodEnd)}
                </p>
              </div>
              <div className="sp-card-body">
                {sortedSigs(group).length === 0 ? (
                  <p className="sp-card-empty-sig">Belum ada pejabat.</p>
                ) : (
                  <ol className="sp-sig-list">
                    {sortedSigs(group).map((sig) => (
                      <li key={sig.id} className="sp-sig-item">
                        <span className="sp-sig-name">{sig.name}</span>
                        <span className="sp-sig-position">{sig.position}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div className="sp-card-footer">
                <button type="button" className="sla-btn" onClick={() => openEdit(group)}>
                  Edit
                </button>
                <button type="button" className="sla-btn" onClick={() => openEdit(group, true)}>
                  + Pejabat
                </button>
                <div className="sp-kebab-wrap">
                  <button
                    type="button"
                    className="sla-btn sp-kebab-trigger"
                    onClick={() => setKebabMenuId((prev) => (prev === group.id ? null : group.id))}
                  >
                    {'\u22ee'}
                  </button>
                  {kebabMenuId === group.id && (
                    <div className="sp-kebab-menu">
                      <button
                        type="button"
                        className="sp-kebab-item"
                        onClick={() => handleToggleStatus(group)}
                      >
                        {group.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}


      {modalOpen && draft && (
        <div className="sla-modal-overlay" onClick={closeModal}>
          <div className="sla-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sla-modal-header">
              <h3 className="sla-modal-title">
                {modalMode === 'create' ? 'Tambah Grup Penandatangan' : 'Edit Grup Penandatangan'}
              </h3>
              <button type="button" className="sla-modal-close" onClick={closeModal}>{'\u00d7'}</button>
            </div>
            <div className="sp-modal-body">
              <div className="sp-modal-fields">
                <div className="sla-context-field">
                  <span className="sla-context-label">Judul Grup</span>
                  <input
                    className={inputClass} style={{ width: '100%' }}
                    value={draft.title} placeholder="cth: Pihak Pertama / Saksi"
                    onChange={(e) => updateDraft({ title: e.target.value })}
                  />
                </div>
                <div className="sla-context-field">
                  <span className="sla-context-label">Instansi</span>
                  <input
                    className={inputClass} style={{ width: '100%' }}
                    value={draft.institution} placeholder="cth: PT PLN (Persero) UP3 Singkawang"
                    onChange={(e) => updateDraft({ institution: e.target.value })}
                  />
                </div>
                <div className="sp-modal-row">
                  <div className="sla-context-field">
                    <span className="sla-context-label">Scope Dokumen</span>
                    <select
                      className="sla-context-select" value={draft.documentScope}
                      onChange={(e) => {
                        const ds = e.target.value
                        updateDraft({ documentScope: ds, unitId: ds === 'sla-ulp' ? (draft.unitId || (ulpUnits[0]?.id ?? '')) : null })
                      }}
                    >
                      <option value="sla-up3">SLA UP3</option>
                      <option value="sla-ulp">SLA ULP</option>
                    </select>
                  </div>
                  {draft.documentScope === 'sla-ulp' && (
                    <div className="sla-context-field">
                      <span className="sla-context-label">Unit</span>
                      <select
                        className="sla-context-select" value={draft.unitId}
                        onChange={(e) => updateDraft({ unitId: e.target.value })}
                      >
                        {ulpUnits.map((unit) => (
                          <option key={unit.id} value={unit.id}>{currentNameOf(unit)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="sp-modal-row">
                  <div className="sla-context-field">
                    <span className="sla-context-label">Urutan Grup</span>
                    <input
                      className={inputClass} type="number" value={draft.order}
                      onChange={(e) => updateDraft({ order: e.target.value })}
                    />
                  </div>
                  <div className="sla-context-field">
                    <span className="sla-context-label">Status</span>
                    <select
                      className="sla-context-select" value={draft.status}
                      onChange={(e) => updateDraft({ status: e.target.value })}
                    >
                      <option value="Aktif">Aktif</option>
                      <option value="Nonaktif">Nonaktif</option>
                    </select>
                  </div>
                </div>
                <div className="sp-modal-row">
                  <div className="sla-context-field">
                    <span className="sla-context-label">Berlaku Mulai</span>
                    <input
                      className={inputClass} value={draft.periodStart} placeholder="YYYY-MM-DD"
                      onChange={(e) => updateDraft({ periodStart: e.target.value })}
                    />
                  </div>
                  <div className="sla-context-field">
                    <span className="sla-context-label">Berlaku Sampai</span>
                    <input
                      className={inputClass} value={draft.periodEnd} placeholder="YYYY-MM-DD"
                      onChange={(e) => updateDraft({ periodEnd: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="sp-modal-sigs">
                <div className="sp-modal-sigs-head">
                  <h4 className="sp-modal-sigs-title">Pejabat Penandatangan</h4>
                  <button
                    type="button" className="sla-btn"
                    onClick={() => setAddSigOpen((v) => !v)}
                  >
                    {addSigOpen ? 'Batal' : '+ Tambah Pejabat'}
                  </button>
                </div>

                {addSigOpen && (
                  <div className="sp-sig-add-form">
                    <div className="sp-modal-row">
                      <div className="sla-context-field" style={{ flex: 2 }}>
                        <span className="sla-context-label">Nama</span>
                        <input
                          className={inputClass} style={{ width: '100%' }}
                          value={newSigDraft.name} placeholder="Nama pejabat"
                          onChange={(e) => setNewSigDraft((p) => ({ ...p, name: e.target.value }))}
                        />
                      </div>
                      <div className="sla-context-field" style={{ flex: 2 }}>
                        <span className="sla-context-label">Jabatan</span>
                        <input
                          className={inputClass} style={{ width: '100%' }}
                          value={newSigDraft.position} placeholder="Jabatan"
                          onChange={(e) => setNewSigDraft((p) => ({ ...p, position: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="sp-modal-row">
                      <div className="sla-context-field">
                        <span className="sla-context-label">Berlaku Mulai</span>
                        <input
                          className={inputClass} value={newSigDraft.periodStart} placeholder="YYYY-MM-DD"
                          onChange={(e) => setNewSigDraft((p) => ({ ...p, periodStart: e.target.value }))}
                        />
                      </div>
                      <div className="sla-context-field">
                        <span className="sla-context-label">Berlaku Sampai</span>
                        <input
                          className={inputClass} value={newSigDraft.periodEnd} placeholder="YYYY-MM-DD"
                          onChange={(e) => setNewSigDraft((p) => ({ ...p, periodEnd: e.target.value }))}
                        />
                      </div>
                      <div className="sla-context-field">
                        <span className="sla-context-label">Status</span>
                        <select
                          className="sla-context-select" value={newSigDraft.status}
                          onChange={(e) => setNewSigDraft((p) => ({ ...p, status: e.target.value }))}
                        >
                          <option value="Aktif">Aktif</option>
                          <option value="Nonaktif">Nonaktif</option>
                        </select>
                      </div>
                      <button
                        type="button" className="sla-btn sla-btn-primary"
                        style={{ alignSelf: 'flex-end' }}
                        onClick={addDraftSig}
                      >
                        Simpan
                      </button>
                    </div>
                  </div>
                )}

                {draftSortedSigs(draft).length === 0 ? (
                  <p className="sp-card-empty-sig">Belum ada pejabat.</p>
                ) : (
                  <div className="sp-sig-editor-list">
                    {draftSortedSigs(draft).map((sig, idx) => (
                      <div key={sig.id} className="sp-sig-editor-row">
                        <div className="sp-sig-editor-order">
                          <button
                            type="button" className="sp-sig-arrow"
                            disabled={idx === 0}
                            onClick={() => moveDraftSig(idx, -1)}
                          >{'\u2191'}</button>
                          <span className="sp-sig-order-num">{sig.order}</span>
                          <button
                            type="button" className="sp-sig-arrow"
                            disabled={idx === draftSortedSigs(draft).length - 1}
                            onClick={() => moveDraftSig(idx, 1)}
                          >{'\u2193'}</button>
                        </div>
                        <div className="sp-sig-editor-fields">
                          <input
                            className={inputClass}
                            value={sig.name} placeholder="Nama"
                            onChange={(e) => updateDraftSig(sig.id, { name: e.target.value })}
                          />
                          <input
                            className={inputClass}
                            value={sig.position} placeholder="Jabatan"
                            onChange={(e) => updateDraftSig(sig.id, { position: e.target.value })}
                          />
                          <input
                            className={inputClass}
                            value={sig.periodStart} placeholder="Mulai"
                            onChange={(e) => updateDraftSig(sig.id, { periodStart: e.target.value })}
                          />
                          <input
                            className={inputClass}
                            value={sig.periodEnd} placeholder="Sampai"
                            onChange={(e) => updateDraftSig(sig.id, { periodEnd: e.target.value })}
                          />
                          <select
                            className="sla-context-select"
                            value={sig.status}
                            onChange={(e) => updateDraftSig(sig.id, { status: e.target.value })}
                          >
                            <option value="Aktif">Aktif</option>
                            <option value="Nonaktif">Nonaktif</option>
                          </select>
                        </div>
                        <button
                          type="button" className="sla-btn sla-btn-danger"
                          onClick={() => removeDraftSig(sig.id)}
                        >
                          Hapus
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="sla-modal-actions">
              <button type="button" className="sla-btn" onClick={closeModal}>Batal</button>
              <button type="button" className="sla-btn sla-btn-primary" onClick={handleSave}>Simpan</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
