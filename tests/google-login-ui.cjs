// Exercise the real PC login entry points with a memory-only Google API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { createPreviewServer } = require('../scripts/premium-preview.cjs');

(async () => {
  const output = path.join(__dirname, '../artifacts/google-login-ui');
  fs.mkdirSync(output, { recursive: true });
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1080, height: 800 }, locale: 'ko-KR' });
  await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base + '/?view=journal&auth=signed-out');
    await page.waitForFunction(() => window.yeobaekReady && currentView === 'journal');
    const button = page.getByRole('button', { name: 'Google 로그인', exact: true });
    async function reachable(label) {
      assert.equal(await button.isVisible(), true, label);
      assert.equal(await button.evaluate(node => {
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && node.contains(hit);
      }), true, label);
    }
    await reachable('signed-out first screen');
    assert.equal(await page.locator('#journal-add-event').isDisabled(), true);
    assert.equal(await page.locator('#google-status button').isVisible(), false);
    checks.push('startup/login-reachable-without-opening-calendar');
    await page.screenshot({ path: path.join(output, 'signed-out-home.png') });
    for (const view of ['calendar', 'memo', 'ai', 'chulgo', 'reminder', 'compare', 'journal']) {
      await page.locator(`.sidebar-nav-btn[data-view="${view}"]`).click();
      await reachable(view);
    }
    checks.push('navigation/login-reachable-in-all-general-views');
    await page.setViewportSize({ width: 860, height: 600 });
    await page.locator('#journal-rail-toggle').click();
    await reachable('compact collapsed rail');
    await page.screenshot({ path: path.join(output, 'signed-out-compact.png') });
    checks.push('compact/login-reachable-with-collapsed-rail');
    const themes = await page.locator('#journal-theme-select option').evaluateAll(nodes => nodes.map(n => n.value).filter(v => v !== 'custom'));
    for (const theme of themes) {
      await page.locator('#journal-theme-select').selectOption(theme);
      await page.waitForFunction(theme => document.body.dataset.storyTheme === theme, theme);
      await reachable(theme);
    }
    checks.push('themes/login-reachable-in-nine-themes');
    await page.evaluate(() => {
      window.__authFixtureApi = window.api;
      window.__signInAttempts = 0;
      window.api = new Proxy(window.api, { get(target, name) {
        if (name === 'googleSignIn') return async () => {
          window.__signInAttempts++;
          await new Promise(resolve => { window.__releaseSignIn = resolve; });
          return target.googleSignIn();
        };
        return target[name];
      } });
      window.__preview.failNext('googleSignIn');
    });
    await button.click();
    assert.equal(await page.locator('#google-signin-button').isDisabled(), true);
    assert.equal(await page.locator('#google-status button').isDisabled(), true);
    await page.evaluate(() => {
      renderGoogleStatus();
      document.getElementById('google-signin-button').click();
      document.querySelector('#google-status button').click();
    });
    assert.equal(await page.evaluate(() => window.__signInAttempts), 1);
    checks.push('pending/shared-button-state-and-single-request');
    await page.evaluate(() => window.__releaseSignIn());
    await page.waitForFunction(() => !document.getElementById('google-signin-button').disabled);
    await reachable('retry after cancellation/failure');
    assert.match(await page.locator('#google-signin-message').innerText(), /다시 시도/);
    checks.push('failure/visible-retry-and-released-controls');
    await page.evaluate(() => { window.api = window.__authFixtureApi; });
    await button.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('google-signin-banner').classList.contains('hidden'));
    await page.waitForFunction(() => !document.getElementById('journal-add-event').disabled);
    assert.equal(await page.locator('#journal-add-event').isDisabled(), false);
    const snapshot = await page.evaluate(() => window.__preview.snapshot());
    assert.equal(snapshot.calls.filter(c => c.method === 'googleSignIn').length, 2);
    assert.equal(snapshot.calls.some(c => /create|delete/i.test(c.method)), false);
    checks.push('keyboard/login-connects-and-restores-journal-controls');
    await page.locator('.sidebar-nav-btn[data-view="calendar"]').click();
    await page.locator('#google-status').getByRole('button', { name: '로그아웃', exact: true }).click();
    await page.waitForFunction(() => !document.getElementById('google-signin-banner').classList.contains('hidden'));
    await page.locator('.sidebar-nav-btn[data-view="journal"]').click();
    await reachable('after logout');
    await page.waitForFunction(() => document.getElementById('journal-add-event').disabled);
    assert.equal(await page.locator('#journal-add-event').isDisabled(), true);
    checks.push('logout/banner-restored-and-existing-controls-disabled');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, errors, output }));
  } finally {
    await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
