import { Fragment, useState, useEffect } from 'react'
import { currentNameOf } from '../../data/organisasiPelayananTeknik.js'
import {
  formatDateKey,
  versionMetadataValid,
  versionReferences,
} from '../../data/versiSlaPelayananTeknik.js'
import { variableCostPoints, slaPeriods } from '../../data/slaPelayananTeknik.js'
import {
  fetchIndicators,
  fetchMonthlyTargets,
  fetchTargetVersions,
  periodLabelToMonth,
  setManualSlaTarget,
  setVariableTarget,
} from '../../data/variableCostRepository.js'

function parseNumber(raw) {
  if (raw === '') return null
  const value = Number(raw)
  return Number.isNaN(value) ? null : value
}

const sourceLabel = (source) =>
  source === 'copy-active'
    ? 'Salin dari SLA Aktif'
    : source === 'upload'
      ? 'Upload CSV/Excel (simulasi)'
      : 'CSV'

const WEIGHT_TYPES = ['Prioritas 1', 'Prioritas 2']
const INPUT_MODES = [
  { value: 'manual', label: 'Manual' },
  { value: 'variable-cost', label: 'Variable Cost' },
]

const countIndicators = (version) =>
  version.sections
    ? version.sections.reduce((sum, section) => sum + section.indicators.length, 0)
    : '\u2013'

const targetCellKey = (indicatorId, unitId) => `${indicatorId}:${unitId}`

