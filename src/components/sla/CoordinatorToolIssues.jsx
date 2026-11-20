import { useEffect, useRef, useState } from 'react'
import { listOpenToolIssues, verifyToolIssueHandover } from '../../data/toolInspectionRepository.js'
import { Modal, Button, FormField, Input, Alert } from '../ui/Primitives.jsx'
import { formatDateTime, pontianakInputValue, inputValueToIso } from './ToolEvidence.jsx'

export default function CoordinatorToolIssues({ contractId, up3Id, ulpId, units, reloadToken, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [target, setTarget] = useState(null)
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const lock = useRef(false)
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setRows([])
    const timeout = setTimeout(() => { if (active) { active = false; setLoading(false); setError('Pemeriksaan issue melebihi batas waktu. Muat ulang.') } }, 15000)
    listOpenToolIssues({ contractId, up3Id }).then((data) => { if (active) setRows(data) })
      .catch((e) => { if (active) setError(e.message) })
      .finally(() => { clearTimeout(timeout); if (active) setLoading(false) })
    return () => { active = false; clearTimeout(timeout) }
  }, [contractId, up3Id, reload, reloadToken])
  const visible = rows.filter((row) => !ulpId || row.ulp_id === ulpId)
  const save = async () => {
    if (!target || lock.current) return
    if (!time) { setFormError('Waktu verifikasi wajib diisi.'); return }
    lock.current = true; setBusy(true); setFormError('')
    try {
      await verifyToolIssueHandover({ issueId: target.id, verifiedAt: inputValueToIso(time), expectedRevision: target.revision })
      setTarget(null); setReload((n) => n + 1); onChanged?.()
    } catch (e) { setFormError(e.message) }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className="tool-issues">
    <div className="tool-section-heading"><h3>Verifikasi penyerahan alat rusak ke K3</h3>
      <Button variant="secondary" size="small" disabled={loading || busy} onClick={() => setReload((n) => n + 1)}>Muat ulang</Button></div>
    <p className="tool-muted">Issue terbuka saat ini, termasuk periode sebelumnya. Verifikasi tidak menutup issue; K3 menyelesaikan setelah serah terima alat pengganti.</p>
    {loading ? <p role="status">Memuat issue...</p> : error ? <Alert tone="danger">{error}</Alert> : <>
      <p>{visible.length} issue terbuka · {visible.filter((r) => !r.handover_verified_at).length} menunggu verifikasi</p>
      <div className="tool-table-wrap"><table className="tool-table"><thead><tr><th>ULP</th><th>Terbuka</th><th>Belum diverifikasi</th></tr></thead><tbody>
        {units.filter((u) => u.type === 'ULP' && (!ulpId || u.uuid === ulpId)).map((u) => <tr key={u.uuid}><td>{u.displayName || u.legacyKey}</td><td>{rows.filter((r) => r.ulp_id === u.uuid).length}</td><td>{rows.filter((r) => r.ulp_id === u.uuid && !r.handover_verified_at).length}</td></tr>)}
      </tbody></table></div>
      <div className="tool-issue-grid">{visible.map((row) => <article className="tool-issue-card" key={row.id}>
        <strong>{row.equipment_name}</strong><span>{units.find((u) => u.uuid === row.ulp_id)?.displayName || row.ulp_id?.slice(0, 8)} · {row.vehicle_label} · {row.plate_display || 'Nopol belum diisi'}</span>
        <p>{row.note}</p><span>Ditemukan {formatDateTime(row.opened_at)}</span>
        {row.handover_verified_at ? <p className="tool-note">Diverifikasi {formatDateTime(row.handover_verified_at)} · {row.handover_verified_by_name || 'Koordinator Area'} · menunggu penggantian</p>
          : <Button variant="primary" size="small" onClick={() => { setTarget(row); setTime(pontianakInputValue()); setFormError('') }}>Verifikasi Penyerahan ke K3</Button>}
      </article>)}</div>
      {!visible.length && <p>Tidak ada issue terbuka.</p>}
    </>}
    <Modal open={Boolean(target)} onClose={() => { if (!busy) setTarget(null) }} title="Verifikasi Penyerahan ke K3" dismissDisabled={busy} footer={<>
      <Button variant="ghost" disabled={busy} onClick={() => setTarget(null)}>Batal</Button>
      <Button variant="primary" disabled={busy || !time} onClick={save}>{busy ? 'Menyimpan...' : 'Simpan Verifikasi'}</Button>
    </>}>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <p>{target?.equipment_name} · {target?.vehicle_label}</p>
      <p>Dengan menyimpan, Anda memverifikasi bahwa alat rusak telah diserahkan ke K3. Verifikasi tersimpan satu kali bersama identitas Anda.</p>
      <FormField label="Waktu verifikasi" required><Input type="datetime-local" value={time} min={target ? pontianakInputValue(new Date(target.opened_at)) : undefined} max={pontianakInputValue()} onChange={(e) => setTime(e.target.value)} /></FormField>
    </Modal>
  </section>
}
