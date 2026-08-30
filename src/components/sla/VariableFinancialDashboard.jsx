import { useEffect, useRef, useState } from 'react'
import { getVariableFinancialDashboard, periodLabelToMonth } from '../../data/variableCostRepository.js'

const ALL_UNITS = 'ALL'

function formatRp(value) {
  if (value == null || value === '') return '-'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '-'
  return `${amount < 0 ? '-' : ''}Rp ${Math.abs(amount).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
}

function formatPercent(value) {
  if (value == null || value === '') return '-'
  const percent = Number(value)
  if (!Number.isFinite(percent)) return '-'
  return `${percent.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

export default function VariableFinancialDashboard({ contractId, up3Id, period, periods, onPeriodChange, units, onOpenTransactions }) {
  const [unitId, setUnitId] = useState(ALL_UNITS)
  const [authorizedUnitIds, setAuthorizedUnitIds] = useState([])
  const [dashboard, setDashboard] = useState(null)
  const [selectedIndicator, setSelectedIndicator] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const periodMonth = periodLabelToMonth(period)
  const unitNames = new Map(units.map((unit) => [unit.uuid, unit.displayName]))

  useEffect(() => {
    const currentRequest = ++requestId.current
    if (!contractId || !up3Id || !periodMonth) return
    setLoading(true)
    setError('')
    getVariableFinancialDashboard({
      contractId,
      up3Id,
      periodMonth,
      unitId: unitId === ALL_UNITS ? null : unitId,
    }).then((result) => {
      if (currentRequest !== requestId.current) return
      setDashboard(result)
      if (unitId === ALL_UNITS) setAuthorizedUnitIds((result?.units ?? []).map((row) => row.unit_id))
    }).catch((loadError) => {
      if (currentRequest !== requestId.current) return
      setDashboard(null)
      setError(loadError.message || 'Gagal memuat Dashboard Finansial.')
    }).finally(() => {
      if (currentRequest === requestId.current) setLoading(false)
    })
  }, [contractId, up3Id, periodMonth, unitId])

  const summary = dashboard?.summary ?? {}
  const incompleteTargets = Number(summary.missing_target_count ?? 0) > 0
  const missingPrices = Number(summary.missing_price_count ?? 0) > 0
  const financialIncomplete = incompleteTargets || missingPrices
  const maxUnitAmount = Math.max(1, ...(dashboard?.units ?? []).flatMap((row) => [Number(row.target_amount ?? 0), Number(row.actual_amount ?? 0)]))
  const detailCells = selectedIndicator
    ? (dashboard?.cells ?? []).filter((cell) => cell.indicator_code === selectedIndicator.indicator_code)
    : []
  const achievementStatus = (row) => {
    if (Number(row.missing_target_count) > 0) return 'Target belum lengkap'
    if (Number(row.missing_price_count) > 0) return 'Harga belum lengkap'
    if (row.achievement_percent == null) return 'Target Rp0'
    return Number(row.achievement_percent) >= 100 ? 'Target tercapai' : 'Belum tercapai'
  }

  return (
    <div className="vc-fin-dashboard">
      <div className="vc-fin-dashboard-head">
        <div>
          <p className="vc-fin-eyebrow">CURRENT PERIOD</p>
          <h3>DASHBOARD FINANSIAL VARIABLE COST</h3>
        </div>
        <div className="vc-fin-filters">
          <label>Periode
            <select className="input-select" value={period} disabled={loading} onChange={(event) => onPeriodChange?.(event.target.value)}>
              {periods.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>Scope / ULP
            <select className="input-select" value={unitId} disabled={loading} onChange={(event) => setUnitId(event.target.value)}>
              <option value={ALL_UNITS}>Semua ULP - Konsolidasi UP3</option>
              {authorizedUnitIds.map((id) => <option key={id} value={id}>{unitNames.get(id) ?? id}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && <p className="sla-blocked-note">{error}</p>}
      {loading && <p>Memuat Dashboard Finansial...</p>}
      {!loading && !error && dashboard && (
        <>
          <div className="vc-fin-warnings">
            {incompleteTargets && <div className="vc-fin-warning">Target pendapatan belum lengkap: {summary.missing_target_count} item</div>}
            {missingPrices && <div className="vc-fin-warning">Harga belum tersedia: {summary.missing_price_count} transaksi</div>}
          </div>

          <div className="vc-fin-kpis">
            <article className="vc-fin-kpi vc-fin-kpi-target">
              <span>{incompleteTargets ? 'TARGET TERKONFIGURASI' : 'TARGET PENDAPATAN'}</span>
              <strong>{formatRp(summary.target_amount)}</strong>
              <small>{summary.configured_target_count ?? 0} dari {(Number(summary.configured_target_count ?? 0) + Number(summary.missing_target_count ?? 0))} item</small>
            </article>
            <article className="vc-fin-kpi vc-fin-kpi-actual">
              <span>REALISASI PENDAPATAN TERKONFIRMASI</span>
              <strong>{formatRp(summary.actual_amount)}</strong>
              <small>APPROVED + Konstruksi langsung</small>
            </article>
            <article className="vc-fin-kpi">
              <span>SELISIH</span>
              <strong>{financialIncomplete ? 'Belum lengkap' : formatRp(summary.difference_amount)}</strong>
              <small>Realisasi dikurangi target</small>
            </article>
            <article className="vc-fin-kpi">
              <span>PENCAPAIAN</span>
              <strong>{financialIncomplete ? 'Belum lengkap' : formatPercent(summary.achievement_percent)}</strong>
              <small>{achievementStatus(summary)}</small>
            </article>
          </div>

          <section className="vc-fin-section">
            <div className="vc-fin-section-title">
              <div><span>PER ULP</span><h4>TARGET VS REALISASI PER ULP</h4></div>
              <div className="vc-fin-legend"><i className="is-target" /> Target <i className="is-actual" /> Realisasi</div>
            </div>
            <div className="vc-fin-chart">
              {(dashboard.units ?? []).map((row) => (
                <div className="vc-fin-chart-row" key={row.unit_id}>
                  <strong>{unitNames.get(row.unit_id) ?? row.unit_id}</strong>
                  <div className="vc-fin-bars">
                    <div className="vc-fin-bar-line"><span className="vc-fin-bar is-target" style={{ width: `${Number(row.target_amount ?? 0) / maxUnitAmount * 100}%` }} /><em>{formatRp(row.target_amount)}{Number(row.missing_target_count) > 0 ? ' terkonfigurasi' : ''}</em></div>
                    <div className="vc-fin-bar-line"><span className="vc-fin-bar is-actual" style={{ width: `${Number(row.actual_amount ?? 0) / maxUnitAmount * 100}%` }} /><em>{formatRp(row.actual_amount)}</em></div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="vc-fin-section">
            <div className="vc-fin-section-title"><div><span>RINCIAN</span><h4>PER INDIKATOR</h4></div></div>
            <div className="sla-table-wrap vc-fin-table-wrap">
              <table className="sla-table vc-fin-table">
                <thead><tr><th>Kegiatan</th><th>Target Pendapatan</th><th>Realisasi Pendapatan</th><th>Selisih</th><th>Pencapaian</th><th>Status</th></tr></thead>
                <tbody>
                  {(dashboard.indicators ?? []).map((row) => {
                    const incomplete = Number(row.missing_target_count) > 0 || Number(row.missing_price_count) > 0
                    return (
                      <tr key={row.indicator_code}>
                        <td><button type="button" className="vc-fin-indicator-link" onClick={() => setSelectedIndicator(row)}>{row.indicator_name}</button></td>
                        <td>{formatRp(row.target_amount)}{Number(row.missing_target_count) > 0 && <small> Target terkonfigurasi</small>}</td>
                        <td>{formatRp(row.actual_amount)}</td>
                        <td>{incomplete ? 'Belum lengkap' : formatRp(row.difference_amount)}</td>
                        <td>{incomplete ? 'Belum lengkap' : formatPercent(row.achievement_percent)}</td>
                        <td>{achievementStatus(row)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {selectedIndicator && (
        <div className="modal-backdrop" onClick={() => setSelectedIndicator(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 860 }}>
            <div className="modal-header"><h3>{selectedIndicator.indicator_name} - Rincian per ULP</h3><button type="button" className="modal-close" onClick={() => setSelectedIndicator(null)}>x</button></div>
            <div className="modal-body">
              <div className="sla-table-wrap vc-fin-table-wrap">
                <table className="sla-table vc-fin-table">
                  <thead><tr><th>ULP</th><th>Target</th><th>Realisasi</th><th>Selisih</th><th>Pencapaian</th><th>Aksi</th></tr></thead>
                  <tbody>{detailCells.map((cell) => {
                    const incomplete = cell.target_missing || Number(cell.missing_price_count) > 0
                    const contributingIds = cell.actual_indicator_ids?.length ? cell.actual_indicator_ids : [cell.indicator_id]
                    return <tr key={cell.unit_id}><td>{unitNames.get(cell.unit_id) ?? cell.unit_id}</td><td>{cell.target_missing ? 'Target belum diatur' : formatRp(cell.target_amount)}</td><td>{formatRp(cell.actual_amount)}</td><td>{incomplete ? 'Belum lengkap' : formatRp(cell.difference_amount)}</td><td>{incomplete ? 'Belum lengkap' : formatPercent(cell.achievement_percent)}</td><td>{cell.source_type === 'UNIT_RATE' ? <button type="button" className="sla-btn" onClick={() => onOpenTransactions?.(cell.indicator_code, cell.unit_id, contributingIds)}>Transaksi APPROVED</button> : '-'}</td></tr>
                  })}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
