const assert=require('node:assert/strict');
const {chromium}=require('../node_modules/@playwright/test');
const {createPreviewServer}=require('../scripts/premium-preview.cjs');
(async()=>{
 const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
 browser=await chromium.launch({channel:'msedge'});const page=await browser.newPage({viewport:{width:1500,height:980}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/?view=chulgo`);
 await page.waitForFunction(()=>currentView==='chulgo'&&chulgoEntries.length===3);
 assert.equal(await page.locator('#journal-world').isVisible(),false,'ledger replaces panorama with goal');
 await page.locator('.ledger-goal summary').click();await page.locator('#ledger-goal-input').fill('2');await page.locator('#ledger-goal-form button').click();
 assert.equal(await page.locator('.ledger-goal [role=meter]').getAttribute('aria-valuenow'),'150');
 await page.locator('#chulgo-next-month').click();assert.equal(await page.locator('#ledger-goal-percent').textContent(),'목표 미설정');await page.locator('#chulgo-prev-month').click();assert.equal(await page.locator('.ledger-goal [role=meter]').getAttribute('aria-valuenow'),'150');
 const headings=await page.locator('.chulgo-ledger thead th').allTextContents();assert.ok(headings.indexOf('DB 유형')<headings.indexOf('고객명'));
 await page.locator('#chulgo-add-row').click();await page.locator('#ledger-field-name').fill('새 출고 테스트');await page.locator('#ledger-field-dbType').fill('소개');await page.locator('#ledger-field-fee').fill('1234567');await page.locator('#ledger-entry-save').click();await page.waitForFunction(()=>window.__preview.snapshot().ledger.some(r=>r.name==='새 출고 테스트'));
 let rows=await page.evaluate(()=>window.__preview.snapshot().ledger);const added=rows.find(r=>r.name==='새 출고 테스트');assert.equal(added.dbType,'소개');assert.equal(added.fee,1234567);
 const original=rows.find(r=>r.id==='ledger-1');
 await page.locator('.chulgo-edit-btn[data-id="ledger-1"]').click();await page.locator('#ledger-field-dbType').fill('수정된 유형');await page.locator('#ledger-entry-cancel').click();assert.equal((await page.evaluate(()=>window.__preview.snapshot().ledger.find(r=>r.id==='ledger-1'))).dbType,original.dbType);
 await page.locator('.chulgo-edit-btn[data-id="ledger-1"]').click();await page.locator('#ledger-field-dbType').fill('수정된 유형');await page.evaluate(()=>window.__preview.failNext('updateChulgoEntry'));await page.locator('#ledger-entry-save').click();await page.waitForFunction(()=>!document.getElementById('ledger-entry-save').disabled);assert.ok(await page.locator('#ledger-entry-drawer').isVisible(),'failed save retains draft');assert.equal(await page.locator('#ledger-field-dbType').inputValue(),'수정된 유형');await page.locator('#ledger-entry-save').click();await page.waitForFunction(()=>document.getElementById('ledger-entry-drawer').classList.contains('hidden'));
 const updated=await page.evaluate(()=>window.__preview.snapshot().ledger.find(r=>r.id==='ledger-1'));assert.equal(updated.dbType,'수정된 유형');assert.deepEqual(updated.paybacks,original.paybacks);assert.deepEqual(updated.extraFees,original.extraFees);assert.equal(updated.fee,original.fee);
 await page.evaluate(()=>{window.api.aiFillChulgo=async()=>({action:'create',name:'AI 신규',car:'쏘렌토',dbType:'AI유형',fee:2000000,extraFees:[{name:'추가',type:'amount',value:50000}]})});
 await page.locator('#chulgo-ai-fill-btn').click();await page.locator('#chulgo-ai-fill-text').fill('새로 추가해주세요');await page.locator('#chulgo-ai-fill-analyze').click();await page.waitForFunction(()=>!document.getElementById('chulgo-ai-fill-apply').disabled);await page.locator('#chulgo-ai-fill-apply').click();assert.equal(await page.locator('#ledger-field-name').inputValue(),'AI 신규');assert.equal((await page.evaluate(()=>window.__preview.snapshot().ledger)).filter(r=>r.name==='AI 신규').length,0);await page.locator('#ledger-entry-save').click();await page.waitForFunction(()=>window.__preview.snapshot().ledger.some(r=>r.name==='AI 신규'));assert.equal((await page.evaluate(()=>window.__preview.snapshot().ledger.find(r=>r.name==='AI 신규'))).extraFees[0].value,50000);
 await page.setViewportSize({width:1024,height:768});await page.screenshot({path:'artifacts/ledger-final-1024.png'});await page.setViewportSize({width:1500,height:980});await page.screenshot({path:'artifacts/ledger-final.png'});
 assert.equal(await page.locator('#chulgo-action-row button').count(),6);assert.equal(await page.locator('#chulgo-excel-preview-btn').count(),1);assert.equal(await page.locator('#chulgo-settlement-btn').count(),1);assert.deepEqual(errors,[]);
 console.log('PASS: real ledger UI goal/months, DB order, create/edit/cancel, failed-save retry, AI staged save, financial arrays preserved, export/report controls');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
