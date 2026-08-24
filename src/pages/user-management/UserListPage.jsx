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

const MANAGEMENT_ROLE_OPTIONS = [
  { value: 'TEAM_LEADER', label: 'Team Leader Unit Layanan' },
  { value: 'MANAGER_UNIT', label: 'Manager Unit Layanan' },
  { value: 'MANAGER_UP', label: 'Manager Unit Pelaksana (MUP)' },
  { value: 'ASMAN_OPERASI', label: 'Asman Operasi' },
  { value: 'ASMAN_KEUANGAN', label: 'Asman Keuangan' },
]

const MANAGEMENT_ROLE_LEVEL = {
  TEAM_LEADER: 'UL',
  MANAGER_UNIT: 'UL',
  MANAGER_UP: 'UP',
  ASMAN_OPERASI: 'UP',
  ASMAN_KEUANGAN: 'UP',
}

const MANAGEMENT_ROLE_LABEL = Object.fromEntries(MANAGEMENT_ROLE_OPTIONS.map((o) => [o.value, o.label]))

function OrganizationAccessForm({ user, onSuccess }) {
  const [internalUnits, setInternalUnits] = useState([])
  const [role, setRole] = useState('TEAM_LEADER')
  const [unitId, setUnitId] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    callUserManagement('access_options').then(({ data, error: fnError }) => {
      if (cancelled) return
      if (fnError) setError(fnError)
      else setInternalUnits(data?.internalOrganizationUnits || [])
      setLoading(false)
    }).catch((err) => {
      if (!cancelled) {
        setError(err.message || 'Gagal memuat unit organisasi.')
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  const expectedType = MANAGEMENT_ROLE_LEVEL[role]
  const filteredUnits = internalUnits.filter((u) => u.type === expectedType)
  const selectedUnit = filteredUnits.find((u) => u.id === unitId)

  const handleRoleChange = (nextRole) => {
    setRole(nextRole)
    setUnitId('')
    setError(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!unitId || !role) {
      setError('Pilih role dan unit organisasi.')
      return
    }
    setSubmitting(true)
    try {
      const { data, error: fnError } = await callUserManagement('assign_organization_access', {
        targetUserId: user.id,
        targetRoleCode: role,
        payload: {
          internalOrgUnitId: unitId,
          organizationRole: role,
        },
      })
      if (fnError) {
        setError(fnError)
        return
      }
      if (data?.error) {
        setError(data.error)
        return
      }
      await onSuccess(data)
    } catch (err) {
      setError(err.message || 'Gagal mengatur akses organisasi.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="text-muted">Memuat unit organisasi...</p>
  return (
    <form onSubmit={handleSubmit} className="contract-access-form">
      {error && <div className="invite-error-box"><p>{error}</p></div>}
      <div className="form-group">
        <label htmlFor="org-role">Role *</label>
        <select id="org-role" className="input-select" value={role} onChange={(e) => handleRoleChange(e.target.value)} required>
          {MANAGEMENT_ROLE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="org-unit">Unit Organisasi *</label>
        <select id="org-unit" className="input-select" value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
          <option value="">Pilih unit</option>
          {filteredUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} {unit.hasOperationalMapping ? '' : '(belum mapping)'}</option>)}
        </select>
      </div>
      {selectedUnit && !selectedUnit.hasOperationalMapping && (
        <p className="invite-hint">Scope operasional Pelayanan Teknik belum dikonfigurasi.</p>
      )}
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? 'Menyimpan...' : 'Simpan Akses Organisasi'}
      </button>
    </form>
  )
}

function ContractAccessForm({ user, onSuccess }) {
  const [options, setOptions] = useState({ contracts: [], scopes: [] })
  const [contractId, setContractId] = useState('')
  const [role, setRole] = useState('ADMIN_UP3')
  const [up3Id, setUp3Id] = useState('')
  const [ulpId, setUlpId] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    callUserManagement('access_options').then(({ data, error: fnError }) => {
      if (cancelled) return
      if (fnError) setError(fnError)
      else setOptions({ contracts: data?.contracts || [], scopes: data?.scopes || [] })
      setLoading(false)
    }).catch((err) => {
      if (!cancelled) {
        setError(err.message || 'Gagal memuat opsi akses.')
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  const scopes = options.scopes.filter((scope) => scope.contractId === contractId)
  const selectedScope = scopes.find((scope) => scope.up3Id === up3Id)

  const handleContractChange = (nextContractId) => {
    setContractId(nextContractId)
    setUp3Id('')
    setUlpId('')
  }

  const handleUp3Change = (nextUp3Id) => {
    setUp3Id(nextUp3Id)
    setUlpId('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!contractId || !up3Id || (role === 'ADMIN_ULP' && !ulpId)) {
      setError('Lengkapi kontrak, role, dan scope operasional.')
      return
    }
    setSubmitting(true)
    try {
      const { data, error: fnError } = await callUserManagement('assign_contract_access', {
        targetUserId: user.id,
        targetRoleCode: role,
        payload: {
          contractId,
          contractRole: role,
          operationalUp3Id: up3Id,
          operationalUnitId: role === 'ADMIN_ULP' ? ulpId : null,
        },
      })
      if (fnError) {
        setError(fnError)
        return
      }
      await onSuccess(data)
    } catch (err) {
      setError(err.message || 'Gagal mengatur akses.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="text-muted">Memuat opsi akses...</p>
  return (
    <form onSubmit={handleSubmit} className="contract-access-form">
      {error && <div className="invite-error-box"><p>{error}</p></div>}
      <div className="form-group">
        <label htmlFor="access-contract">Kontrak</label>
        <select id="access-contract" className="input-select" value={contractId} onChange={(e) => handleContractChange(e.target.value)} required>
          <option value="">Pilih kontrak</option>
          {options.contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.title}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="access-role">Role Kontrak</label>
        <select id="access-role" className="input-select" value={role} onChange={(e) => { setRole(e.target.value); setUlpId('') }}>
          <option value="ADMIN_UP3">ADMIN_UP3</option>
          <option value="ADMIN_ULP">ADMIN_ULP</option>
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="access-up3">UP3</label>
        <select id="access-up3" className="input-select" value={up3Id} onChange={(e) => handleUp3Change(e.target.value)} disabled={!contractId} required>
          <option value="">Pilih UP3</option>
          {scopes.map((scope) => <option key={scope.up3Id} value={scope.up3Id}>{scope.up3Name}</option>)}
        </select>
      </div>
      {role === 'ADMIN_ULP' && (
        <div className="form-group">
          <label htmlFor="access-ulp">ULP</label>
          <select id="access-ulp" className="input-select" value={ulpId} onChange={(e) => setUlpId(e.target.value)} disabled={!up3Id} required>
            <option value="">Pilih ULP</option>
            {(selectedScope?.ulps || []).map((ulp) => <option key={ulp.id} value={ulp.id}>{ulp.name}</option>)}
          </select>
        </div>
      )}
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? 'Menyimpan...' : 'Simpan Akses'}
      </button>
    </form>
  )
}

function DetailModal({ user, onClose, isSuperAdmin, onRefresh }) {
  const [showAccessForm, setShowAccessForm] = useState(false)
  const [accessFormType, setAccessFormType] = useState('contract')
  if (!user) return null
  const hasOrg = user.organizationMemberships.length > 0
  const hasContract = user.contractMemberships.length > 0
  const hasRole = user.isSuperAdmin || user.roles.length > 0
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
              <span className="text-muted">Belum Ada</span>
            )}
          </section>
          <section className="detail-section">
            <h4>Keanggotaan Organisasi</h4>
            {hasOrg ? (
              <table className="detail-table">
                <thead>
                  <tr><th>Unit</th><th>Role</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {user.organizationMemberships.map((om, i) => (
                    <tr key={i}>
                      <td>{om.unitName}</td>
                      <td>{MANAGEMENT_ROLE_LABEL[om.role] ?? om.role}</td>
                      <td><StatusBadge status={om.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <span className="text-muted">Belum Ada</span>
            )}
          </section>
          <section className="detail-section">
            <h4>Keanggotaan Kontrak</h4>
            {hasContract ? (
              <table className="detail-table">
                <thead>
                  <tr><th>Kontrak</th><th>Role</th><th>UP3</th><th>ULP</th></tr>
                </thead>
                <tbody>
                  {user.contractMemberships.map((cm, i) => (
                    <tr key={i}>
                      <td>{cm.contractName}</td>
                      <td>{cm.role}</td>
                       <td>{cm.up3Name}</td>
                       <td>{cm.ulpName || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <span className="text-muted">Belum Ada</span>
            )}
          </section>
          {!hasRole && !hasOrg && !hasContract && (
            <div className="detail-hint">
               Belum ada akses yang ditetapkan.
            </div>
          )}
          {isSuperAdmin && (
            <section className="detail-section">
              <div className="detail-section-heading">
                <h4>Atur Akses</h4>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setShowAccessForm((visible) => !visible)}>
                  {showAccessForm ? 'Tutup' : 'Atur Akses'}
                </button>
              </div>
              {showAccessForm && (
                <>
                  <div className="form-group">
                    <label htmlFor="access-type">Jenis Akses</label>
                    <select id="access-type" className="input-select" value={accessFormType} onChange={(e) => setAccessFormType(e.target.value)}>
                      <option value="contract">Kontrak Operasional</option>
                      <option value="organization">Organisasi Manajemen</option>
                    </select>
                  </div>
                  {accessFormType === 'contract' ? (
                    <ContractAccessForm
                      user={user}
                      onSuccess={async () => {
                        await onRefresh()
                        onClose()
                      }}
                    />
                  ) : (
                    <OrganizationAccessForm
                      user={user}
                      onSuccess={async () => {
                        await onRefresh()
                        onClose()
                      }}
                    />
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function InviteUserModal({ onClose, onSuccess }) {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const { data, error: fnError } = await callUserManagement('invite_user', {
        payload: { email: email.trim(), displayName: displayName.trim() },
      })
      if (fnError) {
        setError(fnError)
        return
      }
      if (data?.error) {
        setError(data.message || 'Gagal mengirim undangan.')
        return
      }
      onSuccess(data)
    } catch (err) {
      setError(err.message || 'Terjadi kesalahan')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Tambah Pengguna</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Tutup">
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="invite-error-box">
                <p>{error}</p>
              </div>
            )}
            <div className="form-group">
              <label htmlFor="invite-name">Nama</label>
              <input
                id="invite-name"
                type="text"
                className="input-field"
                placeholder="Nama lengkap"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="invite-email">Email</label>
              <input
                id="invite-email"
                type="email"
                className="input-field"
                placeholder="email@contoh.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <p className="invite-hint">
              Akses organisasi dan role diberikan setelah user berhasil diundang.
            </p>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={submitting}>
              Batal
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !displayName.trim() || !email.trim()}>
              {submitting ? 'Mengirim...' : 'Kirim Undangan'}
            </button>
          </div>
        </form>
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
                  {u.roles.length > 0 ? u.roles.join(', ') : <span className="text-muted">Belum Ditentukan</span>}
                </td>
                <td>
                  {u.organizationMemberships.length > 0
                    ? u.organizationMemberships.map((m) => m.unitName).join(', ')
                    : <span className="text-muted">Belum Ditentukan</span>}
                </td>
                 <td>
                   {u.contractMemberships.length > 0
                     ? u.contractMemberships.map((m) => `${m.contractName} / ${m.role} (${m.up3Name}${m.ulpName ? `, ${m.ulpName}` : ''})`).join(', ')
                    : u.contracts.length > 0
                      ? u.contracts.join(', ')
                      : <span className="text-muted">Belum Ditentukan</span>}
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
  const { authority } = useAuth()
  const isSuperAdmin = authority?.actor?.is_super_admin === true
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [showInvite, setShowInvite] = useState(false)

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

  const handleInviteSuccess = () => {
    setShowInvite(false)
    fetchUsers()
  }

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
          className="btn btn-primary"
          onClick={() => setShowInvite(true)}
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
        <DetailModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          isSuperAdmin={isSuperAdmin}
          onRefresh={fetchUsers}
        />
      )}

      {showInvite && (
        <InviteUserModal onClose={() => setShowInvite(false)} onSuccess={handleInviteSuccess} />
      )}
    </div>
  )
}
