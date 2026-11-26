const assert = require('node:assert/strict');
const {chromium, expect} = require('@playwright/test');
const {createPreviewServer} = require('../scripts/premium-preview.cjs');
const {getHolidaysForYear} = require('../src/main/koreanHolidays');

const holidays = year => new Map(getHolidaysForYear(year).map(h => [h.date, h.name]));
const current = holidays(2026);
for (const date of ['02-16','02-17','02-18']) assert.equal(current.get('2026-'+date), '설날');
assert.equal(current.has('2026-02-19'),false);
for (const date of ['09-24','09-25','09-26']) assert.equal(current.get('2026-'+date), '추석');
for (const date of ['03-02','05-25','08-17','10-05']) assert.match(current.get('2026-'+date), /대체공휴일/);
for (const date of ['06-08','09-28']) assert.equal(current.has('2026-'+date),false);
assert.equal(current.get('2026-05-01'),'노동절');
assert.equal(current.get('2026-07-17'),'제헌절');
assert.equal(current.get('2026-06-03'),'제9회 전국동시지방선거일');
const next = holidays(2027);
assert.equal(next.get('2027-02-09'),'설날 대체공휴일');
assert.equal(next.get('2027-05-03'),'노동절 대체공휴일');
console.log('PASS Korean holidays, lunar boundaries, substitutions and 2026 legislative changes');

(async()=>{
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:860,height:640},timezoneId:'Asia/Seoul'});
    await page.route('**/*', route => route.request().url().startsWith(origin+'/') ? route.continue() : route.abort());
    await page.clock.setFixedTime(new Date('2026-08-15T11:00:00+09:00'));
    await page.exposeFunction('fixtureHolidays', getHolidaysForYear);
    await page.goto(origin+'/?auth=signed-out&view=journal');
    await page.waitForFunction(()=>window.yeobaekReady);
    await page.evaluate(()=>{ window.api.getHolidays=window.fixtureHolidays; holidaysCache.clear(); });
    await page.getByRole('button',{name:'간편모드',exact:true}).click();
    await expect(page.locator('#simple-google-button')).toHaveText('Google 연결');
    await page.locator('[data-simple-page=month]').click();
    const frame = page.frameLocator('#simple-pane');
    const cell = date => frame.locator('.sdm-day[data-date="'+date+'"]');
    await page.locator('#simple-type-button').click();
    await page.locator('#simple-type-scale').selectOption('200');
    await page.getByRole('button',{name:'글자 설정 닫기'}).click();
    const red = 'rgb(174, 38, 56)', blue = 'rgb(23, 89, 175)';
    for(const design of ['mint','paper','blue','lavender','apricot','graphite']) {
      await page.locator('#simple-design').selectOption(design);
      await expect(frame.locator('html')).toHaveAttribute('data-simple-design',design);
      for (const date of ['2026-08-15','2026-08-16','2026-08-17']) {
        await expect(cell(date).locator('.sdm-number')).toHaveCSS('color',red);
      }
      await expect(cell('2026-08-22').locator('.sdm-number')).toHaveCSS('color',blue);
      await expect(cell('2026-08-15')).toHaveAttribute('aria-current','date');
      await expect(cell('2026-08-15').locator('.sdm-number')).toHaveCSS('box-shadow',/inset/);
    }
    const holidayCell=cell('2026-08-17');
    await expect(holidayCell.locator('.sdm-holiday-name')).toHaveText('광복절 대체공휴일');
    await expect(holidayCell).toHaveAccessibleName(/광복절 대체공휴일, 일정 0건/);
    await expect(holidayCell).toHaveAttribute('title','광복절 대체공휴일');
    await holidayCell.click();
    await expect(page.locator('#day-panel-title')).toHaveText('2026년 8월 17일 (광복절 대체공휴일)');
    await page.locator('#day-panel-close').click();
    for(let i=0;i<4;i++) await frame.getByRole('button',{name:'다음 달',exact:true}).click();
    const adjacent=cell('2027-01-01');
    await expect(adjacent).toHaveClass(/sdm-outside/);
    await expect(adjacent.locator('.sdm-number')).toHaveCSS('color',red);
    await expect(adjacent.locator('.sdm-holiday-name')).toHaveText('신정');
    await adjacent.click();
    await expect(page.locator('#day-panel-title')).toHaveText('2027년 1월 1일 (신정)');
    console.log('PASS signed-out month, adjacent-year detail, Saturday/Sunday and holiday numerals including today across 6 themes at 200%');
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
