import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import PrescribedFleetAdmin from './PrescribedFleetAdmin.jsx'
import EquipmentImportPanel from './EquipmentImportPanel.jsx'
import AlkesModal from './AlkesModal.jsx'
import CatalogPicker from './CatalogPicker.jsx'
import TemplateDetailModal from './TemplateDetailModal.jsx'
import {
  effectiveMonthlyCost, expectedMonthlyCost, formatRupiah, parseRupiahAmount,
  priceMismatch, templateCostSummary,
} from '../../data/equipmentPricing.js'
import {
  archiveOpsTemplate,
  duplicateOpsTemplate,
  importOpsEquipment,
  listOpsEquipment,
  listOpsMasters,
  listOpsTemplateCosts,
  listOpsTemplateItems,
  listOpsTemplates,
  publishOpsTemplate,
  saveOpsEquipment,
  saveOpsMaster,
  saveOpsTemplateDraft,
  updateOpsActiveTemplate,
} from '../../data/opsEquipmentRepository.js'

const TABS = [
  { id: 'template', label: 'Template Kebutuhan' },
  { id: 'penetapan', label: 'Penetapan Kendaraan' },
  { id: 'katalog', label: 'Katalog & Data Pendukung' },
]
const CATALOG_TABS = [
  { id: 'peralatan', label: 'Daftar Peralatan' },
  { id: 'kategori', label: 'Kategori Peralatan' },
  { id: 'jenis', label: 'Jenis Kendaraan' },
  { id: 'penugasan', label: 'Penugasan Kendaraan' },
]
const CATALOG_TAB_IDS = new Set(CATALOG_TABS.map((item) => item.id))
const CATALOG_NOTES = {
  peralatan: 'Kelola nama, kategori, satuan, dan umur peralatan yang dipakai di dalam template.',
  kategori: 'Atur kelompok peralatan agar penyusunan template lebih cepat dan konsisten.',
  jenis: 'Jenis kendaraan menjadi bagian pertama nama template otomatis.',
  penugasan: 'Penugasan kendaraan menjadi bagian kedua nama template otomatis.',
}

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
    if (busy) return
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
    if (busy || (dirty && !window.confirm('Perubahan data belum disimpan. Ganti data yang diedit?'))) return
    const next = { id: row.id, code: row.code, name: row.name, description: row.description ?? '', isActive: row.isActive }
    setError('')
    setForm(next)
    setBaseline(JSON.stringify(next))
  }
  const submit = async () => {
    if (!form || busy) return
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

  const toggleStatus = async (row) => {
    try {
      await onToggle(kind, row)
    } catch (toggleError) {
      setError(toggleError.message || 'Status gagal diubah.')
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
        </div>
      )}
      {error && <p className="sla-blocked-note" role="alert">{error}</p>}
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
                      <button type="button" className="sla-btn" disabled={busy || form?.id === row.id} onClick={() => toggleStatus(row)}>
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
  return {
    id: null, code: '', name: '', categoryId: '', unit: 'unit', ageMonths: '',
    bppAmount: '', monthlyCost: '', specification: '', description: '', isActive: true,
  }
}

function parseEquipmentAge(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return { value: null, error: '' }
  if (!/^\d+$/.test(raw)) return { value: null, error: 'Masa manfaat harus bilangan bulat bulan atau dikosongkan.' }
  const number = Number(raw)
  if (!Number.isSafeInteger(number) || number > 2147483647) return { value: null, error: 'Masa manfaat terlalu besar.' }
  return { value: number, error: '' }
}

function equipmentSnapshot(form) {
  return JSON.stringify(form)
}

