import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { variableCostIndicators } from '../../data/slaPelayananTeknik.js'
import {
  periodLabelToMonth, fetchMonthlyTargets, fetchIndicators, fetchActiveVersion,
  fetchKonstruksiMonthlyAmounts, fetchKonstruksiMonthlyTargets, setVariableTarget,
  setKonstruksiMonthlyAmounts, setKonstruksiMonthlyTargets, getShortLabel,
  listVariableMonthlyActuals, saveVariableMonthlyActuals, listVariableMonthlyHistory, getVariableFinancialDashboard,
} from '../../data/variableCostRepository.js'
import {
  VARIABLE_MONTHLY_INDICATORS, monthlyDraftsFromRows, monthlyDraftIsDirty, monthlyChanges,
  monthlyInputNumber, monthlyAchievement, aggregateMonthlyValues, sumMonthlyField,
} from '../../data/variableMonthlyActuals.js'
import MasterHargaSatuan from './MasterHargaSatuan.jsx'
import TargetPendapatanVariable from './TargetPendapatanVariable.jsx'
import VariableFinancialDashboard from './VariableFinancialDashboard.jsx'
import { Alert, Button, DataTable, FilterBar, FilterField, Modal, StatePanel, Tabs } from '../ui/Primitives.jsx'
import Icon from '../Icon.jsx'

const ALL_KEY = 'ALL'
const STANDARD_8 = VARIABLE_MONTHLY_INDICATORS.filter((indicator) => indicator.slaLinked)
const EMPTY_VALUE = '—'

function formatNumber(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? EMPTY_VALUE : Number(value).toLocaleString('id-ID', { maximumFractionDigits: 4 })
}
function formatRp(value) {
  if (value == null || !Number.isFinite(Number(value))) return EMPTY_VALUE
  return `${Number(value) < 0 ? '-' : ''}Rp ${Math.abs(Number(value)).toLocaleString('id-ID', { maximumFractionDigits: 2 })}`
}
function formatPercent(value) {
  return value == null ? EMPTY_VALUE : `${Number(value).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`
}
function draftNumber(value) {
  try { return monthlyInputNumber(value) } catch { return null }
}

