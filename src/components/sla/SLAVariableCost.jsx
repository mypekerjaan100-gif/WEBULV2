import { useEffect, useState, useCallback } from 'react'
import { slaIndicators } from '../../data/slaPelayananTeknik.js'
import { periodLabelToMonth, fetchMonthlyTargets, fetchUp3Targets, fetchMonthlyEntries, fetchIndicators, fetchActiveVersion, listFeeders, listActiveFeeders, proposeFeeder, createFeederDirect, approveFeeder, rejectFeeder, deactivateFeeder, activateFeeder, deleteFeeder, formatFeederStatus, listDailyEntries, getVariableDetail, saveVariableEntry, submitVariableEntry, uploadVariableEvidence, getEvidencePreviewUrl, getShortLabel, listSubmittedEntries, approveVariableEntry, rejectVariableEntry } from '../../data/variableCostRepository.js'
import { supabase } from '../../lib/supabaseClient.js'

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
  const [pendingList, setPendingList] = useState([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingError, setPendingError] = useState('')
  const [approvalDetail, setApprovalDetail] = useState(null)
  const [approvalData, setApprovalData] = useState(null)

  // V3 daily input state
  const [showInputPicker, setShowInputPicker] = useState(false)
  const [selectedIndicator, setSelectedIndicator] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0,10))
  const [formFeeder, setFormFeeder] = useState('')
  const [formLocation, setFormLocation] = useState('')
  const [formWo, setFormWo] = useState('')
  const [formRealisasi, setFormRealisasi] = useState('')
  const [formPetugas, setFormPetugas] = useState([])
  const [formKeterangan, setFormKeterangan] = useState('')
  const [formFiles, setFormFiles] = useState([])
  const [formError, setFormError] = useState('')
  const [formBusy, setFormBusy] = useState(false)
  const [editingEntryId, setEditingEntryId] = useState(null)
  const [employees, setEmployees] = useState([])
  const [dailyList, setDailyList] = useState([])
  const [dailyLoading, setDailyLoading] = useState(false)
  const [showDailyList, setShowDailyList] = useState(false)
  const [dailyIndicator, setDailyIndicator] = useState(null)
  const [detailEntry, setDetailEntry] = useState(null)
  const [detailData, setDetailData] = useState(null)
  const [activeVersionId, setActiveVersionId] = useState(null)

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

  const loadPending = useCallback(async () => {
    if (!contractId || !up3Uuid) return
    setPendingLoading(true); setPendingError('')
    try {
      const list = await listSubmittedEntries({ contractId, up3Id: up3Uuid })
      setPendingList(list)
    } catch (e) { setPendingError(e.message) }
    finally { setPendingLoading(false) }
  }, [contractId, up3Uuid])

  useEffect(() => { if (activeTab === 'persetujuan') loadPending() }, [loadPending, activeTab])

  useEffect(() => {
    if (!contractId || !up3Uuid) return
    fetchActiveVersion({ contractId, up3Id: up3Uuid }).then((id) => setActiveVersionId(id)).catch(() => {})
  }, [contractId, up3Uuid])

  useEffect(() => {
    if (!effectiveUnitUuid || isConsolidated) { setEmployees([]); return }
    // fetch employees for own ULP
    supabase.from('employees').select('id').limit(1).then(() => {
      // use employeeRepository via direct query for now: fetch via supabase view
      supabase.from('employee_unit_history').select('employee_id').eq('unit_id', effectiveUnitUuid).then(() => {})
    })
    // fallback: fetch via employees table with join
    const loadEmps = async () => {
      try {
        // Try to get employees assigned to this ULP via history
        const { data: hist } = await supabase.from('employee_unit_history').select('employee_id').eq('unit_id', effectiveUnitUuid).is('effective_to', null)
        const ids = (hist ?? []).map((h) => h.employee_id)
        if (!ids.length) { setEmployees([]); return }
        const { data: emps } = await supabase.from('employees').select('id,name').in('id', ids)
        // filter only active via status history
        const { data: statusRows } = await supabase.from('employee_status_history').select('employee_id,status').in('employee_id', ids)
        const activeIds = new Set((statusRows ?? []).filter((s) => s.status === 'Aktif').map((s) => s.employee_id))
        // if no status rows, assume all active
        const filtered = (emps ?? []).filter((e) => activeIds.size === 0 || activeIds.has(e.id))
        setEmployees(filtered)
      } catch { setEmployees([]) }
    }
    loadEmps()
  }, [effectiveUnitUuid, isConsolidated])

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

  const openApprovalDetail = async (row) => {
    setApprovalDetail(row)
    try {
      const data = await getVariableDetail(row.id)
      const ind = data.indicator ?? row.sla_indicators ?? indicators.find((r) => r.id === row.indicator_id) ?? null
      setApprovalData({ ...data, indicator: ind, row })
    } catch { setApprovalData(null) }
  }
  const handleApproveTx = async (id) => {
    try { await approveVariableEntry(id); await loadPending(); await loadMonthly() } catch (e) { setPendingError(e.message) }
  }
  const handleRejectTx = async (id) => {
    const reason = window.prompt('Alasan penolakan (wajib):')
    if (!reason?.trim()) return
    try { await rejectVariableEntry(id, reason.trim()); await loadPending(); await loadMonthly() } catch (e) { setPendingError(e.message) }
  }

  // V3 helpers
  const standard8 = CANONICAL_9.filter((i) => i.id !== 'A-3.1c')
  const openInputPicker = () => { if (isConsolidated) return; setShowInputPicker(true) }
  const chooseIndicator = (ind) => {
    setSelectedIndicator(ind)
    setShowInputPicker(false)
    setFormDate(new Date().toISOString().slice(0,10))
    setFormFeeder(''); setFormLocation(''); setFormWo(''); setFormRealisasi(''); setFormPetugas([]); setFormKeterangan(''); setFormFiles([]); setFormError(''); setEditingEntryId(null)
    setShowForm(true)
  }
  const openDailyList = async (ind) => {
    if (isConsolidated) return
    setDailyIndicator(ind)
    setShowDailyList(true)
    setDailyLoading(true)
    try {
      const uuid = pointToUuids.get(ind.point) ?? ind.id
      // Try to resolve indicator UUID via fetched indicators
      const indicatorRow = indicators.find((r) => r.point_code === ind.point || r.legacy_key === ind.id)
      const indicatorId = indicatorRow?.id ?? uuid
      const versionId = indicatorRow?.sla_version_id ?? activeVersionId
      const list = await listDailyEntries({ contractId, up3Id: up3Uuid, unitId: effectiveUnitUuid, indicatorId, periodMonth })
      setDailyList(list)
    } catch (e) { setDailyList([]) }
    finally { setDailyLoading(false) }
  }
  const openDetail = async (entryId) => {
    setDetailEntry(entryId)
    try {
      const data = await getVariableDetail(entryId)
      setDetailData(data)
    } catch (e) { setDetailData(null) }
  }
  const handleSaveDraft = async (shouldSubmit) => {
    setFormError('')
    if (!selectedIndicator) { setFormError('Pilih jenis kegiatan'); return }
    if (!formDate) { setFormError('Tanggal wajib'); return }
    if (!formFeeder) { setFormError('Penyulang wajib'); return }
    if (!formLocation.trim()) { setFormError('Lokasi wajib'); return }
    if (formWo === '' || Number(formWo) < 0 || !Number.isInteger(Number(formWo))) { setFormError('WO wajib angka bulat >=0'); return }
    if (formRealisasi === '' || Number(formRealisasi) < 0 || !Number.isInteger(Number(formRealisasi))) { setFormError('Realisasi wajib angka bulat >=0'); return }
    if (!formPetugas.length) { setFormError('Pilih minimal 1 petugas'); return }
    // Resolve indicator UUID
    const indicatorRow = indicators.find((r) => r.point_code === selectedIndicator.point || r.legacy_key === selectedIndicator.id)
    const indicatorId = indicatorRow?.id
    const versionId = indicatorRow?.sla_version_id ?? activeVersionId
    if (!indicatorId || !versionId) { setFormError('Indikator belum tersedia di Supabase. Hubungi Admin.'); return }
    setFormBusy(true)
    try {
      const saved = await saveVariableEntry({
        entryId: editingEntryId,
        contractId, up3Id: up3Uuid, unitId: effectiveUnitUuid,
        slaVersionId: versionId, indicatorId,
        workDate: formDate, feederId: formFeeder,
        locationAddress: formLocation, workOrder: Number(formWo), realization: Number(formRealisasi),
        description: formKeterangan, employeeIds: formPetugas,
      })
      const entryId = saved.id ?? editingEntryId ?? saved?.id
      // upload evidences if any
      if (formFiles.length) {
        for (const f of formFiles) {
          await uploadVariableEvidence({ entryId, file: f })
        }
      }
      if (shouldSubmit) {
        // validate evidence after upload
        await submitVariableEntry(entryId)
      }
      setShowForm(false); setSelectedIndicator(null); setEditingEntryId(null)
      await loadMonthly()
      if (dailyIndicator) {
        const list = await listDailyEntries({ contractId, up3Id: up3Uuid, unitId: effectiveUnitUuid, indicatorId, periodMonth })
        setDailyList(list)
      }
    } catch (e) { setFormError(e.message) }
    finally { setFormBusy(false) }
  }
  const handleContinueDraft = async (row) => {
    setDailyList([]); setShowDailyList(false)
    const ind = standard8.find((i) => {
      const uuid = pointToUuids.get(i.point)
      // try to match via history: we don't have uuid for row, fallback to point via dailyIndicator
      return true
    })
    // Open form with existing data
    const data = await getVariableDetail(row.id)
    setSelectedIndicator(standard8.find((s) => s.point === dailyIndicator?.point) ?? standard8[0])
    setFormDate(data.entry.work_date?.slice(0,10) ?? new Date().toISOString().slice(0,10))
    setFormFeeder(data.entry.feeder_id ?? '')
    setFormLocation(data.entry.location_address ?? '')
    setFormWo(String(data.entry.work_order ?? ''))
    setFormRealisasi(String(data.entry.realization ?? ''))
    setFormPetugas((data.personnel ?? []).map((p) => p.employee_id))
    setFormKeterangan(data.entry.description ?? '')
    setFormFiles([]); setEditingEntryId(row.id); setShowForm(true)
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

  const targetByPoint = new Map()
  const entryByPoint = new Map()
  if (!isConsolidated && effectiveUnitUuid) {
    CANONICAL_9.forEach((ind) => {
      const uuid = pointToUuids.get(ind.point)
      if (!uuid) return
      const target = targets.find((row) => row.unit_id === effectiveUnitUuid && row.indicator_id === uuid)
      const entry = entries.find((row) => row.unit_id === effectiveUnitUuid && row.indicator_id === uuid)
      if (target) targetByPoint.set(ind.point, target.target_value)
      if (entry) entryByPoint.set(ind.point, entry)
    })
  }

  return (
    <section className="sla-module-panel">
      <div className="sla-export-bar" style={{ justifyContent: 'space-between' }}>
        <span className="sla-export-scope">VARIABLE COST — Periode {period} · {isAdminUlpView ? (effectiveUnit?.displayName ?? effectiveLegacy) : (isConsolidated ? 'Konsolidasi UP3' : (childUlps.find((u) => (u.legacyKey ?? u.uuid) === selectedUlpLegacy)?.displayName ?? '—'))}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className={`sla-btn ${activeTab === 'rekap' ? 'sla-btn-primary' : ''}`} onClick={() => setActiveTab('rekap')}>Rekap Bulanan</button>
          {isUp3Role && <button type="button" className={`sla-btn ${activeTab === 'persetujuan' ? 'sla-btn-primary' : ''}`} onClick={() => setActiveTab('persetujuan')}>Persetujuan</button>}
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
                  <th>Indikator</th><th>Satuan</th><th>Target</th><th>WO</th><th>Realisasi</th><th>Pencapaian</th>{(isConsolidated || (!isUp3Role && !isConsolidated)) ? <th>Aksi</th> : null}
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
                          <td>{getShortLabel(ind)}</td>
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
                        <td>{getShortLabel(ind)}</td>
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
                      <tr key={ind.id} style={!isConsolidated && !isUp3Role ? { cursor: 'pointer' } : undefined} onClick={() => { if (!isConsolidated && !isUp3Role) openDailyList(ind) }}>
                        <td>{getShortLabel(ind)}</td>
                        <td>—</td>
                        <td><span className="text-muted">Belum diatur</span></td>
                        <td colSpan={isConsolidated ? 2 : 3} style={{ textAlign: 'center' }}>
                          <span className="text-muted">Nilai/Pendapatan — {entry ? formatRp(entry.realization) : 'Belum ada data'}</span>
                        </td>
                        {!isConsolidated && !isUp3Role && <td><button type="button" className="sla-btn" onClick={(e) => { e.stopPropagation(); openDailyList(ind) }}>Lihat Detail</button></td>}
                      </tr>
                    )
                  }
                  return (
                    <tr key={ind.id} style={!isConsolidated && !isUp3Role ? { cursor: 'pointer' } : undefined} onClick={() => { if (!isConsolidated && !isUp3Role) openDailyList(ind) }}>
                      <td>{getShortLabel(ind)}</td>
                      <td>{ind.unit ?? '—'}</td>
                      <td>{target == null ? <span className="text-muted">Belum diatur</span> : formatNumber(target)}</td>
                      <td>{entry?.work_order == null ? '0' : formatNumber(entry.work_order)}</td>
                      <td>{entry?.realization == null ? '0' : formatNumber(entry.realization)}</td>
                      <td>{entry?.achievement == null ? '—' : formatPercent(entry.achievement)}</td>
                      {!isConsolidated && !isUp3Role && <td><button type="button" className="sla-btn" onClick={(e) => { e.stopPropagation(); openDailyList(ind) }}>Lihat Detail</button></td>}
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
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!isConsolidated && !isUp3Role && (
              <button type="button" className="sla-btn sla-btn-primary" onClick={openInputPicker}>+ Input Kegiatan</button>
            )}
            {isUp3Role && !isConsolidated && (
              <span className="text-muted" style={{ alignSelf: 'center' }}>Monitoring ULP — input oleh ADMIN_ULP</span>
            )}
            {isConsolidated && (
              <span className="text-muted" style={{ alignSelf: 'center' }}>{childUlps.length} ULP — konsolidasi APPROVED</span>
            )}
            {!isConsolidated && isUp3Role && null}
            {!isConsolidated && !isUp3Role && <span className="text-muted" style={{ alignSelf: 'center' }}>{activeFeeders.length} Penyulang aktif</span>}
          </div>
          {drillIndicator && (
            <div className="modal-backdrop" onClick={() => setDrillIndicator(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
                <div className="modal-header">
                  <h3>Detail {getShortLabel(drillIndicator)} · Periode {period}</h3>
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
          {showInputPicker && (
            <div className="modal-backdrop" onClick={() => setShowInputPicker(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
                <div className="modal-header"><h3>Pilih Jenis Kegiatan</h3><button type="button" className="modal-close" onClick={() => setShowInputPicker(false)}>×</button></div>
                <div className="modal-body" style={{ display: 'grid', gap: 10 }}>
                  {standard8.map((ind) => (
                    <button key={ind.id} type="button" className="sla-btn" style={{ textAlign: 'left', padding: 12, justifyContent: 'flex-start' }} onClick={() => chooseIndicator(ind)}>
                      <div><strong>{getShortLabel(ind)}</strong><br/><small>{ind.unit} · {ind.scope}</small></div>
                    </button>
                  ))}
                  <div className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>Konstruksi akan tersedia pada tahap berikutnya.</div>
                </div>
              </div>
            </div>
          )}
          {showForm && selectedIndicator && (
            <div className="modal-backdrop" onClick={() => setShowForm(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
                <div className="modal-header"><h3>{editingEntryId ? 'Lanjutkan Draft' : 'Input Kegiatan'} — {getShortLabel(selectedIndicator)}</h3><button type="button" className="modal-close" onClick={() => setShowForm(false)}>×</button></div>
                <div className="modal-body" style={{ display: 'grid', gap: 16 }}>
                  {formError && <div className="sla-blocked-note">{formError}</div>}
                  <section>
                    <h4 style={{ margin: '0 0 8px' }}>A. Informasi Kegiatan</h4>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <label>Tanggal *<input type="date" className="input-field" value={formDate} onChange={(e) => setFormDate(e.target.value)} /></label>
                      <label>Penyulang *{activeFeeders.length === 0 ? <span className="text-muted"> — Belum ada Penyulang aktif untuk ULP ini. <button type="button" className="sla-btn" onClick={() => { setShowForm(false); setActiveTab('penyulang') }}>Ke Master Penyulang</button></span> : <select className="input-select" value={formFeeder} onChange={(e) => setFormFeeder(e.target.value)}><option value="">Pilih Penyulang</option>{activeFeeders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>}</label>
                      <label>Lokasi / Alamat *<input className="input-field" placeholder="Jl. ... / lokasi pekerjaan" value={formLocation} onChange={(e) => setFormLocation(e.target.value)} /></label>
                      <label>Satuan<input className="input-field" value={selectedIndicator.unit ?? ''} disabled /></label>
                    </div>
                  </section>
                  <section>
                    <h4 style={{ margin: '0 0 8px' }}>B. Pekerjaan</h4>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <label>WO *<input type="number" min="0" step="1" className="input-field" value={formWo} onChange={(e) => setFormWo(e.target.value)} /></label>
                      <label>Realisasi *<input type="number" min="0" step="1" className="input-field" value={formRealisasi} onChange={(e) => setFormRealisasi(e.target.value)} /></label>
                      <label>Petugas *{employees.length === 0 ? <span className="text-muted"> — Belum ada pegawai aktif yang dapat dipilih.</span> : null}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                          {formPetugas.map((eid) => {
                            const emp = employees.find((e) => e.id === eid)
                            return <span key={eid} className="sla-badge" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{emp?.name ?? eid}<button type="button" onClick={() => setFormPetugas(formPetugas.filter((x) => x !== eid))}>×</button></span>
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <select className="input-select" value="" onChange={(e) => { if (e.target.value && !formPetugas.includes(e.target.value)) setFormPetugas([...formPetugas, e.target.value]); e.target.value = '' }}>
                            <option value="">+ Tambah Petugas</option>
                            {employees.filter((e) => !formPetugas.includes(e.id)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        </div>
                      </label>
                      <label>Keterangan<textarea className="input-field" rows={3} value={formKeterangan} onChange={(e) => setFormKeterangan(e.target.value)} placeholder="Catatan pekerjaan" /></label>
                    </div>
                  </section>
                  <section>
                    <h4 style={{ margin: '0 0 8px' }}>C. Evidence</h4>
                    <p className="text-muted" style={{ fontSize: 12 }}>Evidence Pekerjaan * — Minimal 1 foto atau dokumen sebagai bukti pekerjaan.</p>
                    <input type="file" multiple accept="image/*,.pdf,.doc,.docx" onChange={(e) => setFormFiles(Array.from(e.target.files ?? []))} />
                    {formFiles.length > 0 && <ul style={{ marginTop: 8 }}>{formFiles.map((f, i) => <li key={i}>{f.name} — {(f.size/1024).toFixed(0)} KB <button type="button" onClick={() => setFormFiles(formFiles.filter((_, idx) => idx !== i))}>Hapus</button></li>)}</ul>}
                  </section>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                    <button type="button" className="sla-btn" disabled={formBusy} onClick={() => setShowForm(false)}>Batal</button>
                    <button type="button" className="sla-btn" disabled={formBusy} onClick={() => handleSaveDraft(false)}>{formBusy ? 'Menyimpan…' : 'Simpan Draft'}</button>
                    <button type="button" className="sla-btn sla-btn-primary" disabled={formBusy} onClick={() => handleSaveDraft(true)}>{formBusy ? 'Mengajukan…' : 'Ajukan'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {showDailyList && dailyIndicator && (
            <div className="modal-backdrop" onClick={() => setShowDailyList(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
                <div className="modal-header"><h3>{getShortLabel(dailyIndicator)} — Harian · Periode {period} · {effectiveUnit?.displayName}</h3><button type="button" className="modal-close" onClick={() => setShowDailyList(false)}>×</button></div>
                <div className="modal-body">
                  {dailyLoading ? <p>Memuat…</p> : dailyList.length === 0 ? <p className="text-muted">Belum ada transaksi harian untuk indikator ini.</p> : (
                    <div className="sla-table-wrap"><table className="sla-table"><thead><tr><th>Tanggal</th><th>Penyulang</th><th>Lokasi</th><th>WO</th><th>Realisasi</th><th>Petugas</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
                      {dailyList.map((row) => (
                        <tr key={row.id}>
                          <td>{row.work_date?.slice(0,10)}</td>
                          <td>{row.feeder_id ? (activeFeeders.find((f) => f.id === row.feeder_id)?.name ?? row.feeder_id.slice(0,8)) : '—'}</td>
                          <td>{row.location_address ?? '—'}</td>
                          <td>{row.work_order ?? '—'}</td>
                          <td>{row.realization ?? '—'}</td>
                          <td>—</td>
                          <td>{row.status === 'DRAFT' ? 'Draft' : row.status === 'SUBMITTED' ? 'Menunggu Persetujuan' : row.status === 'APPROVED' ? 'Disetujui' : row.status === 'REJECTED' ? 'Ditolak' : row.status}</td>
                          <td style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className="sla-btn" onClick={() => openDetail(row.id)}>Lihat Detail</button>
                            {row.status === 'DRAFT' && <button type="button" className="sla-btn sla-btn-primary" onClick={() => handleContinueDraft(row)}>Lanjutkan Draft</button>}
                            {row.status === 'REJECTED' && <button type="button" className="sla-btn" onClick={() => handleContinueDraft(row)}>Perbaiki</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody></table></div>
                  )}
                </div>
              </div>
            </div>
          )}
          {detailEntry && (
            <div className="modal-backdrop" onClick={() => { setDetailEntry(null); setDetailData(null) }}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
                <div className="modal-header"><h3>Detail Transaksi</h3><button type="button" className="modal-close" onClick={() => { setDetailEntry(null); setDetailData(null) }}>×</button></div>
                <div className="modal-body">
                  {!detailData ? <p>Memuat…</p> : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div><strong>Nama Kegiatan:</strong> {(() => { const ind = detailData.indicator ?? indicators.find((r) => r.id === detailData.entry.indicator_id) ?? dailyIndicator; return ind ? getShortLabel(ind) : (dailyIndicator ? getShortLabel(dailyIndicator) : detailData.entry.indicator_id?.slice(0,8)) })()}</div>
                      <div><strong>Referensi SLA:</strong> {(() => { const ind = detailData.indicator ?? indicators.find((r) => r.id === detailData.entry.indicator_id); return ind?.point_code ?? ind?.point ?? '—' })()}</div>
                      <div><strong>Deskripsi SLA resmi:</strong> {(() => { const ind = detailData.indicator ?? indicators.find((r) => r.id === detailData.entry.indicator_id); return ind?.criteria ?? '—' })()}</div>
                      <div><strong>Satuan:</strong> {(() => { const ind = detailData.indicator ?? indicators.find((r) => r.id === detailData.entry.indicator_id); return ind?.measurement_unit ?? selectedIndicator?.unit ?? dailyIndicator?.unit ?? '—' })()}</div>
                      <div><strong>Tanggal:</strong> {detailData.entry.work_date?.slice(0,10)}</div>
                      <div><strong>ULP:</strong> {effectiveUnit?.displayName}</div>
                      <div><strong>Penyulang:</strong> {detailData.entry.feeder_id ? (activeFeeders.find((f) => f.id === detailData.entry.feeder_id)?.name ?? detailData.entry.feeder_id) : '—'}</div>
                      <div><strong>Lokasi:</strong> {detailData.entry.location_address ?? '—'}</div>
                      <div><strong>WO:</strong> {detailData.entry.work_order ?? '—'}</div>
                      <div><strong>Realisasi:</strong> {detailData.entry.realization ?? '—'}</div>
                      <div><strong>Petugas:</strong> {(detailData.personnel ?? []).map((p) => p.employees?.name ?? p.employee_id).join(', ') || '—'}</div>
                      <div><strong>Keterangan:</strong> {detailData.entry.description ?? '—'}</div>
                      <div><strong>Status:</strong> {detailData.entry.status === 'DRAFT' ? 'Draft' : detailData.entry.status === 'SUBMITTED' ? 'Menunggu Persetujuan' : detailData.entry.status === 'APPROVED' ? 'Disetujui' : 'Ditolak'}</div>
                      {detailData.entry.status === 'REJECTED' && detailData.entry.rejection_reason && <div><strong>Alasan Ditolak:</strong> {detailData.entry.rejection_reason}</div>}
                      <div><strong>Evidence:</strong>
                        {(detailData.evidences ?? []).length === 0 ? <span className="text-muted"> Belum ada</span> : (
                          <ul>
                            {(detailData.evidences ?? []).map((ev) => (
                              <li key={ev.id}><button type="button" className="sla-btn" onClick={async () => { const url = await getEvidencePreviewUrl(ev.storage_path); window.open(url, '_blank') }}>{ev.file_name}</button> — {ev.mime_type}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      ) : activeTab === 'persetujuan' ? (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <button type="button" className="sla-btn" onClick={loadPending}>Muat Ulang</button>
            {pendingError && <span className="sla-blocked-note">{pendingError}</span>}
          </div>
          {pendingLoading ? <p>Memuat persetujuan…</p> : pendingList.length === 0 ? <p className="text-muted">Tidak ada transaksi menunggu persetujuan.</p> : (
            <div className="sla-table-wrap"><table className="sla-table"><thead><tr><th>Tanggal</th><th>ULP</th><th>Kegiatan</th><th>Penyulang</th><th>WO</th><th>Realisasi</th><th>Petugas</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
              {pendingList.map((row) => {
                const ulp = childUlps.find((u) => u.uuid === row.unit_id)
                const ind = row.sla_indicators ?? indicators.find((r) => r.id === row.indicator_id) ?? null
                const short = ind ? getShortLabel(ind) : (row.indicator_id?.slice(0,8) ?? '—')
                const feederName = row.feeders?.name ?? '—'
                return (
                  <tr key={row.id}>
                    <td>{row.work_date?.slice(0,10)}</td>
                    <td>{ulp?.displayName ?? row.unit_id?.slice(0,8)}</td>
                    <td>{short}<br/><small className="text-muted">Ref: {ind?.point_code ?? '—'}</small></td>
                    <td>{feederName}</td>
                    <td>{row.work_order ?? '—'}</td>
                    <td>{row.realization ?? '—'}</td>
                    <td>—</td>
                    <td>Menunggu Persetujuan</td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="sla-btn" onClick={() => openApprovalDetail(row)}>Lihat Detail</button>
                      <button type="button" className="sla-btn sla-btn-primary" onClick={() => handleApproveTx(row.id)}>Setujui</button>
                      <button type="button" className="sla-btn" onClick={() => handleRejectTx(row.id)}>Tolak</button>
                    </td>
                  </tr>
                )
              })}
            </tbody></table></div>
          )}
          {approvalDetail && (
            <div className="modal-backdrop" onClick={() => { setApprovalDetail(null); setApprovalData(null) }}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
                <div className="modal-header"><h3>Detail Persetujuan — {approvalData?.indicator ? getShortLabel(approvalData.indicator) : '—'}</h3><button type="button" className="modal-close" onClick={() => { setApprovalDetail(null); setApprovalData(null) }}>×</button></div>
                <div className="modal-body">
                  {!approvalData ? <p>Memuat…</p> : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div><strong>Nama Kegiatan:</strong> {approvalData.indicator ? getShortLabel(approvalData.indicator) : '—'}</div>
                      <div><strong>Referensi SLA:</strong> {approvalData.indicator?.point_code ?? '—'}</div>
                      <div><strong>Deskripsi SLA resmi:</strong> {approvalData.indicator?.criteria ?? slaIndicators.find((s) => s.id === approvalData.row.indicator_id)?.criteria ?? '—'}</div>
                      <div><strong>Satuan:</strong> {approvalData.indicator?.measurement_unit ?? '—'}</div>
                      <div><strong>ULP:</strong> {childUlps.find((u) => u.uuid === approvalData.row.unit_id)?.displayName ?? approvalData.row.unit_id}</div>
                      <div><strong>Tanggal:</strong> {approvalData.entry.work_date?.slice(0,10)}</div>
                      <div><strong>Penyulang:</strong> {approvalData.entry.feeder_id ? (approvalData.entry.feeders?.name ?? approvalData.entry.feeder_id) : '—'}</div>
                      <div><strong>Lokasi:</strong> {approvalData.entry.location_address ?? '—'}</div>
                      <div><strong>WO:</strong> {approvalData.entry.work_order ?? '—'}</div>
                      <div><strong>Realisasi:</strong> {approvalData.entry.realization ?? '—'}</div>
                      <div><strong>Petugas:</strong> {(approvalData.personnel ?? []).map((p) => p.employees?.name ?? p.employee_id).join(', ') || '—'}</div>
                      <div><strong>Keterangan:</strong> {approvalData.entry.description ?? '—'}</div>
                      <div><strong>Status:</strong> Menunggu Persetujuan</div>
                      <div><strong>Evidence:</strong> {(approvalData.evidences ?? []).length === 0 ? <span className="text-muted"> Belum ada</span> : (<ul>{(approvalData.evidences ?? []).map((ev) => (<li key={ev.id}><button type="button" className="sla-btn" onClick={async () => { const url = await getEvidencePreviewUrl(ev.storage_path); window.open(url, '_blank') }}>{ev.file_name}</button> — {ev.mime_type}</li>))}</ul>)}</div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                        <button type="button" className="sla-btn" onClick={() => { setApprovalDetail(null); setApprovalData(null) }}>Tutup</button>
                        <button type="button" className="sla-btn" onClick={() => handleRejectTx(approvalDetail.id)}>Tolak</button>
                        <button type="button" className="sla-btn sla-btn-primary" onClick={() => handleApproveTx(approvalDetail.id)}>Setujui</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
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
