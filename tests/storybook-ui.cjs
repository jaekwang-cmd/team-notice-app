// Real PC renderer smoke tests against scripts/premium-preview.cjs; all data lives in memory.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { createPreviewServer } = require('../scripts/premium-preview.cjs');

(async () => {
  const baselineOnly = process.argv.includes('--baseline');
  const output = path.resolve(process.env.STORYBOOK_UI_OUTPUT || path.join(__dirname, '../artifacts/storybook-ui'));
  await fs.mkdir(output, { recursive: true });
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser, context;
  const checks = [], errors = [], requests = [], missing = [];
  try {
    browser = process.env.PREMIUM_CDP_URL
      ? await chromium.connectOverCDP(process.env.PREMIUM_CDP_URL)
      : await chromium.launch({ channel: 'msedge', headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 980 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(base + '/') || url.startsWith('data:')) return route.continue();
      requests.push(url); return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if(response.status()===404 && !response.url().endsWith('favicon.ico')) missing.push(response.url());});
    page.on('dialog', dialog => dialog.accept());
    await page.goto(base);
    await page.waitForFunction(() => typeof currentView !== 'undefined' && currentView === 'calendar' && document.querySelectorAll('#calendar-grid .day-cell').length === 42);
    await page.waitForFunction(() => window.yeobaekReady && window.storybookThemes?.length === 9);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#premium-preview-badge').count(), 1); checks.push('fixture/real-renderer-42-days');
    assert.deepEqual(errors, [], 'renderer initialization');
    await page.screenshot({ path: path.join(output, 'initial-1440.png') });
    if (baselineOnly) {
      console.log(JSON.stringify({ passed: checks.length, errors, requests, output, unknownApi: await page.evaluate(() => window.__preview.snapshot().unhandled) }, null, 2));
      return;
    }

    async function noMainOverflow(label) {
      const result = await page.evaluate(() => {
        const html = document.documentElement;
        const cells = [...document.querySelectorAll('#calendar-grid .day-cell')];
        return { document: html.scrollWidth <= innerWidth + 2, cells: cells.every(cell => cell.getBoundingClientRect().width >= 40), header: [...document.querySelectorAll('.calendar-header button')].every(button => { const r = button.getBoundingClientRect(); return !r.width || r.left >= -1 && r.right <= innerWidth + 1; }) };
      });
      assert.equal(result.document, true, `${label}: document width`);
      assert.equal(result.cells, true, `${label}: date cells remain legible`);
      assert.equal(result.header, true, `${label}: header controls remain reachable`);
      checks.push(label);
    }
    const themeIds = await page.locator('#journal-theme-select option').evaluateAll(nodes => nodes.map(node => node.value).filter(value => value !== "custom"));
    assert.equal(themeIds.length, 9);
    const before = await page.evaluate(() => { const t=window.__preview.snapshot().theme; return [t.font,t.bold,t.cardStyle,t.dateFontSize,t.eventFontSize]; });
    for (const theme of themeIds) {
      await page.locator('#journal-theme-select').selectOption(theme);
      await page.waitForFunction(theme => document.body.dataset.storyTheme === theme, theme);
      await page.waitForTimeout(220);
      await page.evaluate(() => document.fonts.ready);
      await noMainOverflow(`theme/${theme}/1440`);
      const paper = await page.locator('.calendar-card').evaluate(node => getComputedStyle(node).backgroundColor);
      const channels = paper.match(/[0-9.]+/g).slice(0,3).map(Number);
      assert.ok(channels.every(c => c > 230), `${theme}: readable bright page ${paper}`);
      await page.screenshot({ path:path.join(output, `theme-${theme}-1440.png`) });
    }
    const after = await page.evaluate(() => { const t=window.__preview.snapshot().theme; return [t.font,t.bold,t.cardStyle,t.dateFontSize,t.eventFontSize]; });
    assert.deepEqual(after,before); checks.push('themes/preserve-user-typography');
    await page.locator('#journal-theme-select').selectOption('cherryGarden');
    await page.locator('.sidebar-nav-btn[data-view="journal"]').click();
    for (const theme of themeIds) {
      await page.locator('#journal-theme-select').selectOption(theme);
      await page.waitForFunction(theme => document.body.dataset.storyTheme === theme, theme);
      for (let scene=0;scene<3;scene++) {
        await page.locator(`[data-world-scene="${scene}"]`).click();
        await page.waitForTimeout(560);
        const painted = await page.locator('.world-landscape').evaluate(c => {
          const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          let visible=0; for(let i=3;i<d.length;i+=128) if(d[i])visible++;
          return visible>100;
        });
        assert.ok(painted, `${theme}/${scene}: painted landscape`);
        if (scene===1) await page.screenshot({path:path.join(output,`journal-${theme}.png`)});
      }
      checks.push(`world/${theme}/three-scenes`);
    }
    await page.locator('#journal-theme-select').selectOption('wood');
    await page.locator('.sidebar-nav-btn[data-view="calendar"]').click();
    for (const size of [{width:1440,height:980},{width:1080,height:720},{width:860,height:720}]) {
      await page.setViewportSize(size); await page.waitForTimeout(120);
      await noMainOverflow(`calendar/${size.width}`);
      await page.screenshot({path:path.join(output,`compact-${size.width}.png`)});
    }
    await page.setViewportSize({width:1440,height:980});
    // Reuse the original event form and save handler. The fixture proves only local side effects.
    await page.evaluate(() => { setCalendarOnly(false); openDayPanel(window.__preview.day(0)); showEventForm(null); });
    await page.locator('#event-title').fill('화사한 여백 UI 저장 검증');
    const swatch = page.locator('.event-color-swatch[data-color-id="3"]');
    await swatch.click();
    assert.equal(await page.locator('#event-form').isVisible(), true);
    assert.equal(await swatch.getAttribute('aria-pressed'), 'true');
    await page.locator('#event-save').click();
    await page.waitForFunction(() => window.__preview.snapshot().events.some(event => event.title === '화사한 여백 UI 저장 검증'));
    await page.locator('#event-form').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__preview.snapshot().events.filter(event => event.title === '화사한 여백 UI 저장 검증').length), 1);
    checks.push('calendar/create-once-color-picker');
    await page.evaluate(() => {
      const event = window.__preview.snapshot().events.find(event => event.title === '화사한 여백 UI 저장 검증');
      openDayPanel(event.start.slice(0, 10)); showEventForm(event);
    });
    await page.locator('#event-title').fill('화사한 여백 UI 수정 완료');
    await page.locator('#event-save').click();
    await page.waitForFunction(() => window.__preview.snapshot().events.some(event => event.title === '화사한 여백 UI 수정 완료'));
    assert.equal(await page.evaluate(() => window.__preview.snapshot().events.some(event => event.title === '화사한 여백 UI 저장 검증')), false);
    checks.push('calendar/update-preserves-existing-handler');
    const untrustedTitle = '<img src=x onerror="window.__unsafeTitleExecuted=true"> 테스트 & 제목';
    await page.evaluate(async title => {
      const day = window.__preview.day(1);
      await window.api.googleCreateEvent({ summary: title, start: { date: day }, end: { date: window.__preview.day(2) } });
      await refreshEventsAndDayPanel(); openDayPanel(day);
    }, untrustedTitle);
    assert.equal(await page.getByText(untrustedTitle, { exact: true }).count() > 0, true);
    assert.equal(await page.locator('#calendar-grid img, #day-event-list img').count(), 0);
    assert.equal(await page.evaluate(() => window.__unsafeTitleExecuted), undefined); checks.push('calendar/untrusted-title-remains-text');
    const monthBefore = await page.locator('#calendar-title').innerText();
    await page.locator('#next-month').click();
    await page.waitForFunction(value => document.getElementById('calendar-title').textContent !== value, monthBefore);
    await page.locator('#prev-month').click();
    await page.waitForFunction(value => document.getElementById('calendar-title').textContent === value, monthBefore); checks.push('calendar/month-navigation');
    await page.locator('.sidebar-nav-btn[data-view="chulgo"]').click();
    const funds = page.locator('[data-row-id="ledger-1"] input[data-key="initialFunds"]');
    await funds.waitFor({ state: 'visible' });
    const nestedBefore = await page.evaluate(() => { const item = window.__preview.snapshot().ledger.find(item => item.id === 'ledger-1'); return { paybacks: item.paybacks, extraFees: item.extraFees }; });
    await funds.fill('보증 10% 선납 10%');
    await funds.dispatchEvent('change');
    await page.waitForFunction(() => window.__preview.snapshot().ledger.find(item => item.id === 'ledger-1').initialFunds === '보증 10% 선납 10%');
    await page.waitForTimeout(100);
    assert.equal(await funds.inputValue(), '보증 10% 선납 10%');
    assert.equal(await funds.evaluate(node => document.activeElement === node), true, 'snapshot must preserve initial funds focus');
    const company = page.locator('[data-row-id="ledger-1"] select[data-key="company"]');
    await company.selectOption('KB캐피탈');
    await page.waitForFunction(() => window.__preview.snapshot().ledger.find(item => item.id === 'ledger-1').company === 'KB캐피탈');
    assert.equal(await company.evaluate(node => node.classList.contains('chulgo-pill-select')), true);
    const nestedAfter = await page.evaluate(() => { const item = window.__preview.snapshot().ledger.find(item => item.id === 'ledger-1'); return { paybacks: item.paybacks, extraFees: item.extraFees }; });
    assert.deepEqual(nestedAfter, nestedBefore); checks.push('ledger/initial-funds-focus-company-and-nested-fields');
    await page.screenshot({ path: path.join(output, 'ledger-1440.png') });
    await page.setViewportSize({ width: 1080, height: 720 });
    await page.screenshot({ path: path.join(output, 'ledger-1080.png') });
    const exportButtons = ['#chulgo-export-btn', '#chulgo-settlement-btn'];
    for (const selector of exportButtons) if (await page.locator(selector).count()) assert.equal(await page.locator(selector).isVisible(), true);
    checks.push('ledger/original-tools-present');
    await page.setViewportSize({ width: 1440, height: 980 });
    for (const view of ['journal', 'memo', 'ai', 'reminder', 'compare', 'chulgo']) {
      await page.locator(`.sidebar-nav-btn[data-view="${view}"]`).click();
      await page.waitForFunction(view => currentView === view, view);
      await page.screenshot({ path: path.join(output, `menu-${view}-1440.png`) });
      const documentFits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2);
      assert.equal(documentFits, true, `${view}: document does not gain horizontal overflow`); checks.push(`menu/${view}/layout`);
    }
    await page.locator('.sidebar-nav-btn[data-view="calendar"]').click();
    await page.evaluate(async () => {
      const day = window.__preview.day(0), end = window.__preview.day(2);
      for (let i = 0; i < 7; i++) await window.api.googleCreateEvent({ summary: `큰 글꼴 배너 ${i + 1}`, start: { date: day }, end: { date: end } });
      await refreshEventsAndDayPanel();
      applyTheme({ ...window.__preview.snapshot().theme, dateFontSize: '30', eventFontSize: '30' });
      window.storybookUI.applyTheme({...window.__preview.snapshot().theme,dateFontSize:'30',eventFontSize:'30'});
      buildCalendarGrid();
    });
    await page.waitForTimeout(200);
    const eventBounds = await page.evaluate(() => {
      const cell = document.querySelector(`.day-cell[data-date="${window.__preview.day(0)}"]`);
      const area = cell.getBoundingClientRect();
      return { count: cell.querySelectorAll('.event-banner-segment').length, problems: [...cell.querySelectorAll('.event-line,.event-more,.event-banner-segment')].filter(node => { const r = node.getBoundingClientRect(); return r.bottom > area.bottom + 1 || r.top < area.top - 1; }).map(node => ({ className: node.className, text: node.textContent })), scrollable: document.querySelector('.calendar-main').scrollHeight > document.querySelector('.calendar-main').clientHeight };
    });
    assert.ok(eventBounds.count >= 7);
    assert.deepEqual(eventBounds.problems, [], 'large font events and seven banners must stay inside day');
    assert.equal(eventBounds.scrollable, true); checks.push('calendar/large-font-busy-week-scroll');
    await page.screenshot({ path: path.join(output, 'large-font-busy-week.png') });
    await page.evaluate(() => applyTheme(window.__preview.snapshot().theme));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.getElementById('journal-world').dataset.playing === 'false');
    checks.push('motion/reduced-motion-stops-landscape');
    assert.deepEqual(errors, [], 'browser runtime errors');
    assert.deepEqual(missing, [], 'all styles, scripts and fonts available');
    const result = { passed: checks.length, checks, errors, blockedExternalRequests: requests.length, themes: themeIds, unknownApi: await page.evaluate(() => window.__preview.snapshot().unhandled), note: 'All authentication and CRUD calls use a memory-only local fixture. No live account data or production writes.' };
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ passed: checks.length, errors, output }, null, 2));
  } catch (error) {
    console.error(error);
    await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, stack: error.stack, errors, checks }, null, 2));
    if (context?.pages()[0]) await context.pages()[0].screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await context?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
})();
