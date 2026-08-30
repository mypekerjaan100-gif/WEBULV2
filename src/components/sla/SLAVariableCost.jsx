import { useEffect, useState, useCallback, useRef } from 'react'
import { variableCostIndicators } from '../../data/slaPelayananTeknik.js'
import { periodLabelToMonth, fetchMonthlyTargets, fetchUp3Targets, fetchMonthlyEntries, fetchApprovedVariableMonthlyEntries, fetchKonstruksiMonthlyAmounts, fetchKonstruksiMonthlyTargets, fetchIndicators, fetchActiveVersion, setVariableTarget, setKonstruksiMonthlyAmounts, setKonstruksiMonthlyTargets, listFeeders, listActiveFeeders, proposeFeeder, createFeederDirect, approveFeeder, rejectFeeder, deactivateFeeder, activateFeeder, deleteFeeder, formatFeederStatus, listDailyEntries, getVariableDetail, saveVariableEntry, submitVariableEntry, uploadVariableEvidence, getEvidencePreviewUrl, getShortLabel, listSubmittedEntries, listRejectedEntries, approveVariableEntry, rejectVariableEntry } from '../../data/variableCostRepository.js'
import { supabase } from '../../lib/supabaseClient.js'
import MasterHargaSatuan from './MasterHargaSatuan.jsx'

const WORKFLOW_INDICATORS = variableCostIndicators.filter((indicator) => indicator.workflowEnabled)
const STANDARD_8 = variableCostIndicators.filter((indicator) => indicator.slaLinked)
const INPUT_INDICATORS = variableCostIndicators.filter((indicator) => indicator.ulpInputEnabled)
const TEBANG_INDICATOR_IDS = variableCostIndicators.filter((indicator) => indicator.code?.startsWith('TEBANG_')).map((indicator) => indicator.id)
const ALL_KEY = 'ALL'
const EMPTY_VALUE = '—'

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
function formatApprovalStatus(status) {
  return status === 'SUBMITTED' ? 'Menunggu Persetujuan' : status === 'APPROVED' ? 'Disetujui' : status === 'REJECTED' ? 'Ditolak' : status ?? '—'
}

