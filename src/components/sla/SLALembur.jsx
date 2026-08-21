import { useState } from 'react'
import {
  availableEmployeesForLembur,
  lemburTarifFor,
} from '../../data/lemburPelayananTeknik.js'

const formatRp = (value) =>
  Number(value ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })

export default function SLALembur({
  contractScope,
  role,
  up3Id,
  unitId,
  validUnitIds,
  records,
  employees,
  pensionPolicies,
  onCreate,
  onUpdate,
  onDelete,
}) {
  const [draft, setDraft] = useState({
    employeeId: '',
    date: '2026-06-15',
    hours: 2,
    keterangan: '',
  })
  const [editingId, setEditingId] = useState(null)
  const [message, setMessage] = useState(null)

  const isUlp = role === 'ulp'
  const scopeUnitId = isUlp ? unitId : null
  const employeeOptions = availableEmployeesForLembur(employees, {
    contractId: contractScope.contractId,
    up3Id,
    unitId: scopeUnitId,
    validUnitIds,
    date: draft.date,
    pensionPolicies,
  })
  const selectedEmployee = employeeOptions.find((entry) => entry.id === draft.employeeId) ?? null
  const tariff = selectedEmployee ? lemburTarifFor(selectedEmployee, draft.date) : 0

  const startEdit = (record) => {
    setEditingId(record.id)
    setDraft({
      employeeId: record.employeeId,
      date: record.date,
      hours: record.hours,
      keterangan: record.keterangan ?? '',
    })
    setMessage(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft({ employeeId: '', date: '2026-06-15', hours: 2, keterangan: '' })
    setMessage(null)
  }

  const handleSubmit = () => {
    const payload = {
      employeeId: draft.employeeId,
      date: draft.date,
      hours: Number(draft.hours) || 0,
      keterangan: draft.keterangan ?? '',
    }
    const result = editingId
      ? onUpdate(editingId, payload)
      : onCreate(payload)
    setMessage(result?.ok ? result.message ?? (editingId ? 'Lembur diperbarui.' : 'Lembur ditambahkan.') : result?.message ?? 'Gagal menyimpan.')
    if (result?.ok) {
      cancelEdit()
    }
  }

  const handleDelete = (record) => {
    if (!window.confirm(`Hapus lembur "${record.employeeName}" tanggal ${record.date}?`)) return
    const result = onDelete(record.id)
    setMessage(result?.ok ? result.message ?? 'Lembur dihapus.' : result?.message ?? 'Gagal menghapus.')
  }

  const sorted = [...records].sort((a, b) => String(b.date).localeCompare(String(a.date)))

  return (
    <section className="sla-module-panel">
      <div className="sla-export-bar">
        <span className="sla-export-scope">
          Lembur {'\u2014'} kontrak {contractScope.contractName}; pegawai
          divalidasi per scope UP3/unit dan status efektif pada tanggal lembur.
          Tarif dari riwayat tarif per pegawai.
        </span>
      </div>

      {!employeeOptions.length && !records.length ? (
        <div className="placeholder">
          <h2 className="placeholder-title">Tidak ada data lembur</h2>
          <p className="placeholder-text">
            Tidak ada pegawai aktif dalam scope ini. Pilih UP3/unit lain atau
            isi Master Pegawai terlebih dahulu.
          </p>
        </div>
      ) : (
        <>
          <div className="sla-export-bar">
            <label className="sla-context-field">
              <span className="sla-context-label">Pegawai</span>
              <select
                className="sla-context-select"
                value={draft.employeeId}
                onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })}
              >
                <option value="">Pilih pegawai aktif</option>
                {employeeOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} ({entry.unitId})
                  </option>
                ))}
              </select>
            </label>
            <label className="sla-context-field">
              <span className="sla-context-label">Tanggal</span>
              <input
                type="date"
                className="sla-context-select"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
              />
            </label>
            <label className="sla-context-field">
              <span className="sla-context-label">Jam</span>
              <input
                type="number"
                min="0.5"
                step="0.5"
                className="sla-context-select"
                value={draft.hours}
                onChange={(event) => setDraft({ ...draft, hours: event.target.value })}
              />
            </label>
            <label className="sla-context-field">
              <span className="sla-context-label">Keterangan</span>
              <input
                className="sla-context-select"
                value={draft.keterangan}
                onChange={(event) => setDraft({ ...draft, keterangan: event.target.value })}
              />
            </label>
            <span className="sla-export-scope">
              Tarif: Rp {formatRp(tariff)}/jam {'\u2014'} total Rp{' '}
              {formatRp(tariff * (Number(draft.hours) || 0))}
            </span>
          </div>
          <div className="sla-export-bar">
            <button
              type="button"
              className="sla-btn sla-btn-primary"
              disabled={!draft.employeeId || !draft.date || !(Number(draft.hours) > 0)}
              onClick={handleSubmit}
            >
              {editingId ? 'Simpan Perubahan' : 'Tambah Lembur'}
            </button>
            {editingId && (
              <button type="button" className="sla-btn" onClick={cancelEdit}>
                Batal
              </button>
            )}
            {message && <span className="sla-export-scope">{message}</span>}
          </div>

          <table className="sla-table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Pegawai</th>
                <th>Unit</th>
                <th>Jam</th>
                <th>Tarif/Jam</th>
                <th>Total</th>
                <th>Keterangan</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((record) => (
                <tr key={record.id}>
                  <td>{record.date}</td>
                  <td>
                    {editingId === record.id ? (
                      <select
                        className="sla-context-select"
                        value={draft.employeeId}
                        onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })}
                      >
                        {employeeOptions.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      record.employeeName
                    )}
                  </td>
                  <td>{record.unitId}</td>
                  <td>{editingId === record.id ? (
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      className="sla-input sla-input-text"
                      value={draft.hours}
                      onChange={(event) => setDraft({ ...draft, hours: event.target.value })}
                    />
                  ) : record.hours}</td>
                  <td>Rp {formatRp(record.rate)}</td>
                  <td>Rp {formatRp(record.total)}</td>
                  <td>
                    {editingId === record.id ? (
                      <input
                        className="sla-input sla-input-text"
                        value={draft.keterangan}
                        onChange={(event) => setDraft({ ...draft, keterangan: event.target.value })}
                      />
                    ) : (
                      record.keterangan ?? '\u2013'
                    )}
                  </td>
                  <td>
                    {editingId === record.id ? (
                      <>
                        <button type="button" className="sla-btn" onClick={handleSubmit}>
                          Simpan
                        </button>
                        <button type="button" className="sla-btn" onClick={cancelEdit}>
                          Batal
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="sla-btn" onClick={() => startEdit(record)}>
                          Edit
                        </button>
                        <button type="button" className="sla-btn" onClick={() => handleDelete(record)}>
                          Hapus
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}