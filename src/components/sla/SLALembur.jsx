import { useState } from 'react'
import {
  availableEmployeesForLembur,
  lemburTarifFor,
} from '../../data/lemburPelayananTeknik.js'

const formatRp = (value) =>
  Number(value ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })

export default function SLALembur({
  contractScope,
  up3Id,
  unitId,
  periodMonth,
  records,
  employees,
  pensionPolicies,
  loading,
  loadError,
  onRetry,
  onCreate,
  onUpdate,
  onDelete,
}) {
  const [draft, setDraft] = useState({
    employeeId: '',
    date: periodMonth ?? '',
    hours: 2,
    keterangan: '',
  })
  const [editingId, setEditingId] = useState(null)
  const [message, setMessage] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const employeeOptions = availableEmployeesForLembur(employees, {
    contractId: contractScope.contractId,
    up3Id,
    unitId,
    date: draft.date,
    pensionPolicies,
  })
  const editingRecord = records.find((record) => record.id === editingId) ?? null
  const selectedEmployee = employeeOptions.find((entry) => entry.id === draft.employeeId) ?? null
  const keepsExistingSnapshot = editingRecord &&
    editingRecord.employeeId === draft.employeeId &&
    editingRecord.date === draft.date
  const tariff = keepsExistingSnapshot
    ? editingRecord.rate
    : selectedEmployee
      ? lemburTarifFor(selectedEmployee, draft.date)
      : 0

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
    setDraft({ employeeId: '', date: periodMonth ?? '', hours: 2, keterangan: '' })
    setMessage(null)
  }

  const handleSubmit = async () => {
    if (!tariff) {
      setMessage('Tarif lembur efektif tidak tersedia pada tanggal yang dipilih.')
      return
    }
    const payload = {
      employeeId: draft.employeeId,
      date: draft.date,
      hours: Number(draft.hours) || 0,
      keterangan: draft.keterangan ?? '',
    }
    setSubmitting(true)
    try {
      const result = editingId
        ? await onUpdate(editingId, payload)
        : await onCreate(payload)
      setMessage(result?.ok ? result.message ?? (editingId ? 'Lembur diperbarui.' : 'Lembur ditambahkan.') : result?.message ?? 'Gagal menyimpan.')
      if (result?.ok) {
        setEditingId(null)
        setDraft({ employeeId: '', date: periodMonth ?? '', hours: 2, keterangan: '' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (record) => {
    if (!window.confirm(`Hapus lembur "${record.employeeName}" tanggal ${record.date}?`)) return
    setSubmitting(true)
    try {
      const result = await onDelete(record)
      setMessage(result?.ok ? result.message ?? 'Lembur dihapus.' : result?.message ?? 'Gagal menghapus.')
    } finally {
      setSubmitting(false)
    }
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

      {loadError ? (
        <div className="placeholder">
          <h2 className="placeholder-title">Data lembur gagal dimuat</h2>
          <p className="placeholder-text">{loadError}</p>
          <button type="button" className="sla-btn" onClick={onRetry}>
            Coba Lagi
          </button>
        </div>
      ) : loading ? (
        <div className="placeholder">
          <h2 className="placeholder-title">Memuat data lembur...</h2>
        </div>
      ) : !employeeOptions.length && !records.length ? (
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
                {editingRecord && !selectedEmployee && (
                  <option value={editingRecord.employeeId}>{editingRecord.employeeName}</option>
                )}
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
              {selectedEmployee && !tariff
                ? 'Tarif lembur efektif tidak tersedia pada tanggal ini.'
                : `Tarif: Rp ${formatRp(tariff)}/jam \u2014 total Rp ${formatRp(tariff * (Number(draft.hours) || 0))}`}
            </span>
          </div>
          <div className="sla-export-bar">
            <button
              type="button"
              className="sla-btn sla-btn-primary"
              disabled={submitting || !draft.employeeId || !draft.date || !(Number(draft.hours) > 0) || !tariff}
              onClick={handleSubmit}
            >
              {submitting ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Tambah Lembur'}
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
                        {editingRecord && !selectedEmployee && (
                          <option value={editingRecord.employeeId}>{editingRecord.employeeName}</option>
                        )}
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
                        <button type="button" className="sla-btn" disabled={submitting || !tariff} onClick={handleSubmit}>
                          Simpan
                        </button>
                        <button type="button" className="sla-btn" onClick={cancelEdit}>
                          Batal
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="sla-btn" disabled={submitting} onClick={() => startEdit(record)}>
                          Edit
                        </button>
                        <button type="button" className="sla-btn" disabled={submitting} onClick={() => handleDelete(record)}>
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
