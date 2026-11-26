const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { createPreviewServer } = require('../scripts/premium-preview.cjs');

const font = el => {
  const css = getComputedStyle(el);
  return { family: css.fontFamily, size: parseFloat(css.fontSize), weight: css.fontWeight };
};
const guideFamilies = controls => controls.evaluateAll(elements => elements.map(el => getComputedStyle(el).fontFamily));
async function platformFonts(page, selector) {
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const {root} = await cdp.send('DOM.getDocument');
    const {nodeId} = await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
    const {fonts} = await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
    assert.ok(fonts.some(item=>item.glyphCount>0),'rendered font glyphs: '+selector);
    return fonts.filter(item=>item.glyphCount>0);
  } finally { await cdp.detach(); }
}
async function chooseFont(page,id,value) {
  await page.locator('#'+id+'-trigger').click();
  const option = page.locator('#'+id+'-listbox [role=option]').filter({hasText:/./});
  const values = await option.evaluateAll(items=>items.map(item=>item.dataset.value));
  const index = values.indexOf(value);
  assert.ok(index>=0,'font choice '+value);
  await option.nth(index).click();
  await expect(page.locator('#'+id)).toHaveValue(value);
  await expect(page.locator('#'+id+'-trigger')).toHaveAttribute('aria-expanded','false');
}
async function expectReading(locator, original) {
  await expect(locator).toHaveCSS('font-family', /Yeobaek Story/);
  await expect(locator).toHaveCSS('font-weight','700');
  const current = await locator.evaluate(font);
  assert.ok(current.size >= original.size * 1.95, '200% size: '+JSON.stringify({original,current}));
}

