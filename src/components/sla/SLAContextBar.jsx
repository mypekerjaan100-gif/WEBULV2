import { currentNameOf } from '../../data/organisasiPelayananTeknik.js'

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
    <div className="sla-context-bar">
      <label className="sla-context-field">
        <span className="sla-context-label">Periode</span>
        <select
          className="sla-context-select"
          value={period}
          onChange={(event) => onPeriodChange(event.target.value)}
        >
          {periods.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      {role === 'ulp' ? (
        <div className="sla-context-field">
          <span className="sla-context-label">SLA Berlaku</span>
          <span className="sla-context-static">{versionName ?? '\u2014'}</span>
        </div>
      ) : (
        <label className="sla-context-field">
          <span className="sla-context-label">Versi SLA</span>
          <select
            className="sla-context-select"
            value={version}
            onChange={(event) => onVersionChange(event.target.value)}
          >
            {versions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} &middot; {item.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {role === 'up3' && (
        <label className="sla-context-field">
          <span className="sla-context-label">Unit</span>
          <select
            className="sla-context-select"
            value={unitId}
            onChange={(event) => onUnitChange(event.target.value)}
          >
            {units.map((item) => (
              <option key={item.id} value={item.id}>
                {currentNameOf(item)} ({item.type})
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="sla-context-note">
        Dummy &middot; tanpa perhitungan otomatis
      </span>
    </div>
  )
}