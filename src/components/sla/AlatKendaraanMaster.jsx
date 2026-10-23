import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
const ALL_CATEGORIES = '__all__'
const UNCATEGORIZED = '__uncategorized__'
const LIST_PAGE_SIZE = 12

function ListPagination({ total, page, onChange, itemLabel = 'data' }) {
  const pageCount = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE))
  if (total <= LIST_PAGE_SIZE) return null
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * LIST_PAGE_SIZE + 1
  const end = Math.min(total, (safePage + 1) * LIST_PAGE_SIZE)
  return (
    <div className="sla-pagination">
      <span className="sla-table-hint">Menampilkan {start}–{end} dari {total} {itemLabel}</span>
      <div className="sla-pagination-controls">
        <button type="button" className="sla-btn" disabled={safePage === 0} onClick={() => onChange(safePage - 1)}>
          Sebelumnya
        </button>
        <span className="sla-table-hint">Halaman {safePage + 1} dari {pageCount}</span>
        <button type="button" className="sla-btn" disabled={safePage >= pageCount - 1} onClick={() => onChange(safePage + 1)}>
          Berikutnya
        </button>
      </div>
    </div>
  )
}

function emptyMasterForm() {
  return { id: null, code: '', name: '', description: '', isActive: true }
}

function MasterSection({ kind, title, rows, search, onSearch, canManage, busy, onSave, onToggle, onDirtyChange }) {
  const [form, setForm] = useState(null)
  const [baseline, setBaseline] = useState('')
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(q))
  }, [rows, search])
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / LIST_PAGE_SIZE) - 1))
  const pageRows = filtered.slice(safePage * LIST_PAGE_SIZE, (safePage + 1) * LIST_PAGE_SIZE)
  const emptyMessage = rows.length ? 'Tidak ada data yang cocok dengan pencarian.' : 'Belum ada data.'
  const dirty = Boolean(form && baseline && JSON.stringify(form) !== baseline)

  useEffect(() => {
    setPage(0)
  }, [search])

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const resetForm = () => {
    setForm(null)
    setBaseline('')
    setError('')
  }

  const closeForm = () => {
    if (dirty && !window.confirm('Perubahan data belum disimpan. Tutup form?')) return
    resetForm()
  }

  const startAdd = () => {
    const next = emptyMasterForm()
    setError('')
    setForm(next)
    setBaseline(JSON.stringify(next))
  }
  const startEdit = (row) => {
    const next = { id: row.id, code: row.code, name: row.name, description: row.description ?? '', isActive: row.isActive }
    setError('')
    setForm(next)
    setBaseline(JSON.stringify(next))
  }
  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      setError('Kode dan nama wajib diisi.')
      return
    }
    try {
      await onSave(kind, form)
      resetForm()
    } catch (saveError) {
      setError(saveError.message || 'Data gagal disimpan.')
    }
  }

  return (
    <div className="alkes-section">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">{title}</h2>
        <div className="alkes-toolbar-actions">
          <input
            className="sla-input sla-input-text alkes-search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Cari kode/nama"
          />
          {canManage && (
            <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={() => (form ? closeForm() : startAdd())}>
              {form ? 'Batal' : 'Tambah'}
            </button>
          )}
        </div>
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
        <table className="sla-preview-table alkes-table">
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
              <tr><td colSpan={canManage ? 5 : 4}>{emptyMessage}</td></tr>
            )}
            {pageRows.map((row) => (
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
      <ListPagination total={filtered.length} page={safePage} onChange={setPage} />
    </div>
  )
}

function emptyEquipmentForm() {
  return { id: null, code: '', name: '', categoryId: '', unit: 'unit', specification: '', description: '', isActive: true }
}

function equipmentSnapshot(form) {
  return JSON.stringify(form)
}

function EquipmentSection({ rows, categories, search, onSearch, canManage, busy, onSave, onToggle, onDirtyChange }) {
  const [form, setForm] = useState(null)
  const [baseline, setBaseline] = useState('')
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES)
  const [page, setPage] = useState(0)
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const advancedRef = useRef(null)
  const nameRef = useRef(null)
  const categoryRef = useRef(null)
  const codeRef = useRef(null)
  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (categoryFilter !== ALL_CATEGORIES && row.categoryId !== categoryFilter) return false
      if (!q) return true
      return `${row.code} ${row.name} ${categoryById.get(row.categoryId)?.name ?? ''}`.toLowerCase().includes(q)
    })
  }, [rows, search, categoryFilter, categoryById])
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / LIST_PAGE_SIZE) - 1))
  const pageRows = filtered.slice(safePage * LIST_PAGE_SIZE, (safePage + 1) * LIST_PAGE_SIZE)
  const dirty = Boolean(form && baseline && equipmentSnapshot(form) !== baseline)

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    setPage(0)
  }, [search, categoryFilter])

  const resetForm = () => {
    setForm(null)
    setBaseline('')
    setFieldErrors({})
    setError('')
  }

  const startAdd = () => {
    const next = emptyEquipmentForm()
    setFieldErrors({})
    setError('')
    setForm(next)
    setBaseline(equipmentSnapshot(next))
  }

  const startEdit = (row) => {
    const next = {
      id: row.id,
      code: row.code,
      name: row.name,
      categoryId: row.categoryId,
      unit: row.unit,
      specification: row.specification ?? '',
      description: row.description ?? '',
      isActive: row.isActive,
    }
    setFieldErrors({})
    setError('')
    setForm(next)
    setBaseline(equipmentSnapshot(next))
  }

  const closeForm = () => {
    if (dirty && !window.confirm('Perubahan alat belum disimpan. Tutup form?')) return
    resetForm()
  }

  const submit = async () => {
    const next = {}
    if (!form.name.trim()) next.name = 'Nama alat wajib diisi.'
    if (!form.categoryId) next.categoryId = 'Kategori wajib dipilih.'
    if (!form.unit.trim()) next.unit = 'Satuan wajib diisi.'
    if (!form.code.trim()) next.code = 'Kode alat wajib diisi.'
    setFieldErrors(next)
    setError('')
    if (Object.keys(next).length) {
      if (next.code && advancedRef.current) advancedRef.current.open = true
      window.requestAnimationFrame(() => {
        if (next.name) nameRef.current?.focus()
        else if (next.categoryId) categoryRef.current?.focus()
        else if (next.code) codeRef.current?.focus()
      })
      return
    }
    try {
      await onSave(form)
      resetForm()
    } catch (saveError) {
      setError(saveError.message || 'Peralatan gagal disimpan.')
    }
  }

  const emptyMessage = rows.length
    ? 'Tidak ada alat yang cocok dengan pencarian/filter.'
    : 'Belum ada alat pada katalog ini.'

  return (
    <div className="alkes-section">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Daftar Peralatan</h2>
        <div className="alkes-toolbar-actions">
          <input
            className="sla-input sla-input-text alkes-search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Cari nama/kode alat"
          />
          <select
            className="sla-context-select alkes-filter alkes-category-filter"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value={ALL_CATEGORIES}>Semua kategori</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          {canManage && (
            <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={() => (form ? closeForm() : startAdd())}>
              {form ? 'Batal' : 'Tambah Alat'}
            </button>
          )}
        </div>
      </div>
      {form && canManage && (
        <div className="sla-sign-group alkes-form-surface">
          <div className="alkes-form-heading">
            <div>
              <strong>{form.id ? 'Edit Alat' : 'Tambah Alat'}</strong>
              <p className="sla-table-hint">Isi nama, kategori, dan satuan. Kode dan spesifikasi ada di informasi tambahan.</p>
            </div>
            <span className="alkes-form-count">{filtered.length} alat</span>
          </div>
          <div className="sla-sign-group-head">
            <div className="sla-context-field alkes-field-wide">
              <span className="sla-context-label">Nama Alat *</span>
              <input ref={nameRef} className="sla-input sla-input-text" value={form.name} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} aria-invalid={Boolean(fieldErrors.name)} />
              {fieldErrors.name && <p className="alkes-field-error">{fieldErrors.name}</p>}
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Kategori *</span>
              <select ref={categoryRef} className="sla-context-select" value={form.categoryId} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, categoryId: event.target.value }))} aria-invalid={Boolean(fieldErrors.categoryId)}>
                <option value="">Pilih kategori</option>
                {categories.filter((item) => item.isActive).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              {fieldErrors.categoryId && <p className="alkes-field-error">{fieldErrors.categoryId}</p>}
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Satuan *</span>
              <input className="sla-input sla-input-text" value={form.unit} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))} placeholder="unit/buah/set/pasang" aria-invalid={Boolean(fieldErrors.unit)} />
              {fieldErrors.unit && <p className="alkes-field-error">{fieldErrors.unit}</p>}
            </div>
          </div>
          <details ref={advancedRef} className="alkes-advanced">
            <summary>Informasi tambahan</summary>
            <div className="sla-sign-group-head">
              <div className="sla-context-field">
                <span className="sla-context-label">Kode Alat *</span>
                <input ref={codeRef} className="sla-input sla-input-text" value={form.code} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="cth: ALT001" aria-invalid={Boolean(fieldErrors.code)} />
                {fieldErrors.code && <p className="alkes-field-error">{fieldErrors.code}</p>}
              </div>
              <div className="sla-context-field">
                <span className="sla-context-label">Status</span>
                <select className="sla-context-select" value={form.isActive ? 'Aktif' : 'Nonaktif'} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.value === 'Aktif' }))}>
                  <option value="Aktif">Aktif</option>
                  <option value="Nonaktif">Nonaktif</option>
                </select>
              </div>
              <div className="sla-context-field alkes-field-wide">
                <span className="sla-context-label">Spesifikasi</span>
                <input className="sla-input sla-input-text" value={form.specification} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, specification: event.target.value }))} />
              </div>
              <div className="sla-context-field alkes-field-wide">
                <span className="sla-context-label">Keterangan</span>
                <input className="sla-input sla-input-text" value={form.description} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
              </div>
            </div>
          </details>
          {error && <p className="sla-blocked-note">{error}</p>}
          <div className="alkes-savebar">
            <span className={`alkes-save-status ${dirty ? 'is-dirty' : ''}`}>
              {busy ? 'Menyimpan...' : dirty ? 'Ada perubahan belum disimpan' : 'Belum ada perubahan'}
            </span>
            <div className="alkes-save-actions">
              <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={submit}>
                {busy ? 'Menyimpan...' : form.id ? 'Simpan Perubahan' : 'Simpan Alat'}
              </button>
              <button type="button" className="sla-btn" disabled={busy} onClick={closeForm}>Batal</button>
            </div>
          </div>
        </div>
      )}
      <div className="sla-preview-scroll">
        <table className="sla-preview-table alkes-table">
          <thead>
            <tr>
              <th>Nama Alat</th>
              <th>Kategori</th>
              <th>Satuan</th>
              <th>Status</th>
              {canManage && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {!filtered.length && (
              <tr><td colSpan={canManage ? 5 : 4}>{emptyMessage}</td></tr>
            )}
            {pageRows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong>
                  <div className="sla-table-sub">Kode {row.code}{row.specification ? ` · ${row.specification}` : ''}</div>
                </td>
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
                      <button type="button" className="sla-btn" disabled={busy} onClick={() => startEdit(row)}>Edit</button>
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
      <ListPagination total={filtered.length} page={safePage} onChange={setPage} itemLabel="alat" />
    </div>
  )
}

