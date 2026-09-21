const assert = require('node:assert/strict');
const { chromium } = require('../mobile/node_modules/@playwright/test');
const { createPreviewServer } = require('../scripts/premium-preview.cjs');

(async () => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 860, height: 720 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?view=calendar`);
    await page.waitForFunction(() => currentView === 'calendar' && document.querySelectorAll('.day-cell').length === 42);
    await page.locator('#btn-settings').click();
    await page.locator('#theme-date-font-size').selectOption('30');
    await page.locator('#theme-event-font-size').selectOption('30');
    await page.locator('#settings-save').click();
    assert.equal(await page.evaluate(() => window.__preview.snapshot().theme.dateFontSize), '30');
    assert.equal(await page.evaluate(() => window.__preview.snapshot().theme.eventFontSize), '30');
    const layout = await page.evaluate(() => {
      const grid = document.querySelector('#calendar-grid');
      const cell = grid.querySelector('.day-cell.has-events');
      const event = cell.querySelector('.event-line');
      const date = cell.querySelector('.day-num');
      const banner = grid.querySelector('.event-banner-segment');
      return {
        dateSize: getComputedStyle(date).fontSize,
        eventSize: getComputedStyle(event).fontSize,
        bannerSize: banner && getComputedStyle(banner).fontSize,
        bannerHeight: banner && banner.getBoundingClientRect().height,
        eventFits: event.getBoundingClientRect().bottom <= cell.getBoundingClientRect().bottom + 1,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
      };
    });
    assert.equal(layout.dateSize, '30px');
    assert.equal(layout.eventSize, '30px');
    assert.equal(layout.bannerSize, '30px');
    assert.ok(layout.bannerHeight >= 30);
    assert.equal(layout.eventFits, true);
    assert.equal(layout.horizontalOverflow, false);
    await page.reload();
    await page.waitForFunction(() => currentView === 'calendar' && document.querySelectorAll('.day-cell').length === 42);
    assert.equal(await page.locator('.day-cell .day-num').first().evaluate(node => getComputedStyle(node).fontSize), '30px');
    assert.deepEqual(errors, []);
    console.log('PC 달력 날짜·일정 글씨 30px 저장 및 작은 창 표시 검증 통과');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
