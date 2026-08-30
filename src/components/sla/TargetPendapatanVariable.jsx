import { useEffect, useRef, useState } from 'react'
import { variableCostIndicators } from '../../data/slaPelayananTeknik.js'
import { getShortLabel, listVariableRevenueTargets, periodLabelToMonth, setVariableRevenueTargets } from '../../data/variableCostRepository.js'

const PRICED_INDICATORS = variableCostIndicators.filter((indicator) => !['3.1a', '3.1c'].includes(indicator.point))

function keyOf(unitId, indicatorId) {
  return `${unitId}:${indicatorId}`
}

export default function TargetPendapatanVariable({ contractId, up3Id, period, periods, onPeriodChange, units, onSaved }) {
  const [rows, setRows] = useState([])
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loadedPeriodMonth, setLoadedPeriodMonth] = useState('')
  const requestId = useRef(0)
  const periodMonth = periodLabelToMonth(period)

  const load = async () => {
    if (!contractId || !up3Id || !periodMonth) return
    const currentRequest = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const data = await listVariableRevenueTargets({ contractId, up3Id, periodMonth })
      if (currentRequest !== requestId.current) return
      setRows(data ?? [])
      setDrafts(Object.fromEntries((data ?? []).map((row) => [keyOf(row.unit_id, row.indicator_id), row.target_amount == null ? '' : String(row.target_amount)])))
      setLoadedPeriodMonth(periodMonth)
    } catch (err) {
      if (currentRequest !== requestId.current) return
      setRows([])
      setDrafts({})
      setLoadedPeriodMonth('')
      setError(err.message || 'Gagal memuat Target Pendapatan')
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }

  useEffect(() => { load() }, [contractId, up3Id, periodMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  const authorizedUnitIds = [...new Set(rows.map((row) => row.unit_id))]
  const authorizedUnits = authorizedUnitIds.map((id) => units.find((unit) => unit.uuid === id)).filter(Boolean)
  const rowByCodeAndUnit = new Map(rows.map((row) => [`${row.indicator_code}:${row.unit_id}`, row]))

  const handleSave = async () => {
    if (loadedPeriodMonth !== periodMonth) {
      setError('Data periode belum selesai dimuat. Silakan tunggu lalu simpan kembali.')
      return
    }
    const values = []
    for (const row of rows) {
      const raw = drafts[keyOf(row.unit_id, row.indicator_id)] ?? ''
      const targetAmount = raw === '' ? null : Number(raw)
      if (targetAmount != null && (!Number.isFinite(targetAmount) || targetAmount < 0)) {
        setError('Target Pendapatan harus berupa Rupiah nol atau lebih.')
        return
      }
      values.push({ unitId: row.unit_id, indicatorId: row.indicator_id, targetAmount })
    }
    if (!values.length) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await setVariableRevenueTargets({ contractId, up3Id, periodMonth, values })
      setMessage('Target Pendapatan tersimpan.')
      await load()
      await onSaved?.()
    } catch (err) {
      setError(err.message || 'Gagal menyimpan Target Pendapatan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <h3 style={{ margin: '0 0 12px' }}>TARGET PENDAPATAN</h3>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>Periode:{' '}
          <select className="input-select" value={period} disabled={saving} onChange={(event) => onPeriodChange?.(event.target.value)}>
            {periods.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <span className="text-muted">Manual Rupiah per ULP. Tidak dihitung dari Target Operasional.</span>
      </div>
      {error && <p className="sla-blocked-note">{error}</p>}
      {message && <p style={{ color: '#065f46' }}>{message}</p>}
      {loading ? <p>Memuat Target Pendapatan...</p> : authorizedUnits.length === 0 ? <p className="text-muted">Tidak ada ULP dalam scope yang dapat dikelola.</p> : (
        <div className="sla-table-wrap">
          <table className="sla-table">
            <thead><tr><th>Kegiatan</th>{authorizedUnits.map((unit) => <th key={unit.uuid}>{unit.displayName}</th>)}</tr></thead>
            <tbody>
              {PRICED_INDICATORS.map((indicator) => (
                <tr key={indicator.id}>
                  <td>{getShortLabel(indicator)}</td>
                  {authorizedUnits.map((unit) => {
                    const row = rowByCodeAndUnit.get(`${indicator.code ?? indicator.point}:${unit.uuid}`)
                    if (!row) return <td key={unit.uuid} className="text-muted">Tidak tersedia</td>
                    const key = keyOf(unit.uuid, row.indicator_id)
                    return (
                      <td key={unit.uuid}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 135 }}>
                          <span>Rp</span>
                          <input className="input-number" inputMode="numeric" value={drafts[key] ?? ''} placeholder="Belum diatur" disabled={saving} onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value.replace(/\D/g, '') }))} />
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <button type="button" className="sla-btn sla-btn-primary" disabled={saving || loading || rows.length === 0} onClick={handleSave}>{saving ? 'Menyimpan...' : 'Simpan Target Pendapatan'}</button>
      </div>
      <p className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>Kosongkan nilai untuk menandai Target belum diatur. ROW Fix dan Konstruksi tidak dikelola pada matrix ini.</p>
    </section>
  )
}