export default function SLAVariableCost({ period, periods = [], onPeriodChange, orgMap, role, unitId, up3Id, onRejectedCountChange, approvalCounts = {}, approvalTarget, onApprovalTargetHandled, onApprovalChange, isManagementReadOnly = false, canManageKonstruksiMonthly = false }) {
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
  const [konstruksiAmounts, setKonstruksiAmounts] = useState([])
  const [indicators, setIndicators] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeFeeders, setActiveFeeders] = useState([])
  const [drillIndicator, setDrillIndicator] = useState(null)
  const [activeTab, setActiveTab] = useState('rekap')
  const [activeVersionId, setActiveVersionId] = useState(null)
  const [targetUnitId, setTargetUnitId] = useState(() => childUlps[0]?.uuid ?? '')
  const [targetDrafts, setTargetDrafts] = useState({})
  const [targetBusyPoint, setTargetBusyPoint] = useState('')
  const [targetError, setTargetError] = useState('')
  const [targetMessage, setTargetMessage] = useState('')
  const [konstruksiTargets, setKonstruksiTargets] = useState([])
  const [konstruksiDrafts, setKonstruksiDrafts] = useState({})
  const [konstruksiTargetDrafts, setKonstruksiTargetDrafts] = useState({})
  const [konstruksiBusy, setKonstruksiBusy] = useState(false)
  const [konstruksiError, setKonstruksiError] = useState('')
  const [konstruksiMessage, setKonstruksiMessage] = useState('')
  const [rejectedList, setRejectedList] = useState([])
  const [rejectedLoading, setRejectedLoading] = useState(false)
  const [editingRejectionReason, setEditingRejectionReason] = useState('')
  const monthlyRequestId = useRef(0)
  const handledApprovalToken = useRef(null)
  const approvalDetailRequestId = useRef(0)

  const loadMonthly = useCallback(async () => {
    const requestId = ++monthlyRequestId.current
    if (!contractId || !up3Uuid || !periodMonth) { setLoading(false); return }
    if (isAdminUlpView && !effectiveUnitUuid) { setTargets([]); setEntries([]); setKonstruksiAmounts([]); setKonstruksiTargets([]); setUp3Targets([]); setActiveFeeders([]); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const versionId = await fetchActiveVersion({ contractId, up3Id: up3Uuid, periodMonth })
      if (requestId !== monthlyRequestId.current) return
      setActiveVersionId(versionId)
      if (!versionId) {
        setTargets([]); setEntries([]); setKonstruksiAmounts([]); setKonstruksiTargets([]); setIndicators([]); setUp3Targets([]); setActiveFeeders([])
        return
      }
      const unitUuids = activeTab === 'target' && targetUnitId
        ? [targetUnitId]
        : isConsolidated ? childUlps.map((u) => u.uuid) : (effectiveUnitUuid ? [effectiveUnitUuid] : [])
      const [t, e, tebang, ind, up3t, konstruksi, konstruksiTarget] = await Promise.all([
        unitUuids.length ? fetchMonthlyTargets({ contractId, up3Id: up3Uuid, unitIds: unitUuids, periodMonth, versionId }) : Promise.resolve([]),
        unitUuids.length ? fetchMonthlyEntries({ contractId, up3Id: up3Uuid, unitIds: unitUuids, periodMonth, versionId }) : Promise.resolve([]),
        unitUuids.length ? fetchApprovedVariableMonthlyEntries({ contractId, up3Id: up3Uuid, unitIds: unitUuids, indicatorIds: TEBANG_INDICATOR_IDS, periodMonth, versionId }) : Promise.resolve([]),
        fetchIndicators({ contractId, up3Id: up3Uuid, versionId }).catch(() => []),
        isConsolidated ? fetchUp3Targets({ contractId, up3Id: up3Uuid, periodMonth, versionId }).catch(() => []) : Promise.resolve([]),
        unitUuids.length ? fetchKonstruksiMonthlyAmounts({ contractId, up3Id: up3Uuid, unitIds: unitUuids, periodMonth }) : Promise.resolve([]),
        unitUuids.length ? fetchKonstruksiMonthlyTargets({ contractId, up3Id: up3Uuid, unitIds: unitUuids, periodMonth }) : Promise.resolve([]),
      ])
      if (requestId !== monthlyRequestId.current) return
      setTargets(t ?? []); setEntries([...(e ?? []), ...(tebang ?? [])]); setKonstruksiAmounts(konstruksi ?? []); setKonstruksiTargets(konstruksiTarget ?? []); setIndicators(ind ?? []); setUp3Targets(up3t ?? [])
      if (effectiveUnitUuid && !isConsolidated) {
        const af = await listActiveFeeders({ contractId, up3Id: up3Uuid, unitId: effectiveUnitUuid }).catch(() => [])
        setActiveFeeders(af ?? [])
      } else if (isConsolidated) {
        setActiveFeeders([])
      } else setActiveFeeders([])
    } catch (err) { if (requestId === monthlyRequestId.current) { setError(err.message || 'Gagal memuat data Variable Cost'); setTargets([]); setEntries([]); setKonstruksiAmounts([]); setKonstruksiTargets([]); setUp3Targets([]) } }
    finally { if (requestId === monthlyRequestId.current) setLoading(false) }
  }, [contractId, up3Uuid, periodMonth, effectiveUnitUuid, isAdminUlpView, isConsolidated, activeTab, targetUnitId, childUlps.map((u) => u.uuid).join(',')])

  useEffect(() => { loadMonthly() }, [loadMonthly])

  const [feeders, setFeeders] = useState([])
  const [feederLoading, setFeederLoading] = useState(false)
  const [feederError, setFeederError] = useState('')
  const [feederStatusFilter, setFeederStatusFilter] = useState('')
  const [proposeName, setProposeName] = useState('')
  const [proposeBusy, setProposeBusy] = useState(false)
  const [directUlp, setDirectUlp] = useState(() => effectiveLegacy ?? ALL_KEY)
  const [pendingList, setPendingList] = useState([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingError, setPendingError] = useState('')
  const [approvalDetail, setApprovalDetail] = useState(null)
  const [approvalData, setApprovalData] = useState(null)
  const [approvalDetailError, setApprovalDetailError] = useState('')
  const [focusedFeederId, setFocusedFeederId] = useState(null)

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

  const loadRejected = useCallback(async () => {
    if (!isAdminUlpView || !contractId || !up3Uuid || !effectiveUnitUuid) { setRejectedList([]); if (onRejectedCountChange) onRejectedCountChange(0); return }
    setRejectedLoading(true)
    try {
      const list = await listRejectedEntries({ contractId, up3Id: up3Uuid, unitId: effectiveUnitUuid })
      setRejectedList(list ?? [])
      if (onRejectedCountChange) onRejectedCountChange((list ?? []).length)
    } catch { setRejectedList([]); if (onRejectedCountChange) onRejectedCountChange(0) }
    finally { setRejectedLoading(false) }
  }, [isAdminUlpView, contractId, up3Uuid, effectiveUnitUuid, onRejectedCountChange])

  useEffect(() => { loadRejected() }, [loadRejected])
  useEffect(() => { if (isAdminUlpView && activeTab === 'rekap') loadRejected() }, [activeTab, isAdminUlpView, loadRejected])

  useEffect(() => {
    if (!targetUnitId || !childUlps.some((unit) => unit.uuid === targetUnitId)) {
      setTargetUnitId(childUlps[0]?.uuid ?? '')
    }
  }, [targetUnitId, childUlps.map((unit) => unit.uuid).join(',')])

  useEffect(() => {
    if (activeTab !== 'target') return
    setTargetDrafts(Object.fromEntries(STANDARD_8.map((indicator) => {
      const canonical = indicators.find((row) => row.point_code === indicator.point && row.sla_version_id === activeVersionId)
      const target = targets.find((row) => row.unit_id === targetUnitId && row.indicator_id === canonical?.id)
      return [indicator.point, target?.target_value ?? '']
    })))
  }, [activeTab, activeVersionId, targetUnitId, targets, indicators])

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

  const handleApprove = async (id) => { try { await approveFeeder(id); await loadFeeders(); await onApprovalChange?.(); setFocusedFeederId(null) } catch (e) { setFeederError(e.message) } }
  const handleReject = async (id) => {
    const reason = window.prompt('Alasan penolakan (wajib):')
    if (!reason) return
    try { await rejectFeeder(id, reason); await loadFeeders(); await onApprovalChange?.(); setFocusedFeederId(null) } catch (e) { setFeederError(e.message) }
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
    const requestId = ++approvalDetailRequestId.current
    setApprovalDetail(row)
    setApprovalData(null)
    setApprovalDetailError('')
    try {
      const data = await getVariableDetail(row.id)
      if (requestId !== approvalDetailRequestId.current) return
      const ind = data.indicator ?? row.sla_indicators ?? indicators.find((r) => r.id === row.indicator_id) ?? variableCostIndicators.find((item) => item.id === row.indicator_id) ?? null
      setApprovalData({ ...data, indicator: ind, row })
      if (data.entry.status !== 'SUBMITTED') onApprovalChange?.()
    } catch (error) {
      if (requestId === approvalDetailRequestId.current) setApprovalDetailError(error.message || 'Detail persetujuan gagal dimuat.')
    }
  }
  useEffect(() => {
    if (!approvalTarget?.token || approvalTarget.token === handledApprovalToken.current) return
    if (approvalTarget.source === 'variable') {
      handledApprovalToken.current = approvalTarget.token
      setActiveTab('persetujuan')
      openApprovalDetail({ id: approvalTarget.id, unit_id: approvalTarget.unitId })
      onApprovalTargetHandled?.()
    } else if (approvalTarget.source === 'feeder') {
      handledApprovalToken.current = approvalTarget.token
      const targetUnit = childUlps.find((unit) => unit.uuid === approvalTarget.unitId)
      setSelectedUlpLegacy(targetUnit?.legacyKey ?? approvalTarget.unitId)
      setFeederStatusFilter('')
      setFocusedFeederId(approvalTarget.id)
      setActiveTab('penyulang')
      onApprovalTargetHandled?.()
    }
  }, [approvalTarget?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusedFeederId || !feeders.some((feeder) => feeder.id === focusedFeederId)) return
    document.getElementById(`feeder-${focusedFeederId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusedFeederId, feeders])

  const handleApproveTx = async (id) => {
    try { await approveVariableEntry(id); setApprovalDetail(null); setApprovalData(null); await loadPending(); await loadMonthly(); await onApprovalChange?.() } catch (e) { setPendingError(e.message) }
  }
  const handleRejectTx = async (id) => {
    const reason = window.prompt('Alasan penolakan (wajib):')
    if (!reason?.trim()) return
    try { await rejectVariableEntry(id, reason.trim()); setApprovalDetail(null); setApprovalData(null); await loadPending(); await loadMonthly(); await onApprovalChange?.() } catch (e) { setPendingError(e.message) }
  }

  const handleSaveTarget = async (indicator) => {
    setTargetError(''); setTargetMessage('')
    const canonical = indicators.find((row) => row.point_code === indicator.point && row.sla_version_id === activeVersionId)
    const value = Number(targetDrafts[indicator.point])
    if (!activeVersionId) { setTargetError('Tidak ada versi SLA aktif untuk periode ini.'); return }
    if (!canonical || canonical.variable_cost_profile !== 'STANDARD') { setTargetError('Indikator standar tidak tersedia pada versi SLA aktif.'); return }
    if (targetDrafts[indicator.point] === '' || !Number.isFinite(value) || value < 0) { setTargetError('Target wajib berupa angka >= 0.'); return }
    setTargetBusyPoint(indicator.point)
    try {
      await setVariableTarget({
        contractId,
        up3Id: up3Uuid,
        unitId: targetUnitId,
        versionId: activeVersionId,
        indicatorId: canonical.id,
        periodMonth,
        targetValue: value,
      })
      await loadMonthly()
      setTargetMessage(`${getShortLabel(indicator)} tersimpan.`)
    } catch (error) { setTargetError(error.message || 'Gagal menyimpan target.') }
    finally { setTargetBusyPoint('') }
  }

  const konstruksiEditorUnits = isConsolidated ? childUlps : (effectiveUnit ? [effectiveUnit] : [])
  const openKonstruksiDetail = (indicator) => {
    const drafts = {}
    const targetDraftsMap = {}
    for (const unit of konstruksiEditorUnits) {
      const row = konstruksiAmounts.find((entry) => entry.unit_id === unit.uuid)
      drafts[unit.uuid] = row ? String(Math.trunc(Number(row.amount_rp))) : ''
      const tRow = konstruksiTargets.find((entry) => entry.unit_id === unit.uuid)
      targetDraftsMap[unit.uuid] = tRow ? String(Math.trunc(Number(tRow.target_rp))) : ''
    }
    setKonstruksiDrafts(drafts)
    setKonstruksiTargetDrafts(targetDraftsMap)
    setKonstruksiError('')
    setKonstruksiMessage('')
    setDrillIndicator(indicator)
  }
  const handleSaveKonstruksi = async () => {
    const canonical = indicators.find((row) => row.point_code === '3.1c' && row.variable_cost_profile === 'KONSTRUKSI')
    if (!canonical) { setKonstruksiError('Indikator Konstruksi tidak tersedia pada periode aktif.'); return }
    const amountValues = konstruksiEditorUnits
      .filter((unit) => konstruksiDrafts[unit.uuid] !== '')
      .map((unit) => ({ unitId: unit.uuid, amountRp: Number(konstruksiDrafts[unit.uuid]) }))
    const targetValues = konstruksiEditorUnits
      .filter((unit) => konstruksiTargetDrafts[unit.uuid] !== '')
      .map((unit) => ({ unitId: unit.uuid, targetRp: Number(konstruksiTargetDrafts[unit.uuid]) }))
    if (!amountValues.length && !targetValues.length) {
      setKonstruksiError('Isi minimal satu nominal Rupiah yang valid.')
      return
    }
    if (amountValues.some((entry) => !Number.isFinite(entry.amountRp) || entry.amountRp < 0) || targetValues.some((entry) => !Number.isFinite(entry.targetRp) || entry.targetRp < 0)) {
      setKonstruksiError('Nominal Rupiah harus angka >= 0.')
      return
    }
    setKonstruksiBusy(true); setKonstruksiError(''); setKonstruksiMessage('')
    try {
      if (targetValues.length) {
        await setKonstruksiMonthlyTargets({
          contractId,
          up3Id: up3Uuid,
          periodMonth,
          indicatorId: canonical.id,
          values: targetValues,
        })
      }
      if (amountValues.length) {
        await setKonstruksiMonthlyAmounts({
          contractId,
          up3Id: up3Uuid,
          periodMonth,
          indicatorId: canonical.id,
          values: amountValues,
        })
      }
      await loadMonthly()
      setKonstruksiMessage('Konstruksi tersimpan.')
    } catch (error) {
      setKonstruksiError(error.message || 'Gagal menyimpan Konstruksi.')
    } finally {
      setKonstruksiBusy(false)
    }
  }

  // V3 helpers
  const openInputPicker = () => { if (isConsolidated) return; setShowInputPicker(true) }
  const chooseIndicator = (ind) => {
    setSelectedIndicator(ind)
    setShowInputPicker(false)
    setFormDate(new Date().toISOString().slice(0,10))
    setFormFeeder(''); setFormLocation(''); setFormWo(''); setFormRealisasi(''); setFormPetugas([]); setFormKeterangan(''); setFormFiles([]); setFormError(''); setEditingEntryId(null); setEditingRejectionReason('')
    setShowForm(true)
  }
  const openDailyList = async (ind, rejectedOnly = false) => {
    if (isConsolidated) return
    setDailyIndicator(ind)
    setShowDailyList(true)
    setDailyLoading(true)
    try {
      const uuid = pointToUuids.get(ind.point) ?? ind.id
      const indicatorRow = indicators.find((r) => r.point_code === ind.point || r.legacy_key === ind.id)
      const indicatorId = indicatorRow?.id ?? uuid
      const list = await listDailyEntries({ contractId, up3Id: up3Uuid, unitId: effectiveUnitUuid, indicatorId, periodMonth })
      let filtered = list
      if (rejectedOnly) filtered = list.filter((r) => r.status === 'REJECTED')
      filtered.sort((a, b) => {
        if (a.status === 'REJECTED' && b.status !== 'REJECTED') return -1
        if (b.status === 'REJECTED' && a.status !== 'REJECTED') return 1
        return new Date(b.work_date) - new Date(a.work_date)
      })
      setDailyList(filtered)
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
    const indicatorId = selectedIndicator.slaLinked ? indicatorRow?.id : selectedIndicator.id
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
      setShowForm(false); setSelectedIndicator(null); setEditingEntryId(null); setEditingRejectionReason('')
      await loadMonthly()
      await loadRejected()
      if (dailyIndicator) {
        const list = await listDailyEntries({ contractId, up3Id: up3Uuid, unitId: effectiveUnitUuid, indicatorId, periodMonth })
        setDailyList(list)
      }
    } catch (e) { setFormError(e.message) }
    finally { setFormBusy(false) }
  }
  const handleContinueDraft = async (row) => {
    const data = await getVariableDetail(row.id)
    const indicatorForRow = data.indicator ?? indicators.find((r) => r.id === data.entry.indicator_id) ?? null
    const matchedInput = INPUT_INDICATORS.find((item) => item.id === data.entry.indicator_id) ?? (indicatorForRow ? INPUT_INDICATORS.find((item) => item.point === indicatorForRow.point_code || item.point === indicatorForRow.legacy_key) : null)
    setSelectedIndicator(matchedInput ?? INPUT_INDICATORS.find((item) => item.point === dailyIndicator?.point) ?? INPUT_INDICATORS[0])
    setFormDate(data.entry.work_date?.slice(0,10) ?? new Date().toISOString().slice(0,10))
    setFormFeeder(data.entry.feeder_id ?? '')
    setFormLocation(data.entry.location_address ?? '')
    setFormWo(String(data.entry.work_order ?? ''))
    setFormRealisasi(String(data.entry.realization ?? ''))
    setFormPetugas((data.personnel ?? []).map((p) => p.employee_id))
    setFormKeterangan(data.entry.description ?? '')
    setFormFiles([]); setEditingEntryId(row.id); setEditingRejectionReason(data.entry.rejection_reason ?? ''); setShowForm(true)
    setDailyList([]); setShowDailyList(false)
  }
  const handleRepairRejected = async (row) => {
    await handleContinueDraft(row)
  }

  // Build point -> UUID map for grouping
  const pointToUuids = new Map()
  indicators.forEach((ind) => { if (ind.point_code) pointToUuids.set(ind.point_code, ind.id) })
  variableCostIndicators.filter((indicator) => indicator.code?.startsWith('TEBANG_')).forEach((indicator) => {
    if (indicator.point) pointToUuids.set(indicator.point, indicator.id)
  })

  function getConsolidatedValues(point) {
    if (point === '3.1c') {
      return { wo: 0, realisasi: konstruksiAmounts.reduce((sum, row) => sum + Number(row.amount_rp ?? 0), 0), achievement: null }
    }
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
    WORKFLOW_INDICATORS.forEach((ind) => {
      if (ind.point === '3.1c') return
      const uuid = pointToUuids.get(ind.point)
      if (!uuid) return
      const target = targets.find((row) => row.unit_id === effectiveUnitUuid && row.indicator_id === uuid)
      const entry = entries.find((row) => row.unit_id === effectiveUnitUuid && row.indicator_id === uuid)
      if (target) targetByPoint.set(ind.point, target.target_value)
      if (entry) entryByPoint.set(ind.point, entry)
    })
    const konstruksi = konstruksiAmounts.find((row) => row.unit_id === effectiveUnitUuid)
    if (konstruksi) entryByPoint.set('3.1c', { realization: konstruksi.amount_rp })
  }

  return (
    <section className="sla-module-panel">
      <div className="sla-export-bar" style={{ justifyContent: 'space-between' }}>
        <span className="sla-export-scope">VARIABLE COST — {variableCostIndicators.length} indikator · Periode {period} · {isAdminUlpView ? (effectiveUnit?.displayName ?? effectiveLegacy) : (isConsolidated ? 'Konsolidasi UP3' : (childUlps.find((u) => (u.legacyKey ?? u.uuid) === selectedUlpLegacy)?.displayName ?? '—'))}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className={`sla-btn ${activeTab === 'rekap' ? 'sla-btn-primary' : ''}`} onClick={() => setActiveTab('rekap')}>Rekap Bulanan</button>
          {isUp3Role && !isManagementReadOnly && <button type="button" className={`sla-btn ${activeTab === 'persetujuan' ? 'sla-btn-primary' : ''}`} onClick={() => setActiveTab('persetujuan')}>Persetujuan{(approvalCounts.variable ?? 0) > 0 && <span className="approval-count-badge">{approvalCounts.variable}</span>}</button>}
          {isUp3Role && !isManagementReadOnly && <button type="button" className={`sla-btn ${activeTab === 'target' ? 'sla-btn-primary' : ''}`} onClick={() => setActiveTab('target')}>Target</button>}
          {canManageKonstruksiMonthly && <button type="button" className={`sla-btn ${activeTab === 'harga-satuan' ? 'sla-btn-primary' : ''}`} onClick={() => setActiveTab('harga-satuan')}>Harga Satuan</button>}
          <button type="button" className={`sla-btn ${activeTab === 'penyulang' ? 'sla-btn-primary' : ''}`} onClick={() => setActiveTab('penyulang')}>Master Penyulang{isUp3Role && !isManagementReadOnly && (approvalCounts.feeder ?? 0) > 0 && <span className="approval-count-badge">{approvalCounts.feeder}</span>}</button>
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
          {isAdminUlpView && rejectedList.length > 0 && !rejectedLoading && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '12px 16px', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <strong>{rejectedList.length} transaksi perlu diperbaiki</strong>
                <div className="text-muted" style={{ fontSize: 12 }}>Admin UP3 mengembalikan pengajuan untuk diperbaiki.</div>
              </div>
              <button type="button" className="sla-btn sla-btn-primary" onClick={() => {
                if (rejectedList.length === 1) handleRepairRejected(rejectedList[0])
                else document.getElementById('perlu-perbaikan-section')?.scrollIntoView({ behavior: 'smooth' })
              }}>Lihat Perbaikan</button>
            </div>
          )}
          {isAdminUlpView && rejectedList.length > 0 && (
            <section id="perlu-perbaikan-section" style={{ marginBottom: 16, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>PERLU PERBAIKAN</h3>
              <div className="sla-table-wrap">
                <table className="sla-table">
                  <thead><tr><th>Tanggal</th><th>Kegiatan</th><th>Penyulang</th><th>Alasan Penolakan</th><th>Aksi</th></tr></thead>
                  <tbody>
                    {rejectedList.map((row) => {
                      const ind = row.sla_indicators ?? indicators.find((r) => r.id === row.indicator_id) ?? variableCostIndicators.find((item) => item.id === row.indicator_id) ?? null
                      const short = ind ? getShortLabel(ind) : (row.indicator_id?.slice(0, 8) ?? '—')
                      const feederName = row.feeders?.name ?? '—'
                      return (
                        <tr key={row.id}>
                          <td>{row.work_date?.slice(0, 10)}</td>
                          <td>{short}</td>
                          <td>{feederName}</td>
                          <td style={{ maxWidth: 220, whiteSpace: 'normal' }}>{row.rejection_reason ?? '—'}</td>
                          <td><button type="button" className="sla-btn sla-btn-primary" onClick={() => handleRepairRejected(row)}>Perbaiki Sekarang</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
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
                ) : variableCostIndicators.length === 0 ? (
                  <tr><td colSpan={isConsolidated ? 7 : 6}>Belum ada data Variable Cost pada periode ini.</td></tr>
                ) : variableCostIndicators.map((ind) => {
                  const isKonstruksi = ind.id === 'A-3.1c'
                  if (!ind.workflowEnabled) {
                    return (
                      <tr key={ind.id}>
                        <td>{getShortLabel(ind)}</td>
                        <td>{ind.unit}</td>
                        <td>{EMPTY_VALUE}</td>
                        <td>0</td>
                        <td>0</td>
                        <td>{EMPTY_VALUE}</td>
                        {(isConsolidated || (!isUp3Role && !isConsolidated)) && <td>{EMPTY_VALUE}</td>}
                      </tr>
                    )
                  }
                  if (isConsolidated) {
                    if (isKonstruksi) {
                      const totalTarget = konstruksiTargets.reduce((sum, row) => sum + Number(row.target_rp ?? 0), 0)
                      const hasTarget = konstruksiTargets.length > 0
                      const totalActual = konstruksiAmounts.reduce((sum, row) => sum + Number(row.amount_rp ?? 0), 0)
                      const hasActual = konstruksiAmounts.length > 0
                      const pencapaian = hasTarget && totalTarget > 0 ? formatPercent((totalActual / totalTarget) * 100) : EMPTY_VALUE
                      return (
                        <tr key={ind.id}>
                          <td>{getShortLabel(ind)}</td>
                          <td>—</td>
                          <td>{hasTarget ? formatRp(totalTarget) : EMPTY_VALUE}</td>
                          <td>—</td>
                          <td>{hasActual ? formatRp(totalActual) : EMPTY_VALUE}</td>
                          <td>{pencapaian}</td>
                          <td><button type="button" className="sla-btn" onClick={() => openKonstruksiDetail(ind)}>Detail</button></td>
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
                        <td>{ind.slaLinked ? (up3Target == null ? <span className="text-muted">Belum diatur</span> : formatNumber(up3Target)) : EMPTY_VALUE}</td>
                        <td>{formatNumber(cons.wo)}</td>
                        <td>{formatNumber(cons.realisasi)}</td>
                        <td>{ind.slaLinked && up3Target != null ? pencapaian : EMPTY_VALUE}</td>
                        <td><button type="button" className="sla-btn" onClick={() => setDrillIndicator(ind)}>Detail</button></td>
                      </tr>
                    )
                  }
                  const target = targetByPoint.get(ind.point) ?? null
                  const entry = entryByPoint.get(ind.point) ?? null
                  if (isKonstruksi) {
                    const kTarget = konstruksiTargets.find((r) => r.unit_id === effectiveUnitUuid)?.target_rp ?? null
                    const kActual = konstruksiAmounts.find((r) => r.unit_id === effectiveUnitUuid)?.amount_rp ?? null
                    const kPencapaian = kTarget != null && Number(kTarget) > 0 && kActual != null ? formatPercent((Number(kActual) / Number(kTarget)) * 100) : EMPTY_VALUE
                    return (
                      <tr key={ind.id}>
                        <td>{getShortLabel(ind)}</td>
                        <td>—</td>
                        <td>{kTarget != null ? formatRp(kTarget) : EMPTY_VALUE}</td>
                        <td>—</td>
                        <td>{kActual != null ? formatRp(kActual) : EMPTY_VALUE}</td>
                        <td>{kPencapaian}</td>
                        <td><button type="button" className="sla-btn" onClick={() => openKonstruksiDetail(ind)}>Detail</button></td>
                      </tr>
                    )
                  }
                  const rejectedCount = isAdminUlpView ? rejectedList.filter((r) => {
                    const uuid = pointToUuids.get(ind.point)
                    return uuid ? r.indicator_id === uuid : false
                  }).length : 0
                  return (
                    <tr key={ind.id} style={!isConsolidated && !isUp3Role ? { cursor: 'pointer' } : undefined} onClick={() => { if (!isConsolidated && !isUp3Role) openDailyList(ind) }}>
                      <td>{getShortLabel(ind)}{rejectedCount > 0 && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); const uuid = pointToUuids.get(ind.point); const related = rejectedList.filter((r) => r.indicator_id === uuid); if (related.length === 1) handleRepairRejected(related[0]); else openDailyList(ind, true); }} style={{ marginLeft: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{rejectedCount} Perlu Perbaikan</button>
                      )}</td>
                      <td>{ind.unit ?? '—'}</td>
                      <td>{ind.slaLinked ? (target == null ? <span className="text-muted">Belum diatur</span> : formatNumber(target)) : EMPTY_VALUE}</td>
                      <td>{entry?.work_order == null ? '0' : formatNumber(entry.work_order)}</td>
                      <td>{entry?.realization == null ? '0' : formatNumber(entry.realization)}</td>
                      <td>{ind.slaLinked && entry?.achievement != null ? formatPercent(entry.achievement) : EMPTY_VALUE}</td>
                      {!isConsolidated && !isUp3Role && <td><button type="button" className="sla-btn" onClick={(e) => { e.stopPropagation(); openDailyList(ind) }}>Lihat Detail</button></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!loading && !error && isConsolidated && entries.length === 0 && konstruksiAmounts.length === 0 && (
            <p className="text-muted" style={{ marginTop: 12 }}>Belum ada data Variable Cost pada periode ini. WO/Realisasi konsolidasi 0 (hanya APPROVED).</p>
          )}
          {!loading && !error && !isConsolidated && entries.length === 0 && konstruksiAmounts.length === 0 && (
            <p className="text-muted" style={{ marginTop: 12 }}>Belum ada data Variable Cost pada periode ini.</p>
          )}
          {entries.length === 0 && konstruksiAmounts.length === 0 && targets.length === 0 && up3Targets.length === 0 && !loading && !error && (
            <p className="text-muted">Target belum diatur oleh Admin UP3.</p>
          )}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!isConsolidated && !isUp3Role && !isManagementReadOnly && (
              <button type="button" className="sla-btn sla-btn-primary" onClick={openInputPicker}>+ Input Kegiatan</button>
            )}
            {isUp3Role && !isConsolidated && (
              <span className="text-muted" style={{ alignSelf: 'center' }}>Monitoring ULP — input oleh ADMIN_ULP</span>
            )}
            {isConsolidated && (
              <span className="text-muted" style={{ alignSelf: 'center' }}>{childUlps.length} ULP — workflow APPROVED + Konstruksi bulanan langsung</span>
            )}
            {!isConsolidated && isUp3Role && null}
            {!isConsolidated && !isUp3Role && <span className="text-muted" style={{ alignSelf: 'center' }}>{activeFeeders.length} Penyulang aktif</span>}
          </div>
          {drillIndicator && (
            <div className="modal-backdrop" onClick={() => setDrillIndicator(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
                <div className="modal-header">
                  <h3>{drillIndicator.id === 'A-3.1c' ? `KONSTRUKSI — ${period.toUpperCase()}` : `Detail ${getShortLabel(drillIndicator)} · Periode ${period}`}</h3>
                  <button type="button" className="modal-close" onClick={() => setDrillIndicator(null)}>×</button>
                </div>
                <div className="modal-body">
                  <table className="sla-table">
                    <thead>
                      <tr>
                        <th>ULP</th>
                        {drillIndicator.id === 'A-3.1c' ? (
                          <><th>Target Pendapatan</th><th>Aktual</th><th>Pencapaian</th></>
                        ) : (
                          <><th>Target</th><th>WO</th><th>Realisasi</th><th>Pencapaian</th></>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {(drillIndicator.id === 'A-3.1c' ? konstruksiEditorUnits : childUlps).map((ulp) => {
                        const uuid = pointToUuids.get(drillIndicator.point)
                        const row = entries.find((e) => e.unit_id === ulp.uuid && (uuid ? e.indicator_id === uuid : false))
                        const tRow = targets.find((t) => t.unit_id === ulp.uuid && (uuid ? t.indicator_id === uuid : false))
                        if (drillIndicator.id === 'A-3.1c') {
                          const amount = konstruksiAmounts.find((entry) => entry.unit_id === ulp.uuid)?.amount_rp
                          const target = konstruksiTargets.find((entry) => entry.unit_id === ulp.uuid)?.target_rp
                          const pencapaian = target != null && Number(target) > 0 && amount != null ? formatPercent((Number(amount) / Number(target)) * 100) : EMPTY_VALUE
                          if (canManageKonstruksiMonthly) {
                            const draftTarget = konstruksiTargetDrafts[ulp.uuid] ?? ''
                            const draftAmount = konstruksiDrafts[ulp.uuid] ?? ''
                            const liveTarget = draftTarget !== '' ? Number(draftTarget) : null
                            const liveAmount = draftAmount !== '' ? Number(draftAmount) : Number(amount ?? 0)
                            const livePencapaian = liveTarget != null && liveTarget > 0 && draftAmount !== '' ? formatPercent((liveAmount / liveTarget) * 100) : pencapaian
                            return <tr key={ulp.uuid}><td>{ulp.displayName}</td><td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span>Rp</span><input className="input-number" inputMode="numeric" value={draftTarget} placeholder="0" onChange={(event) => setKonstruksiTargetDrafts((current) => ({ ...current, [ulp.uuid]: event.target.value.replace(/\D/g, '') }))} /></div></td><td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span>Rp</span><input className="input-number" inputMode="numeric" value={draftAmount} placeholder="0" onChange={(event) => setKonstruksiDrafts((current) => ({ ...current, [ulp.uuid]: event.target.value.replace(/\D/g, '') }))} /></div></td><td>{livePencapaian}</td></tr>
                          }
                          return <tr key={ulp.uuid}><td>{ulp.displayName}</td><td>{target != null ? formatRp(target) : EMPTY_VALUE}</td><td>{amount != null ? formatRp(amount) : EMPTY_VALUE}</td><td>{pencapaian}</td></tr>
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
                        (() => {
                          const totalTarget = canManageKonstruksiMonthly
                            ? konstruksiEditorUnits.reduce((sum, unit) => {
                                const v = konstruksiTargetDrafts[unit.uuid]
                                return sum + (v !== '' && v != null ? Number(v) : Number(konstruksiTargets.find((r) => r.unit_id === unit.uuid)?.target_rp ?? 0))
                              }, 0)
                            : konstruksiTargets.reduce((sum, row) => sum + Number(row.target_rp ?? 0), 0)
                          const totalActual = canManageKonstruksiMonthly
                            ? konstruksiEditorUnits.reduce((sum, unit) => {
                                const v = konstruksiDrafts[unit.uuid]
                                return sum + (v !== '' && v != null ? Number(v) : Number(konstruksiAmounts.find((r) => r.unit_id === unit.uuid)?.amount_rp ?? 0))
                              }, 0)
                            : konstruksiAmounts.reduce((sum, row) => sum + Number(row.amount_rp ?? 0), 0)
                          const hasTarget = canManageKonstruksiMonthly ? konstruksiEditorUnits.some((unit) => (konstruksiTargetDrafts[unit.uuid] ?? '') !== '' || konstruksiTargets.some((r) => r.unit_id === unit.uuid)) : konstruksiTargets.length > 0
                          const pencapaian = hasTarget && totalTarget > 0 ? formatPercent((totalActual / totalTarget) * 100) : EMPTY_VALUE
                          return <tr style={{ fontWeight: 600 }}><td>Total UP3</td><td>{hasTarget ? formatRp(totalTarget) : EMPTY_VALUE}</td><td>{formatRp(totalActual)}</td><td>{pencapaian}</td></tr>
                        })()
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
                  {drillIndicator.id === 'A-3.1c' && canManageKonstruksiMonthly && (
                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className="sla-btn sla-btn-primary" disabled={konstruksiBusy} onClick={handleSaveKonstruksi}>{konstruksiBusy ? 'Menyimpan...' : 'Simpan'}</button>
                      {konstruksiMessage && <span style={{ color: '#065f46' }}>{konstruksiMessage}</span>}
                      {konstruksiError && <span className="sla-blocked-note">{konstruksiError}</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {showInputPicker && (
            <div className="modal-backdrop" onClick={() => setShowInputPicker(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
                <div className="modal-header"><h3>Pilih Jenis Kegiatan</h3><button type="button" className="modal-close" onClick={() => setShowInputPicker(false)}>×</button></div>
                <div className="modal-body" style={{ display: 'grid', gap: 10 }}>
                  {INPUT_INDICATORS.map((ind) => (
                    <button key={ind.id} type="button" className="sla-btn" style={{ textAlign: 'left', padding: 12, justifyContent: 'flex-start' }} onClick={() => chooseIndicator(ind)}>
                      <div><strong>{getShortLabel(ind)}</strong><br/><small>{ind.unit} · {ind.scope ?? 'Variable Cost'}</small></div>
                    </button>
                  ))}
                  <div className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>Konstruksi dikelola sebagai pendapatan bulanan langsung oleh management.</div>
                </div>
              </div>
            </div>
          )}
          {showForm && selectedIndicator && (
            <div className="modal-backdrop" onClick={() => { setShowForm(false); setEditingRejectionReason('') }}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
                <div className="modal-header"><h3>{editingEntryId ? (editingRejectionReason ? 'Perbaiki Pengajuan' : 'Lanjutkan Draft') : 'Input Kegiatan'} — {getShortLabel(selectedIndicator)}</h3><button type="button" className="modal-close" onClick={() => { setShowForm(false); setEditingRejectionReason('') }}>×</button></div>
                <div className="modal-body" style={{ display: 'grid', gap: 16 }}>
                  {formError && <div className="sla-blocked-note">{formError}</div>}
                  {editingRejectionReason && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: 10, borderRadius: 6 }}>
                      <strong>Alasan penolakan dari Admin UP3</strong>
                      <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{editingRejectionReason}</div>
                    </div>
                  )}
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
                    <button type="button" className="sla-btn" disabled={formBusy} onClick={() => { setShowForm(false); setEditingRejectionReason('') }}>Batal</button>
                    <button type="button" className="sla-btn" disabled={formBusy} onClick={() => handleSaveDraft(false)}>{formBusy ? 'Menyimpan…' : 'Simpan Draft'}</button>
                    <button type="button" className="sla-btn sla-btn-primary" disabled={formBusy} onClick={() => handleSaveDraft(true)}>{formBusy ? 'Mengajukan…' : (editingRejectionReason ? 'Ajukan Ulang' : 'Ajukan')}</button>
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
                        <tr key={row.id} style={row.status === 'REJECTED' ? { background: '#fef2f2' } : undefined}>
                          <td>{row.work_date?.slice(0,10)}</td>
                          <td>{row.feeder_id ? (activeFeeders.find((f) => f.id === row.feeder_id)?.name ?? row.feeder_id.slice(0,8)) : '—'}</td>
                          <td>{row.location_address ?? '—'}</td>
                          <td>{row.work_order ?? '—'}</td>
                          <td>{row.realization ?? '—'}</td>
                          <td>—</td>
                          <td>
                            <div>{row.status === 'DRAFT' ? 'Draft' : row.status === 'SUBMITTED' ? 'Menunggu Persetujuan' : row.status === 'APPROVED' ? 'Disetujui' : row.status === 'REJECTED' ? 'Ditolak · Perlu Perbaikan' : row.status}</div>
                            {row.status === 'REJECTED' && row.rejection_reason && <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4, whiteSpace: 'normal' }}>Alasan: {row.rejection_reason}</div>}
                          </td>
                          <td style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className="sla-btn" onClick={() => openDetail(row.id)}>Lihat Detail</button>
                            {row.status === 'DRAFT' && <button type="button" className="sla-btn sla-btn-primary" onClick={() => handleContinueDraft(row)}>Lanjutkan Draft</button>}
                            {row.status === 'REJECTED' && <button type="button" className="sla-btn sla-btn-primary" onClick={() => handleContinueDraft(row)}>Perbaiki Sekarang</button>}
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
                const ind = row.sla_indicators ?? indicators.find((r) => r.id === row.indicator_id) ?? variableCostIndicators.find((item) => item.id === row.indicator_id) ?? null
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
            <div className="modal-backdrop" data-approval-id={approvalDetail.id} onClick={() => { setApprovalDetail(null); setApprovalData(null) }}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
                <div className="modal-header"><h3>Detail Persetujuan — {approvalData?.indicator ? getShortLabel(approvalData.indicator) : '—'}</h3><button type="button" className="modal-close" onClick={() => { setApprovalDetail(null); setApprovalData(null) }}>×</button></div>
                <div className="modal-body">
                  {approvalDetailError ? <p className="sla-blocked-note">{approvalDetailError}</p> : !approvalData ? <p>Memuat…</p> : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div><strong>Nama Kegiatan:</strong> {approvalData.indicator ? getShortLabel(approvalData.indicator) : '—'}</div>
                      <div><strong>Referensi SLA:</strong> {approvalData.indicator?.point_code ?? '—'}</div>
                      <div><strong>Deskripsi SLA resmi:</strong> {approvalData.indicator?.criteria ?? '—'}</div>
                      <div><strong>Satuan:</strong> {approvalData.indicator?.measurement_unit ?? approvalData.indicator?.unit ?? '—'}</div>
                      <div><strong>ULP:</strong> {childUlps.find((u) => u.uuid === approvalData.row.unit_id)?.displayName ?? approvalData.row.unit_id}</div>
                      <div><strong>Tanggal:</strong> {approvalData.entry.work_date?.slice(0,10)}</div>
                      <div><strong>Penyulang:</strong> {approvalData.entry.feeder_id ? (approvalData.entry.feeders?.name ?? approvalData.entry.feeder_id) : '—'}</div>
                      <div><strong>Lokasi:</strong> {approvalData.entry.location_address ?? '—'}</div>
                      <div><strong>WO:</strong> {approvalData.entry.work_order ?? '—'}</div>
                      <div><strong>Realisasi:</strong> {approvalData.entry.realization ?? '—'}</div>
                      <div><strong>Petugas:</strong> {(approvalData.personnel ?? []).map((p) => p.employees?.name ?? p.employee_id).join(', ') || '—'}</div>
                      <div><strong>Keterangan:</strong> {approvalData.entry.description ?? '—'}</div>
                      <div><strong>Status:</strong> {formatApprovalStatus(approvalData.entry.status)}</div>
                      <div><strong>Evidence:</strong> {(approvalData.evidences ?? []).length === 0 ? <span className="text-muted"> Belum ada</span> : (<ul>{(approvalData.evidences ?? []).map((ev) => (<li key={ev.id}><button type="button" className="sla-btn" onClick={async () => { const url = await getEvidencePreviewUrl(ev.storage_path); window.open(url, '_blank') }}>{ev.file_name}</button> — {ev.mime_type}</li>))}</ul>)}</div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                        <button type="button" className="sla-btn" onClick={() => { setApprovalDetail(null); setApprovalData(null) }}>Tutup</button>
                        {approvalData.entry.status === 'SUBMITTED' && <button type="button" className="sla-btn" onClick={() => handleRejectTx(approvalDetail.id)}>Tolak</button>}
                        {approvalData.entry.status === 'SUBMITTED' && <button type="button" className="sla-btn sla-btn-primary" onClick={() => handleApproveTx(approvalDetail.id)}>Setujui</button>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : activeTab === 'harga-satuan' ? (
        <MasterHargaSatuan contractId={contractId} up3Id={up3Uuid} up3Name={units.find(u=>u.uuid===up3Uuid)?.displayName ?? 'UP3'} canManage={canManageKonstruksiMonthly} />
      ) : activeTab === 'target' ? (
        <div>
          <h3 style={{ margin: '0 0 12px' }}>TARGET VARIABLE COST</h3>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label>Periode:{' '}
              <select className="input-select" value={period} disabled={!!targetBusyPoint} onChange={(event) => onPeriodChange?.(event.target.value)}>
                {periods.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>ULP:{' '}
              <select className="input-select" value={targetUnitId} disabled={!!targetBusyPoint} onChange={(event) => { setTargetMessage(''); setTargetError(''); setTargetUnitId(event.target.value) }}>
                {childUlps.map((unit) => <option key={unit.uuid} value={unit.uuid}>{unit.displayName}</option>)}
              </select>
            </label>
          </div>
          {targetError && <p className="sla-blocked-note">{targetError}</p>}
          {targetMessage && <p className="text-muted">{targetMessage}</p>}
          {!activeVersionId && <p className="sla-blocked-note">Tidak ada versi SLA aktif untuk periode ini.</p>}
          <div className="sla-table-wrap">
            <table className="sla-table">
              <thead><tr><th>Kegiatan</th><th>Satuan</th><th>Target</th><th>Aksi</th></tr></thead>
              <tbody>
                {STANDARD_8.map((indicator) => {
                  const canonical = indicators.find((row) => row.point_code === indicator.point && row.sla_version_id === activeVersionId)
                  const busy = targetBusyPoint === indicator.point
                  return (
                    <tr key={indicator.id}>
                      <td>{getShortLabel(indicator)}</td>
                      <td>{canonical?.measurement_unit ?? indicator.unit ?? '—'}</td>
                      <td><input type="number" min="0" className="input-field" value={targetDrafts[indicator.point] ?? ''} disabled={!activeVersionId || !!targetBusyPoint} onChange={(event) => setTargetDrafts((current) => ({ ...current, [indicator.point]: event.target.value }))} /></td>
                      <td><button type="button" className="sla-btn sla-btn-primary" disabled={!activeVersionId || !!targetBusyPoint} onClick={() => handleSaveTarget(indicator)}>{busy ? 'Menyimpan…' : 'Simpan'}</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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

          {!isManagementReadOnly && (
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
          )}

          {feederError && <p className="sla-blocked-note">{feederError}</p>}

          {feederLoading ? <p>Memuat Penyulang…</p> : feeders.length === 0 ? (
            <p className="text-muted">Belum ada Penyulang aktif untuk ULP ini.</p>
          ) : (
            <div className="sla-table-wrap">
              <table className="sla-table">
                <thead><tr><th>Nama Penyulang</th><th>Status</th><th>Tanggal Pengajuan</th><th>Aksi</th></tr></thead>
                <tbody>
                  {feeders.map((f) => (
                    <tr key={f.id} id={`feeder-${f.id}`} className={focusedFeederId === f.id ? 'approval-focused-row' : ''}>
                      <td>{f.name}</td>
                      <td>{formatFeederStatus(f.status)}{f.status === 'REJECTED' && f.rejection_reason ? ` — ${f.rejection_reason}` : ''}</td>
                      <td>{f.proposed_at ? new Date(f.proposed_at).toLocaleDateString('id-ID') : '—'}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {f.status === 'PENDING' && !isAdminUlpView && !isManagementReadOnly && (
                          <>
                            <button type="button" className="sla-btn sla-btn-primary" onClick={() => handleApprove(f.id)}>Approve</button>
                            <button type="button" className="sla-btn" onClick={() => handleReject(f.id)}>Reject</button>
                          </>
                        )}
                        {f.status === 'ACTIVE' && !isAdminUlpView && !isManagementReadOnly && (
                          <button type="button" className="sla-btn" onClick={() => handleToggleActive(f)}>Nonaktifkan</button>
                        )}
                        {f.status === 'INACTIVE' && !isAdminUlpView && !isManagementReadOnly && (
                          <button type="button" className="sla-btn" onClick={() => handleToggleActive(f)}>Aktifkan</button>
                        )}
                        {!isAdminUlpView && !isManagementReadOnly && (
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
