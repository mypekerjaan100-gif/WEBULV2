import { useEffect, useRef, useState } from 'react'
import { getFinancialComparisonDashboard, periodLabelToMonth } from '../../data/variableCostRepository.js'
import { variableCostIndicators, slaPeriods } from '../../data/slaPelayananTeknik.js'
import { WORK_CATEGORIES } from '../../data/overtimeWorkL3.js'
import { REPLACEMENT_TYPES } from '../../data/overtimeReplacementL2.js'
import { Alert, KpiCard, StatePanel, DataTable, FilterBar, FilterField, Button } from '../ui/Primitives.jsx'

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

export default function FinancialComparisonDashboard({ contractId, up3Id, period, periods, onPeriodChange, units, orgMap }) {
  const [unitId, setUnitId] = useState(ALL_UNITS)
  const [selectedRevenueCodes, setSelectedRevenueCodes] = useState(() => REVENUE_ELIGIBLE.map((i) => i.code))
  const [selectedCostCodes, setSelectedCostCodes] = useState(() => COST_DEFINITIONS.map((c) => c.code))
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const periodMonth = periodLabelToMonth(period)
  const unitNames = new Map((units ?? []).map((u) => [u.uuid ?? u.id, u.displayName ?? u.name ?? u.uuid ?? u.id]))
  const authorizedUnitIds = (dashboard?.revenue_components ? [] : []) // will derive from units prop
  const displayUnits = (units ?? []).filter((u) => u.type === 'ULP' && u.parentUuid === (orgMap?.up3Uuid ?? up3Id) || u.type === 'ULP')
  // fallback: if orgMap missing, use units as passed
  const unitIdOptions = (units ?? []).filter((u) => u.type === 'ULP').map((u) => u.uuid ?? u.id)

  useEffect(() => {
    const cur = ++requestId.current
    if (!contractId || !up3Id || !periodMonth || !orgMap?.contractUuid || !orgMap?.up3Uuid) {
      if (!periodMonth) {
        setLoading(false)
        return
      }
      // wait for orgMap
      setLoading(true)
      return
    }
    setLoading(true)
    setError('')
    const pUp3 = orgMap.up3Uuid
    const pContract = orgMap.contractUuid
    const pUnit = unitId === ALL_UNITS ? null : unitId
    getFinancialComparisonDashboard({ contractId: pContract, up3Id: pUp3, periodMonth, unitId: pUnit })
      .then((res) => {
        if (cur !== requestId.current) return
        setDashboard(res)
      })
      .catch((e) => {
        if (cur !== requestId.current) return
        setDashboard(null)
        const msg = e?.message || 'Gagal memuat Dashboard Financial Comparison.'
        if (/Not authorized|42501/i.test(msg)) setError('Akses finansial tidak tersedia untuk peran ini.')
        else setError(msg)
      })
      .finally(() => {
        if (cur === requestId.current) setLoading(false)
      })
  }, [contractId, up3Id, periodMonth, unitId, orgMap?.contractUuid, orgMap?.up3Uuid])

  const revenueByCode = new Map((dashboard?.revenue_eligible_components ?? dashboard?.revenue_components ?? []).map((r) => [r.indicator_code, Number(r.amount ?? 0)]))
  const costByCode = new Map((dashboard?.cost_components ?? []).map((c) => [c.cost_code, Number(c.amount ?? 0)]))

  const revenueSelectedTotal = selectedRevenueCodes.reduce((sum, code) => sum + (revenueByCode.get(code) ?? 0), 0)
  const costSelectedTotal = selectedCostCodes.reduce((sum, code) => sum + (costByCode.get(code) ?? 0), 0)
  const margin = revenueSelectedTotal - costSelectedTotal
  const marginPercent = revenueSelectedTotal > 0 ? (margin / revenueSelectedTotal) * 100 : null
  const costRatio = revenueSelectedTotal > 0 ? (costSelectedTotal / revenueSelectedTotal) * 100 : null

  const comparisonMax = Math.max(1, revenueSelectedTotal, costSelectedTotal)
  const chartTicks = [1, 0.75, 0.5, 0.25, 0]
  const marginGaugePercent = marginPercent == null ? 0 : Math.min(100, Math.abs(marginPercent))
  const hasSelection = selectedRevenueCodes.length > 0 && selectedCostCodes.length > 0

  const toggleRevenue = (code) => {
    setSelectedRevenueCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
  }
  const toggleCost = (code) => {
    setSelectedCostCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
  }

  const selectAllRevenue = () => setSelectedRevenueCodes(REVENUE_ELIGIBLE.map((i) => i.code))
  const clearRevenue = () => setSelectedRevenueCodes([])
  const selectAllCost = () => setSelectedCostCodes(COST_DEFINITIONS.map((c) => c.code))
  const clearCost = () => setSelectedCostCodes([])

  const revenueComponentsForDisplay = (dashboard?.revenue_eligible_components ?? []).filter((r) => selectedRevenueCodes.includes(r.indicator_code))
  const costComponentsForDisplay = (dashboard?.cost_components ?? []).filter((c) => selectedCostCodes.includes(c.cost_code))

  return (
    <div className="vc-fin-dashboard fincomp-dashboard">
      <div className="vc-fin-dashboard-head">
        <div>
          <p className="vc-fin-eyebrow">FINANCIAL COMPARISON</p>
          <h3>Dashboard Financial Comparison</h3>
          <p className="vc-fin-subtitle">Perbandingan agregat Pendapatan Terpilih (Variable) vs Biaya Operasional Terpilih (Lembur — APPROVED) per periode.</p>
        </div>
        <FilterBar className="vc-fin-filters">
          <FilterField label="Periode">
            <select className="input-select" value={period} onChange={(e) => onPeriodChange?.(e.target.value)}>
              {(periods ?? slaPeriods).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </FilterField>
          <FilterField label="Scope / ULP">
            <select className="input-select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value={ALL_UNITS}>Semua ULP - Konsolidasi UP3</option>
              {(units ?? []).filter((u) => u.type === 'ULP').map((u) => {
                const id = u.uuid ?? u.id
                return <option key={id} value={id}>{u.displayName ?? u.name ?? id}</option>
              })}
            </select>
          </FilterField>
        </FilterBar>
      </div>

      <section className="vc-fin-section fincomp-selectors">
        <div className="fincomp-selector-head">
          <div>
            <h4>Komponen Pendapatan</h4>
            <small>{selectedRevenueCodes.length} dari {REVENUE_ELIGIBLE.length} terpilih - akan dijumlahkan menjadi <strong>satu total pendapatan</strong></small>
          </div>
          <div className="fincomp-selector-actions">
            <Button variant="secondary" size="small" onClick={selectAllRevenue}>Pilih Semua</Button>
            <Button variant="ghost" size="small" onClick={clearRevenue}>Kosongkan</Button>
          </div>
        </div>
        <div className="fincomp-chip-grid">
          {REVENUE_ELIGIBLE.map((ind) => (
            <label key={ind.code} className={`fincomp-chip ${selectedRevenueCodes.includes(ind.code) ? 'is-selected' : ''}`}>
              <input type="checkbox" checked={selectedRevenueCodes.includes(ind.code)} onChange={() => toggleRevenue(ind.code)} />
              <span>{ind.label ?? ind.code}</span>
              <small>{ind.code}</small>
            </label>
          ))}
        </div>
        <p className="fincomp-note">ROW Fix (3.1a) tidak termasuk pendapatan - disesuaikan dengan Variable Cost eligible.</p>
      </section>

      <section className="vc-fin-section fincomp-selectors">
        <div className="fincomp-selector-head">
          <div>
            <h4>Komponen Biaya Operasional</h4>
            <small>{selectedCostCodes.length} dari {COST_DEFINITIONS.length} terpilih - akan dijumlahkan menjadi <strong>satu total biaya</strong></small>
          </div>
          <div className="fincomp-selector-actions">
            <Button variant="secondary" size="small" onClick={selectAllCost}>Pilih Semua</Button>
            <Button variant="ghost" size="small" onClick={clearCost}>Kosongkan</Button>
          </div>
        </div>
        <div className="fincomp-chip-grid">
          {COST_DEFINITIONS.map((def) => (
            <label key={def.code} className={`fincomp-chip ${selectedCostCodes.includes(def.code) ? 'is-selected' : ''}`}>
              <input type="checkbox" checked={selectedCostCodes.includes(def.code)} onChange={() => toggleCost(def.code)} />
              <span>{def.label}</span>
              <small>{def.code}</small>
            </label>
          ))}
        </div>
        <p className="fincomp-note">Sumber Lembur: overtime_entries APPROVED - calculated_amount_snapshot agregat server-side.</p>
      </section>

      {error && <Alert tone="danger">{error}</Alert>}
      {loading && <StatePanel state="loading" title="Memuat Financial Comparison" />}
      {!loading && !error && dashboard && (
        <>
          {!hasSelection && <Alert tone="warning">Pilih minimal satu komponen Pendapatan dan satu komponen Biaya Operasional untuk melihat agregasi.</Alert>}

          <div className="vc-fin-kpis fincomp-kpis">
            <KpiCard className="vc-fin-kpi vc-fin-kpi-target" label="TOTAL PENDAPATAN TERPILIH" value={formatRp(revenueSelectedTotal)} helper={`${selectedRevenueCodes.length} komponen`} />
            <KpiCard className="vc-fin-kpi vc-fin-kpi-actual" label="TOTAL BIAYA OPERASIONAL TERPILIH" value={formatRp(costSelectedTotal)} helper={`${selectedCostCodes.length} komponen APPROVED`} />
            <KpiCard className="vc-fin-kpi" label="SELISIH / MARGIN" value={formatRp(margin)} helper={margin >= 0 ? 'Surplus' : 'Defisit'} />
            <KpiCard className="vc-fin-kpi" label="PERSENTASE MARGIN" value={marginPercent == null ? '-' : formatPercent(marginPercent)} helper={costRatio == null ? 'Biaya / Pendapatan' : `Efisiensi: ${formatPercent(costRatio)} biaya`} />
          </div>

          <section className="vc-fin-section fincomp-chart-section">
            <div className="vc-fin-section-title">
              <div>
                <span>AGREGASI</span>
                <h4>PENDAPATAN TERPILIH VS BIAYA TERPILIH</h4>
                <p className="fincomp-chart-subtitle">Nilai aktual periode berjalan dalam Rupiah</p>
              </div>
              <div className="vc-fin-legend fincomp-chart-legend" aria-label="Legenda diagram">
                <span><i className="is-target" /> Pendapatan</span>
                <span><i className="is-actual" /> Biaya Operasional</span>
              </div>
            </div>

            <div className="fincomp-chart-layout">
              <div className="fincomp-plot-card">
                <div className="fincomp-axis" aria-hidden="true">
                  {chartTicks.map((tick) => <span key={tick}>{formatCompactRp(comparisonMax * tick)}</span>)}
                </div>
                <div
                  className="fincomp-plot"
                  role="img"
                  aria-label={`Perbandingan Pendapatan ${formatRp(revenueSelectedTotal)} dan Biaya Operasional ${formatRp(costSelectedTotal)}`}
                >
                  <div className="fincomp-grid" aria-hidden="true">
                    {chartTicks.map((tick) => <i key={tick} />)}
                  </div>

                  <div className="fincomp-metric" tabIndex={0} aria-label={`Pendapatan Terpilih ${formatRp(revenueSelectedTotal)}`}>
                    <div className="fincomp-tooltip" role="tooltip">
                      <strong>Pendapatan Terpilih</strong>
                      <span>{formatRp(revenueSelectedTotal)}</span>
                      <small>Akumulasi {selectedRevenueCodes.length} komponen pendapatan</small>
                    </div>
                    <strong className="fincomp-column-value">{formatCompactRp(revenueSelectedTotal)}</strong>
                    <div className="fincomp-column-track">
                      <span className="fincomp-column is-revenue" style={{ height: `${(revenueSelectedTotal / comparisonMax) * 100}%` }} />
                    </div>
                    <div className="fincomp-column-label"><span>Pendapatan</span><small>Terpilih</small></div>
                  </div>

                  <div className="fincomp-metric" tabIndex={0} aria-label={`Biaya Operasional Terpilih ${formatRp(costSelectedTotal)}`}>
                    <div className="fincomp-tooltip" role="tooltip">
                      <strong>Biaya Operasional Terpilih</strong>
                      <span>{formatRp(costSelectedTotal)}</span>
                      <small>Akumulasi {selectedCostCodes.length} komponen Lembur APPROVED</small>
                    </div>
                    <strong className="fincomp-column-value">{formatCompactRp(costSelectedTotal)}</strong>
                    <div className="fincomp-column-track">
                      <span className="fincomp-column is-cost" style={{ height: `${(costSelectedTotal / comparisonMax) * 100}%` }} />
                    </div>
                    <div className="fincomp-column-label"><span>Biaya Operasional</span><small>Terpilih</small></div>
                  </div>
                </div>
              </div>

              <aside
                className={`fincomp-margin-panel ${margin >= 0 ? 'is-positive' : 'is-negative'}`}
                tabIndex={0}
                aria-label={`${margin >= 0 ? 'Surplus' : 'Defisit'} ${formatRp(margin)}, persentase margin ${formatPercent(marginPercent)}`}
              >
                <div className="fincomp-margin-head">
                  <span>Margin / Selisih</span>
                  <strong>{margin >= 0 ? 'Surplus' : 'Defisit'}</strong>
                </div>
                <div className="fincomp-margin-gauge" style={{ '--gauge-value': `${marginGaugePercent * 3.6}deg` }}>
                  <div className="fincomp-tooltip fincomp-margin-tooltip" role="tooltip">
                    <strong>Margin / Selisih</strong>
                    <span>{formatRp(margin)}</span>
                    <small>Pendapatan dikurangi Biaya Operasional</small>
                  </div>
                  <div className="fincomp-margin-center"><strong>{formatPercent(marginPercent)}</strong><span>Margin</span></div>
                </div>
                <strong className="fincomp-margin-value">{formatRp(margin)}</strong>
                <p>{marginPercent == null ? 'Persentase belum tersedia karena pendapatan bernilai nol.' : `${formatPercent(costRatio)} dari pendapatan digunakan untuk biaya operasional.`}</p>
                <div className="fincomp-margin-formula">
                  <span>Pendapatan</span><strong>{formatCompactRp(revenueSelectedTotal)}</strong>
                  <span>Biaya</span><strong>{formatCompactRp(costSelectedTotal)}</strong>
                </div>
              </aside>
            </div>

            <div className={`fincomp-insight ${margin >= 0 ? 'is-positive' : 'is-negative'}`}>
              <strong>{margin >= 0 ? 'Pendapatan masih berada di atas biaya operasional.' : 'Biaya operasional melampaui pendapatan terpilih.'}</strong>
              <span>{marginPercent == null ? 'Margin tidak dihitung ketika pendapatan bernilai nol.' : `Margin periode ini ${formatPercent(marginPercent)} dari pendapatan terpilih.`}</span>
            </div>
          </section>

          <section className="vc-fin-section">
            <div className="vc-fin-section-title"><div><span>RINCIAN</span><h4>PEMBENTUK PENDAPATAN TERPILIH</h4></div></div>
            <DataTable className="vc-fin-table" frameClassName="vc-fin-table-wrap" sticky>
              <thead><tr><th>Kode</th><th>Komponen</th><th style={{ textAlign: 'right' }}>Pendapatan Agregat</th><th>Status Harga</th></tr></thead>
              <tbody>
                {revenueComponentsForDisplay.length === 0 ? <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Tidak ada komponen terpilih</td></tr> : revenueComponentsForDisplay.map((r) => (
                  <tr key={r.indicator_code}>
                    <td><strong>{r.indicator_code}</strong></td>
                    <td>{r.indicator_name}</td>
                    <td style={{ textAlign: 'right' }}>{formatRp(r.amount)}</td>
                    <td>{Number(r.missing_price_count) > 0 ? <span className="ui-status-badge ui-status-warning">Harga belum lengkap: {r.missing_price_count}</span> : <span className="ui-status-badge ui-status-success">Harga lengkap</span>}</td>
                  </tr>
                ))}
                {revenueComponentsForDisplay.length > 0 && (
                  <tr style={{ fontWeight: 700, background: 'var(--surface-subtle)' }}><td colSpan={2} style={{ textAlign: 'right' }}>TOTAL</td><td style={{ textAlign: 'right' }}>{formatRp(revenueSelectedTotal)}</td><td /></tr>
                )}
              </tbody>
            </DataTable>
          </section>

          <section className="vc-fin-section">
            <div className="vc-fin-section-title"><div><span>RINCIAN</span><h4>PEMBENTUK BIAYA OPERASIONAL TERPILIH</h4></div></div>
            <DataTable className="vc-fin-table" frameClassName="vc-fin-table-wrap" sticky>
              <thead><tr><th>Kode</th><th>Kategori Lembur</th><th style={{ textAlign: 'right' }}>Biaya Agregat APPROVED</th><th style={{ textAlign: 'right' }}>Aktivitas</th><th style={{ textAlign: 'right' }}>Entri</th></tr></thead>
              <tbody>
                {costComponentsForDisplay.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Tidak ada komponen terpilih</td></tr> : costComponentsForDisplay.map((c) => (
                  <tr key={c.cost_code}>
                    <td><strong>{c.cost_code}</strong></td>
                    <td>{c.cost_label}</td>
                    <td style={{ textAlign: 'right' }}>{formatRp(c.amount)}</td>
                    <td style={{ textAlign: 'right' }}>{c.activity_count}</td>
                    <td style={{ textAlign: 'right' }}>{c.entry_count}</td>
                  </tr>
                ))}
                {costComponentsForDisplay.length > 0 && (
                  <tr style={{ fontWeight: 700, background: 'var(--surface-subtle)' }}><td colSpan={2} style={{ textAlign: 'right' }}>TOTAL</td><td style={{ textAlign: 'right' }}>{formatRp(costSelectedTotal)}</td><td style={{ textAlign: 'right' }}>{costComponentsForDisplay.reduce((s, c) => s + Number(c.activity_count ?? 0), 0)}</td><td style={{ textAlign: 'right' }}>{costComponentsForDisplay.reduce((s, c) => s + Number(c.entry_count ?? 0), 0)}</td></tr>
                )}
              </tbody>
            </DataTable>
          </section>
        </>
      )}
    </div>
  )
}
