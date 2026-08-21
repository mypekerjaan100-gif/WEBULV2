import SLAIndicatorTable from './SLAIndicatorTable.jsx'

export default function SLAVariableCost({
  indicators,
  role,
  unitId,
  up3Id,
  entries,
  onEntriesChange,
  targets,
  onTargetsChange,
}) {
  return (
    <section className="sla-module-panel">
      <div className="sla-export-bar">
        <span className="sla-export-scope">
          Variable Cost {'\u2014'} {indicators.length} indikator otomatis untuk
          scope UP3/unit/versi SLA aktif. Realisasi &amp; Pencapaian mengisi SLA
          pada scope yang sama.
        </span>
      </div>
      <SLAIndicatorTable
        indicators={indicators}
        role={role}
        unitId={unitId}
        up3Id={up3Id}
        entries={entries}
        onEntriesChange={onEntriesChange}
        targets={targets}
        onTargetsChange={onTargetsChange}
      />
    </section>
  )
}