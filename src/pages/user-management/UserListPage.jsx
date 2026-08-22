import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../lib/AppAuth.jsx'
import { callUserManagement } from '../../lib/userManagement.js'

const STATUS_OPTIONS = [
  { value: '', label: 'Semua Status' },
  { value: 'ACTIVE', label: 'Aktif' },
  { value: 'INVITED', label: 'Diundang' },
  { value: 'DISABLED', label: 'Nonaktif' },
]

const ROLE_OPTIONS = [
  { value: '', label: 'Semua Role' },
  { value: 'SUPER_ADMIN', label: 'SUPER_ADMIN' },
]

function StatusBadge({ status }) {
  const cls =
    status === 'ACTIVE'
      ? 'badge badge-active'
      : status === 'INVITED'
        ? 'badge badge-invited'
        : status === 'DISABLED'
          ? 'badge badge-disabled'
          : 'badge'
  return <span className={cls}>{status}</span>
}

function SummaryBar({ users }) {
  const total = users.length
  const active = users.filter((u) => u.status === 'ACTIVE').length
  const invited = users.filter((u) => u.status === 'INVITED').length
  const disabled = users.filter((u) => u.status === 'DISABLED').length
  return (
    <div className="user-summary-bar">
      <div className="summary-stat">
        <span className="summary-stat-value">{total}</span>
        <span className="summary-stat-label">Total</span>
      </div>
      <div className="summary-stat">
        <span className="summary-stat-value summary-stat-active">{active}</span>
        <span className="summary-stat-label">Aktif</span>
      </div>
      <div className="summary-stat">
        <span className="summary-stat-value summary-stat-invited">{invited}</span>
        <span className="summary-stat-label">Diundang</span>
      </div>
      <div className="summary-stat">
        <span className="summary-stat-value summary-stat-disabled">{disabled}</span>
        <span className="summary-stat-label">Nonaktif</span>
      </div>
    </div>
  )
}

