export const CONDITION_LABELS = {
  compliant: 'Memenuhi',
  non_compliant: 'Tidak Memenuhi',
  draft: 'Belum Lengkap',
  unfilled: 'Belum Diisi',
  invalid: 'Periksa Isian',
  no_assigned_vehicles: 'Belum Ada Penetapan',
}

export function parseConditionCount(value) {
  if (value == null || String(value).trim() === '') return null
  const raw = String(value).trim()
  const count = Number(raw)
  return /^\d+$/.test(raw) && Number.isSafeInteger(count) && count <= 2147483647 ? count : NaN
}

export function evaluateCondition(row) {
  const good = parseConditionCount(row.good_qty)
  const bad = parseConditionCount(row.bad_qty)
  const required = Number(row.required_qty)
  if (Number.isNaN(good) || Number.isNaN(bad)) {
    return { status: 'invalid', available: null, percentage: null, issue: 'Gunakan bilangan bulat 0 atau lebih.' }
  }
  if (row.kind === 'vehicle' && ((good == null) !== (bad == null) || (good != null && bad != null && good + bad > 1))) {
    return { status: 'invalid', available: null, percentage: null, issue: 'Kondisi kendaraan hanya satu pilihan Baik atau Rusak.' }
  }
  if (good == null || bad == null) return { status: 'unfilled', available: null, percentage: null }
  if (row.kind !== 'vehicle' && good + bad !== required) {
    return {
      status: 'invalid',
      available: required,
      percentage: null,
      issue: 'Jumlah Baik + Rusak harus sama dengan jumlah kontrak.',
    }
  }
  return {
    status: bad > 0 || good < required ? 'non_compliant' : 'compliant',
    available: row.kind === 'vehicle' ? good + bad : required,
    percentage: required > 0 ? Math.min(100, good / required * 100) : null,
  }
}

export function summarizeConditions(rows) {
  const counts = { total: rows.length, filled: 0, compliant: 0, failed: 0, invalid: 0 }
  for (const row of rows) {
    const { status } = evaluateCondition(row)
    if (status === 'compliant') counts.compliant += 1
    if (status === 'non_compliant') counts.failed += 1
    if (status === 'invalid') counts.invalid += 1
    if (status === 'compliant' || status === 'non_compliant') counts.filled += 1
  }
  return { ...counts, status: counts.filled !== counts.total || !counts.total ? 'draft' : counts.failed ? 'non_compliant' : 'compliant' }
}

export function groupConditionItems(items) {
  const groups = new Map()
  for (const item of items) {
    const category = item.category || 'Peralatan Lainnya'
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category).push(item)
  }
  return [...groups.entries()]
}

export function groupVehicleConditions(vehicles, items) {
  return vehicles.map((vehicle) => ({
    vehicle,
    condition: items.find((item) => item.vehicle_id === vehicle.id && item.kind === 'vehicle'),
    groups: groupConditionItems(items.filter((item) => item.vehicle_id === vehicle.id && item.kind !== 'vehicle')),
  }))
}

export function summarizeFleet(vehicles, items) {
  const summary = summarizeConditions(items)
  const missingPlates = vehicles.filter((vehicle) => !vehicle.plate_display?.trim()).length
  return { ...summary, missingPlates, vehicleCount: vehicles.length, status: !vehicles.length ? 'no_assigned_vehicles' : missingPlates ? 'draft' : summary.status }
}

export function summarizeVehicle(vehicle, items) {
  const vehicleItems = (items || []).filter((item) => item.vehicle_id === vehicle.id)
  const summary = summarizeConditions(vehicleItems)
  const unfilled = vehicleItems.filter((item) => evaluateCondition(item).status === 'unfilled').length
  const missingPlate = !String(vehicle.plate_display || '').trim()
  return {
    ...summary,
    unfilled,
    missingPlate,
    itemCount: vehicleItems.length,
    hasAttention: summary.failed > 0,
    isComplete: !unfilled && !summary.invalid && !missingPlate,
  }
}

export function conditionSnapshot(items) {
  return JSON.stringify(items.map(({ key, good_qty, bad_qty, note }) => ({
    key, good_qty: good_qty == null ? '' : String(good_qty), bad_qty: bad_qty == null ? '' : String(bad_qty), note: note || '',
  })))
}

export function currentConditionMonth() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Pontianak', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}`
}

export function conditionMonthLabel(month) {
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'Asia/Pontianak' })
    .format(new Date(`${month.slice(0, 7)}-01T12:00:00Z`))
}
