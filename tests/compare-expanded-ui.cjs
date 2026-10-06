const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('@playwright/test');
const { createPreviewServer } = require('../scripts/premium-preview.cjs');
(async () => {
  const server = createPreviewServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({channel:'msedge'});
  const page = await browser.newPage({viewport:{width:860,height:1427}});
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*',r => r.request().url().startsWith(base) ? r.continue() : r.abort());
  try {
    await page.goto(base+'/?view=compare'); await page.waitForFunction(() => window.yeobaekReady && currentView === 'compare');
    const sheet = page.locator('#compare-sheet-0');
    await sheet.locator('[data-field="carModel"]').fill('보존할 차량');
    await sheet.locator('[data-company="MG캐피탈"][data-field="monthly"]').fill('100000');
    await page.locator('[data-compare-toggle="1"]').click();
    await sheet.locator('.compare-info-toggle').click();
    assert.equal(await sheet.locator('.compare-sheet-top').isVisible(),false);
    for(const size of [{width:860,height:1427},{width:1440,height:980},{width:1565,height:1344},{width:860,height:720}]) {
      await page.setViewportSize(size);
      const dimensions = await sheet.locator('.compare-table-scroll').evaluate(n => ({height:n.clientHeight,content:n.scrollHeight}));
      assert.ok(dimensions.content <= dimensions.height + 2, JSON.stringify({size,dimensions}));
      const columns = await sheet.evaluate(n => {
        const viewport=n.querySelector('.compare-table-scroll').getBoundingClientRect();
        const cells=[...n.querySelectorAll('thead th')].map(c=>c.getBoundingClientRect());
        const ranks=n.querySelector('.compare-rank-panel').getBoundingClientRect();
        return {count:cells.length,allVisible:cells.every(c=>c.left>=viewport.left-1&&c.right<=viewport.right+1),ranksVisible:ranks.right<=n.getBoundingClientRect().right,overflow:n.querySelector('.compare-table-scroll').scrollWidth>n.querySelector('.compare-table-scroll').clientWidth+2};
      });
      assert.equal(columns.count,5); assert.equal(columns.allVisible,true,JSON.stringify({size,columns}));
      assert.equal(columns.ranksVisible,true); assert.equal(columns.overflow,false);
      const last = sheet.locator('input[data-field="residual"]').last();
      await last.fill('123000'); assert.equal(await last.inputValue(),'123,000원');
    }
    await page.reload(); await page.waitForFunction(() => window.yeobaekReady && currentView === 'compare');
    assert.equal(await sheet.locator('.compare-sheet-top').isVisible(),false);
    await sheet.locator('.compare-info-toggle').click();
    assert.equal(await sheet.locator('[data-field="carModel"]').inputValue(),'보존할 차량');
    assert.equal(await sheet.locator('[data-total-for="MG캐피탈"]').innerText(),'6,000,000원');
    await sheet.locator('.compare-info-toggle').click();
    await page.setViewportSize({width:860,height:1427});
    await page.locator('#compare-panel .compare-card').evaluate(n => n.scrollTop=0);
    fs.mkdirSync(path.join(__dirname,'../artifacts/layout-ui'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'../artifacts/layout-ui/compare-single-expanded.png')});
    console.log('PASS: single sheet all lenders visible, compact/large heights, vehicle info fold persists, financial values preserved');
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => {console.error(e);process.exitCode=1;});
