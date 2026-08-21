import { useState } from 'react'
import AppLayout from './layout/AppLayout.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ContractPage from './pages/ContractPage.jsx'
import SLAPelayananTeknikPage from './pages/sla/SLAPelayananTeknikPage.jsx'
import { SlaPreviewContext } from './context/SlaPreviewContext.js'
import {
  effectiveStatusOf,
  initialOrganizationUnits,
} from './data/organisasiPelayananTeknik.js'
import { contracts } from './data/contracts.js'

export default function App() {
  const [activeContractId, setActiveContractId] = useState(null)
  const [role, setRole] = useState('up3')
  const [units, setUnits] = useState(() =>
    initialOrganizationUnits.map((unit) => ({
      ...unit,
      nameHistory: unit.nameHistory.map((entry) => ({ ...entry })),
    })),
  )

  const seedUp3Id = units.find((unit) => unit.type === 'UP3')?.id ?? ''
  const [selectedUp3Id, setSelectedUp3Id] = useState(() => seedUp3Id)
  const up3Id = selectedUp3Id
  const activeUlps = units.filter(
    (unit) =>
      unit.type === 'ULP' &&
      unit.parentUnitId === up3Id &&
      effectiveStatusOf(units, unit.id) === 'Aktif',
  )
  const [unitId, setUnitId] = useState(() => seedUp3Id)

  const navigate = (contractId) => {
    setActiveContractId(contractId)
  }

  const handleRoleChange = (nextRole) => {
    setRole(nextRole)
    if (nextRole === 'ulp') {
      const staysUlp =
        units.some(
          (unit) => unit.id === unitId && unit.type === 'ULP' && unit.parentUnitId === up3Id,
        ) && activeUlps.some((unit) => unit.id === unitId)
      if (!staysUlp) setUnitId(activeUlps[0]?.id ?? '')
    } else {
      setUnitId(up3Id)
    }
  }

  const handleUp3Change = (nextUp3Id) => {
    setSelectedUp3Id(nextUp3Id)
    if (role === 'ulp') {
      const childUlps = units.filter(
        (unit) =>
          unit.type === 'ULP' &&
          unit.parentUnitId === nextUp3Id &&
          effectiveStatusOf(units, unit.id) === 'Aktif',
      )
      setUnitId(childUlps[0]?.id ?? '')
    } else {
      setUnitId(nextUp3Id)
    }
  }

  const activeContract = contracts.find(
    (contract) => contract.id === activeContractId,
  )

  const preview = {
    role,
    onRoleChange: handleRoleChange,
    unitId,
    onUnitChange: setUnitId,
    up3Id,
    onUp3Change: handleUp3Change,
    units,
  }

  return (
    <SlaPreviewContext.Provider value={preview}>
      <AppLayout
        activeContractId={activeContractId}
        onNavigate={navigate}
        preview={preview}
      >
        {activeContract ? (
          activeContract.id === 'pelayanan-teknik' ? (
            <SLAPelayananTeknikPage
              key={`${activeContractId}:${role}:${up3Id}:${unitId}`}
              contractId={activeContractId}
              onBack={() => navigate(null)}
              role={role}
              onRoleChange={handleRoleChange}
              unitId={unitId}
              onUnitChange={setUnitId}
              up3Id={up3Id}
              units={units}
              onUnitsChange={setUnits}
            />
          ) : (
            <ContractPage contract={activeContract} onBack={() => navigate(null)} />
          )
        ) : (
          <DashboardPage onSelectContract={navigate} />
        )}
      </AppLayout>
    </SlaPreviewContext.Provider>
  )
}