const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { createPreviewServer } = require('../scripts/premium-preview.cjs');

(async () => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({channel:'msedge', headless:true});
  try {
    const page = await browser.newPage({viewport:{width:860,height:640}});
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin + '/?view=journal');
    const picker = page.locator('#simple-design');
    const frame = page.frameLocator('#simple-pane');
    await expect(picker).toBeHidden();
    await page.getByRole('button',{name:'간편모드',exact:true}).click();
    await expect(picker).toHaveAccessibleName('간편모드 디자인');
    await expect(picker).toHaveValue('mint');
    await frame.getByRole('button',{name:'오늘 할 일 추가'}).click();
    const draft = frame.locator('.entry-form input');
    await draft.fill('디자인 전환 중 초안');
    const presets = [
      ['mint','민트','rgb(10, 105, 93)'], ['paper','종이','rgb(135, 84, 45)'],
      ['blue','블루','rgb(35, 91, 164)'], ['lavender','라벤더','rgb(105, 80, 139)'],
      ['apricot','살구','rgb(151, 74, 46)'], ['graphite','그라파이트','rgb(65, 67, 65)']
    ];
    assert.deepEqual(await picker.locator('option').allTextContents(), presets.map(([,label])=>label));
    for (const [id,,accent] of presets) {
      await picker.selectOption(id);
      await expect(frame.locator('html')).toHaveAttribute('data-simple-design',id);
      await expect(frame.locator('.add').first()).toHaveCSS('background-color',accent);
      await expect(draft).toHaveValue('디자인 전환 중 초안');
    }
    await picker.selectOption('paper');
    await expect(frame.locator('html')).toHaveAttribute('data-simple-design','paper');
    await expect(draft).toHaveValue('디자인 전환 중 초안');
    await expect(frame.locator('.task-body').first()).toHaveCSS('background-image',/repeating-linear-gradient/);
    await page.locator('[data-simple-page=month]').click();
    await expect(frame.locator('.sdm-title')).toHaveCSS('font-family',/Batang/);
    const event = frame.locator('.sdm-event').first();
    await expect(event).toBeVisible();
    const eventPaint = () => event.evaluate(el => {
      const css = getComputedStyle(el);
      return [css.backgroundColor,css.borderInlineStartColor,css.color];
    });
    const originalPaint = await eventPaint();
    for (const [id] of presets) {
      await picker.selectOption(id);
      await expect(frame.locator('html')).toHaveAttribute('data-simple-design',id);
      assert.deepEqual(await eventPaint(), originalPaint);
    }
    await picker.selectOption('blue');
    await expect(frame.locator('.sdm-toolbar')).toHaveCSS('box-shadow',/inset/);
    await expect(frame.locator('.sdm-day[aria-current=date] .sdm-number')).toHaveCSS('background-color','rgb(35, 91, 164)');
    const box = await picker.boundingBox();
    assert.ok(box.x > 0 && box.x + box.width <= 860 && box.height >= 26);
    await page.reload();
    await expect(picker).toHaveValue('blue');
    await expect(frame.locator('.panel-head').first()).toHaveCSS('box-shadow',/inset/);
    await page.getByRole('button',{name:'기본모드',exact:true}).click();
    await expect(picker).toBeHidden();
    assert.equal(await page.locator('body').getAttribute('data-simple-design'),null);
    console.log('PASS six desktop designs, daily draft retained, monthly event colors preserved, compact selector, restored on reload and classic isolation');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode=1; });
