import { useEffect, useRef, useState } from 'react'
import { getFinancialComparisonDashboard, getFinancialComparisonTrend, periodLabelToMonth } from '../../data/variableCostRepository.js'
import { variableCostIndicators, slaPeriods } from '../../data/slaPelayananTeknik.js'
import { WORK_CATEGORIES } from '../../data/overtimeWorkL3.js'
import { REPLACEMENT_TYPES } from '../../data/overtimeReplacementL2.js'
import Icon from '../Icon.jsx'
import { Alert, StatePanel, DataTable, Button } from '../ui/Primitives.jsx'

const ALL_UNITS = 'ALL'

const COST_DEFINITIONS = [
  { code: 'ADMINISTRASI', label: WORK_CATEGORIES.ADMINISTRASI.label },
  { code: 'GARDU', label: WORK_CATEGORIES.GARDU.label },
  { code: 'JTM', label: WORK_CATEGORIES.JTM.label },
  { code: 'JTR', label: WORK_CATEGORIES.JTR.label },
  { code: 'REPLACEMENT_LEAVE', label: REPLACEMENT_TYPES.REPLACEMENT_LEAVE.label },
  { code: 'REPLACEMENT_SICK', label: REPLACEMENT_TYPES.REPLACEMENT_SICK.label },
  { code: 'REPLACEMENT_PERMISSION', label: REPLACEMENT_TYPES.REPLACEMENT_PERMISSION.label },
]

const REVENUE_ELIGIBLE = variableCostIndicators.filter((i) => i.revenueEligible !== false)
const REVENUE_LABEL = new Map(REVENUE_ELIGIBLE.map((i) => [i.code, i.label ?? i.code]))
const COST_LABEL = new Map(COST_DEFINITIONS.map((c) => [c.code, c.label]))

