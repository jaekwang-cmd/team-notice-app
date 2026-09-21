const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const { createPreviewServer } = require('../scripts/premium-preview.cjs');
(async () => {
  const server = createPreviewServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('journal_world_preferences_v1', JSON.stringify({ motion:false, collapsed:true, followPage:false })));
    await page.goto(`http://127.0.0.1:${server.address().port}/?view=journal`);
    await page.waitForFunction(() => currentView === 'journal');
    assert.equal(await page.locator('.world-controls').isVisible(), false);
    assert.equal(await page.locator('#journal-world').getAttribute('data-collapsed'), 'false');
    assert.equal(await page.locator('.journal-ai-dock #ai-chat-input').count(), 1);
    await page.evaluate(() => { window.api.aiChat = async () => ({content:'테스트 답변입니다.'}); });
    await page.locator('#ai-chat-input').fill('테스트');
    await page.locator('#ai-chat-send').click();
    await page.waitForFunction(() => document.querySelector('#ai-chat-messages').textContent.includes('테스트 답변입니다.'));
    assert.equal(await page.evaluate(() => currentView), 'journal');
    await page.evaluate(() => switchView('ai'));
    assert.equal(await page.locator('#ai-panel #ai-chat-input').count(), 1);
    await page.evaluate(() => switchView('journal'));
    assert.ok((await page.locator('.journal-ai-dock').innerText()).includes('테스트 답변입니다.'));
    await page.locator('#journal-theme-select').selectOption('nightStudy');
    await page.evaluate(() => { document.getElementById('journal-date-title').textContent='9월 21일, 월요일'; });
    for (const width of [1500,1100,900]) {
      await page.setViewportSize({width,height:1000});
      const fits = await page.locator('#journal-date-title').evaluate(e => e.scrollWidth <= e.clientWidth + 1 && e.clientHeight < parseFloat(getComputedStyle(e).lineHeight)*1.5);
      assert.ok(fits, `Date fits ${width}`);
    }
    await page.setViewportSize({width:1500,height:1000});
    await page.evaluate(() => { document.querySelector('.journal-page').scrollTop = 0; });
    await page.screenshot({path:'artifacts/desktop-comfort-journal.png'});
    await page.evaluate(() => { document.getElementById('chulgo-settlement-popup').classList.remove('hidden'); });
    const card = page.locator('.chulgo-settlement-card');
    await card.dispatchEvent('wheel',{ctrlKey:true,deltaY:-100,bubbles:true,cancelable:true});
    assert.equal(await card.evaluate(e=>e.style.zoom),'1.1');
    await card.dispatchEvent('wheel',{ctrlKey:false,deltaY:-100,bubbles:true,cancelable:true});
    assert.equal(await card.evaluate(e=>e.style.zoom),'1.1');
    await page.locator('.settlement-zoom-tools button').nth(1).click();
    assert.equal(await card.evaluate(e=>e.style.zoom),'1');
    assert.deepEqual(errors,[]);
    console.log('PASS: inline AI response/history, date widths, automatic scenery, isolated Ctrl-wheel zoom/reset');
  } finally { if(browser) await browser.close(); await new Promise(r=>server.close(r)); }
})().catch(e=>{console.error(e);process.exitCode=1});
