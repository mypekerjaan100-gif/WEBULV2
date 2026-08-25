import { slaCategories, variableCostPoints } from '../../data/slaPelayananTeknik.js'

const COLUMN_COUNT = 14

function parseNumber(raw) {
  if (raw === '') return null
  const value = Number(raw)
  return Number.isNaN(value) ? null : value
}

function formatValue(value) {
  if (value == null || value === '') return '\u2013'
  if (typeof value === 'string') return value
  const number = Number(value)
  return Number.isNaN(number) ? '\u2013' : number.toLocaleString('id-ID')
}

function dendaPercent(indicator) {
  const weight = indicator.weight
  if (weight == null || weight === '') return null
  const value = (Number(weight) / 30) * 9
  return Number.isNaN(value) ? null : value
}

function formatDendaPercent(value) {
  if (value == null) return '\u2013'
  return `${value.toLocaleString('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`
}

export default function SLAIndicatorTable({
  indicators,
  role,
  unitId,
  up3Id,
  entries,
  onEntriesChange,
  targets,
  onTargetsChange,
  variableTargets = {},
}) {
  const isUp3Role = role === 'up3'
  const isUp3View = unitId === up3Id

  const entryOf = (indicatorId) => entries[indicatorId] ?? {}

  const updateEntry = (indicatorId, field, value) =>
    onEntriesChange({
      ...entries,
      [indicatorId]: { ...entryOf(indicatorId), [field]: value },
    })

  const editEntries = entries

  const targetOf = (indicatorId) =>
    targets[indicatorId] ?? { up3: null, ulp: null, ulpTargets: {} }

  const ulpTargetOf = (indicatorId) => {
    const target = targetOf(indicatorId)
    return target.ulpTargets?.[unitId] ?? target.ulp
  }

  const fieldMode = (isVc, field) => {
    if (!isUp3Role) {
      if (field === 'target-up3' || field === 'target-ulp') return 'view'
      if (field === 'realisasi' || field === 'pencapaian') {
        return isVc ? 'view' : 'edit'
      }
      return 'edit'
    }
    if (isUp3View) {
      if (field === 'target-up3') return 'edit'
      if (field === 'target-ulp') return 'view'
      if (field === 'realisasi' || field === 'pencapaian') {
        return isVc ? 'view' : 'edit'
      }
      return 'edit'
    }
    if (field === 'target-ulp') return 'edit'
    return 'view'
  }

  const numInput = (value, disabled, onChange) => (
    <input
      type="number"
      className="sla-input"
      value={value ?? ''}
      disabled={disabled}
      placeholder="\u2013"
      onChange={(event) => onChange(parseNumber(event.target.value))}
    />
  )

  const autoCell = (value) => (
    <div className="sla-auto-cell">
      <span>{formatValue(value)}</span>
      <span className="sla-badge sla-badge-variable-cost">Otomatis</span>
    </div>
  )

  const renderTargetCell = (indicator) => {
    if (indicator.point === '3.1c') {
      return <span className="sla-readonly">—</span>
    }
    const isVariableLinked = indicator.category === 'A' && indicator.inputMode === 'variable-cost' && variableCostPoints.has(indicator.point)
    if (isVariableLinked) {
      return <span className="sla-readonly" title="Target dikelola melalui Variable Cost oleh Admin UP3.">{formatValue(variableTargets[indicator.point])} <span style={{ fontSize: 10, color: '#6b7280' }}>• Dari Variable Cost</span></span>
    }
    const target = targetOf(indicator.id)
    const isUlpField = !isUp3View
    const field = isUlpField ? 'target-ulp' : 'target-up3'
    const value = isUlpField ? ulpTargetOf(indicator.id) : target.up3
    if (fieldMode(false, field) === 'edit') {
      return numInput(value, false, (next) => {
        if (isUlpField) {
          onTargetsChange({
            ...targets,
            [indicator.id]: {
              ...target,
              ulpTargets: { ...(target.ulpTargets ?? {}), [unitId]: next },
            },
          })
        } else {
          onTargetsChange({
            ...targets,
            [indicator.id]: { ...target, up3: next },
          })
        }
      })
    }
    return <span className="sla-readonly">{formatValue(value)}</span>
  }

  const renderDataCell = (indicator, isVc, field) => {
    const value = entryOf(indicator.id)[field]
    const mode = fieldMode(isVc, field)
    if (mode === 'edit') {
      return numInput(value, false, (next) => updateEntry(indicator.id, field, next))
    }
    if ((field === 'realisasi' || field === 'pencapaian') && isVc) {
      return autoCell(value)
    }
    return <span className="sla-readonly">{formatValue(value)}</span>
  }

  const renderSatuanCell = (indicator, isVc) => {
    const value = entryOf(indicator.id).unit
    if (fieldMode(isVc, 'satuan') === 'edit') {
      return (
        <input
          className="sla-input sla-input-text"
          value={value}
          onChange={(event) => updateEntry(indicator.id, 'unit', event.target.value)}
        />
      )
    }
    return <span className="sla-readonly">{formatValue(value)}</span>
  }

  const renderDenda = (indicator, entry) => {
    const achievement = entry?.achievement
    if (achievement == null) {
      return (
        <span className="sla-denda-badge sla-denda-unknown">Belum dinilai</span>
      )
    }
    if (achievement >= 100) {
      return <span className="sla-readonly">\u2013</span>
    }
    return (
      <span className="sla-denda-penalty-value">
        {formatDendaPercent(dendaPercent(indicator))}
      </span>
    )
  }

  const rows = []
  let lastCategory = null

  indicators.forEach((indicator) => {
    const isVc = indicator.inputMode === 'variable-cost'

    if (indicator.category !== lastCategory) {
      lastCategory = indicator.category
      const category = slaCategories.find((c) => c.id === indicator.category)
      const count = indicators.filter(
        (item) => item.category === indicator.category,
      ).length
      rows.push(
        <tr key={`category-${indicator.category}`} className="sla-section-row">
          <td colSpan={COLUMN_COUNT}>
            <h3 className="sla-section-title">
              {category?.name ?? indicator.categoryName ?? indicator.category}
              <span className="sla-section-count"> ({count} indikator)</span>
            </h3>
          </td>
        </tr>,
      )
    }

    rows.push(
      <tr key={indicator.id}>
        <td className="sla-table-number">{indicator.category}</td>
        <td className="sla-table-scope-cell">{indicator.scope}</td>
        <td className="sla-table-point">
          {indicator.point}
          <span className={`sla-badge sla-badge-${indicator.inputMode}`}>
            {isVc ? 'Variable Cost' : 'Manual'}
          </span>
        </td>
        <td className="sla-table-criteria">{indicator.criteria}</td>
        <td className="sla-table-target-kinerja">{indicator.performanceTarget}</td>
        <td className="sla-table-eviden">{indicator.evidence}</td>
        <td className="sla-table-weight-type">{indicator.weightType}</td>
        <td className="sla-table-weight">{indicator.weight}</td>
        <td>{renderSatuanCell(indicator, isVc)}</td>
        <td>{renderTargetCell(indicator)}</td>
        <td>{renderDataCell(indicator, isVc, 'wo')}</td>
        <td>{renderDataCell(indicator, isVc, 'realisasi')}</td>
        <td>{renderDataCell(indicator, isVc, 'pencapaian')}</td>
        <td className="sla-table-penalty">
          {renderDenda(indicator, entryOf(indicator.id))}
        </td>
      </tr>,
    )
  })

  if (isUp3View) {
    const totalDenda = indicators.reduce((sum, indicator) => {
      const achievement = entryOf(indicator.id).achievement
      const percent = dendaPercent(indicator)
      if (achievement != null && achievement < 100 && percent != null) {
        return sum + percent
      }
      return sum
    }, 0)
    rows.push(
      <tr key="sla-denda-total" className="sla-denda-total-row">
        <td colSpan={COLUMN_COUNT - 1} className="sla-denda-total-label">
          TOTAL DENDA SLA
        </td>
        <td
          className={`sla-denda-total-value${totalDenda > 0 ? ' sla-denda-total-value-penalty' : ''}`}
        >
          {totalDenda > 0 ? formatDendaPercent(totalDenda) : '\u2013'}
        </td>
      </tr>,
    )
  }

  return (
    <div className="sla-table-wrap">
      <table className="sla-table">
        <thead>
          <tr>
            <th className="sla-th-number">No</th>
            <th>Ruang Lingkup</th>
            <th className="sla-th-point">Poin</th>
            <th>Kriteria</th>
            <th>Target Kinerja</th>
            <th>Eviden</th>
            <th>Jenis Bobot</th>
            <th className="sla-th-weight">Bobot</th>
            <th>Satuan</th>
            <th>Target</th>
            <th>WO</th>
            <th>Realisasi</th>
            <th>Pencapaian</th>
            <th>Denda</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  )
}
