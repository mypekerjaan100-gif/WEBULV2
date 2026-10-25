const rupiahFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })

function roundAmount(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

export function parseRupiahAmount(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return { value: null, error: '' }
  const text = raw.replace(/,\s*-$/, '').trim()
  if (!/\d/.test(text)) return { value: null, error: 'Nilai rupiah harus berupa angka.' }
  if (text.includes('-')) return { value: null, error: 'Nilai rupiah tidak boleh negatif.' }

  const cleaned = text.replace(/[^0-9,.]/g, '')
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let decimalSeparator = ''

  if (lastComma >= 0 && lastDot >= 0) {
    decimalSeparator = lastComma > lastDot ? ',' : '.'
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? ',' : '.'
    const parts = cleaned.split(separator)
    if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
      decimalSeparator = separator
    }
  }

  let integerPart = cleaned
  let fractionPart = ''
  if (decimalSeparator) {
    const index = cleaned.lastIndexOf(decimalSeparator)
    integerPart = cleaned.slice(0, index).replace(/[.,]/g, '')
    fractionPart = cleaned.slice(index + 1).replace(/[.,]/g, '')
  } else {
    integerPart = cleaned.replace(/[.,]/g, '')
  }
  if (!integerPart && !fractionPart) return { value: null, error: 'Nilai rupiah harus berupa angka.' }

  const amount = Number(`${integerPart || '0'}${fractionPart ? `.${fractionPart}` : ''}`)
  if (!Number.isFinite(amount)) return { value: null, error: 'Nilai rupiah tidak valid.' }
  if (amount < 0) return { value: null, error: 'Nilai rupiah tidak boleh negatif.' }
  if (amount > 9999999999999999.99) return { value: null, error: 'Nilai rupiah terlalu besar.' }
  return { value: roundAmount(amount), error: '' }
}

export function formatRupiah(value) {
  const amount = value == null || String(value).trim() === '' ? null : Number(value)
  if (amount == null || !Number.isFinite(amount)) return '—'
  return `Rp ${rupiahFormatter.format(amount)}`
}

export function expectedMonthlyCost(bppAmount, usefulLifeMonths) {
  if (bppAmount == null || String(bppAmount).trim() === '') return null
  if (usefulLifeMonths == null || String(usefulLifeMonths).trim() === '') return null
  const bpp = Number(bppAmount)
  const life = Number(usefulLifeMonths)
  if (!Number.isFinite(bpp) || bpp < 0 || !Number.isFinite(life) || life <= 0) return null
  return roundAmount(bpp / life)
}

export function effectiveMonthlyCost(item) {
  const explicit = item?.monthlyCost
  if (explicit != null && String(explicit).trim() !== '' && Number.isFinite(Number(explicit))) {
    return roundAmount(explicit)
  }
  return expectedMonthlyCost(item?.bppAmount, item?.usefulLifeMonths ?? item?.ageMonths)
}

export function priceMismatch(item) {
  const rawExplicit = item?.monthlyCost
  if (rawExplicit == null || String(rawExplicit).trim() === '') return null
  const explicit = Number(rawExplicit)
  const expected = expectedMonthlyCost(item?.bppAmount, item?.usefulLifeMonths ?? item?.ageMonths)
  if (!Number.isFinite(explicit) || expected == null) return null
  const difference = Math.abs(Math.round(explicit) - Math.round(expected))
  if (difference <= 1) return null
  return { expected, difference }
}

export function templateCostSummary(items) {
  let total = 0
  let incomplete = 0
  for (const item of items || []) {
    const unitCost = effectiveMonthlyCost(item)
    if (unitCost == null) {
      incomplete += 1
      continue
    }
    total += unitCost * Number(item.requiredQty ?? item.required_qty ?? 0)
  }
  return { total: roundAmount(total), incomplete }
}
