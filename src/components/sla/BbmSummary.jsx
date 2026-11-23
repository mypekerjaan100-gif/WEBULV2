import { Fragment, useEffect, useState } from 'react'
import { getBbmSheet, listBbmVehicles } from '../../data/bbmRepository.js'
import { bbmLocationLabel, bbmNumber as fmt, bbmToday } from '../../data/bbmDomain.js'
import { summarizeBbm, totalBbmSummary } from '../../data/bbmSummary.js'
import BbmMonthPicker from './BbmMonthPicker.jsx'
import BbmSelect from './BbmSelect.jsx'
import './BbmSummary.css'

const headers = ['No', 'ULP', 'Nopol', 'Kendaraan / lokasi', 'Hari lengkap', 'KM tempuh', 'BBM (liter)', 'Biaya (Rp)', 'Rasio (KM/liter)', 'Status']
export default function BbmSummary({ contractId, up3Id, units, ownUlpId, initialMonth, dirty, onOpen }) {
  const [month, setMonth] = useState(initialMonth.slice(0, 7))
  const [ulp, setUlp] = useState(ownUlpId || '')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [exporting, setExporting] = useState(false)
  const unitName = (id) => units.find((unit) => unit.uuid === id)?.displayName || 'ULP'
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setRows([])
    async function load() {
      const vehicles = (await listBbmVehicles({ contractId, up3Id, month })).filter((v) => !ownUlpId || v.ulp_id === ownUlpId)
      let cursor = 0
      const results = new Array(vehicles.length)
      await Promise.all(Array.from({ length: Math.min(4, vehicles.length) }, async () => {
        while (active && cursor < vehicles.length) {
          const index = cursor++
          results[index] = summarizeBbm(vehicles[index], await getBbmSheet(vehicles[index].id, month), month)
        }
      }))
      if (active) setRows(results)
    }
    load().catch(() => { if (active) setError('Ringkasan belum dapat dimuat. Silakan muat ulang.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [contractId, up3Id, ownUlpId, month, reload])
  const visible = rows.filter((row) => !ulp || row.vehicle.ulp_id === ulp)
  const groups = [...new Set(visible.map((row) => row.vehicle.ulp_id))].sort((a, b) => unitName(a).localeCompare(unitName(b), 'id'))
  const total = totalBbmSummary(visible)
  const exportExcel = async () => {
    setExporting(true)
    try {
      const XLSX = await import('xlsx')
      const data = [['RINGKASAN BBM SEMUA UNIT'], ['Periode', month], ['Cakupan', ulp ? unitName(ulp) : 'Semua ULP'], [], headers]
      let index = 0
      for (const group of groups) {
        const members = visible.filter((row) => row.vehicle.ulp_id === group)
        for (const row of members) data.push([
          ++index, unitName(group), row.vehicle.plate_display || 'Nopol belum diisi',
          [row.vehicle.label, bbmLocationLabel(row.vehicle)].filter(Boolean).join(' · '),
          `${row.completeDays}/${row.expectedDays}`, row.recorded ? row.km : null,
          row.recorded ? row.liters : null, row.recorded ? row.total : null, row.ratio, row.status,
        ])
        const sum = totalBbmSummary(members)
        data.push(['', unitName(group), 'SUBTOTAL', `${members.length} kendaraan`, '', sum.km, sum.liters, sum.total, sum.ratio])
      }
      data.push(['', '', 'TOTAL', `${visible.length} kendaraan`, '', total.km, total.liters, total.total, total.ratio])
      data.push([], ['Rasio = KM tercatat / liter dibeli. Rasio sementara jika data belum lengkap.'])
      const ws = XLSX.utils.aoa_to_sheet(data)
      ws['!cols'] = [6, 24, 22, 44, 16, 18, 18, 22, 22, 26].map((wch) => ({ wch }))
      for (let r = 5; r < data.length; r++) for (let c = 5; c <= 8; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        if (cell?.t === 'n') cell.z = c === 7 ? '#,##0.00' : '#,##0.000'
      }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Ringkasan BBM')
      XLSX.writeFile(wb, `Ringkasan-BBM-${month}.xlsx`)
    } catch { setError('Excel belum dapat dibuat. Silakan coba lagi.') }
    finally { setExporting(false) }
  }
  const numericCells = (row, empty = false) => <>{['km', 'liters', 'total', 'ratio'].map((key) => <td className="bbm-summary-num" key={key}>{empty ? '—' : fmt(row[key], key === 'km' ? 1 : key === 'total' ? 2 : 3)}</td>)}</>
  let index = 0
  return <section className="bbm-summary" aria-label="Ringkasan BBM semua unit">
    <div className="bbm-toolbar"><strong>Ringkasan Semua Unit</strong><div>
      <label>Periode <BbmMonthPicker ariaLabel="Periode ringkasan BBM" value={month} max={bbmToday().slice(0, 7)} onChange={setMonth} /></label>
      {!ownUlpId && <label>ULP <BbmSelect ariaLabel="ULP ringkasan BBM" value={ulp} onChange={setUlp} searchable options={[{ value: '', label: 'Semua ULP' }, ...units.filter((u) => u.type === 'ULP').map((u) => ({ value: u.uuid, label: u.displayName }))]} /></label>}
      <button type="button" disabled={loading} onClick={() => setReload((n) => n + 1)}>Muat ulang ringkasan</button>
      <button type="button" disabled={loading || !visible.length || exporting} onClick={exportExcel}>{exporting ? 'Menyiapkan…' : 'Unduh Excel'}</button>
    </div></div>
    <p className="bbm-summary-note">Data laporan tersimpan · {visible.length} kendaraan · {groups.length} ULP. Rasio = KM tercatat ÷ liter dibeli; subtotal memakai total KM ÷ total liter.</p>
    {dirty && <p className="bbm-warning">Ada perubahan di Lembar Harian yang belum disimpan dan belum masuk ringkasan.</p>}
    {error && <p role="alert" className="bbm-error">{error}</p>}
    {loading ? <p role="status">Memuat ringkasan semua unit…</p> : !visible.length ? <p>Belum ada data kendaraan untuk cakupan ini.</p> : <div className="bbm-summary-scroll" tabIndex={0} aria-label="Tabel ringkasan BBM">
      <table className="bbm-summary-grid">
        <caption>REKAPITULASI BBM KENDARAAN — {month}</caption>
        <thead><tr>{headers.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{groups.map((group) => {
          const members = visible.filter((row) => row.vehicle.ulp_id === group)
          return <Fragment key={group}>{members.map((row) => <tr key={row.vehicle.id}>
            <td>{++index}</td><td>{unitName(group)}</td>
            <td><button type="button" onClick={() => onOpen(row.vehicle.id, month)}>{row.vehicle.plate_display || 'Nopol belum diisi'}</button></td>
            <td>{row.vehicle.label}<small>{bbmLocationLabel(row.vehicle)}</small></td>
            <td>{row.completeDays}/{row.expectedDays}</td>{numericCells(row, !row.recorded)}
            <td><span className={`bbm-summary-status ${row.status === 'Lengkap s.d. periode' ? 'is-complete' : ''}`}>{row.status}</span></td>
          </tr>)}<tr className="bbm-summary-subtotal"><th colSpan={5}>Subtotal {unitName(group)} · {members.length} kendaraan</th>{numericCells(totalBbmSummary(members))}<td /></tr></Fragment>
        })}</tbody>
        <tfoot><tr><th colSpan={5}>TOTAL · {visible.length} kendaraan</th>{numericCells(total)}<td>{visible.some((r) => r.status !== 'Lengkap s.d. periode') ? 'Data belum lengkap' : 'Lengkap s.d. periode'}</td></tr></tfoot>
      </table>
    </div>}
    <p className="bbm-summary-note">Hari lengkap dihitung sampai hari ini untuk bulan berjalan. Rasio masih sementara bila data belum lengkap. Klik nopol untuk membuka laporan harian.</p>
  </section>
}
