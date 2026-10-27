import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

const css = readFileSync(
  fileURLToPath(new URL('../styles/index.css', import.meta.url)),
  'utf8',
)

const summaryRule = css.match(/\.ui-confirm-summary\s*\{[^}]*\}/)?.[0] ?? ''
assert(summaryRule.length > 0, 'Aturan .ui-confirm-summary hilang')
assert(summaryRule.includes('background: var(--surface-subtle)'), 'Ringkasan konfirmasi wajib mengikuti tema (surface-subtle)')
assert(!summaryRule.includes('--color-surface-subtle'), 'Variabel surface-subtle yang salah tidak boleh dipakai')
assert(!summaryRule.includes('#f6f9fb'), 'Latar terang cadangan tidak boleh dipakai di dark mode')

assert(css.includes(":root[data-theme='dark'] .ui-confirm-warning"), 'Ikon peringatan wajib punya override dark mode')
assert(css.includes('.ui-confirm-icon { display: grid; width: 44px; height: 44px; flex: 0 0 44px; place-items: center; border-radius: 12px; background: var(--tone-info-bg)'),
  'Ikon konfirmasi wajib memakai tone info yang adaptif')

console.log(`uiConfirmationDark.test.js: ${passed} assertions passed`)