export default function SLAVariableCost({
  period, periods = [], onPeriodChange, orgMap, role, unitId,
  canInputMonthly = false, isManagementReadOnly = false, canManageKonstruksiMonthly = false,
  canViewVariableFinancial = false, onEditorStateChange, onSaved,
}) {
  const contractId = orgMap?.contractUuid
  const up3Uuid = orgMap?.up3Uuid
  const units = orgMap?.units ?? []
  const childUlps = useMemo(() => (orgMap?.units ?? []).filter((unit) => unit.type === 'ULP' && unit.parentUuid === orgMap?.up3Uuid && (unit.status ?? 'Aktif') === 'Aktif'), [orgMap])
  const unitIdsKey = childUlps.map((unit) => unit.uuid).join(',')
  const isUp3Role = role === 'up3'
  const [selectedUnitId, setSelectedUnitId] = useState(ALL_KEY)
  const ownUnit = units.find((unit) => unit.uuid === unitId || unit.legacyKey === unitId)
  const effectiveUnit = isUp3Role ? childUlps.find((unit) => unit.uuid === selectedUnitId) : ownUnit
  const isConsolidated = isUp3Role && selectedUnitId === ALL_KEY
  const effectiveUnitUuid = effectiveUnit?.uuid ?? null
  const canEditMonthly = canInputMonthly && role === 'ulp' && Boolean(effectiveUnitUuid) && !isManagementReadOnly
  const canEditTargets = isUp3Role && !isManagementReadOnly
  const periodMonth = periodLabelToMonth(period)
  const scopeKey = `${contractId ?? ''}:${up3Uuid ?? ''}:${periodMonth ?? ''}:${isConsolidated ? ALL_KEY : effectiveUnitUuid ?? ''}:${canViewVariableFinancial}`
  const scopeKeyRef = useRef(scopeKey)
  scopeKeyRef.current = scopeKey
  const [activeTab, setActiveTab] = useState('rekap')
  const [data, setData] = useState(null)
  const [loadedKey, setLoadedKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const requestId = useRef(0)
  const variableConfigMenuRef = useRef(null)
  const [drillIndicator, setDrillIndicator] = useState(null)
  const [historyScope, setHistoryScope] = useState(null)
  const [historyRows, setHistoryRows] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const historyRequestId = useRef(0)
  const [targetUnitId, setTargetUnitId] = useState('')
  const [targetDrafts, setTargetDrafts] = useState({})
  const [targetBusyPoint, setTargetBusyPoint] = useState('')
  const [targetError, setTargetError] = useState('')
  const [targetMessage, setTargetMessage] = useState('')
  const [konstruksiDrafts, setKonstruksiDrafts] = useState({})
  const [konstruksiTargetDrafts, setKonstruksiTargetDrafts] = useState({})
  const [konstruksiBusy, setKonstruksiBusy] = useState(false)
  const [konstruksiError, setKonstruksiError] = useState('')
  const [konstruksiMessage, setKonstruksiMessage] = useState('')
  const isCurrent = loadedKey === scopeKey
  const monthlyRows = isCurrent ? data?.monthly ?? [] : []
  const financialUnitIds = isCurrent && data?.financial ? new Set(data.financial.units.map((unit) => unit.unit_id)) : null
  const scopedUnits = isConsolidated ? childUlps.filter((unit) => !financialUnitIds || financialUnitIds.has(unit.uuid)) : effectiveUnit ? [effectiveUnit] : []
  const scopedUnitIds = scopedUnits.map((unit) => unit.uuid)
  const versionId = isCurrent ? data?.versionId : null
  const monthlyDirty = canEditMonthly && isCurrent && monthlyDraftIsDirty(drafts, monthlyRows, effectiveUnitUuid)
  const konstruksiOpen = drillIndicator?.code === '3.1c'
  const konstruksiDirty = konstruksiOpen && canManageKonstruksiMonthly && scopedUnits.some((unit) =>
    (konstruksiDrafts[unit.uuid] ?? '') !== String(data?.konstruksiAmounts.find((row) => row.unit_id === unit.uuid)?.amount_rp ?? '')
    || (konstruksiTargetDrafts[unit.uuid] ?? '') !== String(data?.konstruksiTargets.find((row) => row.unit_id === unit.uuid)?.target_rp ?? ''))
  const busy = saving || konstruksiBusy || Boolean(targetBusyPoint)
  const dirty = monthlyDirty || konstruksiDirty

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      const menu = variableConfigMenuRef.current
      if (menu?.open && !menu.contains(event.target)) menu.open = false
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && variableConfigMenuRef.current?.open) variableConfigMenuRef.current.open = false
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useEffect(() => {
    onEditorStateChange?.({ dirty, busy })
    return () => onEditorStateChange?.({ dirty: false, busy: false })
  }, [dirty, busy, onEditorStateChange])
  useEffect(() => {
    const handler = (event) => {
      if (!dirty && !busy) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, busy])
  useEffect(() => {
    if (!childUlps.some((unit) => unit.uuid === selectedUnitId)) setSelectedUnitId(ALL_KEY)
    if (!childUlps.some((unit) => unit.uuid === targetUnitId)) setTargetUnitId(childUlps[0]?.uuid ?? '')
  }, [unitIdsKey, selectedUnitId, targetUnitId]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMonthly = useCallback(async () => {
    const current = ++requestId.current
    const key = scopeKey
    setLoading(true); setError(''); setLoadedKey('')
    if (!contractId || !up3Uuid || !periodMonth || (!isConsolidated && !effectiveUnitUuid)) {
      setError('Scope kontrak, ULP, atau periode belum tersedia.'); setLoading(false)
      return false
    }
    try {
      const activeVersionId = await fetchActiveVersion({ contractId, up3Id: up3Uuid, periodMonth })
      const targetUnitIds = isUp3Role ? unitIdsKey.split(',').filter(Boolean) : [effectiveUnitUuid]
      const scopeUnitIds = isConsolidated ? targetUnitIds : [effectiveUnitUuid]
      const scope = { contractId, up3Id: up3Uuid, periodMonth, unitId: isConsolidated ? null : effectiveUnitUuid }
      const [monthly, targets, indicators, konstruksiAmounts, konstruksiTargets, financial] = await Promise.all([
        listVariableMonthlyActuals(scope),
        activeVersionId ? fetchMonthlyTargets({ ...scope, unitIds: targetUnitIds, versionId: activeVersionId }) : [],
        activeVersionId ? fetchIndicators({ ...scope, versionId: activeVersionId }) : [],
        canViewVariableFinancial ? fetchKonstruksiMonthlyAmounts({ ...scope, unitIds: scopeUnitIds }) : [],
        canViewVariableFinancial ? fetchKonstruksiMonthlyTargets({ ...scope, unitIds: scopeUnitIds }) : [],
        canViewVariableFinancial && activeVersionId
          ? getVariableFinancialDashboard(scope).then((value) => ({ value, error: '' })).catch((err) => ({ value: null, error: err.message || 'Pendapatan gagal dimuat.' }))
          : { value: null, error: '' },
      ])
      if (current !== requestId.current || scopeKeyRef.current !== key) return false
      setData({ versionId: activeVersionId, monthly: monthly ?? [], targets, indicators, konstruksiAmounts, konstruksiTargets, financial: financial.value, financialError: financial.error })
      setDrafts(monthlyDraftsFromRows(monthly ?? [], effectiveUnitUuid))
      setKonstruksiDrafts(Object.fromEntries(scopeUnitIds.map((id) => [id, String(konstruksiAmounts.find((row) => row.unit_id === id)?.amount_rp ?? '')])))
      setKonstruksiTargetDrafts(Object.fromEntries(scopeUnitIds.map((id) => [id, String(konstruksiTargets.find((row) => row.unit_id === id)?.target_rp ?? '')])))
      setLoadedKey(key)
      return true
    } catch (err) {
      if (current === requestId.current && scopeKeyRef.current === key) setError(err.message || 'Data gagal dimuat.')
      return false
    } finally {
      if (current === requestId.current && scopeKeyRef.current === key) setLoading(false)
    }
  }, [scopeKey, contractId, up3Uuid, periodMonth, effectiveUnitUuid, isConsolidated, isUp3Role, unitIdsKey, canViewVariableFinancial])

  useEffect(() => {
    setSaveError(''); setSaveMessage(''); setDrillIndicator(null); setHistoryScope(null)
    historyRequestId.current += 1
    loadMonthly()
    return () => { requestId.current += 1 }
  }, [loadMonthly])

  const confirmLeave = () => !busy && (!dirty || window.confirm('Perubahan Variable Cost belum disimpan. Tinggalkan perubahan?'))
  const changeTab = (tab) => {
    if (tab === activeTab || !confirmLeave()) return
    setDrafts(monthlyDraftsFromRows(monthlyRows, effectiveUnitUuid))
    setDrillIndicator(null); setActiveTab(tab)
  }
  const changePeriod = (next) => { if (next !== period && confirmLeave()) onPeriodChange?.(next) }
  const refresh = () => { if (confirmLeave()) { setSaveMessage(''); setSaveError(''); loadMonthly() } }
  const handleSaveMonthly = async () => {
    if (savingRef.current || !canEditMonthly || !versionId || !isCurrent || loading) return
    setSaveError(''); setSaveMessage('')
    let values
    try { values = monthlyChanges(drafts, monthlyRows, effectiveUnitUuid) } catch (err) { setSaveError(err.message); return }
    if (!values.length) return
    savingRef.current = true; setSaving(true)
    const savedScopeKey = scopeKey
    try {
      await saveVariableMonthlyActuals({ contractId, up3Id: up3Uuid, unitId: effectiveUnitUuid, versionId, periodMonth, values })
      onSaved?.()
      if (scopeKeyRef.current !== savedScopeKey) return
      const reloaded = await loadMonthly()
      setSaveMessage(reloaded ? 'Input bulanan tersimpan dan langsung aktif. Indikator terkait SLA disinkronkan otomatis.' : 'Input bulanan sudah tersimpan, tetapi pembacaan ulang gagal. Muat ulang untuk memeriksa hasilnya.')
    } catch (err) {
      if (scopeKeyRef.current === savedScopeKey) setSaveError(err.message || 'Gagal menyimpan input bulanan.')
    } finally {
      savingRef.current = false; setSaving(false)
    }
  }

  useEffect(() => {
    if (activeTab !== 'target' || !isCurrent) return
    setTargetDrafts(Object.fromEntries(STANDARD_8.map((indicator) => {
      const canonical = data?.indicators.find((row) => row.point_code === indicator.code)
      return [indicator.code, String(data?.targets.find((row) => row.unit_id === targetUnitId && row.indicator_id === canonical?.id)?.target_value ?? '')]
    })))
  }, [activeTab, data, targetUnitId, isCurrent])

  const handleSaveTarget = async (indicator) => {
    if (busy || loading || !isCurrent || !canEditTargets) return
    const canonical = data?.indicators.find((row) => row.point_code === indicator.code && row.variable_cost_profile === 'STANDARD')
    const value = draftNumber(targetDrafts[indicator.code])
    setTargetError(''); setTargetMessage('')
    if (!canonical || value == null) { setTargetError('Target harus berupa angka nol atau lebih pada versi SLA aktif.'); return }
    setTargetBusyPoint(indicator.code)
    try {
      await setVariableTarget({ contractId, up3Id: up3Uuid, unitId: targetUnitId, versionId, indicatorId: canonical.id, periodMonth, targetValue: value })
      onSaved?.()
      await loadMonthly(); setTargetMessage(`${getShortLabel(indicator)} tersimpan.`)
    } catch (err) { setTargetError(err.message || 'Gagal menyimpan target.') }
    finally { setTargetBusyPoint('') }
  }

  const openDetail = (indicator) => {
    setKonstruksiError(''); setKonstruksiMessage('')
    if (indicator.code === '3.1c') {
      setKonstruksiDrafts(Object.fromEntries(scopedUnits.map((unit) => [unit.uuid, String(data?.konstruksiAmounts.find((row) => row.unit_id === unit.uuid)?.amount_rp ?? '')])))
      setKonstruksiTargetDrafts(Object.fromEntries(scopedUnits.map((unit) => [unit.uuid, String(data?.konstruksiTargets.find((row) => row.unit_id === unit.uuid)?.target_rp ?? '')])))
    }
    setDrillIndicator(indicator)
  }
  const closeDetail = () => { if (confirmLeave()) setDrillIndicator(null) }
  const handleSaveKonstruksi = async () => {
    if (!canManageKonstruksiMonthly || busy || !isCurrent) return
    const canonical = data?.indicators.find((row) => row.point_code === '3.1c' && row.variable_cost_profile === 'KONSTRUKSI')
    if (!canonical) { setKonstruksiError('Indikator Konstruksi tidak tersedia pada versi aktif.'); return }
    const amounts = scopedUnits.filter((unit) => konstruksiDrafts[unit.uuid] !== '').map((unit) => ({ unitId: unit.uuid, amountRp: Number(konstruksiDrafts[unit.uuid]) }))
    const targets = scopedUnits.filter((unit) => konstruksiTargetDrafts[unit.uuid] !== '').map((unit) => ({ unitId: unit.uuid, targetRp: Number(konstruksiTargetDrafts[unit.uuid]) }))
    if (!amounts.length && !targets.length) { setKonstruksiError('Isi minimal satu nominal Rupiah.'); return }
    if ([...amounts.map((item) => item.amountRp), ...targets.map((item) => item.targetRp)].some((value) => !Number.isSafeInteger(value) || value < 0)) {
      setKonstruksiError('Nominal Rupiah harus angka bulat nol atau lebih.'); return
    }
    setKonstruksiBusy(true); setKonstruksiError(''); setKonstruksiMessage('')
    try {
      // Keep the existing Konstruksi RPCs and nominal-monthly behavior unchanged.
      if (targets.length) await setKonstruksiMonthlyTargets({ contractId, up3Id: up3Uuid, periodMonth, indicatorId: canonical.id, values: targets })
      if (amounts.length) await setKonstruksiMonthlyAmounts({ contractId, up3Id: up3Uuid, periodMonth, indicatorId: canonical.id, values: amounts })
      await loadMonthly(); setKonstruksiMessage('Konstruksi tersimpan.')
    } catch (err) { setKonstruksiError(err.message || 'Gagal menyimpan Konstruksi. Periksa kembali target dan aktual sebelum mencoba lagi.') }
    finally { setKonstruksiBusy(false) }
  }
  const openHistory = async (indicator, unit) => {
    const current = ++historyRequestId.current
    setHistoryScope({ indicator, unit }); setHistoryRows([]); setHistoryError(''); setHistoryLoading(true)
    try {
      const rows = await listVariableMonthlyHistory({ contractId, up3Id: up3Uuid, unitId: unit.uuid, periodMonth, indicatorCode: indicator.code })
      if (current === historyRequestId.current) setHistoryRows(rows)
    } catch (err) { if (current === historyRequestId.current) setHistoryError(err.message || 'Riwayat gagal dimuat.') }
    finally { if (current === historyRequestId.current) setHistoryLoading(false) }
  }

  const getTarget = (indicator, scopedUnitId = null) => {
    if (!indicator.slaLinked) return null
    const canonical = data?.indicators.find((row) => row.point_code === indicator.code)
    if (scopedUnitId) return data?.targets.find((row) => row.unit_id === scopedUnitId && row.indicator_id === canonical?.id)?.target_value ?? null
    // Consolidation uses the same ULP targets as SLA, limited to the authorized scope.
    const values = scopedUnits.map((unit) => data?.targets.find((row) => row.unit_id === unit.uuid && row.indicator_id === canonical?.id)?.target_value)
    return values.length && values.every((value) => value != null) ? values.reduce((sum, value) => sum + Number(value), 0) : null
  }
  const financialValue = (code, scopedUnitId = null) => scopedUnitId
    ? data?.financial?.cells.find((row) => row.indicator_code === code && row.unit_id === scopedUnitId)
    : data?.financial?.indicators.find((row) => row.indicator_code === code)
  const renderRevenue = (indicator, scopedUnitId = null) => {
    if (indicator.code === '3.1a') return 'Tidak Ditagihkan'
    if (data?.financialError) return <span className="sla-blocked-note">Pendapatan gagal dimuat</span>
    const financial = financialValue(indicator.code, scopedUnitId)
    if (!financial) return EMPTY_VALUE
    const missing = financial.actual_missing ? 1 : Number(financial.missing_actual_count ?? 0)
    if (financial.actual_missing || (missing > 0 && !Number(financial.configured_actual_count))) return <span className="text-muted">Belum diisi</span>
    return <>{Number(financial.missing_price_count) > 0 ? <span className="sla-blocked-note">Harga belum diatur</span> : formatRp(financial.actual_amount)}{missing > 0 && <small className="vc-monthly-note">Parsial · {missing} ULP belum diisi</small>}</>
  }
  const renderMonthlyValue = (value, missing = 0) => <>{value == null ? <span className="text-muted">Belum diisi</span> : formatNumber(value)}{isConsolidated && missing > 0 && value != null && <small className="vc-monthly-note">{missing} ULP belum diisi</small>}</>
  const summary = data?.financial?.summary
  const scopeLabel = isConsolidated ? 'Konsolidasi UP3' : effectiveUnit?.displayName ?? 'ULP belum tersedia'
  const primaryTabs = [{ id: 'rekap', label: 'Rekap Bulanan' }, ...(canViewVariableFinancial ? [{ id: 'dashboard-finansial', label: 'Dashboard Finansial' }] : [])]
  const configurationTabs = [
    ...(canEditTargets ? [{ id: 'target', label: 'Target Operasional' }] : []),
    ...(canViewVariableFinancial ? [{ id: 'target-pendapatan', label: 'Target Pendapatan' }] : []),
    ...(canManageKonstruksiMonthly ? [{ id: 'harga-satuan', label: 'Harga Satuan' }] : []),
  ]
  const configurationActive = configurationTabs.some((tab) => tab.id === activeTab)
  const columns = 7 + (canViewVariableFinancial ? 1 : 0)

  return (
    <section className="sla-module-panel vc-module">
      <nav className="vc-breadcrumb" aria-label="Breadcrumb"><span>Dashboard</span><span aria-hidden="true">/</span><span>Pelayanan Teknik</span><span aria-hidden="true">/</span><strong>Variable Cost</strong></nav>
      <div className="vc-context-line"><strong>VARIABLE COST</strong><span>{variableCostIndicators.length} indikator</span><span>{period}</span><span>{scopeLabel}</span></div>
      <div className="vc-navigation">
        <Tabs items={primaryTabs} value={activeTab} onChange={changeTab} ariaLabel="Navigasi utama Variable Cost" className="vc-primary-tabs" />
        {configurationTabs.length > 0 && (
          <details className="vc-config-menu" ref={variableConfigMenuRef}>
            <summary className={configurationActive ? 'vc-config-menu-active' : ''}>Pengaturan Variable</summary>
            <div className="vc-config-menu-panel">{configurationTabs.map((tab) => (
              <Button key={tab.id} variant="ghost" className={activeTab === tab.id ? 'vc-config-item-active' : ''} onClick={() => { if (variableConfigMenuRef.current) variableConfigMenuRef.current.open = false; changeTab(tab.id) }}>{tab.label}</Button>
            ))}</div>
          </details>
        )}
      </div>

      {activeTab === 'rekap' ? (
        <>
          <FilterBar className="vc-filter-bar" actions={<Button variant="secondary" disabled={busy || loading} onClick={refresh} icon={<Icon name="refresh-cw" size={16} />}>Muat Ulang</Button>}>
            <FilterField label="Periode"><select className="input-select" value={period} disabled={busy} onChange={(event) => changePeriod(event.target.value)}>{periods.map((item) => <option key={item} value={item}>{item}</option>)}</select></FilterField>
            <FilterField label="Unit layanan">
              {isUp3Role ? <select className="input-select" value={selectedUnitId} disabled={busy} onChange={(event) => { if (confirmLeave()) setSelectedUnitId(event.target.value) }}><option value={ALL_KEY}>Semua ULP — Konsolidasi UP3</option>{childUlps.map((unit) => <option key={unit.uuid} value={unit.uuid}>{unit.displayName}</option>)}</select> : <span className="vc-unit-static">{scopeLabel}</span>}
            </FilterField>
          </FilterBar>
          <p className="vc-helper-text">{canEditMonthly ? 'Isi total WO dan realisasi bulanan untuk ULP Anda, lalu simpan seluruh perubahan. Tanpa evidence atau persetujuan.' : 'WO dan realisasi berasal dari input bulanan masing-masing Admin ULP. Tampilan ini hanya untuk monitoring.'} Kosong berarti belum diinput; 0 adalah nilai valid. Konstruksi tetap menggunakan nominal bulanan.</p>
          {saveError && <Alert tone="danger">{saveError}</Alert>}
          {saveMessage && <Alert tone="success">{saveMessage}</Alert>}
          {loading || (!isCurrent && !error) ? <StatePanel state="loading" title="Memuat input bulanan" /> : error ? <StatePanel state="error" title="Data gagal dimuat" action={<Button onClick={refresh}>Coba Lagi</Button>}>{error}</StatePanel> : (
            <>
              {!versionId && <Alert tone="warning">Tidak ada versi SLA aktif untuk periode ini. Input belum dapat disimpan.</Alert>}
              <DataTable className="vc-rekap-table vc-monthly-table" frameClassName="vc-rekap-table-wrap" sticky>
                <thead><tr><th>Indikator</th><th>Satuan</th><th>Target</th><th>WO Bulanan</th><th>Realisasi Bulanan</th><th>Pencapaian</th>{canViewVariableFinancial && <th>Pendapatan</th>}<th>Aksi</th></tr></thead>
                <tbody>{variableCostIndicators.map((indicator) => {
                  if (indicator.code === '3.1c') {
                    const target = sumMonthlyField(data.konstruksiTargets, 'target_rp')
                    const amount = sumMonthlyField(data.konstruksiAmounts, 'amount_rp')
                    const complete = scopedUnits.length > 0 && data.konstruksiAmounts.length === scopedUnits.length && data.konstruksiTargets.length === scopedUnits.length
                    return <tr key={indicator.code}><td>{getShortLabel(indicator)}</td><td>Rp</td><td>{formatRp(target)}</td><td>{EMPTY_VALUE}</td><td>{formatRp(amount)}</td><td>{complete && Number(target) > 0 ? formatPercent(Number(amount) / Number(target) * 100) : EMPTY_VALUE}</td>{canViewVariableFinancial && <td>{renderRevenue(indicator, isConsolidated ? null : effectiveUnitUuid)}</td>}<td>{canViewVariableFinancial ? <Button size="small" onClick={() => openDetail(indicator)}>Detail</Button> : <span className="text-muted">Dikelola UP3</span>}</td></tr>
                  }
                  const values = aggregateMonthlyValues(monthlyRows, indicator.code, scopedUnitIds)
                  const target = getTarget(indicator, isConsolidated ? null : effectiveUnitUuid)
                  const wo = canEditMonthly ? draftNumber(drafts[indicator.code]?.workOrder) : values.workOrder
                  const real = canEditMonthly ? draftNumber(drafts[indicator.code]?.realization) : values.realization
                  const complete = canEditMonthly || (values.missingWorkOrder === 0 && values.missingRealization === 0)
                  return (
                    <tr key={indicator.code}>
                      <td>{getShortLabel(indicator)}<small className="vc-monthly-note">{indicator.slaLinked ? indicator.code : 'Non-SLA'}</small></td>
                      <td>{indicator.unit ?? EMPTY_VALUE}</td>
                      <td>{indicator.slaLinked ? target == null ? <span className="text-muted">Belum diatur</span> : formatNumber(target) : EMPTY_VALUE}</td>
                      <td>{canEditMonthly ? <input aria-label={`WO ${indicator.code}`} type="number" min="0" step="0.0001" className="input-number vc-monthly-input" value={drafts[indicator.code]?.workOrder ?? ''} placeholder="Belum diisi" disabled={busy || !versionId} onChange={(event) => { setSaveMessage(''); setDrafts((current) => ({ ...current, [indicator.code]: { ...current[indicator.code], workOrder: event.target.value } })) }} /> : renderMonthlyValue(values.workOrder, values.missingWorkOrder)}</td>
                      <td>{canEditMonthly ? <input aria-label={`Realisasi ${indicator.code}`} type="number" min="0" step="0.0001" className="input-number vc-monthly-input" value={drafts[indicator.code]?.realization ?? ''} placeholder="Belum diisi" disabled={busy || !versionId} onChange={(event) => { setSaveMessage(''); setDrafts((current) => ({ ...current, [indicator.code]: { ...current[indicator.code], realization: event.target.value } })) }} /> : renderMonthlyValue(values.realization, values.missingRealization)}</td>
                      <td>{indicator.slaLinked && complete ? formatPercent(monthlyAchievement(target, wo, real)) : EMPTY_VALUE}</td>
                      {canViewVariableFinancial && <td>{renderRevenue(indicator, isConsolidated ? null : effectiveUnitUuid)}</td>}
                      <td>{isConsolidated ? <Button size="small" onClick={() => openDetail(indicator)}>Detail per ULP</Button> : effectiveUnit && <Button size="small" onClick={() => openHistory(indicator, effectiveUnit)}>Riwayat</Button>}</td>
                    </tr>
                  )
                })}{!scopedUnits.length && <tr><td colSpan={columns}>Tidak ada ULP dalam scope ini.</td></tr>}</tbody>
              </DataTable>
              {canEditMonthly && <div className="vc-monthly-save-bar"><span role="status">{monthlyDirty ? 'Ada perubahan belum disimpan.' : 'Tidak ada perubahan belum disimpan.'}</span><Button variant="primary" disabled={busy || !monthlyDirty || !versionId || !isCurrent} onClick={handleSaveMonthly}>{saving ? 'Menyimpan…' : 'Simpan Input Bulanan'}</Button></div>}
              <p className="vc-helper-text">Pencapaian = Realisasi ÷ min(Target, WO) × 100. Jika target/WO nol atau data belum lengkap, pencapaian tidak dihitung. Pendapatan memakai realisasi tersimpan × harga satuan efektif akhir bulan. ROW Fix tidak ditagihkan.</p>
              {canViewVariableFinancial && (data.financialError ? <Alert tone="danger">{data.financialError}</Alert> : summary && (
                <section className="vc-inline-summary vc-monthly-summary">
                  <h3>PENDAPATAN VARIABLE — {period.toUpperCase()}</h3>
                  <dl><dt>Target Pendapatan</dt><dd>{formatRp(summary.target_amount)}</dd><dt>Realisasi Terkonfirmasi</dt><dd>{formatRp(summary.actual_amount)}</dd><dt>Selisih</dt><dd>{formatRp(summary.difference_amount)}</dd><dt>Pencapaian</dt><dd>{formatPercent(summary.achievement_percent)}</dd></dl>
                  {Number(summary.missing_actual_count) > 0 && <p className="sla-blocked-note">{summary.missing_actual_count} realisasi bulanan belum diinput. Total hanya mencakup nilai tersimpan; selisih dan pencapaian belum final.</p>}
                  {Number(summary.missing_target_count) > 0 && <p className="sla-blocked-note">{summary.missing_target_count} target pendapatan belum diatur.</p>}
                  {Number(summary.missing_price_count) > 0 && <p className="sla-blocked-note">{summary.missing_price_count} harga belum tersedia dan belum termasuk pendapatan terkonfirmasi.</p>}
                </section>
              ))}
            </>
          )}
        </>
      ) : activeTab === 'dashboard-finansial' && canViewVariableFinancial ? (
        <VariableFinancialDashboard contractId={contractId} up3Id={up3Uuid} period={period} periods={periods} onPeriodChange={changePeriod} units={childUlps} onOpenMonthly={(code, requestedUnitId) => { setSelectedUnitId(requestedUnitId); setActiveTab('rekap') }} />
      ) : activeTab === 'harga-satuan' && canManageKonstruksiMonthly ? (
        <MasterHargaSatuan contractId={contractId} up3Id={up3Uuid} up3Name={units.find((unit) => unit.uuid === up3Uuid)?.displayName ?? 'UP3'} canManage={canManageKonstruksiMonthly} />
      ) : activeTab === 'target-pendapatan' && canViewVariableFinancial ? (
        <TargetPendapatanVariable contractId={contractId} up3Id={up3Uuid} period={period} periods={periods} onPeriodChange={changePeriod} units={childUlps} onSaved={loadMonthly} />
      ) : activeTab === 'target' && canEditTargets ? (
        <div className="vc-subpage">
          <div className="vc-subpage-heading"><div><span className="vc-section-kicker">KONFIGURASI</span><h3>Target Operasional Variable Cost</h3></div></div>
          <FilterBar className="vc-filter-bar"><FilterField label="Periode"><select className="input-select" value={period} disabled={busy} onChange={(event) => changePeriod(event.target.value)}>{periods.map((item) => <option key={item} value={item}>{item}</option>)}</select></FilterField><FilterField label="Unit layanan"><select className="input-select" value={targetUnitId} disabled={busy} onChange={(event) => { setTargetError(''); setTargetMessage(''); setTargetUnitId(event.target.value) }}>{childUlps.map((unit) => <option key={unit.uuid} value={unit.uuid}>{unit.displayName}</option>)}</select></FilterField></FilterBar>
          {targetError && <Alert tone="danger">{targetError}</Alert>}{targetMessage && <Alert tone="success">{targetMessage}</Alert>}
          {error ? <StatePanel state="error" title="Target gagal dimuat" action={<Button onClick={refresh}>Coba Lagi</Button>}>{error}</StatePanel> : loading || !isCurrent ? <StatePanel state="loading" title="Memuat target" /> : <DataTable className="vc-compact-table" sticky><thead><tr><th>Kegiatan</th><th>Satuan</th><th>Target</th><th>Aksi</th></tr></thead><tbody>{STANDARD_8.map((indicator) => <tr key={indicator.code}><td>{getShortLabel(indicator)}</td><td>{indicator.unit}</td><td><input aria-label={`Target ${indicator.code}`} type="number" min="0" step="0.0001" className="input-field" value={targetDrafts[indicator.code] ?? ''} disabled={busy || !versionId} onChange={(event) => setTargetDrafts((current) => ({ ...current, [indicator.code]: event.target.value }))} /></td><td><Button variant="primary" size="small" disabled={busy || !versionId} onClick={() => handleSaveTarget(indicator)}>{targetBusyPoint === indicator.code ? 'Menyimpan…' : 'Simpan'}</Button></td></tr>)}</tbody></DataTable>}
        </div>
      ) : null}

      <Modal open={Boolean(drillIndicator)} onClose={closeDetail} title={`${getShortLabel(drillIndicator)} · ${period}`} size="large" dismissDisabled={busy} showCloseButton={!busy}>
        {drillIndicator && isCurrent && (konstruksiOpen ? (
          <>
            <DataTable><thead><tr><th>ULP</th><th>Target Pendapatan</th><th>Aktual</th><th>Selisih</th><th>Pencapaian</th></tr></thead><tbody>{scopedUnits.map((unit) => {
              const target = canManageKonstruksiMonthly ? draftNumber(konstruksiTargetDrafts[unit.uuid]) : data.konstruksiTargets.find((row) => row.unit_id === unit.uuid)?.target_rp
              const amount = canManageKonstruksiMonthly ? draftNumber(konstruksiDrafts[unit.uuid]) : data.konstruksiAmounts.find((row) => row.unit_id === unit.uuid)?.amount_rp
              return <tr key={unit.uuid}><td>{unit.displayName}</td><td>{canManageKonstruksiMonthly ? <input aria-label={`Target Konstruksi ${unit.displayName}`} className="input-number" inputMode="numeric" value={konstruksiTargetDrafts[unit.uuid] ?? ''} disabled={busy} onChange={(event) => setKonstruksiTargetDrafts((current) => ({ ...current, [unit.uuid]: event.target.value.replace(/\D/g, '') }))} /> : formatRp(target)}</td><td>{canManageKonstruksiMonthly ? <input aria-label={`Aktual Konstruksi ${unit.displayName}`} className="input-number" inputMode="numeric" value={konstruksiDrafts[unit.uuid] ?? ''} disabled={busy} onChange={(event) => setKonstruksiDrafts((current) => ({ ...current, [unit.uuid]: event.target.value.replace(/\D/g, '') }))} /> : formatRp(amount)}</td><td>{target != null && amount != null ? formatRp(Number(amount) - Number(target)) : EMPTY_VALUE}</td><td>{target > 0 && amount != null ? formatPercent(Number(amount) / Number(target) * 100) : EMPTY_VALUE}</td></tr>
            })}</tbody></DataTable>
            {canManageKonstruksiMonthly && <div className="vc-page-actions"><Button variant="primary" disabled={busy || !konstruksiDirty} onClick={handleSaveKonstruksi}>{konstruksiBusy ? 'Menyimpan…' : 'Simpan Konstruksi'}</Button></div>}
            <p className="vc-helper-text">Konstruksi tetap menggunakan nominal bulanan. Kolom kosong tidak menghapus nominal yang telah tersimpan; gunakan 0 untuk nilai nol.</p>
            {konstruksiError && <Alert tone="danger">{konstruksiError}</Alert>}{konstruksiMessage && <Alert tone="success">{konstruksiMessage}</Alert>}
          </>
        ) : (
          <DataTable><thead><tr><th>ULP</th><th>Target</th><th>WO</th><th>Realisasi</th><th>Pencapaian</th>{canViewVariableFinancial && <th>Pendapatan</th>}<th>Aksi</th></tr></thead><tbody>{scopedUnits.map((unit) => {
            const row = monthlyRows.find((item) => item.unit_id === unit.uuid && item.indicator_code === drillIndicator.code)
            const target = getTarget(drillIndicator, unit.uuid)
            return <tr key={unit.uuid}><td>{unit.displayName}</td><td>{formatNumber(target)}</td><td>{renderMonthlyValue(row?.work_order)}</td><td>{renderMonthlyValue(row?.realization)}</td><td>{drillIndicator.slaLinked ? formatPercent(monthlyAchievement(target, row?.work_order, row?.realization)) : EMPTY_VALUE}</td>{canViewVariableFinancial && <td>{renderRevenue(drillIndicator, unit.uuid)}</td>}<td><Button size="small" onClick={() => openHistory(drillIndicator, unit)}>Riwayat</Button></td></tr>
          })}</tbody></DataTable>
        ))}
      </Modal>
      <Modal open={Boolean(historyScope)} onClose={() => { historyRequestId.current += 1; setHistoryScope(null) }} title={`Riwayat ${getShortLabel(historyScope?.indicator)} · ${historyScope?.unit.displayName ?? ''} · ${period}`} size="large">
        {historyLoading ? <StatePanel state="loading" title="Memuat riwayat" /> : historyError ? <Alert tone="danger">{historyError}</Alert> : historyRows.length === 0 ? <StatePanel title="Belum ada perubahan tersimpan" /> : (
          <><p className="vc-helper-text">Maksimal 100 revisi terakhir. Nilai kosong ditampilkan sebagai —.</p><DataTable><thead><tr><th>Revisi</th><th>Waktu (WIB)</th><th>WO Lama → Baru</th><th>Realisasi Lama → Baru</th></tr></thead><tbody>{historyRows.map((row) => <tr key={row.id}><td>{row.revision}</td><td>{new Date(row.changed_at).toLocaleString('id-ID', { timeZone: 'Asia/Pontianak' })}</td><td>{formatNumber(row.old_work_order)} → {formatNumber(row.new_work_order)}</td><td>{formatNumber(row.old_realization)} → {formatNumber(row.new_realization)}</td></tr>)}</tbody></DataTable></>
        )}
      </Modal>
    </section>
  )
}