function TargetUlpView({ orgMap, versions }) {
  const [period, setPeriod] = useState('Agustus 2026')
  const [targetVersions, setTargetVersions] = useState([])
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [indicators, setIndicators] = useState([])
  const [values, setValues] = useState({})
  const [savedValues, setSavedValues] = useState({})
  const [loadStatus, setLoadStatus] = useState('loading')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const contractId = orgMap?.contractUuid
  const up3Id = orgMap?.up3Uuid
  const ulpUnits = (orgMap?.units ?? []).filter((unit) => unit.type === 'ULP')
  const unitIds = ulpUnits.map((unit) => unit.uuid)
  const periodMonth = periodLabelToMonth(period)

  useEffect(() => {
    if (!contractId || !up3Id) return
    let cancelled = false
    setLoadStatus('loading')
    setFeedback(null)
    fetchTargetVersions({ contractId, up3Id })
      .then((rows) => {
        if (cancelled) return
        setTargetVersions(rows)
        setSelectedVersionId((current) =>
          rows.some((row) => row.id === current)
            ? current
            : (rows.find((row) => row.status === 'ACTIVE')?.id ?? rows[0]?.id ?? ''),
        )
        if (!rows.length) setLoadStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setLoadStatus('error')
        setFeedback({ type: 'error', text: error.message || 'Gagal memuat versi SLA.' })
      })
    return () => { cancelled = true }
  }, [contractId, up3Id])

  useEffect(() => {
    if (!contractId || !up3Id || !selectedVersionId || !periodMonth || !unitIds.length) return
    let cancelled = false
    setLoadStatus('loading')
    setFeedback(null)
    Promise.all([
      fetchIndicators({ contractId, up3Id, versionId: selectedVersionId }),
      fetchMonthlyTargets({
        contractId,
        up3Id,
        unitIds,
        periodMonth,
        versionId: selectedVersionId,
      }),
    ])
      .then(([indicatorRows, targetRows]) => {
        if (cancelled) return
        const editableIndicators = indicatorRows.filter((indicator) =>
          indicator.point_code !== '3.1c' &&
          (indicator.input_mode === 'MANUAL' ||
            (indicator.input_mode === 'VARIABLE_COST' &&
              indicator.variable_cost_profile === 'STANDARD' &&
              variableCostPoints.has(indicator.point_code))),
        )
        const databaseVersion = targetVersions.find((version) => version.id === selectedVersionId)
        const canonicalVersion = versions.find((version) =>
          version.id === databaseVersion?.legacy_key || version.name === databaseVersion?.name,
        )
        if (!canonicalVersion?.sections) {
          throw new Error('Struktur canonical versi SLA tidak tersedia pada halaman SLA utama.')
        }
        const databaseByLegacyKey = new Map(
          editableIndicators.map((indicator) => [indicator.legacy_key, indicator]),
        )
        const orderedIndicators = canonicalVersion.sections.flatMap((section) =>
          section.indicators
            .filter((indicator) => indicator.point !== '3.1c')
            .map((indicator) => {
              const databaseIndicator = databaseByLegacyKey.get(indicator.id)
              return databaseIndicator
                ? {
                    ...databaseIndicator,
                    sectionCode: section.code,
                    sectionName: section.name,
                    displayPoint: indicator.point,
                    displayCriteria: indicator.criteria,
                    displayUnit: indicator.unit || databaseIndicator.measurement_unit || '\u2013',
                  }
                : null
            })
            .filter(Boolean),
        )
        if (orderedIndicators.length !== editableIndicators.length) {
          throw new Error('Keanggotaan indikator versi SLA tidak cocok dengan struktur halaman SLA utama.')
        }
        const nextValues = {}
        targetRows.forEach((row) => {
          nextValues[targetCellKey(row.indicator_id, row.unit_id)] = String(row.target_value)
        })
        setIndicators(orderedIndicators)
        setValues(nextValues)
        setSavedValues(nextValues)
        setLoadStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setIndicators([])
        setValues({})
        setSavedValues({})
        setLoadStatus('error')
        setFeedback({ type: 'error', text: error.message || 'Gagal memuat target ULP.' })
      })
    return () => { cancelled = true }
  }, [contractId, up3Id, selectedVersionId, periodMonth, unitIds.join(','), targetVersions, versions])

  const handleSave = async () => {
    const changes = []
    indicators.forEach((indicator) => {
      ulpUnits.forEach((unit) => {
        const key = targetCellKey(indicator.id, unit.uuid)
        const value = values[key] ?? ''
        if (value !== (savedValues[key] ?? '')) changes.push({ indicator, unit, value })
      })
    })
    if (!changes.length) {
      setFeedback({ type: 'success', text: 'Tidak ada perubahan target.' })
      return
    }
    if (changes.some((change) => change.value === '' || !Number.isFinite(Number(change.value)))) {
      setFeedback({ type: 'error', text: 'Target yang diubah wajib berupa angka.' })
      return
    }
    setSaving(true)
    setFeedback(null)
    try {
      await Promise.all(changes.map(({ indicator, unit, value }) => {
        const save = indicator.input_mode === 'VARIABLE_COST'
          ? setVariableTarget
          : setManualSlaTarget
        return save({
          contractId,
          up3Id,
          unitId: unit.uuid,
          versionId: selectedVersionId,
          indicatorId: indicator.id,
          periodMonth,
          targetValue: Number(value),
        })
      }))
      const rows = await fetchMonthlyTargets({
        contractId,
        up3Id,
        unitIds,
        periodMonth,
        versionId: selectedVersionId,
      })
      const persisted = {}
      rows.forEach((row) => {
        persisted[targetCellKey(row.indicator_id, row.unit_id)] = String(row.target_value)
      })
      setValues(persisted)
      setSavedValues(persisted)
      setFeedback({ type: 'success', text: `${changes.length} target ULP berhasil disimpan.` })
    } catch (error) {
      setFeedback({ type: 'error', text: error.message || 'Gagal menyimpan target ULP.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sla-target-settings">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">PENGATURAN TARGET ULP</h2>
      </div>
      <div className="sla-target-selectors">
        <label className="sla-context-field">
          <span className="sla-context-label">Periode</span>
          <select className="sla-select" value={period} onChange={(event) => setPeriod(event.target.value)}>
            {slaPeriods.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="sla-context-field">
          <span className="sla-context-label">SLA Version</span>
          <select className="sla-select" value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)}>
            {targetVersions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name} ({version.status})
              </option>
            ))}
          </select>
        </label>
      </div>
      {feedback && (
        <div className={`sla-message ${feedback.type === 'error' ? 'sla-message-error' : ''}`} role="status">
          {feedback.text}
        </div>
      )}
      {loadStatus === 'loading' ? (
        <p className="sla-flat-note">Memuat target ULP...</p>
      ) : loadStatus === 'error' ? null : (
        <div className="sla-preview-scroll sla-target-matrix-scroll">
          <table className="sla-preview-table sla-target-matrix">
            <thead>
              <tr>
                <th>Poin</th>
                <th>Kegiatan</th>
                <th>Satuan</th>
                {ulpUnits.map((unit) => <th key={unit.uuid}>{unit.displayName}</th>)}
              </tr>
            </thead>
            <tbody>
              {indicators.map((indicator, index) => (
                <Fragment key={indicator.id}>
                  {(index === 0 || indicators[index - 1].sectionCode !== indicator.sectionCode) && (
                    <tr className="sla-preview-cat">
                      <td colSpan={3 + ulpUnits.length}>{indicator.sectionName}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="sla-target-point">{indicator.displayPoint}</td>
                    <td className="sla-target-activity">{indicator.displayCriteria}</td>
                    <td>{indicator.displayUnit}</td>
                    {ulpUnits.map((unit) => {
                      const key = targetCellKey(indicator.id, unit.uuid)
                      return (
                        <td key={unit.uuid}>
                          <input
                            type="number"
                            step="any"
                            className="sla-input sla-target-input"
                            value={values[key] ?? ''}
                            aria-label={`${indicator.displayPoint} ${unit.displayName}`}
                            onChange={(event) => setValues((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))}
                          />
                        </td>
                      )
                    })}
                  </tr>
                </Fragment>
              ))}
              {!indicators.length && (
                <tr><td colSpan={3 + ulpUnits.length}>Tidak ada indikator target untuk versi ini.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="sla-target-actions">
        <button
          type="button"
          className="sla-btn sla-btn-primary"
          disabled={saving || loadStatus !== 'ready' || !selectedVersionId}
          onClick={handleSave}
        >
          {saving ? 'Menyimpan...' : 'Simpan Target'}
        </button>
      </div>
    </div>
  )
}

function MetadataForm({ version, onSave }) {
  const [name, setName] = useState(version.name ?? '')
  const [agreementName, setAgreementName] = useState(version.agreementName ?? '')
  const [effectiveDate, setEffectiveDate] = useState(version.effectiveDate ?? '')
  const [periodStart, setPeriodStart] = useState(version.periodStart ?? '')
  const [periodEnd, setPeriodEnd] = useState(version.periodEnd ?? '')
  const [metadataNote, setMetadataNote] = useState(version.metadataNote ?? '')

  const handleSave = () =>
    onSave({
      name: name.trim() || version.name,
      agreementName,
      effectiveDate,
      periodStart,
      periodEnd,
      metadataNote,
    })

  return (
    <div className="sla-metadata-form">
      <div className="sla-draft-form-fields">
        <label className="sla-context-field">
          <span className="sla-context-label">Nama SLA/Addendum</span>
          <input
            className="sla-input sla-input-text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="sla-context-field">
          <span className="sla-context-label">Nomor Surat Perjanjian/Addendum</span>
          <input
            className="sla-input sla-input-text"
            value={agreementName}
            onChange={(event) => setAgreementName(event.target.value)}
          />
        </label>
        <label className="sla-context-field">
          <span className="sla-context-label">Tanggal Berlaku SLA (DD-MM-YYYY)</span>
          <input
            className="sla-input sla-input-text"
            value={effectiveDate}
            placeholder="01-01-2026"
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
        </label>
        <label className="sla-context-field">
          <span className="sla-context-label">Periode Berlaku Mulai (DD-MM-YYYY)</span>
          <input
            className="sla-input sla-input-text"
            value={periodStart}
            placeholder="01-01-2027"
            onChange={(event) => setPeriodStart(event.target.value)}
          />
        </label>
        <label className="sla-context-field">
          <span className="sla-context-label">Periode Berlaku Selesai (DD-MM-YYYY)</span>
          <input
            className="sla-input sla-input-text"
            value={periodEnd}
            placeholder="31-12-2027"
            onChange={(event) => setPeriodEnd(event.target.value)}
          />
        </label>
      </div>
      <label className="sla-context-field">
        <span className="sla-context-label">Keterangan</span>
        <textarea
          className="sla-input sla-input-textarea"
          rows="3"
          value={metadataNote}
          onChange={(event) => setMetadataNote(event.target.value)}
        />
      </label>
      <div className="sla-metadata-actions">
        <button type="button" className="sla-btn sla-btn-primary" onClick={handleSave}>
          Simpan Metadata
        </button>
      </div>
      <p className="sla-flat-note">
        Metadata tersedia sejak Draft dan wajib lengkap sebelum aktivasi: nama SLA/Addendum,
        nomor surat perjanjian/addendum, tanggal berlaku, dan periode berlaku. Struktur
        indikator, bobot, target historis, dan data laporan tidak dapat diubah pada versi{' '}
        {version.status}.
      </p>
    </div>
  )
}

export default function SLAPengaturanSLA({
  versions,
  units,
  contractScope,
  onCreateDraft,
  onUpdateVersion,
  onActivate,
  onRollback,
  onDeleteVersion,
  orgMap,
}) {
  const ulpUnits = units.filter((unit) => unit.type === 'ULP')
  const up3Unit = units.find((unit) => unit.type === 'UP3')
  const up3Name = up3Unit ? currentNameOf(up3Unit) : contractScope.up3.name
  const [showCreate, setShowCreate] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftPeriod, setDraftPeriod] = useState('Januari 2027 \u2013 Desember 2027')
  const [draftPeriodStart, setDraftPeriodStart] = useState('2027-01-01')
  const [draftPeriodEnd, setDraftPeriodEnd] = useState('2027-12-31')
  const [draftSource, setDraftSource] = useState('upload')
  const [editingId, setEditingId] = useState(null)
  const [viewingId, setViewingId] = useState(null)
  const [metadataId, setMetadataId] = useState(null)
  const [message, setMessage] = useState(null)
  const [settingsView, setSettingsView] = useState('structure')

  const editingVersion = versions.find((version) => version.id === editingId)
  const viewingVersion = versions.find((version) => version.id === viewingId)
  const metadataVersion = versions.find((version) => version.id === metadataId)
  const shownVersion = editingVersion ?? viewingVersion ?? metadataVersion
  const totalIndicators = shownVersion ? countIndicators(shownVersion) : '\u2013'

  const handleSubmitDraft = () => {
    const name = draftName.trim() || `Addendum ${versions.length}`
    const id = onCreateDraft({
      name,
      period: draftPeriod,
      source: draftSource,
      periodStart: draftPeriodStart,
      periodEnd: draftPeriodEnd,
    })
    setShowCreate(false)
    setDraftName('')
    setEditingId(id)
    setViewingId(null)
    setMessage(
      `Draft "${name}" dibuat dari ${sourceLabel(draftSource)}. Kelola section dan indikator, lalu Simpan Draft.`,
    )
  }

  const handleDuplicate = (version) => {
    const name = `${version.name} (Salinan)`
    const id = onCreateDraft({
      name,
      period: `${version.period ?? ''}`,
      source: 'copy-active',
      baseVersionId: version.id,
      periodStart: version.periodStart ?? '2027-01-01',
      periodEnd: version.periodEnd ?? '2027-12-31',
    })
    setShowCreate(false)
    setEditingId(id)
    setViewingId(null)
    setMetadataId(null)
    setMessage(
      `Draft "${name}" dibuat sebagai salinan dari ${version.name}. Struktur, target, dan periode diwarisi dari versi sumber; status Draft.`,
    )
  }

  const handleRollback = (version) => {
    if (versionReferences(version).length) {
      setMessage(
        'SLA ini sudah digunakan pada data pelaporan dan tidak dapat dibatalkan atau dihapus. Buat Addendum baru untuk melakukan perubahan.',
      )
      return
    }
    if (
      !window.confirm(
        `Batalkan aktivasi "${version.name}"? SLA menjadi Draft kembali dan versi sebelumnya (yang diarsipkan oleh aktivasi ini) kembali Aktif. Metadata dan struktur kedua versi dipertahankan.`,
      )
    ) {
      return
    }
    const result = onRollback(version.id)
    if (!result?.ok) {
      setMessage(result?.message ?? 'Gagal membatalkan aktivasi.')
      return
    }
    setMessage(result.message)
    setEditingId(null)
    setViewingId(null)
    setMetadataId(null)
  }

  const handleDeleteDraft = (version) => {
    if (versionReferences(version).length) {
      setMessage(
        'SLA ini sudah digunakan pada data pelaporan dan tidak dapat dibatalkan atau dihapus. Buat Addendum baru untuk melakukan perubahan.',
      )
      return
    }
    if (
      !window.confirm(
        `Hapus Draft "${version.name}"? Draft yang belum digunakan dapat dihapus permanen.`,
      )
    ) {
      return
    }
    const result = onDeleteVersion(version.id)
    if (!result?.ok) {
      setMessage(result?.message ?? 'Gagal menghapus draft.')
      return
    }
    setMessage(result.message)
    if (editingId === version.id) setEditingId(null)
    if (viewingId === version.id) setViewingId(null)
    if (metadataId === version.id) setMetadataId(null)
  }

  const newRowId = () => `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const blankTarget = { up3: null, ulp: null, ulpTargets: {} }

  const createBlankIndicator = () => ({
    id: newRowId(),
    scope: '',
    point: '',
    criteria: '',
    performanceTarget: '',
    evidence: '',
    weightType: 'Prioritas 1',
    weight: null,
    unit: '',
    inputMode: 'manual',
  })

  const targetOf = (indicatorId) => shownVersion.targets[indicatorId] ?? { ...blankTarget }

  const commitSections = (nextSections, nextTargets) => {
    onUpdateVersion(editingId, {
      sections: nextSections,
      targets: nextTargets ?? shownVersion.targets,
    })
  }

  const updateDraftIndicator = (sectionId, indicatorId, patch) =>
    commitSections(
      shownVersion.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              indicators: section.indicators.map((indicator) =>
                indicator.id === indicatorId ? { ...indicator, ...patch } : indicator,
              ),
            }
          : section,
      ),
    )

  const updateDraftTarget = (indicatorId, field, value) =>
    onUpdateVersion(editingId, {
      targets: {
        ...shownVersion.targets,
        [indicatorId]: { ...targetOf(indicatorId), [field]: value },
      },
    })

  // ---------- Section operations ----------

  const nextSectionCode = () => {
    const used = new Set(shownVersion.sections.map((section) => section.code))
    for (let i = 0; i < 26; i += 1) {
      const code = String.fromCharCode(65 + i)
      if (!used.has(code)) return code
    }
    return `S${shownVersion.sections.length + 1}`
  }

  const addSection = () => {
    const code = nextSectionCode()
    const blank = { id: newRowId(), code, name: `SLA Section ${code}`, indicators: [] }
    commitSections([...shownVersion.sections, blank])
  }

  const updateSection = (sectionId, patch) =>
    commitSections(
      shownVersion.sections.map((section) =>
        section.id === sectionId ? { ...section, ...patch } : section,
      ),
    )

  const moveSection = (index, direction) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= shownVersion.sections.length) return
    const next = [...shownVersion.sections]
    ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
    commitSections(next)
  }

  const deleteSection = (index) => {
    const section = shownVersion.sections[index]
    if (section.indicators.length > 0) {
      setMessage(
        `Section "${section.code}. ${section.name}" tidak dapat dihapus karena masih berisi ${section.indicators.length} indikator. Kosongkan dahulu.`,
      )
      return
    }
    if (!window.confirm(`Hapus section "${section.code}. ${section.name}"?`)) return
    commitSections(shownVersion.sections.filter((_, i) => i !== index))
  }

  // ---------- Indicator row operations (per section) ----------

  const addIndicatorToSection = (sectionId) => {
    const blank = createBlankIndicator()
    commitSections(
      shownVersion.sections.map((section) =>
        section.id === sectionId
          ? { ...section, indicators: [...section.indicators, blank] }
          : section,
      ),
      { ...shownVersion.targets, [blank.id]: { ...blankTarget } },
    )
  }

  const addIndicatorAtEnd = () => {
    const last = shownVersion.sections[shownVersion.sections.length - 1]
    if (last) addIndicatorToSection(last.id)
  }

  const insertIndicatorAt = (sectionId, index, offset) => {
    const section = shownVersion.sections.find((item) => item.id === sectionId)
    const blank = createBlankIndicator()
    const nextIndicators = [...section.indicators]
    nextIndicators.splice(index + offset, 0, blank)
    commitSections(
      shownVersion.sections.map((item) =>
        item.id === sectionId ? { ...item, indicators: nextIndicators } : item,
      ),
      { ...shownVersion.targets, [blank.id]: { ...blankTarget } },
    )
  }

  const duplicateIndicator = (sectionId, index) => {
    const section = shownVersion.sections.find((item) => item.id === sectionId)
    const source = section.indicators[index]
    const copy = { ...source, id: newRowId() }
    const nextIndicators = [...section.indicators]
    nextIndicators.splice(index + 1, 0, copy)
    const sourceTarget = targetOf(source.id)
    commitSections(
      shownVersion.sections.map((item) =>
        item.id === sectionId ? { ...item, indicators: nextIndicators } : item,
      ),
      {
        ...shownVersion.targets,
        [copy.id]: { ...sourceTarget, ulpTargets: { ...(sourceTarget.ulpTargets ?? {}) } },
      },
    )
  }

  const deleteIndicator = (sectionId, index) => {
    const section = shownVersion.sections.find((item) => item.id === sectionId)
    const target = section.indicators[index]
    const label = target.point || target.criteria || 'Baris ini'
    if (!window.confirm(`Hapus indikator "${label}" dari draft SLA?`)) return
    const restTargets = { ...shownVersion.targets }
    delete restTargets[target.id]
    commitSections(
      shownVersion.sections.map((item) =>
        item.id === sectionId
          ? { ...item, indicators: item.indicators.filter((_, i) => i !== index) }
          : item,
      ),
      restTargets,
    )
  }

  const moveIndicator = (sectionId, index, direction) => {
    const section = shownVersion.sections.find((item) => item.id === sectionId)
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= section.indicators.length) return
    const nextIndicators = [...section.indicators]
    ;[nextIndicators[index], nextIndicators[targetIndex]] = [
      nextIndicators[targetIndex],
      nextIndicators[index],
    ]
    commitSections(
      shownVersion.sections.map((item) =>
        item.id === sectionId ? { ...item, indicators: nextIndicators } : item,
      ),
    )
  }

  const applyFlatUlpTargets = () => {
    const next = {}
    shownVersion.sections.forEach((section) =>
      section.indicators.forEach((indicator) => {
        const current = targetOf(indicator.id)
        const ulpTargets = {}
        ulpUnits.forEach((ulp) => {
          ulpTargets[ulp.id] = current.ulp
        })
        next[indicator.id] = { ...current, ulpTargets }
      }),
    )
    commitSections(shownVersion.sections, { ...shownVersion.targets, ...next })
    setMessage(
      `Target ULP diterapkan ke seluruh unit dalam kontrak ${contractScope.contractName} (${ulpUnits.length} ULP). Struktur data tetap menyimpan target per unit.`,
    )
  }

  const handleSaveDraft = () => {
    setMessage(
      `Draft "${shownVersion.name}" tersimpan (${shownVersion.sections.length} section, ${totalIndicators} indikator). Draft belum diaktifkan; gunakan tombol "Aktifkan SLA" setelah siap.`,
    )
  }

  const handleSaveMetadata = (patch) => {
    onUpdateVersion(metadataId, patch)
    setMessage(
      `Metadata "${patch.name}" tersimpan. Struktur indikator, bobot, target historis, dan data laporan tidak diubah.`,
    )
  }

  const handleActivate = () => {
    const check = versionMetadataValid(shownVersion)
    if (!check.valid) {
      setMessage(
        `Tidak dapat mengaktifkan "${shownVersion.name}": lengkapi metadata wajib terlebih dahulu \u2014 ${check.missing.join(', ')}.`,
      )
      return
    }
    onActivate(editingId)
    setMessage(
      `SLA "${shownVersion.name}" diaktifkan dan diterapkan ke ${up3Name} + seluruh ${ulpUnits.length} ULP dalam scope kontrak ${contractScope.contractName}. Versi aktif sebelumnya menjadi Arsip dan datanya tetap dipertahankan.`,
    )
    setEditingId(null)
  }

  const numInput = (value, readOnly, onChange) => (
    <input
      type="number"
      className="sla-input"
      value={value ?? ''}
      disabled={readOnly}
      placeholder="\u2013"
      onChange={(event) => onChange(parseNumber(event.target.value))}
    />
  )

  const textInput = (value, readOnly, onChange, className = 'sla-input sla-input-wide') => (
    <input
      className={className}
      value={value ?? ''}
      disabled={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  )

  const renderSectionRows = (readOnly) => {
    const colSpan = readOnly ? 12 : 13
    return shownVersion.sections.map((section, sectionIndex) => (
      <Fragment key={section.id}>
        <tr className="sla-preview-cat">
          <td colSpan={colSpan}>
            <div className="sla-section-head">
              {readOnly ? (
                <strong>
                  {section.code}. {section.name}
                </strong>
              ) : (
                <>
                  <input
                    className="sla-input sla-input-code"
                    value={section.code}
                    title="Kode/urutan section"
                    onChange={(event) => updateSection(section.id, { code: event.target.value })}
                  />
                  <input
                    className="sla-input sla-input-wide"
                    value={section.name}
                    title="Nama section"
                    onChange={(event) => updateSection(section.id, { name: event.target.value })}
                  />
                </>
              )}
              <span className="sla-section-count">
                ({section.indicators.length} indikator)
              </span>
              {!readOnly && (
                <div className="sla-row-actions">
                  <button
                    type="button"
                    className="sla-row-btn"
                    title="Tambah indikator ke section"
                    onClick={() => addIndicatorToSection(section.id)}
                  >
                    + Indikator
                  </button>
                  <button
                    type="button"
                    className="sla-row-btn"
                    title="Pindah section naik"
                    disabled={sectionIndex === 0}
                    onClick={() => moveSection(sectionIndex, -1)}
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    className="sla-row-btn"
                    title="Pindah section turun"
                    disabled={sectionIndex === shownVersion.sections.length - 1}
                    onClick={() => moveSection(sectionIndex, 1)}
                  >
                    &darr;
                  </button>
                  <button
                    type="button"
                    className="sla-row-btn sla-row-btn-danger"
                    title="Hapus section (hanya jika kosong)"
                    onClick={() => deleteSection(sectionIndex)}
                  >
                    Hapus
                  </button>
                </div>
              )}
            </div>
          </td>
        </tr>
        {section.indicators.length === 0 && (
          <tr key={`${section.id}-empty`}>
            <td colSpan={colSpan} className="sla-section-empty">
              Section belum memiliki indikator. Gunakan tombol &ldquo;+ Indikator&rdquo;.
            </td>
          </tr>
        )}
        {section.indicators.map((indicator, index) => {
          const target = targetOf(indicator.id)
          return (
            <tr key={indicator.id}>
              <td className="sla-table-number">{section.code}</td>
              <td>
                {textInput(indicator.scope, readOnly, (value) =>
                  updateDraftIndicator(section.id, indicator.id, { scope: value }),
                )}
              </td>
              <td>
                {textInput(indicator.point, readOnly, (value) =>
                  updateDraftIndicator(section.id, indicator.id, { point: value }),
                'sla-input sla-input-point')}
              </td>
              <td>
                {textInput(indicator.criteria, readOnly, (value) =>
                  updateDraftIndicator(section.id, indicator.id, { criteria: value }),
                )}
              </td>
              <td>
                {textInput(indicator.performanceTarget, readOnly, (value) =>
                  updateDraftIndicator(section.id, indicator.id, {
                    performanceTarget: value,
                  }),
                )}
              </td>
              <td>
                {textInput(indicator.evidence, readOnly, (value) =>
                  updateDraftIndicator(section.id, indicator.id, { evidence: value }),
                )}
              </td>
              <td>
                <select
                  className="sla-select"
                  value={indicator.weightType}
                  disabled={readOnly}
                  onChange={(event) =>
                    updateDraftIndicator(section.id, indicator.id, {
                      weightType: event.target.value,
                    })
                  }
                >
                  {WEIGHT_TYPES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {numInput(indicator.weight, readOnly, (value) =>
                  updateDraftIndicator(section.id, indicator.id, { weight: value }),
                )}
              </td>
              <td>
                {textInput(indicator.unit, readOnly, (value) =>
                  updateDraftIndicator(section.id, indicator.id, { unit: value }),
                'sla-input')}
              </td>
              <td>
                {numInput(target.up3, readOnly, (value) =>
                  updateDraftTarget(indicator.id, 'up3', value),
                )}
              </td>
              <td>
                {numInput(target.ulp, readOnly, (value) =>
                  updateDraftTarget(indicator.id, 'ulp', value),
                )}
              </td>
              <td>
                <select
                  className="sla-select"
                  value={indicator.inputMode}
                  disabled={readOnly}
                  onChange={(event) =>
                    updateDraftIndicator(section.id, indicator.id, {
                      inputMode: event.target.value,
                    })
                  }
                >
                  {INPUT_MODES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </td>
              {!readOnly && (
                <td>
                  <div className="sla-row-actions">
                    <button
                      type="button"
                      className="sla-row-btn"
                      title="Pindah naik (dalam section ini)"
                      disabled={index === 0}
                      onClick={() => moveIndicator(section.id, index, -1)}
                    >
                      &uarr;
                    </button>
                    <button
                      type="button"
                      className="sla-row-btn"
                      title="Pindah turun (dalam section ini)"
                      disabled={index === section.indicators.length - 1}
                      onClick={() => moveIndicator(section.id, index, 1)}
                    >
                      &darr;
                    </button>
                    <button
                      type="button"
                      className="sla-row-btn"
                      title="Tambah baris di atas"
                      onClick={() => insertIndicatorAt(section.id, index, 0)}
                    >
                      Atas
                    </button>
                    <button
                      type="button"
                      className="sla-row-btn"
                      title="Tambah baris di bawah"
                      onClick={() => insertIndicatorAt(section.id, index, 1)}
                    >
                      Bawah
                    </button>
                    <button
                      type="button"
                      className="sla-row-btn"
                      title="Duplikat baris"
                      onClick={() => duplicateIndicator(section.id, index)}
                    >
                      Duplikat
                    </button>
                    <button
                      type="button"
                      className="sla-row-btn sla-row-btn-danger"
                      title="Hapus baris"
                      onClick={() => deleteIndicator(section.id, index)}
                    >
                      Hapus
                    </button>
                  </div>
                </td>
              )}
            </tr>
          )
        })}
      </Fragment>
    ))
  }

  return (
    <section className="sla-settings">
      <div className="sla-scope-bar">
        <div>
          <strong>Kontrak: {contractScope.contractName}</strong>
          <div className="sla-scope-region">Wilayah: {contractScope.region}</div>
        </div>
        <div className="sla-scope-chips">
          <span className="sla-scope-chip">{up3Name}</span>
          {ulpUnits.map((unit) => (
            <span key={unit.id} className="sla-scope-chip">
              {currentNameOf(unit)}
            </span>
          ))}
        </div>
        <div className="sla-scope-note">
          SLA melekat pada kontrak ini, bukan global. Scope penerapan: UP3 +
          seluruh ULP yang terdaftar dalam kontrak {contractScope.contractName}.
        </div>
      </div>

      <div className="sla-settings-tabs" role="tablist" aria-label="Pengaturan SLA">
        <button
          type="button"
          role="tab"
          aria-selected={settingsView === 'structure'}
          className={`sla-settings-tab ${settingsView === 'structure' ? 'sla-settings-tab-active' : ''}`}
          onClick={() => setSettingsView('structure')}
        >
          Struktur / Versi SLA
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={settingsView === 'targets'}
          className={`sla-settings-tab ${settingsView === 'targets' ? 'sla-settings-tab-active' : ''}`}
          onClick={() => setSettingsView('targets')}
        >
          Target ULP
        </button>
      </div>

      {settingsView === 'targets' ? (
        <TargetUlpView orgMap={orgMap} versions={versions} />
      ) : (
        <Fragment>

      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Pengaturan SLA / Addendum</h2>
        <button
          type="button"
          className="sla-btn sla-btn-primary"
          onClick={() => setShowCreate((open) => !open)}
        >
          {showCreate ? 'Batal' : 'Buat SLA/Addendum Baru'}
        </button>
      </div>

      {message && (
        <div className="sla-message" role="status">
          {message}
        </div>
      )}

      {showCreate && (
        <div className="sla-draft-form">
          <div className="sla-draft-form-fields">
            <div className="sla-context-field">
              <span className="sla-context-label">Sumber pembuatan</span>
              <div className="sla-radio-row">
                <label className="sla-radio">
                  <input
                    type="radio"
                    name="draft-source"
                    value="upload"
                    checked={draftSource === 'upload'}
                    onChange={(event) => setDraftSource(event.target.value)}
                  />
                  Upload CSV/Excel
                </label>
                <label className="sla-radio">
                  <input
                    type="radio"
                    name="draft-source"
                    value="copy-active"
                    checked={draftSource === 'copy-active'}
                    onChange={(event) => setDraftSource(event.target.value)}
                  />
                  Salin dari SLA Aktif
                </label>
              </div>
            </div>
            <label className="sla-context-field">
              <span className="sla-context-label">Nama versi/addendum</span>
              <input
                className="sla-input sla-input-text"
                value={draftName}
                placeholder={`Addendum ${versions.length}`}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </label>
            <label className="sla-context-field">
              <span className="sla-context-label">Periode berlaku (label)</span>
              <input
                className="sla-input sla-input-text"
                value={draftPeriod}
                onChange={(event) => setDraftPeriod(event.target.value)}
              />
            </label>
            <label className="sla-context-field">
              <span className="sla-context-label">Periode mulai (DD-MM-YYYY)</span>
              <input
                className="sla-input sla-input-text"
                value={draftPeriodStart}
                placeholder="01-01-2027"
                onChange={(event) => setDraftPeriodStart(event.target.value)}
              />
            </label>
            <label className="sla-context-field">
              <span className="sla-context-label">Periode selesai (DD-MM-YYYY)</span>
              <input
                className="sla-input sla-input-text"
                value={draftPeriodEnd}
                placeholder="31-12-2027"
                onChange={(event) => setDraftPeriodEnd(event.target.value)}
              />
            </label>
            <button type="button" className="sla-btn sla-btn-primary" onClick={handleSubmitDraft}>
              Buat Draft
            </button>
          </div>
          {draftSource === 'upload' && (
            <p className="sla-flat-note">
              Prototype: Upload CSV/Excel disimulasikan — file nyata belum
              diparsing. Struktur SLA A&ndash;D dimuat dari data default dan dapat
              diperbaiki sebelum diaktifkan.
            </p>
          )}
          {draftSource === 'copy-active' && (
            <p className="sla-flat-note">
              Draft dibuat dengan menyalin section, indikator, dan target dari
              versi SLA yang sedang Aktif.
            </p>
          )}
        </div>
      )}

      <h3 className="sla-subtitle">Riwayat SLA</h3>
      <div className="sla-preview-scroll">
        <table className="sla-preview-table sla-version-table">
          <thead>
            <tr>
              <th>Nama SLA/Addendum</th>
              <th>Status</th>
              <th>Periode Berlaku</th>
              <th>Nomor Surat</th>
              <th>Tanggal Berlaku</th>
              <th>Jumlah Indikator</th>
              <th>Sumber</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr
                key={version.id}
                className={version.status === 'Aktif' ? 'sla-version-row-active' : undefined}
              >
                <td>
                  <span className="sla-version-title">{version.name}</span>
                  {version.status === 'Aktif' && (
                    <div className="sla-table-hint">
                      Diterapkan ke {up3Name} + {ulpUnits.length} ULP
                    </div>
                  )}
                </td>
                <td>
                  <span className={`sla-status-badge sla-status-${version.status.toLowerCase()}`}>
                    {version.status}
                  </span>
                </td>
                <td>
                  {formatDateKey(version.periodStart) ?? '\u2013'} s.d.{' '}
                  {formatDateKey(version.periodEnd) ?? '\u2013'}
                </td>
                <td className="sla-version-letter">{version.agreementName ?? '\u2013'}</td>
                <td>{formatDateKey(version.effectiveDate) ?? '\u2013'}</td>
                <td>{countIndicators(version)}</td>
                <td>{sourceLabel(version.source)}</td>
                <td>
                  <div className="sla-version-actions">
                    {version.status === 'Draft' ? (
                      <>
                        <button
                          type="button"
                          className="sla-btn"
                          onClick={() => {
                            setEditingId(version.id)
                            setViewingId(null)
                            setMetadataId(null)
                          }}
                        >
                          Edit Struktur
                        </button>
                        <button
                          type="button"
                          className="sla-btn"
                          onClick={() => {
                            setMetadataId(version.id)
                            setViewingId(null)
                            setEditingId(null)
                          }}
                        >
                          Edit Metadata
                        </button>
                        <button
                          type="button"
                          className="sla-btn"
                          onClick={() => {
                            setViewingId(version.id)
                            setEditingId(null)
                            setMetadataId(null)
                          }}
                        >
                          Lihat
                        </button>
                        <button type="button" className="sla-btn" onClick={() => handleDuplicate(version)}>
                          Duplikat
                        </button>
                        <button
                          type="button"
                          className="sla-btn sla-btn-danger"
                          onClick={() => handleDeleteDraft(version)}
                        >
                          Hapus
                        </button>
                      </>
                    ) : version.status === 'Aktif' ? (
                      <>
                        <button
                          type="button"
                          className="sla-btn"
                          onClick={() => {
                            setViewingId(version.id)
                            setEditingId(null)
                            setMetadataId(null)
                          }}
                        >
                          Lihat
                        </button>
                        <button
                          type="button"
                          className="sla-btn"
                          onClick={() => {
                            setMetadataId(version.id)
                            setViewingId(null)
                            setEditingId(null)
                          }}
                        >
                          Edit Metadata
                        </button>
                        <button type="button" className="sla-btn" onClick={() => handleDuplicate(version)}>
                          Buat Addendum dari versi ini
                        </button>
                        {versionReferences(version).length ? (
                          <span className="sla-table-hint">sudah dipakai pelaporan</span>
                        ) : (
                          <button
                            type="button"
                            className="sla-btn sla-btn-danger"
                            onClick={() => handleRollback(version)}
                          >
                            Batalkan Aktivasi
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="sla-btn"
                          onClick={() => {
                            setViewingId(version.id)
                            setEditingId(null)
                            setMetadataId(null)
                          }}
                        >
                          Lihat
                        </button>
                        <button
                          type="button"
                          className="sla-btn"
                          onClick={() => {
                            setMetadataId(version.id)
                            setViewingId(null)
                            setEditingId(null)
                          }}
                        >
                          Edit Metadata
                        </button>
                        <button type="button" className="sla-btn" onClick={() => handleDuplicate(version)}>
                          Jadikan dasar Addendum
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shownVersion && (
        <div className="sla-draft-editor">
          {editingVersion ? (
            <h3 className="sla-draft-editor-title">Edit Draft: {editingVersion.name}</h3>
          ) : metadataVersion ? (
            <h3 className="sla-draft-editor-title">
              Edit Metadata: {metadataVersion.name} ({metadataVersion.status})
            </h3>
          ) : (
            <h3 className="sla-draft-editor-title">Lihat SLA: {viewingVersion.name}</h3>
          )}

          {metadataVersion && !editingVersion && !viewingVersion && (
            <MetadataForm key={metadataVersion.id} version={metadataVersion} onSave={handleSaveMetadata} />
          )}

          {(editingVersion || viewingVersion) && (
            <Fragment>
          <div className="sla-draft-form-fields">
            <label className="sla-context-field">
              <span className="sla-context-label">Nama versi/addendum</span>
              <input
                className="sla-input sla-input-text"
                value={shownVersion.name}
                disabled={!editingVersion}
                onChange={(event) =>
                  onUpdateVersion(editingId, { name: event.target.value })
                }
              />
            </label>
            <label className="sla-context-field">
              <span className="sla-context-label">Periode berlaku</span>
              <input
                className="sla-input sla-input-text"
                value={shownVersion.period}
                disabled={!editingVersion}
                onChange={(event) =>
                  onUpdateVersion(editingId, { period: event.target.value })
                }
              />
            </label>
            {editingVersion && (
              <button type="button" className="sla-btn sla-btn-primary" onClick={handleSaveDraft}>
                Simpan Draft
              </button>
            )}
            {editingVersion && (
              <button type="button" className="sla-btn" onClick={addSection}>
                Tambah Section
              </button>
            )}
            {editingVersion && (
              <button type="button" className="sla-btn" onClick={addIndicatorAtEnd}>
                Tambah Baris
              </button>
            )}
            {editingVersion && (
              <button type="button" className="sla-btn" onClick={applyFlatUlpTargets}>
                Terapkan Target ULP ke Seluruh Unit dalam Kontrak
              </button>
            )}
          </div>

          <p className="sla-flat-note">
            {editingVersion
              ? 'Section dan indikator adalah struktur terpisah: pindah naik/turun indikator hanya berlaku di dalam section yang sama (heading section tidak pernah berduplikat). Section baru (E, F, ...) dapat ditambahkan dan hanya dapat dihapus jika belum berisi indikator. Perubahan tersimpan saat menekan "Simpan Draft"; "Aktifkan SLA" terpisah dan hanya setelah draft siap.'
              : 'Mode lihat (read-only). Versi ini tidak dapat diedit langsung.'}
          </p>

          <div className="sla-preview-scroll">
            <table className="sla-preview-table sla-editor-table">
              <thead>
                <tr>
                  <th className="sla-th-number">No</th>
                  <th>Ruang Lingkup</th>
                  <th>Poin</th>
                  <th>Kriteria</th>
                  <th>Target Kinerja</th>
                  <th>Eviden</th>
                  <th>Jenis Bobot</th>
                  <th>Bobot</th>
                  <th>Satuan</th>
                  <th>Target UP3</th>
                  <th>Target ULP</th>
                  <th>Sumber Data</th>
                  {editingVersion && <th>Aksi</th>}
                </tr>
              </thead>
              <tbody>{renderSectionRows(!editingVersion)}</tbody>
            </table>
          </div>

          {editingVersion && (
            <div className="sla-activate-preview">
              <h4 className="sla-activate-title">Preview Aktivasi</h4>
              <div className="sla-activate-grid">
                <div>
                  <span className="sla-activate-label">Nama kontrak</span>
                  {contractScope.contractName}
                </div>
                <div>
                  <span className="sla-activate-label">UP3</span>
                  {up3Name}
                </div>
                <div>
                  <span className="sla-activate-label">Versi SLA</span>
                  {editingVersion.name}
                </div>
                <div>
                  <span className="sla-activate-label">Periode mulai berlaku</span>
                  {editingVersion.period}
                </div>
                <div>
                  <span className="sla-activate-label">ULP dalam scope kontrak</span>
                  {ulpUnits.map((unit) => currentNameOf(unit)).join(', ')}
                </div>
                <div>
                  <span className="sla-activate-label">Jumlah indikator</span>
                  {totalIndicators}
                </div>
              </div>
              <div className="sla-draft-actions">
                <button type="button" className="sla-btn sla-btn-primary" onClick={handleActivate}>
                  Aktifkan SLA
                </button>
                <span className="sla-flat-note">
                  Draft menjadi Aktif, versi aktif sebelumnya menjadi Arsip. Versi
                  baru diterapkan ke UP3 + seluruh ULP dalam scope kontrak; data
                  versi lama tetap dipertahankan.
                </span>
              </div>
            </div>
          )}
            </Fragment>
          )}
        </div>
      )}
        </Fragment>
      )}
    </section>
  )
}
