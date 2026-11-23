export const BBM_TYPES = ['Pertalite', 'Pertamax', 'Pertamax Turbo', 'Solar', 'Dexlite', 'Pertamina Dex', 'Premium']
export const BBM_PLACES = ['SPBU', 'Eceran']
export function bbmPlaceOptions(current) {
  const value = String(current || '').trim()
  const known = BBM_PLACES.some((place) => place.toLowerCase() === value.toLowerCase())
  const options = BBM_PLACES.map((place) => ({ value: place, label: place }))
  if (value && !known) options.push({ value, label: value })
  return options
}
export const bbmToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Pontianak', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export const bbmNumber = (value, digits = 2) => value == null || value === '' ? '—' : Number(value).toLocaleString('id-ID', { maximumFractionDigits: digits })
export const purchaseTotal = (p) => Math.round(Number(p.liters || 0) * Number(p.price || 0) * 100) / 100
export const bbmLocationLabel = (vehicle) => {
  if (!vehicle?.location_name) return ''
  return vehicle.location_type === 'KANTOR_JAGA' ? `KJ ${vehicle.location_name}` : vehicle.location_name
}
export const bbmVehicleLabel = (vehicle) => [
  vehicle?.plate_display || 'Nopol belum diisi',
  vehicle?.label,
  bbmLocationLabel(vehicle),
].filter(Boolean).join(' · ')
export function monthDays(month) {
  const [year, m] = month.split('-').map(Number)
  return Array.from({ length: new Date(year, m, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}
export function calculateBbm(month, rows, initial, previous) {
  let start = previous?.end ?? (initial === '' || initial == null ? null : Number(initial))
  let priorDate = previous?.date
  let km = 0, liters = 0, total = 0, recorded = 0, gaps = 0
  const days = monthDays(month).map((date) => {
    const row = rows.find((r) => r.date === date)
    const filled = row?.end !== '' && row?.end != null
    const end = filled ? Number(row.end) : null
    const purchases = row?.purchases || []
    const volume = purchases.reduce((sum, p) => sum + Number(p.liters || 0), 0)
    const amount = purchases.reduce((sum, p) => sum + purchaseTotal(p), 0)
    const distance = filled && start != null ? end - start : null
    const expectedPrior = new Date(`${date}T12:00:00Z`)
    expectedPrior.setUTCDate(expectedPrior.getUTCDate() - 1)
    const gap = filled && priorDate && priorDate !== expectedPrior.toISOString().slice(0, 10)
    const result = { date, row, start, end, distance, volume, amount, gap, priorDate }
    if (filled) {
      recorded++; if (gap) gaps++
      km += distance ?? 0; start = end; priorDate = date
    }
    liters += volume; total += amount
    return result
  })
  const nextBlank = days.find((day) => day.end == null && day.date <= bbmToday())?.date
  for (const day of days) day.showStart = day.end != null || day.date === nextBlank
  return { days, km, liters, total, recorded, gaps, ratio: liters > 0 ? km / liters : null }
}
export function bbmReportDate(month, rows, today = bbmToday()) {
  const days = monthDays(month)
  const last = days.at(-1)
  if (!last || last > today) return null
  const byDate = new Map((rows ?? []).map((row) => [row.date, row]))
  const complete = days.every((date) => {
    const row = byDate.get(date)
    return row && row.end !== '' && row.end != null && Number.isFinite(Number(row.end)) && Boolean(row.photo)
  })
  return complete ? last : null
}
export function validateBbm(rows, initial, previous, today = bbmToday()) {
  let prior = previous?.end ?? (initial === '' || initial == null ? null : Number(initial))
  if (rows.length && (prior == null || !Number.isFinite(prior) || prior < 0)) throw new Error('Isi stand awal pertama.')
  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (row.date > today) throw new Error(`Tanggal ${row.date}: belum dapat diisi.`)
    const end = Number(row.end)
    if (row.end === '' || row.end == null || !Number.isFinite(end) || end < prior || end >= 100000000 || Number(end.toFixed(1)) !== end) throw new Error(`Tanggal ${row.date}: stand akhir tidak valid atau lebih kecil dari stand sebelumnya.`)
    if (!row.photo) throw new Error(`Tanggal ${row.date}: foto odometer wajib.`)
    for (const p of row.purchases || []) {
      if (!BBM_TYPES.includes(p.fuel) || !Number.isFinite(Number(p.liters)) || Number(p.liters) <= 0 || Number(p.liters) > 10000 || !Number.isFinite(Number(p.price)) || Number(p.price) <= 0 || Number(p.price) > 1000000) throw new Error(`Tanggal ${row.date}: lengkapi jenis BBM, liter, dan harga per liter.`)
      if (!p.photo) throw new Error(`Tanggal ${row.date}: foto struk wajib.`)
    }
    prior = end
  }
}
