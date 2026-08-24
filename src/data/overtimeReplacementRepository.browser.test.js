import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const TEST_PASSWORD = process.env.L2_REPLACEMENT_TEST_PASSWORD
if (!TEST_PASSWORD) throw new Error('L2_REPLACEMENT_TEST_PASSWORD is required')
const CLEANUP_ACTIVITY_IDS = (process.env.L2_REPLACEMENT_CLEANUP_IDS ?? '')
  .split(',')
  .filter(Boolean)
const CLEANUP_ONLY = process.env.L2_REPLACEMENT_CLEANUP_ONLY === '1'

const CONTRACT_ID = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'
const UP3_ID = '3215235c-c194-43a1-84d2-25c767c75d7a'
const OWN_UNIT_ID = '27617d7d-795f-4f34-8edd-cc236ed49146'
const CROSS_UP3_ID = '90000000-0000-4000-8000-000000000001'

const server = await createServer({
  server: { host: '127.0.0.1', port: 4181 },
  logLevel: 'error',
  plugins: [{
    name: 'overtime-replacement-l2-test-page',
    configureServer(viteServer) {
      viteServer.middlewares.use('/overtime-replacement-l2-test', (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><title>Overtime replacement L2 test</title>')
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
  await page.goto('http://127.0.0.1:4181/overtime-replacement-l2-test')

  const result = await page.evaluate(async ({ password, contractId, up3Id, ownUnitId, crossUp3Id, cleanupActivityIds, cleanupOnly }) => {
    const { supabase } = await import('/src/lib/supabaseClient.js')
    const replacements = await import('/src/data/overtimeReplacementRepository.js')
    const evidenceRepository = await import('/src/data/overtimeEvidenceRepository.js')

    async function signIn(role) {
      await supabase.auth.signOut()
      const { error } = await supabase.auth.signInWithPassword({
        email: `l2-replacement-${role}@example.invalid`,
        password,
      })
      if (error) throw new Error(`${role} sign-in failed: ${error.message}`)
    }

    async function makeImage(name) {
      const canvas = document.createElement('canvas')
      canvas.width = 900
      canvas.height = 600
      const context = canvas.getContext('2d')
      context.fillStyle = '#164e63'
      context.fillRect(0, 0, 900, 600)
      context.fillStyle = '#fff'
      context.font = '42px sans-serif'
      context.fillText(name, 50, 300)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      return new File([blob], name, { type: 'image/png' })
    }

    async function createDraft(type, date, start, end) {
      return replacements.saveOvertimeReplacementDraft({
        activityId: null,
        contractId,
        up3Id,
        unitId: ownUnitId,
        type,
        replacedEmployeeId: replacedEmployee.id,
        participantEmployeeId: participantEmployee.id,
        startedAt: `${date}T${start}:00+07:00`,
        endedAt: `${end.date ?? date}T${end.time}:00+07:00`,
      })
    }

    async function upload(activityId, evidenceType) {
      return evidenceRepository.uploadOvertimeEvidence({
        activityId,
        evidenceType,
        file: await makeImage(`${evidenceType}.png`),
      })
    }

    await signIn('ulp')
    for (const activityId of cleanupActivityIds) {
      const oldEvidence = await evidenceRepository.listOvertimeEvidence(activityId)
      for (const entry of oldEvidence) await evidenceRepository.deleteOvertimeEvidence(entry.id)
    }
    if (cleanupOnly) {
      await supabase.auth.signOut()
      return { cleanupOnly: true, activityCount: cleanupActivityIds.length }
    }
    const employees = await replacements.listReplacementEmployees({
      contractId,
      up3Id,
      startedAt: '2026-08-20T08:00:00+07:00',
    })
    if (employees.length < 2) throw new Error('Own ULP employee picker has fewer than two employees')
    if (employees.some((employee) => employee.unitId !== ownUnitId)) {
      throw new Error('Cross-ULP employee leaked into ADMIN_ULP picker')
    }
    if (employees.some((employee) => 'rate' in employee || 'hourlyRate' in employee)) {
      throw new Error('ADMIN_ULP employee picker exposes hourly rate')
    }
    const replacedEmployee = employees.find((employee) => employee.name === 'L2 TEST REPLACED')
    const participantEmployee = employees.find((employee) => employee.name === 'L2 TEST PARTICIPANT')
    if (!replacedEmployee || !participantEmployee) throw new Error('Controlled employee fixtures are unavailable')

    const { error: directFinancialError } = await supabase
      .from('overtime_entries')
      .select('hourly_rate_snapshot,multiplier_hours_snapshot')
      .limit(1)
    if (!directFinancialError) throw new Error('ADMIN_ULP can directly query financial calculation snapshots')

    let sameEmployeeDenied = false
    try {
      await replacements.saveOvertimeReplacementDraft({
        activityId: null,
        contractId,
        up3Id,
        unitId: ownUnitId,
        type: 'REPLACEMENT_LEAVE',
        replacedEmployeeId: replacedEmployee.id,
        participantEmployeeId: replacedEmployee.id,
        startedAt: '2026-08-20T08:00:00+07:00',
        endedAt: '2026-08-20T09:30:00+07:00',
      })
    } catch (error) {
      sameEmployeeDenied = /distinct/.test(error.message)
    }
    if (!sameEmployeeDenied) throw new Error('Same employee replacement was not denied')

    const leaveId = await createDraft('REPLACEMENT_LEAVE', '2026-08-20', '08:00', { time: '09:30' })
    let rows = await replacements.listOvertimeReplacements({ contractId, up3Id, unitId: ownUnitId, periodMonth: '2026-08-01' })
    const leaveDraft = rows.find((row) => row.id === leaveId)
    if (!leaveDraft || leaveDraft.status !== 'DRAFT') throw new Error('Leave Draft was not persisted')
    const expectedDescription = `${participantEmployee.name} menggantikan ${replacedEmployee.name} yang cuti pada 20 Agustus 2026 pukul 08:00–09:30.`
    if (leaveDraft.description !== expectedDescription) throw new Error(`Automatic description mismatch: ${leaveDraft.description}`)

    await signIn('ulp')
    rows = await replacements.listOvertimeReplacements({ contractId, up3Id, unitId: ownUnitId, periodMonth: '2026-08-01' })
    if (!rows.some((row) => row.id === leaveId)) throw new Error('Refresh persistence failed')

    let leaveEvidenceRequired = false
    try {
      await replacements.submitOvertimeReplacement(leaveId)
    } catch (error) {
      leaveEvidenceRequired = /FORM_CUTI/.test(error.message)
    }
    if (!leaveEvidenceRequired) throw new Error('Leave submit was not blocked without Form Cuti')
    const leaveEvidence = await upload(leaveId, 'FORM_CUTI')
    if (leaveEvidence.storedSizeBytes > 1024 * 1024) throw new Error('Leave evidence exceeds 1 MB')
    const signed = await evidenceRepository.createOvertimeEvidenceSignedUrl(leaveEvidence.id)
    if (signed.expiresIn !== 300 || !(await fetch(signed.signedUrl)).ok) throw new Error('Signed preview failed')
    await replacements.submitOvertimeReplacement(leaveId)

    const sickId = await createDraft('REPLACEMENT_SICK', '2026-08-21', '18:00', { time: '20:00' })
    await upload(sickId, 'FORM_SAKIT')
    let sickSecondRequired = false
    try {
      await replacements.submitOvertimeReplacement(sickId)
    } catch (error) {
      sickSecondRequired = /SURAT_SAKIT/.test(error.message)
    }
    if (!sickSecondRequired) throw new Error('Sick submit was not blocked without Surat Sakit')
    await upload(sickId, 'SURAT_SAKIT')
    await replacements.submitOvertimeReplacement(sickId)

    const permissionId = await createDraft('REPLACEMENT_PERMISSION', '2026-08-22', '18:00', { time: '20:00' })
    await upload(permissionId, 'FORM_IZIN')
    let permissionSecondRequired = false
    try {
      await replacements.submitOvertimeReplacement(permissionId)
    } catch (error) {
      permissionSecondRequired = /SURAT_IZIN/.test(error.message)
    }
    if (!permissionSecondRequired) throw new Error('Permission submit was not blocked without Surat Izin')
    await upload(permissionId, 'SURAT_IZIN')
    await replacements.submitOvertimeReplacement(permissionId)

    const expiredId = await createDraft('REPLACEMENT_LEAVE', '2026-08-01', '08:00', { time: '10:00' })
    let deadlineDenied = false
    try {
      await replacements.submitOvertimeReplacement(expiredId)
    } catch (error) {
      deadlineDenied = /deadline has passed/.test(error.message)
    }
    if (!deadlineDenied) throw new Error('D+7 deadline was not enforced')

    const fractionalMinuteId = await createDraft('REPLACEMENT_LEAVE', '2026-08-23', '10:00', { time: '11:17' })

    const crossMonthId = await createDraft('REPLACEMENT_LEAVE', '2026-08-31', '22:00', {
      date: '2026-09-01',
      time: '02:00',
    })
    rows = await replacements.listOvertimeReplacements({ contractId, up3Id, unitId: ownUnitId, periodMonth: '2026-08-01' })
    const crossMonth = rows.find((row) => row.id === crossMonthId)
    if (!crossMonth || crossMonth.durationHours !== 4 || crossMonth.periodMonth !== '2026-08-01') {
      throw new Error('Cross-month duration/reporting period is incorrect')
    }

    await signIn('up3')
    const up3Rows = await replacements.listOvertimeReplacements({ contractId, up3Id, unitId: null, periodMonth: '2026-08-01' })
    if (![leaveId, sickId, permissionId].every((id) => up3Rows.some((row) => row.id === id))) {
      throw new Error('ADMIN_UP3 cannot read own-UP3 records')
    }
    const up3Employees = await replacements.listReplacementEmployees({
      contractId,
      up3Id,
      startedAt: '2026-08-20T08:00:00+07:00',
    })
    if (new Set(up3Employees.map((employee) => employee.unitId)).size < 2) {
      throw new Error('ADMIN_UP3 picker does not include authorized child ULPs')
    }
    const crossRows = await replacements.listOvertimeReplacements({
      contractId,
      up3Id: crossUp3Id,
      unitId: null,
      periodMonth: '2026-08-01',
    })
    if (crossRows.length) throw new Error('Cross-UP3 records were readable')

    await signIn('ulp')
    const uiRows = await replacements.listOvertimeReplacements({
      contractId,
      up3Id,
      unitId: ownUnitId,
      periodMonth: '2026-08-01',
    })
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
    document.body.innerHTML = '<main id="l2-ui-test"></main>'
    createRoot(document.getElementById('l2-ui-test')).render(React.createElement(SLALembur, {
      contractScope: { contractId, contractName: 'Pelayanan Teknik' },
      up3Id,
      unitId: ownUnitId,
      periodMonth: '2026-08-01',
      records: uiRows,
      canMutate: true,
      loading: false,
      loadError: '',
      onRetry: () => {},
      onSaveDraft: async () => ({ ok: false, message: 'UI smoke only' }),
      onSubmit: async () => ({ ok: false, message: 'UI smoke only' }),
    }))

    return {
      activityIds: [leaveId, sickId, permissionId, expiredId, fractionalMinuteId, crossMonthId],
      participantEmployeeId: participantEmployee.id,
      evidenceSize: leaveEvidence.storedSizeBytes,
      signedUrlSeconds: signed.expiresIn,
      sameEmployeeDenied,
      deadlineDenied,
      ownUlpEmployeeCount: employees.length,
      up3EmployeeUnits: new Set(up3Employees.map((employee) => employee.unitId)).size,
    }
  }, {
    password: TEST_PASSWORD,
    contractId: CONTRACT_ID,
    up3Id: UP3_ID,
    ownUnitId: OWN_UNIT_ID,
    crossUp3Id: CROSS_UP3_ID,
    cleanupActivityIds: CLEANUP_ACTIVITY_IDS,
    cleanupOnly: CLEANUP_ONLY,
  })

  if (result.cleanupOnly) {
    console.log(`Overtime replacement L2 cleanup passed: ${JSON.stringify(result)}`)
  } else {
    await page.waitForSelector('.lembur-form-card')
  const typeSelect = page.locator('label').filter({ hasText: 'Jenis Lembur' }).locator('select')
  const typeOptions = await typeSelect.locator('option').allTextContents()
  for (const label of ['Pengganti Cuti', 'Pengganti Sakit', 'Pengganti Izin', 'Lembur Pekerjaan (segera di L3)']) {
    if (!typeOptions.includes(label)) throw new Error(`Missing Lembur type option: ${label}`)
  }
  if (!(await typeSelect.locator('option[value="WORK"]').evaluate((option) => option.disabled))) {
    throw new Error('Lembur Pekerjaan is not a disabled L3 placeholder')
  }
  await typeSelect.selectOption('REPLACEMENT_LEAVE')
  const replacedSelect = page.locator('label').filter({ hasText: 'Pegawai yang Digantikan' }).locator('select')
  await replacedSelect.locator('option[value="12000000-0000-4000-8000-000000000001"]').waitFor({ state: 'attached' })
  await replacedSelect.selectOption('12000000-0000-4000-8000-000000000001')
  const participantSelect = page.locator('label').filter({ hasText: 'Pegawai yang Lembur / Pengganti' }).locator('select')
  await participantSelect.selectOption('12000000-0000-4000-8000-000000000002')
  await page.locator('label').filter({ hasText: 'Jam Selesai' }).locator('input').fill('09:30')
  await page.waitForFunction(() => document.body.textContent.includes('1 jam 30 menit'))
  const bodyText = await page.locator('body').innerText()
  if (!bodyText.includes('L2 TEST PARTICIPANT menggantikan L2 TEST REPLACED yang cuti')) {
    throw new Error('Automatic description is not visible in the input form')
  }
  if (/Tarif\/Jam|hourly rate|1\.5x|2x/i.test(bodyText)) {
    throw new Error('ADMIN_ULP form leaks hourly rate or calculation detail')
  }
  if (await page.locator('label').filter({ hasText: /^Keterangan/ }).count()) {
    throw new Error('Manual Keterangan input is present')
  }

    console.log(`Overtime replacement L2 integration passed: ${JSON.stringify({ ...result, uiSmoke: true })}`)
  }
} finally {
  if (browser) await browser.close()
  await server.close()
}
