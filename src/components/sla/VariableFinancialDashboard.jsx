import { useEffect, useRef, useState } from 'react'
import { getVariableFinancialDashboard, getVariableFinancialTrend, periodLabelToMonth } from '../../data/variableCostRepository.js'

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

function formatMonth(value, compact = false) {
  if (!value) return '-'
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('id-ID', {
    month: compact ? 'short' : 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function VariableFinancialDashboard({ contractId, up3Id, period, periods, onPeriodChange, units, onOpenTransactions }) {
  const [unitId, setUnitId] = useState(ALL_UNITS)
  const [authorizedUnitIds, setAuthorizedUnitIds] = useState([])
  const [dashboard, setDashboard] = useState(null)
  const [selectedIndicator, setSelectedIndicator] = useState(null)
  const [trendMonthCount, setTrendMonthCount] = useState(6)
  const [trend, setTrend] = useState(null)
  const [trendLoading, setTrendLoading] = useState(true)
  const [trendError, setTrendError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const trendRequestId = useRef(0)
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

  useEffect(() => {
    const currentRequest = ++trendRequestId.current
    if (!contractId || !up3Id || !periodMonth) return
    setTrendLoading(true)
    setTrendError('')
    getVariableFinancialTrend({
      contractId,
      up3Id,
      endPeriodMonth: periodMonth,
      unitId: unitId === ALL_UNITS ? null : unitId,
      monthCount: trendMonthCount,
    }).then((result) => {
      if (currentRequest === trendRequestId.current) setTrend(result)
    }).catch((loadError) => {
      if (currentRequest !== trendRequestId.current) return
      setTrend(null)
      setTrendError(loadError.message || 'Gagal memuat tren finansial.')
    }).finally(() => {
      if (currentRequest === trendRequestId.current) setTrendLoading(false)
    })
  }, [contractId, up3Id, periodMonth, unitId, trendMonthCount])

  const summary = dashboard?.summary ?? {}
  const incompleteTargets = Number(summary.missing_target_count ?? 0) > 0
  const missingPrices = Number(summary.missing_price_count ?? 0) > 0
  const financialIncomplete = incompleteTargets || missingPrices
  const maxUnitAmount = Math.max(1, ...(dashboard?.units ?? []).flatMap((row) => [Number(row.target_amount ?? 0), Number(row.actual_amount ?? 0)]))
  const detailCells = selectedIndicator
    ? (dashboard?.cells ?? []).filter((cell) => cell.indicator_code === selectedIndicator.indicator_code)
    : []
  const trendMonths = trend?.months ?? []
  const maxTrendAmount = Math.max(1, ...trendMonths.flatMap((row) => [Number(row.target_amount ?? 0), Number(row.actual_amount ?? 0)]))
  const currentTrendMonth = trendMonths.at(-1)
  const previousTrendMonth = trendMonths.at(-2)
  const previousMonthChange = currentTrendMonth?.has_data && previousTrendMonth?.has_data
    && Number(currentTrendMonth.missing_price_count) === 0 && Number(previousTrendMonth.missing_price_count) === 0
    && Number(previousTrendMonth.actual_amount) > 0
      ? ((Number(currentTrendMonth.actual_amount) - Number(previousTrendMonth.actual_amount)) / Number(previousTrendMonth.actual_amount)) * 100
      : null
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

          <section className="vc-fin-section vc-fin-trend-section">
            <div className="vc-fin-section-title">
              <div>
                <span>HISTORIS</span>
                <h4>TREN TARGET VS REALISASI - {trendMonthCount} BULAN</h4>
                {previousMonthChange != null && <p className={`vc-fin-trend-insight ${previousMonthChange >= 0 ? 'is-up' : 'is-down'}`}>Realisasi {formatRp(currentTrendMonth.actual_amount)}: {previousMonthChange >= 0 ? '+' : ''}{previousMonthChange.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% vs {formatMonth(previousTrendMonth.period_month)}</p>}
              </div>
              <div className="vc-fin-trend-controls" aria-label="Rentang tren">
                {[6,12].map((count) => <button key={count} type="button" className={`sla-btn ${trendMonthCount === count ? 'sla-btn-primary' : ''}`} disabled={trendLoading} onClick={() => setTrendMonthCount(count)}>{count} Bulan</button>)}
              </div>
            </div>

            {trendError && <p className="sla-blocked-note">{trendError}</p>}
            {trendLoading ? <p>Memuat tren finansial...</p> : !trendError && (
              <>
                <div className="vc-fin-chart vc-fin-trend-chart">
                  {trendMonths.map((row) => (
                    <div className="vc-fin-chart-row" key={row.period_month}>
                      <strong>{formatMonth(row.period_month, true)}</strong>
                      {!row.has_data ? <div className="vc-fin-no-data">Belum ada data</div> : (
                        <div className="vc-fin-bars">
                          <div className="vc-fin-bar-line"><span className="vc-fin-bar is-target" style={{ width: `${Number(row.target_amount ?? 0) / maxTrendAmount * 100}%` }} /><em>{formatRp(row.target_amount)}{!row.target_complete ? ' terkonfigurasi' : ''}</em></div>
                          <div className="vc-fin-bar-line"><span className="vc-fin-bar is-actual" style={{ width: `${Number(row.actual_amount ?? 0) / maxTrendAmount * 100}%` }} /><em>{formatRp(row.actual_amount)}{Number(row.missing_price_count) > 0 ? ` - ${row.missing_price_count} harga belum tersedia` : ''}</em></div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="sla-table-wrap vc-fin-table-wrap vc-fin-trend-table-wrap">
                  <table className="sla-table vc-fin-table">
                    <thead><tr><th>Periode</th><th>Target</th><th>Realisasi</th><th>Selisih</th><th>Pencapaian</th><th>Status</th></tr></thead>
                    <tbody>{trendMonths.map((row) => {
                      const targetIncomplete = !row.target_complete
                      const priceMissing = Number(row.missing_price_count) > 0
                      const status = !row.has_data ? 'Belum ada data' : targetIncomplete ? 'Target Belum Lengkap' : priceMissing ? 'Harga Belum Lengkap' : row.achievement_percent == null ? 'Target Rp0' : Number(row.achievement_percent) >= 100 ? 'Tercapai' : 'Belum Tercapai'
                      return <tr key={row.period_month}><td>{formatMonth(row.period_month)}</td><td>{row.has_data ? formatRp(row.target_amount) : '-'}{row.has_data && targetIncomplete && <small>{row.configured_target_count} / {row.required_target_count} target</small>}</td><td>{row.has_data ? formatRp(row.actual_amount) : '-'}</td><td>{row.has_data && !targetIncomplete && !priceMissing ? formatRp(row.difference_amount) : '-'}</td><td>{row.has_data && !targetIncomplete && !priceMissing ? formatPercent(row.achievement_percent) : '-'}</td><td>{status}{priceMissing && <small>Harga belum tersedia: {row.missing_price_count} transaksi</small>}</td></tr>
                    })}</tbody>
                  </table>
                </div>
              </>
            )}
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
