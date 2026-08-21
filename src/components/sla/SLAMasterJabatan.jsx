import { useState } from 'react'
import { jabatanOfScope } from '../../data/jabatanPelayananTeknik.js'

const inputClass = 'sla-input sla-input-text'

export default function SLAMasterJabatan({
  contractScope,
  up3Id,
  jabatan,
  onJabatanChange,
}) {
  const [form, setForm] = useState({ name: '', keterangan: '', status: 'Aktif' })
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const scopedJabatan = jabatanOfScope(jabatan, contractScope.contractId, up3Id)

  const inScope = (item) =>
    item.contractId === contractScope.contractId && item.up3Id === up3Id

  const resetForm = () => setForm({ name: '', keterangan: '', status: 'Aktif' })

  const startAdd = () => {
    setEditingId(null)
    resetForm()
    setAdding(true)
  }

  const startEdit = (item) => {
    setAdding(false)
    setEditingId(item.id)
    setForm({ name: item.name, keterangan: item.keterangan ?? '', status: item.status })
  }

  const cancel = () => {
    setAdding(false)
    setEditingId(null)
    resetForm()
  }

  const submit = () => {
    const name = form.name.trim()
    if (!name) return
    if (editingId) {
      const target = jabatan.find((item) => item.id === editingId && inScope(item))
      if (!target) return
      onJabatanChange(
        jabatan.map((item) =>
          item.id === editingId && inScope(item)
            ? { ...item, name, keterangan: form.keterangan.trim() }
            : item,
        ),
      )
    } else {
      const maxOrder = scopedJabatan.reduce(
        (max, item) => Math.max(max, item.order ?? 0),
        0,
      )
      onJabatanChange([
        ...jabatan,
        {
          id: `jab-${Date.now().toString(36)}`,
          contractId: contractScope.contractId,
          up3Id,
          name,
          keterangan: form.keterangan.trim(),
          status: form.status,
          order: maxOrder + 1,
        },
      ])
    }
    cancel()
  }

  const toggleStatus = (item) => {
    if (!inScope(item)) return
    onJabatanChange(
      jabatan.map((entry) =>
        entry.id === item.id && inScope(entry)
          ? { ...entry, status: entry.status === 'Aktif' ? 'Nonaktif' : 'Aktif' }
          : entry,
      ),
    )
  }

  return (
    <section className="sla-settings">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Master Jabatan</h2>
        <button
          type="button"
          className="sla-btn sla-btn-primary"
          onClick={() => (adding ? cancel() : startAdd())}
        >
          {adding ? 'Batal' : 'Tambah Jabatan'}
        </button>
        <span className="sla-status-badge sla-status-draft">Prototype</span>
      </div>
      <p className="sla-flat-note">
        Jabatan dinamis untuk kontrak {contractScope.contractName}. Daftar ini
        akan direferensikan oleh Master Pegawai pada tahap berikutnya; form
        pegawai tidak memakai hardcode jabatan. Perubahan hanya disimpan di state
        lokal (prototype).
      </p>

      {(adding || editingId) && (
        <div className="sla-sign-group">
          <div className="sla-sign-group-head">
            <div className="sla-context-field">
              <span className="sla-context-label">Nama jabatan</span>
              <input
                className={inputClass}
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Keterangan</span>
              <input
                className={inputClass}
                value={form.keterangan}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, keterangan: event.target.value }))
                }
              />
            </div>
            {adding && (
              <div className="sla-context-field">
                <span className="sla-context-label">Status</span>
                <select
                  className="sla-context-select"
                  value={form.status}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, status: event.target.value }))
                  }
                >
                  <option value="Aktif">Aktif</option>
                  <option value="Nonaktif">Nonaktif</option>
                </select>
              </div>
            )}
            <div className="sla-master-actions">
              <button type="button" className="sla-btn sla-btn-primary" onClick={submit}>
                {editingId ? 'Simpan Perubahan' : 'Simpan Jabatan'}
              </button>
              <button type="button" className="sla-btn" onClick={cancel}>
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="sla-preview-scroll">
        <table className="sla-preview-table">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Keterangan</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {scopedJabatan.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.name}
                  <div className="sla-table-sub">ID tetap: {item.id}</div>
                </td>
                <td>{item.keterangan || '\u2014'}</td>
                <td>
                  <span
                    className={`sla-status-badge ${item.status === 'Aktif' ? 'sla-status-active' : 'sla-status-archive'}`}
                  >
                    {item.status}
                  </span>
                </td>
                <td>
                  <div className="sla-master-actions">
                    <button type="button" className="sla-btn" onClick={() => startEdit(item)}>
                      Edit
                    </button>
                    <button type="button" className="sla-btn" onClick={() => toggleStatus(item)}>
                      {item.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}