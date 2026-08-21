import {
  currentNameOf,
  effectiveStatusOf,
} from '../../data/organisasiPelayananTeknik.js'
import { slaRoles } from '../../data/slaPelayananTeknik.js'

export default function SlaPreviewBar({ preview }) {
  const {
    role,
    onRoleChange,
    unitId,
    onUnitChange,
    up3Id,
    onUp3Change,
    units,
  } = preview
  const up3s = units.filter((unit) => unit.type === 'UP3')
  const activeUlps = units.filter(
    (unit) =>
      unit.type === 'ULP' &&
      unit.parentUnitId === up3Id &&
      effectiveStatusOf(units, unit.id) === 'Aktif',
  )
  const selectedUp3 = up3s.find((unit) => unit.id === up3Id)

  return (
    <div className="header-preview">
      <span className="header-preview-label">Role Preview</span>
      <div className="sla-role-switch">
        {slaRoles.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`sla-role-btn ${role === item.id ? 'sla-role-btn-active' : ''}`}
            onClick={() => onRoleChange(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
      {up3s.length > 1 && (
        <label className="sla-context-field header-preview-unit">
          <span className="sla-context-label">UP3 Preview</span>
          <select
            className="sla-context-select"
            value={up3Id}
            onChange={(event) => onUp3Change(event.target.value)}
          >
            {up3s.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {currentNameOf(unit)}
              </option>
            ))}
          </select>
        </label>
      )}
      {role === 'ulp' && (
        <label className="sla-context-field header-preview-unit">
          <span className="sla-context-label">Unit Preview</span>
          <select
            className="sla-context-select"
            value={unitId}
            onChange={(event) => onUnitChange(event.target.value)}
          >
            {activeUlps.length === 0 && <option value="">Tidak ada unit aktif</option>}
            {activeUlps.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {currentNameOf(unit)}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="header-preview-unit">
        <span className="sla-context-label">Scope</span>
        <span className="sla-context-static">
          {selectedUp3 ? currentNameOf(selectedUp3) : ''}
          {role === 'ulp' && unitId ? ` · ${currentNameOf(units.find((u) => u.id === unitId))}` : ''}
        </span>
      </span>
    </div>
  )
}