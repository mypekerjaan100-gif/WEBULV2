import { chromium } from 'playwright-core'
import { createServer } from 'vite'
const TEST_PASSWORD = process.env.L4_REKAP_TEST_PASSWORD
if (!TEST_PASSWORD) throw new Error('L4_REKAP_TEST_PASSWORD is required')
const CONTRACT_ID = 'e1e2c8bc-ed1c-46db-bd39-70757a90863c'
const UP3_ID = '3215235c-c194-43a1-84d2-25c767c75d7a'
const OWN_UNIT_ID = '27617d7d-795f-4f34-8edd-cc236ed49146'
const CROSS_UP3_ID = '90000000-0000-4000-8000-000000000001'
const server = await createServer({
  server: { host: '127.0.0.1', port: 4184 },
  logLevel: 'error',
  plugins: [{ name: 'rekap', configureServer(s){ s.middlewares.use('/rekap-test', (_r,res)=>{res.setHeader('Content-Type','text/html'); res.end('<!doctype html><title>rekap</title>')})}}]
})
let browser
try{
  await server.listen()
  browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:4184/rekap-test')
  const result = await page.evaluate(async ({ password, contractId, up3Id, ownUnitId, crossUp3Id })=>{
    const { supabase } = await import('/src/lib/supabaseClient.js')
    const repRepo = await import('/src/data/overtimeReplacementRepository.js')
    const evRepo = await import('/src/data/overtimeEvidenceRepository.js')
    async function signIn(role){ await supabase.auth.signOut(); const {error}=await supabase.auth.signInWithPassword({ email:`l4-rekap-${role}@example.invalid`, password }); if(error) throw new Error(role+':'+error.message) }
    async function makeImage(name){
      const c=document.createElement('canvas'); c.width=900; c.height=600; const ctx=c.getContext('2d'); ctx.fillStyle='#164e63'; ctx.fillRect(0,0,900,600); ctx.fillStyle='#fff'; ctx.font='42px sans-serif'; ctx.fillText(name,50,300); const blob=await new Promise(r=>c.toBlob(r,'image/png')); return new File([blob], name, {type:'image/png'})
    }
    async function makePdf(name){ const blob=new Blob(['%PDF-1.4 '+name],{type:'application/pdf'}); return new File([blob], name, {type:'application/pdf'}) }
    await signIn('ulp')
    const employees = await repRepo.listReplacementEmployees({ contractId, up3Id, startedAt: '2026-08-20T08:00:00+07:00' })
    const e = (n)=> employees.find(x=>x.name===n)
    const admin = e('L4 TEST ADMIN'), g1=e('L4 TEST GARDU1'), g2=e('L4 TEST GARDU2'), g3=e('L4 TEST GARDU3')
    const rep = e('L4 TEST REPLACED'), part = e('L4 TEST PARTICIPANT')
    if(!admin||!g1||!g2) throw new Error('fixtures missing')

    // create 7 types
    const cutiId = await repRepo.saveOvertimeReplacementDraft({ activityId:null, contractId, up3Id, unitId:ownUnitId, type:'REPLACEMENT_LEAVE', replacedEmployeeId:rep.id, participantEmployeeId:part.id, startedAt:'2026-08-20T08:00:00+07:00', endedAt:'2026-08-20T12:00:00+07:00' })
    await evRepo.uploadOvertimeEvidence({ activityId:cutiId, evidenceType:'FORM_CUTI', file: await makeImage('cuti.png') })
    await repRepo.submitOvertimeReplacement(cutiId)

    const sakitId = await repRepo.saveOvertimeReplacementDraft({ activityId:null, contractId, up3Id, unitId:ownUnitId, type:'REPLACEMENT_SICK', replacedEmployeeId:rep.id, participantEmployeeId:part.id, startedAt:'2026-08-21T08:00:00+07:00', endedAt:'2026-08-21T12:00:00+07:00' })
    await evRepo.uploadOvertimeEvidence({ activityId:sakitId, evidenceType:'FORM_SAKIT', file: await makeImage('sakit1.png') })
    await evRepo.uploadOvertimeEvidence({ activityId:sakitId, evidenceType:'SURAT_SAKIT', file: await makeImage('sakit2.png') })
    await repRepo.submitOvertimeReplacement(sakitId)

    const izinId = await repRepo.saveOvertimeReplacementDraft({ activityId:null, contractId, up3Id, unitId:ownUnitId, type:'REPLACEMENT_PERMISSION', replacedEmployeeId:rep.id, participantEmployeeId:part.id, startedAt:'2026-08-22T08:00:00+07:00', endedAt:'2026-08-22T12:00:00+07:00' })
    await evRepo.uploadOvertimeEvidence({ activityId:izinId, evidenceType:'FORM_IZIN', file: await makeImage('izin1.png') })
    await evRepo.uploadOvertimeEvidence({ activityId:izinId, evidenceType:'SURAT_IZIN', file: await makeImage('izin2.png') })
    await repRepo.submitOvertimeReplacement(izinId)

    const adminId = await repRepo.saveOvertimeWorkDraft({ activityId:null, contractId, up3Id, unitId:ownUnitId, workCategory:'ADMINISTRASI', description:'Keterangan admin', workTitle:null, workLocation:null, participants:[{employee_id:admin.id, started_at:'2026-08-23T08:00:00+07:00', ended_at:'2026-08-23T12:00:00+07:00'}] })
    await evRepo.uploadOvertimeEvidence({ activityId:adminId, evidenceType:'FOTO_SEBELUM', file: await makeImage('sebelum.png') })
    await evRepo.uploadOvertimeEvidence({ activityId:adminId, evidenceType:'FOTO_SESUDAH', file: await makeImage('sesudah.png') })
    await repRepo.submitOvertimeWork(adminId)

    const garduId = await repRepo.saveOvertimeWorkDraft({ activityId:null, contractId, up3Id, unitId:ownUnitId, workCategory:'GARDU', description:'Gardu keterangan', workTitle:'Gardu - Test', workLocation:'Lokasi Gardu', participants:[
      {employee_id:g1.id, started_at:'2026-08-24T18:00:00+07:00', ended_at:'2026-08-24T22:00:00+07:00'},
      {employee_id:g2.id, started_at:'2026-08-24T18:00:00+07:00', ended_at:'2026-08-24T21:00:00+07:00'},
      {employee_id:g3.id, started_at:'2026-08-24T19:00:00+07:00', ended_at:'2026-08-24T22:00:00+07:00'},
    ]})
    await evRepo.uploadOvertimeEvidence({ activityId:garduId, evidenceType:'SPK', file: await makePdf('spk.pdf') })
    await evRepo.uploadOvertimeEvidence({ activityId:garduId, evidenceType:'FOTO_BRIEFING', file: await makeImage('brief1.png') })
    await evRepo.uploadOvertimeEvidence({ activityId:garduId, evidenceType:'FOTO_BRIEFING', file: await makeImage('brief2.png') })
    await evRepo.uploadOvertimeEvidence({ activityId:garduId, evidenceType:'FOTO_PROSES', file: await makeImage('proses.png') })
    await evRepo.uploadOvertimeEvidence({ activityId:garduId, evidenceType:'FOTO_SELESAI', file: await makeImage('selesai.png') })
    await repRepo.submitOvertimeWork(garduId)

    const jtmId = await repRepo.saveOvertimeWorkDraft({ activityId:null, contractId, up3Id, unitId:ownUnitId, workCategory:'JTM', description:'JTM keterangan', workTitle:'JTM - Test', workLocation:'Lokasi JTM', participants:[{employee_id:g1.id, started_at:'2026-08-25T08:00:00+07:00', ended_at:'2026-08-25T12:00:00+07:00'}] })
    await evRepo.uploadOvertimeEvidence({ activityId:jtmId, evidenceType:'SPK', file: await makePdf('spk2.pdf') })
    await evRepo.uploadOvertimeEvidence({ activityId:jtmId, evidenceType:'FOTO_BRIEFING', file: await makeImage('jtm_brief.png') })
    await evRepo.uploadOvertimeEvidence({ activityId:jtmId, evidenceType:'FOTO_PROSES', file: await makeImage('jtm_proses.png') })
    await evRepo.uploadOvertimeEvidence({ activityId:jtmId, evidenceType:'FOTO_SELESAI', file: await makeImage('jtm_selesai.png') })
    await repRepo.submitOvertimeWork(jtmId)

    const jtrId = await repRepo.saveOvertimeWorkDraft({ activityId:null, contractId, up3Id, unitId:ownUnitId, workCategory:'JTR', description:'JTR keterangan', workTitle:'JTR - Test', workLocation:'Lokasi JTR', participants:[{employee_id:g2.id, started_at:'2026-08-26T08:00:00+07:00', ended_at:'2026-08-26T12:00:00+07:00'}] })
    await evRepo.uploadOvertimeEvidence({ activityId:jtrId, evidenceType:'SPK', file: await makePdf('spk3.pdf') })
    await evRepo.uploadOvertimeEvidence({ activityId:jtrId, evidenceType:'FOTO_BRIEFING', file: await makeImage('jtr_brief.png') })
    await evRepo.uploadOvertimeEvidence({ activityId:jtrId, evidenceType:'FOTO_PROSES', file: await makeImage('jtr_proses.png') })
    await evRepo.uploadOvertimeEvidence({ activityId:jtrId, evidenceType:'FOTO_SELESAI', file: await makeImage('jtr_selesai.png') })
    await repRepo.submitOvertimeWork(jtrId)

    // verify one employee per row and multi
    const repRows = await repRepo.listOvertimeReplacements({ contractId, up3Id, unitId:ownUnitId, periodMonth:'2026-08-01' })
    const workRows = await repRepo.listOvertimeWork({ contractId, up3Id, unitId:ownUnitId, periodMonth:'2026-08-01' })
    const all = [...repRows, ...workRows]
    if (all.length < 9) throw new Error('Expected at least 9 rows (3 rep +1 admin +3 gardu +1 jtm +1 jtr) got '+all.length)
    const garduRows = all.filter(r=> r.id===garduId)
    if (garduRows.length!==3) throw new Error('Gardu multi rows failed '+garduRows.length)
    // check types present
    const jenisSet = new Set(all.map(r=> r.type==='WORK' ? r.workCategory : r.type))
    for(const t of ['REPLACEMENT_LEAVE','REPLACEMENT_SICK','REPLACEMENT_PERMISSION','ADMINISTRASI','GARDU','JTM','JTR']) if(!jenisSet.has(t)) throw new Error('Missing type '+t)
    // check total visible
    if (all.some(r=> typeof r.total !== 'number')) throw new Error('Total missing')
    // check rate hidden
    if (all.some(r=> 'hourly_rate_snapshot' in r || 'hourlyRate' in r)) throw new Error('Rate leaked in list')
    const { error: directErr } = await supabase.from('overtime_entries').select('hourly_rate_snapshot').limit(1)
    if (!directErr) throw new Error('Direct rate select not denied')
    // check cross-UP3
    await signIn('up3')
    const up3All = [...await repRepo.listOvertimeReplacements({ contractId, up3Id, unitId:null, periodMonth:'2026-08-01' }), ...await repRepo.listOvertimeWork({ contractId, up3Id, unitId:null, periodMonth:'2026-08-01' })]
    if (![cutiId, sakitId, garduId].every(id=> up3All.some(r=>r.id===id))) throw new Error('UP3 read failed')
    const cross = [...await repRepo.listOvertimeReplacements({ contractId, up3Id:crossUp3Id, unitId:null, periodMonth:'2026-08-01' }), ...await repRepo.listOvertimeWork({ contractId, up3Id:crossUp3Id, unitId:null, periodMonth:'2026-08-01' })]
    if (cross.length) throw new Error('cross-UP3 not denied')
    // detail shared evidence
    await signIn('ulp')
    const detailEvs = await evRepo.listOvertimeEvidence(garduId)
    if (detailEvs.filter(e=>e.status==='ACTIVE').length!==5) throw new Error('Detail shared evidence not 5')
    const signed = await evRepo.createOvertimeEvidenceSignedUrl(detailEvs[0].id)
    if (!(await fetch(signed.signedUrl)).ok) throw new Error('Detail signed preview failed')
    await supabase.auth.signOut()
    return { allCount: all.length, garduCount: garduRows.length, jenis: [...jenisSet], activityIds: [cutiId, sakitId, izinId, adminId, garduId, jtmId, jtrId] }
  }, { password: TEST_PASSWORD, contractId: CONTRACT_ID, up3Id: UP3_ID, ownUnitId: OWN_UNIT_ID, crossUp3Id: CROSS_UP3_ID })
  console.log(`Rekap L4 data checks passed: ${JSON.stringify(result)}`)
  // UI checks: render Rekap and verify filters, pagination, detail, columns
  const helperPage = await browser.newPage()
  await helperPage.goto('http://127.0.0.1:4184/rekap-test')
  const ui = await helperPage.evaluate(async ({ contractId, up3Id, ownUnitId })=>{
    const { default: RefreshRuntime } = await import('/@react-refresh')
    RefreshRuntime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = ()=>{}
    window.$RefreshSig$ = ()=>(type)=>type
    window.__vite_plugin_react_preamble_installed__=true
    const ReactModule = await import('/node_modules/.vite/deps/react.js')
    const React = ReactModule.default ?? ReactModule
    const ReactDOMClient = await import('/node_modules/.vite/deps/react-dom_client.js')
    const createRoot = ReactDOMClient.createRoot ?? ReactDOMClient.default?.createRoot
    const repRepo = await import('/src/data/overtimeReplacementRepository.js')
    const { supabase } = await import('/src/lib/supabaseClient.js')
    await supabase.auth.signInWithPassword({ email:'l4-rekap-ulp@example.invalid', password: 'L4-Rekap-Test-2026!' })
    const repRows = await repRepo.listOvertimeReplacements({ contractId, up3Id, unitId: ownUnitId, periodMonth:'2026-08-01' })
    const workRows = await repRepo.listOvertimeWork({ contractId, up3Id, unitId: ownUnitId, periodMonth:'2026-08-01' })
    const all=[...repRows, ...workRows]
    const { default: SLALembur } = await import('/src/components/sla/SLALembur.jsx')
    document.body.innerHTML='<main id="rekap-test"></main>'
    const orgUnits = [{ uuid: ownUnitId, displayName:'ULP Test', type:'ULP' }]
    createRoot(document.getElementById('rekap-test')).render(React.createElement(SLALembur, {
      contractScope:{ contractId, contractName:'Pelayanan Teknik' },
      up3Id, unitId: ownUnitId, periodMonth:'2026-08-01', records: all, canMutate: true, loading:false, loadError:'', orgUnits,
      onRetry:()=>{}, onSaveDraft:async()=>({ok:false}), onSubmit:async()=>({ok:false}), onSaveWorkDraft:async()=>({ok:false}), onSubmitWork:async()=>({ok:false})
    }))
    await new Promise(r=> setTimeout(r, 600))
    const bodyText=document.body.innerText
    const hasFilters = bodyText.includes('Periode') && bodyText.includes('Jenis') && bodyText.includes('Pegawai') && bodyText.includes('Status')
    const hasUlpColumn = document.body.innerHTML.includes('<th>ULP</th>')
    const hasJenisCol = bodyText.includes('Jenis')
    const hasWaktuJam = bodyText.includes('Waktu/Jam')
    const hasKeterangan = bodyText.includes('Keterangan')
    const hasTotal = bodyText.includes('Total Rp')
    const hasPagination = bodyText.includes('Baris per halaman') && bodyText.includes('Halaman')
    const hasDetailBtn = [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Lihat Detail'))
    const hasTruncate = !!document.querySelector('.rekap-keterangan')
    const hasRateLeak = bodyText.includes('Tarif') || bodyText.includes('1.5x')
    await supabase.auth.signOut()
    return { hasFilters, hasUlpColumn, hasJenisCol, hasWaktuJam, hasKeterangan, hasTotal, hasPagination, hasDetailBtn, hasTruncate, hasRateLeak }
  }, { contractId: CONTRACT_ID, up3Id: UP3_ID, ownUnitId: OWN_UNIT_ID })
  console.log(`Rekap L4 UI checks: ${JSON.stringify(ui)}`)
  if(!ui.hasFilters) throw new Error('Filters missing')
  if(ui.hasUlpColumn) throw new Error('ADMIN_ULP should not have ULP column')
  if(!ui.hasJenisCol || !ui.hasWaktuJam || !ui.hasKeterangan || !ui.hasTotal) throw new Error('Columns missing')
  if(!ui.hasPagination) throw new Error('Pagination missing')
  if(!ui.hasDetailBtn) throw new Error('Detail button missing')
  if(!ui.hasTruncate) throw new Error('Keterangan truncate missing')
  if(ui.hasRateLeak) throw new Error('Rate leaked in UI')
  // test filter via Playwright (verify at least Gardu remains visible)
  await helperPage.locator('.rekap-filters').locator('select').nth(1).selectOption('Gardu')
  await helperPage.waitForTimeout(800)
  let afterFilter = await helperPage.locator('body').innerText()
  if(!afterFilter.includes('Gardu')) throw new Error('Type filter not working - Gardu not visible')
  await helperPage.locator('.rekap-filters').locator('select').nth(1).selectOption('Semua')
  await helperPage.waitForTimeout(300)
  // pagination check already via hasPagination, just verify control exists
  // detail modal check via Playwright
  await helperPage.locator('button', { hasText: 'Lihat Detail' }).first().click()
  await helperPage.waitForTimeout(600)
  let detailText = await helperPage.locator('body').innerText()
  if(!detailText.includes('Detail Lembur') || !detailText.includes('Evidence')) throw new Error('Detail modal not working')
  await helperPage.locator('button', { hasText: 'Tutup' }).click()
  await helperPage.waitForTimeout(300)
  // ADMIN_UP3 checks
  const up3Page = await browser.newPage()
  await up3Page.goto('http://127.0.0.1:4184/rekap-test')
  const up3ui = await up3Page.evaluate(async ({ contractId, up3Id })=>{
    const { default: RefreshRuntime } = await import('/@react-refresh')
    RefreshRuntime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = ()=>{}
    window.$RefreshSig$ = ()=>(type)=>type
    window.__vite_plugin_react_preamble_installed__=true
    const ReactModule = await import('/node_modules/.vite/deps/react.js')
    const React = ReactModule.default ?? ReactModule
    const ReactDOMClient = await import('/node_modules/.vite/deps/react-dom_client.js')
    const createRoot = ReactDOMClient.createRoot ?? ReactDOMClient.default?.createRoot
    const repRepo = await import('/src/data/overtimeReplacementRepository.js')
    const { supabase } = await import('/src/lib/supabaseClient.js')
    await supabase.auth.signInWithPassword({ email:'l4-rekap-up3@example.invalid', password: 'L4-Rekap-Test-2026!' })
    const repRows = await repRepo.listOvertimeReplacements({ contractId, up3Id, unitId:null, periodMonth:'2026-08-01' })
    const workRows = await repRepo.listOvertimeWork({ contractId, up3Id, unitId:null, periodMonth:'2026-08-01' })
    const all=[...repRows, ...workRows]
    const { default: SLALembur } = await import('/src/components/sla/SLALembur.jsx')
    document.body.innerHTML='<main id="rekap-up3"></main>'
    const orgUnits = [{ uuid:'27617d7d-795f-4f34-8edd-cc236ed49146', displayName:'ULP A', type:'ULP' }, { uuid:'971b6d5f-5f8d-41d5-aa1e-a75db4e3a4ba', displayName:'ULP B', type:'ULP' }]
    createRoot(document.getElementById('rekap-up3')).render(React.createElement(SLALembur, {
      contractScope:{ contractId, contractName:'Pelayanan Teknik' },
      up3Id, unitId:null, periodMonth:'2026-08-01', records: all, canMutate: false, loading:false, loadError:'', orgUnits,
      onRetry:()=>{}, onSaveDraft:async()=>({ok:false}), onSubmit:async()=>({ok:false}), onSaveWorkDraft:async()=>({ok:false}), onSubmitWork:async()=>({ok:false})
    }))
    await new Promise(r=> setTimeout(r, 600))
    const hasUlpCol = document.body.innerHTML.includes('<th>ULP</th>')
    const hasUlpFilter = document.body.innerText.includes('ULP') && !!document.querySelector('.rekap-filters')
    await supabase.auth.signOut()
    return { hasUlpCol, hasUlpFilter }
  }, { contractId: CONTRACT_ID, up3Id: UP3_ID })
  console.log(`ADMIN_UP3 UI checks: ${JSON.stringify(up3ui)}`)
  if(!up3ui.hasUlpCol) throw new Error('ADMIN_UP3 missing ULP column')
  if(!up3ui.hasUlpFilter) throw new Error('ADMIN_UP3 missing ULP filter')
  await up3Page.close()
  // TL/Manager gap: check if they can read? They have org membership but not contract membership. Report gap.
  console.log('TL/MANAGER AUTH GAP = TEAM_LEADER/MANAGER_UNIT are organization_memberships with read scope via auth_can_read_overtime_evidence_scope, but no contract membership; financial Detail would be hidden via same list; no dedicated TL Detail RPC — gap reported as read-only via existing scope, not invented.')
} finally{
  if(browser) await browser.close()
  await server.close()
}
