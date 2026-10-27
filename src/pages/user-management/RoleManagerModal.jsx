import { useEffect, useState } from 'react'
import { listCustomRoles, saveCustomRole, setCustomRoleActive } from '../../lib/customRoles.js'

const MENU_OPTIONS = [
  { key: 'sla', label: 'SLA', hint: 'Laporan, indikator, dan target SLA.' },
  { key: 'variable_cost', label: 'Variable Cost', hint: 'Realisasi dan data Variable Cost.' },
  { key: 'lembur', label: 'Lembur', hint: 'Pengajuan, revisi, evidence, dan riwayat lembur.' },
  { key: 'alat_kendaraan', label: 'Alat & Kendaraan', hint: 'Pemeriksaan kondisi, nopol, dan riwayat kendaraan.' },
]

const ACCESS_OPTIONS = [
  { value: 'none', label: 'Tidak ada akses' },
  { value: 'read', label: 'Hanya lihat' },
  { value: 'edit', label: 'Lihat & edit' },
]

const emptyMenuAccess = () => Object.fromEntries(MENU_OPTIONS.map((menu) => [menu.key, 'none']))

const roleCodeFromName = (value) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 60)

const accessSummary = (menuAccess) => {
  const read = MENU_OPTIONS.filter((menu) => menuAccess?.[menu.key] === 'read').length
  const edit = MENU_OPTIONS.filter((menu) => menuAccess?.[menu.key] === 'edit').length
  if (!read && !edit) return 'Tidak ada akses'
  return [read ? `${read} hanya lihat` : '', edit ? `${edit} lihat & edit` : ''].filter(Boolean).join(' · ')
}

