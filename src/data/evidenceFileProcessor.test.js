import { PDFDocument } from 'pdf-lib'
import {
  EVIDENCE_MAX_BYTES,
  processEvidenceFile,
} from './evidenceFileProcessor.js'

let passed = 0

function assert(condition, label) {
  if (!condition) throw new Error(label)
  passed += 1
}

const pdf = await PDFDocument.create()
pdf.addPage([300, 300]).drawText('Evidence PDF test')
const pdfFile = new File(
  [await pdf.save({ useObjectStreams: false })],
  'evidence.pdf',
  { type: 'application/pdf' },
)
const processedPdf = await processEvidenceFile(pdfFile, 'SPK')
assert(processedPdf.stored.sizeBytes <= EVIDENCE_MAX_BYTES, 'PDF <= 1 MB')
assert(processedPdf.stored.checksum.length === 64, 'SHA-256 generated')

const oversizedDocBytes = new Uint8Array(EVIDENCE_MAX_BYTES + 1)
oversizedDocBytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const oversizedDoc = new File(
  [oversizedDocBytes],
  'oversized.doc',
  { type: 'application/msword' },
)
let oversizedRejected = false
try {
  await processEvidenceFile(oversizedDoc, 'SPK')
} catch (error) {
  oversizedRejected = /1 MB/.test(error.message)
}
assert(oversizedRejected, 'Oversized document rejected clearly')

let malformedPdfRejected = false
try {
  await processEvidenceFile(
    new File([new Uint8Array([1, 2, 3])], 'malformed.pdf', { type: 'application/pdf' }),
    'SPK',
  )
} catch (error) {
  malformedPdfRejected = /tidak dapat dioptimalkan/.test(error.message)
}
assert(malformedPdfRejected, 'Malformed PDF rejected')

console.log(`${passed} evidence processor tests passed`)
