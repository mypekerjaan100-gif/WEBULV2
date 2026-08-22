import { ulpIdsOfUp3, unitNameForPeriod } from '../data/organisasiPelayananTeknik.js'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'

const MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
]

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

const pad = (value) => String(value).padStart(2, '0')

const NUMBER_WORDS = [
  '',
  'Satu',
  'Dua',
  'Tiga',
  'Empat',
  'Lima',
  'Enam',
  'Tujuh',
  'Delapan',
  'Sembilan',
  'Sepuluh',
  'Sebelas',
  'Dua Belas',
  'Tiga Belas',
  'Empat Belas',
  'Lima Belas',
  'Enam Belas',
  'Tujuh Belas',
  'Delapan Belas',
  'Sembilan Belas',
]

function terbilang(number) {
  if (number < 20) return NUMBER_WORDS[number]
  if (number < 100) {
    const tens = Math.floor(number / 10)
    const rest = number % 10
    const tensWord = tens === 1 ? 'Sepuluh' : `${NUMBER_WORDS[tens]} Puluh`
    return rest === 0 ? tensWord : `${tensWord} ${NUMBER_WORDS[rest]}`
  }
  if (number < 200) return number === 100 ? 'Seratus' : `Seratus ${terbilang(number - 100)}`
  if (number < 1000) {
    const hundreds = Math.floor(number / 100)
    const rest = number % 100
    const hWord = hundreds === 1 ? 'Seratus' : `${NUMBER_WORDS[hundreds]} Ratus`
    return rest === 0 ? hWord : `${hWord} ${terbilang(rest)}`
  }
  if (number < 2000) return number === 1000 ? 'Seribu' : `Seribu ${terbilang(number - 1000)}`
  const thousands = Math.floor(number / 1000)
  const rest = number % 1000
  const tWord = `${terbilang(thousands)} Ribu`
  return rest === 0 ? tWord : `${tWord} ${terbilang(rest)}`
}

function dateTerbilang(date) {
  return `${terbilang(date.getDate())} ${MONTH_NAMES[date.getMonth()]} ${terbilang(date.getFullYear())}`
}

function parsePeriod(period) {
  const [monthName, yearText] = (period ?? '').split(' ')
  const month = MONTH_NAMES.indexOf(monthName)
  const year = Number(yearText)
  return { month, year, valid: month >= 0 && Number.isInteger(year) }
}

export function reportDateForPeriod(period) {
  const { month, year, valid } = parsePeriod(period)
  if (!valid) return null
  const date = new Date(year, month + 1, 1)
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1)
  }
  return date
}

export function formatReportDate(date) {
  if (!date) return '\u2013'
  return `${DAY_NAMES[date.getDay()]}, ${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`
}

export function formatDateKey(key) {
  if (!key) return '\u2013'
  const [year, month, day] = key.split('-')
  return `${pad(day)}-${pad(month)}-${year}`
}

function periodKeyOf(dateKey) {
  const [year, month] = (dateKey ?? '').split('-').map(Number)
  return Number.isInteger(year) && Number.isInteger(month) ? year * 12 + (month - 1) : null
}

export function slaScopeLabel({ documentScope, up3Id, unitId, units, period }) {
  if (documentScope === 'sla-up3') {
    const up3Name =
      unitNameForPeriod(units, up3Id, period) ??
      units.find((unit) => unit.id === up3Id)?.name ??
      up3Id
    return `SLA UP3 ${up3Name.replace(/^UP3\s+/, '')}`
  }
  const name = unitNameForPeriod(units, unitId, period) ?? unitId
  return `SLA ULP ${name}`
}

function formatPercent(value) {
  if (value == null) return null
  return `${value.toLocaleString('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`
}

function dendaPercentOf(indicator, achievement) {
  if (achievement == null || achievement >= 100) return null
  const weight = indicator.weight
  if (weight == null || weight === '') return null
  const value = (Number(weight) / 30) * 9
  return Number.isNaN(value) ? null : value
}

export function aggregateUp3Entries(ulpEntries, ulpIds) {
  const map = {}
  ;(ulpIds ?? []).forEach((ulpId) => {
    const unitEntries = ulpEntries?.[ulpId] ?? {}
    Object.keys(unitEntries).forEach((indicatorId) => {
      const entry = unitEntries[indicatorId]
      const agg = map[indicatorId] ?? {
        unit: entry.unit ?? null,
        wo: 0,
        realization: 0,
        achievement: null,
      }
      agg.wo += Number(entry.wo) || 0
      agg.realization += Number(entry.realization) || 0
      map[indicatorId] = agg
    })
  })
  return map
}

