import { useState } from 'react'
import {
  currentNameOf,
  ulpIdsOfUp3,
} from '../../data/organisasiPelayananTeknik.js'
import { jabatanOfScope } from '../../data/jabatanPelayananTeknik.js'
import {
  DEFAULT_POSITION_ID,
  applyProposedChange,
  buildNewEmployee,
  hourlyRateFor,
  today,
} from '../../data/pegawaiPelayananTeknik.js'
import {
  activePensionPolicy,
  ageAt,
  changePensionPolicy,
  effectiveEmploymentStatusOf,
  effectiveStatusHistoryOf,
  lastWorkingDateFor,
  monthsBetween,
  pensionStateOf,
  retirementAgeDateFor,
  retirementEffectiveDateFor,
} from '../../data/pensiunPelayananTeknik.js'
import { currentLocationNameOf } from '../../data/lokasiPelayananTeknik.js'
import { buildMasterPegawaiXlsx, downloadExportFile } from '../../utils/slaExportFile.js'

const inputClass = 'sla-input sla-input-text'
const PAGE_SIZE = 20
const STATUS_REASONS = ['Pensiun', 'Resign', 'PHK', 'Lainnya']
const BANKS = ['BRI', 'BNI', 'MANDIRI', 'BSI']
const TABS = ['utama', 'pembayaran', 'riwayat', 'approval']
const TAB_LABEL = {
  utama: 'Data Utama',
  pembayaran: 'Data Pembayaran',
  riwayat: 'Riwayat',
  approval: 'Approval',
}
const PENSION_BADGE = {
  Normal: 'sla-status-active',
  'Mendekati Pensiun': 'sla-status-warning',
  Peringatan: 'sla-status-danger',
  'Segera Pensiun': 'sla-status-danger',
  Pensiun: 'sla-status-archive',
}

const emptyForm = (defaultUnitId, up3Id) => ({
  nip: '',
  name: '',
  up3Id,
  unitId: defaultUnitId,
  workLocationId: '',
  positionId: DEFAULT_POSITION_ID,
  bank: BANKS[0],
  accountNumber: '',
  hourlyRate: '',
  birthDate: '',
  retirementDateOverride: '',
  pensionOverrideReason: '',
  employmentStatus: 'Aktif',
  statusReason: '',
  statusReasonNote: '',
  statusEffectiveDate: '',
})

const formatPeriod = (from, to) =>
  `${from ?? 'sejak awal'} \u2014 ${to == null ? 'sekarang' : to}`

