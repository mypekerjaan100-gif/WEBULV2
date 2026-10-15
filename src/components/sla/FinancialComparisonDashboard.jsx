import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchIndicators, getFinancialComparisonDashboard, getFinancialComparisonTrend, listVariableUnitPrices, periodLabelToMonth } from '../../data/variableCostRepository.js'
import { fetchSpreadsheetSummary, realizationForUnit, SPREADSHEET_INDICATOR_CODES } from '../../data/spreadsheetVariableCost.js'
import { variableCostIndicators, slaPeriods } from '../../data/slaPelayananTeknik.js'
import { WORK_CATEGORIES } from '../../data/overtimeWorkL3.js'
import { REPLACEMENT_TYPES } from '../../data/overtimeReplacementL2.js'
import Icon from '../Icon.jsx'
import { Alert, DataTable, Button } from '../ui/Primitives.jsx'

const ALL_UNITS = 'ALL'

// 3.1a tidak ditagihkan, jadi tidak direkonsiliasi sebagai pendapatan.
const SPREADSHEET_BILLABLE_CODES = SPREADSHEET_INDICATOR_CODES.filter((code) => code !== '3.1a')

// Akhir periode YYYY-MM-01 -> YYYY-MM-DD hari terakhir (sama dengan Rekap).
function periodEndOf(periodMonth) {
  const match = String(periodMonth ?? '').match(/^(\d{4})-(0[1-9]|1[0-2])-01$/)
  if (!match) return periodMonth
  const end = new Date(Number(match[1]), Number(match[2]), 0)
  return `${match[1]}-${match[2]}-${String(end.getDate()).padStart(2, '0')}`
}

function SnapshotSkeleton() {
  return (
    <div className="fin-ref-loading" aria-busy="true">
      <p className="fin-ref-loading-status" role="status">Menyiapkan Dashboard Finansial… Memuat pendapatan, biaya, harga satuan, dan realisasi spreadsheet.</p>
      <div className="fin-ref-kpis" aria-hidden="true">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="fin-ref-kpi"><span className="vc-skeleton" style={{ width: '55%', height: 12 }} /><span className="vc-skeleton" style={{ width: '70%', height: 26 }} /><span className="vc-skeleton" style={{ width: '60%', height: 12 }} /></div>
        ))}
      </div>
      <div className="fin-ref-main-grid" aria-hidden="true">
        <section className="fin-ref-chart-main">
          <div className="vc-skeleton" style={{ width: '40%', height: 14 }} />
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="vc-skeleton-row" style={{ marginTop: 8 }}><span className="vc-skeleton" style={{ flex: 1 }} /><span className="vc-skeleton" style={{ flex: 1 }} /><span className="vc-skeleton" style={{ flex: 1 }} /></div>
          ))}
        </section>
        <aside className="fin-ref-summary">
          <div className="vc-skeleton" style={{ width: '60%', height: 14 }} />
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="vc-skeleton-row" style={{ marginTop: 8 }}><span className="vc-skeleton" style={{ flex: 2 }} /><span className="vc-skeleton" style={{ flex: 1 }} /></div>
          ))}
        </aside>
      </div>
    </div>
  )
}

function TrendSkeleton({ monthCount }) {
  return (
    <div className="fin-ref-loading" aria-busy="true">
      <p className="fin-ref-loading-status" role="status">Memuat tren {monthCount} bulan…</p>
      <div className="fin-trend-chart-body" aria-hidden="true">
        <div className="fin-ref-yaxis"><span className="vc-skeleton" style={{ width: 44, height: 12 }} /><span className="vc-skeleton" style={{ width: 44, height: 12 }} /><span className="vc-skeleton" style={{ width: 44, height: 12 }} /></div>
        <div className="fin-trend-scroll"><div className="vc-skeleton" style={{ width: '100%', height: 220 }} /></div>
      </div>
    </div>
  )
}

