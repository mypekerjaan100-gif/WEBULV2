import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Real components/repository/CSS, mock transport only. No login, live DB, or external requests.
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
  plugins: [{ name: 'variable-monthly-test', configureServer(vite) {
    vite.middlewares.use('/variable-monthly-test', (_request, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><title>Monthly Variable Cost test</title><main id="root"></main>')
    })
  } }],
})
let browser, page
const errors = [], external = []
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue()
    external.push(route.request().url()); return route.abort()
  })
  await page.route('**/src/lib/supabaseClient.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export const supabase = {
      from: (table) => {
        window.__tableCalls.push(table)
        const filters = []; let single = false
        const api = {
          select: () => api, order: () => api, limit: () => api,
          eq: (key,value) => { filters.push(row => row[key] === value); return api },
          is: (key,value) => { filters.push(row => row[key] === value); return api },
          in: (key,values) => { filters.push(row => values.includes(row[key])); return api },
          lte: (key,value) => { filters.push(row => row[key] <= value); return api },
          gte: (key,value) => { filters.push(row => row[key] >= value); return api },
          maybeSingle: () => { single = true; return api },
          then: (resolve,reject) => Promise.resolve().then(() => {
            const rows = (table === 'variable_cost_monthly_history' ? window.__history : window.__tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
            return { data: structuredClone(single ? rows[0] ?? null : rows), error: null }
          }).then(resolve,reject),
        }
        return api
      },
      rpc: async (name,parameters) => {
        window.__rpcCalls.push({name,parameters: structuredClone(parameters)})
        if (name === 'list_variable_monthly_actuals') {
          if (window.__failRead) return {data:null,error:{message:'Fixture read failure'}}
          return { data:structuredClone(window.__monthly.filter(row => row.period_month === parameters.p_period_month && (!parameters.p_unit_id || row.unit_id === parameters.p_unit_id))),error:null }
        }
        if (name === 'save_variable_monthly_actuals') {
          await new Promise(resolve => setTimeout(resolve,100))
          if (window.__failSave) {window.__failSave=false;return {data:null,error:{message:'Data telah diubah oleh sesi lain. Muat ulang.'}}}
          for (const value of parameters.p_values) {
            let row = window.__monthly.find(row => row.unit_id === parameters.p_unit_id && row.indicator_code === value.indicator_code && row.period_month === parameters.p_period_month)
            const before = row ? {...row} : null
            if (!row) {row={unit_id:parameters.p_unit_id,indicator_code:value.indicator_code,period_month:parameters.p_period_month,revision:0};window.__monthly.push(row)}
            row.work_order=value.work_order;row.realization=value.realization;row.revision++
            window.__history.unshift({id:'history-'+window.__history.length,contract_id:'contract',up3_id:'up3',...row,old_work_order:before?.work_order??null,new_work_order:row.work_order,old_realization:before?.realization??null,new_realization:row.realization,changed_at:'2026-10-30T04:00:00Z'})
          }
          return {data:parameters.p_values.length,error:null}
        }
        if (name === 'get_variable_financial_dashboard') return {data:window.__finance(parameters.p_period_month,parameters.p_unit_id),error:null}
        if (name === 'get_variable_financial_trend') return {data:{months:[{...window.__finance(parameters.p_end_period_month,parameters.p_unit_id).summary,period_month:parameters.p_end_period_month,has_data:true,target_complete:true,required_target_count:20}]},error:null}
        if (name === 'get_financial_comparison_dashboard') return {data:window.__comparison(parameters.p_period_month,parameters.p_unit_id),error:null}
        if (name === 'get_financial_comparison_trend') return {data:[window.__comparison(parameters.p_end_period_month,parameters.p_unit_id)],error:null}
        return {data:[],error:null}
      },
    }
  ` }))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/variable-monthly-test`)
  await page.evaluate(async () => {
    const { default: RefreshRuntime } = await import('/@react-refresh')
    RefreshRuntime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    await import('/src/styles/index.css')
    const ReactModule = await import('/node_modules/.vite/deps/react.js')
    const React = ReactModule.default ?? ReactModule
    const ReactDOMClient = await import('/node_modules/.vite/deps/react-dom_client.js')
    const createRoot = ReactDOMClient.createRoot ?? ReactDOMClient.default?.createRoot
    const { default: Variable } = await import('/src/components/sla/SLAVariableCost.jsx')
    const { default: Comparison } = await import('/src/components/sla/FinancialComparisonDashboard.jsx')
    const { variableCostIndicators } = await import('/src/data/slaPelayananTeknik.js')
    const units = [{ uuid:'ulp-1',legacyKey:'ulp-1',parentUuid:'up3',type:'ULP',displayName:'ULP Satu' },{ uuid:'ulp-2',legacyKey:'ulp-2',parentUuid:'up3',type:'ULP',displayName:'ULP Dua' }]
    const indicators = variableCostIndicators.filter(indicator => !indicator.code.startsWith('TEBANG')).map(indicator => ({ id:indicator.code,sla_version_id:'version',point_code:indicator.code,input_mode:'VARIABLE_COST',variable_cost_profile:indicator.code==='3.1c'?'KONSTRUKSI':'STANDARD',measurement_unit:indicator.unit }))
    window.__rpcCalls=[];window.__tableCalls=[];window.__monthly=[];window.__history=[]
    const base = {contract_id:'contract',up3_id:'up3',sla_version_id:'version'}
    window.__tables={
      sla_versions:[{id:'version',...base,status:'ACTIVE',period_start:'2026-01-01',period_end:'2026-12-31'}],sla_indicators:indicators,
      sla_targets:['2026-10-01','2026-11-01'].flatMap(period_month => units.flatMap(unit => indicators.map(indicator => ({...base,unit_id:unit.uuid,indicator_id:indicator.id,period_month,target_value:100})))),
      variable_cost_konstruksi_monthly_amounts:[],variable_cost_konstruksi_monthly_targets:[],
      variable_cost_manual_wo:[{unit_id:'ulp-1',indicator_code:'3.2b',wo_value:66}],
    }
    const billed=variableCostIndicators.filter(indicator=>indicator.revenueEligible!==false)
    const finalize = rows => {
      const missingActual=rows.filter(row=>row.actual_missing).length
      return {actual_amount:rows.reduce((sum,row)=>sum+row.actual_amount,0),target_amount:rows.length*1000,missing_actual_count:missingActual,configured_actual_count:rows.length-missingActual,missing_target_count:0,configured_target_count:rows.length,missing_price_count:0,difference_amount:missingActual?null:rows.reduce((sum,row)=>sum+row.actual_amount,0)-rows.length*1000,achievement_percent:null}
    }
    window.__finance=(month,unitId)=>{
      const cells=units.filter(unit=>!unitId||unit.uuid===unitId).flatMap(unit=>billed.map((indicator,index)=>{
        const actual=window.__monthly.find(row=>row.indicator_code===indicator.code&&row.unit_id===unit.uuid&&row.period_month===month)
        return {unit_id:unit.uuid,indicator_code:indicator.code,indicator_id:indicator.code,indicator_name:indicator.label,source_type:indicator.code==='3.1c'?'KONSTRUKSI':'UNIT_RATE',sort_order:index,target_amount:1000,target_missing:false,actual_missing:actual?.realization==null,actual_amount:(actual?.realization??0)*20,missing_price_count:0}
      }))
      return {summary:finalize(cells),cells,units:units.filter(unit=>!unitId||unit.uuid===unitId).map(unit=>({unit_id:unit.uuid,...finalize(cells.filter(cell=>cell.unit_id===unit.uuid))})),indicators:billed.map((indicator,index)=>({indicator_id:indicator.code,indicator_code:indicator.code,indicator_name:indicator.label,sort_order:index,...finalize(cells.filter(cell=>cell.indicator_code===indicator.code))}))}
    }
    window.__comparison=(month,unitId)=>({period_month:month,revenue_eligible_components:window.__finance(month,unitId).indicators.map(indicator=>({...indicator,amount:indicator.actual_amount})),cost_components:[{cost_code:'ROW',amount:500,entry_count:1}],has_data:true})
    const root=createRoot(document.getElementById('root'));let number=0
    function Harness({mode}) {
      const [period,setPeriod]=React.useState('Oktober 2026')
      return mode==='comparison'?React.createElement(Comparison,{orgMap:{contractUuid:'contract',up3Uuid:'up3'},units,period,periods:['Oktober 2026','November 2026'],onPeriodChange:setPeriod}):React.createElement(Variable,{
        orgMap:{contractUuid:'contract',up3Uuid:'up3',units},role:mode==='ulp'||mode==='preview'?'ulp':'up3',unitId:'ulp-1',canInputMonthly:mode==='ulp',isManagementReadOnly:mode==='manager'||mode==='preview',
        canViewVariableFinancial:mode==='up3'||mode==='manager',canManageKonstruksiMonthly:mode==='up3',period,periods:['Oktober 2026','November 2026'],onPeriodChange:setPeriod,onEditorStateChange:state=>{window.__editorState=state},
      })
    }
    window.__renderMonthly=mode=>root.render(React.createElement(Harness,{key:++number,mode}))
    window.__renderMonthly('ulp')
  })
  const save = page.getByRole('button', { name:'Simpan Input Bulanan', exact:true })
  await page.getByLabel('WO 2.1a', { exact:true }).waitFor()
  assert.equal(await page.locator('.vc-monthly-input').count(), 20)
  assert.equal(await page.getByLabel('WO 3.2b', { exact:true }).inputValue(), '')
  assert.equal(await save.isDisabled(), true)
  assert(!/Master Penyulang|Input Kegiatan|Persetujuan/.test(await page.locator('body').innerText()))
  await page.getByLabel('WO 2.1a', { exact:true }).fill('80')
  await page.getByLabel('Realisasi 2.1a', { exact:true }).fill('40')
  await page.getByLabel('WO 3.2b', { exact:true }).fill('0')
  await page.getByLabel('Realisasi 3.2b', { exact:true }).fill('0')
  await page.getByLabel('Realisasi TEBANG_20_40_CM', { exact:true }).fill('2')
  assert.equal(await page.getByLabel('WO 2.1a', { exact:true }).locator('xpath=ancestor::tr').getByText('50%', {exact:true}).count(), 1)
  assert.equal(await page.evaluate(()=>window.__editorState.dirty), true)
  assert.equal(await page.evaluate(()=>window.__rpcCalls.filter(call=>call.name==='save_variable_monthly_actuals').length), 0)
  await save.click()
  await page.getByText('Input bulanan tersimpan dan langsung aktif.', {exact:false}).waitFor()
  let calls=await page.evaluate(()=>window.__rpcCalls.filter(call=>call.name==='save_variable_monthly_actuals'))
  assert.equal(calls.length, 1);assert.equal(calls[0].parameters.p_values.length, 3)
  assert.equal(calls[0].parameters.p_unit_id, 'ulp-1');assert.equal(calls[0].parameters.p_period_month, '2026-10-01')
  assert.equal(await page.getByLabel('Realisasi 3.2b', {exact:true}).inputValue(), '0')
  assert.equal(await page.evaluate(()=>window.__editorState.dirty), false)
  await page.getByLabel('Realisasi 2.1a', {exact:true}).fill('55')
  await page.evaluate(()=>{window.__failSave=true})
  await save.click()
  await page.getByText('Data telah diubah oleh sesi lain.',{exact:false}).waitFor()
  assert.equal(await page.getByLabel('Realisasi 2.1a', {exact:true}).inputValue(), '55')
  page.once('dialog',dialog=>dialog.dismiss())
  await page.locator('select').first().selectOption('November 2026')
  assert.equal(await page.locator('select').first().inputValue(), 'Oktober 2026')
  page.once('dialog',dialog=>dialog.accept())
  await page.getByRole('button',{name:'Muat Ulang',exact:true}).click()
  await page.waitForFunction(()=>!window.__editorState.dirty)
  assert.equal(await page.getByLabel('Realisasi 2.1a', {exact:true}).inputValue(), '40')
  await page.getByLabel('WO 2.1a', {exact:true}).fill('')
  await page.getByLabel('Realisasi 2.1a', {exact:true}).fill('')
  await save.evaluate(button=>{button.click();button.click()})
  await page.getByText('Input bulanan tersimpan dan langsung aktif.',{exact:false}).waitFor()
  calls=await page.evaluate(()=>window.__rpcCalls.filter(call=>call.name==='save_variable_monthly_actuals'))
  assert.equal(calls.length, 3, 'Double click must issue one atomic request')
  assert.deepEqual(calls.at(-1).parameters.p_values[0], {indicator_code:'2.1a',work_order:null,realization:null,expected_revision:1})
  await page.locator('select').first().selectOption('November 2026')
  await page.getByLabel('WO 2.1a', {exact:true}).waitFor()
  assert.equal(await page.getByLabel('Realisasi 3.2b', {exact:true}).inputValue(), '', 'Month switch must not retain another month')

  await page.evaluate(()=>window.__renderMonthly('up3'))
  await page.getByRole('button',{name:'Detail per ULP',exact:true}).first().waitFor()
  assert.equal(await page.locator('.vc-monthly-input').count(), 0)
  assert.equal(await page.getByRole('button',{name:'Simpan Input Bulanan',exact:true}).count(), 0)
  await page.getByRole('button',{name:'Detail per ULP',exact:true}).first().click()
  const dialog=page.getByRole('dialog')
  await dialog.waitFor();assert.equal(await dialog.getByRole('button',{name:'Riwayat',exact:true}).count(), 2)
  await dialog.getByRole('button',{name:'Riwayat',exact:true}).first().click()
  await page.getByText('Maksimal 100 revisi terakhir.',{exact:false}).waitFor()
  await page.getByRole('dialog').last().getByRole('button',{name:'Tutup dialog',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Tutup dialog',exact:true}).click()
  await page.getByRole('tab',{name:'Dashboard Finansial',exact:true}).click()
  await page.getByText('realisasi bulanan belum diinput.',{exact:false}).first().waitFor()
  assert.equal(await page.getByText('Tidak Ditagihkan',{exact:true}).count(), 0, 'Financial dashboard excludes ROW Fix')
  await page.evaluate(()=>window.__renderMonthly('preview'))
  await page.getByRole('button',{name:'Riwayat',exact:true}).first().waitFor()
  assert.equal(await page.locator('.vc-monthly-input').count(), 0, 'Preview is read-only')
  await page.evaluate(()=>window.__renderMonthly('comparison'))
  await page.getByText('Realisasi bulanan atau harga satuan belum lengkap.',{exact:false}).waitFor()
  assert((await page.locator('body').innerText()).includes('Belum lengkap'))
  assert.deepEqual(await page.evaluate(()=>window.__tableCalls.filter(table=>['variable_cost_entries','variable_cost_manual_wo','feeders','variable_cost_evidence'].includes(table))), [])
  assert.deepEqual(errors, []);assert.deepEqual(external, [])
  console.log('Variable monthly browser tests passed: editor, atomic save, zero/blank, conflicts, period isolation, ULP drill-down/history, financial completeness, preview, and no external integration')
} catch (error) {
  console.error('Monthly browser test failed:', error.message, errors, (await page?.locator('body').innerText())?.slice(0,2000))
  process.exitCode = 1
} finally {
  await browser?.close()
  await server.close()
}
