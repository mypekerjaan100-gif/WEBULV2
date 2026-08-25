import { useEffect, useState, useCallback } from 'react'
import { slaIndicators } from '../../data/slaPelayananTeknik.js'
import { periodLabelToMonth, fetchMonthlyTargets, fetchMonthlyEntries, listFeeders, listActiveFeeders, proposeFeeder, createFeederDirect, approveFeeder, rejectFeeder, deactivateFeeder, activateFeeder, deleteFeeder, formatFeederStatus } from '../../data/variableCostRepository.js'

const CANONICAL_9 = slaIndicators.filter((i) => i.inputMode === 'variable-cost' || i.id === 'A-3.1c')

function formatRp(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return `Rp ${n.toLocaleString('id-ID')}`
}
function formatNumber(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return n.toLocaleString('id-ID')
}
function formatPercent(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return `${n.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

export default function SLAVariableCost({ period, orgMap, role, unitId, up3Id }) {
  const isUp3Role = role === 'up3'
  const contractId = orgMap?.contractUuid
  const up3Uuid = orgMap?.up3Uuid
  const units = orgMap?.units ?? []
  const childUlps = units.filter((u) => u.type === 'ULP' && u.parentUuid === up3Uuid)
  // Resolve own ULP for ADMIN_ULP
  const adminUlpUnit = units.find((u) => u.uuid === unitId || u.legacyKey === unitId)
  const isAdminUlpView = role === 'ulp'
  const [selectedUlpLegacy, setSelectedUlpLegacy] = useState(() => childUlps[0]?.legacyKey ?? childUlps[0]?.uuid ?? '')
  useEffect(() => { if (childUlps.length && !selectedUlpLegacy) setSelectedUlpLegacy(childUlps[0]?.legacyKey ?? childUlps[0]?.uuid) }, [childUlps.length]) // eslint-disable-line

  const effectiveLegacy = isAdminUlpView ? (adminUlpUnit?.legacyKey ?? unitId) : (isUp3Role ? selectedUlpLegacy : unitId)
  const effectiveUnit = units.find((u) => u.legacyKey === effectiveLegacy || u.uuid === effectiveLegacy)
  const effectiveUnitUuid = effectiveUnit?.uuid ?? null
  const periodMonth = periodLabelToMonth(period)

  const [targets, setTargets] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeFeeders, setActiveFeeders] = useState([])

  const loadMonthly = useCallback(async () => {
    if (!contractId || !up3Uuid || !periodMonth) { setLoading(false); return }
    if (isAdminUlpView && !effectiveUnitUuid) { setTargets([]); setEntries([]); setActiveFeeders([]); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const unitUuids = isAdminUlpView ? [effectiveUnitUuid] : (effectiveUnitUuid ? [effectiveUnitUuid] : childUlps.map((u) => u.uuid))
      const [t, e] = await Promise.all([
        fetchMonthlyTargets({ contractId, up3Id: up3Uuid, unitIds: unitUuids.length ? unitUuids : undefined, periodMonth }),
        fetchMonthlyEntries({ contractId, up3Id: up3Uuid, unitIds: unitUuids.length ? unitUuids : undefined, periodMonth }),
      ])
      setTargets(t ?? []); setEntries(e ?? [])
      if (effectiveUnitUuid) {
        const af = await listActiveFeeders({ contractId, up3Id: up3Uuid, unitId: effectiveUnitUuid })
        setActiveFeeders(af ?? [])
      } else setActiveFeeders([])
    } catch (err) { setError(err.message || 'Gagal memuat data Variable Cost'); setTargets([]); setEntries([]) }
    finally { setLoading(false) }
  }, [contractId, up3Uuid, periodMonth, effectiveUnitUuid, isAdminUlpView, childUlps.map((u) => u.uuid).join(',')])

  useEffect(() => { loadMonthly() }, [loadMonthly])

  // Master Penyulang state
  const [feeders, setFeeders] = useState([])
  const [feederLoading, setFeederLoading] = useState(false)
  const [feederError, setFeederError] = useState('')
  const [feederStatusFilter, setFeederStatusFilter] = useState('')
  const [proposeName, setProposeName] = useState('')
  const [proposeBusy, setProposeBusy] = useState(false)
  const [directUlp, setDirectUlp] = useState(() => effectiveLegacy)
  const [activeTab, setActiveTab] = useState('rekap')

  const loadFeeders = useCallback(async () => {
    if (!contractId || !up3Uuid) return
    setFeederLoading(true); setFeederError('')
    try {
      const list = await listFeeders({ contractId, up3Id: up3Uuid, unitId: isAdminUlpView ? effectiveUnitUuid : (feederStatusFilter ? undefined : effectiveUnitUuid) })
      // client filter for status and for ADMIN_UP3 ULP filter
      let filtered = list
      if (feederStatusFilter) filtered = filtered.filter((f) => f.status === feederStatusFilter)
      if (!isAdminUlpView && effectiveUnitUuid) {
        // if ULP filter selected, show only that ULP; otherwise show all child
        if (effectiveUnitUuid) filtered = filtered.filter((f) => f.unit_id === effectiveUnitUuid)
      }
      setFeeders(filtered)
    } catch (err) { setFeederError(err.message) }
    finally { setFeederLoading(false) }
  }, [contractId, up3Uuid, effectiveUnitUuid, isAdminUlpView, feederStatusFilter])

  useEffect(() => { if (activeTab === 'penyulang') loadFeeders() }, [loadFeeders, activeTab])
  useEffect(() => { setDirectUlp(effectiveLegacy) }, [effectiveLegacy])

  const handlePropose = async () => {
    if (!proposeName.trim() || !effectiveUnitUuid) return
    setProposeBusy(true)
    try {
      if (isAdminUlpView) {
        await proposeFeeder({ contractId, up3Id: up3Uuid, unitId: effectiveUnitUuid, name: proposeName.trim() })
      } else {
        const targetUnit = units.find((u) => u.legacyKey === directUlp || u.uuid === directUlp)?.uuid ?? effectiveUnitUuid
        await createFeederDirect({ contractId, up3Id: up3Uuid, unitId: targetUnit, name: proposeName.trim() })
      }
      setProposeName(''); await loadFeeders(); await loadMonthly()
    } catch (err) { setFeederError(err.message) }
    finally { setProposeBusy(false) }
  }

  const handleApprove = async (id) => { try { await approveFeeder(id); await loadFeeders() } catch (e) { setFeederError(e.message) } }
  const handleReject = async (id) => {
    const reason = window.prompt('Alasan penolakan (wajib):')
    if (!reason) return
    try { await rejectFeeder(id, reason); await loadFeeders() } catch (e) { setFeederError(e.message) }
  }
  const handleToggleActive = async (f) => {
    try {
      if (f.status === 'ACTIVE') await deactivateFeeder(f.id)
      else if (f.status === 'INACTIVE') await activateFeeder(f.id)
      await loadFeeders()
    } catch (e) { setFeederError(e.message) }
  }
  const handleDelete = async (f) => {
    if (!window.confirm(`Hapus Penyulang "${f.name}"?`)) return
    try { await deleteFeeder(f.id); await loadFeeders() }
    catch (e) { setFeederError(e.message.includes('deactivate') ? 'Penyulang sudah memiliki riwayat transaksi — tidak dapat dihapus permanen. Gunakan Nonaktifkan.' : e.message) }
  }

  // Build lookup for monthly values: since Supabase has no seeded indicators (empty), we show empty state
  // For now, map by legacy point is not possible because indicator_id is UUID; we just show empty values
  const targetByPoint = new Map() // placeholder
  const entryByPoint = new Map()

  // If we had real indicator UUIDs, we would map here; for V2, Supabase returns empty, so table shows empty states correctly
  // Keep formatting logic that handles null -> "Belum diatur" / 0

  return (
    <section className="sla-module-panel">
      <div className="sla-export-bar" style={{ justifyContent: 'space-between' }}>
        <span className="sla-export-scope">VARIABLE COST — Periode {period} · {isAdminUlpView ? (effectiveUnit?.displayName ?? effectiveLegacy) : (childUlps.find((u) => (u.legacyKey ?? u.uuid) === selectedUlpLegacy)?.displayName ?? '—')}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className={`sla-btn ${activeTab === 'rekap' ? 'sla-btn-primary' : ''}`} onClick={() => setActiveTab('rekap')}>Rekap Bulanan</button>
          <button type="button" className={`sla-btn ${activeTab === 'penyulang' ? 'sla-btn-primary' : ''}`} onClick={() => setActiveTab('penyulang')}>Master Penyulang</button>
        </div>
      </div>

      {isUp3Role && !isAdminUlpView && activeTab === 'rekap' && (
        <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>ULP</label>
          <select className="input-select" value={selectedUlpLegacy} onChange={(e) => setSelectedUlpLegacy(e.target.value)}>
            {childUlps.map((u) => <option key={u.uuid} value={u.legacyKey ?? u.uuid}>{u.displayName}</option>)}
          </select>
        </div>
      )}

      {activeTab === 'rekap' ? (
        <>
          <div className="sla-table-wrap">
            <table className="sla-table">
              <thead>
                <tr>
                  <th>Indikator</th><th>Satuan</th><th>Target</th><th>WO</th><th>Realisasi</th><th>Pencapaian</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6}>Memuat data Variable Cost…</td></tr>
                ) : error ? (
                  <tr><td colSpan={6} className="sla-blocked-note">{error}</td></tr>
                ) : CANONICAL_9.length === 0 ? (
                  <tr><td colSpan={6}>Belum ada data Variable Cost pada periode ini.</td></tr>
                ) : CANONICAL_9.map((ind) => {
                  const isKonstruksi = ind.id === 'A-3.1c'
                  // Real data would come from entryByPoint; for V2 with no seed, show empty states
                  const target = targetByPoint.get(ind.point) ?? null
                  const entry = entryByPoint.get(ind.point) ?? null
                  if (isKonstruksi) {
                    return (
                      <tr key={ind.id}>
                        <td>{ind.scope} — {ind.criteria}</td>
                        <td>—</td>
                        <td><span className="text-muted">Belum diatur</span></td>
                        <td colSpan={3} style={{ textAlign: 'center' }}>
                          <span className="text-muted">Nilai/Pendapatan — {entry ? formatRp(entry.realization) : 'Belum ada data'}</span>
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={ind.id}>
                      <td>{ind.point} — {ind.criteria}</td>
                      <td>{ind.unit ?? '—'}</td>
                      <td>{target == null ? <span className="text-muted">Belum diatur</span> : formatNumber(target)}</td>
                      <td>{entry?.work_order == null ? '0' : formatNumber(entry.work_order)}</td>
                      <td>{entry?.realization == null ? '0' : formatNumber(entry.realization)}</td>
                      <td>{entry?.achievement == null ? '—' : formatPercent(entry.achievement)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!loading && entries.length === 0 && (
            <p className="text-muted" style={{ marginTop: 12 }}>Belum ada data Variable Cost pada periode ini.</p>
          )}
          {entries.length === 0 && targets.length === 0 && !loading && (
            <p className="text-muted">Target belum diatur oleh Admin UP3.</p>
          )}
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button type="button" className="sla-btn sla-btn-primary" onClick={() => alert('Input Kegiatan akan tersedia di V3 (daily form, petugas, evidence).')}>+ Input Kegiatan</button>
            <span className="text-muted" style={{ alignSelf: 'center' }}>{activeFeeders.length} Penyulang aktif untuk ULP ini — siap untuk V3</span>
          </div>
        </>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {!isAdminUlpView && (
              <>
                <label>ULP</label>
                <select className="input-select" value={selectedUlpLegacy} onChange={(e) => setSelectedUlpLegacy(e.target.value)}>
                  {childUlps.map((u) => <option key={u.uuid} value={u.legacyKey ?? u.uuid}>{u.displayName}</option>)}
                </select>
              </>
            )}
            <label>Status</label>
            <select className="input-select" value={feederStatusFilter} onChange={(e) => setFeederStatusFilter(e.target.value)}>
              <option value="">Semua Status</option>
              <option value="PENDING">Menunggu Persetujuan</option>
              <option value="ACTIVE">Aktif</option>
              <option value="REJECTED">Ditolak</option>
              <option value="INACTIVE">Nonaktif</option>
            </select>
            <button type="button" className="sla-btn" onClick={loadFeeders}>Muat Ulang</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            {!isAdminUlpView && (
              <>
                <label>ULP Tujuan</label>
                <select className="input-select" value={directUlp} onChange={(e) => setDirectUlp(e.target.value)}>
                  {childUlps.map((u) => <option key={u.uuid} value={u.legacyKey ?? u.uuid}>{u.displayName}</option>)}
                </select>
              </>
            )}
            <input className="input-field" placeholder="Nama Penyulang" value={proposeName} onChange={(e) => setProposeName(e.target.value)} style={{ minWidth: 220 }} />
            <button type="button" className="sla-btn sla-btn-primary" disabled={proposeBusy || !proposeName.trim()} onClick={handlePropose}>
              {proposeBusy ? 'Menyimpan…' : isAdminUlpView ? '+ Usulkan Penyulang' : '+ Tambah Penyulang'}
            </button>
          </div>

          {feederError && <p className="sla-blocked-note">{feederError}</p>}

          {feederLoading ? <p>Memuat Penyulang…</p> : feeders.length === 0 ? (
            <p className="text-muted">Belum ada Penyulang aktif untuk ULP ini.</p>
          ) : (
            <div className="sla-table-wrap">
              <table className="sla-table">
                <thead><tr><th>Nama Penyulang</th><th>Status</th><th>Tanggal Pengajuan</th><th>Aksi</th></tr></thead>
                <tbody>
                  {feeders.map((f) => (
                    <tr key={f.id}>
                      <td>{f.name}</td>
                      <td>{formatFeederStatus(f.status)}{f.status === 'REJECTED' && f.rejection_reason ? ` — ${f.rejection_reason}` : ''}</td>
                      <td>{f.proposed_at ? new Date(f.proposed_at).toLocaleDateString('id-ID') : '—'}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {f.status === 'PENDING' && !isAdminUlpView && (
                          <>
                            <button type="button" className="sla-btn sla-btn-primary" onClick={() => handleApprove(f.id)}>Approve</button>
                            <button type="button" className="sla-btn" onClick={() => handleReject(f.id)}>Reject</button>
                          </>
                        )}
                        {f.status === 'ACTIVE' && !isAdminUlpView && (
                          <button type="button" className="sla-btn" onClick={() => handleToggleActive(f)}>Nonaktifkan</button>
                        )}
                        {f.status === 'INACTIVE' && !isAdminUlpView && (
                          <button type="button" className="sla-btn" onClick={() => handleToggleActive(f)}>Aktifkan</button>
                        )}
                        {!isAdminUlpView && (
                          <button type="button" className="sla-btn" onClick={() => handleDelete(f)}>Hapus</button>
                        )}
                        {f.status === 'REJECTED' && isAdminUlpView && f.rejection_reason && (
                          <span className="text-muted">Alasan: {f.rejection_reason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {isAdminUlpView && <p className="text-muted" style={{ marginTop: 8 }}>Usulan baru berstatus Menunggu Persetujuan. Approve/Reject hanya oleh Admin UP3.</p>}
        </div>
      )}
    </section>
  )
}
