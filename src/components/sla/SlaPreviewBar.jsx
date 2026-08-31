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
  return (
    <div className="header-preview">
      <label className="header-preview-control">
        <span className="header-preview-label">View As</span>
        <select
          className="header-preview-select"
          value={role}
          onChange={(event) => onRoleChange(event.target.value)}
        >
          {slaRoles.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>
      {up3s.length > 1 && (
        <label className="header-preview-control header-preview-unit">
          <span className="header-preview-label">UP3</span>
          <select
            className="header-preview-select"
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
        <label className="header-preview-control header-preview-unit">
          <span className="header-preview-label">Unit</span>
          <select
            className="header-preview-select"
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
    </div>
  )
}