function EquipmentSection({ rows, categories, search, onSearch, canManage, busy, onSave, onToggle, onImport, onDirtyChange }) {
  const [form, setForm] = useState(null)
  const [baseline, setBaseline] = useState('')
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES)
  const [page, setPage] = useState(0)
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const advancedRef = useRef(null)
  const nameRef = useRef(null)
  const categoryRef = useRef(null)
  const unitRef = useRef(null)
  const ageRef = useRef(null)
  const bppRef = useRef(null)
  const monthlyRef = useRef(null)
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
  const formBpp = parseRupiahAmount(form?.bppAmount ?? '')
  const formMonthly = parseRupiahAmount(form?.monthlyCost ?? '')
  const formAge = parseEquipmentAge(form?.ageMonths ?? '')
  const calculatedMonthly = expectedMonthlyCost(formBpp.value, formAge.value)
  const formPriceMismatch = priceMismatch({
    monthlyCost: formMonthly.value, bppAmount: formBpp.value, ageMonths: formAge.value,
  })

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
    setImportOpen(false)
    setFieldErrors({})
    setError('')
    setForm(next)
    setBaseline(equipmentSnapshot(next))
  }

  const startEdit = (row) => {
    if (busy || (dirty && !window.confirm('Perubahan alat belum disimpan. Ganti alat yang diedit?'))) return
    const next = {
      id: row.id,
      code: row.code,
      name: row.name,
      categoryId: row.categoryId,
      unit: row.unit,
      ageMonths: row.ageMonths == null ? '' : String(row.ageMonths),
      bppAmount: row.bppAmount == null ? '' : String(row.bppAmount),
      monthlyCost: row.monthlyCost == null ? '' : String(row.monthlyCost),
      specification: row.specification ?? '',
      description: row.description ?? '',
      isActive: row.isActive,
    }
    setImportOpen(false)
    setFieldErrors({})
    setError('')
    setForm(next)
    setBaseline(equipmentSnapshot(next))
  }

  const closeForm = () => {
    if (busy) return
    if (dirty && !window.confirm('Perubahan alat belum disimpan. Tutup form?')) return
    resetForm()
  }

  const submit = async () => {
    if (!form || busy) return
    const next = {}
    const age = parseEquipmentAge(form.ageMonths)
    const bpp = parseRupiahAmount(form.bppAmount)
    const monthly = parseRupiahAmount(form.monthlyCost)
    if (!form.name.trim()) next.name = 'Nama alat wajib diisi.'
    if (!form.categoryId) next.categoryId = 'Kategori wajib dipilih.'
    if (!form.unit.trim()) next.unit = 'Satuan wajib diisi.'
    if (age.error) next.ageMonths = age.error
    if (bpp.error) next.bppAmount = bpp.error
    if (monthly.error) next.monthlyCost = monthly.error
    setFieldErrors(next)
    setError('')
    if (Object.keys(next).length) {
      window.requestAnimationFrame(() => {
        if (next.name) nameRef.current?.focus()
        else if (next.categoryId) categoryRef.current?.focus()
        else if (next.unit) unitRef.current?.focus()
        else if (next.ageMonths) ageRef.current?.focus()
        else if (next.bppAmount) bppRef.current?.focus()
        else if (next.monthlyCost) monthlyRef.current?.focus()
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

  const toggleStatus = async (row) => {
    try {
      await onToggle(row)
    } catch (toggleError) {
      setError(toggleError.message || 'Status alat gagal diubah.')
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
          {canManage && !form && (
            <button type="button" className="sla-btn" disabled={busy} onClick={() => setImportOpen((value) => !value)}>
              {importOpen ? 'Tutup Impor' : 'Impor CSV/Excel'}
            </button>
          )}
          {canManage && (
            <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={() => (form ? closeForm() : startAdd())}>
              {form ? 'Batal' : 'Tambah Alat'}
            </button>
          )}
        </div>
      </div>
      {importOpen && canManage && !form && (
        <EquipmentImportPanel
          categories={categories}
          equipment={rows}
          busy={busy}
          onImport={onImport}
          onClose={() => setImportOpen(false)}
        />
      )}
      {form && canManage && (
        <div className="sla-sign-group alkes-form-surface">
          <div className="alkes-form-heading">
            <div>
              <strong>{form.id ? 'Edit Alat' : 'Tambah Alat'}</strong>
              <p className="sla-table-hint">Isi identitas alat, masa manfaat, serta nilai BPP dan biaya bulanan bila tersedia. Kode alat otomatis bila dikosongkan.</p>
            </div>
            <span className="alkes-form-count">{filtered.length} alat</span>
          </div>
          <div className="sla-sign-group-head">
            <div className="sla-context-field alkes-field-wide">
              <label htmlFor="equipment-name" className="sla-context-label">Nama Alat *</label>
              <input id="equipment-name" ref={nameRef} className="sla-input sla-input-text" value={form.name} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} aria-invalid={Boolean(fieldErrors.name)} />
              {fieldErrors.name && <p className="alkes-field-error">{fieldErrors.name}</p>}
            </div>
            <div className="sla-context-field">
              <label htmlFor="equipment-category" className="sla-context-label">Kategori *</label>
              <select id="equipment-category" ref={categoryRef} className="sla-context-select" value={form.categoryId} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, categoryId: event.target.value }))} aria-invalid={Boolean(fieldErrors.categoryId)}>
                <option value="">Pilih kategori</option>
                {categories.filter((item) => item.isActive || item.id === form.categoryId).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{!item.isActive ? ' (Nonaktif)' : ''}</option>
                ))}
              </select>
              {fieldErrors.categoryId && <p className="alkes-field-error">{fieldErrors.categoryId}</p>}
            </div>
            <div className="sla-context-field">
              <label htmlFor="equipment-unit" className="sla-context-label">Satuan *</label>
              <input id="equipment-unit" ref={unitRef} className="sla-input sla-input-text" value={form.unit} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))} placeholder="unit/buah/set/pasang" aria-invalid={Boolean(fieldErrors.unit)} />
              {fieldErrors.unit && <p className="alkes-field-error">{fieldErrors.unit}</p>}
            </div>
            <div className="sla-context-field">
              <label htmlFor="equipment-age" className="sla-context-label">Masa Manfaat (Bulan)</label>
              <input id="equipment-age" ref={ageRef} className="sla-input sla-input-text" inputMode="numeric" value={form.ageMonths} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, ageMonths: event.target.value }))} placeholder="cth: 24" aria-invalid={Boolean(fieldErrors.ageMonths)} />
              {fieldErrors.ageMonths && <p className="alkes-field-error">{fieldErrors.ageMonths}</p>}
            </div>
            <div className="sla-context-field">
              <label htmlFor="equipment-bpp" className="sla-context-label">BPP (Rp/Unit)</label>
              <input id="equipment-bpp" ref={bppRef} className="sla-input sla-input-text" inputMode="decimal" value={form.bppAmount} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, bppAmount: event.target.value }))} placeholder="cth: 2.100.000" aria-invalid={Boolean(fieldErrors.bppAmount)} />
              {fieldErrors.bppAmount && <p className="alkes-field-error">{fieldErrors.bppAmount}</p>}
            </div>
            <div className="sla-context-field">
              <label htmlFor="equipment-monthly" className="sla-context-label">Cost/Bulan (Rp/Unit)</label>
              <input id="equipment-monthly" ref={monthlyRef} className="sla-input sla-input-text" inputMode="decimal" value={form.monthlyCost} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, monthlyCost: event.target.value }))} placeholder="Kosongkan untuk menghitung BPP ÷ masa manfaat" aria-invalid={Boolean(fieldErrors.monthlyCost)} />
              {fieldErrors.monthlyCost && <p className="alkes-field-error">{fieldErrors.monthlyCost}</p>}
            </div>
          </div>
          {calculatedMonthly != null && (
            <p className={`alkes-price-note${formPriceMismatch ? ' is-warning' : ''}`}>
              BPP ÷ masa manfaat = {formatRupiah(calculatedMonthly)} per unit per bulan.
              {formPriceMismatch ? ` Cost/Bulan yang diisi ${formatRupiah(formMonthly.value)} berbeda.` : ''}
            </p>
          )}
          <details ref={advancedRef} className="alkes-advanced">
            <summary>Informasi tambahan (Kode Alat otomatis bila kosong)</summary>
            <div className="sla-sign-group-head">
              <div className="sla-context-field">
                <label htmlFor="equipment-code" className="sla-context-label">Kode Alat</label>
                <input id="equipment-code" ref={codeRef} className="sla-input sla-input-text" value={form.code} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="Kosongkan untuk dibuat otomatis" />
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
      {error && <p className="sla-blocked-note" role="alert">{error}</p>}
      <div className="sla-preview-scroll">
        <table className="sla-preview-table alkes-table alkes-table--wide alkes-equipment-table">
          <thead>
            <tr>
              <th>Nama Alat</th>
              <th>Kategori</th>
              <th>Satuan</th>
              <th>Masa Manfaat</th>
              <th>BPP</th>
              <th>Cost/Bulan</th>
              <th>Status</th>
              {canManage && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {!filtered.length && (
              <tr><td colSpan={canManage ? 8 : 7}>{emptyMessage}</td></tr>
            )}
            {pageRows.map((row) => {
              const monthly = effectiveMonthlyCost(row)
              const mismatch = priceMismatch(row)
              return (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <div className="sla-table-sub">Kode {row.code}{row.specification ? ` · ${row.specification}` : ''}</div>
                  </td>
                  <td>{categoryById.get(row.categoryId)?.name ?? '—'}</td>
                  <td>{row.unit}</td>
                  <td>{row.ageMonths == null ? <span className="sla-table-sub">Belum diisi</span> : `${row.ageMonths} bln`}</td>
                  <td className="alkes-cost-cell">{formatRupiah(row.bppAmount)}</td>
                  <td className="alkes-cost-cell">
                    {formatRupiah(monthly)}
                    {mismatch && <div className="sla-table-sub alkes-price-warning">BPP ÷ masa manfaat: {formatRupiah(mismatch.expected)}</div>}
                  </td>
                  <td>
                    <span className={`sla-status-badge ${row.isActive ? 'sla-status-active' : 'sla-status-archive'}`}>
                      {row.isActive ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  {canManage && (
                    <td>
                      <div className="sla-master-actions">
                        <button type="button" className="sla-btn" disabled={busy} onClick={() => startEdit(row)}>Edit</button>
                        <button type="button" className="sla-btn" disabled={busy || form?.id === row.id} onClick={() => toggleStatus(row)}>
                          {row.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
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

function autoTemplateName(form, types, assignments) {
  const typeName = types.find((item) => item.id === form?.vehicleTypeId)?.name || ''
  const assignmentName = assignments.find((item) => item.id === form?.assignmentId)?.name || ''
  const variant = String(form?.vehicleVariant || '').trim()
  if (!typeName || !assignmentName) return ''
  return [typeName, assignmentName, variant].filter(Boolean).join(' - ')
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

function TemplateSection({ templates, templateItems, types, assignments, equipment, categories, search, onSearch, canManage, busy, onSaveDraft, onSaveActive, onPublish, onArchive, onDuplicate, onExpand, onDirtyChange }) {
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
  const [openNotes, setOpenNotes] = useState(() => new Set())
  const [highlightKey, setHighlightKey] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [discardPrompt, setDiscardPrompt] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailTemplate, setDetailTemplate] = useState(null)
  const [detailItems, setDetailItems] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const editRequest = useRef(0)
  const detailRequest = useRef(0)
  const editPending = useRef(false)
  const qtyRefs = useRef(new Map())
  const discardRef = useRef(null)
  const typeRef = useRef(null)
  const assignmentRef = useRef(null)
  const catalogTriggerRef = useRef(null)
  const highlightTimer = useRef(null)
  const typeById = useMemo(() => new Map(types.map((item) => [item.id, item])), [types])
  const assignmentById = useMemo(() => new Map(assignments.map((item) => [item.id, item])), [assignments])
  const equipmentById = useMemo(() => new Map(equipment.map((item) => [item.id, item])), [equipment])
  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories])

  useEffect(() => () => {
    editRequest.current += 1
    detailRequest.current += 1
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
  }, [])

  useEffect(() => {
    if (!discardPrompt) return
    window.requestAnimationFrame(() => {
      discardRef.current?.scrollIntoView({ block: 'nearest' })
      discardRef.current?.querySelector('button')?.focus()
    })
  }, [discardPrompt])

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
  const formCost = useMemo(() => templateCostSummary(orderedRows.map((row) => ({
    monthlyCost: row.equipment?.monthlyCost,
    bppAmount: row.equipment?.bppAmount,
    ageMonths: row.equipment?.ageMonths,
    requiredQty: row.requiredQty,
  }))), [orderedRows])
  const rowMonthlyCost = (row) => effectiveMonthlyCost(row.equipment)
  const rowMonthlyMismatch = (row) => priceMismatch(row.equipment)
  const rowMonthlyTotal = (row) => {
    const unitCost = rowMonthlyCost(row)
    return unitCost == null ? null : unitCost * Number(row.requiredQty || 0)
  }

  const baselineRows = useMemo(() => {
    try {
      const parsed = JSON.parse(baseline || '{}')
      return new Map((parsed.rows ?? []).map((row) => [row.key, row]))
    } catch {
      return new Map()
    }
  }, [baseline])

  const dirty = Boolean(form && baseline && templateSnapshot(form) !== baseline)
  const activeEdit = templateMeta?.status === 'Aktif'

  useEffect(() => {
    onDirtyChange?.(dirty || editLoading)
  }, [dirty, editLoading, onDirtyChange])

  useEffect(() => {
    setPage(0)
  }, [search, statusFilter])

  const updateTemplateContext = (patch) => {
    setForm((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      return { ...next, templateName: autoTemplateName(next, types, assignments) }
    })
    setFieldErrors((prev) => {
      const next = { ...prev }
      Object.keys(patch).forEach((key) => {
        if (key === 'vehicleTypeId') delete next.vehicleTypeId
        if (key === 'assignmentId') delete next.assignmentId
        delete next.templateName
      })
      return next
    })
    setFormError('')
  }

  const allRowCount = orderedRows.length
  const categoryCount = worksheetGroups.length
  const statusText = busy || saveStatus === 'saving'
    ? 'Menyimpan...'
    : dirty
      ? 'Ada perubahan belum disimpan'
      : saveStatus === 'saved'
        ? (activeEdit ? 'Perubahan tersimpan' : 'Tersimpan')
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
    setOpenNotes(new Set())
    setHighlightKey('')
    setTemplateMeta(null)
    setSaveStatus('idle')
    setDiscardPrompt(false)
  }

  const closeForm = (force = false) => {
    if (busy || editPending.current) return
    if (dirty && !force) {
      setDiscardPrompt(true)
      return
    }
    resetForm()
  }

  const startCreate = () => {
    if (busy || editPending.current) return
    const next = emptyTemplateForm()
    setDiscardPrompt(false)
    setFieldErrors({})
    setRowErrors({})
    setItemsError('')
    setFormError('')
    setActionError('')
    setCatalogMessage('')
    setOpenNotes(new Set())
    setTemplateMeta(null)
    setSaveStatus('idle')
    setForm(next)
    setBaseline(templateSnapshot(next))
  }

  const startEdit = async (template) => {
    if (busy || editPending.current) return
    setFieldErrors({})
    setRowErrors({})
    setItemsError('')
    setFormError('')
    setActionError('')
    setCatalogMessage('')
    setDiscardPrompt(false)
    const request = ++editRequest.current
    editPending.current = true
    setEditLoading(true)
    try {
      const items = await onExpand(template.id)
      if (request !== editRequest.current) return
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
      if (template.status !== 'Aktif') {
        next.templateName = autoTemplateName(next, types, assignments) || template.templateName
      }
      setForm(next)
      setBaseline(templateSnapshot(next))
      setOpenNotes(new Set(items.map((item, index) => (item.note ? `r${index}` : null)).filter(Boolean)))
      setTemplateMeta({
        templateCode: template.templateCode,
        versionNumber: template.versionNumber,
        status: template.status,
        revision: template.revision,
      })
      setSaveStatus('idle')
    } catch (loadError) {
      if (request === editRequest.current) setActionError(loadError.message || 'Rincian template gagal dimuat.')
    } finally {
      if (request === editRequest.current) {
        editPending.current = false
        setEditLoading(false)
      }
    }
  }

  const addEquipment = (equipmentItem) => {
    if (!form || !equipmentItem || busy) return
    const existing = form.rows.find((row) => row.equipmentId === equipmentItem.id)
    if (existing) {
      setCatalogMessage('Alat sudah ada di daftar. Baris yang ada ditandai.')
      highlightRow(existing.key)
      return
    }
    const key = `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    setForm((prev) => ({
      ...prev,
      rows: [...prev.rows, { key, equipmentId: equipmentItem.id, requiredQty: '1', note: '' }],
    }))
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
    else window.requestAnimationFrame(() => catalogTriggerRef.current?.focus())
  }

  const submitDraft = async () => {
    if (!form || busy || editPending.current || saveStatus === 'saving') return
    setDiscardPrompt(false)
    const nextFieldErrors = {}
    const nextRowErrors = {}
    if (!form.vehicleTypeId) nextFieldErrors.vehicleTypeId = 'Jenis kendaraan wajib dipilih.'
    if (!form.assignmentId) nextFieldErrors.assignmentId = 'Penugasan wajib dipilih.'
    if (!form.templateName.trim()) nextFieldErrors.templateName = 'Nama template dibentuk otomatis setelah jenis dan penugasan dipilih.'
    for (const row of orderedRows) {
      if (!row.equipment) {
        nextRowErrors[row.key] = 'Alat tidak ditemukan.'
        continue
      }
      const raw = String(row.requiredQty ?? '').trim()
      if (raw === '') nextRowErrors[row.key] = 'Jumlah wajib diisi.'
      else if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 2147483647) nextRowErrors[row.key] = 'Gunakan bilangan bulat 0 sampai 2147483647.'
      else if (activeEdit && Number(raw) <= 0) nextRowErrors[row.key] = 'Jumlah Kebutuhan harus lebih dari 0.'
    }
    setFieldErrors(nextFieldErrors)
    setRowErrors(nextRowErrors)
    setFormError('')
    setItemsError(orderedRows.length ? '' : 'Tambahkan minimal satu alat dari katalog.')
    if (orderedRows.length === 0) {
      setCatalogMessage('Pilih alat dari katalog untuk memulai.')
      window.requestAnimationFrame(() => catalogTriggerRef.current?.focus())
      return
    }
    if (Object.keys(nextFieldErrors).length) {
      window.requestAnimationFrame(() => {
        if (nextFieldErrors.vehicleTypeId) typeRef.current?.focus()
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
      const description = form.description.trim()
      const items = orderedRows.map((row) => ({
        equipmentId: row.equipmentId,
        requiredQty: Number(row.requiredQty),
        note: row.note.trim(),
      }))
      const saved = activeEdit
        ? await onSaveActive({
            id: form.id,
            expectedRevision: templateMeta.revision,
            description,
            items,
          })
        : await onSaveDraft({
            id: form.id,
            templateName: form.templateName.trim(),
            vehicleTypeId: form.vehicleTypeId,
            assignmentId: form.assignmentId,
            vehicleVariant: form.vehicleVariant.trim(),
            effectiveFrom: form.effectiveFrom || null,
            description,
            items,
          })
      const nextForm = {
        ...form,
        id: saved.id,
        templateName: form.templateName.trim(),
        vehicleVariant: form.vehicleVariant.trim(),
        description,
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
        revision: saved.revision,
      })
      setSaveStatus('saved')
      setFieldErrors({})
      setRowErrors({})
      setItemsError('')
    } catch (saveError) {
      const message = saveError.code === '40001'
        ? 'Template telah diubah pengguna lain. Tutup form lalu buka kembali untuk memuat data terbaru.'
        : saveError.message || (activeEdit ? 'Template gagal diperbarui.' : 'Template gagal disimpan.')
      setFormError(message)
      setSaveStatus('dirty')
    }
  }

  const handlePublish = async (template) => {
    setActionError('')
    if (form?.id === template.id && dirty) {
      const warning = 'Simpan draft template terlebih dahulu sebelum menerbitkan versi ini.'
      setActionError(warning)
      setFormError(warning)
      return
    }
    if (!window.confirm(`Terbitkan "${template.templateName}" v${template.versionNumber} sebagai Aktif?`)) return
    try {
      await onPublish(template)
      if (form?.id === template.id) resetForm()
    } catch (publishError) {
      const message = publishError.message || 'Template gagal diterbitkan.'
      setActionError(message)
      if (form?.id === template.id) setFormError(message)
    }
  }

  const publishCurrentDraft = () => {
    if (!form?.id) return
    setDiscardPrompt(false)
    const invalid = orderedRows.find((row) => {
      const raw = String(row.requiredQty ?? '').trim()
      return !/^\d+$/.test(raw) || Number(raw) <= 0
    })
    if (invalid) {
      setFormError('Semua Jumlah Kebutuhan harus lebih dari 0 sebelum template diterbitkan.')
      focusRow(invalid.key)
      return
    }
    setFormError('')
    const draft = templates.find((template) => template.id === form.id)
    if (draft && draft.templateName !== form.templateName.trim()) {
      setFormError('Simpan draft terlebih dahulu agar nama template otomatis diterapkan sebelum diterbitkan.')
      return
    }
    if (draft) handlePublish(draft)
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

  const openDetail = async (template) => {
    const request = ++detailRequest.current
    setDetailOpen(true)
    setDetailTemplate(template)
    setDetailItems(templateItems[template.id] || [])
    setDetailError('')
    setDetailLoading(!templateItems[template.id])
    try {
      const items = await onExpand(template.id)
      if (request !== detailRequest.current) return
      setDetailItems(items)
    } catch (loadError) {
      if (request === detailRequest.current) setDetailError(loadError.message || 'Rincian template gagal dimuat.')
    } finally {
      if (request === detailRequest.current) setDetailLoading(false)
    }
  }

  const closeDetail = () => {
    detailRequest.current += 1
    setDetailOpen(false)
    setDetailTemplate(null)
    setDetailItems([])
    setDetailError('')
    setDetailLoading(false)
  }

  const editFromDetail = () => {
    const template = detailTemplate
    closeDetail()
    if (template) startEdit(template)
  }

  return (
    <fieldset className="alkes-section alkes-controls" disabled={busy || editLoading} aria-busy={busy || editLoading}>
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Template Kebutuhan Peralatan</h2>
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
            <button type="button" className="sla-btn sla-btn-primary" disabled={busy || Boolean(form)} onClick={startCreate}>
              Buat Template
            </button>
          )}
        </div>
      </div>
      <p className="sla-flat-note">Buat satu daftar alat untuk setiap jenis kendaraan dan penugasan. Template Aktif dapat diperbarui tanpa mengubah laporan yang sudah tersimpan.</p>
      {editLoading && <p className="sla-table-hint" role="status">Memuat isi template...</p>}
      {actionError && <p className="sla-blocked-note">{actionError}</p>}
      {form && canManage && (
        <AlkesModal
          open
          onClose={() => closeForm()}
          eyebrow={form.id ? (activeEdit ? 'EDIT TEMPLATE AKTIF' : 'EDIT DRAFT TEMPLATE') : 'TEMPLATE KEBUTUHAN BARU'}
          title={form.id ? (activeEdit ? 'Edit Template Aktif' : 'Edit Draft Template') : 'Buat Template Kebutuhan'}
          subtitle={activeEdit
            ? 'Perbarui kebutuhan alat. Laporan yang sudah tersimpan tetap memakai data saat laporan dibuat.'
            : 'Tentukan konteks kendaraan, lalu isi jumlah kebutuhan alat langsung pada tabel.'}
          meta={templateMeta && (
            <>
              <span>{templateMeta.templateCode}</span>
              <span>Versi {templateMeta.versionNumber}</span>
              <span className={`sla-status-badge ${STATUS_BADGE[templateMeta.status] || 'sla-status-draft'}`}>{templateMeta.status}</span>
            </>
          )}
          size="wide"
          className="alkes-template-form-modal"
          dismissDisabled={busy || saveStatus === 'saving'}
        >
          <div className="alkes-modal-form">
          <section className="alkes-modal-section">
            <div className="alkes-modal-section-head">
              <div>
                <h3>Informasi Template</h3>
                <p>{activeEdit ? 'Isi kebutuhan dapat diperbarui; identitas kendaraan tetap.' : 'Standar ini berlaku untuk satu jenis kendaraan dan penugasan.'}</p>
              </div>
            </div>
          <div className="sla-sign-group-head">
            <div className="sla-context-field">
              <label htmlFor="template-type" className="sla-context-label">Jenis Kendaraan *</label>
              <select id="template-type" data-autofocus={activeEdit ? undefined : ''} ref={typeRef} className="sla-context-select" value={form.vehicleTypeId} disabled={busy || activeEdit} onChange={(event) => updateTemplateContext({ vehicleTypeId: event.target.value })} aria-invalid={Boolean(fieldErrors.vehicleTypeId)}>
                <option value="">Pilih jenis</option>
                {types.filter((item) => item.isActive || item.id === form.vehicleTypeId).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{!item.isActive ? ' (Nonaktif)' : ''}</option>
                ))}
              </select>
              {fieldErrors.vehicleTypeId && <p className="alkes-field-error">{fieldErrors.vehicleTypeId}</p>}
            </div>
            <div className="sla-context-field">
              <label htmlFor="template-assignment" className="sla-context-label">Penugasan *</label>
              <select id="template-assignment" ref={assignmentRef} className="sla-context-select" value={form.assignmentId} disabled={busy || activeEdit} onChange={(event) => updateTemplateContext({ assignmentId: event.target.value })} aria-invalid={Boolean(fieldErrors.assignmentId)}>
                <option value="">Pilih penugasan</option>
                {assignments.filter((item) => item.isActive || item.id === form.assignmentId).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{!item.isActive ? ' (Nonaktif)' : ''}</option>
                ))}
              </select>
              {fieldErrors.assignmentId && <p className="alkes-field-error">{fieldErrors.assignmentId}</p>}
            </div>
            <div className="sla-context-field">
              <label htmlFor="template-variant" className="sla-context-label">Varian/Model (opsional)</label>
              <input id="template-variant" className="sla-input sla-input-text" value={form.vehicleVariant} disabled={busy || activeEdit} onChange={(event) => updateTemplateContext({ vehicleVariant: event.target.value })} placeholder="cth: Terios (kosongkan bila umum)" />
            </div>
            <div className="sla-context-field alkes-field-wide">
              <label htmlFor="template-name" className="sla-context-label">Nama Template (otomatis)</label>
              <output id="template-name" className={`alkes-derived-name${form.templateName ? '' : ' is-placeholder'}`} aria-live="polite">
                {form.templateName || 'Nama otomatis setelah jenis kendaraan dan penugasan dipilih'}
              </output>
              {fieldErrors.templateName && <p className="alkes-field-error">{fieldErrors.templateName}</p>}
            </div>
            <div className="sla-context-field">
              <label htmlFor="template-effective" className="sla-context-label">Tanggal Berlaku</label>
              <input id="template-effective" type="date" className="sla-context-select" value={form.effectiveFrom} disabled={busy || activeEdit} onChange={(event) => setForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))} />
            </div>
          </div>
          {activeEdit && (
            <p className="sla-table-hint">
              Jenis kendaraan, penugasan, varian, dan tanggal berlaku dikunci agar acuan kendaraan dan laporan yang sudah tersimpan tetap konsisten.
            </p>
          )}
          <details className="alkes-advanced">
            <summary>Informasi tambahan</summary>
            <div className="sla-sign-group-head">
              <div className="sla-context-field alkes-field-wide">
                <label htmlFor="template-description" className="sla-context-label">Deskripsi</label>
                <input id="template-description" className="sla-input sla-input-text" value={form.description} disabled={busy} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
              </div>
            </div>
          </details>
          </section>
          <section className="alkes-modal-section">
          <div className="alkes-modal-section-head">
            <div>
              <h3>Daftar Kebutuhan</h3>
              <p>Biaya per baris dihitung dari Cost/Bulan per unit × Jumlah Kebutuhan.</p>
            </div>
            <span className="sla-table-hint">
              {allRowCount} jenis · {categoryCount} kategori · {formCost.incomplete
                ? `${formCost.incomplete} harga belum lengkap`
                : `${formatRupiah(formCost.total)}/bulan`}
            </span>
          </div>
            <div className="alkes-catalog-toolbar alkes-catalog-toolbar--single">
              <CatalogPicker
                equipment={equipment}
                categories={categories}
                existingIds={form.rows.map((row) => row.equipmentId)}
                disabled={busy}
                onSelect={addEquipment}
                triggerRef={catalogTriggerRef}
              />
            </div>
          {catalogMessage && <p className="sla-table-hint" role="status">{catalogMessage}</p>}
          {itemsError && <p className="alkes-field-error">{itemsError}</p>}
          <div className="alkes-worksheet-scroll">
            <table className="alkes-worksheet-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Nama Peralatan</th>
                  <th>Satuan</th>
                  <th>Jumlah Kebutuhan</th>
                  <th>Biaya/Unit/Bln</th>
                  <th>Total/Bln</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {!orderedRows.length && (
                  <tr>
                    <td colSpan={7} className="alkes-empty-state">
                      Belum ada alat. Pilih alat dari katalog di atas untuk memulai.
                    </td>
                  </tr>
                )}
                {worksheetGroups.map((group) => {
                  const groupCost = templateCostSummary(group.rows.map((row) => ({
                    monthlyCost: row.equipment?.monthlyCost,
                    bppAmount: row.equipment?.bppAmount,
                    ageMonths: row.equipment?.ageMonths,
                    requiredQty: row.requiredQty,
                  })))
                  return (
                    <Fragment key={group.key}>
                      <tr className="alkes-group-row">
                        <td colSpan={7}>
                          {group.name}
                          <span className="alkes-group-count">
                            {group.rows.length} jenis · {groupCost.incomplete ? 'harga belum lengkap' : `${formatRupiah(groupCost.total)}/bln`}
                          </span>
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
                                data-autofocus={activeEdit && rowNumbers.get(row.key) === 1 ? '' : undefined}
                                inputMode="numeric"
                                value={row.requiredQty}
                                disabled={busy}
                                onChange={(event) => updateRow(row.key, { requiredQty: event.target.value })}
                                onKeyDown={(event) => handleQtyKeyDown(event, row.key)}
                                aria-invalid={Boolean(rowErrors[row.key])}
                                aria-describedby={rowErrors[row.key] ? `qty-error-${row.key}` : undefined}
                                aria-label={`Jumlah Kebutuhan ${row.equipment?.name ?? ''}`}
                              />
                              {rowErrors[row.key] && <p className="alkes-field-error">{rowErrors[row.key]}</p>}
                            </td>
                            <td className="alkes-cost-cell">
                              {formatRupiah(rowMonthlyCost(row))}
                              {rowMonthlyMismatch(row) && (
                                <div className="sla-table-sub alkes-price-warning">BPP ÷ masa manfaat: {formatRupiah(rowMonthlyMismatch(row).expected)}</div>
                              )}
                            </td>
                            <td className="alkes-cost-cell">{formatRupiah(rowMonthlyTotal(row))}</td>
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
                              <td colSpan={6}>
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
                  )
                })}
              </tbody>
            </table>
          </div>
          </section>
          {formError && <p className="alkes-modal-alert" role="alert">{formError}</p>}
          {discardPrompt && (
            <div ref={discardRef} className="alkes-modal-discard" role="alert">
              <div>
                <strong>{activeEdit ? 'Perubahan belum disimpan' : 'Draft belum disimpan'}</strong>
                <span>Perubahan terbaru akan hilang jika modal ditutup sekarang.</span>
              </div>
              <div className="alkes-modal-actions">
                <button type="button" className="sla-btn" disabled={busy || saveStatus === 'saving'} onClick={() => setDiscardPrompt(false)}>Tetap Mengedit</button>
                <button type="button" className="sla-btn sla-btn-primary" disabled={busy || saveStatus === 'saving'} onClick={() => closeForm(true)}>Tutup Tanpa Menyimpan</button>
              </div>
            </div>
          )}
          <div className="alkes-savebar">
            <span className={`alkes-save-status ${dirty ? 'is-dirty' : saveStatus === 'saved' ? 'is-saved' : ''}`}>{statusText}</span>
            <div className="alkes-save-actions">
              <button type="button" className="sla-btn sla-btn-primary" disabled={busy || saveStatus === 'saving' || (activeEdit && !dirty)} onClick={submitDraft}>
                {busy || saveStatus === 'saving' ? 'Menyimpan...' : activeEdit ? 'Simpan Perubahan' : 'Simpan Draft'}
              </button>
              {form.id && !activeEdit && <button type="button" className="sla-btn" disabled={busy || dirty || saveStatus === 'saving'} onClick={publishCurrentDraft}>Terbitkan Template</button>}
              <button type="button" className="sla-btn" disabled={busy} onClick={() => closeForm()}>Batal</button>
            </div>
          </div>
          </div>
        </AlkesModal>
      )}
      <div className="sla-preview-scroll">
        <table className="sla-preview-table alkes-table alkes-table--wide">
          <thead>
            <tr>
              <th>Template</th>
              <th>Jenis / Penugasan</th>
              <th title="Biaya standar dari snapshot harga saat template disimpan atau diterbitkan">Biaya/Bulan</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {!filtered.length && (
              <tr><td colSpan={5}>{emptyMessage}</td></tr>
            )}
            {pageRows.map((template) => (
                <tr key={template.id}>
                  <td>
                    <strong>{template.templateName}</strong>
                    <div className="sla-table-sub">{template.templateCode} / Versi {template.versionNumber}</div>
                    <div className="sla-table-sub">
                      {template.vehicleVariant ? `Varian: ${template.vehicleVariant} · ` : ''}Berlaku: {template.effectiveFrom || '—'}
                    </div>
                  </td>
                  <td>{typeById.get(template.vehicleTypeId)?.name ?? '—'} / {assignmentById.get(template.assignmentId)?.name ?? '—'}</td>
                  <td className="alkes-cost-cell">
                    {template.costSummary ? `${formatRupiah(template.costSummary.totalMonthlyCost)}/bln` : '—'}
                    {template.costSummary?.incompleteItems > 0 && (
                      <div className="sla-table-sub alkes-price-warning">{template.costSummary.incompleteItems} harga belum lengkap</div>
                    )}
                  </td>
                  <td>
                    <span className={`sla-status-badge ${STATUS_BADGE[template.status] ?? 'sla-status-draft'}`}>
                      {template.status}
                    </span>
                  </td>
                  <td>
                    <div className="sla-master-actions">
                      <button type="button" className="sla-btn" disabled={busy} onClick={() => openDetail(template)}>Lihat</button>
                      {canManage && template.status === 'Aktif' && (
                        <button type="button" className="sla-btn" disabled={busy} onClick={() => startEdit(template)}>Edit</button>
                      )}
                      {canManage && template.status === 'Draft' && (
                        <>
                          <button type="button" className="sla-btn" disabled={busy} onClick={() => startEdit(template)}>Edit</button>
                          <button type="button" className="sla-btn sla-btn-primary" disabled={busy} onClick={() => handlePublish(template)}>Terbitkan</button>
                        </>
                      )}
                      {canManage && template.status !== 'Draft' && (
                        <button type="button" className="sla-btn" disabled={busy} onClick={() => handleDuplicate(template)}>Duplikasi</button>
                      )}
                      {canManage && template.status === 'Aktif' && (
                        <button type="button" className="sla-btn" disabled={busy} onClick={() => handleArchive(template)}>Arsipkan</button>
                      )}
                    </div>
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPagination total={filtered.length} page={safePage} onChange={setPage} itemLabel="template" />
      <TemplateDetailModal
        open={detailOpen}
        template={detailTemplate}
        items={detailItems}
        loading={detailLoading}
        error={detailError}
        busy={busy}
        canManage={canManage}
        equipmentById={equipmentById}
        categoryById={categoryById}
        typeById={typeById}
        assignmentById={assignmentById}
        onClose={closeDetail}
        onEdit={editFromDetail}
        onRetry={() => { if (detailTemplate) openDetail(detailTemplate) }}
      />
    </fieldset>
  )
}

export default function AlatKendaraanMaster({ contractUuid, up3Uuid, canManage, units = [], onEditorStateChange }) {
  const [tab, setTab] = useState('template')
  const [tabDirty, setTabDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [supportingBusy, setSupportingBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [types, setTypes] = useState([])
  const [assignments, setAssignments] = useState([])
  const [categories, setCategories] = useState([])
  const [equipment, setEquipment] = useState([])
  const [templates, setTemplates] = useState([])
  const [templateItems, setTemplateItems] = useState({})
  const mutationPending = useRef(false)
  const loadRequest = useRef(0)
  const lastCatalogTab = useRef('peralatan')

  useEffect(() => {
    onEditorStateChange?.({ dirty: tabDirty, busy: busy || supportingBusy })
    return () => onEditorStateChange?.({ dirty: false, busy: false })
  }, [tabDirty, busy, supportingBusy, onEditorStateChange])

  const scopeReady = Boolean(contractUuid && up3Uuid)

  const reload = async ({ silent = false } = {}) => {
    const request = ++loadRequest.current
    if (!scopeReady) {
      if (!silent) setLoading(false)
      return
    }
    if (!silent) {
      setLoading(true)
      setLoadError('')
    }
    try {
      const [typeRows, assignmentRows, categoryRows, equipmentRows, templateRows, costRows] = await Promise.all([
        listOpsMasters('vehicle_type', { contractId: contractUuid, up3Id: up3Uuid }),
        listOpsMasters('assignment', { contractId: contractUuid, up3Id: up3Uuid }),
        listOpsMasters('category', { contractId: contractUuid, up3Id: up3Uuid }),
        listOpsEquipment({ contractId: contractUuid, up3Id: up3Uuid }),
        listOpsTemplates({ contractId: contractUuid, up3Id: up3Uuid }),
        listOpsTemplateCosts({ contractId: contractUuid, up3Id: up3Uuid }),
      ])
      if (request !== loadRequest.current) return
      const costByTemplate = new Map(costRows.map((row) => [row.templateId, row]))
      setTypes(typeRows)
      setAssignments(assignmentRows)
      setCategories(categoryRows)
      setEquipment(equipmentRows)
      setTemplates(templateRows.map((template) => ({
        ...template,
        costSummary: costByTemplate.get(template.id) ?? null,
      })))
      setTemplateItems({})
    } catch (error) {
      if (request !== loadRequest.current) return
      if (silent) setNotice(error.message || 'Master data gagal dimuat ulang.')
      else setLoadError(error.message || 'Master data gagal dimuat.')
    } finally {
      if (!silent && request === loadRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    return () => { loadRequest.current += 1 }
  }, [contractUuid, up3Uuid])

  useEffect(() => {
    if (!tabDirty && !busy && !supportingBusy) return undefined
    const handler = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [tabDirty, busy, supportingBusy])

  const mutate = async (work) => {
    if (mutationPending.current) throw new Error('Penyimpanan masih berlangsung.')
    mutationPending.current = true
    setBusy(true)
    setNotice('')
    try {
      const result = await work()
      await reload({ silent: true })
      return result
    } finally {
      mutationPending.current = false
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
    ageMonths: parseEquipmentAge(form.ageMonths).value,
    bppAmount: parseRupiahAmount(form.bppAmount).value,
    monthlyCost: parseRupiahAmount(form.monthlyCost).value,
    specification: form.specification, description: form.description, isActive: form.isActive,
  }).then(() => setNotice('Peralatan tersimpan.')))

  const handleToggleEquipment = (row) => mutate(() => saveOpsEquipment({
    id: row.id, contractId: contractUuid, up3Id: up3Uuid,
    code: row.code, name: row.name, categoryId: row.categoryId, unit: row.unit,
    ageMonths: row.ageMonths,
    bppAmount: row.bppAmount,
    monthlyCost: row.monthlyCost,
    specification: row.specification ?? '', description: row.description ?? '', isActive: !row.isActive,
  }).then(() => setNotice(`"${row.name}" ${row.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`)))

  const handleImportEquipment = (rows) => mutate(() => importOpsEquipment({
    contractId: contractUuid, up3Id: up3Uuid, rows,
  }).then((result) => {
    setNotice(`Impor peralatan selesai: ${result.inserted ?? 0} baru, ${result.updated ?? 0} diperbarui, ${result.skipped ?? 0} dilewati.`)
    return result
  }))

  const handleExpandTemplate = async (templateId) => {
    if (templateItems[templateId]) return templateItems[templateId]
    const request = loadRequest.current
    const published = templates.some((template) => template.id === templateId && template.status !== 'Draft')
    const items = await listOpsTemplateItems(templateId, equipment, published)
    if (request === loadRequest.current) setTemplateItems((prev) => ({ ...prev, [templateId]: items }))
    return items
  }

  const handlePublish = async (template) => {
    await mutate(() => publishOpsTemplate(template.id).then(() => setNotice('Template diterbitkan. Lanjutkan ke Penetapan Kendaraan untuk menentukan ULP tujuan.')))
  }

  const handleArchive = async (template) => {
    await mutate(() => archiveOpsTemplate(template.id).then(() => setNotice('Template diarsipkan.')))
  }

  const handleDuplicate = async (template) => {
    await mutate(() => duplicateOpsTemplate(template.id).then(() => setNotice('Draft versi baru dibuat dari template ini.')))
  }

  const switchTab = (nextTab) => {
    if (mutationPending.current || supportingBusy) return
    if (nextTab === tab) {
      setSearch('')
      setNotice('')
      return
    }
    if (tabDirty && !window.confirm('Perubahan pada tab ini belum disimpan. Pindah tab?')) return
    if (CATALOG_TAB_IDS.has(nextTab)) lastCatalogTab.current = nextTab
    setTab(nextTab)
    setTabDirty(false)
    setSearch('')
    setNotice('')
  }

  const switchPrimaryTab = (nextTab) => {
    switchTab(nextTab === 'katalog' ? lastCatalogTab.current : nextTab)
  }

  const catalogActive = CATALOG_TAB_IDS.has(tab)
  const activeCatalogTab = catalogActive ? CATALOG_TABS.find((item) => item.id === tab) : null

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
        Satu template alat mengikuti jenis kendaraan dan penugasannya,
        untuk scope organisasi yang dipilih. UP3 menetapkan kendaraan; ULP melengkapi nomor kendaraan dan kondisi alatnya.
        {!canManage && ' Akun ini hanya dapat melihat (read-only).'}
      </p>
      {loading ? (
        <p className="sla-table-hint">Memuat master data...</p>
      ) : loadError ? (
        <p className="sla-blocked-note">{loadError} <button type="button" className="sla-btn" onClick={() => reload()}>Coba lagi</button></p>
      ) : (
        <>
          <nav className="alkes-primary-nav" aria-label="Bagian master data">
            <div className="alkes-primary-tabs">
              {TABS.map((item) => {
                const active = item.id === 'katalog' ? catalogActive : tab === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busy || supportingBusy}
                    className={`alkes-primary-tab${active ? ' is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => switchPrimaryTab(item.id)}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          </nav>
          {catalogActive && (
            <nav className="alkes-catalog-nav" aria-label="Katalog dan data pendukung">
              <div className="alkes-catalog-tabs">
                {CATALOG_TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busy || supportingBusy}
                    className={`alkes-catalog-tab${tab === item.id ? ' is-active' : ''}`}
                    aria-current={tab === item.id ? 'page' : undefined}
                    onClick={() => switchTab(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="alkes-catalog-note">
                <strong>{activeCatalogTab?.label}</strong> {CATALOG_NOTES[tab]}
              </p>
            </nav>
          )}
          {notice && <p className="sla-export-note">{notice}</p>}
          {tab === 'penetapan' && <PrescribedFleetAdmin contractUuid={contractUuid} up3Uuid={up3Uuid} templates={templates} types={types} assignments={assignments} units={units} canManage={canManage} onDirtyChange={setTabDirty} onBusyChange={setSupportingBusy} />}
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
              onImport={handleImportEquipment}
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
              onSaveActive={(payload) => mutate(() => updateOpsActiveTemplate({ contractId: contractUuid, up3Id: up3Uuid, ...payload })
                .then((saved) => {
                  setNotice('Perubahan template aktif tersimpan.')
                  return saved
                })
                .catch(async (error) => {
                  await reload({ silent: true })
                  throw error
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
