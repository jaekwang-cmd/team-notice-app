const assert = require('node:assert/strict');
const {chromium, expect} = require('@playwright/test');
const {createPreviewServer} = require('../scripts/premium-preview.cjs');

(async () => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    await page.route('**/*',r => r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/?auth=signed-out');
    await page.getByRole('button',{name:'간편모드',exact:true}).click();
    const frame = page.frameLocator('#simple-pane');
    const board = name => frame.getByRole('region',{name,exact:true});
    const today = board('오늘 할 일'), tomorrow = board('내일 할 일');
    const notice = board('오늘 공지'), nextNotice = board('내일 공지');
    await expect(frame.locator('.boards > section')).toHaveCount(4);
    const [a,b,c,d,header] = await Promise.all([today,tomorrow,notice,nextNotice,frame.locator('.day-intro')].map(x=>x.boundingBox()));
    assert(a.y===b.y && c.y===d.y && a.x===c.x && b.x===d.x);
    assert(a.width > b.width*1.45 && a.height > c.height*1.9);
    assert(header.height<65);
    await today.getByRole('button',{name:'오늘 할 일 추가'}).click();
    const input = today.locator('form input');
    await input.fill('  계약서 확인  ');
    const nativeCompositionCanCommit = await input.evaluate(el=>{
      el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      const allowed = el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,isComposing:true}));
      el.form.requestSubmit();
      el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
      return allowed;
    });
    assert(nativeCompositionCanCommit);
    await expect(today.getByRole('checkbox')).toHaveCount(0);
    await input.evaluate(el=>el.setSelectionRange(2,5));
    await today.getByRole('button',{name:'형광펜 색 선택'}).click();
    await today.getByRole('button',{name:'노랑 형광펜'}).click();
    await notice.getByRole('button',{name:'오늘 공지 추가'}).click();
    const noticeInput = notice.locator('form input');
    await noticeInput.fill('개인 공지');
    await noticeInput.press('Enter');
    await expect(notice.getByRole('checkbox',{name:'개인 공지'})).toBeVisible();
    await expect(input).toHaveValue('  계약서 확인  ');
    await input.press('Enter');
    const mark = today.locator('.task-title mark');
    await expect(mark).toHaveText('계약서');
    await expect(mark).toHaveAttribute('data-color','yellow');
    const editButton=today.getByRole('button',{name:'계약서 확인 수정'});
    await page.mouse.move(0,0);
    assert.deepEqual(await editButton.evaluate(el=>{
      const box=el.getBoundingClientRect();
      return [getComputedStyle(el).opacity,el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2))];
    }),['1',true]);
    await today.getByRole('button',{name:'계약서 확인 수정'}).click();
    const editor = frame.getByRole('dialog',{name:'할 일 수정'});
    await editor.getByRole('textbox').evaluate(el=>el.setSelectionRange(4,6));
    await editor.getByRole('button',{name:'형광펜 색 선택'}).click();
    await editor.getByRole('button',{name:'민트 형광펜'}).click();
    await editor.getByRole('button',{name:'저장'}).click();
    await expect(today.locator('mark[data-color=mint]')).toHaveText('확인');
    await today.locator('.task-title mark').first().click();
    await expect(today.getByRole('checkbox',{name:'계약서 확인'})).toBeChecked();
    await expect(today.locator('.completed .task-title')).toHaveText(['계약서 확인']);
    const checkboxId = await today.getByRole('checkbox',{name:'계약서 확인'}).getAttribute('id');
    const editTask = today.getByRole('button',{name:'계약서 확인 수정'});
    await editTask.click();
    await editor.getByRole('textbox').fill('취소할 변경');
    await editor.getByRole('button',{name:'취소'}).click();
    await expect(today.getByRole('checkbox',{name:'계약서 확인'})).toBeChecked();
    await editTask.click();
    const titleField = editor.getByRole('textbox');
    await titleField.press('End');
    await titleField.pressSequentially(' (1)');
    await titleField.press('Enter');
    await expect(today.locator('.completed .task-title')).toHaveText(['계약서 확인 (1)']);
    await expect(today.getByRole('checkbox',{name:'계약서 확인 (1)'})).toHaveAttribute('id',checkboxId);
    await expect(today.getByRole('checkbox',{name:'계약서 확인 (1)'})).toBeChecked();
    await expect(today.locator('mark[data-color=yellow]')).toHaveText('계약서');
    await expect(today.locator('mark[data-color=mint]')).toHaveText('확인');
    await nextNotice.getByRole('button',{name:'내일 공지 추가'}).click();
    await nextNotice.locator('form input').fill('내일 확인');
    await nextNotice.locator('form input').press('Enter');
    const notices = [
      {panel:notice, heading:'오늘 공지', titles:['개인 공지','오늘 중간','오늘 마지막']},
      {panel:nextNotice, heading:'내일 공지', titles:['내일 확인','내일 중간','내일 마지막']}
    ];
    for (const {panel, heading, titles} of notices) {
      for (const title of titles.slice(1)) {
        await panel.getByRole('button',{name:heading+' 추가'}).click();
        const field = panel.getByRole('textbox');
        await field.fill(title);
        await field.press('Enter');
        await expect(field).toHaveCount(0);
      }
      await panel.getByRole('checkbox',{name:titles[1]}).check();
      const noticeId = await panel.getByRole('checkbox',{name:titles[1]}).getAttribute('id');
      await panel.getByRole('button',{name:titles[1]+' 수정'}).click();
      const editNotice=frame.getByRole('dialog',{name:'공지 수정'});
      await editNotice.getByRole('textbox').fill('  ');
      await editNotice.getByRole('button',{name:'저장'}).click();
      await expect(editNotice.getByRole('alert')).toHaveText('내용을 입력해 주세요.');
      titles[1]+=' 변경';
      await editNotice.getByRole('textbox').fill(titles[1]);
      await editNotice.getByRole('button',{name:'저장'}).click();
      await expect(panel.getByRole('checkbox',{name:titles[1]})).toHaveAttribute('id',noticeId);
      await expect(panel.getByRole('checkbox',{name:titles[1]})).toBeChecked();
      await expect(panel.locator('.task-body .task-title')).toHaveText(titles);
      await expect(panel.locator('.panel-date')).toContainText('공지 3건');
      await expect(panel.locator('.completed')).toHaveCount(0);
    }
    await frame.getByRole('button',{name:'다음 날짜',exact:true}).click();
    await expect(board('내일 공지').getByRole('checkbox',{name:'내일 확인'})).toBeVisible();
    await expect(frame.getByRole('checkbox',{name:'개인 공지'})).toHaveCount(0);
    await expect(frame.locator('.week button[aria-pressed=true]')).not.toHaveClass(/has-tasks/);
    await frame.getByRole('button',{name:'오늘로 이동'}).click();
    for (const {panel, titles} of notices) {
      const middle = panel.getByRole('checkbox',{name:titles[1]});
      await expect(middle).toBeChecked();
      await expect(panel.locator('.task-body .task-title')).toHaveText(titles);
      await middle.uncheck();
      await expect(middle).not.toBeChecked();
      await expect(panel.locator('.task-body .task-title')).toHaveText(titles);
    }
    await notice.getByRole('button',{name:'개인 공지 삭제'}).click();
    await expect(notice.getByRole('checkbox',{name:'개인 공지'})).toHaveCount(0);
    await frame.getByRole('button',{name:'되돌리기'}).click();
    await expect(notice.getByRole('checkbox',{name:'개인 공지'})).toBeVisible();
    await expect(today.getByRole('checkbox',{name:'개인 공지'})).toHaveCount(0);
    await page.locator('[data-simple-page=month]').click();
    await expect(frame.locator('.sdm-month')).toBeVisible();
    assert.doesNotMatch(await frame.locator('.sdm-month').evaluate(el=>el.outerHTML),/개인 공지|내일 확인|계약서 확인/);
    const widget=await browser.newPage({viewport:{width:375,height:360}});
    await widget.route('**/*',r => r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
    widget.on('pageerror',error=>errors.push(error.message));
    await widget.addInitScript(()=>{
      const day='2026-11-25';
      let state={scope:'fixture',rev:1,days:{[day]:[{id:'done',title:'검수 완료',done:true},{id:'notice',title:'개인 공지',kind:'notice',done:false}]},sync:'device',pendingCount:0,canEdit:true};
      let listener;
      function apply(op) {
        state={...state,rev:state.rev+1,days:window.simpleTaskData.change(state.days,op)};
        return state;
      }
      window.simpleWidget={
        onSimpleTasks(fn){listener=fn;},onHoverState(){},onDate(){},onSettings(){},
        getDate:async()=>day,getSettings:async()=>({mode:'top',filter:'all',color:'auto',opacity:100}),
        readSimpleTasks:async()=>state,mutateSimpleTask:async({op})=>apply(op)
      };
      window.remoteEdit=()=>listener(apply({kind:'edit',day,id:'done',title:'다른 창의 수정',highlights:[]}));
    });
    await widget.goto(origin+'/simple/widget.html');
    await expect(widget.getByRole('checkbox',{name:'개인 공지'})).toHaveCount(0);
    const widgetEdit=widget.getByRole('button',{name:'검수 완료 수정'});
    await expect(widgetEdit).toHaveCSS('opacity','1');
    await widgetEdit.click();
    const widgetEditor=widget.getByRole('dialog',{name:'할 일 수정'});
    await widgetEditor.getByRole('textbox').fill('위젯에서 수정');
    await widgetEditor.getByRole('textbox').press('Enter');
    await expect(widget.getByRole('checkbox',{name:'위젯에서 수정'})).toBeChecked();
    await widget.getByRole('button',{name:'위젯에서 수정 수정'}).click();
    await widgetEditor.getByRole('textbox').fill('충돌하는 수정');
    await widget.evaluate(()=>window.remoteEdit());
    await widgetEditor.getByRole('button',{name:'저장'}).click();
    await expect(widgetEditor.getByRole('alert')).toContainText('항목이 바뀌었어요.');
    await widgetEditor.getByRole('button',{name:'취소'}).click();
    await expect(widget.getByRole('checkbox',{name:'다른 창의 수정'})).toBeChecked();
    assert.deepEqual(errors,[]);
    console.log('PASS four boards and widget, visible edit target, title and highlight edits, cancel, required text, ID/order/check preservation, remote edit conflict, calendar privacy');
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
