import { useEffect, useMemo, useRef, useState } from 'react'
import { getVariableFinancialDashboard, getVariableFinancialTrend, listVariableUnitPrices, periodLabelToMonth } from '../../data/variableCostRepository.js'
import { fetchSpreadsheetSummary, realizationForUnit, SPREADSHEET_INDICATOR_CODES } from '../../data/spreadsheetVariableCost.js'
import { variableCostLabelsByCode } from '../../data/slaPelayananTeknik.js'
import { Alert, Button, DataTable, FilterBar, FilterField, KpiCard, Modal, StatePanel, StatusBadge } from '../ui/Primitives.jsx'

const ALL_UNITS = 'ALL'
// 3.1a tidak ditagihkan di Rekap, jadi tidak direkonsiliasi sebagai pendapatan.
const SPREADSHEET_BILLABLE_CODES = SPREADSHEET_INDICATOR_CODES.filter((code) => code !== '3.1a')

// Akhir periode YYYY-MM-01 -> YYYY-MM-DD hari terakhir (sama dengan Rekap).
function periodEndOf(periodMonth) {
  const match = String(periodMonth ?? '').match(/^(\d{4})-(0[1-9]|1[0-2])-01$/)
  if (!match) return periodMonth
  const end = new Date(Number(match[1]), Number(match[2]), 0)
  return `${match[1]}-${match[2]}-${String(end.getDate()).padStart(2, '0')}`
}

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

