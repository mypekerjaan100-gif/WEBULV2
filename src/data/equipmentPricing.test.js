import assert from 'node:assert/strict'
import {
  effectiveMonthlyCost, expectedMonthlyCost, formatRupiah, parseRupiahAmount,
  priceMismatch, templateCostSummary,
} from './equipmentPricing.js'

assert.equal(parseRupiahAmount('2.100.000').value, 2100000)
assert.equal(parseRupiahAmount('Rp 2.100.000').value, 2100000)
assert.equal(parseRupiahAmount('2.100.000,-').value, 2100000)
assert.equal(parseRupiahAmount('1.234,56').value, 1234.56)
assert.equal(parseRupiahAmount('1,234.56').value, 1234.56)
assert.equal(parseRupiahAmount('2100000').value, 2100000)
assert.equal(parseRupiahAmount('').value, null)
assert.match(parseRupiahAmount('abc').error, /angka/)
assert.match(parseRupiahAmount('-1').error, /negatif/)
assert.equal(formatRupiah(2100000), 'Rp 2.100.000')
assert.equal(formatRupiah(null), '—')
assert.equal(expectedMonthlyCost(2100000, 24), 87500)
assert.equal(expectedMonthlyCost(157500, 24), 6562.5)
assert.equal(expectedMonthlyCost(100, 0), null)
assert.equal(expectedMonthlyCost(null, 24), null)
assert.equal(expectedMonthlyCost(2100000, null), null)
assert.equal(effectiveMonthlyCost({ monthlyCost: 2391703, bppAmount: 114801750, ageMonths: 36 }), 2391703)
assert.equal(effectiveMonthlyCost({ monthlyCost: null, bppAmount: 2100000, ageMonths: 24 }), 87500)
assert.deepEqual(priceMismatch({ monthlyCost: 2391703, bppAmount: 114801750, ageMonths: 36 }), {
  expected: 3188937.5,
  difference: 797235,
})
assert.equal(priceMismatch({ monthlyCost: 87500, bppAmount: 2100000, ageMonths: 24 }), null)
assert.equal(priceMismatch({ monthlyCost: null, bppAmount: 2100000, ageMonths: 24 }), null)
assert.equal(priceMismatch({ monthlyCost: '', bppAmount: 2100000, ageMonths: 24 }), null)
assert.deepEqual(templateCostSummary([
  { monthlyCost: 87500, requiredQty: 2 },
  { bppAmount: 2100000, ageMonths: 24, requiredQty: 1 },
]), { total: 262500, incomplete: 0 })
assert.deepEqual(templateCostSummary([{ requiredQty: 2 }]), { total: 0, incomplete: 1 })

console.log('Equipment pricing tests passed')
