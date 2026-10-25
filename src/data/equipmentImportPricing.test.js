import assert from 'node:assert/strict'
import {
  autoCategoryMapping, buildEquipmentPreview, collectEquipmentCategories,
  openEquipmentFile, toEquipmentImportPayload,
} from './equipmentImport.js'

const csv = 'No,Nama Alat,Umur Peralatan,Satuan,Katagori,TOTAL,BPP,Cost/Month\n1,Straining Device,24,Unit,Peralatan Kerja,2.100.000,2.100.000,87.500\n'
const api = await openEquipmentFile(new File([csv], 'harga.csv', { type: 'text/csv' }))
const parsedRows = api.readRows(api.sheetNames[0])
assert.equal(parsedRows[0].category, 'Peralatan Kerja')
assert.equal(parsedRows[0].bpp, '2.100.000')
assert.equal(parsedRows[0].monthly, '87.500')

const categories = [{ id: 'cat-work', name: 'Peralatan Kerja', code: 'PK', isActive: true }]
const rows = [{
  __row: 2,
  name: 'Thermovison',
  age: '36',
  unit: 'Unit',
  category: 'Peralatan Kerja',
  bpp: '114.801.750',
  monthly: '2.391.703',
}]
const mapping = autoCategoryMapping(collectEquipmentCategories(rows), categories)
const preview = buildEquipmentPreview({
  rows, categories, mapping, existingRows: [], updateExisting: false,
})
assert.equal(preview.rows[0].status, 'new')
assert.equal(preview.rows[0].bppAmount, 114801750)
assert.equal(preview.rows[0].monthlyCost, 2391703)
assert.match(preview.rows[0].priceWarning, /berbeda dari BPP/)
const payload = toEquipmentImportPayload(preview.importable)
assert.equal(payload[0].bpp_amount, 114801750)
assert.equal(payload[0].monthly_cost, 2391703)

const existing = [{
  id: 'existing-1',
  name: 'Thermovison',
  categoryId: 'cat-work',
  unit: 'Unit',
  ageMonths: 36,
  bppAmount: null,
  monthlyCost: null,
}]
const updateRows = [{ ...rows[0], age: '' }]
const updatePreview = buildEquipmentPreview({
  rows: updateRows,
  categories,
  mapping: autoCategoryMapping(collectEquipmentCategories(updateRows), categories),
  existingRows: existing,
  updateExisting: true,
})
assert.equal(updatePreview.rows[0].status, 'update')
assert.equal(updatePreview.rows[0].ageMonths, null)
assert.match(updatePreview.rows[0].note, /BPP/)
const updatePayload = toEquipmentImportPayload(updatePreview.importable)
assert.equal(updatePayload[0].existing_id, 'existing-1')
assert.equal(updatePayload[0].age_months, null)
assert.equal(updatePayload[0].bpp_amount, 114801750)

console.log('Equipment import pricing tests passed')
