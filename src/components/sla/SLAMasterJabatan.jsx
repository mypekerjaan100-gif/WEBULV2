import { useState } from 'react'
import { jabatanOfScope } from '../../data/jabatanPelayananTeknik.js'
import { savePositionToSupabase } from '../../data/employeeRepository.js'

const inputClass = 'sla-input sla-input-text'
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isDatabaseRow = (item) => Boolean(item?.fromSupabase) || UUID_LIKE.test(item?.id ?? '')

export default function SLAMasterJabatan({
  contractScope,
  up3Id,
  contractUuid = null,
  up3Uuid = null,
  jabatan,
  onJabatanChange,
  onRefreshPositions = null,
}) {
  const [form, setForm] = useState({ name: '', keterangan: '', status: 'Aktif' })
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const localScoped = jabatanOfScope(jabatan, contractScope.contractId, up3Id)
  // Baris database memakai UUID scope sehingga tidak lolos filter string
  // lokal; tampilkan yang berada pada scope kontrak/UP3 aktif.
  const databaseScoped = (jabatan ?? [])
    .filter(
      (item) =>
        isDatabaseRow(item) &&
        item.contractId === contractUuid &&
        (item.up3Id == null || item.up3Id === up3Uuid),
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name < b.name ? -1 : 1))
  const scopedJabatan = [...databaseScoped, ...localScoped.filter((item) => !isDatabaseRow(item))]

  const inScope = (item) =>
    isDatabaseRow(item)
      ? item.contractId === contractUuid && (item.up3Id == null || item.up3Id === up3Uuid)
      : item.contractId === contractScope.contractId && item.up3Id === up3Id

  const resetForm = () => setForm({ name: '', keterangan: '', status: 'Aktif' })

  const startAdd = () => {
    setEditingId(null)
    resetForm()
    setSaveError('')
    setAdding(true)
  }

  const startEdit = (item) => {
    setAdding(false)
    setEditingId(item.id)
    setSaveError('')
    setForm({ name: item.name, keterangan: item.keterangan ?? '', status: item.status })
  }

  const cancel = () => {
    setAdding(false)
    setEditingId(null)
    setSaveError('')
    resetForm()
  }

  const persistDatabaseRow = async ({ id = null, name, keterangan, status }) => {
    if (!contractUuid || !up3Uuid) {
      throw new Error('Scope organisasi belum siap. Muat ulang halaman lalu coba lagi.')
    }
    await savePositionToSupabase({
      id,
      contractId: contractUuid,
      up3Id: up3Uuid,
      name,
      description: keterangan,
      status,
    })
    if (onRefreshPositions) await onRefreshPositions()
  }

  const submit = async () => {
    const name = form.name.trim()
    if (!name || saving) return
    if (editingId) {
      const target = jabatan.find((item) => item.id === editingId && inScope(item))
      if (!target) return
      if (!isDatabaseRow(target)) {
        onJabatanChange(
          jabatan.map((item) =>
            item.id === editingId && inScope(item)
              ? { ...item, name, keterangan: form.keterangan.trim() }
              : item,
          ),
        )
        cancel()
        return
      }
      setSaving(true)
      setSaveError('')
      try {
        await persistDatabaseRow({
          id: target.id,
          name,
          keterangan: form.keterangan.trim(),
          status: target.status,
        })
        cancel()
      } catch (error) {
        setSaveError(error.message || 'Jabatan gagal disimpan.')
      } finally {
        setSaving(false)
      }
      return
    }
    // Tambah baru selalu tersimpan ke database agar terlihat semua akun.
    setSaving(true)
    setSaveError('')
    try {
      await persistDatabaseRow({
        id: null,
        name,
        keterangan: form.keterangan.trim(),
        status: form.status,
      })
      cancel()
    } catch (error) {
      setSaveError(error.message || 'Jabatan gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (item) => {
    if (!inScope(item) || saving) return
    if (!isDatabaseRow(item)) {
      onJabatanChange(
        jabatan.map((entry) =>
          entry.id === item.id && inScope(entry)
            ? { ...entry, status: entry.status === 'Aktif' ? 'Nonaktif' : 'Aktif' }
            : entry,
        ),
      )
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      await persistDatabaseRow({
        id: item.id,
        name: item.name,
        keterangan: item.keterangan ?? '',
        status: item.status === 'Aktif' ? 'Nonaktif' : 'Aktif',
      })
    } catch (error) {
      setSaveError(error.message || 'Status jabatan gagal diubah.')
    } finally {
      setSaving(false)
    }
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
      </div>
      <p className="sla-flat-note">
        Jabatan dinamis untuk kontrak {contractScope.contractName}. Perubahan
        tersimpan di database dan langsung dipakai dropdown jabatan pada
        Master Pegawai untuk semua akun dalam scope yang sama.
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
              <button type="button" className="sla-btn sla-btn-primary" disabled={saving} onClick={submit}>
                {saving ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Simpan Jabatan'}
              </button>
              <button type="button" className="sla-btn" disabled={saving} onClick={cancel}>
                Batal
              </button>
            </div>
            {saveError && <p className="sla-blocked-note">{saveError}</p>}
          </div>
        </div>
      )}

      {saveError && !adding && !editingId && <p className="sla-blocked-note">{saveError}</p>}
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
                    <button type="button" className="sla-btn" disabled={saving} onClick={() => startEdit(item)}>
                      Edit
                    </button>
                    <button type="button" className="sla-btn" disabled={saving} onClick={() => toggleStatus(item)}>
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