// The live-ledger preview uses only memory data; no Firebase or account writes.
const assert = require('node:assert/strict');
const { chromium } = require('../mobile/node_modules/@playwright/test');
const { createPreviewServer } = require('../scripts/premium-preview.cjs');

(async () => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?view=chulgo`);
    await page.waitForFunction(() => currentView === 'chulgo' && document.querySelectorAll('#chulgo-table-wrap tr[data-row-id]').length === 3);

    const name = page.locator('#chulgo-table-wrap input[data-id="ledger-1"][data-key="name"]');
    await name.focus();
    await name.fill('입력 중인 고객');
    const noChange = await page.evaluate(async () => {
      const input = document.querySelector('#chulgo-table-wrap input[data-id="ledger-1"][data-key="name"]');
      const snapshot = window.__preview.snapshot().ledger;
      snapshot.forEach((row, index) => { row.updatedAt = { seconds: index + 100, nanoseconds: 0 }; });
      window.__preview.emit('onChulgoUpdate', snapshot);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return input === document.querySelector('#chulgo-table-wrap input[data-id="ledger-1"][data-key="name"]');
    });
    assert.equal(noChange, true, 'metadata-only snapshot does not rebuild table');
    assert.equal(await name.evaluate(node => document.activeElement === node), true);

    await page.locator('#chulgo-ai-fill-btn').click();
    const prompt = page.locator('#chulgo-ai-fill-text');
    await prompt.fill('여러 건을 편집하는 중에도 이 문장이 유지돼야 합니다.');
    const tableNode = await page.locator('#chulgo-table-wrap table').evaluate(node => {
      window.__ledgerTableDuringPopup = node;
      return true;
    });
    assert.equal(tableNode, true);
    await page.evaluate(() => {
      for (let index = 0; index < 25; index++) {
        const snapshot = window.__preview.snapshot().ledger;
        snapshot[1].memo = `동료 수정 ${index}`;
        snapshot[1].updatedAt = { seconds: index + 200, nanoseconds: 0 };
        window.__preview.emit('onChulgoUpdate', snapshot);
      }
    });
    assert.equal(await prompt.inputValue(), '여러 건을 편집하는 중에도 이 문장이 유지돼야 합니다.');
    assert.equal(await prompt.evaluate(node => document.activeElement === node), true);
    assert.equal(await page.evaluate(() => window.__ledgerTableDuringPopup === document.querySelector('#chulgo-table-wrap table')), true, 'popup keeps background ledger stable');
    await page.locator('#chulgo-ai-fill-cancel').click();
    await page.waitForFunction(() => window.__ledgerTableDuringPopup !== document.querySelector('#chulgo-table-wrap table'));

    await page.evaluate(() => switchView('calendar'));
    await page.locator('.day-cell').first().click();
    await page.locator('#event-add-btn').click();
    const title = page.locator('#event-title');
    await title.fill('일정 제목 입력 유지');
    await page.evaluate(() => window.__preview.emit('onChulgoUpdate', window.__preview.snapshot().ledger));
    assert.equal(await title.inputValue(), '일정 제목 입력 유지');
    assert.deepEqual(errors, []);
    console.log('장부·AI·일정 입력 반응성 검증 통과');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