(async () => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const context = await browser.newContext({viewport:{width:860,height:640},timezoneId:'Asia/Seoul'});
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(origin+'/?view=journal');
    await page.waitForFunction(() => window.yeobaekReady);
    const classic = page.locator('.app-title');
    const classicFont = await classic.evaluate(font);
    // Two colors per date in a month without seeded events. Only the in-memory fixture is touched.
    const palette = await page.evaluate(async () => {
      const now = new Date();
      let i = 0;
      const colors = [];
      for (const color of EVENT_COLORS) {
        const start = new Date(now.getFullYear(),now.getMonth()+2,1+Math.floor(i++/2),12);
        const day = toDateStr(start);
        await window.api.googleCreateEvent({summary:'검사용 색 '+color.id, start:{date:day},
          end:{date:addDaysStr(day,1)},colorId:color.id});
        const rgb = color.hex.slice(1).match(/../g).map(hex => parseInt(hex,16));
        colors.push({day,label:'검사용 색 '+color.id,background:'rgb('+rgb.join(', ')+')'});
      }
      return colors;
    });
    assert.equal(palette.length,11);
    assert.equal(new Set(palette.map(row=>row.background)).size,11);
    const frame = page.frameLocator('#simple-pane');
    const typeButton = page.locator('#simple-type-button');
    const family = page.locator('#simple-type-family'), weight = page.locator('#simple-type-weight'), scale = page.locator('#simple-type-scale');
    const closeType = page.getByRole('button',{name:'글자 설정 닫기'});
    const guide = page.locator('#simple-type-button, #simple-type-panel :is(h2,label,button,select):not([role=option]):not([role=combobox])');
    const sample = page.locator('#simple-type-preview');
    await expect(typeButton).toBeHidden();
    await page.getByRole('button',{name:'간편모드',exact:true}).click();
    const visitMonth = async () => {
      await page.locator('[data-simple-page=month]').click();
      const next = frame.getByRole('button',{name:'다음 달',exact:true});
      await next.click(); await next.click();
      await expect(frame.getByText(palette[0].label,{exact:true})).toBeVisible();
    };
    const cell = frame.locator('.sdm-day[data-date="'+palette[0].day+'"]');
    const number = cell.locator('.sdm-number'), event = cell.locator('.sdm-event').first();
    const detailTitle = page.locator('#day-panel-title'), detailInput = page.locator('#event-title');
    await visitMonth();
    const baseEvent = await event.evaluate(font), baseNumber = await number.evaluate(font);
    await cell.click();
    const baseDetail = await detailTitle.evaluate(font), baseDetailInput = await detailInput.evaluate(font);
    await page.locator('#day-panel-close').click();
    await page.locator('[data-simple-page=day]').click();
    const add = frame.getByRole('button',{name:'오늘 할 일 추가'}), input = frame.locator('.entry-form input');
    await add.click();
    await input.fill('크기 검수'); await input.press('Enter');
    const task = frame.getByText('크기 검수',{exact:true});
    const baseTask = await task.evaluate(font);
    await add.click(); await input.fill('작성 중인 문장');
    const baseInput = await input.evaluate(font);
    const draftNode = await input.elementHandle();
    await input.evaluate(el => {
      el.setSelectionRange(1,3);
      el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'문'}));
    });
    await typeButton.click();
    await expect(family).toHaveValue(''); await expect(weight).toHaveValue(''); await expect(scale).toHaveValue('100');
    const defaultGuide = await guideFamilies(guide);
    const baseSample = await sample.evaluate(font);
    const familyTrigger = page.locator('#simple-type-family-trigger');
    const familyList = page.locator('#simple-type-family-listbox');
    await familyTrigger.focus(); await familyTrigger.press('ArrowDown');
    await expect(familyList).toBeVisible();
    await familyTrigger.press('Home'); await familyTrigger.press('ArrowDown'); await familyTrigger.press('Enter');
    await expect(family).toHaveValue('story');
    await familyTrigger.click();
    const storyFonts = await platformFonts(page,'#simple-type-family-listbox [data-value="story"]');
    const malgunFonts = await platformFonts(page,'#simple-type-family-listbox [data-value="malgun"]');
    assert.ok(storyFonts.some(item=>item.isCustomFont),'bundled story font must actually render');
    assert.notDeepEqual(storyFonts.map(item=>item.postScriptName),malgunFonts.map(item=>item.postScriptName),'font rows must use different actual fonts');
    const onlineFonts = await platformFonts(page,'#simple-type-family-listbox [data-value="Hi Melody"]');
    assert.ok(onlineFonts.some(item=>item.isCustomFont),'online catalog label must use bundled preview while network is blocked');
    assert.notDeepEqual(onlineFonts.map(item=>item.postScriptName),storyFonts.map(item=>item.postScriptName),'online label must render its own face');
    await familyTrigger.press('End'); await familyTrigger.press('Escape');
    await expect(familyList).toBeHidden(); await expect(family).toHaveValue('story');
    await familyTrigger.click(); await familyTrigger.press('Tab');
    await expect(familyList).toBeHidden();
    await weight.selectOption('700'); await scale.selectOption('200');
    assert.deepEqual(await guideFamilies(guide),defaultGuide,'font guide must remain readable independently of content');
    await expectReading(sample,baseSample);
    await familyTrigger.click();
    await expect(familyList.locator('[data-value="story"]')).toHaveAttribute('aria-selected','true');
    assert.ok(await familyList.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),'font list fits at 200%');
    await familyTrigger.press('Escape');
    await closeType.click();
    await expectReading(task,baseTask); await expectReading(input,baseInput);
    assert.deepEqual(await draftNode.evaluate(el=>[el.isConnected,el.value,el.selectionStart,el.selectionEnd]),[true,'작성 중인 문장',1,3]);
    await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'문'})));
    assert.deepEqual(await page.locator('.titlebar :is(button,select):visible').evaluateAll(items=>items.filter(el=>{
      const r=el.getBoundingClientRect(), center=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return r.x<0 || r.right>innerWidth+1 || !el.contains(center);
    }).map(el=>el.id||el.textContent)),[]);
    await visitMonth();
    await expect(cell.locator('.sdm-event')).toHaveCount(2);
    await expectReading(event,baseEvent); await expectReading(number,baseNumber);
    for (const design of ['mint','paper','blue','lavender','apricot','graphite']) {
      await page.locator('#simple-design').selectOption(design);
      await expect(frame.locator('html')).toHaveAttribute('data-simple-design',design);
      for (const item of palette) await expect(frame.getByText(item.label,{exact:true})).toHaveCSS('background-color',item.background);
    }
    await cell.click();
    await expectReading(detailTitle,baseDetail); await expectReading(detailInput,baseDetailInput);
    await page.locator('#day-panel-close').click();
    await page.reload();
    await typeButton.click();
    await expect(family).toHaveValue('story'); await expect(weight).toHaveValue('700'); await expect(scale).toHaveValue('200');
    assert.deepEqual(await guideFamilies(guide),defaultGuide,'font guide after restarting with a saved choice');
    await expectReading(sample,baseSample);
    await closeType.click();
    await page.getByRole('button',{name:'기본모드',exact:true}).click();
    await expect(typeButton).toBeHidden(); assert.deepEqual(await classic.evaluate(font),classicFont);
    await page.locator('#btn-settings').click();
    const classicPicker = page.locator('#theme-font');
    const classicGuide = page.locator('.theme-row:has(#theme-font) :is(label,select)');
    const classicGuideFamilies = await guideFamilies(classicGuide);
    const consolasValue = await classicPicker.locator('option').filter({hasText:/^Consolas$/}).getAttribute('value');
    await chooseFont(page,'theme-font',consolasValue);
    await expect(page.locator('#theme-font-preview')).toHaveCSS('font-family',/Consolas/);
    assert.deepEqual(await guideFamilies(classicGuide),classicGuideFamilies,'classic font guide');
    await page.locator('#settings-close').click();
    const widget=await context.newPage();
    await widget.addInitScript(()=>{ window.simpleWidget={
      onSimpleTasks(){},onHoverState(){},onDate(){},onSettings(){},
      getDate:async()=>null,readSimpleTasks:async()=>({scope:'test',rev:1,days:{},sync:'device',pendingCount:0,canEdit:true}),
      getSettings:async()=>({mode:'top',color:'auto',opacity:80,filter:'all',textColor:'auto',fontSize:19,fontWeight:400})
    }; });
    await widget.goto(origin+'/simple/widget.html');
    await expect(widget.locator('#widget')).toHaveCSS('font-size','19px');
    await expect(widget.locator('#widget')).toHaveCSS('font-weight','400');
    assert.doesNotMatch((await widget.locator('#widget').evaluate(font)).family,/Yeobaek Story/);
    console.log('PASS custom font lists, actual bundled/system glyph fonts, keyboard/cancel/Tab, reading controls, draft node/selection, 200% day/month/detail, 11 event fills across 6 themes, persistence and classic/widget isolation');
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
