import { useEffect, useState, useCallback } from 'react'
import { slaIndicators } from '../../data/slaPelayananTeknik.js'
import { periodLabelToMonth, fetchMonthlyTargets, fetchUp3Targets, fetchMonthlyEntries, fetchIndicators, listFeeders, listActiveFeeders, proposeFeeder, createFeederDirect, approveFeeder, rejectFeeder, deactivateFeeder, activateFeeder, deleteFeeder, formatFeederStatus } from '../../data/variableCostRepository.js'

const CANONICAL_9 = slaIndicators.filter((i) => i.inputMode === 'variable-cost' || i.id === 'A-3.1c')
const ALL_KEY = 'ALL'

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
  const adminUlpUnit = units.find((u) => u.uuid === unitId || u.legacyKey === unitId)
  const isAdminUlpView = role === 'ulp'
  const [selectedUlpLegacy, setSelectedUlpLegacy] = useState(() => isUp3Role ? ALL_KEY : (childUlps[0]?.legacyKey ?? childUlps[0]?.uuid ?? ''))
  useEffect(() => {
    if (isUp3Role && !selectedUlpLegacy) setSelectedUlpLegacy(ALL_KEY)
    else if (childUlps.length && !selectedUlpLegacy) setSelectedUlpLegacy(childUlps[0]?.legacyKey ?? childUlps[0]?.uuid)
  }, [childUlps.length]) // eslint-disable-line

  const isConsolidated = isUp3Role && selectedUlpLegacy === ALL_KEY && !isAdminUlpView
  const effectiveLegacy = isAdminUlpView ? (adminUlpUnit?.legacyKey ?? unitId) : (isConsolidated ? null : (isUp3Role ? selectedUlpLegacy : unitId))
  const effectiveUnit = effectiveLegacy ? units.find((u) => u.legacyKey === effectiveLegacy || u.uuid === effectiveLegacy) : null
  const effectiveUnitUuid = effectiveUnit?.uuid ?? null
  const periodMonth = periodLabelToMonth(period)

  const [targets, setTargets] = useState([])
  const [up3Targets, setUp3Targets] = useState([])
  const [entries, setEntries] = useState([])
  const [indicators, setIndicators] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeFeeders, setActiveFeeders] = useState([])
  const [drillIndicator, setDrillIndicator] = useState(null)

  const loadMonthly = useCallback(async () => {
    if (!contractId || !up3Uuid || !periodMonth) { setLoading(false); return }
    if (isAdminUlpView && !effectiveUnitUuid) { setTargets([]); setEntries([]); setUp3Targets([]); setActiveFeeders([]); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const unitUuids = isConsolidated ? childUlps.map((u) => u.uuid) : (effectiveUnitUuid ? [effectiveUnitUuid] : [])
      const [t, e, ind, up3t] = await Promise.all([
        unitUuids.length ? fetchMonthlyTargets({ contractId, up3Id: up3Uuid, unitIds: unitUuids, periodMonth }) : Promise.resolve([]),
        unitUuids.length ? fetchMonthlyEntries({ contractId, up3Id: up3Uuid, unitIds: unitUuids, periodMonth }) : Promise.resolve([]),
        fetchIndicators({ contractId, up3Id: up3Uuid }).catch(() => []),
        isConsolidated ? fetchUp3Targets({ contractId, up3Id: up3Uuid, periodMonth }).catch(() => []) : Promise.resolve([]),
      ])
      setTargets(t ?? []); setEntries(e ?? []); setIndicators(ind ?? []); setUp3Targets(up3t ?? [])
      if (effectiveUnitUuid && !isConsolidated) {
        const af = await listActiveFeeders({ contractId, up3Id: up3Uuid, unitId: effectiveUnitUuid }).catch(() => [])
        setActiveFeeders(af ?? [])
      } else if (isConsolidated) {
        setActiveFeeders([])
      } else setActiveFeeders([])
    } catch (err) { setError(err.message || 'Gagal memuat data Variable Cost'); setTargets([]); setEntries([]); setUp3Targets([]) }
    finally { setLoading(false) }
  }, [contractId, up3Uuid, periodMonth, effectiveUnitUuid, isAdminUlpView, isConsolidated, childUlps.map((u) => u.uuid).join(',')])

  useEffect(() => { loadMonthly() }, [loadMonthly])

  const [feeders, setFeeders] = useState([])
  const [feederLoading, setFeederLoading] = useState(false)
  const [feederError, setFeederError] = useState('')
  const [feederStatusFilter, setFeederStatusFilter] = useState('')
  const [proposeName, setProposeName] = useState('')
  const [proposeBusy, setProposeBusy] = useState(false)
  const [directUlp, setDirectUlp] = useState(() => effectiveLegacy ?? ALL_KEY)
  const [activeTab, setActiveTab] = useState('rekap')

  const loadFeeders = useCallback(async () => {
    if (!contractId || !up3Uuid) return
    setFeederLoading(true); setFeederError('')
    try {
      const list = await listFeeders({ contractId, up3Id: up3Uuid, unitId: isAdminUlpView ? effectiveUnitUuid : (feederStatusFilter ? undefined : effectiveUnitUuid) })
      let filtered = list
      if (feederStatusFilter) filtered = filtered.filter((f) => f.status === feederStatusFilter)
      if (!isAdminUlpView && effectiveUnitUuid && !isConsolidated) {
        if (effectiveUnitUuid) filtered = filtered.filter((f) => f.unit_id === effectiveUnitUuid)
      }
      setFeeders(filtered)
    } catch (err) { setFeederError(err.message) }
    finally { setFeederLoading(false) }
  }, [contractId, up3Uuid, effectiveUnitUuid, isAdminUlpView, feederStatusFilter, isConsolidated])

  useEffect(() => { if (activeTab === 'penyulang') loadFeeders() }, [loadFeeders, activeTab])
  useEffect(() => { setDirectUlp(effectiveLegacy ?? ALL_KEY) }, [effectiveLegacy])

  const handlePropose = async () => {
    if (!proposeName.trim() || !effectiveUnitUuid) return
    setProposeBusy(true)
    try {
      if (isAdminUlpView) {
        await proposeFeeder({ contractId, up3Id: up3Uuid, unitId: effectiveUnitUuid, name: proposeName.trim() })
      } else {
        const targetUnit = units.find((u) => u.legacyKey === directUlp || u.uuid === directUlp)?.uuid ?? effectiveUnitUuid
        if (!targetUnit) throw new Error('Pilih ULP tujuan')
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

  // Build point -> UUID map for grouping
  const pointToUuids = new Map()
  indicators.forEach((ind) => { if (ind.point_code) pointToUuids.set(ind.point_code, ind.id) })

  function getConsolidatedValues(point) {
    // For V2 with empty indicators table, fallback to sum across all entries for display correctness
    // When indicators exist, filter by UUID matching point
    const uuid = pointToUuids.get(point)
    const relevant = uuid ? entries.filter((e) => e.indicator_id === uuid) : []
    // If no mapping, treat as no data -> sum 0; do not invent
    if (uuid && relevant.length === 0) return { wo: 0, realisasi: 0, achievement: null }
    if (!uuid && entries.length === 0) return { wo: 0, realisasi: 0, achievement: null }
    if (!uuid) {
      // No indicator mapping: show consolidated sums as 0 to avoid fake per-point sums
      return { wo: 0, realisasi: 0, achievement: null }
    }
    const wo = relevant.reduce((s, r) => s + Number(r.work_order ?? 0), 0)
    const realisasi = relevant.reduce((s, r) => s + Number(r.realization ?? 0), 0)
    // For Konstruksi, realization is revenue (already)
    return { wo, realisasi }
  }

  function getPerUlpValues(point) {
    const uuid = pointToUuids.get(point)
    return childUlps.map((ulp) => {
      const row = entries.find((e) => e.unit_id === ulp.uuid && (uuid ? e.indicator_id === uuid : false))
      // If no UUID mapping, no row
      return { ulp, row }
    })
  }

  // For non-consolidated per-ULP view, we keep placeholder empty map (V2.1 behavior)
  const targetByPoint = new Map()
  const entryByPoint = new Map()

  return (
    <section className="sla-module-panel">
      <div className="sla-export-bar" style={{ justifyContent: 'space-between' }}>
        <span className="sla-export-scope">VARIABLE COST — Periode {period} · {isAdminUlpView ? (effectiveUnit?.displayName ?? effectiveLegacy) : (isConsolidated ? 'Konsolidasi UP3' : (childUlps.find((u) => (u.legacyKey ?? u.uuid) === selectedUlpLegacy)?.displayName ?? '—'))}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className={`sla-btn ${activeTab === 'rekap' ? 'sla-btn-primary' : ''}`} onClick={() => setActiveTab('rekap')}>Rekap Bulanan</button>
          <button type="button" className={`sla-btn ${activeTab === 'penyulang' ? 'sla-btn-primary' : ''}`} onClick={() => setActiveTab('penyulang')}>Master Penyulang</button>
        </div>
      </div>

      {isUp3Role && !isAdminUlpView && activeTab === 'rekap' && (
        <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>ULP</label>
          <select className="input-select" value={selectedUlpLegacy} onChange={(e) => setSelectedUlpLegacy(e.target.value)}>
            <option value={ALL_KEY}>Semua ULP — Konsolidasi UP3</option>
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
                  <th>Indikator</th><th>Satuan</th><th>Target</th><th>WO</th><th>Realisasi</th><th>Pencapaian</th>{isConsolidated ? <th>Detail</th> : null}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={isConsolidated ? 7 : 6}>Memuat data Variable Cost…</td></tr>
                ) : error ? (
                  <tr><td colSpan={isConsolidated ? 7 : 6} className="sla-blocked-note">{error} <button type="button" className="sla-btn" onClick={loadMonthly}>Coba lagi</button></td></tr>
                ) : CANONICAL_9.length === 0 ? (
                  <tr><td colSpan={isConsolidated ? 7 : 6}>Belum ada data Variable Cost pada periode ini.</td></tr>
                ) : CANONICAL_9.map((ind) => {
                  const isKonstruksi = ind.id === 'A-3.1c'
                  if (isConsolidated) {
                    if (isKonstruksi) {
                      const cons = getConsolidatedValues(ind.point)
                      const totalRevenue = cons.realisasi
                      return (
                        <tr key={ind.id}>
                          <td>{ind.scope} — {ind.criteria}</td>
                          <td>—</td>
                          <td><span className="text-muted">Belum diatur</span></td>
                          <td colSpan={2} style={{ textAlign: 'center' }}>{totalRevenue ? formatRp(totalRevenue) : 'Belum ada data'}</td>
                          <td>—</td>
                          <td><button type="button" className="sla-btn" onClick={() => setDrillIndicator(ind)}>Detail</button></td>
                        </tr>
                      )
                    }
                    const cons = getConsolidatedValues(ind.point)
                    const up3TargetRow = up3Targets.find((t) => {
                      const uuid = pointToUuids.get(ind.point)
                      return uuid ? t.indicator_id === uuid : false
                    })
                    const up3Target = up3TargetRow?.target_value ?? null
                    let pencapaian = '—'
                    if (up3Target != null && cons.wo > 0) {
                      const denom = Math.min(Number(up3Target), cons.wo)
                      if (denom > 0) pencapaian = formatPercent((cons.realisasi / denom) * 100)
                    }
                    return (
                      <tr key={ind.id}>
                        <td>{ind.point} — {ind.criteria}</td>
                        <td>{ind.unit ?? '—'}</td>
                        <td>{up3Target == null ? <span className="text-muted">Belum diatur</span> : formatNumber(up3Target)}</td>
                        <td>{formatNumber(cons.wo)}</td>
                        <td>{formatNumber(cons.realisasi)}</td>
                        <td>{up3Target == null ? '—' : pencapaian}</td>
                        <td><button type="button" className="sla-btn" onClick={() => setDrillIndicator(ind)}>Detail</button></td>
                      </tr>
                    )
                  }
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
          {!loading && !error && isConsolidated && entries.length === 0 && (
            <p className="text-muted" style={{ marginTop: 12 }}>Belum ada data Variable Cost pada periode ini. WO/Realisasi konsolidasi 0 (hanya APPROVED).</p>
          )}
          {!loading && !error && !isConsolidated && entries.length === 0 && (
            <p className="text-muted" style={{ marginTop: 12 }}>Belum ada data Variable Cost pada periode ini.</p>
          )}
          {entries.length === 0 && targets.length === 0 && up3Targets.length === 0 && !loading && !error && (
            <p className="text-muted">Target belum diatur oleh Admin UP3.</p>
          )}
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button type="button" className="sla-btn sla-btn-primary" onClick={() => alert('Input Kegiatan akan tersedia di V3 (daily form, petugas, evidence).')}>+ Input Kegiatan</button>
            <span className="text-muted" style={{ alignSelf: 'center' }}>{isConsolidated ? `${childUlps.length} ULP — konsolidasi APPROVED` : `${activeFeeders.length} Penyulang aktif untuk ULP ini — siap untuk V3`}</span>
          </div>
          {drillIndicator && (
            <div className="modal-backdrop" onClick={() => setDrillIndicator(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
                <div className="modal-header">
                  <h3>Detail {drillIndicator.point} — {drillIndicator.criteria} · Periode {period}</h3>
                  <button type="button" className="modal-close" onClick={() => setDrillIndicator(null)}>×</button>
                </div>
                <div className="modal-body">
                  <table className="sla-table">
                    <thead>
                      <tr>
                        <th>ULP</th>
                        {drillIndicator.id === 'A-3.1c' ? (
                          <><th>Nilai/Pendapatan</th></>
                        ) : (
                          <><th>Target</th><th>WO</th><th>Realisasi</th><th>Pencapaian</th></>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {childUlps.map((ulp) => {
                        const uuid = pointToUuids.get(drillIndicator.point)
                        const row = entries.find((e) => e.unit_id === ulp.uuid && (uuid ? e.indicator_id === uuid : false))
                        const tRow = targets.find((t) => t.unit_id === ulp.uuid && (uuid ? t.indicator_id === uuid : false))
                        if (drillIndicator.id === 'A-3.1c') {
                          return <tr key={ulp.uuid}><td>{ulp.displayName}</td><td>{row?.realization != null ? formatRp(row.realization) : '0'}</td></tr>
                        }
                        const wo = row?.work_order ?? 0
                        const real = row?.realization ?? 0
                        const tgt = tRow?.target_value ?? null
                        let pencapaian = '—'
                        if (tgt != null && wo > 0) {
                          const denom = Math.min(Number(tgt), wo)
                          if (denom > 0) pencapaian = formatPercent((real / denom) * 100)
                        }
                        return <tr key={ulp.uuid}><td>{ulp.displayName}</td><td>{tgt == null ? 'Belum diatur' : formatNumber(tgt)}</td><td>{formatNumber(wo)}</td><td>{formatNumber(real)}</td><td>{pencapaian}</td></tr>
                      })}
                      {drillIndicator.id === 'A-3.1c' ? (
                        <tr style={{ fontWeight: 600 }}><td>Total UP3</td><td>{formatRp(getConsolidatedValues(drillIndicator.point).realisasi)}</td></tr>
                      ) : (
                        (() => {
                          const cons = getConsolidatedValues(drillIndicator.point)
                          const up3TargetRow = up3Targets.find((t) => {
                            const uuid = pointToUuids.get(drillIndicator.point)
                            return uuid ? t.indicator_id === uuid : false
                          })
                          const up3Target = up3TargetRow?.target_value ?? null
                          let pencapaian = '—'
                          if (up3Target != null && cons.wo > 0) {
                            const denom = Math.min(Number(up3Target), cons.wo)
                            if (denom > 0) pencapaian = formatPercent((cons.realisasi / denom) * 100)
                          }
                          return <tr style={{ fontWeight: 600 }}><td>Total UP3</td><td>{up3Target == null ? 'Belum diatur' : formatNumber(up3Target)}</td><td>{formatNumber(cons.wo)}</td><td>{formatNumber(cons.realisasi)}</td><td>{pencapaian}</td></tr>
                        })()
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {!isAdminUlpView && (
              <>
                <label>ULP</label>
                <select className="input-select" value={selectedUlpLegacy} onChange={(e) => setSelectedUlpLegacy(e.target.value)}>
                  <option value={ALL_KEY}>Semua ULP — Konsolidasi UP3</option>
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

          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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