export function buildSlaExportDoc({
  period,
  version,
  role,
  unitId,
  up3Id,
  units,
  contractId,
  documentScope,
  indicators,
  targets,
  ulpEntries,
  up3Entries,
  signatureGroups,
}) {
  const scopeDoc =
    documentScope ?? (unitId != null && unitId !== up3Id ? 'sla-ulp' : 'sla-up3')
  const isUp3Scope = scopeDoc === 'sla-up3'
  const up3Unit = (units ?? []).find((unit) => unit.id === up3Id && unit.type === 'UP3')
  if (!up3Unit) {
    return { ok: false, message: `UP3 "${up3Id}" tidak ditemukan dalam Master Organisasi.` }
  }
  if (!version || version.contractId !== contractId || version.up3Id !== up3Id) {
    return {
      ok: false,
      message: `Versi SLA tidak sesuai scope kontrak/UP3 (${contractId}/${up3Id}).`,
    }
  }
  const up3Name = unitNameForPeriod(units, up3Id, period) ?? up3Unit.name ?? up3Id
  let unitName = null
  if (!isUp3Scope) {
    const unit = (units ?? []).find(
      (item) => item.id === unitId && item.type === 'ULP' && item.parentUnitId === up3Id,
    )
    if (!unit) {
      return { ok: false, message: `Unit "${unitId}" bukan child ULP dari UP3 "${up3Id}".` }
    }
    unitName = unitNameForPeriod(units, unitId, period) ?? unit.name ?? unitId
  }
  const entries = isUp3Scope
    ? aggregateUp3Entries(ulpEntries, ulpIdsOfUp3(units, up3Id))
    : (ulpEntries?.[unitId] ?? {})
  const reportDate = formatReportDate(reportDateForPeriod(period))
  const regionName = up3Name.replace(/^UP3\s+/, '')
  const scope = slaScopeLabel({ documentScope: scopeDoc, up3Id, unitId, units, period })

  const opening = isUp3Scope
    ? `Berdasarkan Surat Perjanjian Pihak Pertama : ${version.agreementName ?? ''} ` +
      `Tanggal ${formatDateKey(version.effectiveDate)}. Dengan ini disampaikan Laporan ` +
      `Realisasi SLA Pelayanan Teknik periode ${period} untuk ${scope}.`
    : ''

  const columns = [
    { label: 'No', width: 5, pdfWidth: 16, align: 'center' },
    { label: 'Ruang Lingkup', width: 20, pdfWidth: 87, align: 'left' },
    { label: 'Poin', width: 8, pdfWidth: 23, align: 'center' },
    { label: 'Kriteria', width: 42, pdfWidth: 144, align: 'left' },
    { label: 'Target Kinerja', width: 30, pdfWidth: 104, align: 'left' },
    { label: 'Eviden', width: 25, pdfWidth: 91, align: 'left' },
    { label: 'Jenis Bobot', width: 14, pdfWidth: 53, align: 'center' },
    { label: 'Bobot', width: 6, pdfWidth: 29, align: 'center' },
    { label: 'Satuan', width: 8, pdfWidth: 33, align: 'center' },
    { label: 'Target', width: 10, pdfWidth: 30, align: 'center' },
    { label: 'WO', width: 7, pdfWidth: 28, align: 'center' },
    { label: 'Realisasi', width: 10, pdfWidth: 41, align: 'center' },
    { label: 'Pencapaian', width: 11, pdfWidth: 51, align: 'center' },
    { label: 'Denda', width: 13, pdfWidth: 40, align: 'center' },
  ]

  const rows = []
  let totalDenda = 0
  let lastCategory = null
  let sectionNo = 0
  indicators.forEach((indicator) => {
    if (indicator.category !== lastCategory) {
      lastCategory = indicator.category
      sectionNo = 0
      rows.push({
        kind: 'section',
        label: indicator.categoryName ?? indicator.category,
      })
    }
    const entry = entries[indicator.id] ?? {}
    const target = targets?.[indicator.id] ?? {}
    const achievement = entry.achievement ?? null
    const percent = dendaPercentOf(indicator, achievement)
    if (percent != null) totalDenda += percent
    rows.push({
      kind: 'data',
      scope: indicator.scope,
      section: indicator.category,
      no: '',
      cells: [
        '',
        indicator.scope,
        indicator.point,
        indicator.criteria,
        indicator.performanceTarget,
        indicator.evidence,
        indicator.weightType,
        indicator.weight,
        entry.unit ?? indicator.unit,
        isUp3Scope ? target.up3 : (target.ulpTargets?.[unitId] ?? target.ulp),
        entry.wo,
        entry.realization,
        entry.achievement,
        achievement == null
          ? 'Belum dinilai'
          : achievement >= 100
            ? '-'
            : (formatPercent(percent) ?? '-'),
      ],
    })
  })
  // Group consecutive data rows within the same section that share the same
  // Ruang Lingkup. The anchor (first row of a group) carries the visible No /
  // scope; followers are blanked for columns No + Ruang Lingkup and merged
  // upwards. A group may continue across a page break (the continuation row
  // becomes a new anchor showing the same No + scope).
  let runId = 0
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].kind !== 'data') continue
    if (rows[i].section !== lastCategory) {
      lastCategory = rows[i].section
      sectionNo = 0
    }
    const prev = rows[i - 1]
    const sameRun =
      prev?.kind === 'data' &&
      prev.section === rows[i].section &&
      prev.scope === rows[i].scope
    if (sameRun) {
      rows[i].runId = rows[i - 1].runId
      rows[i].runIndex = rows[i - 1].runIndex + 1
      rows[i].no = rows[i - 1].no
    } else {
      sectionNo += 1
      rows[i].runId = runId
      rows[i].runIndex = 0
      rows[i].no = String(sectionNo)
      runId += 1
    }
    rows[i].cells[0] = rows[i].no
  }
  const maxRunIndex = {}
  rows.forEach((r) => {
    if (r.kind === 'data' && r.runId != null) {
      maxRunIndex[r.runId] = Math.max(maxRunIndex[r.runId] ?? 0, r.runIndex)
    }
  })
  rows.forEach((r) => {
    if (r.kind === 'data') r.runLen = (maxRunIndex[r.runId] ?? 0) + 1
  })
  if (isUp3Scope) {
    rows.push({
      kind: 'total',
      label: 'TOTAL DENDA SLA',
      value: totalDenda > 0 ? formatPercent(totalDenda) : '-',
    })
  }

  const parsed = parsePeriod(period)
  const periodKey = parsed.valid ? parsed.year * 12 + parsed.month : null
  const activeGroups = (signatureGroups ?? [])
    .filter((group) => group.contractId === contractId)
    .filter((group) => group.up3Id === up3Id)
    .filter((group) => (group.status ?? 'Aktif') === 'Aktif')
    .filter((group) => group.documentScope === scopeDoc)
    .filter((group) =>
      isUp3Scope
        ? group.unitId == null || group.unitId === up3Id
        : group.unitId === unitId,
    )
    .filter((group) => {
      const startKey = periodKeyOf(group.periodStart)
      const endKey = periodKeyOf(group.periodEnd)
      return (
        startKey == null ||
        endKey == null ||
        periodKey == null ||
        (periodKey >= startKey && periodKey <= endKey)
      )
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((group) => ({
      id: group.id,
      title: group.title,
      institution: group.institution ?? '',
      members: (group.signatories ?? [])
        .filter((signatory) => (signatory.status ?? 'Aktif') === 'Aktif')
        .filter((signatory) => {
          const startKey = periodKeyOf(signatory.periodStart)
          const endKey = periodKeyOf(signatory.periodEnd)
          if (startKey == null || endKey == null || periodKey == null) return false
          return periodKey >= startKey && periodKey <= endKey
        })
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }))

  return {
    ok: true,
    title: 'LAPORAN REALISASI SLA PELAYANAN TEKNIK',
    period,
    reportDate,
    reportDateRaw: reportDateForPeriod(period),
    scope,
    up3Id,
    documentScope: scopeDoc,
    unitId: isUp3Scope ? up3Id : unitId,
    up3Name,
    unitName: unitName ?? '',
    agreementName: version.agreementName ?? '',
    effectiveDate: formatDateKey(version.effectiveDate),
    opening,
    columns,
    rows,
    totalDenda: totalDenda > 0 ? formatPercent(totalDenda) : '-',
    signatureGroups: activeGroups,
    isUp3Scope,
    regionName,
  }
}

export function exportFileName(doc, extension) {
  const monthYear = doc.period.replace(/\s+/g, '_')
  if (doc.isUp3Scope) {
    return `SLA_UP3_${doc.regionName}_${monthYear}.${extension}`
  }
  const unit = doc.scope.replace(/^SLA ULP\s*/, '').replace(/\s+/g, '_')
  return `SLA_${unit}_${monthYear}.${extension}`
}

export function downloadExportFile(bytes, filename) {
  const blob = new Blob([bytes], {
    type: filename.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------- XLSX (inline strings + STORED zip, no dependencies) ----------

const XML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

const xmlEscape = (value) => String(value).replace(/[&<>"']/g, (ch) => XML_ESCAPE_MAP[ch])

function colRef(index) {
  let value = index + 1
  let ref = ''
  while (value > 0) {
    value -= 1
    ref = String.fromCharCode(65 + (value % 26)) + ref
    value = Math.floor(value / 26)
  }
  return ref
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function concatBytes(chunks) {
  let size = 0
  chunks.forEach((chunk) => {
    size += chunk.length
  })
  const out = new Uint8Array(size)
  let pos = 0
  chunks.forEach((chunk) => {
    out.set(chunk, pos)
    pos += chunk.length
  })
  return out
}

function buildZip(files) {
  const encoder = new TextEncoder()
  const localChunks = []
  const centralEntries = []
  let offset = 0
  const DOS_TIME = 0
  const DOS_DATE = ((0 & 0x7f) << 9) | ((1 & 0x0f) << 5) | 1

  files.forEach((file) => {
    const name = encoder.encode(file.name)
    const data = file.data
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0, true)
    view.setUint16(8, 0, true)
    view.setUint16(10, DOS_TIME, true)
    view.setUint16(12, DOS_DATE, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, data.length, true)
    view.setUint32(22, data.length, true)
    view.setUint16(26, name.length, true)
    view.setUint16(28, 0, true)
    local.set(name, 30)
    localChunks.push(local, data)
    centralEntries.push({ name, data, crc, offset })
    offset += 30 + name.length + data.length
  })

  const centralStart = offset
  const centralParts = []
  centralEntries.forEach((entry) => {
    const central = new Uint8Array(46 + entry.name.length)
    const view = new DataView(central.buffer)
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint16(8, 0, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, DOS_TIME, true)
    view.setUint16(14, DOS_DATE, true)
    view.setUint32(16, entry.crc, true)
    view.setUint32(20, entry.data.length, true)
    view.setUint32(24, entry.data.length, true)
    view.setUint16(28, entry.name.length, true)
    view.setUint16(30, 0, true)
    view.setUint16(32, 0, true)
    view.setUint16(34, 0, true)
    view.setUint16(36, 0, true)
    view.setUint32(38, 0, true)
    view.setUint32(42, entry.offset, true)
    central.set(entry.name, 46)
    centralParts.push(central)
  })

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(4, 0, true)
  eocdView.setUint16(6, 0, true)
  eocdView.setUint16(8, files.length, true)
  eocdView.setUint16(10, files.length, true)
  eocdView.setUint32(12, centralSize, true)
  eocdView.setUint32(16, centralStart, true)
  eocdView.setUint16(20, 0, true)

  return concatBytes([...localChunks, ...centralParts, eocd])
}

const encode = (text) => new TextEncoder().encode(text)

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>'

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>'

const WORKBOOK_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets><sheet name="SLA" sheetId="1" r:id="rId1"/></sheets>' +
  '</workbook>'

const WORKBOOK_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>'

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="3">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="14"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
  '<borders count="5">' +
  '<border/>' +
  '<border>' +
  '<left style="thin"><color rgb="FF000000"/></left>' +
  '<right style="thin"><color rgb="FF000000"/></right>' +
  '<top style="thin"><color rgb="FF000000"/></top>' +
  '<bottom style="thin"><color rgb="FF000000"/></bottom>' +
  '</border>' +
  '<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom/></border>' +
  '<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top/><bottom/></border>' +
  '<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top/><bottom style="thin"><color rgb="FF000000"/></bottom></border>' +
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="13">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' +
  '<alignment wrapText="1" vertical="center" horizontal="center"/>' +
  '</xf>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
  '<alignment wrapText="1" vertical="top"/>' +
  '</xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
  '<alignment wrapText="1" vertical="top" horizontal="center"/>' +
  '</xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
  '<alignment wrapText="1" vertical="top" horizontal="right"/>' +
  '</xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
  '<alignment wrapText="1" vertical="top"/>' +
  '</xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
  '<alignment wrapText="1" vertical="top" horizontal="center"/>' +
  '</xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
  '<alignment wrapText="1" vertical="top" horizontal="right"/>' +
  '</xf>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">' +
  '<alignment wrapText="1" vertical="center" horizontal="left"/>' +
  '</xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top" horizontal="center"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top" horizontal="center"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="4" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top" horizontal="center"/></xf>' +
  '</cellXfs>' +
  '</styleSheet>'

function buildSheetXml(doc) {
  const colCount = doc.columns.length

  const colsXml =
    '<cols>' +
    doc.columns
      .map(
        (col, index) =>
          `<col min="${index + 1}" max="${index + 1}" width="${col.width}" customWidth="1"/>`,
      )
      .join('') +
    '</cols>'

  const mergeCells = []
  let rowIndex = 1
  let sheetRows = ''

  const addMergedRow = (text, style, refCount = colCount, height = null) => {
    mergeCells.push(`A${rowIndex}:${colRef(refCount - 1)}${rowIndex}`)
    sheetRows +=
      `<row r="${rowIndex}"${height ? ` ht="${height}" customHeight="1"` : ''}>` +
      `<c r="A${rowIndex}" t="inlineStr"${style ? ` s="${style}"` : ''}>` +
      `<is><t xml:space="preserve">${xmlEscape(text ?? '')}</t></is></c>` +
      '</row>'
    rowIndex += 1
  }

  const addCellRow = (cells, height = 36) => {
    const parts = cells
      .map((cell) => {
        const ref = `${colRef(cell.col)}${rowIndex}`
        if (cell.type === 'number') {
          return `<c r="${ref}"${cell.style ? ` s="${cell.style}"` : ''}><v>${cell.value}</v></c>`
        }
        return (
          `<c r="${ref}" t="inlineStr"${cell.style ? ` s="${cell.style}"` : ''}>` +
          `<is><t xml:space="preserve">${xmlEscape(cell.value ?? '')}</t></is></c>`
        )
      })
      .join('')
    sheetRows += `<row r="${rowIndex}"${height ? ` ht="${height}" customHeight="1"` : ''}>${parts}</row>`
    rowIndex += 1
  }

  const alignStyle = (align) => {
    if (align === 'center') return 7
    if (align === 'right') return 8
    return 6
  }

  const xlsxScope = String(doc.scope ?? '').replace(/^SLA ULP\s+/, '')
  addMergedRow(doc.title, 2)
  addMergedRow(`Periode Pekerjaan : ${doc.period ?? ''}`)
  addMergedRow(`Tanggal Laporan (N+1) : ${doc.reportDate ?? ''}`)
  addMergedRow(`Scope Laporan : ${xlsxScope}`)
  if (doc.opening) addMergedRow(doc.opening, 3)
  rowIndex += 1

  let firstHeaderRow = null
  const addSectionHeader = () => {
    if (firstHeaderRow == null) firstHeaderRow = rowIndex
    addCellRow(
      doc.columns.map((col, index) => ({ col: index, value: col.label, style: 1 })),
      34,
    )
  }

  doc.rows.forEach((row) => {
    if (row.kind === 'section') {
      addMergedRow(row.label, 9, colCount, 24)
      addSectionHeader()
      return
    }
    if (row.kind === 'total') {
      addMergedRow(row.label, 9, colCount - 1, 24)
      addCellRow([
        { col: colCount - 1, value: row.value, style: 7 },
      ], 24)
      return
    }
    // data row
    const baseRow = rowIndex
    const cells = row.cells.map((value, index) => ({
      col: index,
      value: value == null || value === '' ? null : value,
      type: typeof value === 'number' && Number.isFinite(value) ? 'number' : 'text',
      style: alignStyle(doc.columns[index]?.align),
    }))
    if (row.runLen > 1) {
      if (row.runIndex === 0) {
        // The two visible merged columns stay independent: No in A and scope in B.
        cells[0].value = row.no ?? row.cells[0]
        cells[1].value = row.scope ?? row.cells[1]
        cells[0].style = 10
        cells[1].style = 10
      } else {
        cells[0].value = null
        cells[1].value = null
        const isLast = row.runIndex === row.runLen - 1
        cells[0].style = isLast ? 12 : 11
        cells[1].style = isLast ? 12 : 11
      }
      // Record independent vertical merge ranges. Never merge A:B together.
      if (row.runIndex === 0) {
        mergeCells.push(`A${baseRow}:A${baseRow + (row.runLen - 1)}`)
        mergeCells.push(`B${baseRow}:B${baseRow + (row.runLen - 1)}`)
      }
    }
    addCellRow(cells)
  })

  if (!doc.rows.some((row) => row.kind === 'total')) {
    addMergedRow('TOTAL DENDA SLA', 9, colCount - 1, 24)
    addCellRow([
      { col: colCount - 1, value: doc.totalDenda ?? '-', style: 7 },
    ], 24)
  }

  const signatureSlots = [
    { label: 'Pihak Pertama', start: 0, end: 4 },
    { label: 'Pihak Kedua', start: 5, end: 9 },
    { label: 'Saksi', start: 10, end: 13 },
  ]
  const signatureGroups = doc.signatureGroups ?? []
  const signatureFor = (label) =>
    signatureGroups.find((group) =>
      String(group.title ?? '').toLowerCase().replace(/\s+/g, ' ').includes(label.toLowerCase()),
    )
  const addSignatureRow = (cells, style = 6, height = 42) => {
    const anchors = signatureSlots.map((slot, index) => {
      mergeCells.push(`${colRef(slot.start)}${rowIndex}:${colRef(slot.end)}${rowIndex}`)
      return { col: slot.start, value: cells[index] ?? '', style }
    })
    addCellRow(anchors, height)
  }
  addMergedRow(`Penandatangan yang berlaku pada periode ${doc.period ?? ''}`, 9, colCount, 24)
  addSignatureRow(signatureSlots.map((slot) => slot.label), 1, 24)
  const groupedSignatures = signatureSlots.map((slot) => signatureFor(slot.label))
  const signatureRowCount = Math.max(1, ...groupedSignatures.map((group) => group?.members?.length ?? 0))
  for (let index = 0; index < signatureRowCount; index += 1) {
    addSignatureRow(groupedSignatures.map((group) => {
      const member = group?.members?.[index]
      if (!member) return group?.institution ?? ''
      return `${member.name ?? ''}${member.position ? `\n${member.position}` : ''}`
    }))
  }

  const mergeCellsXml =
    mergeCells.length > 0
      ? `<mergeCells count="${mergeCells.length}">${mergeCells
          .map((ref) => `<mergeCell ref="${ref}"/>`)
          .join('')}</mergeCells>`
      : ''

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${Math.max(0, (firstHeaderRow ?? 1) - 1)}" topLeftCell="A${firstHeaderRow ?? 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    colsXml +
    `<sheetData>${sheetRows}</sheetData>` +
    mergeCellsXml +
    '<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>' +
    '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>' +
    '</worksheet>'
  )
}

export function buildXlsx(doc) {
  const files = [
    { name: '[Content_Types].xml', data: encode(CONTENT_TYPES_XML) },
    { name: '_rels/.rels', data: encode(ROOT_RELS_XML) },
    { name: 'xl/workbook.xml', data: encode(WORKBOOK_XML) },
    { name: 'xl/_rels/workbook.xml.rels', data: encode(WORKBOOK_RELS_XML) },
    { name: 'xl/styles.xml', data: encode(STYLES_XML) },
    { name: 'xl/worksheets/sheet1.xml', data: encode(buildSheetXml(doc)) },
  ]
  return buildZip(files)
}

const EMPLOYEE_EXPORT_STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
  '<borders count="2"><border/><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>' +
  '</styleSheet>'

function excelDateSerial(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000)
}

function buildEmployeeSheetXml(columns, rows) {
  const lastCol = colRef(columns.length - 1)
  const colsXml = `<cols>${columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`)
    .join('')}</cols>`
  const header = columns
    .map((column, index) => `<c r="${colRef(index)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlEscape(column.label)}</t></is></c>`)
    .join('')
  const dataRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const ref = `${colRef(columnIndex)}${rowIndex + 2}`
          if (cell?.type === 'date') {
            const serial = excelDateSerial(cell.value)
            if (serial != null) return `<c r="${ref}" s="2"><v>${serial}</v></c>`
          }
          return `<c r="${ref}" t="inlineStr" s="0"><is><t xml:space="preserve">${xmlEscape(cell?.value ?? '')}</t></is></c>`
        })
        .join('')
      return `<row r="${rowIndex + 2}">${cells}</row>`
    })
    .join('')

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    colsXml +
    `<sheetData><row r="1">${header}</row>${dataRows}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${Math.max(1, rows.length + 1)}"/>` +
    '</worksheet>'
  )
}

