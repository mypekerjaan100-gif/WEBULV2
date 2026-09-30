/**
 * Read-only client untuk data Variable Cost dari Google Spreadsheet
 * via Google Apps Script Web App (endpoint JSON: health/summary/detail).
 *
 * Realisasi dihitung di Apps Script sebagai jumlah baris spreadsheet
 * yang valid untuk periode + ULP. Web tidak pernah menulis ke spreadsheet.
 */

const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbx65ZC7tsfK1Z4PmLex50Im4F9UiekAwdWp6y60zdYDum2uVy6cocPZCvex1CCIvHF-vw/exec'

export const SPREADSHEET_SOURCES = Object.freeze({
  '2.1a': Object.freeze({
    code: '2.1a',
    name: 'Inspeksi SUTM Tier 1',
    sheetName: 'JTM T1',
  }),
  '2.1b': Object.freeze({
    code: '2.1b',
    name: 'Inspeksi SUTM Tier 2',
    sheetName: 'JTM T2',
  }),
  '2.1c': Object.freeze({
    code: '2.1c',
    name: 'Inspeksi Gardu/Keypoint Tier 1',
    sheetName: 'GARDU T1',
  }),
  '2.1d': Object.freeze({
    code: '2.1d',
    name: 'Inspeksi Gardu/Keypoint Tier 2',
    sheetName: 'GARDU T2',
  }),
  '3.1a': Object.freeze({
    code: '3.1a',
    name: 'ROW Fix',
    sheetName: 'Pangkas Pohon',
  }),
  '3.1b': Object.freeze({
    code: '3.1b',
    name: 'ROW Var',
    sheetName: 'VAR ROW',
  }),
  '3.2b': Object.freeze({
    code: '3.2b',
    name: 'Pemeliharaan Gardu',
    sheetName: 'HAR gardu',
  }),
})

export const SPREADSHEET_INDICATOR_CODES = Object.freeze(Object.keys(SPREADSHEET_SOURCES))

const ULP_ALIASES = Object.freeze({
  'ULP SUI DURI': 'ULP SEI DURI',
  'ULP SUNGAI DURI': 'ULP SEI DURI',
})

/** Normalisasi nama ULP agar cocok dengan displayName orgMap. */
export function normalizeSpreadsheetUlp(value) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
  return ULP_ALIASES[normalized] ?? normalized
}

export function isSpreadsheetSourced(code) {
  return Boolean(code && SPREADSHEET_SOURCES[code])
}

async function fetchJson(url, { timeoutMs = 60000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Spreadsheet tidak dapat dibaca (HTTP ${response.status}).`)
    }
    const data = await response.json()
    if (!data || data.success === false) {
      throw new Error(data?.error || 'Spreadsheet mengembalikan error.')
    }
    return data
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Pembacaan spreadsheet timeout. Coba lagi.')
    }
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    clearTimeout(timer)
  }
}

function buildUrl(params) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value))
    }
  }
  // Hindari cache perantara agar angka selalu mengikuti spreadsheet.
  query.set('_', String(Date.now()))
  return `${APPS_SCRIPT_URL}?${query.toString()}`
}

export async function fetchSpreadsheetHealth(indicatorCode) {
  const source = SPREADSHEET_SOURCES[indicatorCode]
  if (!source) throw new Error(`Indikator ${indicatorCode} belum terhubung ke spreadsheet.`)
  return fetchJson(buildUrl({ action: 'health' }))
}

/**
 * Ringkasan realisasi per periode.
 * @returns { realization, units: [{ulp, realization}], syncedAt, ... }
 */
function toSpreadsheetPeriod(period) {
  // Web memakai YYYY-MM-01, Apps Script memakai YYYY-MM.
  const month = String(period ?? '').slice(0, 7)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Periode tidak valid (gunakan YYYY-MM).')
  }
  return month
}

export async function fetchSpreadsheetSummary({ indicator, period }) {
  const source = SPREADSHEET_SOURCES[indicator]
  if (!source) throw new Error(`Indikator ${indicator} belum terhubung ke spreadsheet.`)
  const month = toSpreadsheetPeriod(period)
  const data = await fetchJson(
    buildUrl({ action: 'summary', indicator, period: month }),
    { timeoutMs: 90000 },
  )
  const units = (data.units ?? []).map((row) => ({
    ulp: normalizeSpreadsheetUlp(row.ulp),
    realization: Number(row.realization ?? 0),
  }))
  return { ...data, units }
}

/**
 * Detail baris spreadsheet dengan pagination server-side.
 */
export async function fetchSpreadsheetDetail({ indicator, period, ulp = '', page = 1, pageSize = 100 }) {
  const source = SPREADSHEET_SOURCES[indicator]
  if (!source) throw new Error(`Indikator ${indicator} belum terhubung ke spreadsheet.`)
  const month = toSpreadsheetPeriod(period)
  return fetchJson(
    buildUrl({ action: 'detail', indicator, period: month, ulp, page, pageSize }),
    { timeoutMs: 90000 },
  )
}

/** Cari realisasi satu unit dari hasil summary berdasarkan displayName orgMap. */
export function realizationForUnit(summary, unitDisplayName) {
  if (!summary || !unitDisplayName) return 0
  const target = normalizeSpreadsheetUlp(unitDisplayName)
  const found = (summary.units ?? []).find((row) => row.ulp === target)
  return found ? Number(found.realization ?? 0) : 0
}
