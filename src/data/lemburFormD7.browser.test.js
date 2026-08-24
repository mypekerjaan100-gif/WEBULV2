import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const TEST_PASSWORD = process.env.LEMBUR_FORM_D7_TEST_PASSWORD
if (!TEST_PASSWORD) throw new Error('LEMBUR_FORM_D7_TEST_PASSWORD is required')

const CONTRACT_ID = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'
const UP3_ID = '3215235c-c194-43a1-84d2-25c767c75d7a'
const UNIT_ID = '27617d7d-795f-4f34-8edd-cc236ed49146'
const EXPIRED_DRAFT_ID = '19000000-0000-4000-8000-000000000001'

const server = await createServer({
  server: { host: '127.0.0.1', port: 4186 },
  logLevel: 'error',
  plugins: [{
    name: 'lembur-form-d7-test-page',
    configureServer(viteServer) {
      viteServer.middlewares.use('/lembur-form-d7-test', (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><title>Lembur form D+7 test</title>')
      })
    },
  }],
})

let browser
try {
  await server.listen()
  browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:4186/lembur-form-d7-test')
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 600
    const context = canvas.getContext('2d')
    context.fillStyle = '#164e63'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#fff'
    context.font = '42px sans-serif'
    context.fillText('Lembur D+7', 50, 300)
    return canvas.toDataURL('image/png').split(',')[1]
  }), 'base64')

  const setup = await page.evaluate(async ({ password, contractId, up3Id, unitId, expiredDraftId }) => {
    const { supabase } = await import('/src/lib/supabaseClient.js')
    const repository = await import('/src/data/overtimeReplacementRepository.js')
    const evidenceRepository = await import('/src/data/overtimeEvidenceRepository.js')
    const { error } = await supabase.auth.signInWithPassword({
      email: 'l5-rekap-ulp@example.invalid',
      password,
    })
    if (error) throw new Error(error.message)

    const employees = await repository.listReplacementEmployees({
      contractId,
      up3Id,
      startedAt: '2026-08-24T08:00:00+07:00',
    })
    const replaced = employees.find((employee) => employee.name === 'L5 TEST REPLACED')
    const participant = employees.find((employee) => employee.name === 'L5 TEST PARTICIPANT')
    if (!replaced || !participant) throw new Error('Fixture pegawai L5 tidak tersedia')

    let expiredSaveBlocked = false
    try {
      await repository.saveOvertimeReplacementDraft({
        activityId: null,
        contractId,
        up3Id,
        unitId,
        type: 'REPLACEMENT_LEAVE',
        replacedEmployeeId: replaced.id,
        participantEmployeeId: participant.id,
        startedAt: '2026-08-16T08:00:00+07:00',
        endedAt: '2026-08-16T10:00:00+07:00',
      })
    } catch (saveError) {
      expiredSaveBlocked = /Batas pengajuan telah lewat/.test(saveError.message)
    }
    if (!expiredSaveBlocked) throw new Error('Draft baru lewat D+7 tidak diblokir server')

    let expiredSubmitBlocked = false
    try {
      await repository.submitOvertimeReplacement(expiredDraftId)
    } catch (submitError) {
      expiredSubmitBlocked = /Batas pengajuan telah lewat/.test(submitError.message)
    }
    if (!expiredSubmitBlocked) throw new Error('Submit Draft lewat D+7 tidak diblokir server')

    let expiredEvidenceBlocked = false
    try {
      const file = new File([new Uint8Array([1, 2, 3])], 'expired.pdf', { type: 'application/pdf' })
      await evidenceRepository.uploadOvertimeEvidence({
        activityId: expiredDraftId,
        evidenceType: 'FORM_CUTI',
        file,
      })
    } catch (evidenceError) {
      expiredEvidenceBlocked = /Batas pengajuan|revisi telah lewat/.test(evidenceError.message)
    }
    if (!expiredEvidenceBlocked) throw new Error('Evidence Draft lewat D+7 tidak diblokir server')

    await repository.expireInitialOvertimeDrafts({ contractId, up3Id, unitId })
    const records = await repository.listOvertimeReplacements({
      contractId,
      up3Id,
      unitId,
      periodMonth: '2026-08-01',
    })
    const expired = records.find((record) => record.id === expiredDraftId)
    if (expired?.status !== 'CLOSED' || expired.closureReason !== 'EXPIRED') {
      throw new Error('Draft lama tidak berubah menjadi CLOSED/EXPIRED')
    }

    const { default: RefreshRuntime } = await import('/@react-refresh')
    RefreshRuntime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    const ReactModule = await import('/node_modules/.vite/deps/react.js')
    const React = ReactModule.default ?? ReactModule
    const ReactDOMClient = await import('/node_modules/.vite/deps/react-dom_client.js')
    const createRoot = ReactDOMClient.createRoot ?? ReactDOMClient.default?.createRoot
    const { default: SLALembur } = await import('/src/components/sla/SLALembur.jsx')
    window.__lemburFormD7Ids = []
    document.body.innerHTML = '<main id="lembur-form-d7-root"></main>'
    createRoot(document.getElementById('lembur-form-d7-root')).render(React.createElement(SLALembur, {
      contractScope: { contractId, contractName: 'Pelayanan Teknik' },
      up3Id,
      unitId,
      periodMonth: '2026-08-01',
      records,
      canMutate: true,
      loading: false,
      loadError: '',
      orgUnits: [],
      onRetry: () => {},
      onRefresh: async () => {},
      onSaveDraft: async (activityId, draft) => {
        try {
          const id = await repository.saveOvertimeReplacementDraft({
            activityId,
            contractId,
            up3Id,
            ...draft,
          })
          if (!activityId) window.__lemburFormD7Ids.push(id)
          return { ok: true, activityId: id, message: 'Draft disimpan.' }
        } catch (saveError) {
          return { ok: false, message: saveError.message }
        }
      },
      onSubmit: async (activityId) => {
        try {
          await repository.submitOvertimeReplacement(activityId)
          return { ok: true, message: 'Lembur diajukan.' }
        } catch (submitError) {
          return { ok: false, message: submitError.message }
        }
      },
      onSaveWorkDraft: async () => ({ ok: false, message: 'Tidak digunakan' }),
      onSubmitWork: async () => ({ ok: false, message: 'Tidak digunakan' }),
    }))

    return { replacedId: replaced.id, participantId: participant.id }
  }, {
    password: TEST_PASSWORD,
    contractId: CONTRACT_ID,
    up3Id: UP3_ID,
    unitId: UNIT_ID,
    expiredDraftId: EXPIRED_DRAFT_ID,
  })

  await page.waitForSelector('.lembur-form-card')
  const typeSelect = page.locator('label').filter({ hasText: 'Jenis Lembur' }).locator('select')
  const dateInput = page.locator('label').filter({ hasText: 'Tanggal Lembur' }).locator('input')
  await typeSelect.selectOption('REPLACEMENT_LEAVE')
  if (!await page.getByText('Form Cuti *', { exact: true }).isVisible()) {
    throw new Error('Evidence tidak terlihat sebelum Draft disimpan')
  }
  if (await page.getByRole('button', { name: 'Simpan Draft', exact: true }).count() !== 1
      || await page.getByRole('button', { name: 'Ajukan Lembur', exact: true }).count() !== 1) {
    throw new Error('Action form terduplikasi')
  }
  const actionsFollowEvidence = await page.evaluate(() => {
    const evidence = document.querySelector('.lembur-evidence-panel')
    const actions = document.querySelector('.lembur-form-actions')
    return Boolean(evidence && actions && (evidence.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING))
  })
  if (!actionsFollowEvidence) throw new Error('Action tidak berada setelah evidence')

  await dateInput.fill('2026-08-16')
  await page.getByText('Batas pengajuan telah lewat.', { exact: true }).first().waitFor()
  if (!await page.getByRole('button', { name: 'Simpan Draft', exact: true }).isDisabled()) throw new Error('Simpan Draft tanggal kedaluwarsa aktif')
  if (!await page.getByRole('button', { name: 'Ajukan Lembur', exact: true }).isDisabled()) throw new Error('Submit tanggal kedaluwarsa aktif')
  if (!await page.locator('.lembur-evidence-panel input[type=file]').isDisabled()) throw new Error('Input evidence tanggal kedaluwarsa aktif')

  async function completeValidForm(startTime, endTime, filename) {
    await dateInput.fill('2026-08-24')
    const replacedSelect = page.locator('label').filter({ hasText: 'Pegawai yang Digantikan' }).locator('select')
    await replacedSelect.locator(`option[value="${setup.replacedId}"]`).waitFor({ state: 'attached' })
    await replacedSelect.selectOption(setup.replacedId)
    await page.locator('label').filter({ hasText: 'Pegawai yang Lembur / Pengganti' }).locator('select').selectOption(setup.participantId)
    await page.locator('label').filter({ hasText: 'Jam Mulai' }).locator('input').fill(startTime)
    await page.locator('label').filter({ hasText: 'Jam Selesai' }).locator('input').fill(endTime)
    await page.locator('.lembur-evidence-panel input[type=file]').setInputFiles({
      name: filename,
      mimeType: 'image/png',
      buffer: png,
    })
    await page.waitForTimeout(1000)
    if (!(await page.locator('body').innerText()).includes('siap disimpan')) {
      throw new Error(`Evidence staging gagal: ${await page.locator('.lembur-message').last().innerText()}`)
    }
  }

  await completeValidForm('08:00', '10:00', 'form-cuti-draft.png')
  await page.getByRole('button', { name: 'Simpan Draft', exact: true }).click()
  await page.getByText('Draft dan evidence berhasil disimpan di Supabase.', { exact: true }).waitFor()

  await page.getByRole('button', { name: 'Draft Baru', exact: true }).click()
  await typeSelect.selectOption('REPLACEMENT_LEAVE')
  await completeValidForm('10:00', '12:00', 'form-cuti-submit.png')
  await page.getByRole('button', { name: 'Ajukan Lembur', exact: true }).click()
  await page.getByText('Lembur diajukan dan menunggu approval.', { exact: true }).waitFor()

  const result = await page.evaluate(async ({ password, contractId, up3Id, unitId }) => {
    const { supabase } = await import('/src/lib/supabaseClient.js')
    const repository = await import('/src/data/overtimeReplacementRepository.js')
    const evidenceRepository = await import('/src/data/overtimeEvidenceRepository.js')
    async function signIn(role) {
      await supabase.auth.signOut()
      const { error } = await supabase.auth.signInWithPassword({
        email: `l5-rekap-${role}@example.invalid`,
        password,
      })
      if (error) throw new Error(error.message)
    }
    async function makeImage(name) {
      const canvas = document.createElement('canvas')
      canvas.width = 900
      canvas.height = 600
      const context = canvas.getContext('2d')
      context.fillStyle = '#164e63'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#fff'
      context.font = '42px sans-serif'
      context.fillText(name, 50, 300)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      return new File([blob], name, { type: 'image/png' })
    }
    const [draftId, submittedId] = window.__lemburFormD7Ids
    const records = await repository.listOvertimeReplacements({
      contractId,
      up3Id,
      unitId,
      periodMonth: '2026-08-01',
    })
    const draft = records.find((record) => record.id === draftId)
    const submitted = records.find((record) => record.id === submittedId)
    const draftEvidence = await evidenceRepository.listOvertimeEvidence(draftId)
    const submittedEvidence = await evidenceRepository.listOvertimeEvidence(submittedId)
    if (draft?.status !== 'DRAFT' || draftEvidence.filter((entry) => entry.status === 'ACTIVE').length !== 1) {
      throw new Error('Save Draft/evidence tidak persisten setelah refresh')
    }
    if (submitted?.status !== 'SUBMITTED' || submittedEvidence.filter((entry) => entry.status === 'ACTIVE').length !== 1) {
      throw new Error('Direct Submit/evidence tidak persisten')
    }
    const signed = await evidenceRepository.createOvertimeEvidenceSignedUrl(submittedEvidence[0].id)
    if (signed.expiresIn !== 300 || !(await fetch(signed.signedUrl)).ok) {
      throw new Error('Signed preview evidence L1 gagal')
    }

    const employees = await repository.listReplacementEmployees({
      contractId,
      up3Id,
      startedAt: '2026-08-24T08:00:00+07:00',
    })
    const admin = employees.find((employee) => employee.name === 'L5 TEST ADMIN')
    if (!admin) throw new Error('Fixture Administrasi tidak tersedia')
    const workId = await repository.saveOvertimeWorkDraft({
      activityId: null,
      contractId,
      up3Id,
      unitId,
      workCategory: 'ADMINISTRASI',
      description: 'Regresi L3 alur form D+7',
      workTitle: null,
      workLocation: null,
      participants: [{
        employee_id: admin.id,
        started_at: '2026-08-24T18:00:00+07:00',
        ended_at: '2026-08-24T20:00:00+07:00',
      }],
    })
    await evidenceRepository.uploadOvertimeEvidence({ activityId: workId, evidenceType: 'FOTO_SEBELUM', file: await makeImage('sebelum.png') })
    await evidenceRepository.uploadOvertimeEvidence({ activityId: workId, evidenceType: 'FOTO_SESUDAH', file: await makeImage('sesudah.png') })
    await repository.submitOvertimeWork(workId)
    const workRows = await repository.listOvertimeWork({ contractId, up3Id, unitId, periodMonth: '2026-08-01' })
    if (workRows.find((record) => record.id === workId)?.status !== 'SUBMITTED') {
      throw new Error('Regresi L3/L4 gagal')
    }

    await signIn('up3')
    await repository.rejectOvertime(submittedId, 'Regresi deadline revisi D+3')
    let revisionRows = await repository.listOvertimeReplacements({ contractId, up3Id, unitId, periodMonth: '2026-08-01' })
    const revision = revisionRows.find((record) => record.id === submittedId)
    const revisionRemaining = new Date(revision?.revisionDeadlineAt) - new Date()
    if (revision?.status !== 'CORRECTION_REQUIRED' || revision.rejectionCount !== 1
        || revisionRemaining < 2 * 24 * 60 * 60 * 1000
        || revisionRemaining > 4 * 24 * 60 * 60 * 1000) {
      throw new Error('Regresi deadline revisi D+3 gagal')
    }
    await signIn('ulp')
    await repository.resubmitOvertime(submittedId)
    await signIn('up3')
    await repository.approveOvertime(submittedId)
    revisionRows = await repository.listOvertimeReplacements({ contractId, up3Id, unitId, periodMonth: '2026-08-01' })
    if (revisionRows.find((record) => record.id === submittedId)?.status !== 'APPROVED') {
      throw new Error('Regresi L5 approval gagal')
    }

    return { draftId, submittedId, workId, signedUrlSeconds: signed.expiresIn }
  }, { password: TEST_PASSWORD, contractId: CONTRACT_ID, up3Id: UP3_ID, unitId: UNIT_ID })

  console.log(`Lembur form D+7 integration passed: ${JSON.stringify(result)}`)
} finally {
  if (browser) await browser.close()
  await server.close()
}