export function buildMasterPegawaiXlsx(columns, rows) {
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Master Pegawai" sheetId="1" r:id="rId1"/></sheets></workbook>'
  return buildZip([
    { name: '[Content_Types].xml', data: encode(CONTENT_TYPES_XML) },
    { name: '_rels/.rels', data: encode(ROOT_RELS_XML) },
    { name: 'xl/workbook.xml', data: encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: encode(WORKBOOK_RELS_XML) },
    { name: 'xl/styles.xml', data: encode(EMPLOYEE_EXPORT_STYLES_XML) },
    { name: 'xl/worksheets/sheet1.xml', data: encode(buildEmployeeSheetXml(columns, rows)) },
  ])
}

// ---------- PDF (base-14 fonts, no dependencies) ----------

const pdfEscape = (value) =>
  String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7e]/g, '-')

const textWidth = (text, size, bold = false) =>
  String(text).length * size * (bold ? 0.55 : 0.5)

function wrapText(text, maxWidth, size, bold = false) {
  const words = String(text ?? '').split(' ')
  const lines = []
  let line = ''
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word
    if (line && textWidth(candidate, size, bold) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  })
  if (line) lines.push(line)
  return lines.flatMap((item) => {
    if (textWidth(item, size, bold) <= maxWidth) return [item]
    const out = []
    let current = ''
    for (const ch of item) {
      if (current && textWidth(current + ch, size, bold) > maxWidth) {
        out.push(current)
        current = ch
      } else {
        current += ch
      }
    }
    if (current) out.push(current)
    return out
  })
}

