const HEADERS = {
  name: ['nama alat', 'nama', 'nama peralatan', 'peralatan'],
  age: ['umur peralatan', 'umur peralatan bulan', 'umur bulan', 'umur'],
  unit: ['satuan', 'unit'],
  category: ['kategori', 'kategory', 'category'],
}

function normalizeToken(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const HEADER_LOOKUP = new Map(
  Object.entries(HEADERS).flatMap(([key, aliases]) => aliases.map((alias) => [normalizeToken(alias), key])),
)

function detectDelimiter(text) {
  const line = String(text ?? '').split(/\r?\n/, 1)[0]
  const counts = [[',', (line.match(/,/g) || []).length], [';', (line.match(/;/g) || []).length], ['\t', (line.match(/\t/g) || []).length]]
  const [best] = counts.sort((a, b) => b[1] - a[1])
  return best[1] ? best[0] : ','
}

export async function openEquipmentFile(file) {
  if (!/\.(csv|xlsx|xls)$/i.test(file?.name || '')) {
    throw new Error('Format file harus CSV, XLSX, atau XLS.')
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('Ukuran file maksimal 5 MB.')
  const XLSX = await import('xlsx')
  let workbook
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text()
    workbook = XLSX.read(text, { type: 'string', FS: detectDelimiter(text), raw: false })
  } else {
    workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false })
  }
  if (!workbook.SheetNames?.length) throw new Error('File tidak memiliki lembar data.')
  const readRows = (sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) throw new Error('Lembar data tidak ditemukan.')
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false })
    if (!matrix.length) throw new Error('Lembar data masih kosong.')
    const columns = {}
    matrix[0].forEach((header, index) => {
      const key = HEADER_LOOKUP.get(normalizeToken(header))
      if (key && columns[key] == null) columns[key] = index
    })
    const missing = [
      ['name', 'Nama Alat'],
      ['age', 'Umur Peralatan'],
      ['unit', 'Satuan'],
      ['category', 'Kategori'],
    ].filter(([key]) => columns[key] == null).map(([, label]) => label)
    if (missing.length) throw new Error(`Kolom berikut tidak ditemukan: ${missing.join(', ')}.`)
    const rows = []
    for (let index = 1; index < matrix.length; index += 1) {
      const cells = matrix[index]
      if (!cells.some((cell) => String(cell ?? '').trim() !== '')) continue
      rows.push({
        __row: index + 1,
        name: String(cells[columns.name] ?? '').trim(),
        age: String(cells[columns.age] ?? '').trim(),
        unit: String(cells[columns.unit] ?? '').trim(),
        category: String(cells[columns.category] ?? '').trim(),
      })
    }
    if (!rows.length) throw new Error('Tidak ada baris data di bawah header.')
    if (rows.length > 1000) throw new Error('Maksimal 1000 baris per impor.')
    return rows
  }
  return { sheetNames: workbook.SheetNames, readRows }
}

export function collectEquipmentCategories(rows) {
  const labels = new Map()
  for (const row of rows) {
    const key = normalizeToken(row.category)
    if (key && !labels.has(key)) labels.set(key, row.category)
  }
  return [...labels.entries()].map(([key, label]) => ({ key, label }))
}

export function resolveCategory(value, categories) {
  const key = normalizeToken(value)
  if (!key) return []
  return categories.filter((category) => normalizeToken(category.name) === key || normalizeToken(category.code) === key)
}

export function autoCategoryMapping(labels, categories) {
  const mapping = {}
  for (const { key, label } of labels) {
    const matches = resolveCategory(label, categories)
    if (matches.length === 1) mapping[key] = matches[0].id
  }
  return mapping
}

function parseAge(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return { value: null, error: '' }
  if (!/^\d+$/.test(raw)) return { value: null, error: 'Umur harus bilangan bulat bulan atau dikosongkan.' }
  const number = Number(raw)
  if (!Number.isSafeInteger(number) || number > 2147483647) return { value: null, error: 'Umur terlalu besar.' }
  return { value: number, error: '' }
}

export function buildEquipmentPreview({ rows, categories, mapping, existingRows, updateExisting }) {
  const activeCategories = categories.filter((category) => category.isActive)
  const categoryById = new Map(activeCategories.map((category) => [category.id, category]))
  const existingByKey = new Map()
  for (const item of existingRows) {
    const key = `${normalizeToken(item.name)}|${item.categoryId}|${normalizeToken(item.unit)}`
    if (!existingByKey.has(key)) existingByKey.set(key, [])
    existingByKey.get(key).push(item)
  }
  const seen = new Set()
  const preview = rows.map((row) => {
    const categoryKey = normalizeToken(row.category)
    const categoryId = mapping[categoryKey] || ''
    const category = categoryById.get(categoryId)
    const age = parseAge(row.age)
    const errors = []
    if (!row.name) errors.push('Nama alat wajib diisi.')
    if (row.name.length > 200) errors.push('Nama alat maksimal 200 karakter.')
    if (!row.unit) errors.push('Satuan wajib diisi.')
    if (row.unit.length > 50) errors.push('Satuan maksimal 50 karakter.')
    if (!row.category) errors.push('Kategori wajib diisi.')
    else if (!category) errors.push('Kategori belum dipetakan ke kategori aktif.')
    if (age.error) errors.push(age.error)
    const identity = `${normalizeToken(row.name)}|${categoryId}|${normalizeToken(row.unit)}`
    if (!errors.length && seen.has(identity)) errors.push('Baris duplikat di dalam file.')
    if (!errors.length) seen.add(identity)
    const matches = errors.length ? [] : (existingByKey.get(identity) || [])
    if (matches.length > 1) errors.push('Lebih dari satu alat lama cocok. Periksa nama, kategori, dan satuan.')
    let status = 'new'
    let note = ''
    if (errors.length) status = 'invalid'
    else if (matches.length === 1) {
      if (!updateExisting) {
        status = 'skip'
        note = 'Alat sudah ada; umur tidak diubah.'
      } else if (age.value == null) {
        status = 'skip'
        note = 'Umur kosong; data lama tidak diubah.'
      } else {
        status = 'update'
        note = `Perbarui umur ${matches[0].ageMonths ?? '—'} menjadi ${age.value} bulan.`
      }
    }
    return {
      ...row, ageMonths: age.value, categoryId, categoryName: category?.name || '',
      existingId: matches.length === 1 ? matches[0].id : null, status, note, errors,
    }
  })
  const counts = preview.reduce((result, row) => {
    result[row.status] = (result[row.status] || 0) + 1
    return result
  }, { new: 0, update: 0, skip: 0, invalid: 0 })
  return {
    rows: preview,
    counts,
    importable: preview.filter((row) => row.status === 'new' || row.status === 'update'),
  }
}

export function toEquipmentImportPayload(rows) {
  return rows.map((row) => ({
    existing_id: row.status === 'update' ? row.existingId : null,
    name: row.name,
    unit: row.unit,
    category_id: row.categoryId,
    age_months: row.ageMonths,
  }))
}