const COST_DEFINITIONS = [
  { code: 'ADMINISTRASI', label: WORK_CATEGORIES.ADMINISTRASI.label },
  { code: 'GARDU', label: WORK_CATEGORIES.GARDU.label },
  { code: 'JTM', label: WORK_CATEGORIES.JTM.label },
  { code: 'JTR', label: WORK_CATEGORIES.JTR.label },
  { code: 'ROW', label: WORK_CATEGORIES.ROW.label },
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

function selectedTotals(snapshot, revenueCodes, costCodes, revenueOverrides = null) {
  const revenueByCode = new Map((snapshot?.revenue_eligible_components ?? snapshot?.revenue_components ?? []).map((row) => [row.indicator_code, row]))
  const costByCode = new Map((snapshot?.cost_components ?? []).map((row) => [row.cost_code, Number(row.amount ?? 0)]))
  let revenue = 0
  let revenueMissingPrice = 0
  let revenueSheetMissing = 0
  for (const code of revenueCodes) {
    if (revenueOverrides && Object.prototype.hasOwnProperty.call(revenueOverrides, code)) {
      const override = revenueOverrides[code]
      revenue += Number(override.amount ?? 0)
      revenueMissingPrice += Number(override.missingPrice ?? 0)
      revenueSheetMissing += Number(override.sheetMissing ?? 0)
    } else {
      const row = revenueByCode.get(code)
      // Kode tanpa baris server = realisasi nol yang terverifikasi (tidak ada transaksi APPROVED).
      revenue += Number(row?.amount ?? 0)
      revenueMissingPrice += Number(row?.missing_price_count ?? 0)
    }
  }
  const cost = costCodes.reduce((sum, code) => sum + (costByCode.get(code) ?? 0), 0)
  const complete = revenueMissingPrice === 0 && revenueSheetMissing === 0
  return {
    revenue,
    cost,
    margin: complete ? revenue - cost : null,
    ratio: complete && revenue > 0 ? (cost / revenue) * 100 : null,
    revenueMissingPrice,
    revenueSheetMissing,
    complete,
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
  const [snapLoading, setSnapLoading] = useState(true)
  const [trendLoading, setTrendLoading] = useState(true)
  const [snapError, setSnapError] = useState('')
  const [trendError, setTrendError] = useState('')
  const [revenuePickerOpen, setRevenuePickerOpen] = useState(false)
  const [costPickerOpen, setCostPickerOpen] = useState(false)
  // Rekonsiliasi spreadsheet untuk bulan terpilih (sama dengan Rekap).
  const [sheetSummaries, setSheetSummaries] = useState({})
  const [sheetErrors, setSheetErrors] = useState({})
  const [reconLoading, setReconLoading] = useState(true)
  const [unitPrices, setUnitPrices] = useState([])
  const [unitPriceError, setUnitPriceError] = useState('')
  const [indicatorIdByCode, setIndicatorIdByCode] = useState(new Map())
  const [loadedSnapKey, setLoadedSnapKey] = useState('')
  const [loadedTrendKey, setLoadedTrendKey] = useState('')
  const snapRequestId = useRef(0)
  const trendRequestId = useRef(0)
  const reconRequestId = useRef(0)
  const periodMonth = periodLabelToMonth(period)
  const pContract = orgMap?.contractUuid ?? null
  const pUp3 = orgMap?.up3Uuid ?? null
  const scopeKey = `${pContract ?? ''}::${pUp3 ?? ''}`
  const prevScopeKey = useRef(scopeKey)
  const snapKey = `${pContract ?? ''}::${pUp3 ?? ''}::${periodMonth ?? ''}::${unitId}`
  const trendKey = `${snapKey}::${monthCount}`
  const unitNames = useMemo(() => new Map((units ?? []).map((u) => [u.uuid ?? u.id, u.displayName ?? u.name])), [units])

  // Reset filter ULP saat scope kontrak/UP3 berubah.
  useEffect(() => {
    if (prevScopeKey.current !== scopeKey) {
      prevScopeKey.current = scopeKey
      setUnitId(ALL_UNITS)
    }
  }, [scopeKey])

  // Snapshot bulan terpilih (independen dari tren).
  useEffect(() => {
    const cur = ++snapRequestId.current
    if (!pContract || !pUp3 || !periodMonth) {
      if (!periodMonth) { setSnapLoading(false); return }
      setSnapLoading(true)
      return () => { }
    }
    setSnapLoading(true)
    setSnapError('')
    const pUnit = unitId === ALL_UNITS ? null : unitId
    let cancelled = false
    getFinancialComparisonDashboard({ contractId: pContract, up3Id: pUp3, periodMonth, unitId: pUnit })
      .then((snapshot) => {
        if (cancelled || cur !== snapRequestId.current) return
        setDashboard(snapshot)
        setLoadedSnapKey(snapKey)
      })
      .catch((e) => {
        if (cancelled || cur !== snapRequestId.current) return
        setDashboard(null)
        const msg = e?.message || 'Gagal memuat Dashboard Finansial.'
        if (/Not authorized|42501/i.test(msg)) setSnapError('Akses finansial tidak tersedia untuk peran ini.')
        else setSnapError(msg)
      })
      .finally(() => { if (!cancelled && cur === snapRequestId.current) setSnapLoading(false) })
    return () => { cancelled = true }
  }, [pContract, pUp3, periodMonth, unitId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Harga akhir periode + realisasi spreadsheet + pemetaan indikator untuk rekonsiliasi.
  useEffect(() => {
    const cur = ++reconRequestId.current
    if (!pContract || !pUp3 || !periodMonth) return () => { }
    setReconLoading(true)
    setSheetErrors({})
    setUnitPriceError('')
    let cancelled = false
    const pricePromise = listVariableUnitPrices({ contractId: pContract, up3Id: pUp3, asOf: periodEndOf(periodMonth) })
      .then((rows) => ({ rows: rows ?? [], error: '' }))
      .catch((err) => ({ rows: [], error: err?.message || 'Gagal memuat harga satuan.' }))
    const indicatorPromise = fetchIndicators({ contractId: pContract, up3Id: pUp3 })
      .then((rows) => ({ rows: rows ?? [], error: '' }))
      .catch(() => ({ rows: [], error: '' }))
    const sheetPromises = SPREADSHEET_BILLABLE_CODES.map((code) => fetchSpreadsheetSummary({ indicator: code, period: periodMonth })
      .then((summary) => ({ code, summary, error: '' }))
      .catch((err) => ({ code, summary: null, error: err?.message || 'Data spreadsheet gagal dimuat.' })))
    Promise.all([pricePromise, indicatorPromise, ...sheetPromises]).then(([priceResult, indicatorResult, ...results]) => {
      if (cancelled || cur !== reconRequestId.current) return
      setUnitPrices(priceResult.rows ?? [])
      setUnitPriceError(priceResult.error ?? '')
      setIndicatorIdByCode(new Map((indicatorResult.rows ?? []).map((row) => [row.point_code, row.id])))
      const nextSummaries = {}
      const nextErrors = {}
      for (const item of results) {
        if (item.summary) nextSummaries[item.code] = item.summary
        if (item.error && !item.summary) nextErrors[item.code] = item.error
      }
      setSheetSummaries(nextSummaries)
      setSheetErrors(nextErrors)
      setReconLoading(false)
    })
    return () => { cancelled = true }
  }, [pContract, pUp3, periodMonth])

  // Tren historis (independen dari snapshot).
  useEffect(() => {
    const cur = ++trendRequestId.current
    if (!pContract || !pUp3 || !periodMonth) return () => { }
    setTrendLoading(true)
    setTrendError('')
    const pUnit = unitId === ALL_UNITS ? null : unitId
    let cancelled = false
    getFinancialComparisonTrend({ contractId: pContract, up3Id: pUp3, endPeriodMonth: periodMonth, unitId: pUnit, monthCount })
      .then((trendRows) => {
        if (cancelled || cur !== trendRequestId.current) return
        setTrend(trendRows ?? [])
        setLoadedTrendKey(trendKey)
      })
      .catch((loadError) => {
        if (cancelled || cur !== trendRequestId.current) return
        setTrend([])
        setTrendError(loadError?.message || 'Gagal memuat tren finansial.')
      })
      .finally(() => { if (!cancelled && cur === trendRequestId.current) setTrendLoading(false) })
    return () => { cancelled = true }
  }, [pContract, pUp3, periodMonth, unitId, monthCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // Override pendapatan spreadsheet untuk bulan terpilih: realisasi × harga akhir bulan.
  const revenueOverrides = useMemo(() => {
    const overrides = {}
    if (!pContract || !pUp3 || !periodMonth) return overrides
    const priceByIndicatorId = new Map((unitPrices ?? []).map((row) => [row.indicator_id, Number(row.unit_price)]))
    const scopedUnitName = unitId === ALL_UNITS ? null : unitNames.get(unitId)
    for (const code of SPREADSHEET_BILLABLE_CODES) {
      const summaryData = sheetSummaries[code]
      if (!summaryData) {
        overrides[code] = { amount: 0, missingPrice: 0, sheetMissing: 1 }
        continue
      }
      const indicatorId = indicatorIdByCode.get(code)
      const price = indicatorId ? priceByIndicatorId.get(indicatorId) : null
      if (price == null || Number.isNaN(price)) {
        overrides[code] = { amount: 0, missingPrice: 1, sheetMissing: 0 }
        continue
      }
      const realization = scopedUnitName ? realizationForUnit(summaryData, scopedUnitName) : Number(summaryData.realization ?? 0)
      overrides[code] = { amount: Number(realization ?? 0) * price, missingPrice: 0, sheetMissing: 0 }
    }
    return overrides
  }, [pContract, pUp3, periodMonth, sheetSummaries, unitPrices, indicatorIdByCode, unitId, unitNames])

  const isSnapReady = !snapLoading && !reconLoading
  const snapStale = loadedSnapKey !== '' && loadedSnapKey !== snapKey
  const showSnapResults = isSnapReady && !snapError && dashboard && !snapStale
  const currentTotals = selectedTotals(dashboard, selectedRevenueCodes, selectedCostCodes, revenueOverrides)
  const revenueSelectedTotal = currentTotals.revenue
  const costSelectedTotal = currentTotals.cost
  const margin = currentTotals.margin
  const marginPercent = currentTotals.complete && revenueSelectedTotal > 0 ? (margin / revenueSelectedTotal) * 100 : null
  const costRatio = currentTotals.ratio
  const revenueIncomplete = !currentTotals.complete || Object.keys(sheetErrors ?? {}).length > 0 || Boolean(unitPriceError)
  const hasSelection = selectedRevenueCodes.length > 0 && selectedCostCodes.length > 0
  const figuresFinal = hasSelection && !revenueIncomplete
  const trendProvisional = selectedRevenueCodes.some((code) => SPREADSHEET_BILLABLE_CODES.includes(code))

  const monthlyTrend = trend.map((snapshot) => ({
    periodMonth: snapshot.period_month,
    label: formatTrendMonth(snapshot.period_month),
    ...selectedTotals(snapshot, selectedRevenueCodes, selectedCostCodes),
  }))
  const trendStale = loadedTrendKey !== '' && loadedTrendKey !== trendKey
  const showTrendResults = !trendLoading && !trendError && !trendStale
  const comparisonMax = Math.max(1, ...monthlyTrend.flatMap((row) => [row.revenue, row.cost, Math.abs(row.margin ?? 0)]))
  // Sumbu signed: nol di tengah agar defisit terlihat magnitudonya.
  const chartTicks = [1, 0.5, 0, -0.5, -1]
  const marginY = (value) => {
    if (value == null) return null
    return 50 - (Number(value) / comparisonMax) * 50
  }
  const lineSegments = []
  {
    let current = []
    monthlyTrend.forEach((row, index) => {
      const y = marginY(row.margin)
      if (y == null) {
        if (current.length > 1) lineSegments.push(current)
        current = []
        return
      }
      current.push(`${index * 100 + 50},${y}`)
      if (index === monthlyTrend.length - 1 && current.length > 1) lineSegments.push(current)
    })
  }
  const trendHasGap = monthlyTrend.some((row) => row.margin == null)
  const pointTop = (value) => {
    const y = marginY(value)
    if (y == null) return undefined
    return `calc(8px + ${(y / 100).toFixed(4)} * (100% - 38px))`
  }

  const toggleRevenue = (code) => setSelectedRevenueCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
  const toggleCost = (code) => setSelectedCostCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
  const selectAllRevenue = () => setSelectedRevenueCodes(REVENUE_ELIGIBLE.map((i) => i.code))
  const clearRevenue = () => setSelectedRevenueCodes([])
  const selectAllCost = () => setSelectedCostCodes(COST_DEFINITIONS.map((c) => c.code))
  const clearCost = () => setSelectedCostCodes([])
  // Filter langsung diterapkan saat diubah; Terapkan menutup pemilih, Reset mengembalikan baseline.
  const applyFilters = () => { setRevenuePickerOpen(false); setCostPickerOpen(false) }
  const resetFilters = () => { selectAllRevenue(); selectAllCost(); setUnitId(ALL_UNITS); setMonthCount(6); setRevenuePickerOpen(false); setCostPickerOpen(false) }

  // Tampilan ringkasan dibangun dari kode terpilih (scaffold), bukan hanya baris server.
  const revenueServerByCode = new Map(((dashboard?.revenue_eligible_components ?? [])).map((r) => [r.indicator_code, r]))
  const revenueComponentsForDisplay = selectedRevenueCodes.map((code) => {
    const server = revenueServerByCode.get(code)
    const override = Object.prototype.hasOwnProperty.call(revenueOverrides, code) ? revenueOverrides[code] : null
    const label = REVENUE_LABEL.get(code) ?? server?.indicator_name ?? code
    if (override) {
      return {
        indicator_code: code,
        indicator_name: label,
        amount: override.amount,
        missing_price_count: override.missingPrice,
        sheet_missing_count: override.sheetMissing,
        status: override.sheetMissing > 0 ? 'sheet-missing' : override.missingPrice > 0 ? 'price-missing' : 'ok',
      }
    }
    return {
      indicator_code: code,
      indicator_name: label,
      amount: Number(server?.amount ?? 0),
      missing_price_count: Number(server?.missing_price_count ?? 0),
      sheet_missing_count: 0,
      status: server ? (Number(server?.missing_price_count ?? 0) > 0 ? 'price-missing' : 'ok') : 'no-data',
    }
  })
  const costServerByCode = new Map(((dashboard?.cost_components ?? [])).map((c) => [c.cost_code, c]))
  const costComponentsForDisplay = selectedCostCodes.map((code) => {
    const server = costServerByCode.get(code)
    return {
      cost_code: code,
      cost_label: COST_LABEL.get(code) ?? server?.cost_label ?? code,
      amount: Number(server?.amount ?? 0),
      entry_count: Number(server?.entry_count ?? 0),
      hasData: Boolean(server),
    }
  })
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

            <div className="fin-ref-filter-actions">
              <Button variant="primary" size="small" className="fin-ref-btn-apply" icon={<Icon name="filter" size={13} />} onClick={applyFilters}>Terapkan Perbandingan</Button>
              <Button variant="ghost" size="small" className="fin-ref-btn-reset" onClick={resetFilters}>Reset Filter</Button>
            </div>
          </div>
        </div>
      </section>

      {snapError && <Alert tone="danger">{snapError}</Alert>}
      {(snapLoading || reconLoading) && !snapError && <SnapshotSkeleton />}
      {showSnapResults && (
        <>
          {!hasSelection && <Alert tone="warning">Pilih minimal satu komponen Pendapatan dan satu komponen Biaya Operasional untuk melihat agregasi.</Alert>}
          {hasSelection && revenueIncomplete && <Alert tone="warning">Data pendapatan belum lengkap (spreadsheet atau harga satuan belum tersedia). Margin dan rasio belum final.</Alert>}
          {hasSelection && trendProvisional && <Alert tone="warning">Komponen spreadsheet memakai realisasi spreadsheet × harga akhir bulan untuk bulan {period}. Tren historis masih berbasis transaksi database dan dapat berbeda.</Alert>}

          {/* KPI - 4 premium (bulan terpilih) */}
          <div className="fin-ref-kpis" aria-busy={false}>
            <div className="fin-ref-kpi is-revenue">
              <span className="fin-ref-kpi-icon"><Icon name="chart-bar" size={20} /></span>
              <div className="fin-ref-kpi-body">
                <span className="fin-ref-kpi-label">Total Pendapatan Terpilih</span>
                <strong className="fin-ref-kpi-value">{!hasSelection ? '-' : formatRp(revenueSelectedTotal)}</strong>
                <span className="fin-ref-kpi-sub">Bulan {period} • {selectedRevenueCodes.length} komponen</span>
              </div>
            </div>
            <div className="fin-ref-kpi is-cost">
              <span className="fin-ref-kpi-icon"><Icon name="wallet" size={20} /></span>
              <div className="fin-ref-kpi-body">
                <span className="fin-ref-kpi-label">Total Biaya Terpilih</span>
                <strong className="fin-ref-kpi-value">{!hasSelection ? '-' : formatRp(costSelectedTotal)}</strong>
                <span className="fin-ref-kpi-sub">Bulan {period} • {selectedCostCodes.length} komponen APPROVED non-hapus</span>
              </div>
            </div>
            <div className={`fin-ref-kpi is-margin ${margin != null && margin >= 0 ? 'is-positive' : margin != null ? 'is-negative' : ''}`}>
              <span className="fin-ref-kpi-icon"><Icon name="trend-up" size={20} /></span>
              <div className="fin-ref-kpi-body">
                <span className="fin-ref-kpi-label">Selisih Pendapatan vs Biaya Terpilih</span>
                <strong className="fin-ref-kpi-value">{!hasSelection || margin == null ? (!hasSelection ? '-' : 'Belum lengkap') : formatRp(margin)}</strong>
                <span className={`fin-ref-kpi-sub ${margin != null && margin >= 0 ? 'is-up' : margin != null ? 'is-down' : ''}`}>{!hasSelection || marginPercent == null ? (!hasSelection ? 'Pilih komponen' : 'Belum lengkap') : `${formatPercent(marginPercent)} • ${margin >= 0 ? (revenueSelectedTotal === 0 && costSelectedTotal === 0 ? 'Belum ada realisasi' : 'Surplus') : 'Defisit'}`}</span>
              </div>
            </div>
            <div className="fin-ref-kpi is-ratio">
              <span className="fin-ref-kpi-icon"><Icon name="pie-chart" size={20} /></span>
              <div className="fin-ref-kpi-body">
                <span className="fin-ref-kpi-label">Rasio Biaya terhadap Pendapatan</span>
                <strong className="fin-ref-kpi-value">{costRatio == null ? '-' : formatPercent(costRatio)}</strong>
                <span className="fin-ref-kpi-sub">Bulan {period} • Biaya / Pendapatan</span>
              </div>
            </div>
          </div>

          {/* Main chart + right summary */}
          <div className="fin-ref-main-grid">
            <section className="fin-ref-chart-main">
              <div className="fin-ref-chart-head">
                <div>
                  <span className="fin-ref-eyebrow">ANALITIK</span>
                  <h4>Perbandingan Bulanan: Pendapatan Terpilih vs Biaya Terpilih</h4>
                  <p>{monthCount} bulan hingga {period} • Rupiah per bulan dari komponen terpilih (tidak diakumulasi antar bulan)</p>
                </div>
                <div className="fin-ref-legend">
                  <span><i className="dot rev" /> Pendapatan Terpilih</span>
                  <span><i className="dot cost" /> Biaya Terpilih</span>
                  <span><i className="dot margin" /> Selisih per Bulan</span>
                </div>
              </div>

              {trendError && <Alert tone="danger">{trendError}</Alert>}
              {trendLoading ? <TrendSkeleton monthCount={monthCount} /> : !trendError && (
              <div className="fin-trend-chart-body">
                <div className="fin-ref-yaxis" aria-hidden="true">
                  {chartTicks.map((t) => <span key={t}>{t === 0 ? 'Rp 0' : formatCompactRp(comparisonMax * t)}</span>)}
                </div>
                <div className="fin-trend-scroll">
                  <div
                    className="fin-trend-canvas fin-trend-canvas-signed"
                    style={{ minWidth: `${Math.max(560, monthlyTrend.length * 105)}px` }}
                    role="img"
                    aria-label={`Tren ${monthlyTrend.length} bulan Pendapatan Terpilih, Biaya Terpilih, dan Selisih per Bulan`}
                  >
                    <div className="fin-trend-grid" aria-hidden="true">
                      {chartTicks.map((tick) => <i key={tick} className={tick === 0 ? 'is-zero' : ''} />)}
                    </div>
                    <i className="fin-trend-zero" aria-hidden="true" />
                    {lineSegments.map((points, seg) => (
                      <svg
                        key={seg}
                        className="fin-trend-line"
                        viewBox={`0 0 ${monthlyTrend.length * 100} 100`}
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <polyline points={points.join(' ')} fill="none" vectorEffect="non-scaling-stroke" />
                      </svg>
                    ))}
                    <div className="fin-trend-bars">
                      {monthlyTrend.map((row, index) => (
                          <div className="fin-trend-month" key={row.periodMonth}>
                            <div className="fin-trend-month-bars is-signed">
                              <span className="fin-trend-bar is-revenue" style={{ height: `${(row.revenue / comparisonMax) * 50}%` }} title={`Pendapatan ${row.label}: ${formatRp(row.revenue)}`} />
                              <span className="fin-trend-bar is-cost" style={{ height: `${(row.cost / comparisonMax) * 50}%` }} title={`Biaya ${row.label}: ${formatRp(row.cost)}`} />
                            </div>
                            <span className="fin-trend-month-label">{row.label}</span>
                            {row.margin != null && (
                            <span
                              className={`fin-trend-point ${row.margin < 0 ? 'is-negative' : ''}`}
                              style={{ top: pointTop(row.margin), left: `${((index + 0.5) / monthlyTrend.length) * 100}%` }}
                              title={`Selisih ${row.label}: ${formatRp(row.margin)}`}
                            />
                            )}
                          </div>
                        )
                      )}
                    </div>
                    {monthlyTrend.length === 0 && <span className="fin-trend-empty">Belum ada periode aktif pada rentang ini.</span>}
                  </div>
                </div>
              </div>
              )}
              <p className="fin-ref-chart-foot">Setiap bulan menjumlahkan komponen pendapatan dan biaya yang sedang dipilih; garis menunjukkan selisih bulan tersebut. Garis terputus berarti selisih bulan itu belum lengkap.</p>
            </section>

            <aside className="fin-ref-summary">
              <div className="fin-ref-summary-head">
                <h5>Ringkasan Komponen Terpilih (Bulan {period})</h5>
                <span className="fin-ref-summary-sub">Periode {period}</span>
              </div>
              <div className="fin-ref-summary-section">
                <div className="fin-ref-summary-title"><span><i className="dot rev" /> Komponen Pendapatan Terpilih</span><strong>Total</strong></div>
                <div className="fin-ref-summary-list">
                  {selectedRevenueCodes.length === 0 && <span className="fin-ref-empty-row">Belum ada komponen dipilih — buka pemilih komponen di atas.</span>}
                  {selectedRevenueCodes.length > 0 && revenueComponentsForDisplay.map((r) => (
                    <span key={r.indicator_code} className="fin-ref-summary-row">
                      <span className="fin-ref-summary-name"><i className="dot rev sm" /> {r.indicator_name}</span>
                      <strong>{r.status === 'sheet-missing' ? 'Menunggu spreadsheet' : r.status === 'price-missing' ? 'Harga belum tersedia' : r.status === 'no-data' ? 'Rp 0 (belum ada realisasi)' : formatRp(r.amount)}</strong>
                    </span>
                  ))}
                </div>
                <div className="fin-ref-summary-total">
                  <span>Total Pendapatan Terpilih</span><strong>{!hasSelection ? '-' : formatRp(revenueSelectedTotal)}</strong>
                </div>
              </div>
              <div className="fin-ref-summary-section is-cost">
                <div className="fin-ref-summary-title"><span><i className="dot cost" /> Komponen Biaya Terpilih</span><strong>Total</strong></div>
                <div className="fin-ref-summary-list">
                  {selectedCostCodes.length === 0 && <span className="fin-ref-empty-row">Belum ada komponen dipilih — buka pemilih komponen di atas.</span>}
                  {selectedCostCodes.length > 0 && costComponentsForDisplay.map((c) => (
                    <span key={c.cost_code} className="fin-ref-summary-row">
                      <span className="fin-ref-summary-name"><i className="dot cost sm" /> {c.cost_label}</span>
                      <strong>{c.hasData ? formatRp(c.amount) : 'Rp 0 (belum ada realisasi)'}</strong>
                    </span>
                  ))}
                </div>
                <div className="fin-ref-summary-total is-cost">
                  <span>Total Biaya Terpilih</span><strong>{!hasSelection ? '-' : formatRp(costSelectedTotal)}</strong>
                </div>
              </div>
              <div className="fin-ref-summary-foot">Nilai bulan {period} dari item terpilih. Biaya hanya dari entri APPROVED yang belum dihapus.</div>
            </aside>
          </div>

          {/* Bottom period table */}
          <section className="fin-ref-period">
            <div className="fin-ref-period-head">
              <h5>Ringkasan per Periode (Nilai Bulanan)</h5>
              <span>{monthlyTrend.length} periode • Nilai bulanan komponen terpilih</span>
            </div>
            {trendError && <Alert tone="danger">{trendError}</Alert>}
            {trendLoading ? <TrendSkeleton monthCount={monthCount} /> : !trendError && (
            <>
            <DataTable className="fin-ref-table" frameClassName="fin-ref-table-wrap" sticky>
              <thead>
                <tr>
                  <th>Periode</th>
                  <th style={{ textAlign: 'right' }}>Pendapatan Terpilih (Bulan)</th>
                  <th style={{ textAlign: 'right' }}>Biaya Terpilih (Bulan)</th>
                  <th style={{ textAlign: 'right' }}>Selisih (Bulan)</th>
                  <th style={{ textAlign: 'right' }}>Rasio Biaya / Pendapatan</th>
                </tr>
              </thead>
              <tbody>
                {monthlyTrend.map((row, index) => (
                  <tr className={index === monthlyTrend.length - 1 ? 'is-active' : ''} key={row.periodMonth}>
                    <td><strong>{row.label}</strong></td>
                    <td style={{ textAlign: 'right' }}>{formatRp(row.revenue)}</td>
                    <td style={{ textAlign: 'right' }}>{formatRp(row.cost)}</td>
                    <td style={{ textAlign: 'right' }}>{row.margin == null ? 'Belum lengkap' : <span className={`fin-ref-margin-badge ${row.margin >= 0 ? 'is-pos' : 'is-neg'}`}>{formatRp(row.margin)}</span>}</td>
                    <td style={{ textAlign: 'right' }}>{row.ratio == null ? '-' : formatPercent(row.ratio)}</td>
                  </tr>
                ))}
                {monthlyTrend.length === 0 && <tr><td colSpan={5} className="fin-trend-table-empty">Belum ada periode aktif pada rentang ini.</td></tr>}
              </tbody>
            </DataTable>
            <div className={`fin-ref-period-insight ${!hasSelection || margin == null ? '' : margin >= 0 ? 'is-pos' : 'is-neg'}`}>
              <strong>{!hasSelection ? 'Pilih komponen pendapatan dan biaya untuk melihat kesimpulan.' : margin == null ? 'Data belum lengkap — selisih bulan ini belum dapat disimpulkan.' : revenueSelectedTotal === 0 && costSelectedTotal === 0 ? 'Belum ada realisasi pendapatan maupun biaya pada bulan ini.' : margin >= 0 ? 'Pendapatan terpilih bulan ini berada di atas biaya terpilih.' : 'Biaya terpilih bulan ini melampaui pendapatan terpilih.'}</strong>
              <span>Persentase dihitung terhadap pendapatan terpilih bulan {period}.</span>
            </div>
            </>
            )}
          </section>

          {/* Detailed breakdown keep for audit but compact */}
          <section className="vc-fin-section fin-ref-detail">
            <div className="vc-fin-section-title"><div><span>DETAIL</span><h4>Pembentuk Pendapatan &amp; Biaya (Audit)</h4></div></div>
            <div className="fin-ref-detail-grid">
              <DataTable className="vc-fin-table" frameClassName="vc-fin-table-wrap" sticky>
                <thead><tr><th>Kode</th><th>Komponen</th><th style={{ textAlign: 'right' }}>Pendapatan</th><th>Status</th></tr></thead>
                <tbody>
                  {revenueComponentsForDisplay.map((r) => (
                    <tr key={r.indicator_code}><td><strong>{r.indicator_code}</strong></td><td>{r.indicator_name}</td><td style={{ textAlign: 'right' }}>{r.status === 'sheet-missing' || r.status === 'price-missing' ? 'Belum lengkap' : formatRp(r.amount)}</td><td>{r.status === 'price-missing' ? <span className="ui-status-badge ui-status-warning">Harga belum lengkap</span> : r.status === 'sheet-missing' ? <span className="ui-status-badge ui-status-warning">Menunggu spreadsheet</span> : r.status === 'no-data' ? <span className="ui-status-badge">Belum ada realisasi</span> : <span className="ui-status-badge ui-status-success">Harga lengkap</span>}</td></tr>
                  ))}
                  {revenueComponentsForDisplay.length > 0 && <tr style={{ fontWeight: 700, background: 'var(--surface-subtle)' }}><td colSpan={2} style={{ textAlign: 'right' }}>TOTAL</td><td style={{ textAlign: 'right' }}>{revenueIncomplete ? 'Belum lengkap' : formatRp(revenueSelectedTotal)}</td><td /></tr>}
                </tbody>
              </DataTable>
              <DataTable className="vc-fin-table" frameClassName="vc-fin-table-wrap" sticky>
                <thead><tr><th>Kode</th><th>Kategori</th><th style={{ textAlign: 'right' }}>Biaya</th><th style={{ textAlign: 'right' }}>Entri</th></tr></thead>
                <tbody>
                  {costComponentsForDisplay.map((c) => (
                    <tr key={c.cost_code}><td><strong>{c.cost_code}</strong></td><td>{c.cost_label}</td><td style={{ textAlign: 'right' }}>{c.hasData ? formatRp(c.amount) : 'Rp 0 (belum ada realisasi)'}</td><td style={{ textAlign: 'right' }}>{c.entry_count}</td></tr>
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