// Estimasi ruang yang dibutuhkan segmen baru pada posisi y saat ini:
// section row + head + satu data row. Kurang dari itu => halaman baru wajib,
// agar section heading tidak terdampar di akhir halaman (orphan).
export function shouldBreakBeforeSection({
  y,
  pageHeight,
  marginBottom,
  sectionRowH = 16,
  headH = 26,
  dataRowH = 20,
  buffer = 12,
  hasFirstData = true,
}) {
  const remaining = pageHeight - marginBottom - y
  const need = sectionRowH + headH + (hasFirstData ? dataRowH : 0) + buffer
  return remaining < need
}

// Pecah baris dokumen menjadi segmen per section. Setiap segmen dimulai
// dengan tepat satu section row diikuti data row-nya (total row ikut segmen
// terakhir). Section yang TIDAK punya data row juga menjadi segmen sendiri.
export function splitTableSegments(rows) {
  const segments = []
  let current = []
  ;(rows ?? []).forEach((row) => {
    if (row.kind === 'section' && current.length > 0) {
      segments.push(current)
      current = []
    }
    current.push(row)
  })
  if (current.length > 0) segments.push(current)
  return segments
}

export function renderSlaPdf(doc) {
  const PAGE_W = 841.89
  const PAGE_H = 595.28
  const MARGIN_X = 36
  const MARGIN_TOP = 42
  const MARGIN_BOTTOM = 30

  const COL_WIDTHS = doc.columns.map((col) => col.pdfWidth)
  const contentW = PAGE_W - MARGIN_X * 2

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  let y = MARGIN_TOP

  const ensureSpace = (height) => {
    if (y + height > PAGE_H - MARGIN_BOTTOM) {
      pdf.addPage()
      y = MARGIN_TOP
    }
  }

  // Kop dokumen — urutan wajib: judul -> LOKASI -> (ULP: nama unit) ->
  // paragraf pembuka (khusus SLA UP3), lalu tabel. SLA ULP TIDAK memakai
  // tiga paragraf pembuka versi UP3.
  ensureSpace(240)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.text(
    'BERITA ACARA REALISASI PEKERJAAN PELAYANAN TEKNIK',
    MARGIN_X + contentW / 2,
    y + 14,
    { align: 'center' },
  )
  y += 24
  pdf.setFontSize(10.5)
  pdf.text(
    `LOKASI ${String(doc.up3Name ?? '').toUpperCase()}`,
    MARGIN_X + contentW / 2,
    y + 9,
    { align: 'center' },
  )
  y += 18
  if (!doc.isUp3Scope) {
    pdf.text(String(doc.unitName ?? '').toUpperCase(), MARGIN_X + contentW / 2, y + 9, {
      align: 'center',
    })
    y += 18
    y += 6
  } else {
    y += 6
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9.5)
    const raw = doc.reportDateRaw
    const reportDateText =
      `${DAY_NAMES[raw.getDay()]}, ${dateTerbilang(raw)} ` +
      `${pad(raw.getDate())}-${pad(raw.getMonth() + 1)}-${raw.getFullYear()}`
    const openingLines = [
      `Pada hari ini ${reportDateText}, Pihak Kedua telah menyelesaikan Pekerjaan`,
      `Pekerjaan Teknik Operasi dan Pemeliharaan Distribusi di Wilayah Kerja PT PLN (Persero) ` +
        `Unit Induk Distribusi Kalimantan Barat Unit Pelaksana Pelayanan Pelanggan ` +
        `${doc.regionName} Periode ${doc.period}`,
      `Berdasarkan Surat Perjanjian Pihak Pertama : ${doc.agreementName} Tanggal ${doc.effectiveDate}`,
    ]
    openingLines.forEach((paragraph) => {
      pdf.splitTextToSize(paragraph, contentW).forEach((line) => {
        if (y + 13 > PAGE_H - MARGIN_BOTTOM) {
          pdf.addPage()
          y = MARGIN_TOP
        }
        pdf.text(line, MARGIN_X, y + 10)
        y += 13
      })
      y += 5
    })
    y += 7
  }

  // ---- Table via jspdf-autotable, dipecah per section ----
  // Urutan render per section WAJIB: SECTION BANNER -> HEADER 14 KOLOM -> DATA.
  // Section banner digambar MANUAL di luar tabel (hanya sekali saat section
  // dimulai; saat section lanjut ke halaman berikutnya yang diulang hanya
  // header via showHead:'everyPage'). Sebelum section dimulai dilakukan
  // preflight: bila sisa ruang tidak cukup untuk banner + head + satu data
  // row, paksa halaman baru agar banner TIDAK pernah orphan.
  // CATATAN: data.pageNumber autotable RESTART dari 1 di setiap panggilan,
  // sehingga nomor halaman diambil dari jsPDF (getCurrentPageInfo) agar
  // geometri merge/signature selalu pada halaman nyata.
  const totalPdfWidth = COL_WIDTHS.reduce((sum, w) => sum + w, 0)
  const scale = contentW / totalPdfWidth

  const columnStyles = {}
  doc.columns.forEach((col, index) => {
    columnStyles[index] = {
      cellWidth: col.pdfWidth * scale,
      halign: col.align === 'center' ? 'center' : 'left',
    }
  })

  // ---- Geometri signature dihitung SEKALI (dipakai preflight final page + render) ----
  const sigGroups = doc.signatureGroups ?? []
  const sigColsPerRow = sigGroups.length <= 3 ? sigGroups.length : 3
  const sigColGap = 26
  const sigColW =
    sigGroups.length > 0 ? (contentW - sigColGap * (sigColsPerRow - 1)) / sigColsPerRow : 0
  const TTD_SPACE = 96
  const memberStep = TTD_SPACE + 34
  const sigMaxMembers =
    sigGroups.length > 0 ? Math.max(...sigGroups.map((group) => group.members.length), 1) : 1
  const sigColH =
    sigGroups.length > 0 ? 34 + (sigMaxMembers - 1) * memberStep + TTD_SPACE + 20 + 14 : 0
  const sigGroupRows = []
  for (let gi = 0; gi < sigGroups.length; gi += sigColsPerRow) {
    sigGroupRows.push(sigGroups.slice(gi, gi + sigColsPerRow))
  }
  const GAP_AFTER_TABLE = 20
  const sigNeed =
    sigGroups.length > 0
      ? GAP_AFTER_TABLE + sigGroupRows.length * sigColH + (sigGroupRows.length - 1) * 16
      : 0

  // Perkiraan tinggi row (pt) dari isi cell, dipakai preflight halaman terakhir.
  const estimateRowHeightPts = (row) => {
    if (!row) return 50
    if (row.kind === 'total') {
      const lastW = columnStyles[doc.columns.length - 1]?.cellWidth ?? 40
      const labelLines = pdf.splitTextToSize(String(row.label ?? ''), contentW - lastW - 4)
      const valueLines = pdf.splitTextToSize(String(row.value ?? ''), lastW - 4)
      return Math.max(13, Math.max(labelLines.length, valueLines.length) * 10.5 + 5)
    }
    let maxLines = 1
    row.cells.forEach((cell, ci) => {
      if (cell == null) return
      const w = (columnStyles[ci]?.cellWidth ?? 40) - 4
      const lines = pdf.splitTextToSize(String(cell), Math.max(w, 10))
      if (lines.length > maxLines) maxLines = lines.length
    })
    return Math.max(13, maxLines * 9.8 + 5)
  }

  const segments = splitTableSegments(doc.rows)
  const rowGeom = {}
  const rowPages = {}
  const bodyTop = {}
  const bannerPages = {}
  const planned = []
  const renderTable = (callOffset, bodyRows, startY0, meta) => {
    const body = bodyRows.map((row) => {
      if (row.kind === 'total') {
        return [
          { content: row.label, colSpan: doc.columns.length - 1 },
          { content: row.value },
        ]
      }
      return row.cells.map((cell) => ({ content: cell == null ? '' : cell }))
    })
    planned.push({
      offset: callOffset,
      rows: bodyRows.length,
      forceBreak: meta.forceBreak ?? false,
      startY: startY0,
      banner: meta.banner ?? false,
    })
    autoTable(pdf, {
      startY: startY0,
      margin: {
        left: MARGIN_X,
        right: MARGIN_X,
        top: MARGIN_TOP,
        bottom: MARGIN_BOTTOM,
      },
      head: [doc.columns.map((col) => col.label)],
      body,
      theme: 'grid',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      tableWidth: 'auto',
      styles: {
        font: 'helvetica',
        fontStyle: 'normal',
        fontSize: 8,
        overflow: 'linebreak',
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.3,
        cellPadding: 2,
      },
      headStyles: {
        fontStyle: 'bold',
        halign: 'center',
        valign: 'middle',
        fontSize: 8.5,
        fillColor: [225, 225, 225],
        lineColor: [0, 0, 0],
        lineWidth: 0.4,
        cellPadding: 2,
      },
      columnStyles,
      didParseCell: (data) => {
        if (data.section !== 'body') return
        const row = doc.rows[callOffset + data.row.index]
        if (!row) return
        if (row.kind === 'total') {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fontSize = 9
          data.cell.styles.halign =
            data.column.index === doc.columns.length - 1 ? 'right' : 'left'
          data.cell.styles.valign = 'middle'
        } else {
          data.cell.styles.fontSize = 8
          data.cell.styles.valign = data.column.index < 2 ? 'middle' : 'top'
        }
      },
      didDrawCell: (data) => {
        if (data.section !== 'body') return
        const page = pdf.getCurrentPageInfo().pageNumber
        // abs = index baris asli di doc.rows (callOffset menunjuk baris section,
        // body hanya baris data -> index body + 1 = index doc asli).
        const abs = callOffset + data.row.index + 1
        if (!rowGeom[page]) rowGeom[page] = []
        if (!rowPages[page]) rowPages[page] = []
        if (!rowPages[page].includes(abs)) rowPages[page].push(abs)
        if (bodyTop[page] == null) bodyTop[page] = data.cell.y
        else bodyTop[page] = Math.min(bodyTop[page], data.cell.y)
        let entry = rowGeom[page].find((e) => e.idx === abs)
        if (!entry) {
          entry = { idx: abs, y: data.cell.y, height: data.cell.height }
          rowGeom[page].push(entry)
        }
        if (data.column.index === 0) {
          entry.x0 = data.cell.x
          entry.w0 = data.cell.width
          entry.y = data.cell.y
          entry.height = data.cell.height
        } else if (data.column.index === 1) {
          entry.x1 = data.cell.x
          entry.w1 = data.cell.width
        } else if (data.column.index === doc.columns.length - 1) {
          entry.xLast = data.cell.x
          entry.wLast = data.cell.width
        }
      },
    })
    return pdf.lastAutoTable?.finalY ?? startY0
  }

  let offset = 0
  segments.forEach((segment, segIndex) => {
    const sectionRow = segment[0]?.kind === 'section' ? segment[0] : null
    const dataRows = segment.filter((row) => row.kind !== 'section')
    const firstData = dataRows.find((row) => row.kind === 'data')
    const hasTotal = segment.some((row) => row.kind === 'total')
    const forceBreak =
      !!sectionRow &&
      shouldBreakBeforeSection({
        y,
        pageHeight: PAGE_H,
        marginBottom: MARGIN_BOTTOM,
        sectionRowH: 15,
        headH: 26,
        dataRowH: 50,
        buffer: 16,
        hasFirstData: !!firstData,
      })
    if (forceBreak) {
      pdf.addPage()
      y = MARGIN_TOP
    }
    const bannerH = 15
    if (sectionRow) {
      if (y + bannerH > PAGE_H - MARGIN_BOTTOM) {
        pdf.addPage()
        y = MARGIN_TOP
      }
      pdf.setFillColor(215, 215, 215)
      pdf.rect(MARGIN_X, y, contentW, bannerH, 'F')
      pdf.setDrawColor(0, 0, 0)
      pdf.setLineWidth(0.3)
      pdf.rect(MARGIN_X, y, contentW, bannerH, 'S')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(8.5)
      pdf.text(sectionRow.label, MARGIN_X + 3, y + bannerH / 2, { baseline: 'middle' })
      const pageNow = pdf.getCurrentPageInfo().pageNumber
      if (!bannerPages[pageNow]) bannerPages[pageNow] = []
      bannerPages[pageNow].push({ abs: offset, label: sectionRow.label, y, height: bannerH })
      y += bannerH
    }
    // ---- Final page preflight: halaman yang memuat signature WAJIB punya
    // minimal 1 indicator utuh. Jika TOTAL DENDA + signature tidak muat
    // setelah indikator terakhir, indikator terakhir (atau lebih, sesuai
    // kebutuhan) ikut pindah ke halaman baru bersama TOTAL DENDA + signature.
    // Berlaku untuk segmen data terakhir dokumen, baik yang memiliki baris
    // total (UP3) maupun yang tidak (ULP).
    let bodyRows = dataRows
    let trailingCall = null
    const isFinalDataSegment = segIndex === segments.length - 1
    const pageBottom = PAGE_H - MARGIN_BOTTOM
    if (isFinalDataSegment && firstData && sigNeed > 0) {
      const dataOnly = dataRows.filter((row) => row.kind === 'data')
      const totalRow = dataRows.find((row) => row.kind === 'total') ?? null
      if (dataOnly.length > 0) {
        let trailingCount = 1
        const estTrail = (n) => {
          const rows = dataOnly.slice(dataOnly.length - n)
          const rowsH = rows.reduce((sum, r) => sum + estimateRowHeightPts(r), 0)
          const totalH = totalRow ? estimateRowHeightPts(totalRow) : 0
          return (
            26 + rowsH + totalH + GAP_AFTER_TABLE + sigNeed
          )
        }
        const estEarly = (n) =>
          dataOnly
            .slice(0, dataOnly.length - n)
            .reduce((sum, r) => sum + estimateRowHeightPts(r), 0)
        while (
          trailingCount < dataOnly.length &&
          (estTrail(trailingCount) > pageBottom || y + estEarly(trailingCount) > pageBottom)
        ) {
          trailingCount += 1
        }
        bodyRows = dataOnly.slice(0, dataOnly.length - trailingCount)
        const trailingRows = dataOnly.slice(dataOnly.length - trailingCount)
        trailingCall = {
          rows: totalRow ? [...trailingRows, totalRow] : trailingRows,
          callOffset: offset + bodyRows.length,
        }
      }
    }
    if (bodyRows.length > 0) {
      y = renderTable(offset, bodyRows, y, { banner: !!sectionRow })
    }
    if (trailingCall) {
      const finalNeed = trailingCall.rows.reduce(
        (sum, r) => sum + estimateRowHeightPts(r),
        0,
      ) + GAP_AFTER_TABLE + sigNeed
      if (y + finalNeed > pageBottom) {
        pdf.addPage()
        y = MARGIN_TOP
      }
      y = renderTable(trailingCall.callOffset, trailingCall.rows, y, { forceBreak: true })
    }
    offset += segment.length
  })

  // ---- Merge No + Ruang Lingkup per PAGE FRAGMENT (setelah pagination stabil) ----
  // Hanya BODY cell yang di-merge; area head tidak pernah tertutup. Merge
  // digambar dari koordinat cell nyata per halaman (rowGeom + bodyTop dari
  // didDrawCell). Grup dipecah per section (banner) agar Ruang Lingkup dari
  // section berbeda tidak pernah menyatu; fragment yang berlanjut ke halaman
  // berikutnya di-merge ulang di halaman tersebut (No + scope tetap diulang).
  const sectionStartIdx = []
  let lastSection = null
  doc.rows.forEach((row, idx) => {
    if (row.kind === 'section') lastSection = idx
    sectionStartIdx[idx] = lastSection
  })
  Object.keys(rowGeom).forEach((pageKey) => {
    const page = Number(pageKey)
    const entries = rowGeom[page].slice().sort((a, b) => a.idx - b.idx)
    pdf.setPage(page)
    let i = 0
    while (i < entries.length) {
      const baseEntry = entries[i]
      const baseRow = doc.rows[baseEntry.idx]
      if (!baseRow || baseRow.kind !== 'data' || baseEntry.w0 > 100) {
        i += 1
        continue
      }
      let j = i
      while (j + 1 < entries.length) {
        const nextEntry = entries[j + 1]
        const nextRow = doc.rows[nextEntry.idx]
        if (
          nextRow &&
          nextRow.kind === 'data' &&
          nextEntry.w0 <= 100 &&
          nextRow.section === baseRow.section &&
          nextRow.scope === baseRow.scope &&
          sectionStartIdx[nextEntry.idx] === sectionStartIdx[baseEntry.idx]
        ) {
          j += 1
        } else {
          break
        }
      }
      const group = entries.slice(i, j + 1)
      if (group.length > 1) {
        const bodyStart = bodyTop[page] ?? 0
        const topY = Math.max(group[0].y, bodyStart)
        const bottomY = group[group.length - 1].y + group[group.length - 1].height
        if (bottomY > topY) {
          const x0 = group[0].x0
          const w0 = group[0].w0
          const x1 = group[0].x1
          const w1 = group[0].w1
          const xEnd = x1 + w1
          pdf.setFillColor(255, 255, 255)
          pdf.rect(x0, topY, xEnd - x0, bottomY - topY, 'F')
          pdf.setDrawColor(0, 0, 0)
          pdf.setLineWidth(0.3)
          pdf.line(x0, topY, xEnd, topY)
          pdf.line(x0, bottomY, xEnd, bottomY)
          pdf.line(x0, topY, x0, bottomY)
          pdf.line(xEnd, topY, xEnd, bottomY)
          pdf.line(x0 + w0, topY, x0 + w0, bottomY)
          const noText = String(baseRow.cells[0] ?? '')
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(8)
          pdf.text(noText, x0 + w0 / 2, (topY + bottomY) / 2, {
            align: 'center',
            baseline: 'middle',
          })
          const scopeText = String(baseRow.cells[1] ?? '')
          const scopeLines = pdf.splitTextToSize(scopeText, w1 - 6)
          const lineHeight = 9.5
          const firstBaseline =
            (topY + bottomY) / 2 - ((scopeLines.length - 1) * lineHeight) / 2
          pdf.setFont('helvetica', 'normal')
          scopeLines.forEach((line, lineIndex) => {
            pdf.text(line, x1 + 3, firstBaseline + lineIndex * lineHeight, {
              baseline: 'middle',
            })
          })
        }
      }
      i = j + 1
    }
  })

  // ---- Signature: HANYA setelah seluruh section + TOTAL DENDA selesai ----
  // finalContentY = posisi bawah tabel terakhir (segmen terakhir berisi data
  // section terakhir + TOTAL DENDA SLA). Signature tidak pernah dipanggil dari
  // didDrawPage / didDrawCell / loop per section, dan fit check memakai tinggi
  // kolom TTD yang sesuai dengan posisi member terakhir aktual:
  // member terakhir berada di memberTop = 34 + (maxMembers-1)*memberStep,
  // namanya di memberTop + TTD_SPACE + 8 dan posisinya di + 20.
  const finalContentY = pdf.lastAutoTable?.finalY ?? y
  if (sigGroups.length > 0) {
    let sigY = finalContentY + GAP_AFTER_TABLE
    if (sigY + sigNeed > PAGE_H - MARGIN_BOTTOM) {
      pdf.addPage()
      sigY = MARGIN_TOP
    }
    sigGroupRows.forEach((rowGroups, ri) => {
      if (ri > 0) sigY += 16
      rowGroups.forEach((group, gi) => {
        const x = MARGIN_X + gi * (sigColW + sigColGap)
        const cx = x + sigColW / 2
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(10)
        pdf.text(group.title, cx, sigY + 14, { align: 'center' })
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(8.5)
        pdf.text(group.institution, cx, sigY + 26, { align: 'center' })
        let memberTop = sigY + 34
        group.members.forEach((member) => {
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(10)
          pdf.text(member.name, cx, memberTop + TTD_SPACE + 8, { align: 'center' })
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(8)
          pdf.text(member.position, cx, memberTop + TTD_SPACE + 20, { align: 'center' })
          memberTop += memberStep
        })
      })
      sigY += sigColH
    })
  }

  return {
    pdf,
    rowPages,
    rowGeom,
    bodyTop,
    bannerPages,
    segments: planned,
  }
}

export function buildPdf(doc) {
  const { pdf } = renderSlaPdf(doc)
  return new Uint8Array(pdf.output('arraybuffer'))
}
