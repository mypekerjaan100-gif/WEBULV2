import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Jalankan handler produksi dengan dependensi terkontrol, termasuk refresh
// yang tidak selesai, tanpa memanggil server atau membuat pengajuan sungguhan.
const source = readFileSync(new URL('../components/sla/SLALembur.jsx', import.meta.url), 'utf8')
const handler = source.slice(source.indexOf('  const runSubmitDraft = async () => {'), source.indexOf('  const submitDraft = () => {'))
const pending = () => new Promise(() => {})
let checks = 0
for (const isReplacement of [true, false]) {
  for (const isRevision of [false, true]) {
    for (const outcome of ['success', 'rejected', 'throws']) {
      for (const refreshMode of ['pending', 'throws']) {
        const states = []
        const busy = []
        const calls = []
        const submit = async (route) => {
          calls.push(route)
          if (outcome === 'throws' || (isRevision && outcome === 'rejected')) throw new Error('Server menolak')
          return { ok: outcome === 'success', message: 'Server menolak' }
        }
        const scope = {
          validateDraft: () => null, failValidation: () => assert.fail('Unexpected validation'),
          evidenceComplete: true, setValidationError: () => {}, setSubmitting: (value) => busy.push(value),
          setSubmitProcess: (value) => states.push(value), isRevision, isReplacement,
          isCrossPeriodDate: () => true, draft: { date: '2026-10-28' }, periodMonth: '2026-11-01',
          activeActivityId: 'draft-id', isEntryRevision: false, dirty: false,
          uploadStagedEvidence: async () => {}, resubmitOvertime: () => submit('revision'),
          onSubmit: () => submit('replacement'), onSubmitWork: () => submit('work'),
          isPartialApprovalRevision: false, resetForm: () => {}, setFormOpen: () => {},
          periodLabelForDate: () => 'Oktober 2026', setMessage: () => {}, setSavedCrossPeriodDate: () => {},
          onRefresh: () => { if (refreshMode === 'throws') throw new Error('Refresh gagal'); return pending() },
          activeActivityIdRef: { current: 'draft-id' }, refreshEvidence: pending,
          friendlySaveError: (message) => message,
        }
        const run = new Function(...Object.keys(scope), `${handler}; return runSubmitDraft`)(...Object.values(scope))
        let timer
        try {
          const result = await Promise.race([
            run(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Handler tertahan oleh refresh')), 1000) }),
          ])
          assert.equal(result, outcome === 'success')
          assert.deepEqual(states.map((state) => state.status), ['loading', outcome === 'success' ? 'success' : 'error'])
          assert.deepEqual(busy, [true, false])
          assert.deepEqual(calls, [isRevision ? 'revision' : isReplacement ? 'replacement' : 'work'])
          checks += 1
        } finally { clearTimeout(timer) }
      }
    }
  }
}
console.log(`Overtime submit process: ${checks} scenarios passed`)