function indicatorLabel(indicator) {
  return variableCostLabelsByCode[indicator?.indicator_code] ?? indicator?.indicator_name ?? '-'
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
  const [sheetSummaries, setSheetSummaries] = useState({})
  const [sheetErrors, setSheetErrors] = useState({})
  const [sheetLoading, setSheetLoading] = useState(false)
  const [unitPrices, setUnitPrices] = useState([])
  const [unitPriceError, setUnitPriceError] = useState('')
  const requestId = useRef(0)
  const trendRequestId = useRef(0)
  const sheetRequestId = useRef(0)
  const scopeKey = `${contractId ?? ''}::${up3Id ?? ''}`
  const prevScopeKey = useRef(scopeKey)
  const periodMonth = periodLabelToMonth(period)
  const unitNames = new Map(units.map((unit) => [unit.uuid, unit.displayName]))

  // Reset filter ULP saat scope kontrak/UP3 berubah agar tidak memakai unit kadaluarsa.
  useEffect(() => {
    if (prevScopeKey.current !== scopeKey) {
      prevScopeKey.current = scopeKey
      setUnitId(ALL_UNITS)
      setAuthorizedUnitIds([])
      setSelectedIndicator(null)
    }
  }, [scopeKey])

  // Muat harga akhir periode + realisasi spreadsheet untuk rekonsiliasi dengan Rekap.
  useEffect(() => {
    if (!contractId || !up3Id || !periodMonth) return
    const currentRequest = ++sheetRequestId.current
    setSheetLoading(true)
    setSheetErrors({})
    setUnitPriceError('')
    const pricePromise = listVariableUnitPrices({ contractId, up3Id, asOf: periodEndOf(periodMonth) })
      .then((rows) => ({ rows: rows ?? [], error: '' }))
      .catch((err) => ({ rows: [], error: err?.message || 'Gagal memuat harga satuan.' }))
    const sheetPromises = SPREADSHEET_BILLABLE_CODES.map((code) => fetchSpreadsheetSummary({ indicator: code, period: periodMonth })
      .then((summary) => ({ code, summary, error: '' }))
      .catch((err) => ({ code, summary: null, error: err?.message || 'Data spreadsheet gagal dimuat.' })))
    Promise.all([pricePromise, ...sheetPromises]).then(([priceResult, ...results]) => {
      if (currentRequest !== sheetRequestId.current) return
      setUnitPrices(priceResult.rows ?? [])
      setUnitPriceError(priceResult.error ?? '')
      const nextSummaries = {}
      const nextErrors = {}
      for (const item of results) {
        if (item.summary) nextSummaries[item.code] = item.summary
        if (item.error && !item.summary) nextErrors[item.code] = item.error
      }
      setSheetSummaries(nextSummaries)
      setSheetErrors(nextErrors)
      setSheetLoading(false)
    })
    return () => {}
  }, [contractId, up3Id, periodMonth])

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

  // Validasi filter ULP terhadap daftar resmi agar tidak memakai unit di luar scope.
  useEffect(() => {
    if (unitId !== ALL_UNITS && authorizedUnitIds.length > 0 && !authorizedUnitIds.includes(unitId)) {
      setUnitId(ALL_UNITS)
    }
  }, [unitId, authorizedUnitIds])

  const reconciledDashboard = useMemo(() => {
    if (!dashboard) return null
    const priceByIndicatorId = new Map((unitPrices ?? []).map((row) => [row.indicator_id, Number(row.unit_price)]))
    const indicatorIdByCode = new Map((dashboard.indicators ?? []).map((row) => [row.indicator_code, row.indicator_id]))
    const localUnitNames = new Map((units ?? []).map((unit) => [unit.uuid, unit.displayName]))
    const cells = (dashboard.cells ?? []).map((cell) => {
      if (!SPREADSHEET_BILLABLE_CODES.includes(cell.indicator_code)) {
        return { ...cell, sheet_missing_count: 0 }
      }
      const summaryData = sheetSummaries[cell.indicator_code]
      if (!summaryData) {
        return { ...cell, actual_amount: 0, missing_price_count: 0, sheet_missing_count: 1 }
      }
      const indicatorId = indicatorIdByCode.get(cell.indicator_code) ?? cell.indicator_id
      const price = indicatorId ? priceByIndicatorId.get(indicatorId) : null
      if (price == null || Number.isNaN(price)) {
        return { ...cell, actual_amount: 0, missing_price_count: 1, sheet_missing_count: 0 }
      }
      const realization = realizationForUnit(summaryData, localUnitNames.get(cell.unit_id))
      return { ...cell, actual_amount: Number(realization ?? 0) * price, missing_price_count: 0, sheet_missing_count: 0 }
    })
    const finalize = (rows, keyFn) => {
      const grouped = new Map()
      for (const cell of cells) {
        const key = keyFn(cell)
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key).push(cell)
      }
      return [...grouped.values()].map((group) => {
        const first = group[0]
        const targetAmount = group.filter((c) => c.target_amount != null).reduce((sum, c) => sum + Number(c.target_amount), 0)
        const actualAmount = group.reduce((sum, c) => sum + Number(c.actual_amount ?? 0), 0)
        const missingTarget = group.filter((c) => c.target_missing).length
        const missingPrice = group.reduce((sum, c) => sum + Number(c.missing_price_count ?? 0), 0)
        const sheetMissing = group.reduce((sum, c) => sum + Number(c.sheet_missing_count ?? 0), 0)
        const configured = group.filter((c) => !c.target_missing).length
        const complete = missingTarget === 0 && missingPrice === 0 && sheetMissing === 0
        return {
          ...first,
          target_amount: targetAmount,
          actual_amount: actualAmount,
          missing_target_count: missingTarget,
          missing_price_count: missingPrice,
          sheet_missing_count: sheetMissing,
          configured_target_count: configured,
          difference_amount: complete ? actualAmount - targetAmount : null,
          achievement_percent: complete && targetAmount > 0 ? (actualAmount / targetAmount) * 100 : null,
        }
      })
    }
    const indicatorRows = finalize(cells, (c) => c.indicator_code).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    const unitRows = finalize(cells, (c) => c.unit_id)
    const targetAmount = cells.filter((c) => c.target_amount != null).reduce((sum, c) => sum + Number(c.target_amount), 0)
    const actualAmount = cells.reduce((sum, c) => sum + Number(c.actual_amount ?? 0), 0)
    const missingTarget = cells.filter((c) => c.target_missing).length
    const missingPrice = cells.reduce((sum, c) => sum + Number(c.missing_price_count ?? 0), 0)
    const sheetMissing = cells.reduce((sum, c) => sum + Number(c.sheet_missing_count ?? 0), 0)
    const configured = cells.filter((c) => !c.target_missing).length
    const complete = missingTarget === 0 && missingPrice === 0 && sheetMissing === 0
    return {
      ...dashboard,
      cells,
      indicators: indicatorRows,
      units: unitRows,
      summary: {
        ...(dashboard.summary ?? {}),
        target_amount: targetAmount,
        actual_amount: actualAmount,
        missing_target_count: missingTarget,
        missing_price_count: missingPrice,
        sheet_missing_count: sheetMissing,
        configured_target_count: configured,
        difference_amount: complete ? actualAmount - targetAmount : null,
        achievement_percent: complete && targetAmount > 0 ? (actualAmount / targetAmount) * 100 : null,
      },
    }
  }, [dashboard, sheetSummaries, unitPrices, units])

  const displayDashboard = reconciledDashboard ?? dashboard
  const summary = displayDashboard?.summary ?? {}
  const incompleteTargets = Number(summary.missing_target_count ?? 0) > 0
  const missingPrices = Number(summary.missing_price_count ?? 0) > 0
  const sheetIncompleteCount = Number(summary.sheet_missing_count ?? 0)
  const sheetErrorCount = Object.keys(sheetErrors ?? {}).length
  const sheetPending = sheetLoading && Object.keys(sheetSummaries ?? {}).length === 0
  const financialIncomplete = incompleteTargets || missingPrices || sheetIncompleteCount > 0 || sheetErrorCount > 0 || sheetPending || Boolean(unitPriceError)
  const maxUnitAmount = Math.max(1, ...(displayDashboard?.units ?? []).flatMap((row) => [Number(row.target_amount ?? 0), Number(row.actual_amount ?? 0)]))
  const detailCells = selectedIndicator
    ? (displayDashboard?.cells ?? []).filter((cell) => cell.indicator_code === selectedIndicator.indicator_code)
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
    if (Number(row.sheet_missing_count ?? 0) > 0) return 'Data spreadsheet belum lengkap'
    if (row.achievement_percent == null) return 'Target Rp0'
    return Number(row.achievement_percent) >= 100 ? 'Target tercapai' : 'Belum tercapai'
  }
  const achievementTone = (status) => status === 'Target tercapai' ? 'success' : status === 'Belum tercapai' ? 'danger' : 'warning'

  return (
    <div className="vc-fin-dashboard">
      <div className="vc-fin-dashboard-head">
        <div>
          <p className="vc-fin-eyebrow">FINANCIAL PERFORMANCE</p>
          <h3>Dashboard Finansial Variable Cost</h3>
          <p className="vc-fin-subtitle">Target dan realisasi pendapatan terkonfirmasi per periode.</p>
        </div>
        <FilterBar className="vc-fin-filters">
          <FilterField label="Periode">
            <select className="input-select" value={period} disabled={loading} onChange={(event) => onPeriodChange?.(event.target.value)}>
              {periods.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </FilterField>
          <FilterField label="Scope / ULP">
            <select className="input-select" value={unitId} disabled={loading} onChange={(event) => setUnitId(event.target.value)}>
              <option value={ALL_UNITS}>Semua ULP - Konsolidasi UP3</option>
              {authorizedUnitIds.map((id) => <option key={id} value={id}>{unitNames.get(id) ?? id}</option>)}
            </select>
          </FilterField>
        </FilterBar>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {loading && <StatePanel state="loading" title="Memuat Dashboard Finansial" />}
      {!loading && !error && displayDashboard && (
        <>
          <div className="vc-fin-warnings">
            {incompleteTargets && <Alert tone="warning">Target pendapatan belum lengkap: {summary.missing_target_count} item</Alert>}
            {missingPrices && <Alert tone="warning">Harga belum tersedia: {summary.missing_price_count} transaksi</Alert>}
            {sheetIncompleteCount > 0 && <Alert tone="warning">Data spreadsheet belum lengkap: {sheetIncompleteCount} sel menunggu ringkasan spreadsheet.</Alert>}
            {sheetErrorCount > 0 && <Alert tone="warning">Spreadsheet gagal dimuat untuk {sheetErrorCount} indikator ({Object.keys(sheetErrors).join(', ')}). Angka indikator tersebut ditampilkan sebagai Rp0 sementara.</Alert>}
            {unitPriceError && <Alert tone="warning">Harga satuan gagal dimuat: {unitPriceError}</Alert>}
            {sheetPending && <Alert tone="warning">Memuat realisasi spreadsheet… angka realisasi masih sementara.</Alert>}
          </div>

          <div className="vc-fin-kpis">
            <KpiCard className="vc-fin-kpi vc-fin-kpi-target" label={incompleteTargets ? 'TARGET TERKONFIGURASI' : 'TARGET PENDAPATAN'} value={formatRp(summary.target_amount)} helper={`${summary.configured_target_count ?? 0} dari ${(Number(summary.configured_target_count ?? 0) + Number(summary.missing_target_count ?? 0))} item`} />
            <KpiCard className="vc-fin-kpi vc-fin-kpi-actual" label="REALISASI PENDAPATAN TERKONFIRMASI" value={sheetPending ? 'Memuat…' : formatRp(summary.actual_amount)} helper="Spreadsheet × harga akhir bulan + APPROVED + Konstruksi" />
            <KpiCard className="vc-fin-kpi" label="SELISIH" value={financialIncomplete ? 'Belum lengkap' : formatRp(summary.difference_amount)} helper="Realisasi dikurangi target" />
            <KpiCard className="vc-fin-kpi" label="PENCAPAIAN" value={financialIncomplete ? 'Belum lengkap' : formatPercent(summary.achievement_percent)} helper={achievementStatus(summary)} />
          </div>

          <section className="vc-fin-section">
            <div className="vc-fin-section-title">
              <div><span>PER ULP</span><h4>TARGET VS REALISASI PER ULP</h4></div>
              <div className="vc-fin-legend"><i className="is-target" /> Target <i className="is-actual" /> Realisasi</div>
            </div>
            <div className="vc-fin-chart">
              {(displayDashboard.units ?? []).map((row) => (
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
            <DataTable className="vc-fin-table" frameClassName="vc-fin-table-wrap" sticky>
                <thead><tr><th>Kegiatan</th><th>Target Pendapatan</th><th>Realisasi Pendapatan</th><th>Selisih</th><th>Pencapaian</th><th>Status</th></tr></thead>
                <tbody>
                  {(displayDashboard.indicators ?? []).map((row) => {
                    const incomplete = Number(row.missing_target_count) > 0 || Number(row.missing_price_count) > 0 || Number(row.sheet_missing_count ?? 0) > 0
                    return (
                      <tr key={row.indicator_code}>
                        <td><button type="button" className="vc-fin-indicator-link" onClick={() => setSelectedIndicator(row)}>{indicatorLabel(row)}</button></td>
                        <td>{formatRp(row.target_amount)}{Number(row.missing_target_count) > 0 && <small> Target terkonfigurasi</small>}</td>
                        <td>{formatRp(row.actual_amount)}</td>
                        <td>{incomplete ? 'Belum lengkap' : formatRp(row.difference_amount)}</td>
                        <td>{incomplete ? 'Belum lengkap' : formatPercent(row.achievement_percent)}</td>
                        <td><StatusBadge status={achievementStatus(row)} tone={achievementTone(achievementStatus(row))}>{achievementStatus(row)}</StatusBadge></td>
                      </tr>
                    )
                  })}
                </tbody>
            </DataTable>
          </section>

          <section className="vc-fin-section vc-fin-trend-section">
            <div className="vc-fin-section-title">
              <div>
                <span>HISTORIS</span>
                <h4>TREN TARGET VS REALISASI - {trendMonthCount} BULAN</h4>
                {previousMonthChange != null && <p className={`vc-fin-trend-insight ${previousMonthChange >= 0 ? 'is-up' : 'is-down'}`}>Realisasi {formatRp(currentTrendMonth.actual_amount)}: {previousMonthChange >= 0 ? '+' : ''}{previousMonthChange.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% vs {formatMonth(previousTrendMonth.period_month)}</p>}
              </div>
              <div className="vc-fin-trend-controls" aria-label="Rentang tren">
                {[6,12].map((count) => <Button key={count} variant={trendMonthCount === count ? 'primary' : 'secondary'} size="small" disabled={trendLoading} onClick={() => setTrendMonthCount(count)}>{count} Bulan</Button>)}
              </div>
            </div>

            {trendError && <Alert tone="danger">{trendError}</Alert>}
            <Alert tone="warning">Tren historis masih berbasis transaksi database APPROVED. Untuk indikator spreadsheet (2.1a–2.1d, 3.1b, 3.2b), angka tren dapat berbeda dari Rekap Bulanan dan KPI di atas yang sudah memakai realisasi spreadsheet × harga akhir bulan.</Alert>
            {trendLoading ? <StatePanel state="loading" title="Memuat tren finansial" /> : !trendError && (
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

                <DataTable className="vc-fin-table" frameClassName="vc-fin-table-wrap vc-fin-trend-table-wrap" sticky>
                    <thead><tr><th>Periode</th><th>Target</th><th>Realisasi</th><th>Selisih</th><th>Pencapaian</th><th>Status</th></tr></thead>
                    <tbody>{trendMonths.map((row) => {
                      const targetIncomplete = !row.target_complete
                      const priceMissing = Number(row.missing_price_count) > 0
                      const status = !row.has_data ? 'Belum ada data' : targetIncomplete ? 'Target Belum Lengkap' : priceMissing ? 'Harga Belum Lengkap' : row.achievement_percent == null ? 'Target Rp0' : Number(row.achievement_percent) >= 100 ? 'Tercapai' : 'Belum Tercapai'
                      return <tr key={row.period_month}><td>{formatMonth(row.period_month)}</td><td>{row.has_data ? formatRp(row.target_amount) : '-'}{row.has_data && targetIncomplete && <small>{row.configured_target_count} / {row.required_target_count} target</small>}</td><td>{row.has_data ? formatRp(row.actual_amount) : '-'}</td><td>{row.has_data && !targetIncomplete && !priceMissing ? formatRp(row.difference_amount) : '-'}</td><td>{row.has_data && !targetIncomplete && !priceMissing ? formatPercent(row.achievement_percent) : '-'}</td><td><StatusBadge status={status} tone={status === 'Tercapai' ? 'success' : status === 'Belum Tercapai' ? 'danger' : 'warning'}>{status}</StatusBadge>{priceMissing && <small>Harga belum tersedia: {row.missing_price_count} transaksi</small>}</td></tr>
                    })}</tbody>
                </DataTable>
              </>
            )}
          </section>
        </>
      )}

      <Modal open={Boolean(selectedIndicator)} onClose={() => setSelectedIndicator(null)} title={`${indicatorLabel(selectedIndicator)} - Rincian per ULP`} size="large">
        {selectedIndicator && (
              <DataTable className="vc-fin-table" frameClassName="vc-fin-table-wrap" sticky>
                  <thead><tr><th>ULP</th><th>Target</th><th>Realisasi</th><th>Selisih</th><th>Pencapaian</th><th>Aksi</th></tr></thead>
                  <tbody>{detailCells.map((cell) => {
                    const incomplete = cell.target_missing || Number(cell.missing_price_count) > 0 || Number(cell.sheet_missing_count ?? 0) > 0
                    const isSheetSourced = SPREADSHEET_BILLABLE_CODES.includes(cell.indicator_code)
                    const contributingIds = cell.actual_indicator_ids?.length ? cell.actual_indicator_ids : [cell.indicator_id]
                    return <tr key={cell.unit_id}><td>{unitNames.get(cell.unit_id) ?? cell.unit_id}</td><td>{cell.target_missing ? 'Target belum diatur' : formatRp(cell.target_amount)}</td><td>{formatRp(cell.actual_amount)}</td><td>{incomplete ? 'Belum lengkap' : formatRp(cell.difference_amount)}</td><td>{incomplete ? 'Belum lengkap' : formatPercent(cell.achievement_percent)}</td><td>{cell.source_type === 'UNIT_RATE' && !isSheetSourced ? <Button variant="secondary" size="small" onClick={() => onOpenTransactions?.(cell.indicator_code, cell.unit_id, contributingIds)}>Transaksi APPROVED</Button> : isSheetSourced ? <small>Spreadsheet</small> : '-'}</td></tr>
                  })}</tbody>
              </DataTable>
        )}
      </Modal>
    </div>
  )
}
