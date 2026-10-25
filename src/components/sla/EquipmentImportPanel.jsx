import { useEffect, useMemo, useRef, useState } from 'react'
import {
  autoCategoryMapping, buildEquipmentPreview, collectEquipmentCategories,
  openEquipmentFile, resolveCategory, toEquipmentImportPayload,
} from '../../data/equipmentImport.js'
import { formatRupiah } from '../../data/equipmentPricing.js'

const STATUS_LABEL = { new: 'Baru', update: 'Perbarui', skip: 'Dilewati', invalid: 'Periksa' }

export default function EquipmentImportPanel({ categories, equipment, busy, onImport, onClose }) {
  const [sheetNames, setSheetNames] = useState([])
  const [sheetName, setSheetName] = useState('')
  const [rawRows, setRawRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [updateExisting, setUpdateExisting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const fileApi = useRef(null)
  const fileInput = useRef(null)
  const activeCategories = useMemo(() => categories.filter((category) => category.isActive), [categories])
  const labels = useMemo(() => collectEquipmentCategories(rawRows), [rawRows])
  const preview = useMemo(() => buildEquipmentPreview({
    rows: rawRows, categories: activeCategories, mapping, existingRows: equipment, updateExisting,
  }), [rawRows, activeCategories, mapping, equipment, updateExisting])
  const locked = busy || reading || processing

  useEffect(() => {
    if (!labels.length) return
    setMapping((prev) => ({ ...autoCategoryMapping(labels, activeCategories), ...prev }))
  }, [labels, activeCategories])

  const loadSheet = (api, name) => {
    const rows = api.readRows(name)
    setRawRows(rows)
    setMapping(autoCategoryMapping(collectEquipmentCategories(rows), activeCategories))
    setResult(null)
    setError('')
  }
  const chooseFile = async (file) => {
    if (!file || locked) return
    setReading(true)
    setError('')
    setResult(null)
    setRawRows([])
    setSheetNames([])
    setSheetName('')
    setFileName('')
    fileApi.current = null
    try {
      const api = await openEquipmentFile(file)
      fileApi.current = api
      setFileName(file.name)
      setSheetNames(api.sheetNames)
      setSheetName(api.sheetNames[0])
      loadSheet(api, api.sheetNames[0])
    } catch (readError) {
      setError(readError.message || 'File gagal dibaca.')
    } finally {
      setReading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }
  const changeSheet = (name) => {
    if (!fileApi.current || locked) return
    setSheetName(name)
    try {
      loadSheet(fileApi.current, name)
    } catch (readError) {
      setError(readError.message || 'Lembar data gagal dibaca.')
      setRawRows([])
    }
  }
  const resetFile = () => {
    if (locked) return
    fileApi.current = null
    setSheetNames([])
    setSheetName('')
    setRawRows([])
    setMapping({})
    setFileName('')
    setError('')
    setResult(null)
  }
  const submit = async () => {
    if (locked || !preview.importable.length) return
    setProcessing(true)
    setError('')
    try {
      const imported = await onImport(toEquipmentImportPayload(preview.importable))
      setResult(imported)
      setRawRows([])
      setSheetNames([])
      setSheetName('')
      setFileName('')
      setMapping({})
      fileApi.current = null
    } catch (importError) {
      setError(importError.message || 'Impor peralatan gagal.')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <section className="alkes-import" aria-busy={locked}>
      <div className="alkes-import-head">
        <div>
          <strong>Impor CSV / Excel</strong>
          <p>Kolom wajib: Nama Alat, Masa Manfaat (bulan), Satuan, Kategori. Opsional: BPP dan Cost/Bulan. Kode alat baru dibuat otomatis.</p>
        </div>
        <button type="button" className="sla-btn" disabled={locked} onClick={onClose}>Tutup</button>
      </div>
      {result ? (
        <div className="alkes-import-result" role="status">
          <strong>Impor selesai</strong>
          <span>{result.inserted ?? 0} alat baru, {result.updated ?? 0} alat diperbarui, {result.skipped ?? 0} dilewati server.</span>
          <button type="button" className="sla-btn sla-btn-primary" onClick={resetFile}>Impor File Lain</button>
        </div>
      ) : (
        <>
          <div className="alkes-import-tools">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,.xls"
              hidden
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            <button type="button" className="sla-btn sla-btn-primary" disabled={locked || !activeCategories.length} onClick={() => fileInput.current?.click()}>
              {reading ? 'Membaca file...' : 'Pilih File'}
            </button>
            {fileName && <span className="alkes-import-file">{fileName}</span>}
            {sheetNames.length > 1 && (
              <label className="alkes-import-sheet">Lembar
                <select value={sheetName} disabled={locked} onChange={(event) => changeSheet(event.target.value)}>
                  {sheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            )}
            {fileName && <button type="button" className="sla-btn" disabled={locked} onClick={resetFile}>Ganti File</button>}
          </div>
          {!activeCategories.length && <p className="sla-blocked-note">Belum ada kategori aktif. Buat kategori terlebih dahulu sebelum mengimpor.</p>}
          {error && <p className="sla-blocked-note" role="alert">{error}</p>}
          {labels.length > 0 && (
            <div className="alkes-import-mapping">
              <div className="alkes-import-section-head">
                <strong>Pemetaan Kategori</strong>
                <span>Kategori dari file harus diarahkan ke kategori aktif yang sudah ada. Jika belum tersedia, tutup impor lalu tambahkan melalui Katalog & Data Pendukung.</span>
              </div>
              <div className="alkes-import-categories">
                {labels.map(({ key, label }) => {
                  const matches = resolveCategory(label, activeCategories)
                  const ambiguous = matches.length > 1 && !mapping[key]
                  return (
                    <label key={key} className={ambiguous ? 'is-ambiguous' : ''}>
                      <span>{label}</span>
                      <select value={mapping[key] || ''} disabled={locked} onChange={(event) => setMapping((prev) => ({ ...prev, [key]: event.target.value }))}>
                        <option value="">Pilih kategori</option>
                        {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                      </select>
                      {ambiguous && <small>Nama file cocok dengan lebih dari satu kategori. Pilih salah satu.</small>}
                    </label>
                  )
                })}
              </div>
            </div>
          )}
          {rawRows.length > 0 && (
            <label className="alkes-import-update">
              <input type="checkbox" checked={updateExisting} disabled={locked} onChange={(event) => setUpdateExisting(event.target.checked)} />
              Perbarui masa manfaat, BPP, dan Cost/Bulan alat yang sudah cocok. Nilai kosong tidak menghapus data lama.
            </label>
          )}
          {rawRows.length > 0 && (
            <>
              <div className="alkes-import-summary" aria-live="polite">
                <span>{preview.counts.new} baru</span>
                <span>{preview.counts.update} diperbarui</span>
                <span>{preview.counts.skip} dilewati</span>
                <span className={preview.counts.invalid ? 'is-error' : ''}>{preview.counts.invalid} perlu diperiksa</span>
              </div>
              <div className="sla-preview-scroll alkes-import-preview">
                <table className="sla-preview-table alkes-table alkes-table--wide">
                  <thead><tr><th>Baris</th><th>Nama Alat</th><th>Masa Manfaat</th><th>Satuan</th><th>Kategori</th><th>BPP</th><th>Cost/Bulan</th><th>Status</th></tr></thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={`${row.__row}-${row.name}`} className={row.status === 'invalid' ? 'alkes-import-row-invalid' : ''}>
                        <td>{row.__row}</td>
                        <td>{row.name || '—'}</td>
                        <td>{row.age ? `${row.age} bln` : 'Kosong'}</td>
                        <td>{row.unit || '—'}</td>
                        <td>{row.categoryName || row.category || '—'}</td>
                        <td>{formatRupiah(row.bppAmount)}</td>
                        <td>{formatRupiah(row.monthlyCost)}</td>
                        <td>
                          <span className={`alkes-import-status is-${row.status}`}>{STATUS_LABEL[row.status]}</span>
                          {(row.errors.length > 0 || row.note) && (
                            <div className={row.priceWarning && !row.errors.length ? 'sla-table-sub alkes-import-price-warning' : 'sla-table-sub'}>
                              {row.errors.length ? row.errors.join(' ') : row.note}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="alkes-import-actions">
                <span>{preview.importable.length} baris siap diimpor{preview.counts.invalid ? `, ${preview.counts.invalid} baris bermasalah tidak disertakan` : ''}. Data belum disimpan.</span>
                <button type="button" className="sla-btn sla-btn-primary" disabled={locked || !preview.importable.length} onClick={submit}>
                  {processing ? 'Mengimpor...' : `Impor ${preview.importable.length} Data`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
