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
  const listFor = (key, kind) => kind === 'notice' ? taskStore.noticesFor(key) : taskStore.tasksFor(key);
  const panelId = (key, kind) => kind === 'notice' ? 'notice-' + key : key;
  const noun = kind => kind === 'notice' ? '공지' : '할 일';
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
  function reportFailure() { notice('변경을 저장하지 못했어요. 다시 시도해 주세요.'); }
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
    const block = element('div', 'day-heading');
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
    block.append(title, top);
    const week = element('nav', 'week');
    week.setAttribute('aria-label', '이번 주 날짜 선택');
    const weekStart = shifted(selected, -current.getDay());
    for (let n = 0; n < 7; n++) {
      const key = shifted(weekStart, n);
      const d = date(key);
      const b = button(taskStore.tasksFor(key).length ? 'has-tasks' : '', '', () => showDate(key), fullDate(d));
      b.setAttribute('aria-pressed', String(key === selected));
      b.append(element('span', 'weekday', dayNames[d.getDay()]), element('strong', '', d.getDate()));
      week.append(b);
    }
    header.append(block, week);
    return header;
  }
  function finishDraft(id) {
    drafts.delete(id);
    if (view !== 'day') return;
    if (pendingRollover && followsToday && !hasVisibleDraft()) {
      showDate(today);
    } else {
      const input = document.getElementById('entry-' + id);
      const form = input?.closest('form');
      const returnFocus = form?.contains(document.activeElement);
      form?.remove();
      if (returnFocus) document.getElementById('add-' + id)?.focus({preventScroll:true});
    }
  }
  function entryForm(key, kind) {
    const id = panelId(key, kind);
    const draft = drafts.get(id);
    const form = element('form', 'entry-form');
    const input = element('input');
    input.id = 'entry-' + id;
    input.setAttribute('aria-label', fullDate(date(key)) + ' 새 ' + noun(kind));
    input.placeholder = kind === 'notice' ? '공지 내용을 입력하세요' : '할 일을 입력하세요';
    input.required = true;
    input.maxLength = 2000;
    const scope = taskStore.status().scope;
    input.value = draft.title;
    let composing = false;
    let composingEnter = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener('input', () => { input.setCustomValidity(''); draft.title = input.value; });
    input.addEventListener('keydown', e => {
      if (composing || e.isComposing || e.keyCode === 229) {
        // Let the IME commit the syllable. Ignore only an implicit form submit during this keypress.
        if (e.key === 'Enter') {
          composingEnter = true;
          setTimeout(() => { composingEnter = false; }, 0);
        }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); finishDraft(id); }
    });
    const markerHost = element('div', 'entry-marker');
    let marker;
    marker = window.simpleMarkers.attach(input, markerHost, {
      initial:draft.highlights, pendingColor:draft.pendingColor,
      onChange: ranges => {
        draft.highlights = ranges;
        draft.pendingColor = marker?.pendingColor();
      }
    });
    const submit = element('button', '', '저장');
    submit.type = 'submit';
    submit.disabled = draft.saving || !taskStore.status().canEdit;
    form.append(input, markerHost, submit, button('', '취소', () => finishDraft(id)));
    form.onsubmit = async e => {
      e.preventDefault();
      if (composing || composingEnter) return;
      const title = input.value.trim();
      if (!title) { input.setCustomValidity(input.placeholder); input.reportValidity(); return; }
      if (draft.saving || !taskStore.status().canEdit || scope !== taskStore.status().scope) return;
      const textAtSubmit = input.value;
      draft.highlights = marker.read();
      const marksAtSubmit = JSON.stringify(draft.highlights);
      draft.saving = true;
      submit.disabled = true;
      try {
        await taskStore.add(key, title, {kind, highlights:marker.readTrimmed()});
        if (scope !== taskStore.status().scope || drafts.get(id) !== draft) return;
        if (draft.title === textAtSubmit && JSON.stringify(draft.highlights) === marksAtSubmit) finishDraft(id);
      } catch { if (scope === taskStore.status().scope) reportFailure(); }
      finally {
        draft.saving = false;
        if (drafts.get(id) === draft) {
          const currentSubmit = document.getElementById('entry-' + id)?.form.querySelector('[type=submit]');
          if (currentSubmit) currentSubmit.disabled = !taskStore.status().canEdit;
        }
      }
    };
    return form;
  }
  function taskRow(key, kind, task) {
    const {scope,canEdit} = taskStore.status();
    const row = element('div', 'task-row');
    const label = element('label');
    const check = element('input');
    check.type = 'checkbox';
    check.id = 'task-' + task.id;
    check.checked = task.done;
    check.disabled = !canEdit;
    check.onchange = () => { taskStore.setDone(key, task.id, check.checked).catch(reportFailure); };
    const title = element('span', 'task-title');
    window.simpleMarkers.render(title, task.title, task.highlights || []);
    label.append(check, title);
    const edit = button('edit-mark', '수정', () => {
      window.simpleMarkers.edit(edit, task, async (title,highlights) => {
        if (scope !== taskStore.status().scope || !taskStore.status().canEdit) return;
        await taskStore.edit(key, task, title, highlights);
      });
    }, task.title + ' 수정');
    edit.id = 'edit-' + task.id;
    edit.disabled = !canEdit;
    const del = button('remove', '', () => {
      const list = listFor(key, kind);
      const index = list.findIndex(t => t.id === task.id);
      if (index < 0) return;
      taskStore.remove(key, task.id).then(() => {
        if (scope !== taskStore.status().scope || view !== 'day') return;
        notice(kind === 'notice' ? '공지를 삭제했어요.' : '할 일을 삭제했어요.', () => {
          if (scope === taskStore.status().scope) taskStore.restore(key, task, index).catch(reportFailure);
        });
      }).catch(reportFailure);
      document.getElementById('add-' + panelId(key, kind))?.focus({preventScroll:true});
    }, task.title + ' 삭제');
    del.title = '삭제';
    del.disabled = !canEdit;
    del.append(element('i', 'trash'));
    row.append(label, edit, del);
    return row;
  }
  function dayLabel(key, kind) {
    let name = shortDate(date(key));
    if (key === today) name = '오늘';
    else if (key === shifted(today, 1)) name = '내일';
    else if (key === shifted(today, -1)) name = '어제';
    return name + ' ' + noun(kind);
  }
  function panel(key, kind) {
    const id = panelId(key, kind);
    const section = element('section', 'task-panel');
    section.dataset.kind = kind;
    section.dataset.date = key;
    if (key !== selected) section.classList.add(kind === 'task' ? 'secondary' : 'next-notices');
    const head = element('div', 'panel-head');
    const info = element('div');
    const heading = element('h2', '', dayLabel(key, kind));
    heading.id = 'heading-' + id;
    section.setAttribute('aria-labelledby', heading.id);
    info.append(heading, element('span', 'panel-date'));
    const add = button('add', '추가', () => {
      if (!drafts.has(id)) drafts.set(id, {title:'',highlights:[],saving:false});
      if (!section.querySelector('form')) {
        section.querySelector('.task-body').prepend(entryForm(key, kind));
      }
      document.getElementById('entry-' + id)?.focus();
    }, dayLabel(key, kind) + ' 추가');
    add.id = 'add-' + id;
    head.append(info, add);
    const body = element('div', 'task-body');
    if (drafts.has(id)) body.append(entryForm(key, kind));
    section.append(head, body);
    refreshPanel(section);
    return section;
  }
  function refreshPanel(section) {
    const {date:key, kind} = section.dataset;
    const id = panelId(key, kind);
    const list = listFor(key, kind);
    const isNotice = kind === 'notice';
    const mainRows = isNotice ? list : list.filter(t => !t.done);
    const done = isNotice ? [] : list.filter(t => t.done);
    const prefix = isNotice ? '공지 ' + list.length : '남은 일 ' + mainRows.length;
    section.querySelector('.panel-date').textContent = fullDate(date(key)) + ' · ' + prefix + '건';
    const {canEdit} = taskStore.status();
    section.querySelector('.add').disabled = !canEdit;
    const submit = section.querySelector('form [type=submit]');
    if (submit) submit.disabled = !canEdit || drafts.get(id)?.saving;
    // Keep each live form in place, including its selection, open palette and IME composition.
    const body = section.querySelector('.task-body');
    for (const child of [...body.children]) if (child.tagName !== 'FORM') child.remove();
    for (const task of mainRows) body.append(taskRow(key, kind, task));
    if (!list.length) {
      body.append(element('p','empty',isNotice ? '등록한 공지가 없어요.' : '등록한 할 일이 없어요.'));
    } else if (!mainRows.length) body.append(element('p','empty','이날 할 일을 모두 마쳤어요.'));
    section.querySelector('.completed')?.remove();
    if (done.length) {
      const details = element('details', 'completed');
      details.open = !collapsed.has(id);
      details.ontoggle = () => {
        if (!details.isConnected) return;
        if (details.open) collapsed.delete(id); else collapsed.add(id);
      };
      const summary = element('summary', '', '완료 ' + done.length + '건');
      summary.id = 'done-' + id;
      details.append(summary, ...done.map(t => taskRow(key, kind, t)));
      section.append(details);
    }
  }
  function render() {
    for (const b of document.querySelectorAll('[data-view]')) {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    if (view === 'month') {
      main.replaceChildren();
      window.renderSimpleMonth(main, {selected, today, month,
        onMonth: key => { month = key; render(); }});
    } else {
      const grid = element('div', 'boards');
      const next = shifted(selected, 1);
      grid.append(panel(selected, 'task'), panel(next, 'task'), panel(selected, 'notice'), panel(next, 'notice'));
      main.replaceChildren(dateHeader(), grid);
    }
  }
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    if (view === b.dataset.view) return;
    view = b.dataset.view;
    if (view === 'month') {
      month = selected.slice(0, 7);
      document.getElementById('notice').hidden = true;
    }
    render();
  });
  function hasVisibleDraft() {
    return [selected, shifted(selected,1)].some(key => drafts.has(key) || drafts.has(panelId(key,'notice')));
  }
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
    if (view !== 'day') return;
    const oldHeader = main.querySelector('.day-intro');
    if (!oldHeader) { render(); return; }
    const active = document.activeElement;
    oldHeader.replaceWith(dateHeader());
    main.querySelectorAll('.task-panel').forEach(refreshPanel);
    if (active.id && !active.isConnected) {
      const target = document.getElementById(active.id);
      const collapsedGroup = target?.closest('details:not([open])');
      (collapsedGroup ? collapsedGroup.querySelector('summary') : target)?.focus({preventScroll:true});
    }
  }
  taskStore.subscribe(source => {
    if (source === 'scope') {
      window.simpleMarkers.closeEditor();
      drafts.clear(); collapsed.clear();
      clearTimeout(toastTimer);
      document.getElementById('notice').hidden = true;
      document.getElementById('undo').onclick = null;
      if (view === 'day') render();
    } else if (source === 'local' || source === 'external') refreshTaskRows();
  });
  taskStore.ready.then(() => { render(); scheduleMidnight(); }).catch(reportFailure);
})();