function formatRp(value) {
  if (value == null || value === '') return '-'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '-'
  return `${amount < 0 ? '-' : ''}Rp ${Math.abs(amount).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
}
function formatPercent(value) {
  if (value == null) return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${n.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}
function formatCompactRp(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 'Rp 0'
  return `Rp ${amount.toLocaleString('id-ID', { notation: 'compact', maximumFractionDigits: 1 })}`
}

function selectedTotals(snapshot, revenueCodes, costCodes) {
  const revenueByCode = new Map((snapshot?.revenue_eligible_components ?? snapshot?.revenue_components ?? []).map((row) => [row.indicator_code, Number(row.amount ?? 0)]))
  const costByCode = new Map((snapshot?.cost_components ?? []).map((row) => [row.cost_code, Number(row.amount ?? 0)]))
  const revenue = revenueCodes.reduce((sum, code) => sum + (revenueByCode.get(code) ?? 0), 0)
  const cost = costCodes.reduce((sum, code) => sum + (costByCode.get(code) ?? 0), 0)
  const margin = revenue - cost
  return {
    revenue,
    cost,
    margin,
    ratio: revenue > 0 ? (cost / revenue) * 100 : null,
  }
}

function formatTrendMonth(value) {
  if (!value) return '-'
  return new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString('id-ID', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function FinancialComparisonDashboard({ contractId, up3Id, period, periods, onPeriodChange, units, orgMap }) {
  const [unitId, setUnitId] = useState(ALL_UNITS)
  const [selectedRevenueCodes, setSelectedRevenueCodes] = useState(() => REVENUE_ELIGIBLE.map((i) => i.code))
  const [selectedCostCodes, setSelectedCostCodes] = useState(() => COST_DEFINITIONS.map((c) => c.code))
  const [dashboard, setDashboard] = useState(null)
  const [trend, setTrend] = useState([])
  const [monthCount, setMonthCount] = useState(6)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revenuePickerOpen, setRevenuePickerOpen] = useState(false)
  const [costPickerOpen, setCostPickerOpen] = useState(false)
  const requestId = useRef(0)
  const periodMonth = periodLabelToMonth(period)

  useEffect(() => {
    const cur = ++requestId.current
    if (!contractId || !up3Id || !periodMonth || !orgMap?.contractUuid || !orgMap?.up3Uuid) {
      if (!periodMonth) { setLoading(false); return }
      setLoading(true)
      return
    }
    setLoading(true)
    setError('')
    const pUp3 = orgMap.up3Uuid
    const pContract = orgMap.contractUuid
    const pUnit = unitId === ALL_UNITS ? null : unitId
    Promise.all([
      getFinancialComparisonDashboard({ contractId: pContract, up3Id: pUp3, periodMonth, unitId: pUnit }),
      getFinancialComparisonTrend({ contractId: pContract, up3Id: pUp3, endPeriodMonth: periodMonth, unitId: pUnit, monthCount }),
    ])
      .then(([snapshot, trendRows]) => {
        if (cur !== requestId.current) return
        setDashboard(snapshot)
        setTrend(trendRows ?? [])
      })
      .catch((e) => {
        if (cur !== requestId.current) return
        setDashboard(null)
        setTrend([])
        const msg = e?.message || 'Gagal memuat Dashboard Finansial.'
        if (/Not authorized|42501/i.test(msg)) setError('Akses finansial tidak tersedia untuk peran ini.')
        else setError(msg)
      })
      .finally(() => { if (cur === requestId.current) setLoading(false) })
  }, [contractId, up3Id, periodMonth, unitId, monthCount, orgMap?.contractUuid, orgMap?.up3Uuid])

  const currentTotals = selectedTotals(dashboard, selectedRevenueCodes, selectedCostCodes)
  const revenueSelectedTotal = currentTotals.revenue
  const costSelectedTotal = currentTotals.cost
  const margin = currentTotals.margin
  const marginPercent = revenueSelectedTotal > 0 ? (margin / revenueSelectedTotal) * 100 : null
  const costRatio = currentTotals.ratio

  const monthlyTrend = trend.map((snapshot) => ({
    periodMonth: snapshot.period_month,
    label: formatTrendMonth(snapshot.period_month),
    ...selectedTotals(snapshot, selectedRevenueCodes, selectedCostCodes),
  }))
  const comparisonMax = Math.max(1, ...monthlyTrend.flatMap((row) => [row.revenue, row.cost, Math.abs(row.margin)]))
  const chartTicks = [1, 0.75, 0.5, 0.25, 0]
  const hasSelection = selectedRevenueCodes.length > 0 && selectedCostCodes.length > 0
  const linePoints = monthlyTrend.map((row, index) => {
    const x = index * 100 + 50
    const y = 100 - Math.max(0, Math.min(100, (row.margin / comparisonMax) * 100))
    return `${x},${y}`
  }).join(' ')

  const toggleRevenue = (code) => setSelectedRevenueCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
  const toggleCost = (code) => setSelectedCostCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
  const selectAllRevenue = () => setSelectedRevenueCodes(REVENUE_ELIGIBLE.map((i) => i.code))
  const clearRevenue = () => setSelectedRevenueCodes([])
  const selectAllCost = () => setSelectedCostCodes(COST_DEFINITIONS.map((c) => c.code))
  const clearCost = () => setSelectedCostCodes([])
  const resetFilters = () => { selectAllRevenue(); selectAllCost(); setUnitId(ALL_UNITS) }

  const revenueComponentsForDisplay = (dashboard?.revenue_eligible_components ?? []).filter((r) => selectedRevenueCodes.includes(r.indicator_code))
  const costComponentsForDisplay = (dashboard?.cost_components ?? []).filter((c) => selectedCostCodes.includes(c.cost_code))
  const pendingRevenueCount = REVENUE_ELIGIBLE.length - selectedRevenueCodes.length
  const pendingCostCount = COST_DEFINITIONS.length - selectedCostCodes.length

  return (
    <div className="vc-fin-dashboard fincomp-dashboard fin-ref-dashboard">
      {/* Compact filter - order per spec */}
      <section className="fin-ref-filter-compact">
        <div className="fin-ref-filter-bar">
          <div className="fin-ref-filter-left">
            <div className="fin-ref-compact-field">
              <span className="fin-ref-compact-label">Komponen Pendapatan</span>
              <button type="button" className={`fin-ref-compact-multi ${revenuePickerOpen ? 'is-open' : ''}`} onClick={() => setRevenuePickerOpen((v) => !v)} aria-expanded={revenuePickerOpen}>
                <span className="fin-ref-compact-chips">
                  {selectedRevenueCodes.slice(0, 3).map((code) => (
                    <span key={code} className="fin-ref-compact-chip is-revenue" onClick={(e) => { e.stopPropagation(); toggleRevenue(code) }}>
                      {REVENUE_LABEL.get(code) ?? code} ×
                    </span>
                  ))}
                  {selectedRevenueCodes.length > 3 && <span className="fin-ref-compact-more">+{selectedRevenueCodes.length - 3}</span>}
                  {selectedRevenueCodes.length === 0 && <span className="fin-ref-compact-placeholder">Pilih komponen</span>}
                </span>
                <Icon name="chevron-right" size={12} className="fin-ref-compact-chevron" />
              </button>
              {revenuePickerOpen && (
                <div className="fin-ref-picker">
                  <div className="fin-ref-picker-grid">
                    {REVENUE_ELIGIBLE.map((ind) => (
                      <button key={ind.code} type="button" className={`fin-ref-picker-item ${selectedRevenueCodes.includes(ind.code) ? 'is-selected' : ''}`} onClick={() => toggleRevenue(ind.code)}>
                        <span className="fin-ref-picker-check">{selectedRevenueCodes.includes(ind.code) ? '✓' : '+'}</span>
                        <span>{ind.label ?? ind.code}</span>
                        <small>{ind.code}</small>
                      </button>
                    ))}
                  </div>
                  <div className="fin-ref-picker-actions">
                    <span>{selectedRevenueCodes.length} dari {REVENUE_ELIGIBLE.length} terpilih</span>
                    <span className="fin-ref-picker-btns">
                      <button type="button" onClick={selectAllRevenue}>Pilih Semua</button>
                      <button type="button" onClick={clearRevenue}>Kosongkan</button>
                    </span>
                  </div>
                </div>
              )}
              {pendingRevenueCount > 0 && !revenuePickerOpen && <span className="fin-ref-compact-hint">{pendingRevenueCount} lainnya belum dipilih</span>}
            </div>

            <div className="fin-ref-compact-field">
              <span className="fin-ref-compact-label">Komponen Biaya</span>
              <button type="button" className={`fin-ref-compact-multi is-cost ${costPickerOpen ? 'is-open' : ''}`} onClick={() => setCostPickerOpen((v) => !v)} aria-expanded={costPickerOpen}>
                <span className="fin-ref-compact-chips">
                  {selectedCostCodes.slice(0, 3).map((code) => (
                    <span key={code} className="fin-ref-compact-chip is-cost" onClick={(e) => { e.stopPropagation(); toggleCost(code) }}>
                      {COST_LABEL.get(code) ?? code} ×
                    </span>
                  ))}
                  {selectedCostCodes.length > 3 && <span className="fin-ref-compact-more">+{selectedCostCodes.length - 3}</span>}
                  {selectedCostCodes.length === 0 && <span className="fin-ref-compact-placeholder">Pilih komponen</span>}
                </span>
                <Icon name="chevron-right" size={12} className="fin-ref-compact-chevron" />
              </button>
              {costPickerOpen && (
                <div className="fin-ref-picker is-cost">
                  <div className="fin-ref-picker-grid">
                    {COST_DEFINITIONS.map((def) => (
                      <button key={def.code} type="button" className={`fin-ref-picker-item is-cost ${selectedCostCodes.includes(def.code) ? 'is-selected' : ''}`} onClick={() => toggleCost(def.code)}>
                        <span className="fin-ref-picker-check">{selectedCostCodes.includes(def.code) ? '✓' : '+'}</span>
                        <span>{def.label}</span>
                        <small>{def.code}</small>
                      </button>
                    ))}
                  </div>
                  <div className="fin-ref-picker-actions">
                    <span>{selectedCostCodes.length} dari {COST_DEFINITIONS.length} terpilih</span>
                    <span className="fin-ref-picker-btns">
                      <button type="button" onClick={selectAllCost}>Pilih Semua</button>
                      <button type="button" onClick={clearCost}>Kosongkan</button>
                    </span>
                  </div>
                </div>
              )}
              {pendingCostCount > 0 && !costPickerOpen && <span className="fin-ref-compact-hint">{pendingCostCount} lainnya belum dipilih</span>}
            </div>

            <label className="fin-ref-compact-field is-select">
              <span className="fin-ref-compact-label">Periode</span>
              <span className="fin-ref-compact-select">
                <Icon name="calendar" size={13} />
                <select value={period} onChange={(e) => onPeriodChange?.(e.target.value)}>
                  {(periods ?? slaPeriods).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <Icon name="chevron-right" size={11} className="fin-ref-compact-chevron" />
              </span>
            </label>

            <label className="fin-ref-compact-field is-select">
              <span className="fin-ref-compact-label">Unit / ULP</span>
              <span className="fin-ref-compact-select">
                <Icon name="layers" size={13} />
                <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                  <option value={ALL_UNITS}>Semua ULP</option>
                  {(units ?? []).filter((u) => u.type === 'ULP').map((u) => {
                    const id = u.uuid ?? u.id
                    return <option key={id} value={id}>{u.displayName ?? u.name ?? id}</option>
                  })}
                </select>
                <Icon name="chevron-right" size={11} className="fin-ref-compact-chevron" />
              </span>
            </label>

            <label className="fin-ref-compact-field is-select">
              <span className="fin-ref-compact-label">Mode Perbandingan</span>
              <span className="fin-ref-compact-select">
                <Icon name="chart-bar" size={13} />
                <select value={monthCount} onChange={(event) => setMonthCount(Number(event.target.value))}>
                  <option value={6}>6 Bulan</option>
                  <option value={12}>12 Bulan</option>
                </select>
                <Icon name="chevron-right" size={11} className="fin-ref-compact-chevron" />
              </span>
            </label>
          </div>

          <div className="fin-ref-filter-actions">
            <Button variant="primary" size="small" className="fin-ref-btn-apply" icon={<Icon name="filter" size={13} />}>Terapkan Perbandingan</Button>
            <Button variant="ghost" size="small" className="fin-ref-btn-reset" onClick={resetFilters}>Reset Filter</Button>
          </div>
        </div>
      </section>

      {error && <Alert tone="danger">{error}</Alert>}
      {loading && <StatePanel state="loading" title="Memuat Dashboard Finansial" />}
      {!loading && !error && dashboard && (
        <>
          {!hasSelection && <Alert tone="warning">Pilih minimal satu komponen Pendapatan dan satu komponen Biaya Operasional untuk melihat agregasi.</Alert>}

          {/* KPI - 4 premium */}
          <div className="fin-ref-kpis">
            <div className="fin-ref-kpi is-revenue">
              <span className="fin-ref-kpi-icon"><Icon name="chart-bar" size={20} /></span>
              <div className="fin-ref-kpi-body">
                <span className="fin-ref-kpi-label">Total Pendapatan Terpilih</span>
                <strong className="fin-ref-kpi-value">{formatRp(revenueSelectedTotal)}</strong>
                <span className="fin-ref-kpi-sub">Akumulasi • {selectedRevenueCodes.length} komponen</span>
              </div>
            </div>
            <div className="fin-ref-kpi is-cost">
              <span className="fin-ref-kpi-icon"><Icon name="wallet" size={20} /></span>
              <div className="fin-ref-kpi-body">
                <span className="fin-ref-kpi-label">Total Biaya Terpilih</span>
                <strong className="fin-ref-kpi-value">{formatRp(costSelectedTotal)}</strong>
                <span className="fin-ref-kpi-sub">Akumulasi • {selectedCostCodes.length} komponen APPROVED</span>
              </div>
            </div>
            <div className={`fin-ref-kpi is-margin ${margin >= 0 ? 'is-positive' : 'is-negative'}`}>
              <span className="fin-ref-kpi-icon"><Icon name="trend-up" size={20} /></span>
              <div className="fin-ref-kpi-body">
                <span className="fin-ref-kpi-label">Margin Bersih</span>
                <strong className="fin-ref-kpi-value">{formatRp(margin)}</strong>
                <span className={`fin-ref-kpi-sub ${margin >= 0 ? 'is-up' : 'is-down'}`}>{marginPercent == null ? '-' : formatPercent(marginPercent)} • {margin >= 0 ? 'Surplus' : 'Defisit'}</span>
              </div>
            </div>
            <div className="fin-ref-kpi is-ratio">
              <span className="fin-ref-kpi-icon"><Icon name="pie-chart" size={20} /></span>
              <div className="fin-ref-kpi-body">
                <span className="fin-ref-kpi-label">Rasio Biaya terhadap Pendapatan</span>
                <strong className="fin-ref-kpi-value">{costRatio == null ? '-' : formatPercent(costRatio)}</strong>
                <span className="fin-ref-kpi-sub">Akumulasi • Biaya / Pendapatan</span>
              </div>
            </div>
          </div>

          {/* Main chart + right summary */}
          <div className="fin-ref-main-grid">
            <section className="fin-ref-chart-main">
              <div className="fin-ref-chart-head">
                <div>
                  <span className="fin-ref-eyebrow">ANALITIK</span>
                  <h4>Perbandingan Akumulasi: Pendapatan Terpilih vs Biaya Terpilih</h4>
                  <p>{monthCount} bulan hingga {period} • Rupiah per bulan dari komponen terpilih</p>
                </div>
                <div className="fin-ref-legend">
                  <span><i className="dot rev" /> Pendapatan Terpilih</span>
                  <span><i className="dot cost" /> Biaya Terpilih</span>
                  <span><i className="dot margin" /> Margin Bersih</span>
                </div>
              </div>

              <div className="fin-trend-chart-body">
                <div className="fin-ref-yaxis" aria-hidden="true">
                  {chartTicks.map((t) => <span key={t}>{formatCompactRp(comparisonMax * t)}</span>)}
                </div>
                <div className="fin-trend-scroll">
                  <div
                    className="fin-trend-canvas"
                    style={{ minWidth: `${Math.max(560, monthlyTrend.length * 105)}px` }}
                    role="img"
                    aria-label={`Tren ${monthlyTrend.length} bulan Pendapatan Terpilih, Biaya Terpilih, dan Margin Bersih`}
                  >
                    <div className="fin-trend-grid" aria-hidden="true">
                      {chartTicks.map((tick) => <i key={tick} />)}
                    </div>
                    {monthlyTrend.length > 1 && (
                      <svg
                        className="fin-trend-line"
                        viewBox={`0 0 ${monthlyTrend.length * 100} 100`}
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <polyline points={linePoints} fill="none" vectorEffect="non-scaling-stroke" />
                      </svg>
                    )}
                    <div className="fin-trend-bars">
                      {monthlyTrend.map((row, index) => {
                        const marginTop = 100 - Math.max(0, Math.min(100, (row.margin / comparisonMax) * 100))
                        return (
                          <div className="fin-trend-month" key={row.periodMonth}>
                            <div className="fin-trend-month-bars">
                              <span className="fin-trend-bar is-revenue" style={{ height: `${(row.revenue / comparisonMax) * 100}%` }} title={`Pendapatan ${row.label}: ${formatRp(row.revenue)}`} />
                              <span className="fin-trend-bar is-cost" style={{ height: `${(row.cost / comparisonMax) * 100}%` }} title={`Biaya ${row.label}: ${formatRp(row.cost)}`} />
                            </div>
                            <span className="fin-trend-month-label">{row.label}</span>
                            <span
                              className={`fin-trend-point ${row.margin < 0 ? 'is-negative' : ''}`}
                              style={{ top: `${marginTop * 0.89}%`, left: `${((index + 0.5) / monthlyTrend.length) * 100}%` }}
                              title={`Margin ${row.label}: ${formatRp(row.margin)}`}
                            />
                          </div>
                        )
                      })}
                    </div>
                    {monthlyTrend.length === 0 && <span className="fin-trend-empty">Belum ada periode aktif pada rentang ini.</span>}
                  </div>
                </div>
              </div>
              <p className="fin-ref-chart-foot">Setiap bulan menjumlahkan seluruh komponen pendapatan dan biaya yang sedang dipilih; garis menunjukkan selisih keduanya.</p>
            </section>

            <aside className="fin-ref-summary">
              <div className="fin-ref-summary-head">
                <h5>Ringkasan Komponen Terpilih (Akumulasi)</h5>
                <span className="fin-ref-summary-sub">Periode {period}</span>
              </div>
              <div className="fin-ref-summary-section">
                <div className="fin-ref-summary-title"><span><i className="dot rev" /> Komponen Pendapatan Terpilih</span><strong>Total</strong></div>
                <div className="fin-ref-summary-list">
                  {revenueComponentsForDisplay.length === 0 && <span className="fin-ref-empty-row">Tidak ada komponen terpilih</span>}
                  {revenueComponentsForDisplay.map((r) => (
                    <span key={r.indicator_code} className="fin-ref-summary-row">
                      <span className="fin-ref-summary-name"><i className="dot rev sm" /> {r.indicator_name}</span>
                      <strong>{formatRp(r.amount)}</strong>
                    </span>
                  ))}
                </div>
                <div className="fin-ref-summary-total">
                  <span>Total Pendapatan Terpilih</span><strong>{formatRp(revenueSelectedTotal)}</strong>
                </div>
              </div>
              <div className="fin-ref-summary-section is-cost">
                <div className="fin-ref-summary-title"><span><i className="dot cost" /> Komponen Biaya Terpilih</span><strong>Total</strong></div>
                <div className="fin-ref-summary-list">
                  {costComponentsForDisplay.length === 0 && <span className="fin-ref-empty-row">Tidak ada komponen terpilih</span>}
                  {costComponentsForDisplay.map((c) => (
                    <span key={c.cost_code} className="fin-ref-summary-row">
                      <span className="fin-ref-summary-name"><i className="dot cost sm" /> {c.cost_label}</span>
                      <strong>{formatRp(c.amount)}</strong>
                    </span>
                  ))}
                </div>
                <div className="fin-ref-summary-total is-cost">
                  <span>Total Biaya Terpilih</span><strong>{formatRp(costSelectedTotal)}</strong>
                </div>
              </div>
              <div className="fin-ref-summary-foot">Nilai ditampilkan sebagai akumulasi dari item terpilih.</div>
            </aside>
          </div>

          {/* Bottom period table */}
          <section className="fin-ref-period">
            <div className="fin-ref-period-head">
              <h5>Ringkasan Akumulasi per Periode</h5>
              <span>{monthlyTrend.length} periode • Akumulasi komponen terpilih per bulan</span>
            </div>
            <DataTable className="fin-ref-table" frameClassName="fin-ref-table-wrap" sticky>
              <thead>
                <tr>
                  <th>Periode</th>
                  <th style={{ textAlign: 'right' }}>Pendapatan Terpilih (Akumulasi)</th>
                  <th style={{ textAlign: 'right' }}>Biaya Terpilih (Akumulasi)</th>
                  <th style={{ textAlign: 'right' }}>Margin Bersih (Akumulasi)</th>
                  <th style={{ textAlign: 'right' }}>Rasio Biaya / Pendapatan</th>
                </tr>
              </thead>
              <tbody>
                {monthlyTrend.map((row, index) => (
                  <tr className={index === monthlyTrend.length - 1 ? 'is-active' : ''} key={row.periodMonth}>
                    <td><strong>{row.label}</strong></td>
                    <td style={{ textAlign: 'right' }}>{formatRp(row.revenue)}</td>
                    <td style={{ textAlign: 'right' }}>{formatRp(row.cost)}</td>
                    <td style={{ textAlign: 'right' }}><span className={`fin-ref-margin-badge ${row.margin >= 0 ? 'is-pos' : 'is-neg'}`}>{formatRp(row.margin)}</span></td>
                    <td style={{ textAlign: 'right' }}>{row.ratio == null ? '-' : formatPercent(row.ratio)}</td>
                  </tr>
                ))}
                {monthlyTrend.length === 0 && <tr><td colSpan={5} className="fin-trend-table-empty">Belum ada periode aktif pada rentang ini.</td></tr>}
              </tbody>
            </DataTable>
            <div className={`fin-ref-period-insight ${margin >= 0 ? 'is-pos' : 'is-neg'}`}>
              <strong>{margin >= 0 ? 'Pendapatan masih berada di atas biaya operasional.' : 'Biaya operasional melampaui pendapatan terpilih.'}</strong>
              <span>Persentase perbandingan dihitung terhadap pendapatan terpilih akumulasi.</span>
            </div>
          </section>

          {/* Detailed breakdown keep for audit but compact */}
          <section className="vc-fin-section fin-ref-detail">
            <div className="vc-fin-section-title"><div><span>DETAIL</span><h4>Pembentuk Pendapatan &amp; Biaya (Audit)</h4></div></div>
            <div className="fin-ref-detail-grid">
              <DataTable className="vc-fin-table" frameClassName="vc-fin-table-wrap" sticky>
                <thead><tr><th>Kode</th><th>Komponen</th><th style={{ textAlign: 'right' }}>Pendapatan</th><th>Status</th></tr></thead>
                <tbody>
                  {revenueComponentsForDisplay.map((r) => (
                    <tr key={r.indicator_code}><td><strong>{r.indicator_code}</strong></td><td>{r.indicator_name}</td><td style={{ textAlign: 'right' }}>{formatRp(r.amount)}</td><td>{Number(r.missing_price_count) > 0 ? <span className="ui-status-badge ui-status-warning">Harga belum lengkap: {r.missing_price_count}</span> : <span className="ui-status-badge ui-status-success">Harga lengkap</span>}</td></tr>
                  ))}
                  {revenueComponentsForDisplay.length > 0 && <tr style={{ fontWeight: 700, background: 'var(--surface-subtle)' }}><td colSpan={2} style={{ textAlign: 'right' }}>TOTAL</td><td style={{ textAlign: 'right' }}>{formatRp(revenueSelectedTotal)}</td><td /></tr>}
                </tbody>
              </DataTable>
              <DataTable className="vc-fin-table" frameClassName="vc-fin-table-wrap" sticky>
                <thead><tr><th>Kode</th><th>Kategori</th><th style={{ textAlign: 'right' }}>Biaya</th><th style={{ textAlign: 'right' }}>Entri</th></tr></thead>
                <tbody>
                  {costComponentsForDisplay.map((c) => (
                    <tr key={c.cost_code}><td><strong>{c.cost_code}</strong></td><td>{c.cost_label}</td><td style={{ textAlign: 'right' }}>{formatRp(c.amount)}</td><td style={{ textAlign: 'right' }}>{c.entry_count}</td></tr>
                  ))}
                  {costComponentsForDisplay.length > 0 && <tr style={{ fontWeight: 700, background: 'var(--surface-subtle)' }}><td colSpan={2} style={{ textAlign: 'right' }}>TOTAL</td><td style={{ textAlign: 'right' }}>{formatRp(costSelectedTotal)}</td><td style={{ textAlign: 'right' }}>{costComponentsForDisplay.reduce((s, c) => s + Number(c.entry_count ?? 0), 0)}</td></tr>}
                </tbody>
              </DataTable>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