function DetailModal({ user, onClose }) {
  if (!user) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Detail Pengguna</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Tutup">
            &times;
          </button>
        </div>
        <div className="modal-body">
          <section className="detail-section">
            <h4>Identitas</h4>
            <dl className="detail-grid">
              <dt>Nama</dt>
              <dd>{user.displayName}</dd>
              <dt>Email</dt>
              <dd>{user.email}</dd>
              <dt>Status</dt>
              <dd><StatusBadge status={user.status} /></dd>
              <dt>Dibuat</dt>
              <dd>{new Date(user.createdAt).toLocaleDateString('id-ID')}</dd>
              {user.lastSignInAt && (
                <>
                  <dt>Login Terakhir</dt>
                  <dd>{new Date(user.lastSignInAt).toLocaleDateString('id-ID')}</dd>
                </>
              )}
            </dl>
          </section>
          <section className="detail-section">
            <h4>System Role</h4>
            {user.isSuperAdmin ? (
              <span className="badge badge-super">SUPER_ADMIN</span>
            ) : user.roles.length > 0 ? (
              <div className="badge-group">
                {user.roles.map((r) => (
                  <span key={r} className="badge badge-role">{r}</span>
                ))}
              </div>
            ) : (
              <span className="text-muted">Tidak ada role</span>
            )}
          </section>
          {user.organizationMemberships.length > 0 && (
            <section className="detail-section">
              <h4>Keanggotaan Organisasi</h4>
              <table className="detail-table">
                <thead>
                  <tr><th>Unit</th><th>Role</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {user.organizationMemberships.map((om, i) => (
                    <tr key={i}>
                      <td>{om.unitName}</td>
                      <td>{om.role}</td>
                      <td><StatusBadge status={om.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {user.contractMemberships.length > 0 && (
            <section className="detail-section">
              <h4>Keanggotaan Kontrak</h4>
              <table className="detail-table">
                <thead>
                  <tr><th>Kontrak</th><th>Role</th><th>UP3</th><th>ULP</th></tr>
                </thead>
                <tbody>
                  {user.contractMemberships.map((cm, i) => (
                    <tr key={i}>
                      <td>{cm.contractName}</td>
                      <td>{cm.role}</td>
                      <td>{cm.up3Ids.length > 0 ? cm.up3Ids.join(', ') : '-'}</td>
                      <td>{cm.ulpIds.length > 0 ? cm.ulpIds.join(', ') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {user.organizationMemberships.length === 0 && user.contractMemberships.length === 0 && (
            <section className="detail-section">
              <p className="text-muted">Tidak ada keanggotaan organisasi atau kontrak.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function UserListTable({ users, onSelect }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Nama</th>
            <th>Email</th>
            <th>Role</th>
            <th>Organisasi</th>
            <th>Kontrak / Scope</th>
            <th>Status</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-cell">Tidak ada data ditemukan.</td>
            </tr>
          ) : (
            users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.displayName}
                  {u.isSuperAdmin && <span className="badge badge-super inline-badge">SUPER_ADMIN</span>}
                </td>
                <td>{u.email}</td>
                <td>
                  {u.roles.length > 0 ? u.roles.join(', ') : <span className="text-muted">-</span>}
                </td>
                <td>
                  {u.organizationMemberships.length > 0
                    ? u.organizationMemberships.map((m) => m.unitName).join(', ')
                    : <span className="text-muted">-</span>}
                </td>
                <td>
                  {u.contractMemberships.length > 0
                    ? u.contractMemberships.map((m) => m.contractName).join(', ')
                    : u.contracts.length > 0
                      ? u.contracts.join(', ')
                      : <span className="text-muted">-</span>}
                </td>
                <td><StatusBadge status={u.status} /></td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => onSelect(u)}
                  >
                    Lihat Detail
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function UserListPage({ onBack }) {
  const { session } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fnError } = await callUserManagement('list_users')
      if (fnError) {
        setError(fnError)
        setUsers([])
      } else {
        setUsers(data?.users || [])
      }
    } catch (err) {
      setError(err.message || 'Gagal memuat data pengguna')
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const filtered = users.filter((u) => {
    const q = search.toLowerCase()
    const matchSearch =
      !search ||
      u.displayName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    const matchStatus = !statusFilter || u.status === statusFilter
    const matchRole =
      !roleFilter ||
      (roleFilter === 'SUPER_ADMIN'
        ? u.isSuperAdmin
        : u.roles.includes(roleFilter))
    return matchSearch && matchStatus && matchRole
  })

  return (
    <div className="page">
      <div className="page-header-row">
        <button type="button" className="back-button" onClick={onBack}>
          &larr; Kembali
        </button>
      </div>
      <section className="page-hero">
        <h1 className="page-title">Pengguna &amp; Akses</h1>
        <p className="page-subtitle">
          Daftar pengguna sistem, status akun, role, dan keanggotaan organisasi/kontrak.
        </p>
      </section>

      {!loading && !error && <SummaryBar users={users} />}

      <section className="user-toolbar">
        <input
          type="text"
          className="input-search"
          placeholder="Cari nama atau email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          className="input-select"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-disabled"
          disabled
          title="Tahap berikutnya"
        >
          + Tambah User
        </button>
      </section>

      {loading && (
        <div className="state-box">
          <div className="spinner" />
          <p>Memuat daftar pengguna...</p>
        </div>
      )}

      {error && !loading && (
        <div className="state-box state-error">
          <p>Gagal memuat data pengguna.</p>
          <p className="error-detail">{error}</p>
          <button type="button" className="btn btn-primary" onClick={fetchUsers}>
            Coba Lagi
          </button>
        </div>
      )}

      {!loading && !error && (
        <UserListTable users={filtered} onSelect={setSelectedUser} />
      )}

      {selectedUser && (
        <DetailModal user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  )
}