function emptyTemplateForm() {
  return {
    id: null, templateName: '', vehicleTypeId: '', assignmentId: '',
    vehicleVariant: '', effectiveFrom: '', description: '', rows: [],
  }
}

function templateSnapshot(form) {
  return JSON.stringify({
    id: form.id,
    templateName: form.templateName,
    vehicleTypeId: form.vehicleTypeId,
    assignmentId: form.assignmentId,
    vehicleVariant: form.vehicleVariant,
    effectiveFrom: form.effectiveFrom,
    description: form.description,
    rows: form.rows.map((row) => ({
      key: row.key,
      equipmentId: row.equipmentId,
      requiredQty: String(row.requiredQty ?? ''),
      note: row.note,
    })),
  })
}

function TemplateSection({ templates, templateItems, types, assignments, equipment, categories, search, onSearch, canManage, busy, onSaveDraft, onPublish, onArchive, onDuplicate, onExpand, onDirtyChange }) {
  const [form, setForm] = useState(null)
  const [baseline, setBaseline] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [rowErrors, setRowErrors] = useState({})
  const [itemsError, setItemsError] = useState('')
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')
  const [catalogMessage, setCatalogMessage] = useState('')
  const [saveStatus, setSaveStatus] = useState('idle')
  const [templateMeta, setTemplateMeta] = useState(null)
  const [statusFilter, setStatusFilter] = useState('Semua')
  const [page, setPage] = useState(0)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [selectedEquipmentId, setSelectedEquipmentId] = useState('')
  const [openNotes, setOpenNotes] = useState(() => new Set())
  const [highlightKey, setHighlightKey] = useState('')
  const qtyRefs = useRef(new Map())
  const nameRef = useRef(null)
  const typeRef = useRef(null)
  const assignmentRef = useRef(null)
  const catalogSearchRef = useRef(null)
  const highlightTimer = useRef(null)
  const typeById = useMemo(() => new Map(types.map((item) => [item.id, item])), [types])
  const assignmentById = useMemo(() => new Map(assignments.map((item) => [item.id, item])), [assignments])
  const equipmentById = useMemo(() => new Map(equipment.map((item) => [item.id, item])), [equipment])
  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories])

  useEffect(() => () => {
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return templates.filter((row) => {
      if (statusFilter !== 'Semua' && row.status !== statusFilter) return false
      if (!q) return true
      const hay = `${row.templateCode} ${row.templateName} ${typeById.get(row.vehicleTypeId)?.name ?? ''} ${assignmentById.get(row.assignmentId)?.name ?? ''} ${row.vehicleVariant}`.toLowerCase()
      return hay.includes(q)
    })
  }, [templates, search, statusFilter, typeById, assignmentById])
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / LIST_PAGE_SIZE) - 1))
  const pageRows = filtered.slice(safePage * LIST_PAGE_SIZE, (safePage + 1) * LIST_PAGE_SIZE)
  const emptyMessage = templates.length
    ? 'Tidak ada template yang cocok dengan pencarian/status.'
    : 'Belum ada template.'

  const worksheetGroups = useMemo(() => {
    const groups = new Map()
    for (const row of form?.rows ?? []) {
      const item = equipmentById.get(row.equipmentId)
      const category = item ? categoryById.get(item.categoryId) : null
      const key = category?.id ?? UNCATEGORIZED
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: category?.name ?? 'Tanpa Kategori',
          sortOrder: category?.sortOrder ?? Number.MAX_SAFE_INTEGER,
          rows: [],
        })
      }
      groups.get(key).rows.push({ ...row, equipment: item })
    }
    return [...groups.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((group) => ({
        ...group,
        rows: group.rows.sort((a, b) => (
          (a.equipment?.sortOrder ?? 0) - (b.equipment?.sortOrder ?? 0)
          || String(a.equipment?.name ?? '').localeCompare(String(b.equipment?.name ?? ''))
        )),
      }))
  }, [form?.rows, equipmentById, categoryById])

  const orderedRows = useMemo(() => worksheetGroups.flatMap((group) => group.rows), [worksheetGroups])
  const rowNumbers = useMemo(() => new Map(orderedRows.map((row, index) => [row.key, index + 1])), [orderedRows])

  const catalogGroups = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase()
    const groups = new Map()
    for (const item of equipment) {
      if (!item.isActive) continue
      const category = categoryById.get(item.categoryId)
      if (q && !`${item.code} ${item.name} ${category?.name ?? ''}`.toLowerCase().includes(q)) continue
      const key = category?.id ?? UNCATEGORIZED
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: category?.name ?? 'Tanpa Kategori',
          sortOrder: category?.sortOrder ?? Number.MAX_SAFE_INTEGER,
          items: [],
        })
      }
      groups.get(key).items.push(item)
    }
    return [...groups.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((group) => ({
        ...group,
        items: group.items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      }))
  }, [equipment, categoryById, catalogSearch])

  const baselineRows = useMemo(() => {
    try {
      const parsed = JSON.parse(baseline || '{}')
      return new Map((parsed.rows ?? []).map((row) => [row.key, row]))
    } catch {
      return new Map()
    }
  }, [baseline])

  const dirty = Boolean(form && baseline && templateSnapshot(form) !== baseline)
  const selectedEquipment = equipmentById.get(selectedEquipmentId) ?? null

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    setPage(0)
  }, [search, statusFilter])

  const allRowCount = orderedRows.length
  const categoryCount = worksheetGroups.length
  const statusText = busy || saveStatus === 'saving'
    ? 'Menyimpan...'
    : dirty
      ? 'Ada perubahan belum disimpan'
      : saveStatus === 'saved'
        ? 'Tersimpan'
        : 'Belum ada perubahan'

  const isRowChanged = (row) => {
    const before = baselineRows.get(row.key)
    if (!before) return true
    return before.equipmentId !== row.equipmentId
      || String(before.requiredQty) !== String(row.requiredQty)
      || before.note !== row.note
  }

  const focusRow = (key) => {
    window.requestAnimationFrame(() => qtyRefs.current.get(key)?.focus())
  }

  const highlightRow = (key) => {
    setHighlightKey(key)
    focusRow(key)
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setHighlightKey(''), 1800)
  }

  const resetForm = () => {
    setForm(null)
    setBaseline('')
    setFieldErrors({})
    setRowErrors({})
    setItemsError('')
    setFormError('')
    setActionError('')
    setCatalogMessage('')
    setCatalogSearch('')
    setSelectedEquipmentId('')
    setOpenNotes(new Set())
    setHighlightKey('')
    setTemplateMeta(null)
    setSaveStatus('idle')
  }

  const closeForm = () => {
    if (dirty && !window.confirm('Draft template belum disimpan. Tutup form?')) return
    resetForm()
  }

  const startCreate = () => {
    if (dirty && !window.confirm('Draft template belum disimpan. Buat template baru?')) return
    const next = emptyTemplateForm()
    setFieldErrors({})
    setRowErrors({})
    setItemsError('')
    setFormError('')
    setActionError('')
    setCatalogMessage('')
    setCatalogSearch('')
    setSelectedEquipmentId('')
    setOpenNotes(new Set())
    setTemplateMeta(null)
    setSaveStatus('idle')
    setForm(next)
    setBaseline(templateSnapshot(next))
  }

  const startEdit = async (template) => {
    if (dirty && !window.confirm('Draft template belum disimpan. Ganti template yang diedit?')) return
    setFormError('')
    setFieldErrors({})
    setRowErrors({})
    setItemsError('')
    setFormError('')
    setActionError('')
    setCatalogMessage('')
    setCatalogSearch('')
    setSelectedEquipmentId('')
    try {
      const items = await onExpand(template.id)
      const next = {
        id: template.id,
        templateName: template.templateName,
        vehicleTypeId: template.vehicleTypeId,
        assignmentId: template.assignmentId,
        vehicleVariant: template.vehicleVariant ?? '',
        effectiveFrom: template.effectiveFrom ?? '',
        description: template.description ?? '',
        rows: items.map((item, index) => ({
          key: `r${index}`,
          equipmentId: item.equipmentId,
          requiredQty: String(item.requiredQty ?? ''),
          note: item.note ?? '',
        })),
      }
      setForm(next)
      setBaseline(templateSnapshot(next))
      setOpenNotes(new Set(items.map((item, index) => (item.note ? `r${index}` : null)).filter(Boolean)))
      setTemplateMeta({
        templateCode: template.templateCode,
        versionNumber: template.versionNumber,
        status: template.status,
      })
      setSaveStatus('idle')
    } catch (loadError) {
      setFormError(loadError.message || 'Rincian template gagal dimuat.')
    }
  }

  const addRow = () => {
    if (!form) return
    if (!selectedEquipment) {
      setCatalogMessage('Pilih alat dari katalog terlebih dahulu.')
      catalogSearchRef.current?.focus()
      return
    }
    const existing = form.rows.find((row) => row.equipmentId === selectedEquipment.id)
    if (existing) {
      setSelectedEquipmentId('')
      setCatalogMessage('Alat sudah ada di daftar. Baris yang ada ditandai.')
      highlightRow(existing.key)
      return
    }
    const key = `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    setForm((prev) => ({
      ...prev,
      rows: [...prev.rows, { key, equipmentId: selectedEquipment.id, requiredQty: '1', note: '' }],
    }))
    setSelectedEquipmentId('')
    setCatalogMessage('')
    setItemsError('')
    setFormError('')
    setSaveStatus('dirty')
    window.requestAnimationFrame(() => qtyRefs.current.get(key)?.focus())
  }

  const updateRow = (key, patch) => {
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }))
    setRowErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setSaveStatus('dirty')
  }

  const removeRow = (key) => {
    setForm((prev) => ({ ...prev, rows: prev.rows.filter((row) => row.key !== key) }))
    setOpenNotes((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setSaveStatus('dirty')
  }

  const toggleNote = (key) => {
    setOpenNotes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleQtyKeyDown = (event, key) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const index = orderedRows.findIndex((row) => row.key === key)
    const next = orderedRows[index + 1]
    if (next) focusRow(next.key)
    else catalogSearchRef.current?.focus()
  }

  const submitDraft = async () => {
    if (!form || busy || saveStatus === 'saving') return
    const nextFieldErrors = {}
    const nextRowErrors = {}
    if (!form.templateName.trim()) nextFieldErrors.templateName = 'Nama template wajib diisi.'
    if (!form.vehicleTypeId) nextFieldErrors.vehicleTypeId = 'Jenis kendaraan wajib dipilih.'
    if (!form.assignmentId) nextFieldErrors.assignmentId = 'Penugasan wajib dipilih.'
    for (const row of orderedRows) {
      if (!row.equipment) {
        nextRowErrors[row.key] = 'Alat tidak ditemukan.'
        continue
      }
      const raw = String(row.requiredQty ?? '').trim()
      if (raw === '') nextRowErrors[row.key] = 'Jumlah wajib diisi.'
      else if (!/^\d+$/.test(raw)) nextRowErrors[row.key] = 'Gunakan bilangan bulat 0 atau lebih.'
    }
    setFieldErrors(nextFieldErrors)
    setRowErrors(nextRowErrors)
    setFormError('')
    setItemsError(orderedRows.length ? '' : 'Tambahkan minimal satu alat dari katalog.')
    if (orderedRows.length === 0) {
      setCatalogMessage('Pilih alat dari katalog untuk memulai.')
      catalogSearchRef.current?.focus()
      return
    }
    if (Object.keys(nextFieldErrors).length) {
      window.requestAnimationFrame(() => {
        if (nextFieldErrors.templateName) nameRef.current?.focus()
        else if (nextFieldErrors.vehicleTypeId) typeRef.current?.focus()
        else if (nextFieldErrors.assignmentId) assignmentRef.current?.focus()
      })
      return
    }
    if (Object.keys(nextRowErrors).length) {
      const firstKey = orderedRows.find((row) => nextRowErrors[row.key])?.key
      if (firstKey) focusRow(firstKey)
      return
    }

    setSaveStatus('saving')
    try {
      const saved = await onSaveDraft({
        id: form.id,
        templateName: form.templateName.trim(),
        vehicleTypeId: form.vehicleTypeId,
        assignmentId: form.assignmentId,
        vehicleVariant: form.vehicleVariant.trim(),
        effectiveFrom: form.effectiveFrom || null,
        description: form.description.trim(),
        items: orderedRows.map((row) => ({
          equipmentId: row.equipmentId,
          requiredQty: Number(row.requiredQty),
          note: row.note.trim(),
        })),
      })
      const nextForm = {
        ...form,
        id: saved.id,
        templateName: form.templateName.trim(),
        vehicleVariant: form.vehicleVariant.trim(),
        description: form.description.trim(),
        rows: orderedRows.map((row) => ({
          key: row.key,
          equipmentId: row.equipmentId,
          requiredQty: String(row.requiredQty),
          note: row.note.trim(),
        })),
      }
      setForm(nextForm)
      setBaseline(templateSnapshot(nextForm))
      setTemplateMeta({
        templateCode: saved.templateCode,
        versionNumber: saved.versionNumber,
        status: saved.status,
      })
      setSaveStatus('saved')
      setFieldErrors({})
      setRowErrors({})
      setItemsError('')
    } catch (saveError) {
      setFormError(saveError.message || 'Template gagal disimpan.')
      setSaveStatus('dirty')
    }
  }

  const handlePublish = async (template) => {
    setActionError('')
    if (form?.id === template.id && dirty) {
      setActionError('Simpan draft template terlebih dahulu sebelum menerbitkan versi ini.')
      return
    }
    if (!window.confirm(`Terbitkan "${template.templateName}" v${template.versionNumber} sebagai Aktif?`)) return
    try {
      await onPublish(template)
      if (form?.id === template.id) resetForm()
    } catch (publishError) {
      setActionError(publishError.message || 'Template gagal diterbitkan.')
    }
  }

  const handleArchive = async (template) => {
    setActionError('')
    if (form?.id === template.id && dirty) {
      setActionError('Simpan draft template terlebih dahulu sebelum mengarsipkan versi ini.')
      return
    }
    if (!window.confirm(`Arsipkan "${template.templateName}" v${template.versionNumber}? Template arsip tidak dipakai acuan baru.`)) return
    try {
      await onArchive(template)
      if (form?.id === template.id) resetForm()
    } catch (archiveError) {
      setActionError(archiveError.message || 'Template gagal diarsipkan.')
    }
  }

  const handleDuplicate = async (template) => {
    setActionError('')
    try {
      await onDuplicate(template)
    } catch (duplicateError) {
      setActionError(duplicateError.message || 'Template gagal diduplikasi.')
    }
  }

  const handleExpand = async (template) => {
    setActionError('')
    try {
      await onExpand(template.id)
    } catch (expandError) {
      setActionError(expandError.message || 'Rincian template gagal dimuat.')
    }
  }

  return (
    <div className="alkes-section">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Kebutuhan Peralatan</h2>
        <div className="alkes-toolbar-actions">
          <input
            className="sla-input sla-input-text alkes-search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Cari template"
          />
          <select className="sla-context-select alkes-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="Semua">Semua status</option>
            <option value="Draft">Draft</option>
            <option value="Aktif">Aktif</option>
            <option value="Diarsipkan">Diarsipkan</option>
          </select>
          {canManage && (
            <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={() => (form ? closeForm() : startCreate())}>
              {form ? 'Tutup Form' : 'Buat Template'}
            </button>
          )}
        </div>
      </div>
      {actionError && <p className="sla-blocked-note">{actionError}</p>}
      {form && canManage && (
        <div className="sla-sign-group alkes-form-surface">
          <div className="alkes-form-heading">
            <div>
              <strong>{form.id ? 'Edit Draft Template' : 'Template Kebutuhan Baru'}</strong>
              <p className="sla-table-hint">Isi konteks sekali, lalu masukkan Jumlah Kebutuhan langsung pada tabel.</p>
            </div>
            {templateMeta && (
              <span className="alkes-meta-pill">
                {templateMeta.templateCode} · v{templateMeta.versionNumber} · {templateMeta.status}
              </span>
            )}
          </div>
          <div className="sla-sign-group-head">
            <div className="sla-context-field alkes-field-wide">
              <span className="sla-context-label">Nama Template *</span>
              <input ref={nameRef} className="sla-input sla-input-text" value={form.templateName} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, templateName: event.target.value }))} placeholder="cth: Roda 2 — Koordinator" aria-invalid={Boolean(fieldErrors.templateName)} />
              {fieldErrors.templateName && <p className="alkes-field-error">{fieldErrors.templateName}</p>}
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Jenis Kendaraan *</span>
              <select ref={typeRef} className="sla-context-select" value={form.vehicleTypeId} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, vehicleTypeId: event.target.value }))} aria-invalid={Boolean(fieldErrors.vehicleTypeId)}>
                <option value="">Pilih jenis</option>
                {types.filter((item) => item.isActive).map((item) => (
                  <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
                ))}
              </select>
              {fieldErrors.vehicleTypeId && <p className="alkes-field-error">{fieldErrors.vehicleTypeId}</p>}
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Penugasan *</span>
              <select ref={assignmentRef} className="sla-context-select" value={form.assignmentId} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, assignmentId: event.target.value }))} aria-invalid={Boolean(fieldErrors.assignmentId)}>
                <option value="">Pilih penugasan</option>
                {assignments.filter((item) => item.isActive).map((item) => (
                  <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
                ))}
              </select>
              {fieldErrors.assignmentId && <p className="alkes-field-error">{fieldErrors.assignmentId}</p>}
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Varian/Model (opsional)</span>
              <input className="sla-input sla-input-text" value={form.vehicleVariant} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, vehicleVariant: event.target.value }))} placeholder="cth: Terios (kosongkan bila umum)" />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Tanggal Berlaku</span>
              <input type="date" className="sla-context-select" value={form.effectiveFrom} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))} />
            </div>
          </div>
          <details className="alkes-advanced">
            <summary>Informasi tambahan</summary>
            <div className="sla-sign-group-head">
              <div className="sla-context-field alkes-field-wide">
                <span className="sla-context-label">Deskripsi</span>
                <input className="sla-input sla-input-text" value={form.description} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
              </div>
            </div>
          </details>
          <div className="alkes-worksheet-head">
            <div>
              <strong>Daftar Alat</strong>
              <span className="sla-table-hint">{allRowCount} jenis · {categoryCount} kategori</span>
            </div>
            <div className="alkes-catalog-toolbar">
              <input
                ref={catalogSearchRef}
                className="sla-input sla-input-text alkes-search"
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
                placeholder="Cari alat di katalog"
              />
              <select className="sla-context-select" value={selectedEquipmentId} onChange={(event) => { setSelectedEquipmentId(event.target.value); setCatalogMessage('') }} disabled={busy}>
                <option value="">Pilih alat dari katalog</option>
                {catalogGroups.map((group) => (
                  <optgroup key={group.key} label={group.name}>
                    {group.items.map((item) => (
                      <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button type="button" className="sla-btn" disabled={busy || !selectedEquipmentId} onClick={addRow}>Tambah Alat</button>
            </div>
          </div>
          {catalogMessage && <p className="sla-table-hint">{catalogMessage}</p>}
          {itemsError && <p className="alkes-field-error">{itemsError}</p>}
          <div className="alkes-worksheet-scroll">
            <table className="alkes-worksheet-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Nama Peralatan</th>
                  <th>Satuan</th>
                  <th>Jumlah Kebutuhan</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {!orderedRows.length && (
                  <tr>
                    <td colSpan={5} className="alkes-empty-state">
                      Belum ada alat. Pilih alat dari katalog di atas untuk memulai.
                    </td>
                  </tr>
                )}
                {worksheetGroups.map((group) => (
                  <Fragment key={group.key}>
                    <tr className="alkes-group-row">
                      <td colSpan={5}>
                        {group.name}
                        <span className="alkes-group-count">{group.rows.length} jenis</span>
                      </td>
                    </tr>
                    {group.rows.map((row) => (
                      <Fragment key={row.key}>
                        <tr className={`${highlightKey === row.key ? 'alkes-row-highlight' : ''} ${isRowChanged(row) ? 'alkes-row-changed' : ''}`}>
                          <td className="alkes-row-number">
                            {rowNumbers.get(row.key)}
                            {isRowChanged(row) && <span className="alkes-row-badge">Diubah</span>}
                          </td>
                          <td>
                            <strong>{row.equipment?.name ?? 'Alat tidak ditemukan'}</strong>
                            {row.equipment?.code && <div className="sla-table-sub">Kode {row.equipment.code}</div>}
                            {row.equipment && !row.equipment.isActive && <span className="alkes-inactive-badge">Nonaktif</span>}
                          </td>
                          <td>{row.equipment?.unit ?? '—'}</td>
                          <td className="alkes-qty-cell">
                            <input
                              ref={(node) => {
                                if (node) qtyRefs.current.set(row.key, node)
                                else qtyRefs.current.delete(row.key)
                              }}
                              className={`sla-input alkes-qty-input ${rowErrors[row.key] ? 'is-invalid' : ''}`}
                              inputMode="numeric"
                              value={row.requiredQty}
                              disabled={busy}
                              onChange={(event) => updateRow(row.key, { requiredQty: event.target.value.replace(/[^\d]/g, '') })}
                              onKeyDown={(event) => handleQtyKeyDown(event, row.key)}
                              aria-invalid={Boolean(rowErrors[row.key])}
                              aria-label={`Jumlah Kebutuhan ${row.equipment?.name ?? ''}`}
                            />
                            {rowErrors[row.key] && <p className="alkes-field-error">{rowErrors[row.key]}</p>}
                          </td>
                          <td>
                            <div className="alkes-row-actions">
                              <button type="button" className="sla-btn alkes-compact-btn" disabled={busy} onClick={() => toggleNote(row.key)} aria-expanded={openNotes.has(row.key)}>
                                {row.note ? 'Catatan •' : 'Catatan'}
                              </button>
                              <button type="button" className="sla-btn alkes-compact-btn" disabled={busy} onClick={() => removeRow(row.key)}>Hapus</button>
                            </div>
                          </td>
                        </tr>
                        {openNotes.has(row.key) && (
                          <tr className="alkes-note-row">
                            <td />
                            <td colSpan={4}>
                              <label className="sla-context-field">
                                <span className="sla-context-label">Catatan untuk {row.equipment?.name ?? 'alat ini'} (opsional)</span>
                                <input className="sla-input sla-input-text alkes-note-input" value={row.note} disabled={busy} onChange={(event) => updateRow(row.key, { note: event.target.value })} />
                              </label>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {formError && <p className="sla-blocked-note">{formError}</p>}
          <div className="alkes-savebar">
            <span className={`alkes-save-status ${dirty ? 'is-dirty' : saveStatus === 'saved' ? 'is-saved' : ''}`}>{statusText}</span>
            <div className="alkes-save-actions">
              <button type="button" className="sla-btn sla-btn-primary" disabled={busy || saveStatus === 'saving'} onClick={submitDraft}>
                {busy || saveStatus === 'saving' ? 'Menyimpan...' : 'Simpan Draft'}
              </button>
              <button type="button" className="sla-btn" disabled={busy} onClick={closeForm}>Tutup</button>
            </div>
          </div>
        </div>
      )}
      <div className="sla-preview-scroll">
        <table className="sla-preview-table alkes-table alkes-table--wide">
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
              <tr><td colSpan={canManage ? 7 : 6}>{emptyMessage}</td></tr>
            )}
            {pageRows.map((template) => {
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
                        <button type="button" className="sla-btn" disabled={busy} onClick={() => handleExpand(template)}>Lihat</button>
                        {template.status === 'Draft' && (
                          <>
                            <button type="button" className="sla-btn" disabled={busy} onClick={() => startEdit(template)}>Edit</button>
                            <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={() => handlePublish(template)}>Terbitkan</button>
                          </>
                        )}
                        {template.status !== 'Draft' && (
                          <button type="button" className="sla-btn" disabled={busy} onClick={() => handleDuplicate(template)}>Duplikasi</button>
                        )}
                        {template.status === 'Aktif' && (
                          <button type="button" className="sla-btn" disabled={busy} onClick={() => handleArchive(template)}>Arsipkan</button>
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
      <ListPagination total={filtered.length} page={safePage} onChange={setPage} itemLabel="template" />
    </div>
  )
}

export default function AlatKendaraanMaster({ contractUuid, up3Uuid, canManage }) {
  const [tab, setTab] = useState('jenis')
  const [tabDirty, setTabDirty] = useState(false)
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

  const reload = async ({ silent = false } = {}) => {
    if (!scopeReady) {
      if (!silent) setLoading(false)
      return
    }
    if (!silent) {
      setLoading(true)
      setLoadError('')
    }
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
      if (silent) setNotice(error.message || 'Master data gagal dimuat ulang.')
      else setLoadError(error.message || 'Master data gagal dimuat.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [contractUuid, up3Uuid])

  useEffect(() => {
    if (!tabDirty) return undefined
    const handler = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [tabDirty])

  const mutate = async (work) => {
    setBusy(true)
    setNotice('')
    try {
      const result = await work()
      await reload({ silent: true })
      return result
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
    await mutate(() => publishOpsTemplate(template.id).then(() => setNotice('Template diterbitkan.')))
  }

  const handleArchive = async (template) => {
    await mutate(() => archiveOpsTemplate(template.id).then(() => setNotice('Template diarsipkan.')))
  }

  const handleDuplicate = async (template) => {
    await mutate(() => duplicateOpsTemplate(template.id).then(() => setNotice('Draft versi baru dibuat dari template ini.')))
  }

  const switchTab = (nextTab) => {
    if (nextTab === tab) {
      setSearch('')
      setNotice('')
      return
    }
    if (tabDirty && !window.confirm('Perubahan pada tab ini belum disimpan. Pindah tab?')) return
    setTab(nextTab)
    setTabDirty(false)
    setSearch('')
    setNotice('')
  }

  if (!scopeReady) {
    return (
      <section className="sla-settings alkes-master">
        <h2 className="sla-settings-title">Master Data Alat & Kendaraan</h2>
        <p className="sla-blocked-note">Scope organisasi belum siap. Muat ulang halaman.</p>
      </section>
    )
  }

  return (
    <section className="sla-settings alkes-master">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Master Data Alat & Kendaraan</h2>
      </div>
      <p className="sla-flat-note">
        Katalog dan template kebutuhan peralatan kendaraan operasional
        untuk scope organisasi yang dipilih.
        {!canManage && ' Akun ini hanya dapat melihat (read-only).'}
      </p>
      {loading ? (
        <p className="sla-table-hint">Memuat master data...</p>
      ) : loadError ? (
        <p className="sla-blocked-note">{loadError} <button type="button" className="sla-btn" onClick={() => reload()}>Coba lagi</button></p>
      ) : (
        <>
          <div className="sla-detail-tabs">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`sla-detail-tab ${tab === item.id ? 'sla-detail-tab-active' : ''}`}
                onClick={() => switchTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {notice && <p className="sla-export-note">{notice}</p>}
          {['jenis', 'penugasan', 'kategori'].includes(tab) && (
            <MasterSection
              key={tab}
              kind={KIND_OF_TAB[tab]}
              title={KIND_TITLE[KIND_OF_TAB[tab]]}
              rows={tab === 'jenis' ? types : tab === 'penugasan' ? assignments : categories}
              search={search}
              onSearch={setSearch}
              canManage={canManage}
              busy={busy}
              onSave={handleSaveMaster}
              onToggle={handleToggleMaster}
              onDirtyChange={setTabDirty}
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
              onDirtyChange={setTabDirty}
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
              onSaveDraft={(payload) => mutate(() => saveOpsTemplateDraft({ contractId: contractUuid, up3Id: up3Uuid, ...payload }).then((saved) => {
                setNotice('Draft template tersimpan.')
                return saved
              }))}
              onPublish={handlePublish}
              onArchive={handleArchive}
              onDuplicate={handleDuplicate}
              onExpand={handleExpandTemplate}
              onDirtyChange={setTabDirty}
            />
          )}
        </>
      )}
    </section>
  )
}
