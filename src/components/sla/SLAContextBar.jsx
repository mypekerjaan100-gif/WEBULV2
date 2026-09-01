import { currentNameOf } from '../../data/organisasiPelayananTeknik.js'
import { FilterBar, FilterField, Select } from '../ui/Primitives.jsx'

export default function SLAContextBar({
  role,
  periods,
  versions,
  units,
  period,
  version,
  versionName,
  unitId,
  onPeriodChange,
  onVersionChange,
  onUnitChange,
}) {
  return (
    <FilterBar className="sla-context-bar">
      <FilterField label="Periode" className="sla-context-field">
        <Select
          className="sla-context-select"
          value={period}
          onChange={(event) => onPeriodChange(event.target.value)}
        >
          {periods.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
      </FilterField>
      {role === 'ulp' ? (
        <div className="ui-field sla-context-field">
          <span className="ui-field-label">SLA Berlaku</span>
          <span className="sla-context-static">{versionName ?? '\u2014'}</span>
        </div>
      ) : (
        <FilterField label="Versi SLA" className="sla-context-field">
          <Select
            className="sla-context-select"
            value={version}
            onChange={(event) => onVersionChange(event.target.value)}
          >
            {versions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} &middot; {item.status}
              </option>
            ))}
          </Select>
        </FilterField>
      )}
      {role === 'up3' && (
        <FilterField label="Unit" className="sla-context-field">
          <Select
            className="sla-context-select"
            value={unitId}
            onChange={(event) => onUnitChange(event.target.value)}
          >
            {units.map((item) => (
              <option key={item.id} value={item.id}>
                {currentNameOf(item)} ({item.type})
              </option>
            ))}
          </Select>
        </FilterField>
      )}
      <span className="sla-context-note">
        Data laporan Supabase
      </span>
    </FilterBar>
  )
}
