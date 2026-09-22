const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {_electron:electron}=require('@playwright/test');
const {createPreviewServer}=require('../scripts/premium-preview.cjs');
(async()=>{
 const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));let app;
 const testRoot=path.resolve('artifacts/input-stress');fs.mkdirSync(testRoot,{recursive:true});
 const entry=path.join(testRoot,'main.cjs');
 fs.writeFileSync(entry,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(testRoot,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1500,height:1000,show:false,webPreferences:{backgroundThrottling:false}});w.loadURL('http://127.0.0.1:${server.address().port}/?view=journal');});`);
 try{
  app=await electron.launch({args:[entry]});const page=await app.firstWindow();page.setDefaultTimeout(15000);console.log('Electron window ready');const wait=page.waitForFunction.bind(page);page.waitForFunction=(fn,arg,opts={})=>wait(fn,arg,{polling:100,timeout:15000,...opts});
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Page error: '+e.message)});
  await page.waitForFunction(()=>typeof currentView!=='undefined'&&currentView==='journal',null,{polling:100});console.log('Journal ready');
  await page.evaluate(()=>{
   window.reads=[];window.inflightReads=0;window.maxReads=0;window.writes=0;
   window.api.googleGetEvents=()=>new Promise(resolve=>{inflightReads++;maxReads=Math.max(maxReads,inflightReads);reads.push(()=>{inflightReads--;resolve([])});});
   window.api.googleCreateEvent=async()=>{writes++;await new Promise(r=>setTimeout(r,30));return {id:'test-'+writes};};
   window.api.createMemo=async()=>({id:'memo'});
  });
  for(let i=0;i<30;i++){ if(i%10===0)console.log('save cycle '+i);
   await page.locator('#journal-quick-title').fill('연속 일정 '+i);
   await page.locator('#journal-quick-submit').click();
   await page.waitForFunction(()=>!document.getElementById('journal-quick-submit').disabled);
  }
  assert.equal(await page.evaluate(()=>writes),30);
  assert.equal(await page.evaluate(()=>maxReads),1);
  await page.locator('#journal-quick-title').fill('보존할 다음 초안');
  await page.evaluate(()=>reads.shift()());
  await page.waitForFunction(()=>reads.length===1);
  await page.evaluate(()=>reads.shift()());
  await page.waitForFunction(()=>calendarRefreshRunning===null);
  assert.equal(await page.locator('#journal-quick-title').inputValue(),'보존할 다음 초안');
  await page.evaluate(()=>switchView('calendar'));
  for(let i=0;i<20;i++){
   await page.evaluate(()=>{openDayPanel('2026-09-22');showEventForm(null);});
   await page.locator('#event-title').fill('수정 취소 반복 '+i);
   await page.locator('#event-cancel').click();
   await page.evaluate(()=>{window.dialogResult=null;confirmCalendarAction('취소 검사').then(v=>window.dialogResult=v);});
   await page.keyboard.press('Escape');
   await page.waitForFunction(()=>window.dialogResult===false);
  }
  await page.evaluate(()=>showEventForm(null));
  await page.locator('#event-title').fill('마지막 입력 정상');
  assert.equal(await page.locator('#event-title').inputValue(),'마지막 입력 정상');
  assert.deepEqual(errors,[]);
  console.log('PASS Electron: 30 quick saves while reads stalled; max 1 read; drafts preserved; 20 open/type/cancel/dialog cycles; no runtime errors');
 }finally{if(app)await app.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
