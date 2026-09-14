// Local real-renderer checks for the decorative canvases; no account data.
const { chromium } = require('@playwright/test');
const { createPreviewServer } = require('../scripts/premium-preview.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
(async () => {
 const output = process.env.NATURE_UI_OUTPUT || path.join(__dirname, '../artifacts/nature-ui');fs.mkdirSync(output,{recursive:true});
 const server=createPreviewServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:980},locale:'ko-KR'}),page=await context.newPage();
 const errors=[],missing=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()===404&&!r.url().endsWith('/favicon.ico'))missing.push(r.url())});
 await context.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 try{
  await page.goto(base+'/?view=compare');await page.waitForFunction(()=>window.yeobaekReady&&currentView==='compare'&&window.storybookPanorama&&window.storybookSidebar);
  await page.evaluate(()=>{window.natureSamples=[];for(const key of ['storybookPanorama','storybookSidebar']){const draw=window[key].draw;window[key]={draw:(...args)=>{const start=performance.now();draw(...args);window.natureSamples.push(performance.now()-start)}}}});
  const ids=await page.locator('#journal-theme-select option').evaluateAll(ns=>ns.map(n=>n.value).filter(v=>v!=='custom'));
  async function canvasState(){return page.evaluate(()=>['.world-panorama','.journal-side-canvas'].map(sel=>{const c=document.querySelector(sel),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let visible=0;for(let i=3;i<d.length;i+=64)if(d[i]>20)visible++;return {visible,pixels:c.toDataURL()}}))}
  for(const id of ids){
   await page.locator('#journal-theme-select').selectOption(id);await page.waitForFunction(id=>document.body.dataset.storyTheme===id,id);
   for(const scene of [0,1,2]){
    await page.locator(`[data-world-scene="${scene}"]`).click();await page.waitForTimeout(560);
    const a=await canvasState();assert.ok(a.every(c=>c.visible>80),`${id}/${scene} decoration visible`);
    await page.waitForTimeout(180);const b=await canvasState();assert.ok(b.every((c,i)=>c.pixels!==a[i].pixels),`${id}/${scene} live movement`);
    if(scene!==1)await page.screenshot({path:path.join(output,`${id}-scene-${scene}.png`)});
   }
   checks.push(`theme/${id}/3-visible-moving-scenes`);
  }
  await page.locator('#journal-theme-select').selectOption('wood');await page.locator('[data-world-scene="2"]').click();await page.waitForTimeout(550);
  const first=page.locator('#compare-sheet-0 [data-field="carModel"]');await first.fill('동물 배경에서도 입력 유지');
  await page.locator('[data-compare-toggle="1"]').click();assert.equal(await page.locator('#compare-sheet-1').isVisible(),false);
  assert.equal(await first.inputValue(),'동물 배경에서도 입력 유지');checks.push('decoration/compare-input-and-fold-operable');
  await page.locator('.world-motion').click();await page.waitForTimeout(120);const paused=await canvasState();await page.waitForTimeout(220);
  assert.deepEqual(await canvasState(),paused);checks.push('motion/pause-freezes-both-canvases');
  await page.locator('.world-motion').click();await page.waitForTimeout(180);assert.notDeepEqual(await canvasState(),paused);
  await page.locator('.world-collapse').click();assert.equal(await page.locator('.world-panorama').isVisible(),false);assert.equal(await page.locator('.journal-side-life').isVisible(),false);
  await page.locator('.world-collapse').click();assert.equal(await page.locator('.journal-side-life').isVisible(),true);checks.push('motion/collapse-restores-both-decorations');
  for(const size of [{width:1440,height:980},{width:1080,height:800},{width:860,height:720}]){
   await page.setViewportSize(size);await page.waitForTimeout(150);
   const geometry=await page.evaluate(()=>{const get=s=>document.querySelector(s).getBoundingClientRect();const side=get('.journal-side-life');return{overlap:side.top<get('[data-view="compare"]').bottom||side.bottom>get('.journal-sidebar-bottom').top,overflow:document.documentElement.scrollWidth>innerWidth+2,pointer:getComputedStyle(document.querySelector('.world-panorama')).pointerEvents}});
   assert.equal(geometry.overlap,false);assert.equal(geometry.overflow,false);assert.equal(geometry.pointer,'none');
   await page.screenshot({path:path.join(output,`wood-compare-${size.width}.png`)});checks.push(`layout/${size.width}/no-control-overlap`);
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.getElementById('journal-world').dataset.playing==='false');
  const reduced=await canvasState();await page.waitForTimeout(220);assert.deepEqual(await canvasState(),reduced);checks.push('motion/reduced-motion-stops-decorations');
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  const performance=await page.evaluate(()=>{const a=window.natureSamples.slice().sort((a,b)=>a-b);return{drawCount:a.length,p95ms:a[Math.floor(a.length*.95)],maxMs:a.at(-1)}});
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({checks,errors,missing,performance,note:'Local memory fixture only.'},null,2));
  console.log(JSON.stringify({passed:checks.length,errors,missing,performance,output}));
 }catch(error){await page.screenshot({path:path.join(output,'failure.png')});console.error(error);process.exitCode=1;}
 finally{await context.close();await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
