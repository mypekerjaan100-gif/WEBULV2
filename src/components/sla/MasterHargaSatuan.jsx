import { useEffect, useState } from 'react'
import { variableCostIndicators } from '../../data/slaPelayananTeknik.js'
import { listVariableUnitPrices, setVariableUnitPrices, getShortLabel, fetchIndicators, fetchActiveVersion } from '../../data/variableCostRepository.js'
import { Alert, Button, DataTable, FilterBar, FilterField, StatePanel, StatusBadge } from '../ui/Primitives.jsx'

const PRICED_CODES = new Set(['2.1a','2.1b','2.1c','2.1d','3.1b','3.2a','3.2b','TEBANG_20_40_CM','TEBANG_40_60_CM'])

function formatRp(v){ if(v==null||v==='') return 'Belum diatur'; const n=Number(v); if(Number.isNaN(n)) return 'Belum diatur'; return `Rp ${n.toLocaleString('id-ID')}` }

export default function MasterHargaSatuan({ contractId, up3Id, up3Name, canManage }) {
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0,10).slice(0,7)+'-01')
  const [prices, setPrices] = useState([])
  const [drafts, setDrafts] = useState({})
  const [pointMap, setPointMap] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const load = async () => {
    if(!contractId||!up3Id) return
    setLoading(true); setError('')
    try{
      const [rows, versionId] = await Promise.all([
        listVariableUnitPrices({ contractId, up3Id, asOf: effectiveFrom }),
        fetchActiveVersion({ contractId, up3Id, periodMonth: effectiveFrom.slice(0,7)+'-01' }).catch(()=>null)
      ])
      let pointToUuid = new Map()
      if(versionId){
        const inds = await fetchIndicators({ contractId, up3Id, versionId }).catch(()=>[])
        for(const r of inds) pointToUuid.set(r.point_code, r.id)
      }
      setPointMap(pointToUuid)
      setPrices(rows||[])
      const map={}
      for(const r of rows||[]){
        let legacy = variableCostIndicators.find(v=>v.id===r.indicator_id)?.id
        if(!legacy){
          for(const [point, uuid] of pointToUuid.entries()){
            if(uuid===r.indicator_id){ legacy = variableCostIndicators.find(v=>v.point===point)?.id; break }
          }
        }
        if(legacy) map[legacy]=String(r.unit_price)
        else map[r.indicator_id]=String(r.unit_price)
      }
      setDrafts(map)
    }catch(e){ setError(e.message||'Gagal memuat harga') }
    finally{ setLoading(false) }
  }
  useEffect(()=>{ load() },[contractId,up3Id,effectiveFrom])

  const handleSave = async () => {
    if(!canManage) return
    // Resolve point -> uuid for standard indicators
    let pointToUuid = new Map()
    try{
      const versionId = await fetchActiveVersion({ contractId, up3Id, periodMonth: effectiveFrom.slice(0,7)+'-01' })
      if(versionId){
        const inds = await fetchIndicators({ contractId, up3Id, versionId })
        for(const r of inds) pointToUuid.set(r.point_code, r.id)
      }
    }catch{}
    const values=[]
    for(const ind of variableCostIndicators){
      const isPriced = PRICED_CODES.has(ind.point) || PRICED_CODES.has(ind.code)
      if(!isPriced) continue
      const raw = drafts[ind.id]
      if(raw===''||raw==null) continue
      const n=Number(String(raw).replace(/\D/g,''))
      if(!Number.isFinite(n)||n<0){ setError(`Harga ${getShortLabel(ind)} tidak valid`); return }
      let indicatorId = ind.id
      if(ind.point && pointToUuid.has(ind.point)) indicatorId = pointToUuid.get(ind.point)
      // Tebang ids are already uuid
      values.push({ indicatorId, unitPrice: n })
    }
    if(!values.length){ setError('Isi minimal satu harga'); return }
    setSaving(true); setError(''); setMsg('')
    try{
      await setVariableUnitPrices({ contractId, up3Id, effectiveFrom, values })
      setMsg('Harga satuan tersimpan.')
      await load()
    }catch(e){ setError(e.message||'Gagal menyimpan') }finally{ setSaving(false) }
  }

  if(loading) return <StatePanel state="loading" title="Memuat Harga Satuan" />

  return (
    <section className="vc-subpage vc-unit-prices">
      <div className="vc-subpage-heading"><div><span className="vc-section-kicker">KONFIGURASI FINANSIAL</span><h3>Harga Satuan</h3><p>{up3Name ? `Pelayanan Teknik · ${up3Name}` : 'Pelayanan Teknik'} · Berlaku sama untuk seluruh ULP dalam UP3</p></div></div>
      <FilterBar className="vc-filter-bar" actions={<Button variant="secondary" onClick={load}>Muat</Button>}>
        <FilterField label="Berlaku per"><input className="input-field" type="date" value={effectiveFrom} onChange={e=>setEffectiveFrom(e.target.value)} /></FilterField>
      </FilterBar>
      {error && <Alert tone="danger">{error}</Alert>}
      {msg && <Alert tone="success">{msg}</Alert>}
      <DataTable className="vc-compact-table vc-price-table" sticky>
          <thead><tr><th>Kegiatan</th><th>Satuan</th><th>Harga Satuan</th></tr></thead>
          <tbody>
            {variableCostIndicators.map(ind=>{
              const isRowFix = ind.point==='3.1a'
              const isKonstruksi = ind.point==='3.1c'
              const isPriced = !isRowFix && !isKonstruksi
              let price = prices.find(p=>p.indicator_id===ind.id)?.unit_price
              if(price==null && ind.point){
                const uuid = pointMap.get(ind.point)
                if(uuid) price = prices.find(p=>p.indicator_id===uuid)?.unit_price
              }
              return (
                <tr key={ind.id}>
                  <td>{getShortLabel(ind)}</td>
                  <td>{ind.unit ?? '—'}</td>
                  <td className="ui-table-numeric">
                    {isRowFix ? <StatusBadge status="INACTIVE">Tidak Ditagihkan</StatusBadge> : isKonstruksi ? <StatusBadge status="ACTIVE" tone="info">Nominal Langsung</StatusBadge> : canManage ? (
                      <div className="vc-currency-field"><span>Rp</span><input className="input-number" value={drafts[ind.id]??''} placeholder={price!=null?String(price):'Belum diatur'} onChange={e=>setDrafts(s=>({...s,[ind.id]:e.target.value.replace(/\D/g,'')}))} /></div>
                    ) : (price!=null ? formatRp(price) : 'Belum diatur')}
                  </td>
                </tr>
              )
            })}
          </tbody>
      </DataTable>
      {canManage && <div className="vc-page-actions"><Button variant="primary" disabled={saving} onClick={handleSave}>{saving?'Menyimpan...':'Simpan Harga'}</Button></div>}
      <p className="vc-helper-text">Harga berlaku per UP3, sama untuk semua ULP. Perubahan harga membuat versi baru per tanggal berlaku, histori lama tetap tersimpan.</p>
    </section>
  )
}
