import { useEffect, useMemo, useState } from 'react'
import {
  archiveOpsTemplate,
  duplicateOpsTemplate,
  listOpsEquipment,
  listOpsMasters,
  listOpsTemplateItems,
  listOpsTemplates,
  publishOpsTemplate,
  saveOpsEquipment,
  saveOpsMaster,
  saveOpsTemplateDraft,
} from '../../data/opsEquipmentRepository.js'

const TABS = [
  { id: 'jenis', label: 'Jenis Kendaraan' },
  { id: 'penugasan', label: 'Penugasan Kendaraan' },
  { id: 'kategori', label: 'Kategori Peralatan' },
  { id: 'peralatan', label: 'Daftar Peralatan' },
  { id: 'template', label: 'Kebutuhan Peralatan' },
]

const KIND_OF_TAB = { jenis: 'vehicle_type', penugasan: 'assignment', kategori: 'category' }
const KIND_TITLE = { vehicle_type: 'Jenis Kendaraan', assignment: 'Penugasan Kendaraan', category: 'Kategori Peralatan' }

const STATUS_BADGE = { Draft: 'sla-status-draft', Aktif: 'sla-status-active', Diarsipkan: 'sla-status-archive' }

function emptyMasterForm() {
  return { id: null, code: '', name: '', description: '', isActive: true }
}

