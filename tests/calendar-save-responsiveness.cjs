const assert = require('node:assert/strict');
const {chromium} = require('@playwright/test');
const {createPreviewServer} = require('../scripts/premium-preview.cjs');
(async()=>{
 const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'msedge'});
  const page=await browser.newPage({viewport:{width:1500,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?view=calendar`);
  await page.waitForFunction(()=>typeof currentView!=='undefined'&&isGoogleSignedIn);
  await page.evaluate(()=>{
   window.pendingSaves=[];window.saveCalls=0;
   window.api.googleCreateEvent=()=>{window.saveCalls++;return new Promise((resolve,reject)=>pendingSaves.push({resolve,reject}));};
   window.api.googleGetEvents=()=>new Promise(resolve=>{window.finishRead=()=>resolve([]);});
   openDayPanel('2026-09-22');showEventForm(null);
  });
  const title=page.locator('#event-title');
  await title.fill('첫 일정');
  await page.evaluate(()=>{eventForm.requestSubmit();eventForm.requestSubmit();});
  assert.equal(await page.evaluate(()=>saveCalls),1);
  await page.evaluate(()=>{hideEventForm();showEventForm(null);});
  await title.fill('두 번째 작성 중');
  await page.evaluate(()=>pendingSaves[0].resolve({}));
  await page.waitForFunction(()=>!!window.finishRead);
  assert.equal(await title.inputValue(),'두 번째 작성 중');
  assert.equal(await title.isVisible(),true);
  assert.equal(await page.locator('#event-save').isEnabled(),true);
  await page.locator('#event-save').click();
  await page.evaluate(()=>pendingSaves[1].resolve({}));
  await page.waitForFunction(()=>eventForm.classList.contains('hidden'));
  await page.evaluate(()=>showEventForm(null));
  await title.fill('갱신 대기 중에도 입력');
  assert.equal(await page.locator('#event-save').isEnabled(),true);
  await page.locator('#event-save').click();
  await page.evaluate(()=>pendingSaves[2].reject(new Error('simulated failure')));
  await page.waitForFunction(()=>!document.getElementById('event-save').disabled);
  assert.equal(await title.inputValue(),'갱신 대기 중에도 입력');
  await page.evaluate(()=>{window.confirmResult=null;confirmCalendarAction('삭제 테스트').then(v=>window.confirmResult=v);});
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>window.confirmResult===false);
  await title.fill('취소 후 정상 입력');
  assert.deepEqual(errors,[]);
  console.log('PASS: duplicate submit, stale save/new draft, slow refresh, failed save/retry, nonblocking confirmation');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
