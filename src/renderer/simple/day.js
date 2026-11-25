(() => {
  'use strict';
  const main = document.querySelector('#main');
  const taskStore = window.simpleTasks;
  const dayNames = ['일','월','화','수','목','금','토'];
  const pad = n => String(n).padStart(2, '0');
  const iso = d => [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-');
  const date = key => new Date(key + 'T12:00:00');
  function shifted(key, days) {
    const d = date(key);
    d.setDate(d.getDate() + days);
    return iso(d);
  }
  const todayKey = () => iso(new Date());
  const shortDate = d => (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  const fullDate = d => shortDate(d) + ' ' + dayNames[d.getDay()] + '요일';
  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function button(className, text, action, label) {
    const el = element('button', className, text);
    el.type = 'button';
    if (label) el.setAttribute('aria-label', label);
    el.addEventListener('click', action);
    return el;
  }
  let today = todayKey();
  let selected = today;
  let month = today.slice(0, 7);
  let view = 'day';
  let followsToday = true;
  let pendingRollover = false;
  const drafts = new Map();
  const collapsed = new Set();
  const tasksFor = taskStore.tasksFor;
  let toastTimer;
  function notice(text, undo) {
    clearTimeout(toastTimer);
    const toast = document.querySelector('#notice');
    document.querySelector('#message').textContent = text;
    const control = document.querySelector('#undo');
    control.hidden = !undo;
    control.onclick = undo ? () => { toast.hidden = true; undo(); } : null;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, undo ? 8000 : 4600);
  }
  function reportFailure() { notice('할 일 변경을 저장하지 못했어요. 다시 시도해 주세요.'); }
  function showDate(key) {
    selected = key;
    month = key.slice(0, 7);
    followsToday = key === today;
    pendingRollover = false;
    view = 'day';
    render();
  }
  function dateHeader() {
    const header = element('section', 'day-intro');
    const block = element('div');
    const current = date(selected);
    const top = element('div', 'year-controls');
    top.append(element('span', 'year', current.getFullYear() + '년'));
    const sync = taskStore.status();
    const syncLabel = {device:'이 기기에 저장', connecting:'계정 확인 중', pending:'동기화 대기', offline:'오프라인', error:'동기화 지연'}[sync.sync];
    if (syncLabel) top.append(element('span', 'task-sync', syncLabel + (sync.pendingCount ? ' · ' + sync.pendingCount + '건' : '')));
    const controls = element('div', 'date-buttons');
    function move(offset, label) {
      const b = button('', '', () => showDate(shifted(selected, offset)), label);
      b.append(element('i', 'arrow ' + (offset < 0 ? 'prev' : 'next')));
      return b;
    }
    controls.append(move(-1, '이전 날짜'), button('', '오늘', () => showDate(todayKey()), '오늘로 이동'), move(1, '다음 날짜'));
    top.append(controls);
    const title = element('h1', 'date-title', shortDate(current));
    title.append(element('span', '', dayNames[current.getDay()] + '요일'));
    block.append(top, title);
    const week = element('nav', 'week');
    week.setAttribute('aria-label', '이번 주 날짜 선택');
    const weekStart = shifted(selected, -current.getDay());
    for (let n = 0; n < 7; n++) {
      const key = shifted(weekStart, n);
      const d = date(key);
      const b = button(tasksFor(key).length ? 'has-tasks' : '', '', () => showDate(key), fullDate(d));
      b.setAttribute('aria-pressed', String(key === selected));
      b.append(element('span', 'weekday', dayNames[d.getDay()]), element('strong', '', d.getDate()));
      week.append(b);
    }
    header.append(block, week);
    return header;
  }
  function focusAdd(key) { document.getElementById('add-' + key)?.focus({preventScroll: true}); }
  function finishDraft(key) {
    drafts.delete(key);
    if (pendingRollover && followsToday && !hasVisibleDraft()) {
      showDate(today);
    } else { render(); focusAdd(key); }
  }
  function entryForm(key) {
    const form = element('form', 'entry-form');
    const input = element('input');
    input.id = 'entry-' + key;
    input.setAttribute('aria-label', fullDate(date(key)) + ' 새 할 일');
    input.placeholder = '할 일을 입력하세요';
    input.required = true;
    input.maxLength = 2000;
    const scope = taskStore.status().scope;
    input.value = drafts.get(key) || '';
    input.addEventListener('input', () => { input.setCustomValidity(''); drafts.set(key, input.value); });
    input.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { e.preventDefault(); finishDraft(key); }
    });
    const submit = element('button', '', '저장');
    submit.type = 'submit';
    form.append(input, submit, button('', '취소', () => finishDraft(key)));
    form.onsubmit = async e => {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) { input.setCustomValidity('할 일을 입력해 주세요.'); input.reportValidity(); return; }
      if (submit.disabled || !taskStore.status().canEdit || scope !== taskStore.status().scope) return;
      submit.disabled = true;
      try {
        await taskStore.add(key, title);
        if (scope !== taskStore.status().scope) return;
        if (input.value.trim() === title) finishDraft(key);
        else refreshTaskRows();
      } catch { if (scope === taskStore.status().scope) reportFailure(); }
      finally { submit.disabled = false; }
    };
    return form;
  }
  function taskRow(key, task) {
    const {scope,canEdit} = taskStore.status();
    const row = element('div', 'task-row');
    const label = element('label');
    const check = element('input');
    check.type = 'checkbox';
    check.id = 'task-' + task.id;
    check.checked = task.done;
    check.disabled = !canEdit;
    check.onchange = () => {
      const completed = check.checked;
      taskStore.setDone(key, task.id, completed).catch(reportFailure);
      const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 145;
      setTimeout(() => {
        if (!row.isConnected || completed !== check.checked) return;
        // Rebuild only this panel so an entry field on the other date keeps focus.
        const old = row.closest('.task-panel');
        const active = document.activeElement;
        const restore = active === check;
        const sameForm = old.contains(active) && active.matches('.entry-form input');
        const selection = sameForm ? [active.selectionStart, active.selectionEnd] : null;
        old.replaceWith(panel(key, key !== selected));
        if (restore) {
          const fresh = document.getElementById(check.id);
          if (fresh?.closest('details:not([open])')) document.getElementById('done-' + key)?.focus({preventScroll:true});
          else fresh?.focus({preventScroll:true});
        } else if (sameForm) {
          const entry = document.getElementById('entry-' + key);
          entry?.focus({preventScroll:true});
          entry?.setSelectionRange(...selection);
        }
      }, delay);
    };
    label.append(check, element('span', 'task-title', task.title));
    const del = button('remove', '', () => {
      const list = tasksFor(key);
      const index = list.findIndex(t => t.id === task.id);
      if (index < 0) return;
      taskStore.remove(key, task.id).catch(reportFailure);
      render(); focusAdd(key);
      notice('할 일을 삭제했어요.', () => {
        if (scope !== taskStore.status().scope) return;
        taskStore.restore(key, task, index).catch(reportFailure);
        render();
      });
    }, task.title + ' 삭제');
    del.title = '삭제';
    del.disabled = !canEdit;
    del.append(element('i', 'trash'));
    row.append(label, del);
    return row;
  }
  function dayLabel(key) {
    if (key === today) return '오늘 할 일';
    if (key === shifted(today, 1)) return '내일 할 일';
    if (key === shifted(today, -1)) return '어제 할 일';
    return (date(key).getMonth() + 1) + '월 ' + date(key).getDate() + '일 할 일';
  }
  function panel(key, secondary) {
    const section = element('section', 'task-panel' + (secondary ? ' secondary' : ''));
    const head = element('div', 'panel-head');
    const info = element('div');
    const heading = element('h2', '', dayLabel(key));
    heading.id = 'heading-' + key;
    section.setAttribute('aria-labelledby', heading.id);
    const list = tasksFor(key);
    const open = list.filter(t => !t.done);
    const done = list.filter(t => t.done);
    info.append(heading, element('span', 'panel-date', fullDate(date(key)) + ' · 남은 일 ' + open.length + '건'));
    const add = button('add', '추가', () => {
      if (!drafts.has(key)) drafts.set(key, '');
      if (!section.querySelector('form')) {
        section.querySelector('.task-body').prepend(entryForm(key));
      }
      document.getElementById('entry-' + key)?.focus();
    }, dayLabel(key) + ' 추가');
    add.id = 'add-' + key;
    add.disabled = !taskStore.status().canEdit;
    head.append(info, add);
    const body = element('div', 'task-body');
    if (drafts.has(key)) body.append(entryForm(key));
    if (open.length) for (const task of open) body.append(taskRow(key, task));
    else body.append(element('p', 'empty', done.length ? '이날 할 일을 모두 마쳤어요.' : '등록한 할 일이 없어요.'));
    section.append(head, body);
    if (done.length) {
      const details = element('details', 'completed');
      details.open = !collapsed.has(key);
      details.ontoggle = () => {
        if (!details.isConnected) return;
        if (details.open) collapsed.delete(key); else collapsed.add(key);
      };
      const summary = element('summary', '', '완료 ' + done.length + '건');
      summary.id = 'done-' + key;
      details.append(summary, ...done.map(t => taskRow(key, t)));
      section.append(details);
    }
    return section;
  }
  function render() {
    for (const b of document.querySelectorAll('[data-view]')) {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    if (view === 'month') {
      main.replaceChildren();
      window.renderSimpleMonth(main, {selected, today, month, tasksFor,
        onMonth: key => { month = key; render(); }, onDate: showDate});
    } else {
      const grid = element('div', 'boards');
      grid.append(panel(selected, false), panel(shifted(selected, 1), true));
      main.replaceChildren(dateHeader(), grid);
    }
  }
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    if (view === b.dataset.view) return;
    view = b.dataset.view;
    if (view === 'month') month = selected.slice(0, 7);
    render();
  });
  function hasVisibleDraft() { return drafts.has(selected) || drafts.has(shifted(selected, 1)); }
  function refreshDate() {
    const now = todayKey();
    if (now === today) return;
    const old = today;
    today = now;
    if (followsToday) {
      if (view === 'day' && hasVisibleDraft()) { pendingRollover = true; return; }
      selected = today;
      if (view === 'day' || month === old.slice(0, 7)) month = today.slice(0, 7);
    }
    if (view === 'day' && hasVisibleDraft()) return;
    render();
  }
  function scheduleMidnight() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    setTimeout(() => { refreshDate(); scheduleMidnight(); }, next - now);
  }
  window.addEventListener('focus', refreshDate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDate(); });
  function refreshTaskRows() {
    if (view === 'month') { render(); return; }
    const oldHeader = main.querySelector('.day-intro');
    if (!oldHeader) { render(); return; }
    oldHeader.replaceWith(dateHeader());
    for (const [index, section] of [...main.querySelectorAll('.task-panel')].entries()) {
      const key = shifted(selected, index);
      const fresh = panel(key, index === 1);
      section.querySelector('.panel-date').textContent = fresh.querySelector('.panel-date').textContent;
      section.querySelector('.add').disabled = fresh.querySelector('.add').disabled;
      const submit = section.querySelector('form [type=submit]');
      if (submit && !taskStore.status().canEdit) submit.disabled = true;
      const body = section.querySelector('.task-body');
      // Keep the actual input attached, including its Korean IME composition and selection.
      for (const child of [...body.children]) if (child.tagName !== 'FORM') child.remove();
      for (const child of [...fresh.querySelector('.task-body').children]) if (child.tagName !== 'FORM') body.append(child);
      section.querySelector('.completed')?.remove();
      const completed = fresh.querySelector('.completed');
      if (completed) section.append(completed);
    }
  }
  taskStore.subscribe(source => {
    if (source === 'scope') {
      drafts.clear(); collapsed.clear();
      clearTimeout(toastTimer);
      document.getElementById('notice').hidden = true;
      document.getElementById('undo').onclick = null;
      render();
    } else if (source === 'external') refreshTaskRows();
  });
  taskStore.ready.then(() => { render(); scheduleMidnight(); }).catch(reportFailure);
})();