function MasterSection({ kind, title, rows, search, onSearch, canManage, busy, onSave, onToggle }) {
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(q))
  }, [rows, search])

  const startAdd = () => {
    setError('')
    setForm(emptyMasterForm())
  }
  const startEdit = (row) => {
    setError('')
    setForm({ id: row.id, code: row.code, name: row.name, description: row.description ?? '', isActive: row.isActive })
  }
  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      setError('Kode dan nama wajib diisi.')
      return
    }
    try {
      await onSave(kind, form)
      setForm(null)
      setError('')
    } catch (saveError) {
      setError(saveError.message || 'Data gagal disimpan.')
    }
  }

  return (
    <div>
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">{title}</h2>
        <input
          className="sla-input sla-input-text"
          style={{ maxWidth: 240 }}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Cari kode/nama"
        />
        {canManage && (
          <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={() => (form ? setForm(null) : startAdd())}>
            {form ? 'Batal' : 'Tambah'}
          </button>
        )}
      </div>
      {form && canManage && (
        <div className="sla-sign-group">
          <div className="sla-sign-group-head">
            <div className="sla-context-field">
              <span className="sla-context-label">Kode *</span>
              <input className="sla-input sla-input-text" value={form.code} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="cth: R2" />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Nama *</span>
              <input className="sla-input sla-input-text" value={form.name} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="cth: Roda 2" />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Keterangan</span>
              <input className="sla-input sla-input-text" value={form.description} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Status</span>
              <select className="sla-context-select" value={form.isActive ? 'Aktif' : 'Nonaktif'} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.value === 'Aktif' }))}>
                <option value="Aktif">Aktif</option>
                <option value="Nonaktif">Nonaktif</option>
              </select>
            </div>
            <div className="sla-master-actions">
              <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={submit}>
                {busy ? 'Menyimpan...' : form.id ? 'Simpan Perubahan' : 'Simpan'}
              </button>
            </div>
          </div>
          {error && <p className="sla-blocked-note">{error}</p>}
        </div>
      )}
      <div className="sla-preview-scroll">
        <table className="sla-preview-table">
          <thead>
            <tr>
              <th>Kode</th>
              <th>Nama</th>
              <th>Keterangan</th>
              <th>Status</th>
              {canManage && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {!filtered.length && (
              <tr><td colSpan={canManage ? 5 : 4}>Belum ada data.</td></tr>
            )}
            {filtered.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.code}</strong></td>
                <td>{row.name}</td>
                <td>{row.description || '—'}</td>
                <td>
                  <span className={`sla-status-badge ${row.isActive ? 'sla-status-active' : 'sla-status-archive'}`}>
                    {row.isActive ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                {canManage && (
                  <td>
                    <div className="sla-master-actions">
                      <button type="button" className="sla-btn" disabled={busy} onClick={() => startEdit(row)}>Edit</button>
                      <button type="button" className="sla-btn" disabled={busy} onClick={() => onToggle(kind, row)}>
                        {row.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function emptyEquipmentForm() {
  return { id: null, code: '', name: '', categoryId: '', unit: 'unit', specification: '', description: '', isActive: true }
}

function EquipmentSection({ rows, categories, search, onSearch, canManage, busy, onSave, onToggle }) {
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => `${row.code} ${row.name} ${categoryById.get(row.categoryId)?.name ?? ''}`.toLowerCase().includes(q))
  }, [rows, search, categoryById])

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      setError('Kode dan nama alat wajib diisi.')
      return
    }
    if (!form.categoryId) {
      setError('Kategori wajib dipilih.')
      return
    }
    try {
      await onSave(form)
      setForm(null)
      setError('')
    } catch (saveError) {
      setError(saveError.message || 'Peralatan gagal disimpan.')
    }
  }

  return (
    <div>
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Daftar Peralatan</h2>
        <input
          className="sla-input sla-input-text"
          style={{ maxWidth: 240 }}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Cari kode/nama/kategori"
        />
        {canManage && (
          <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={() => (form ? setForm(null) : (setError(''), setForm(emptyEquipmentForm())))}>
            {form ? 'Batal' : 'Tambah Alat'}
          </button>
        )}
      </div>
      {form && canManage && (
        <div className="sla-sign-group">
          <div className="sla-sign-group-head">
            <div className="sla-context-field">
              <span className="sla-context-label">Kode Alat *</span>
              <input className="sla-input sla-input-text" value={form.code} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="cth: ALT001" />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Nama Alat *</span>
              <input className="sla-input sla-input-text" value={form.name} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Kategori *</span>
              <select className="sla-context-select" value={form.categoryId} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, categoryId: event.target.value }))}>
                <option value="">Pilih kategori</option>
                {categories.filter((item) => item.isActive).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Satuan</span>
              <input className="sla-input sla-input-text" value={form.unit} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))} placeholder="unit/buah/set/pasang" />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Spesifikasi</span>
              <input className="sla-input sla-input-text" value={form.specification} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, specification: event.target.value }))} />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Keterangan</span>
              <input className="sla-input sla-input-text" value={form.description} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Status</span>
              <select className="sla-context-select" value={form.isActive ? 'Aktif' : 'Nonaktif'} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.value === 'Aktif' }))}>
                <option value="Aktif">Aktif</option>
                <option value="Nonaktif">Nonaktif</option>
              </select>
            </div>
            <div className="sla-master-actions">
              <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={submit}>
                {busy ? 'Menyimpan...' : form.id ? 'Simpan Perubahan' : 'Simpan Alat'}
              </button>
            </div>
          </div>
          {error && <p className="sla-blocked-note">{error}</p>}
        </div>
      )}
      <div className="sla-preview-scroll">
        <table className="sla-preview-table">
          <thead>
            <tr>
              <th>Kode</th>
              <th>Nama Alat</th>
              <th>Kategori</th>
              <th>Satuan</th>
              <th>Status</th>
              {canManage && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {!filtered.length && (
              <tr><td colSpan={canManage ? 6 : 5}>Belum ada data.</td></tr>
            )}
            {filtered.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.code}</strong></td>
                <td>{row.name}{row.specification && <div className="sla-table-sub">{row.specification}</div>}</td>
                <td>{categoryById.get(row.categoryId)?.name ?? '—'}</td>
                <td>{row.unit}</td>
                <td>
                  <span className={`sla-status-badge ${row.isActive ? 'sla-status-active' : 'sla-status-archive'}`}>
                    {row.isActive ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                {canManage && (
                  <td>
                    <div className="sla-master-actions">
                      <button type="button" className="sla-btn" disabled={busy} onClick={() => (setError(''), setForm({ id: row.id, code: row.code, name: row.name, categoryId: row.categoryId, unit: row.unit, specification: row.specification ?? '', description: row.description ?? '', isActive: row.isActive }))}>Edit</button>
                      <button type="button" className="sla-btn" disabled={busy} onClick={() => onToggle(row)}>
                        {row.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function emptyTemplateForm() {
  return {
    id: null, templateName: '', vehicleTypeId: '', assignmentId: '',
    vehicleVariant: '', effectiveFrom: '', description: '',
    rows: [{ key: `r${Date.now()}`, equipmentId: '', requiredQty: 1, note: '' }],
  }
}

function TemplateSection({ templates, templateItems, types, assignments, equipment, categories, search, onSearch, canManage, busy, onSaveDraft, onPublish, onArchive, onDuplicate, onExpand }) {
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('Semua')
  const typeById = useMemo(() => new Map(types.map((item) => [item.id, item])), [types])
  const assignmentById = useMemo(() => new Map(assignments.map((item) => [item.id, item])), [assignments])
  const equipmentById = useMemo(() => new Map(equipment.map((item) => [item.id, item])), [equipment])
  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return templates.filter((row) => {
      if (statusFilter !== 'Semua' && row.status !== statusFilter) return false
      if (!q) return true
      const hay = `${row.templateCode} ${row.templateName} ${typeById.get(row.vehicleTypeId)?.name ?? ''} ${assignmentById.get(row.assignmentId)?.name ?? ''} ${row.vehicleVariant}`.toLowerCase()
      return hay.includes(q)
    })
  }, [templates, search, statusFilter, typeById, assignmentById])

  const totalQty = (form?.rows ?? []).reduce((total, row) => total + (Number(row.requiredQty) || 0), 0)

  const submitDraft = async () => {
    if (!form.templateName.trim()) {
      setError('Nama template wajib diisi.')
      return
    }
    if (!form.vehicleTypeId || !form.assignmentId) {
      setError('Jenis kendaraan dan penugasan wajib dipilih.')
      return
    }
    const cleanRows = form.rows.filter((row) => row.equipmentId)
    if (!cleanRows.length) {
      setError('Tambahkan minimal satu alat dari katalog.')
      return
    }
    const seen = new Set()
    for (const row of cleanRows) {
      if (seen.has(row.equipmentId)) {
        setError('Alat tidak boleh muncul dua kali dalam satu template.')
        return
      }
      seen.add(row.equipmentId)
      if (!Number.isInteger(Number(row.requiredQty)) || Number(row.requiredQty) < 0) {
        setError(`Jumlah Kebutuhan "${equipmentById.get(row.equipmentId)?.name ?? ''}" harus bilangan bulat >= 0.`)
        return
      }
    }
    try {
      await onSaveDraft({
        id: form.id,
        templateName: form.templateName.trim(),
        vehicleTypeId: form.vehicleTypeId,
        assignmentId: form.assignmentId,
        vehicleVariant: form.vehicleVariant.trim(),
        effectiveFrom: form.effectiveFrom || null,
        description: form.description.trim(),
        items: cleanRows.map((row) => ({ equipmentId: row.equipmentId, requiredQty: Number(row.requiredQty), note: row.note.trim() })),
      })
      setForm(null)
      setError('')
    } catch (saveError) {
      setError(saveError.message || 'Template gagal disimpan.')
    }
  }

  const startEdit = async (template) => {
    setError('')
    const items = await onExpand(template.id)
    setForm({
      id: template.id,
      templateName: template.templateName,
      vehicleTypeId: template.vehicleTypeId,
      assignmentId: template.assignmentId,
      vehicleVariant: template.vehicleVariant ?? '',
      effectiveFrom: template.effectiveFrom ?? '',
      description: template.description ?? '',
      rows: items.map((item, index) => ({ key: `r${index}`, equipmentId: item.equipmentId, requiredQty: item.requiredQty, note: item.note ?? '' })),
    })
  }

  return (
    <div>
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Kebutuhan Peralatan</h2>
        <input
          className="sla-input sla-input-text"
          style={{ maxWidth: 240 }}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Cari template"
        />
        <select className="sla-context-select" style={{ maxWidth: 160 }} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="Semua">Semua status</option>
          <option value="Draft">Draft</option>
          <option value="Aktif">Aktif</option>
          <option value="Diarsipkan">Diarsipkan</option>
        </select>
        {canManage && (
          <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={() => (form ? setForm(null) : (setError(''), setForm(emptyTemplateForm())))}>
            {form ? 'Batal' : 'Buat Template'}
          </button>
        )}
      </div>
      {form && canManage && (
        <div className="sla-sign-group">
          <div className="sla-sign-group-head">
            <div className="sla-context-field">
              <span className="sla-context-label">Nama Template *</span>
              <input className="sla-input sla-input-text" value={form.templateName} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, templateName: event.target.value }))} placeholder="cth: Roda 2 — Koordinator" />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Jenis Kendaraan *</span>
              <select className="sla-context-select" value={form.vehicleTypeId} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, vehicleTypeId: event.target.value }))}>
                <option value="">Pilih jenis</option>
                {types.filter((item) => item.isActive).map((item) => (
                  <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
                ))}
              </select>
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Penugasan *</span>
              <select className="sla-context-select" value={form.assignmentId} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, assignmentId: event.target.value }))}>
                <option value="">Pilih penugasan</option>
                {assignments.filter((item) => item.isActive).map((item) => (
                  <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
                ))}
              </select>
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Varian/Model (opsional)</span>
              <input className="sla-input sla-input-text" value={form.vehicleVariant} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, vehicleVariant: event.target.value }))} placeholder="cth: Terios (kosongkan bila umum)" />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Berlaku Mulai</span>
              <input type="date" className="sla-context-select" value={form.effectiveFrom} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))} />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Deskripsi</span>
              <input className="sla-input sla-input-text" value={form.description} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
            </div>
          </div>
          <div className="sla-detail-tabs" style={{ margin: '12px 0 8px' }}>
            <strong>Daftar Alat (Jumlah Kebutuhan)</strong>
            <span className="sla-table-hint">Total kebutuhan: {totalQty}</span>
          </div>
          {form.rows.map((row, index) => (
            <div className="sla-sign-group-head" key={row.key}>
              <div className="sla-context-field">
                <span className="sla-context-label">Alat {index + 1} *</span>
                <select className="sla-context-select" value={row.equipmentId} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, rows: prev.rows.map((item) => (item.key === row.key ? { ...item, equipmentId: event.target.value } : item)) }))}>
                  <option value="">Pilih alat dari katalog</option>
                  {equipment.filter((item) => item.isActive).map((item) => (
                    <option key={item.id} value={item.id}>{item.code} — {item.name} ({categoryById.get(item.categoryId)?.name ?? ''})</option>
                  ))}
                </select>
              </div>
              <div className="sla-context-field" style={{ maxWidth: 140 }}>
                <span className="sla-context-label">Jumlah Kebutuhan *</span>
                <input
                  className="sla-input sla-input-text"
                  inputMode="numeric"
                  value={row.requiredQty}
                  disabled={busy}
                  onChange={(event) => setForm((prev) => ({ ...prev, rows: prev.rows.map((item) => (item.key === row.key ? { ...item, requiredQty: event.target.value } : item)) }))}
                />
              </div>
              <div className="sla-context-field">
                <span className="sla-context-label">Keterangan</span>
                <input className="sla-input sla-input-text" value={row.note} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, rows: prev.rows.map((item) => (item.key === row.key ? { ...item, note: event.target.value } : item)) }))} />
              </div>
              <div className="sla-master-actions">
                {form.rows.length > 1 && (
                  <button type="button" className="sla-btn" disabled={busy} onClick={() => setForm((prev) => ({ ...prev, rows: prev.rows.filter((item) => item.key !== row.key) }))}>Hapus</button>
                )}
              </div>
            </div>
          ))}
          <div className="sla-master-actions" style={{ marginTop: 8 }}>
            <button type="button" className="sla-btn" disabled={busy} onClick={() => setForm((prev) => ({ ...prev, rows: [...prev.rows, { key: `r${Date.now()}`, equipmentId: '', requiredQty: 1, note: '' }] }))}>+ Tambah Alat</button>
            <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={submitDraft}>
              {busy ? 'Menyimpan...' : 'Simpan Draft'}
            </button>
          </div>
          {error && <p className="sla-blocked-note">{error}</p>}
        </div>
      )}
      <div className="sla-preview-scroll">
        <table className="sla-preview-table">
          <thead>
            <tr>
              <th>Kode</th>
              <th>Template</th>
              <th>Jenis / Penugasan</th>
              <th>Versi</th>
              <th>Status</th>
              <th>Alat</th>
              {canManage && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {!filtered.length && (
              <tr><td colSpan={canManage ? 7 : 6}>Belum ada template.</td></tr>
            )}
            {filtered.map((template) => {
              const items = templateItems[template.id] ?? null
              return (
                <tr key={template.id}>
                  <td><strong>{template.templateCode}</strong></td>
                  <td>
                    {template.templateName}
                    <div className="sla-table-sub">
                      {template.vehicleVariant ? `Varian: ${template.vehicleVariant} · ` : ''}Berlaku: {template.effectiveFrom || '—'}
                    </div>
                    {items && (
                      <div className="sla-table-sub">
                        {items.map((item) => `${equipmentById.get(item.equipmentId)?.name ?? '?'} × ${item.requiredQty}`).join(' · ') || '—'}
                      </div>
                    )}
                  </td>
                  <td>{typeById.get(template.vehicleTypeId)?.name ?? '—'} / {assignmentById.get(template.assignmentId)?.name ?? '—'}</td>
                  <td>v{template.versionNumber}</td>
                  <td>
                    <span className={`sla-status-badge ${STATUS_BADGE[template.status] ?? 'sla-status-draft'}`}>
                      {template.status}
                    </span>
                  </td>
                  <td>{items ? items.length : '…'}</td>
                  {canManage && (
                    <td>
                      <div className="sla-master-actions">
                        <button type="button" className="sla-btn" disabled={busy} onClick={() => onExpand(template.id)}>Lihat</button>
                        {template.status === 'Draft' && (
                          <>
                            <button type="button" className="sla-btn" disabled={busy} onClick={() => startEdit(template)}>Edit</button>
                            <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={() => onPublish(template)}>Terbitkan</button>
                          </>
                        )}
                        {template.status !== 'Draft' && (
                          <button type="button" className="sla-btn" disabled={busy} onClick={() => onDuplicate(template)}>Duplikasi</button>
                        )}
                        {template.status === 'Aktif' && (
                          <button type="button" className="sla-btn" disabled={busy} onClick={() => onArchive(template)}>Arsipkan</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AlatKendaraanMaster({ contractUuid, up3Uuid, canManage }) {
  const [tab, setTab] = useState('jenis')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [types, setTypes] = useState([])
  const [assignments, setAssignments] = useState([])
  const [categories, setCategories] = useState([])
  const [equipment, setEquipment] = useState([])
  const [templates, setTemplates] = useState([])
  const [templateItems, setTemplateItems] = useState({})

  const scopeReady = Boolean(contractUuid && up3Uuid)

  const reload = async () => {
    if (!scopeReady) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const [typeRows, assignmentRows, categoryRows, equipmentRows, templateRows] = await Promise.all([
        listOpsMasters('vehicle_type', { contractId: contractUuid, up3Id: up3Uuid }),
        listOpsMasters('assignment', { contractId: contractUuid, up3Id: up3Uuid }),
        listOpsMasters('category', { contractId: contractUuid, up3Id: up3Uuid }),
        listOpsEquipment({ contractId: contractUuid, up3Id: up3Uuid }),
        listOpsTemplates({ contractId: contractUuid, up3Id: up3Uuid }),
      ])
      setTypes(typeRows)
      setAssignments(assignmentRows)
      setCategories(categoryRows)
      setEquipment(equipmentRows)
      setTemplates(templateRows)
      setTemplateItems({})
    } catch (error) {
      setLoadError(error.message || 'Master data gagal dimuat.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractUuid, up3Uuid])

  const mutate = async (work) => {
    setBusy(true)
    setNotice('')
    try {
      await work()
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const handleSaveMaster = (kind, form) => mutate(() => saveOpsMaster(kind, {
    id: form.id, contractId: contractUuid, up3Id: up3Uuid,
    code: form.code, name: form.name, description: form.description, isActive: form.isActive,
  }).then(() => setNotice('Master tersimpan.')))

  const handleToggleMaster = (kind, row) => mutate(() => saveOpsMaster(kind, {
    id: row.id, contractId: contractUuid, up3Id: up3Uuid,
    code: row.code, name: row.name, description: row.description ?? '', isActive: !row.isActive,
  }).then(() => setNotice(`"${row.name}" ${row.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`)))

  const handleSaveEquipment = (form) => mutate(() => saveOpsEquipment({
    id: form.id, contractId: contractUuid, up3Id: up3Uuid,
    code: form.code, name: form.name, categoryId: form.categoryId, unit: form.unit,
    specification: form.specification, description: form.description, isActive: form.isActive,
  }).then(() => setNotice('Peralatan tersimpan.')))

  const handleToggleEquipment = (row) => mutate(() => saveOpsEquipment({
    id: row.id, contractId: contractUuid, up3Id: up3Uuid,
    code: row.code, name: row.name, categoryId: row.categoryId, unit: row.unit,
    specification: row.specification ?? '', description: row.description ?? '', isActive: !row.isActive,
  }).then(() => setNotice(`"${row.name}" ${row.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`)))

  const handleExpandTemplate = async (templateId) => {
    if (templateItems[templateId]) return templateItems[templateId]
    const items = await listOpsTemplateItems(templateId, equipment)
    setTemplateItems((prev) => ({ ...prev, [templateId]: items }))
    return items
  }

  const handlePublish = async (template) => {
    if (!window.confirm(`Terbitkan "${template.templateName}" v${template.versionNumber} sebagai Aktif?`)) return
    await mutate(() => publishOpsTemplate(template.id).then(() => setNotice('Template diterbitkan.')))
  }

  const handleArchive = async (template) => {
    if (!window.confirm(`Arsipkan "${template.templateName}" v${template.versionNumber}? Template arsip tidak dipakai acuan baru.`)) return
    await mutate(() => archiveOpsTemplate(template.id).then(() => setNotice('Template diarsipkan.')))
  }

  const handleDuplicate = async (template) => {
    await mutate(() => duplicateOpsTemplate(template.id).then(() => setNotice('Draft versi baru dibuat dari template ini.')))
  }

  if (!scopeReady) {
    return (
      <section className="sla-settings">
        <h2 className="sla-settings-title">Master Data Alat & Kendaraan</h2>
        <p className="sla-blocked-note">Scope organisasi belum siap. Muat ulang halaman.</p>
      </section>
    )
  }

  return (
    <section className="sla-settings">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Master Data Alat & Kendaraan</h2>
      </div>
      <p className="sla-flat-note">
        Katalog dan template kebutuhan peralatan kendaraan operasional UP3 Singkawang
        (Sei Duri, Bengkayang, Pemangkat, Sambas, Sekura, Singkawang Kota).
        {!canManage && ' Akun ini hanya dapat melihat (read-only).'}
      </p>
      {loading ? (
        <p className="sla-table-hint">Memuat master data...</p>
      ) : loadError ? (
        <p className="sla-blocked-note">{loadError} <button type="button" className="sla-btn" onClick={reload}>Coba lagi</button></p>
      ) : (
        <>
          <div className="sla-detail-tabs">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`sla-detail-tab ${tab === item.id ? 'sla-detail-tab-active' : ''}`}
                onClick={() => { setTab(item.id); setSearch(''); setNotice('') }}
              >
                {item.label}
              </button>
            ))}
          </div>
          {notice && <p className="sla-export-note">{notice}</p>}
          {['jenis', 'penugasan', 'kategori'].includes(tab) && (
            <MasterSection
              kind={KIND_OF_TAB[tab]}
              title={KIND_TITLE[KIND_OF_TAB[tab]]}
              rows={tab === 'jenis' ? types : tab === 'penugasan' ? assignments : categories}
              search={search}
              onSearch={setSearch}
              canManage={canManage}
              busy={busy}
              onSave={handleSaveMaster}
              onToggle={handleToggleMaster}
            />
          )}
          {tab === 'peralatan' && (
            <EquipmentSection
              rows={equipment}
              categories={categories}
              search={search}
              onSearch={setSearch}
              canManage={canManage}
              busy={busy}
              onSave={handleSaveEquipment}
              onToggle={handleToggleEquipment}
            />
          )}
          {tab === 'template' && (
            <TemplateSection
              templates={templates}
              templateItems={templateItems}
              types={types}
              assignments={assignments}
              equipment={equipment}
              categories={categories}
              search={search}
              onSearch={setSearch}
              canManage={canManage}
              busy={busy}
              onSaveDraft={(payload) => mutate(() => saveOpsTemplateDraft({ contractId: contractUuid, up3Id: up3Uuid, ...payload }).then(() => setNotice('Draft template tersimpan.')))}
              onPublish={handlePublish}
              onArchive={handleArchive}
              onDuplicate={handleDuplicate}
              onExpand={handleExpandTemplate}
            />
          )}
        </>
      )}
    </section>
  )
}