export default function SLADatabasePegawai({
  contractScope,
  up3Id,
  units,
  employees,
  onEmployeesChange,
  changeRequests,
  onChangeRequestsChange,
  jabatan,
  role,
  unitId,
  pensionPolicies,
  onPensionPoliciesChange,
  locations,
  orgMap,
}) {
  const [search, setSearch] = useState('')
  const [filterJabatan, setFilterJabatan] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterApproval, setFilterApproval] = useState('')
  const [filterUnit, setFilterUnit] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterPension, setFilterPension] = useState('')
  const [pensionForm, setPensionForm] = useState({
    retirementAge: '',
    periodStart: today(),
    keterangan: '',
  })
  const [pensionOpen, setPensionOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [tab, setTab] = useState('utama')
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState(() =>
    emptyForm(
      role === 'ulp'
        ? unitId
        : ulpIdsOfUp3(units, up3Id)[0] ?? up3Id ?? '',
      up3Id,
    ),
  )
  const [formError, setFormError] = useState('')
  const [rejectNotes, setRejectNotes] = useState({})

  const unitById = new Map(units.map((u) => [u.id, u]))
  const orgUnitByUuid = orgMap
    ? new Map(orgMap.units.map((u) => [u.uuid, u]))
    : new Map()
  const orgUnitByKey = orgMap
    ? new Map(orgMap.units.map((u) => [u.legacyKey, u]))
    : new Map()
  const resolveUnitUuid = (id) =>
    orgUnitByUuid.get(id)?.uuid ?? orgUnitByKey.get(id)?.uuid ?? null
  const resolvedContractUuid = orgMap?.contractUuid ?? null
  const resolvedUp3Uuid = orgMap?.up3Uuid ?? null
  const selectedPreviewUnitUuid = resolveUnitUuid(unitId)
  const resolvedUnitUuids = orgMap?.scopedUnitUuids ?? []
  const scopeUnitIds = role === 'ulp'
    ? [selectedPreviewUnitUuid]
    : resolvedUnitUuids
  const scopedUnitIds = scopeUnitIds.filter(Boolean)
  const scopedJabatan = jabatanOfScope(jabatan, contractScope.contractId, up3Id)
  const jabatanById = new Map(scopedJabatan.map((j) => [j.id, j]))
  const scopedLocations = locations.filter(
    (l) =>
      l.contractId === resolvedContractUuid &&
      l.up3Id === resolvedUp3Uuid &&
      scopedUnitIds.includes(l.unitId),
  )
  const locationById = new Map(scopedLocations.map((l) => [l.id, l]))
  const unitName = (id) => {
    if (!id) return ''
    const orgUnit = orgUnitByUuid.get(id)
    if (orgUnit) return orgUnit.displayName
    const legacyUnit = orgUnitByKey.get(id)
    if (legacyUnit) return legacyUnit.displayName
    const localUnit = unitById.get(id)
    if (localUnit) return currentNameOf(localUnit) || id
    return id
  }
  const positionName = (posId) => jabatanById.get(posId)?.name ?? null
  const locationName = (locId) => {
    const location = locationById.get(locId)
    if (!location) return null
    return (
      currentLocationNameOf(location) ||
      (location.type === 'UNIT_OFFICE' ? unitName(location.unitId) : location.legacyKey) ||
      location.id
    )
  }
  const todayStr = today()
  const pensionPolicy = activePensionPolicy(pensionPolicies, contractScope.contractId, up3Id, todayStr)
  const activeScopedLocations = scopedLocations.filter(
    (location) =>
      location.ownStatus === 'Aktif' &&
      orgUnitByUuid.get(location.unitId)?.status === 'Aktif',
  )
  const locationOptionsFor = (unitId) =>
    activeScopedLocations.filter((location) => location.unitId === unitId)
  const filterLocationOptions = scopeUnitIds
    .flatMap((unitId) =>
      locationOptionsFor(unitId)
        .map((l) => ({ id: l.id, label: `${locationName(l.id)} (${unitName(unitId)})` })),
    )
    .sort((a, b) => (a.label < b.label ? -1 : 1))

  const pendingByEmployee = {}
  changeRequests.forEach((req) => {
    if (
      req.type === 'edit' &&
      req.status === 'Pending' &&
      req.employeeId &&
      req.contractId === contractScope.contractId &&
      req.up3Id === resolvedUp3Uuid
    ) {
      ;(pendingByEmployee[req.employeeId] ??= []).push(req)
    }
  })
  const pendingAdds = changeRequests.filter(
    (req) =>
      req.type === 'add' &&
      req.status === 'Pending' &&
      req.contractId === contractScope.contractId &&
      req.up3Id === resolvedUp3Uuid,
  )

  const approvalOf = (row) =>
    row.addPending
      ? 'Pending'
      : pendingByEmployee[row.employee.id]?.length
        ? 'Pending'
        : 'Approved'

  const allRows = [
    ...employees
      .filter(
        (employee) =>
          (employee.contractId == null ||
            employee.contractId === resolvedContractUuid) &&
          (employee.up3Id == null || employee.up3Id === resolvedUp3Uuid),
      )
      .map((employee) => ({ key: employee.id, employee, request: null, addPending: false })),
    ...pendingAdds.map((request) => ({
      key: `req-${request.id}`,
      employee: null,
      request,
      addPending: true,
    })),
  ].filter((row) =>
    scopedUnitIds.includes(row.employee ? row.employee.unitId : row.request.proposed.unitId),
  )

  const query = search.trim().toLowerCase()
  const filtered = allRows.filter((row) => {
    const data = row.employee ?? row.request.proposed
    if (query && !(data.name.toLowerCase().includes(query) || String(data.nip).includes(query))) {
      return false
    }
    if (filterJabatan && data.positionId !== filterJabatan) return false
    if (filterStatus && data.employmentStatus !== filterStatus) return false
    if (filterApproval && approvalOf(row) !== filterApproval) return false
    if (filterUnit && role === 'up3' && data.unitId !== filterUnit) return false
    if (filterLocation && data.workLocationId !== filterLocation) return false
    if (filterPension) {
      const st = pensionStateOf(data, todayStr, pensionPolicy).state
      const eff = effectiveEmploymentStatusOf(data, todayStr, pensionPolicy)
      if (filterPension === 'aktif' && eff.status !== 'Aktif') return false
      if (
        filterPension === 'mendekati-pensiun' &&
        !['Mendekati Pensiun', 'Peringatan', 'Segera Pensiun'].includes(st)
      ) {
        return false
      }
      if (filterPension === 'pensiun' && st !== 'Pensiun') return false
    }
    return true
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const exportMasterPegawai = () => {
    const columns = [
      { label: 'No', width: 8 },
      { label: 'NIP', width: 18 },
      { label: 'Nama', width: 28 },
      { label: 'Unit', width: 22 },
      { label: 'Lokasi Penempatan', width: 26 },
      { label: 'Jabatan', width: 26 },
      { label: 'Tanggal Lahir', width: 16 },
      { label: 'Masa Pensiun', width: 24 },
      { label: 'Bank', width: 14 },
      { label: 'No Rekening', width: 22 },
      { label: 'Status', width: 14 },
      { label: 'Approval', width: 14 },
    ]
    const rows = filtered.map((row, index) => {
      const data = row.employee ?? row.request.proposed
      const pension = pensionStateOf(data, todayStr, pensionPolicy)
      const pensionLabel = pension.retirementDate
        ? `${pension.state} (${pension.retirementDate})`
        : (pension.state ?? '')
      return [
        { value: String(index + 1) },
        { value: data.nip ?? '' },
        { value: data.name ?? '' },
        { value: unitName(data.unitId) },
        { value: data.workLocationId ? (locationName(data.workLocationId) ?? 'Belum Ditentukan') : 'Belum ditentukan' },
        { value: positionName(data.positionId) ?? 'Belum Ditentukan' },
        { value: data.birthDate ?? '', type: 'date' },
        { value: pensionLabel },
        { value: data.bank ?? '' },
        { value: data.accountNumber ?? '' },
        { value: data.employmentStatus ?? '' },
        { value: approvalOf(row) },
      ]
    })
    const scopeName = role === 'ulp'
      ? `ULP_${unitName(selectedPreviewUnitUuid)}`
      : `UP3_${unitName(resolvedUp3Uuid)}`
    const filenameScope = scopeName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
    downloadExportFile(
      buildMasterPegawaiXlsx(columns, rows),
      `Master_Pegawai_${filenameScope}_${todayStr}.xlsx`,
    )
  }

  const resetPage = () => setPage(1)

  const snapshotOf = (employee) => ({
    nip: employee.nip,
    name: employee.name,
    up3Id: employee.up3Id ?? '',
    unitId: employee.unitId,
    workLocationId: employee.workLocationId ?? '',
    positionId: employee.positionId,
    bank: employee.bank,
    accountNumber: employee.accountNumber,
    hourlyRate: hourlyRateFor(employee, today()),
    birthDate: employee.birthDate ?? '',
    retirementDateOverride: employee.retirementDateOverride ?? '',
    pensionOverrideReason: employee.pensionOverrideReason ?? '',
    employmentStatus: employee.employmentStatus,
    statusReason: employee.statusReason ?? '',
    statusReasonNote: employee.statusReasonNote ?? '',
    statusEffectiveDate: employee.statusEffectiveDate ?? '',
  })

  const openDetail = (row) => {
    setTab('utama')
    setFormError('')
    setDetail({ mode: 'view', row })
  }

  const openEdit = (row) => {
    const e = row.employee
    setForm({
      nip: e.nip,
      name: e.name,
      up3Id: e.up3Id ?? resolvedUp3Uuid,
      unitId: e.unitId,
      workLocationId: e.workLocationId ?? '',
      positionId: e.positionId,
      bank: e.bank,
      accountNumber: e.accountNumber,
      hourlyRate: String(hourlyRateFor(e, today())),
      birthDate: e.birthDate ?? '',
      retirementDateOverride: e.retirementDateOverride ?? '',
      pensionOverrideReason: e.pensionOverrideReason ?? '',
      employmentStatus: e.employmentStatus,
      statusReason: e.statusReason ?? '',
      statusReasonNote: e.statusReasonNote ?? '',
      statusEffectiveDate: e.statusEffectiveDate ?? '',
    })
    setTab('utama')
    setFormError('')
    setDetail({ mode: 'edit', row })
  }

  const openAdd = () => {
    const defaultUnitId =
      role === 'ulp'
        ? selectedPreviewUnitUuid
        : resolvedUnitUuids.filter((uuid) => uuid !== resolvedUp3Uuid)[0] ?? resolvedUp3Uuid ?? ''
    setForm(emptyForm(defaultUnitId, resolvedUp3Uuid))
    setTab('utama')
    setFormError('')
    setDetail({ mode: 'add', row: null })
  }

  const validate = () => {
    if (!form.name.trim()) return 'Nama wajib diisi.'
    if (!form.nip.trim()) return 'NIP wajib diisi.'
    if (form.workLocationId) {
      const location = locationById.get(form.workLocationId)
      if (!location || location.unitId !== form.unitId) {
        return 'Lokasi Penempatan tidak valid untuk unit ini.'
      }
    }
    if (form.employmentStatus === 'Nonaktif') {
      if (!form.statusReason) return 'Alasan Nonaktif wajib diisi.'
      if (form.statusReason === 'Lainnya' && !form.statusReasonNote.trim()) {
        return 'Keterangan wajib diisi untuk alasan Lainnya.'
      }
      if (!form.statusEffectiveDate) return 'Tanggal Efektif wajib diisi.'
    }
    return null
  }

  const proposedOf = () => ({
    nip: form.nip.trim(),
    name: form.name.trim(),
    up3Id: form.up3Id || resolvedUp3Uuid,
    unitId: form.unitId,
    workLocationId: form.workLocationId.trim() || null,
    positionId: form.positionId,
    sourcePosition: positionName(form.positionId),
    bank: form.bank,
    accountNumber: form.accountNumber.trim(),
    hourlyRate: Number(form.hourlyRate) || 0,
    birthDate: form.birthDate.trim(),
    retirementDateOverride: form.retirementDateOverride.trim() || null,
    pensionOverrideReason: form.pensionOverrideReason.trim() || null,
    employmentStatus: form.employmentStatus,
    statusReason: form.employmentStatus === 'Nonaktif' ? form.statusReason : null,
    statusReasonNote:
      form.employmentStatus === 'Nonaktif' ? form.statusReasonNote.trim() : null,
    statusEffectiveDate: form.employmentStatus === 'Nonaktif' ? form.statusEffectiveDate : null,
  })

  const submitChange = (mode) => {
    const error = validate()
    if (error) {
      setFormError(error)
      return
    }
    if (mode === 'edit' && detail.row.employee?.up3Id !== resolvedUp3Uuid) {
      setFormError('Pegawai berada di luar scope UP3 yang dipilih.')
      return
    }
    const proposed = proposedOf()
    const now = today()
    if (role === 'ulp') {
      onChangeRequestsChange([
        ...changeRequests,
        {
          id: `req-${Date.now().toString(36)}`,
          type: mode,
          employeeId: mode === 'edit' ? detail.row.employee.id : null,
          proposed,
          old: mode === 'edit' ? snapshotOf(detail.row.employee) : null,
          status: 'Pending',
          note: '',
          contractId: resolvedContractUuid,
          up3Id: resolvedUp3Uuid,
          sourceUnitId: mode === 'edit' ? detail.row.employee.unitId : unitId,
          targetUnitId: proposed.unitId,
          createdBy: 'Admin ULP',
          createdAt: now,
          decidedBy: null,
          decidedAt: null,
        },
      ])
      setDetail(null)
      return
    }
    if (mode === 'add') {
      const employee = buildNewEmployee({
        ...proposed,
        contractId: resolvedContractUuid,
        effectiveDate: now,
      })
      onEmployeesChange([...employees, employee])
      onChangeRequestsChange([
        ...changeRequests,
        {
          id: `req-${Date.now().toString(36)}`,
          type: 'add',
          employeeId: null,
          proposed,
          old: null,
          status: 'Approved',
          note: '',
          contractId: resolvedContractUuid,
          up3Id: resolvedUp3Uuid,
          sourceUnitId: null,
          targetUnitId: proposed.unitId,
          createdBy: 'Admin UP3',
          createdAt: now,
          decidedBy: 'Admin UP3',
          decidedAt: now,
        },
      ])
    } else {
      const employee = applyProposedChange(detail.row.employee, proposed, now)
      onEmployeesChange(
        employees.map((item) => (item.id === employee.id ? employee : item)),
      )
      onChangeRequestsChange([
        ...changeRequests,
        {
          id: `req-${Date.now().toString(36)}`,
          type: 'edit',
          employeeId: employee.id,
          proposed,
          old: snapshotOf(detail.row.employee),
          status: 'Approved',
          note: '',
          contractId: resolvedContractUuid,
          up3Id: resolvedUp3Uuid,
          sourceUnitId: detail.row.employee.unitId,
          targetUnitId: proposed.unitId,
          createdBy: 'Admin UP3',
          createdAt: now,
          decidedBy: 'Admin UP3',
          decidedAt: now,
        },
      ])
    }
    setDetail(null)
  }

  const submitPensionPolicy = () => {
    const age = Number(pensionForm.retirementAge)
    const start = pensionForm.periodStart.trim()
    if (!Number.isFinite(age) || age < 1) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return
    onPensionPoliciesChange(
      changePensionPolicy(
        pensionPolicies,
        contractScope.contractId,
        up3Id,
        {
          retirementAge: age,
          periodStart: start,
          keterangan: pensionForm.keterangan.trim(),
        },
        pensionPolicy,
      ),
    )
    setPensionForm({ retirementAge: '', periodStart: start, keterangan: '' })
  }

  const approveRequest = (req) => {
    if (
      role !== 'up3' ||
      req.status !== 'Pending' ||
      req.contractId !== resolvedContractUuid ||
      req.up3Id !== resolvedUp3Uuid
    ) {
      return
    }
    const now = today()
    if (req.type === 'add') {
      const employee = buildNewEmployee({
        ...req.proposed,
        contractId: req.contractId ?? resolvedContractUuid,
        up3Id: req.up3Id ?? resolvedUp3Uuid,
        effectiveDate: now,
      })
      onEmployeesChange([...employees, employee])
    } else {
      const employee = applyProposedChange(
        employees.find((item) => item.id === req.employeeId),
        req.proposed,
        now,
      )
      onEmployeesChange(employees.map((item) => (item.id === employee.id ? employee : item)))
    }
    onChangeRequestsChange(
      changeRequests.map((item) =>
        item.id === req.id
          ? { ...item, status: 'Approved', decidedBy: 'Admin UP3', decidedAt: now }
          : item,
      ),
    )
  }

  const rejectRequest = (req) => {
    if (
      role !== 'up3' ||
      req.status !== 'Pending' ||
      req.contractId !== resolvedContractUuid ||
      req.up3Id !== resolvedUp3Uuid
    ) {
      return
    }
    const note = rejectNotes[req.id]?.trim()
    if (!note) return
    onChangeRequestsChange(
      changeRequests.map((item) =>
        item.id === req.id
          ? { ...item, status: 'Rejected', note, decidedBy: 'Admin UP3', decidedAt: today() }
          : item,
      ),
    )
  }

  const pendingRequests = changeRequests
    .filter(
      (req) =>
        req.status === 'Pending' &&
        req.contractId === resolvedContractUuid &&
        req.up3Id === resolvedUp3Uuid &&
        scopedUnitIds.includes(req.proposed.unitId),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))

  const diffSummary = (oldSnap, proposed) => {
    const labels = {
      nip: 'NIP',
      name: 'Nama',
      unitId: 'Unit',
      workLocationId: 'Lokasi Penempatan',
      positionId: 'Jabatan',
      bank: 'Bank',
      accountNumber: 'No Rekening',
      hourlyRate: 'Tarif/Jam',
      birthDate: 'Tgl Lahir',
      retirementDateOverride: 'Tgl Pensiun (Override)',
      pensionOverrideReason: 'Keterangan Override',
      employmentStatus: 'Status',
      statusReason: 'Alasan',
      statusEffectiveDate: 'Tgl Efektif',
    }
    const format = (key, value) =>
      key === 'unitId'
        ? unitName(value)
        : key === 'positionId'
          ? (positionName(value) ?? 'Belum Ditentukan')
          : key === 'workLocationId'
            ? value
              ? (locationName(value) ?? 'Belum Ditentukan')
              : 'Belum ditentukan'
            : value
    return Object.keys(labels)
      .filter((key) => oldSnap[key] !== proposed[key])
      .map(
        (key) =>
          `${labels[key]}: ${format(key, oldSnap[key] ?? '\u2014')} \u2192 ${format(key, proposed[key] ?? '\u2014')}`,
      )
  }

  const requestsOfEmployee = (employeeId, nip) =>
    changeRequests.filter(
      (req) =>
        req.contractId === resolvedContractUuid &&
        req.up3Id === resolvedUp3Uuid &&
        ((req.type === 'edit' && req.employeeId === employeeId) ||
          (req.type === 'add' && req.proposed.nip === nip)),
    )

  const renderTabContent = () => {
    if (tab === 'riwayat') return renderRiwayat()
    if (tab === 'approval') return renderApprovalTab()
    if (tab === 'pembayaran') return renderPembayaran()
    return renderUtama()
  }

  const renderUtama = () => {
    const editing = detail.mode !== 'view'
    if (!editing) {
      const data = detail.row.employee ?? detail.row.request.proposed
      const policyAge = pensionPolicy?.retirementAge ?? 56
      const age = ageAt(data.birthDate, todayStr)
      const retirementAgeDate = data.birthDate
        ? retirementAgeDateFor(data.birthDate, policyAge)
        : null
      const lastWorking = data.birthDate
        ? lastWorkingDateFor(data.birthDate, policyAge)
        : null
      const pension = pensionStateOf(data, todayStr, pensionPolicy)
      const monthsLeft = pension.retirementDate
        ? monthsBetween(todayStr, pension.retirementDate)
        : null
      const hasOverride = Boolean(data.retirementDateOverride)
      const effectiveDateShown = hasOverride
        ? data.retirementDateOverride
        : retirementEffectiveDateFor(data.birthDate, policyAge)
      return (
        <div className="sla-detail-fields">
          <Field label="NIP" value={data.nip} />
          <Field label="Nama" value={data.name} />
          <Field label="UP3" value={unitName(data.up3Id) || unitName(up3Unit?.id) || up3Id} />
          <Field label="Unit" value={unitName(data.unitId)} />
          <Field
            label="Lokasi Penempatan"
            value={
              data.workLocationId
                ? (locationName(data.workLocationId) ?? 'Belum Ditentukan')
                : 'Belum ditentukan'
            }
          />
          <Field label="Jabatan" value={positionName(data.positionId) ?? 'Belum Ditentukan'} />
          <Field label="Status Pegawai" value={data.employmentStatus} />
          {data.employmentStatus === 'Nonaktif' && (
            <>
              <Field label="Alasan Nonaktif" value={data.statusReason ?? '\u2014'} />
              <Field label="Keterangan" value={data.statusReasonNote || '\u2014'} />
              <Field label="Tanggal Efektif" value={data.statusEffectiveDate ?? '\u2014'} />
            </>
          )}
          <Field label="Tanggal Lahir" value={data.birthDate || '\u2014'} />
          <Field label="Usia Saat Ini" value={age == null ? '\u2014' : `${age} tahun`} />
          <Field label="Memenuhi Usia Pensiun" value={retirementAgeDate ?? '\u2014'} />
          <Field label="Terakhir Bekerja" value={hasOverride ? '\u2014' : (lastWorking ?? '\u2014')} />
          <Field label="Efektif Pensiun" value={effectiveDateShown ?? '\u2014'} />
          <Field
            label="Sisa Masa Kerja"
            value={
              monthsLeft == null ? '\u2014' : monthsLeft <= 0 ? '0 bulan' : `${monthsLeft} bulan`
            }
          />
          <div className="sla-context-field">
            <span className="sla-context-label">Kondisi Pensiun</span>
            {pension.state ? (
              <span className={`sla-status-badge ${PENSION_BADGE[pension.state]}`}>
                {pension.state}
              </span>
            ) : (
              <span className="sla-detail-value">{'\u2014'}</span>
            )}
          </div>
          {hasOverride && (
            <Field
              label="Override Tgl Pensiun"
              value={`${data.retirementDateOverride} (${data.pensionOverrideReason || 'tanpa keterangan'})`}
            />
          )}
        </div>
      )
    }
    return (
      <div className="sla-detail-fields">
        <div className="sla-context-field">
          <span className="sla-context-label">NIP</span>
          <input
            className={inputClass}
            value={form.nip}
            onChange={(e) => setForm((prev) => ({ ...prev, nip: e.target.value }))}
          />
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Nama</span>
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          />
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Unit</span>
          <select
            className="sla-context-select"
            value={form.unitId}
            disabled={role === 'ulp'}
            onChange={(e) =>
              setForm((prev) => {
                const nextUnitId = e.target.value
                const location = prev.workLocationId
                  ? locationById.get(prev.workLocationId)
                  : null
                return {
                  ...prev,
                  unitId: nextUnitId,
                  workLocationId:
                    location && location.unitId === nextUnitId ? prev.workLocationId : '',
                }
              })
            }
          >
            {scopeUnitIds.map((u) => (
              <option key={u} value={u}>
                {unitName(u)}
              </option>
            ))}
          </select>
          {role === 'ulp' && (
            <span className="sla-table-hint">Terikat unit login Admin ULP</span>
          )}
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Lokasi Penempatan</span>
          <select
            className="sla-context-select"
            value={form.workLocationId}
            onChange={(e) => setForm((prev) => ({ ...prev, workLocationId: e.target.value }))}
          >
            <option value="">Belum ditentukan</option>
            {locationOptionsFor(form.unitId).map((l) => (
              <option key={l.id} value={l.id}>
                {locationName(l.id)}
              </option>
            ))}
          </select>
          {role === 'ulp' && (
            <span className="sla-table-hint">
              Perpindahan Kantor Jaga dalam unit ini akan menjadi pengajuan Pending
              Approval. Transfer antar-ULP hanya Admin UP3.
            </span>
          )}
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Jabatan (Master Jabatan)</span>
          <select
            className="sla-context-select"
            value={form.positionId}
            onChange={(e) => setForm((prev) => ({ ...prev, positionId: e.target.value }))}
          >
            {scopedJabatan.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Status Pegawai</span>
          <select
            className="sla-context-select"
            value={form.employmentStatus}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, employmentStatus: e.target.value }))
            }
          >
            <option value="Aktif">Aktif</option>
            <option value="Nonaktif">Nonaktif</option>
          </select>
        </div>
        {form.employmentStatus === 'Nonaktif' && (
          <>
            <div className="sla-context-field">
              <span className="sla-context-label">Alasan Nonaktif</span>
              <select
                className="sla-context-select"
                value={form.statusReason}
                onChange={(e) => setForm((prev) => ({ ...prev, statusReason: e.target.value }))}
              >
                <option value="">Pilih alasan</option>
                {STATUS_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </div>
            {form.statusReason === 'Lainnya' && (
              <div className="sla-context-field">
                <span className="sla-context-label">Keterangan (wajib)</span>
                <input
                  className={inputClass}
                  value={form.statusReasonNote}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, statusReasonNote: e.target.value }))
                  }
                />
              </div>
            )}
            <div className="sla-context-field">
              <span className="sla-context-label">Tanggal Efektif (YYYY-MM-DD)</span>
              <input
                className={inputClass}
                value={form.statusEffectiveDate}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, statusEffectiveDate: e.target.value }))
                }
              />
            </div>
          </>
        )}
        <div className="sla-context-field">
          <span className="sla-context-label">Tanggal Lahir (YYYY-MM-DD)</span>
          <input
            className={inputClass}
            value={form.birthDate}
            onChange={(e) => setForm((prev) => ({ ...prev, birthDate: e.target.value }))}
          />
        </div>
        {role === 'up3' && (
          <>
            <div className="sla-context-field">
              <span className="sla-context-label">Override Tanggal Pensiun (kosongkan = standar)</span>
              <input
                className={inputClass}
                value={form.retirementDateOverride}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, retirementDateOverride: e.target.value }))
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Keterangan Override</span>
              <input
                className={inputClass}
                value={form.pensionOverrideReason}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, pensionOverrideReason: e.target.value }))
                }
              />
            </div>
          </>
        )}
        {role === 'ulp' && (
          <p className="sla-table-hint">
            Perpanjangan/override tanggal pensiun hanya dapat dilakukan Admin UP3.
          </p>
        )}
      </div>
    )
  }

  const renderPembayaran = () => {
    const editing = detail.mode !== 'view'
    const data = detail.row.employee ?? detail.row.request.proposed
    const currentRate = data.hourlyRateHistory
      ? hourlyRateFor(data, today())
      : data.hourlyRate
    if (!editing) {
      return (
        <div className="sla-detail-fields">
          <Field label="Bank" value={data.bank || '\u2014'} />
          <Field label="No Rekening" value={data.accountNumber || '\u2014'} />
          <Field
            label="Tarif Lembur/Jam aktif"
            value={`Rp ${Number(currentRate || 0).toLocaleString('id-ID')}`}
          />
        </div>
      )
    }
    return (
      <div className="sla-detail-fields">
        <div className="sla-context-field">
          <span className="sla-context-label">Bank</span>
          <select
            className="sla-context-select"
            value={form.bank}
            onChange={(e) => setForm((prev) => ({ ...prev, bank: e.target.value }))}
          >
            {BANKS.map((bank) => (
              <option key={bank} value={bank}>
                {bank}
              </option>
            ))}
          </select>
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">No Rekening</span>
          <input
            className={inputClass}
            value={form.accountNumber}
            onChange={(e) => setForm((prev) => ({ ...prev, accountNumber: e.target.value }))}
          />
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Tarif Lembur/Jam (Rupiah)</span>
          <input
            className={inputClass}
            value={form.hourlyRate}
            onChange={(e) => setForm((prev) => ({ ...prev, hourlyRate: e.target.value }))}
          />
        </div>
      </div>
    )
  }

  const renderRiwayat = () => {
    const data = detail.row.employee ?? detail.row.request.proposed
    if (!data.unitHistory) {
      return <p className="sla-flat-note">Belum ada riwayat (menunggu approval).</p>
    }
    const historyBlock = (title, entries, formatEntry) =>
      entries.length ? (
        <div className="sla-history-list">
          <strong>{title}</strong>
          {entries.map((entry) => (
            <div key={entry.id}>
              {formatEntry(entry)} — {formatPeriod(entry.validFrom, entry.validTo)}
            </div>
          ))}
        </div>
      ) : (
        <div className="sla-history-list">
          <strong>{title}</strong>
          <div>{'\u2014'}</div>
        </div>
      )
    return (
      <div className="sla-history-grid">
        {historyBlock('Riwayat Unit', data.unitHistory, (e) => unitName(e.unitId))}
        {historyBlock(
          'Riwayat Lokasi Penempatan',
          data.workLocationHistory ?? [],
          (e) => (e.workLocationId ? locationName(e.workLocationId) : 'Belum ditentukan'),
        )}
        {historyBlock('Riwayat Jabatan', data.positionHistory, (e) => positionName(e.positionId))}
        {historyBlock('Riwayat Tarif Lembur', data.hourlyRateHistory, (e) =>
          `Rp ${Number(e.rate || 0).toLocaleString('id-ID')}/jam`,
        )}
        {historyBlock(
          'Riwayat Status (efektif)',
          effectiveStatusHistoryOf(data, pensionPolicy),
          (e) =>
            `${e.status}${e.reason ? ` (${e.reason}${e.note ? `: ${e.note}` : ''})` : ''}${e.effectiveDate ? ` — efektif ${e.effectiveDate}` : ''}${e.derived ? ' — otomatis' : ''}`,
        )}
      </div>
    )
  }

  const renderApprovalTab = () => {
    const data = detail.row.employee ?? detail.row.request.proposed
    if (detail.row.addPending) {
      return (
        <div className="sla-approval-req">
          <RequestMeta req={detail.row.request} />
          <div className="sla-detail-fields">
            <Field label="NIP" value={data.nip} />
            <Field label="Nama" value={data.name} />
            <Field label="Unit" value={unitName(data.unitId)} />
            <Field
              label="Lokasi Penempatan"
              value={data.workLocationId ? locationName(data.workLocationId) : 'Belum ditentukan'}
            />
          <Field label="Jabatan" value={positionName(data.positionId) ?? 'Belum Ditentukan'} />
            <Field label="Bank" value={data.bank} />
            <Field label="No Rekening" value={data.accountNumber} />
            <Field label="Tarif/Jam" value={`Rp ${Number(data.hourlyRate || 0).toLocaleString('id-ID')}`} />
          </div>
        </div>
      )
    }
    const requests = requestsOfEmployee(data.id, data.nip)
    if (!requests.length) {
      return <p className="sla-flat-note">Belum ada pengajuan approval.</p>
    }
    return (
      <div className="sla-history-grid">
        {requests.map((req) => (
          <div key={req.id} className="sla-approval-req">
            <RequestMeta req={req} />
            {req.type === 'edit' && req.old && (
              <div className="sla-history-list">
                <strong>Data lama {'\u2192'} Data baru</strong>
                {diffSummary(req.old, req.proposed).map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            )}
            {req.note && (
              <p className="sla-table-hint">Catatan: {req.note}</p>
            )}
          </div>
        ))}
      </div>
    )
  }

  const RequestMeta = ({ req }) => (
    <>
      <div className="sla-approval-meta">
        <span>
          {req.type === 'add' ? 'Tambah Pegawai' : 'Edit Pegawai'} —{' '}
          {req.proposed.nip} ({req.proposed.name})
        </span>
        <span
          className={`sla-status-badge ${
            req.status === 'Approved'
              ? 'sla-status-active'
              : req.status === 'Rejected'
                ? 'sla-status-rejected'
                : 'sla-status-draft'
          }`}
        >
          {req.status}
        </span>
      </div>
      <p className="sla-table-hint">
        Diajukan oleh {req.createdBy} pada {req.createdAt}
        {req.decidedBy && ` · Diputuskan oleh ${req.decidedBy} pada ${req.decidedAt}`}
      </p>
    </>
  )

  const Field = ({ label, value }) => (
    <div className="sla-context-field">
      <span className="sla-context-label">{label}</span>
      <span className="sla-detail-value">{value}</span>
    </div>
  )

  return (
    <section className="sla-settings">
      <div className="sla-settings-toolbar">
        <h2 className="sla-settings-title">Master Pegawai</h2>
        {scopedUnitIds.length > 0 && (
          <button type="button" className="sla-btn" onClick={exportMasterPegawai}>
            Export Excel
          </button>
        )}
        <button type="button" className="sla-btn sla-btn-primary" onClick={openAdd}>
          Tambah Pegawai
        </button>
        <span className="sla-status-badge sla-status-active">Supabase</span>
      </div>
      <p className="sla-flat-note">
        Data TAD Pelayanan Teknik (Supabase, NIP sebagai kunci stabil) untuk kontrak{' '}
        {contractScope.contractName}. Unit/jabatan di-resolve dari Master
        Organisasi/Master Jabatan via unitId/positionId. Tarif Lembur/Jam
        disimpan sebagai histori. Admin ULP hanya mengelola unit sendiri dan
        perubahannya menjadi Pending Approval; perpindahan antar-ULP hanya Admin
        UP3. Penambahan/edit pegawai masih disimpan di state lokal (prototype).
      </p>
      {orgMap?.warning && (
        <p className="sla-blocked-note">
          Nama organisasi Supabase tidak dapat dimuat: {orgMap.warning}
        </p>
      )}

      {role === 'up3' && (
        <div className="sla-master-actions" style={{ marginBottom: '12px' }}>
          <button
            type="button"
            className="sla-btn"
            onClick={() => setPensionOpen((prev) => !prev)}
          >
            {pensionOpen ? 'Tutup Pengaturan Pensiun' : 'Pengaturan Pensiun'}
          </button>
        </div>
      )}

      {role === 'up3' && pensionOpen && (
        <div className="sla-approval-panel">
          <h3 className="sla-settings-title">Kebijakan Pensiun</h3>
          {pensionPolicy ? (
            <p className="sla-flat-note">
              Kebijakan aktif: usia pensiun{' '}
              <strong>{pensionPolicy.retirementAge} tahun</strong> — berlaku{' '}
              {pensionPolicy.periodStart ?? 'sejak awal'} s.d.{' '}
              {pensionPolicy.periodEnd ?? 'sekarang'}.
            </p>
          ) : (
            <p className="sla-flat-note">Belum ada kebijakan pensiun aktif.</p>
          )}
          <div className="sla-sign-group-head">
            <div className="sla-context-field">
              <span className="sla-context-label">Usia pensiun baru (tahun)</span>
              <input
                className={inputClass}
                value={pensionForm.retirementAge}
                onChange={(e) =>
                  setPensionForm((prev) => ({ ...prev, retirementAge: e.target.value }))
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Berlaku mulai (YYYY-MM-DD)</span>
              <input
                className={inputClass}
                value={pensionForm.periodStart}
                onChange={(e) =>
                  setPensionForm((prev) => ({ ...prev, periodStart: e.target.value }))
                }
              />
            </div>
            <div className="sla-context-field">
              <span className="sla-context-label">Keterangan</span>
              <input
                className={inputClass}
                value={pensionForm.keterangan}
                onChange={(e) =>
                  setPensionForm((prev) => ({ ...prev, keterangan: e.target.value }))
                }
              />
            </div>
            <div className="sla-master-actions">
              <button type="button" className="sla-btn sla-btn-primary" onClick={submitPensionPolicy}>
                Simpan Kebijakan
              </button>
            </div>
          </div>
          <div className="sla-history-list">
            <strong>Histori kebijakan</strong>
            {pensionPolicies
              .filter(
                (p) =>
                  p.contractId === contractScope.contractId &&
                  (p.up3Id == null || p.up3Id === up3Id),
              )
              .map((p) => (
                <div key={p.id}>
                  {p.retirementAge} tahun — {p.periodStart ?? 'sejak awal'} s.d.{' '}
                  {p.periodEnd ?? 'sekarang'}
                  {p.keterangan ? ` (${p.keterangan})` : ''} — {p.status}
                </div>
              ))}
          </div>
        </div>
      )}

      {detail && (
        <div className="sla-sign-group sla-pegawai-detail">
          <div className="sla-sign-group-head">
            <h3 className="sla-settings-title">
              {detail.mode === 'add'
                ? 'Tambah Pegawai'
                : `${detail.mode === 'edit' ? 'Edit Pegawai' : 'Detail Pegawai'} \u2014 ${(detail.row.employee ?? detail.row.request.proposed).nip}`}
            </h3>
            <div className="sla-master-actions">
              {detail.mode === 'view' && !detail.row.addPending && (
                <button type="button" className="sla-btn" onClick={() => openEdit(detail.row)}>
                  Edit
                </button>
              )}
              <button type="button" className="sla-btn" onClick={() => setDetail(null)}>
                Tutup
              </button>
            </div>
          </div>
          <div className="sla-detail-tabs">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                className={`sla-detail-tab ${tab === key ? 'sla-detail-tab-active' : ''}`}
                onClick={() => setTab(key)}
              >
                {TAB_LABEL[key]}
              </button>
            ))}
          </div>
          {formError && <p className="sla-blocked-note">{formError}</p>}
          {renderTabContent()}
          {detail.mode !== 'view' && (
            <>
              {role === 'ulp' && (
                <p className="sla-table-hint">
                  Perubahan akan dikirim sebagai pengajuan dan menjadi data resmi
                  setelah disetujui Admin UP3.
                </p>
              )}
              <div className="sla-master-actions">
                <button
                  type="button"
                  className="sla-btn sla-btn-primary"
                  onClick={() => submitChange(detail.mode)}
                >
                  {detail.mode === 'add' ? 'Simpan Pegawai' : 'Simpan Perubahan'}
                </button>
                <button type="button" className="sla-btn" onClick={() => setDetail(null)}>
                  Batal
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {role === 'up3' && pendingRequests.length > 0 && (
        <div className="sla-approval-panel">
          <h3 className="sla-settings-title">
            Pengajuan Approval ({pendingRequests.length})
          </h3>
          {pendingRequests.map((req) => (
            <div key={req.id} className="sla-approval-req">
              <RequestMeta req={req} />
              <div className="sla-history-list">
                <strong>Data lama {'\u2192'} Data baru</strong>
                {req.type === 'edit' && req.old
                  ? diffSummary(req.old, req.proposed).map((line) => (
                      <div key={line}>{line}</div>
                    ))
                  : `Tambah pegawai baru: ${req.proposed.name} (${req.proposed.nip}) — unit ${unitName(req.proposed.unitId)}, jabatan ${positionName(req.proposed.positionId)}, tarif Rp ${Number(req.proposed.hourlyRate || 0).toLocaleString('id-ID')}/jam`}
              </div>
              <div className="sla-master-actions">
                <div className="sla-context-field">
                  <span className="sla-context-label">Catatan (wajib untuk Reject)</span>
                  <input
                    className={inputClass}
                    value={rejectNotes[req.id] ?? ''}
                    onChange={(e) =>
                      setRejectNotes((prev) => ({ ...prev, [req.id]: e.target.value }))
                    }
                  />
                </div>
                <button type="button" className="sla-btn sla-btn-primary" onClick={() => approveRequest(req)}>
                  Approve
                </button>
                <button type="button" className="sla-btn" onClick={() => rejectRequest(req)}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="sla-pegawai-filters">
        <div className="sla-context-field">
          <span className="sla-context-label">Cari Nama/NIP</span>
          <input
            className={inputClass}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              resetPage()
            }}
          />
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Jabatan</span>
          <select
            className="sla-context-select"
            value={filterJabatan}
            onChange={(e) => {
              setFilterJabatan(e.target.value)
              resetPage()
            }}
          >
            <option value="">Semua</option>
            {scopedJabatan.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Status</span>
          <select
            className="sla-context-select"
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value)
              resetPage()
            }}
          >
            <option value="">Semua</option>
            <option value="Aktif">Aktif</option>
            <option value="Nonaktif">Nonaktif</option>
          </select>
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Pensiun</span>
          <select
            className="sla-context-select"
            value={filterPension}
            onChange={(e) => {
              setFilterPension(e.target.value)
              resetPage()
            }}
          >
            <option value="">Semua</option>
            <option value="aktif">Aktif</option>
            <option value="mendekati-pensiun">Mendekati Pensiun</option>
            <option value="pensiun">Pensiun</option>
          </select>
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Lokasi Penempatan</span>
          <select
            className="sla-context-select"
            value={filterLocation}
            onChange={(e) => {
              setFilterLocation(e.target.value)
              resetPage()
            }}
          >
            <option value="">Semua</option>
            {filterLocationOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sla-context-field">
          <span className="sla-context-label">Approval</span>
          <select
            className="sla-context-select"
            value={filterApproval}
            onChange={(e) => {
              setFilterApproval(e.target.value)
              resetPage()
            }}
          >
            <option value="">Semua</option>
            <option value="Approved">Approved</option>
            <option value="Pending">Pending</option>
          </select>
        </div>
        {role === 'up3' && (
          <div className="sla-context-field">
            <span className="sla-context-label">Unit</span>
            <select
              className="sla-context-select"
              value={filterUnit}
              onChange={(e) => {
                setFilterUnit(e.target.value)
                resetPage()
              }}
            >
              <option value="">Semua</option>
              {scopeUnitIds.map((u) => (
                <option key={u} value={u}>
                  {unitName(u)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="sla-preview-scroll">
        <table className="sla-preview-table">
          <thead>
            <tr>
              <th>NIP</th>
              <th>Nama</th>
              <th>Unit</th>
              <th>Lokasi Penempatan</th>
              <th>Jabatan</th>
              <th>Tgl Lahir</th>
              <th>Masa Pensiun</th>
              <th>Bank</th>
              <th>No Rekening</th>
              <th>Status</th>
              <th>Approval</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const data = row.employee ?? row.request.proposed
              const pension = pensionStateOf(data, todayStr, pensionPolicy)
              const pensionMonths = pension.retirementDate
                ? monthsBetween(todayStr, pension.retirementDate)
                : null
              return (
                <tr key={row.key}>
                  <td>{data.nip}</td>
                  <td>
                    <button
                      type="button"
                      className="sla-link"
                      onClick={() => openDetail(row)}
                    >
                      {data.name}
                    </button>
                  </td>
                  <td>{unitName(data.unitId)}</td>
                  <td>
                    {data.workLocationId ? (
                      locationName(data.workLocationId) ?? (
                        <span className="sla-status-badge sla-status-draft">Belum Ditentukan</span>
                      )
                    ) : (
                      <span className="sla-status-badge sla-status-draft">Belum ditentukan</span>
                    )}
                  </td>
                  <td>
                    {positionName(data.positionId) ?? (
                      <span className="sla-status-badge sla-status-draft">Belum Ditentukan</span>
                    )}
                    {data.sourcePosition && data.sourcePosition !== (positionName(data.positionId) ?? '') && (
                      <div className="sla-table-sub">CSV: {data.sourcePosition}</div>
                    )}
                  </td>
                  <td>{data.birthDate || '\u2014'}</td>
                  <td>
                    {pension.state ? (
                      <>
                        <span className={`sla-status-badge ${PENSION_BADGE[pension.state]}`}>
                          {pension.state}
                        </span>
                        {pension.state !== 'Normal' && pension.state !== 'Pensiun' && (
                          <div className="sla-table-sub">
                            {pensionMonths == null || pensionMonths <= 0
                              ? '0 bulan'
                              : `${pensionMonths} bln`}
                          </div>
                        )}
                      </>
                    ) : (
                      '\u2014'
                    )}
                  </td>
                  <td>{data.bank || '\u2014'}</td>
                  <td>{data.accountNumber || '\u2014'}</td>
                  <td>
                    <span
                      className={`sla-status-badge ${data.employmentStatus === 'Aktif' ? 'sla-status-active' : 'sla-status-archive'}`}
                    >
                      {data.employmentStatus}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`sla-status-badge ${approvalOf(row) === 'Approved' ? 'sla-status-active' : 'sla-status-draft'}`}
                    >
                      {approvalOf(row)}
                    </span>
                  </td>
                  <td>
                    <div className="sla-master-actions">
                      <button type="button" className="sla-btn" onClick={() => openDetail(row)}>
                        Detail
                      </button>
                      {!row.addPending && (
                        <button type="button" className="sla-btn" onClick={() => openEdit(row)}>
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {!visibleRows.length && (
              <tr>
                <td colSpan={12} className="sla-table-hint">
                  Tidak ada pegawai yang cocok dengan filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="sla-pagination">
        <button
          type="button"
          className="sla-btn"
          disabled={currentPage <= 1}
          onClick={() => setPage((prev) => prev - 1)}
        >
          &lsaquo; Sebelumnya
        </button>
        <span className="sla-table-hint">
          Hal {currentPage} dari {pageCount} ({filtered.length} pegawai)
        </span>
        <button
          type="button"
          className="sla-btn"
          disabled={currentPage >= pageCount}
          onClick={() => setPage((prev) => prev + 1)}
        >
          Berikutnya &rsaquo;
        </button>
      </div>
    </section>
  )
}
