const assert=require('node:assert/strict');
const {chromium}=require('@playwright/test');
const {createPreviewServer}=require('../scripts/premium-preview.cjs');
(async()=>{const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{
browser=await chromium.launch({channel:'msedge'});const page=await browser.newPage({viewport:{width:1100,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?view=memo`);await page.waitForFunction(()=>currentView==='memo'&&document.querySelector('.memo-done-toggle'));
const measure=()=>page.evaluate(()=>Object.fromEntries(['.world-motion','#memo-today-label','.memo-done-toggle','#memo-text','.memo-row-text','.memo-row-meta','.sidebar-nav-btn'].map(s=>[s,parseFloat(getComputedStyle(document.querySelector(s)).fontSize)])));
const base=await measure();await page.locator('#btn-settings').click();
assert.equal(await page.locator('#theme-font optgroup option').count(),16);
await page.locator('#theme-font').selectOption("'Hi Melody', 'Malgun Gothic', sans-serif");await page.locator('#theme-ui-font-scale').selectOption('140');await page.locator('#settings-save').click();const big=await measure();for(const key of Object.keys(base))assert.ok(big[key]>=base[key]*1.39,key);
assert.equal(await page.evaluate(()=>window.__preview.snapshot().theme.uiFontScale),'140');
await page.locator('#btn-settings').click();await page.locator('#theme-ui-font-scale').selectOption('200');await page.locator('#settings-close').click();assert.equal((await measure())['.world-motion'],big['.world-motion']);
await page.reload();await page.waitForFunction(()=>currentView==='memo'&&document.querySelector('.memo-done-toggle'));assert.equal((await measure())['.world-motion'],big['.world-motion']);
await page.locator('#journal-theme-select').selectOption('lavenderField');assert.equal(await page.evaluate(()=>window.__preview.snapshot().theme.uiFontScale),'140');
await page.screenshot({path:'artifacts/readable-type-140.png'});
await page.locator('#btn-settings').click();await page.locator('#theme-ui-font-scale').selectOption('200');await page.locator('#settings-save').click();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
for(const selector of ['.world-motion','.memo-done-toggle','#memo-today-label']){const fits=await page.locator(selector).evaluate(e=>e.scrollHeight<=e.clientHeight+2);assert.ok(fits,selector+' text clipped');}
await page.screenshot({path:'artifacts/readable-type-200.png'});assert.deepEqual(errors,[]);console.log('PASS: 8 new fonts; captions, world buttons, memo and sidebar scaling; save/cancel/reload/theme preservation; 200% layout');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});
