import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{name:'tool-sync-check',configureServer(vite){
  vite.middlewares.use('/tool-sync-check',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><main id="root"></main>')})
}}]})
let browser,page
const errors=[]
try{
  await server.listen()
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true})
  page=await browser.newPage({viewport:{width:1440,height:1000}})
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/src/data/ulpConditionRepository.js*',route=>route.fulfill({contentType:'application/javascript',body:`
    export const getUlpConditionReport=async({month})=>window.fixtureReport(month);
    export const listUlpConditionOverview=async()=>[];
    export const correctPrescribedVehiclePlate=async()=>{};
    export const saveUlpVehicleCondition=async()=>{throw Error('Unexpected manual save')};
    export const setPrescribedVehiclePlate=async()=>{};
  `}))
  await page.route('**/src/data/toolEvidence.js*',route=>route.fulfill({contentType:'application/javascript',body:'export const prepareToolEvidence=async(file)=>file; export const prepareVehicleEvidence=async(file)=>file;'}))
  await page.route('**/src/data/toolInspectionRepository.js*',route=>route.fulfill({contentType:'application/javascript',body:`
    export const getToolInspectionBundle=async()=>({vehicles:[{id:'vehicle',assets:[{id:'asset',equipment_id:'tool',equipment_name:'Teropong',asset_sequence:1,commissioned_at:window.replaced?'2026-11-02T03:00:00Z':null,handover:window.replaced?{resolved_at:'2026-11-02T03:00:00Z',resolved_by_name:'Widodo',photo_paths:['replacement.png']}:null,open_issue:window.damaged?{id:'issue',revision:1,opened_at:'2026-10-09T00:00:00Z',handover_verified_at:window.verifiedAt}:null}]}],history:[],openIssues:window.damaged?[{id:'issue',vehicle_id:'vehicle',equipment_name:'Teropong'}]:[]});
    export const listOpenToolIssues=async()=>[{id:'issue',revision:1,ulp_id:'ulp',equipment_name:'Teropong',vehicle_label:'Roda 2',opened_at:'2026-10-09T00:00:00Z',handover_verified_at:window.verifiedAt},{id:'issue-nov',revision:1,ulp_id:'ulp',equipment_name:'HT',vehicle_label:'Roda 4',opened_at:'2026-11-24T03:29:00Z',handover_verified_at:window.verifiedAt}];
    export const verifyToolIssueHandover=async({verifiedAt})=>{window.verifiedAt=verifiedAt;return {}};
    export const listVehicleLastInspections=async()=>[];
    export const submitToolInspection=async()=>{window.damaged=true;window.checked=true;return {issue:{id:'issue'}}};
    export const resolveToolIssue=async()=>{window.damaged=false;window.checked=false;window.replaced=true;return {}};
    export const uploadToolEvidence=async()=> 'fixture.png';
    export const getToolEvidenceUrl=async()=>'';
    export const submitVehicleInspection=async()=>{};
    export const uploadVehicleInspectionPhoto=async()=>{};
    export const getVehicleInspectionPhotoUrl=async()=>'';
  `}))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tool-sync-check`)
  await page.evaluate(async()=>{
    const {default:Refresh}=await import('/@react-refresh');Refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true
    await import('/src/styles/index.css')
    const r=await import('/node_modules/.vite/deps/react.js'), React=r.default??r
    const dom=await import('/node_modules/.vite/deps/react-dom_client.js')
    const {default:Report}=await import('/src/components/sla/UlpConditionReport.jsx')
    window.damaged=false;window.checked=false;window.replaced=false
    window.fixtureReport=month=>{
      const inspected=(window.checked&&month==='2026-10')||(window.replaced&&month==='2026-11')
      return {report:null,vehicles:[{id:'vehicle',label:'Roda 2',plate_display:'KB 1234',vehicle_type_name:'Roda 2',assignment_name:'Inspeksi'}],history:[],
        items:[{key:'vehicle:vehicle',vehicle_id:'vehicle',kind:'vehicle',required_qty:1,good_qty:1,bad_qty:0},
          {key:'vehicle:tool',vehicle_id:'vehicle',equipment_id:'tool',kind:'equipment',name:'Teropong',unit:'unit',required_qty:1,good_qty:window.damaged?0:1,bad_qty:window.damaged?1:0,note:''}],
        inspection_summary:[{vehicle_id:'vehicle',total:1,inspected:inspected?1:0,uninspected:inspected?0:1,open_issues:window.damaged?1:0}]}
    }
    const root=(dom.createRoot??dom.default.createRoot)(document.getElementById('root'))
    window.renderReport=(month)=>root.render(React.createElement(Report,{key:month,contractUuid:'contract',up3Uuid:'up3',ownUlpUuid:'ulp',canManage:true,canInspect:true,canResolveIssue:true,canPickUlp:false,initialMonth:month,units:[{uuid:'ulp',type:'ULP',displayName:'ULP'}]}))
    window.renderReport('2026-10')
  })
  await page.getByText('1 unit belum diperiksa bulan ini',{exact:true}).waitFor()
  await page.locator('.uc-vehicle-card').click()
  await page.getByRole('button',{name:'Detail acuan'}).click()
  const referenceDialog=page.getByRole('dialog')
  await referenceDialog.getByText('Jenis Kendaraan',{exact:true}).waitFor()
  assert.match(await referenceDialog.innerText(),/NOMOR POLISI\s*KB 1234/i)
  await referenceDialog.getByRole('button',{name:'Tutup',exact:true}).click()
  await referenceDialog.waitFor({state:'detached'})
  const row=page.locator('.tool-matrix-row').filter({hasText:'Teropong'})
  await row.waitFor()
  assert.equal(await row.locator('input').count(),0)
  assert.equal(await page.getByRole('button',{name:'Isi Semua 100%',exact:true}).count(),0)
  await row.getByRole('button',{name:'Inspeksi',exact:true}).click()
  const dialog=page.getByRole('dialog')
  await dialog.locator('select').selectOption('DAMAGED')
  await dialog.locator('textarea').fill('Lensa rusak')
  await dialog.locator('input[type=file]').setInputFiles({name:'proof.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64')})
  await dialog.getByRole('button',{name:'Simpan Inspeksi',exact:true}).click()
  await row.getByText('Tidak Memenuhi',{exact:true}).waitFor()
  assert.equal(await row.locator('.tool-matrix-qty').nth(0).innerText(),'0')
  assert.equal(await row.locator('.tool-matrix-qty').nth(1).innerText(),'1')
  assert.equal(await row.locator('.tool-percent-value').innerText(),'0%')
  await page.getByRole('button',{name:'Kembali ke daftar kendaraan'}).click()
  await page.getByText('Semua alat sudah diperiksa bulan ini',{exact:true}).waitFor()
  await page.locator('input[type=month]').fill('2026-11')
  await page.getByText('1 unit belum diperiksa bulan ini',{exact:true}).waitFor()
  assert((await page.locator('.uc-vehicle-card').innerText()).includes('1 issue unit'))
  await page.locator('.uc-vehicle-card').click()
  assert.equal(await row.getByRole('button',{name:'Serah Terima',exact:true}).isDisabled(),true)
  await page.evaluate(async()=>{
    const r=await import('/node_modules/.vite/deps/react.js'), React=r.default??r
    const dom=await import('/node_modules/.vite/deps/react-dom_client.js')
    const {default:Coordinator}=await import('/src/components/sla/CoordinatorToolIssues.jsx')
    const host=document.createElement('div');host.id='coordinator';document.body.append(host)
    window.coordinatorRoot=(dom.createRoot??dom.default.createRoot)(host)
    const units=[{uuid:'ulp',type:'ULP',displayName:'ULP'}]
    window.coordinatorRender=month=>window.coordinatorRoot.render(React.createElement(Coordinator,{contractId:'contract',up3Id:'up3',month,units}))
    window.coordinatorRender('2026-10')
  })
  const coordinator=page.locator('#coordinator')
  await coordinator.getByText('Periode Oktober 2026',{exact:true}).waitFor()
  assert.equal(await coordinator.locator('.tool-issue-card').filter({hasText:'Teropong'}).count(),1)
  assert.equal(await coordinator.locator('.tool-issue-card').filter({hasText:'HT'}).count(),0)
  assert.match(await coordinator.innerText(),/1 issue terbuka pada Oktober 2026/)
  await page.getByRole('button',{name:'Verifikasi Penyerahan Alat Pengganti',exact:true}).click()
  await page.getByRole('dialog').locator('input[type=datetime-local]').fill('2026-11-02T09:00')
  await page.getByRole('button',{name:'Simpan Verifikasi',exact:true}).click()
  await page.locator('#coordinator').getByText(/menunggu serah terima ke ULP$/).waitFor()
  await page.evaluate(()=>window.coordinatorRender('2026-11'))
  await coordinator.getByText('Periode November 2026',{exact:true}).waitFor()
  assert.equal(await coordinator.locator('.tool-issue-card').filter({hasText:'Teropong'}).count(),0)
  assert.equal(await coordinator.locator('.tool-issue-card').filter({hasText:'HT'}).count(),1)
  await page.evaluate(()=>{window.coordinatorRoot.unmount();document.getElementById('coordinator').remove()})
  await page.evaluate(()=>window.renderReport('2026-11'))
  await page.locator('.uc-vehicle-card').click()
  await row.getByRole('button',{name:'Serah Terima',exact:true}).click()
  await dialog.locator('input[type=file]').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64')})
  await dialog.getByRole('button',{name:'Simpan Serah Terima',exact:true}).click()
  await row.getByText('Memenuhi',{exact:true}).waitFor()
  assert.equal(await row.locator('.tool-matrix-qty').nth(0).innerText(),'1')
  assert.equal(await row.locator('.tool-matrix-qty').nth(1).innerText(),'0')
  assert.equal((await row.locator('.tool-unit-id').innerText()).toLowerCase(),'unit 1')
  assert.equal(await row.locator('.tool-unit-state').innerText(),'Baik · sudah diperiksa')
  await page.getByRole('button',{name:'Kembali ke daftar kendaraan'}).click()
  await page.getByText('Semua alat sudah diperiksa bulan ini',{exact:true}).waitFor()
  assert.deepEqual(errors,[])
  console.log('Tool sync browser checks passed: read-only counts, inspection refresh, monthly issue filtering, month-specific card, carryover, handover refresh.')
}catch(error){console.error(error.message,errors,(await page?.locator('body').innerText())?.slice(0,2000));process.exitCode=1}
finally{await browser?.close();await server.close()}
