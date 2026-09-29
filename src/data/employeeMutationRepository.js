import { supabase } from '../lib/supabaseClient.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const LEGACY_POSITION_TO_NAME = {
  'jab-koord-up3': 'Koordinator UP3',
  'jab-koord-ulp': 'Koordinator ULP',
  'jab-koord-k3-ulp': 'Koordinator K3 ULP',
  'jab-petugas-yantek': 'Petugas Pelayanan Teknik',
  'jab-petugas-ulc': 'Petugas ULC',
  'jab-petugas-var-row': 'Petugas Variable ROW',
  'jab-petugas-var-hardukon': 'Petugas Variable HARDUKON',
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

function norm(value) {
  return String(value ?? '').trim()
}

function normLower(value) {
  return norm(value).toLowerCase()
}

function toDateOrNull(value) {
  const v = norm(value)
  if (!v) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`Tanggal tidak valid (gunakan YYYY-MM-DD): ${value}`)
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) throw new Error(`Tanggal tidak valid: ${value}`)
  return v
}

function toNumberOrZero(value) {
  if (value === '' || value == null) return 0
  const n = Number(String(value).replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.'))
  // fallback: if thousands separator handling above breaks decimals, use direct parse
  const direct = Number(value)
  const parsed = Number.isFinite(n) ? n : direct
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Tarif tidak valid: ${value}`)
  return parsed
}

export function resolvePositionUuid(positionIdOrName, { positions = [], jabatanById = new Map() } = {}) {
  const raw = norm(positionIdOrName)
  if (!raw) return null
  if (isUuid(raw)) {
    if (positions.some((p) => p.id === raw)) return raw
    return raw
  }
  const legacyName = LEGACY_POSITION_TO_NAME[raw]
  const targetName = legacyName ?? raw
  const byName = positions.find((p) => normLower(p.name) === normLower(targetName))
  if (byName) return byName.id
  const jabatan = jabatanById.get(raw)
  if (jabatan) {
    const again = positions.find((p) => normLower(p.name) === normLower(jabatan.name))
    if (again) return again.id
  }
  // fuzzy: contains
  const fuzzy = positions.find((p) => normLower(p.name).includes(normLower(targetName)) || normLower(targetName).includes(normLower(p.name)))
  return fuzzy?.id ?? null
}

export function resolveUnitUuid(unitInput, { orgMap = null, units = [] } = {}) {
  const raw = norm(unitInput)
  if (!raw) return null
  if (isUuid(raw)) return raw
  const lower = normLower(raw)
  if (orgMap?.units) {
    const found = orgMap.units.find(
      (u) => normLower(u.displayName) === lower || normLower(u.legacyKey) === lower || normLower(u.uuid) === lower,
    )
    if (found) return found.uuid
  }
  const local = units.find((u) => normLower(u.id) === lower)
  if (local && isUuid(local.id)) return local.id
  return null
}

export function resolveLocationUuid(locationInput, { locations = [], unitId = null } = {}) {
  const raw = norm(locationInput)
  if (!raw) return null
  if (isUuid(raw)) return raw
  const lower = normLower(raw)
  const scoped = unitId ? locations.filter((l) => l.unitId === unitId || l.id === unitId) : locations
  const pool = scoped.length ? scoped : locations
  const found = pool.find((l) => {
    const names = [l.id, l.legacyKey, l.legacy_key, ...(l.nameHistory ?? []).map((h) => h.name)]
    return names.some((n) => normLower(n) === lower)
  })
  return found?.id ?? null
}

/**
 * Map frontend proposed (unitId/positionId/workLocationId legacy-or-uuid) to RPC jsonb.
 */
export function toRpcProposed(frontProposed, ctx = {}) {
  const positionUuid = resolvePositionUuid(frontProposed.positionId ?? frontProposed.jabatan ?? frontProposed.jabatan_id, ctx)
  const unitUuid = resolveUnitUuid(frontProposed.unitId ?? frontProposed.unit_id ?? frontProposed.unit, ctx) ?? frontProposed.unitId ?? null
  const locationUuid =
    resolveLocationUuid(frontProposed.workLocationId ?? frontProposed.lokasi_id ?? frontProposed.lokasi_penempatan ?? frontProposed.lokasi, {
      locations: ctx.locations ?? [],
      unitId: unitUuid,
    }) ?? (isUuid(frontProposed.workLocationId) ? frontProposed.workLocationId : null)

  return {
    nip: norm(frontProposed.nip),
    name: norm(frontProposed.name),
    unit_id: unitUuid,
    position_id: positionUuid,
    location_id: locationUuid,
    bank: norm(frontProposed.bank),
    account_number: norm(frontProposed.accountNumber ?? frontProposed.no_rekening ?? frontProposed.account_number),
    hourly_rate: frontProposed.hourlyRate ?? frontProposed.tarif_lembur_jam ?? frontProposed.hourly_rate ?? 0,
    birth_date: norm(frontProposed.birthDate ?? frontProposed.tanggal_lahir ?? frontProposed.birth_date),
    retirement_date_override: norm(frontProposed.retirementDateOverride ?? frontProposed.override_tanggal_pensiun ?? ''),
    pension_override_reason: norm(frontProposed.pensionOverrideReason ?? frontProposed.keterangan_override_pensiun ?? ''),
    source_position: norm(frontProposed.sourcePosition ?? frontProposed.jabatan ?? ''),
    employment_status: norm(frontProposed.employmentStatus ?? frontProposed.status ?? 'Aktif') || 'Aktif',
    status_reason: norm(frontProposed.statusReason ?? frontProposed.alasan_nonaktif ?? frontProposed.status_reason ?? '') || null,
    status_reason_note: norm(frontProposed.statusReasonNote ?? frontProposed.keterangan_nonaktif ?? '') || null,
    status_effective_date: norm(frontProposed.statusEffectiveDate ?? frontProposed.tanggal_efektif_status ?? '') || null,
  }
}

function mapRpcError(error) {
  const msg = error?.message ?? ''
  if (msg.includes('NIP sudah digunakan')) return msg
  if (msg.includes('Hanya Admin UP3')) return 'Hanya Admin UP3 / Super Admin yang boleh approve/reject.'
  if (msg.includes('Admin ULP hanya')) return msg
  if (msg.includes('transfer antar-ULP') || msg.includes('pindah unit')) return msg
  if (msg.includes('Tidak berhak')) return 'Anda tidak berhak untuk unit ini.'
  if (msg.includes('Catatan wajib')) return 'Catatan wajib diisi untuk Reject.'
  if (msg.includes('Tanggal tidak valid') || msg.includes('YYYY-MM-DD')) return msg
  return msg || 'Gagal menyimpan pegawai.'
}

export function rpcSnapshotToUi(snap) {
  if (!snap) return null
  return {
    nip: snap.nip ?? '',
    name: snap.name ?? '',
    up3Id: snap.up3_id ?? snap.up3Id ?? '',
    unitId: snap.unit_id ?? snap.unitId ?? '',
    workLocationId: snap.location_id ?? snap.workLocationId ?? '',
    positionId: snap.position_id ?? snap.positionId ?? '',
    sourcePosition: snap.source_position ?? snap.sourcePosition ?? '',
    bank: snap.bank ?? '',
    accountNumber: snap.account_number ?? snap.accountNumber ?? '',
    hourlyRate: snap.hourly_rate ?? snap.hourlyRate ?? 0,
    birthDate: snap.birth_date ?? snap.birthDate ?? '',
    retirementDateOverride: snap.retirement_date_override ?? snap.retirementDateOverride ?? '',
    pensionOverrideReason: snap.pension_override_reason ?? snap.pensionOverrideReason ?? '',
    employmentStatus: snap.employment_status ?? snap.employmentStatus ?? 'Aktif',
    statusReason: snap.status_reason ?? snap.statusReason ?? '',
    statusReasonNote: snap.status_reason_note ?? snap.statusReasonNote ?? '',
    statusEffectiveDate: snap.status_effective_date ?? snap.statusEffectiveDate ?? '',
  }
}

export async function fetchEmployeeChangeRequests({ contractId, up3Id }) {
  const { data, error } = await supabase.rpc('list_employee_change_requests', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
  })
  if (error) throw new Error(mapRpcError(error))
  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.request_type,
    employeeId: row.employee_id,
    contractId: row.contract_id,
    up3Id: row.up3_id,
    sourceUnitId: row.source_unit_id,
    targetUnitId: row.target_unit_id,
    old: rpcSnapshotToUi(row.old_snapshot),
    proposed: rpcSnapshotToUi(row.proposed_snapshot),
    rawOld: row.old_snapshot,
    rawProposed: row.proposed_snapshot,
    status: row.status === 'Approved' ? 'Approved' : row.status === 'Rejected' ? 'Rejected' : 'Pending',
    note: row.note ?? '',
    createdBy: row.created_by_actor ?? 'Pengaju',
    createdAt: row.created_at ? String(row.created_at).slice(0, 10) : '',
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  }))
}

export async function fetchPensionPolicies({ contractId, up3Id }) {
  const { data, error } = await supabase
    .from('pension_policies')
    .select('id, contract_id, up3_id, retirement_age, status, note, effective_from, effective_to')
    .eq('contract_id', contractId)
    .eq('up3_id', up3Id)
    .order('effective_from', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: row.id,
    contractId: 'pelayanan-teknik',
    up3Id: 'up3',
    databaseContractId: row.contract_id,
    databaseUp3Id: row.up3_id,
    retirementAge: row.retirement_age,
    periodStart: row.effective_from,
    periodEnd: row.effective_to,
    status: row.status === 'active' ? 'Aktif' : row.status,
    keterangan: row.note ?? '',
  }))
}

export async function setPensionPolicy({ contractId, up3Id, retirementAge, periodStart, note }) {
  const { data, error } = await supabase.rpc('set_pension_policy', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_retirement_age: Number(retirementAge),
    p_period_start: periodStart,
    p_note: note ?? '',
  })
  if (error) throw new Error(mapRpcError(error))
  return data
}

export async function submitEmployeeChange({ requestType, employeeId, contractId, up3Id, sourceUnitId, targetUnitId, proposed }) {
  const { data, error } = await supabase.rpc('submit_employee_change_request', {
    p_request_type: requestType,
    p_employee_id: employeeId,
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_source_unit_id: sourceUnitId,
    p_target_unit_id: targetUnitId,
    p_proposed: proposed,
    p_old_snapshot: null,
  })
  if (error) throw new Error(mapRpcError(error))
  return data
}

export async function submitEmployeeEdit({ employee, proposed, contractId, up3Id }) {
  const oldSnapshot = {
    nip: employee.nip,
    name: employee.name,
    unit_id: employee.unitId,
    position_id: employee.positionId,
    location_id: employee.workLocationId,
    bank: employee.bank,
    account_number: employee.accountNumber,
    hourly_rate: employee.hourlyRate ?? 0,
    birth_date: employee.birthDate ?? '',
    retirement_date_override: employee.retirementDateOverride ?? '',
    pension_override_reason: employee.pensionOverrideReason ?? '',
    employment_status: employee.employmentStatus,
    status_reason: employee.statusReason,
    status_reason_note: employee.statusReasonNote,
    status_effective_date: employee.statusEffectiveDate,
  }
  return submitEmployeeChange({
    requestType: 'edit',
    employeeId: employee.id,
    contractId,
    up3Id,
    sourceUnitId: employee.unitId,
    targetUnitId: proposed.unit_id ?? proposed.unitId,
    proposed,
    // oldSnapshot stored server-side? RPC takes p_old_snapshot param; we pass via proposed wrapper below
  }).catch((e) => { throw e })
}

// Wrapper that includes old snapshot properly
export async function submitEditWithSnapshot({ employee, proposedRpc, contractId, up3Id }) {
  const oldSnapshot = {
    nip: employee.nip ?? '',
    name: employee.name ?? '',
    unit_id: employee.unitId ?? null,
    position_id: employee.positionId ?? null,
    location_id: employee.workLocationId ?? null,
    bank: employee.bank ?? '',
    account_number: employee.accountNumber ?? '',
    hourly_rate: employee.hourlyRate ?? 0,
    birth_date: employee.birthDate ?? '',
    retirement_date_override: employee.retirementDateOverride ?? '',
    pension_override_reason: employee.pensionOverrideReason ?? '',
    source_position: employee.sourcePosition ?? '',
    employment_status: employee.employmentStatus ?? 'Aktif',
    status_reason: employee.statusReason ?? null,
    status_reason_note: employee.statusReasonNote ?? null,
    status_effective_date: employee.statusEffectiveDate ?? null,
  }
  const { data, error } = await supabase.rpc('submit_employee_change_request', {
    p_request_type: 'edit',
    p_employee_id: employee.id,
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_source_unit_id: employee.unitId,
    p_target_unit_id: proposedRpc.unit_id,
    p_proposed: proposedRpc,
    p_old_snapshot: oldSnapshot,
  })
  if (error) throw new Error(mapRpcError(error))
  return data
}

export async function submitAddWithSnapshot({ proposedRpc, contractId, up3Id }) {
  const { data, error } = await supabase.rpc('submit_employee_change_request', {
    p_request_type: 'add',
    p_employee_id: null,
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_source_unit_id: null,
    p_target_unit_id: proposedRpc.unit_id,
    p_proposed: proposedRpc,
    p_old_snapshot: null,
  })
  if (error) throw new Error(mapRpcError(error))
  return data
}

export async function approveEmployeeChange(requestId) {
  const { data, error } = await supabase.rpc('approve_employee_change_request', { p_request_id: requestId })
  if (error) throw new Error(mapRpcError(error))
  return data
}

export async function rejectEmployeeChange(requestId, note) {
  const { data, error } = await supabase.rpc('reject_employee_change_request', { p_request_id: requestId, p_note: note })
  if (error) throw new Error(mapRpcError(error))
  return data
}

export async function importEmployeesBulk({ contractId, up3Id, rows }) {
  const { data, error } = await supabase.rpc('import_employees_bulk', {
    p_contract_id: contractId,
    p_up3_id: up3Id,
    p_rows: rows,
  })
  if (error) throw new Error(mapRpcError(error))
  return data
}

// ---------- Import parsing (CSV/XLSX, no extra dep for CSV; xlsx for Excel) ----------

const IMPORT_HEADERS = [
  'nip',
  'nama',
  'unit_id',
  'unit',
  'lokasi_id',
  'lokasi_penempatan',
  'jabatan_id',
  'jabatan',
  'tanggal_lahir',
  'bank',
  'no_rekening',
  'tarif_lembur_jam',
  'status',
  'alasan_nonaktif',
  'keterangan_nonaktif',
  'tanggal_efektif_status',
  'override_tanggal_pensiun',
  'keterangan_override_pensiun',
]

export function buildImportTemplateCsv() {
  const header = IMPORT_HEADERS.join(',')
  const example = [
    '00210547PTK',
    'Nama Contoh',
    '',
    'ULP Singkawang',
    '',
    'ULP Singkawang',
    '',
    'Petugas Pelayanan Teknik',
    '1990-05-12',
    'BRI',
    '1234567890',
    '21000',
    'Aktif',
    '',
    '',
    '',
    '',
    '',
  ].join(',')
  return `${header}\n${example}\n`
}

export function downloadImportTemplate() {
  const csv = buildImportTemplateCsv()
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'Template_Import_Pegawai.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim())
      cur = ''
    } else if (ch === ';' && !inQuotes && out.length === 0 && line.includes(';') && !line.includes(',')) {
      // handled outside; fallback
      cur += ch
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  return out.map((v) => v.replace(/^"|"$/g, '').trim())
}

export function parseImportCsv(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (!lines.length) return []
  const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ','
  const split = (line) => (delimiter === ';' ? line.split(';').map((v) => v.trim().replace(/^"|"$/g, '')) : splitCsvLine(line))
  const headers = split(lines[0]).map((h) => h.toLowerCase().trim())
  return lines.slice(1).map((line, idx) => {
    const cells = split(line)
    const obj = { __row: idx + 2 }
    headers.forEach((h, i) => { obj[h] = cells[i] ?? '' })
    return obj
  })
}

export async function parseImportFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) {
    const text = await file.text()
    return parseImportCsv(text)
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
    return json.map((row, idx) => {
      const obj = { __row: idx + 2 }
      for (const [k, v] of Object.entries(row)) obj[String(k).toLowerCase().trim()] = String(v ?? '').trim()
      return obj
    })
  }
  throw new Error('Format file tidak didukung. Gunakan .xlsx atau .csv.')
}

export function normalizeImportRow(raw, ctx = {}) {
  const get = (...keys) => {
    for (const k of keys) {
      const v = raw[k] ?? raw[k.toLowerCase()] ?? ''
      if (String(v ?? '').trim() !== '') return String(v).trim()
    }
    return ''
  }
  const nip = get('nip')
  const name = get('nama', 'name')
  const unitRaw = get('unit_id', 'unit')
  const lokasiRaw = get('lokasi_id', 'lokasi_penempatan', 'lokasi')
  const jabatanRaw = get('jabatan_id', 'jabatan', 'position')
  const birthRaw = get('tanggal_lahir', 'birth_date', 'tgl_lahir')
  const bank = get('bank')
  const account = get('no_rekening', 'account_number', 'no rekening')
  const rateRaw = get('tarif_lembur_jam', 'tarif', 'hourly_rate')
  const status = get('status', 'employmentstatus') || 'Aktif'
  const errors = []
  if (!nip) errors.push('NIP wajib')
  if (!name) errors.push('Nama wajib')
  let birth = ''
  if (birthRaw) {
    try {
      // excel serial? sheet_to_json with raw:false already string; handle dd/mm/yyyy too
      const m = birthRaw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
      if (m) {
        const [, d, mo, y] = m
        birth = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        toDateOrNull(birth)
      } else {
        birth = toDateOrNull(birthRaw)
      }
    } catch (e) { errors.push(e.message) }
  }
  let rate = 0
  try { rate = rateRaw === '' ? 0 : toNumberOrZero(rateRaw) } catch (e) { errors.push(e.message) }

  const unitUuid = resolveUnitUuid(unitRaw, ctx)
  if (!unitRaw) errors.push('Unit wajib (nama/ID)')
  else if (!unitUuid) errors.push(`Unit tidak dikenal: ${unitRaw}`)

  let positionUuid = null
  if (jabatanRaw) {
    positionUuid = resolvePositionUuid(jabatanRaw, ctx)
    if (!positionUuid) errors.push(`Jabatan tidak dikenal: ${jabatanRaw}`)
  }

  let locationUuid = null
  if (lokasiRaw) {
    locationUuid = resolveLocationUuid(lokasiRaw, { locations: ctx.locations ?? [], unitId: unitUuid })
    if (!locationUuid && isUuid(lokasiRaw)) locationUuid = lokasiRaw
    if (!locationUuid) errors.push(`Lokasi tidak dikenal: ${lokasiRaw}`)
  }

  const st = status.toLowerCase().startsWith('non') ? 'Nonaktif' : 'Aktif'

  const rpc = {
    nip,
    name,
    unit_id: unitUuid,
    position_id: positionUuid,
    location_id: locationUuid,
    bank: bank.toUpperCase(),
    account_number: account,
    hourly_rate: rate,
    birth_date: birth || '',
    retirement_date_override: get('override_tanggal_pensiun') || '',
    pension_override_reason: get('keterangan_override_pensiun'),
    source_position: jabatanRaw,
    employment_status: st,
    status_reason: get('alasan_nonaktif') || null,
    status_reason_note: get('keterangan_nonaktif') || null,
    status_effective_date: get('tanggal_efektif_status') || null,
  }
  if (st === 'Nonaktif' && !rpc.status_reason) errors.push('Alasan Nonaktif wajib untuk status Nonaktif')
  return { rpc, errors, raw }
}