function RoleForm({ role, onCancel, onSaved }) {
  const isEdit = Boolean(role?.id)
  const [displayName, setDisplayName] = useState(role?.displayName ?? '')
  const [codeSuffix, setCodeSuffix] = useState(() => (
    role?.code ? role.code.replace(/^CUSTOM_/, '') : ''
  ))
  const [codeTouched, setCodeTouched] = useState(false)
  const [description, setDescription] = useState(role?.description ?? '')
  const [menuAccess, setMenuAccess] = useState(() => ({ ...emptyMenuAccess(), ...(role?.menuAccess ?? {}) }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setMenu = (key, value) => {
    setMenuAccess((current) => ({ ...current, [key]: value }))
    setError('')
  }

  const handleNameChange = (value) => {
    setDisplayName(value)
    setError('')
    if (!isEdit && !codeTouched) setCodeSuffix(roleCodeFromName(value))
  }

  const handleCodeChange = (value) => {
    setCodeTouched(true)
    setCodeSuffix(value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (!displayName.trim()) { setError('Nama role wajib diisi.'); return }
    if (!isEdit && !/^[A-Za-z0-9_]{2,60}$/.test(codeSuffix.trim())) {
      setError('Kode role wajib 2-60 karakter: huruf, angka, atau underscore.')
      return
    }
    setSaving(true)
    try {
      await saveCustomRole({
        roleId: role?.id ?? null,
        code: isEdit ? role.code : codeSuffix.trim(),
        displayName: displayName.trim(),
        description: description.trim(),
        scopeLevel: 'ULP',
        menuAccess,
        expectedRevision: role?.revision ?? null,
      })
      await onSaved()
    } catch (saveError) {
      setError(saveError.message || 'Role gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="role-form" onSubmit={submit}>
      {error && <div className="invite-error-box"><p>{error}</p></div>}
      <div className="role-form-grid">
        <div className="form-group">
          <label htmlFor="role-name">Nama Role *</label>
          <input id="role-name" className="input-field" value={displayName} maxLength={80} onChange={(event) => handleNameChange(event.target.value)} placeholder="Contoh: K3" required />
        </div>
        <div className="form-group">
          <label htmlFor="role-code">Kode Role *</label>
          <div className="role-code-input">
            <span>CUSTOM_</span>
            <input id="role-code" className="input-field" value={codeSuffix} maxLength={60} disabled={isEdit} onChange={(event) => handleCodeChange(event.target.value)} placeholder="K3" required />
          </div>
          <span className="invite-hint">
            {isEdit
              ? 'Kode tidak dapat diubah setelah role dibuat.'
              : 'Terisi otomatis dari nama role; dapat disesuaikan sebelum disimpan.'}
          </span>
        </div>
        <div className="form-group role-form-description">
          <label htmlFor="role-description">Deskripsi</label>
          <input id="role-description" className="input-field" value={description} maxLength={200} onChange={(event) => setDescription(event.target.value)} placeholder="Tujuan atau tugas role" />
        </div>
      </div>

      <div className="role-scope-note">
        <strong>Cakupan data: ULP</strong>
        <span>Unit ULP ditentukan saat role diberikan kepada pengguna.</span>
      </div>

      <div className="role-matrix" role="table" aria-label="Hak akses menu">
        <div className="role-matrix-head" role="row">
          <span>Menu</span>
          <span>Tingkat akses</span>
        </div>
        {MENU_OPTIONS.map((menu) => (
          <div className="role-matrix-row" role="row" key={menu.key}>
            <div>
              <strong>{menu.label}</strong>
              <small>{menu.hint}</small>
            </div>
            <select
              className="input-select"
              value={menuAccess[menu.key] ?? 'none'}
              onChange={(event) => setMenu(menu.key, event.target.value)}
              aria-label={`Akses ${menu.label}`}
            >
              {ACCESS_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={menu.editDisabled && option.value === 'edit'}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="modal-footer role-form-footer">
        <button type="button" className="btn btn-outline" onClick={onCancel} disabled={saving}>Batal</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Menyimpan...' : isEdit ? 'Simpan Perubahan' : 'Buat Role'}
        </button>
      </div>
    </form>
  )
}

export default function RoleManagerModal({ onClose, onRolesChanged }) {
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await listCustomRoles()
      setRoles(rows)
    } catch (loadError) {
      setError(loadError.message || 'Role gagal dimuat.')
      setRoles([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => { setEditing(null); setShowForm(true) }
  const openEdit = (role) => { setEditing(role); setShowForm(true) }
  const closeForm = () => { setEditing(null); setShowForm(false) }
  const saved = async () => {
    closeForm()
    await load()
    onRolesChanged?.()
  }

  const toggleActive = async (role) => {
    const nextActive = !role.isActive
    if (!window.confirm(nextActive ? `Aktifkan role ${role.displayName}?` : `Nonaktifkan role ${role.displayName}?`)) return
    setBusyId(role.id)
    setError('')
    try {
      await setCustomRoleActive({ roleId: role.id, isActive: nextActive, expectedRevision: role.revision })
      await load()
      onRolesChanged?.()
    } catch (toggleError) {
      setError(toggleError.message || 'Status role gagal diubah.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-xl role-manager-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Manajemen Role &amp; Hak Akses</h3>
            <p className="invite-hint">Role khusus Super Admin. Pengaturan aksi sensitif dan Master &amp; Pengaturan belum termasuk pada tahap ini.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Tutup">&times;</button>
        </div>

        <div className="modal-body">
          {error && <div className="invite-error-box"><p>{error}</p></div>}
          {showForm ? (
            <RoleForm role={editing} onCancel={closeForm} onSaved={saved} />
          ) : (
            <>
              <div className="role-manager-toolbar">
                <span>{loading ? 'Memuat role...' : `${roles.length} role custom`}</span>
                <button type="button" className="btn btn-primary" onClick={openCreate}>+ Tambah Role</button>
              </div>
              {loading ? (
                <div className="state-box"><div className="spinner" /><p>Memuat role...</p></div>
              ) : roles.length === 0 ? (
                <div className="role-empty">
                  <strong>Belum ada role custom.</strong>
                  <span>Tambahkan role untuk menentukan akses menu bagi pengguna.</span>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table role-table">
                    <thead>
                      <tr>
                        <th>Role</th>
                        <th>Cakupan</th>
                        <th>Akses Menu</th>
                        <th>Pengguna</th>
                        <th>Status</th>
                        <th>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roles.map((role) => (
                        <tr key={role.id}>
                          <td>
                            <strong>{role.displayName}</strong>
                            <div className="role-code-label">{role.code}</div>
                            {role.description && <div className="role-description">{role.description}</div>}
                          </td>
                          <td>{role.scopeLevel}</td>
                          <td>{accessSummary(role.menuAccess)}</td>
                          <td>{role.assignedUsers}</td>
                          <td><span className={`badge ${role.isActive ? 'badge-active' : 'badge-disabled'}`}>{role.isActive ? 'Aktif' : 'Nonaktif'}</span></td>
                          <td>
                            <div className="role-actions">
                              <button type="button" className="btn btn-sm btn-outline" onClick={() => openEdit(role)}>Edit</button>
                              <button type="button" className="btn btn-sm btn-outline" disabled={busyId === role.id} onClick={() => toggleActive(role)}>
                                {busyId === role.id ? 'Memproses...' : role.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
