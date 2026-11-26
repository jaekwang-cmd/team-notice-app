(() => {
  'use strict';
  const native = window.simpleWidget;
  const tasks = window.simpleTasks;
  const el = id => document.getElementById(id);
  const list = el('task-list');
  const input = el('task-input');
  const form = el('add-form');
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const dateFmt = new Intl.DateTimeFormat('ko-KR', { month:'long', day:'numeric', weekday:'short' });
  const drafts = new Map();
  let settings = { mode:'top', color:'auto', opacity:100, filter:'all', textColor:'auto', fontSize:16, fontWeight:500 };
  let today = localKey(new Date());
  let selected = today;
  let followsToday = true;
  let afterMidnight = false;
  let composing = false;
  let committingWithEnter = false;
  let tasksReady = false;
  let toastTimer;
  let midnightTimer;
  const marker = window.simpleMarkers.attach(input,el('marker-controls'));
  function currentDraft() {
    return {value:input.value,highlights:marker.read(),pendingColor:marker.pendingColor()};
  }
  function loadDraft(draft) {
    input.value = draft?.value || '';
    marker.reset(draft?.highlights,draft?.pendingColor);
  }
  function localKey(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  }
  function shifted(key, offset) {
    const date = new Date(key + 'T12:00:00');
    date.setDate(date.getDate() + offset);
    return localKey(date);
  }
  function notify(message, undo) {
    clearTimeout(toastTimer);
    el('toast-text').textContent = message;
    el('undo').hidden = !undo;
    el('undo').onclick = undo ? async () => {
      el('toast').hidden = true;
      try { await undo(); } catch { notify('할 일을 복구하지 못했어요.'); }
    } : null;
    el('toast').hidden = false;
    toastTimer = setTimeout(() => { el('toast').hidden = true; }, undo ? 8000 : 4200);
  }
  function renderPalette() {
    const dark = settings.color === '#272a2f' || (settings.color === 'auto' && systemDark.matches);
    const paper = settings.color === 'auto' ? (dark ? '#272a2f' : '#ffffff') : settings.color;
    const textColor = /^#[0-9a-f]{6}$/i.test(settings.textColor) ? settings.textColor : '';
    const root = document.documentElement;
    root.toggleAttribute('data-dark', dark);
    root.style.setProperty('--paper', paper);
    root.style.setProperty('--alpha', settings.opacity + '%');
    root.style.setProperty('--custom-text-color', textColor);
    root.style.setProperty('--type-size', (settings.fontSize ?? 16) + 'px');
    root.style.setProperty('--type-weight', settings.fontWeight ?? 500);
  }
  function applySettings(value) {
    if (!value) return;
    const filterChanged = settings.filter !== value.filter;
    settings = value;
    renderPalette();
    if (settings.mode !== 'through') document.querySelector('.hover-track').hidden = true;
    if (tasksReady && filterChanged) renderList();
  }
  function selectDate(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
    if (input.value || marker.pendingColor()) drafts.set(selected,currentDraft());
    else drafts.delete(selected);
    if (selected !== key) window.simpleMarkers.closeEditor();
    selected = key;
    followsToday = selected === today;
    afterMidnight = false;
    loadDraft(drafts.get(key));
    list.scrollTop = 0;
    renderList();
  }
  function refreshDay() {
    const current = localKey(new Date());
    if (current === today) return;
    today = current;
    if (followsToday && !input.value && !composing) selectDate(today);
    else {
      afterMidnight = followsToday;
      renderList();
    }
  }
  function midnight() {
    clearTimeout(midnightTimer);
    const now = new Date();
    const next = new Date(now);
    next.setHours(24,0,0,0);
    midnightTimer = setTimeout(() => { refreshDay(); midnight(); }, next - now);
  }
  function taskRow(task, key) {
    const row = document.createElement('div');
    row.className = 'task-row';
    const label = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.id = 'widget-task-' + task.id;
    check.checked = task.done;
    check.disabled = !tasks.status().canEdit;
    const title = document.createElement('span');
    title.className = 'task-title';
    window.simpleMarkers.render(title,task.title,task.highlights);
    label.append(check, title);
    check.onchange = async () => {
      try { await tasks.setDone(key, task.id, check.checked); }
      catch { renderList(); notify('완료 상태를 저장하지 못했어요.'); }
    };
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-button remove';
    del.title = '삭제';
    del.disabled = !tasks.status().canEdit;
    del.setAttribute('aria-label', task.title + ' 삭제');
    const icon = document.createElement('i');
    icon.className = 'cross';
    del.append(icon);
    del.onclick = async () => {
      const scope = tasks.status().scope;
      const index = tasks.tasksFor(key).findIndex(t => t.id === task.id);
      if (index < 0) return;
      try {
        await tasks.remove(key, task.id);
        if (tasks.status().scope !== scope) return;
        notify('할 일을 삭제했어요.', () => tasks.restore(key, task, index));
      } catch { notify('할 일을 삭제하지 못했어요.'); }
    };
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'icon-button marker-edit';
    edit.id = 'widget-marker-' + task.id;
    edit.textContent = '수정';
    edit.title = '할 일 수정';
    edit.setAttribute('aria-label',task.title + ' 수정');
    edit.disabled = !tasks.status().canEdit;
    edit.onclick = () => {
      const scope = tasks.status().scope;
      window.simpleMarkers.edit(edit,task,async (title,ranges) => {
        if (scope !== tasks.status().scope) return;
        await tasks.edit(key,task,title,ranges);
      });
    };
    row.append(label,edit,del);
    return row;
  }
  function renderList() {
    if (!tasksReady) return;
    const status = tasks.status();
    input.disabled = !status.canEdit;
    el('submit').disabled = !status.canEdit;
    el('marker-controls').querySelector('.marker-trigger').disabled = !status.canEdit;
    el('task-sync').textContent = ({
      connecting:'계정 연결 중', pending:'동기화 중', offline:status.pendingCount ? '오프라인 · 전송 대기' : '오프라인', error:'동기화 재시도 중'
    })[status.sync] || '';
    const data = tasks.tasksFor(selected);
    const pending = data.filter(t => !t.done);
    const done = data.filter(t => t.done);
    const focusId = list.contains(document.activeElement) ? document.activeElement.id : '';
    el('date-title').textContent = dateFmt.format(new Date(selected + 'T12:00:00'));
    el('today').hidden = selected === today;
    el('remaining').textContent = '남은 일 ' + pending.length + '건';
    const filterName = el('filter-name');
    filterName.hidden = settings.filter === 'all';
    filterName.textContent = settings.filter === 'done' ? '완료한 일만' : '남은 일만';
    const rows = document.createDocumentFragment();
    if (settings.filter !== 'done') {
      for (const task of pending) rows.append(taskRow(task, selected));
    }
    if (settings.filter !== 'pending' && done.length) {
      const head = document.createElement('h2');
      head.className = 'done-heading';
      head.textContent = '완료 ' + done.length + '건';
      rows.append(head, ...done.map(task => taskRow(task, selected)));
    }
    if (!rows.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = settings.filter === 'done' ? '완료한 일이 없어요.' : '남은 할 일이 없어요.';
      rows.append(empty);
    }
    list.replaceChildren(rows);
    if (focusId) (document.getElementById(focusId) || input).focus({preventScroll:true});
  }
  el('prev').onclick = () => selectDate(shifted(selected, -1));
  el('next').onclick = () => selectDate(shifted(selected, 1));
  el('today').onclick = () => selectDate(today);
  el('settings').onclick = () => native.openSettings().catch(() => notify('위젯 설정을 열지 못했어요.'));
  el('close').onclick = () => native.close();
  const updateDraft = () => {
    if (input.value) drafts.set(selected,currentDraft());
    else { drafts.delete(selected); if (afterMidnight && !composing) selectDate(today); }
  };
  input.addEventListener('input', updateDraft);
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; updateDraft(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229 || composing)) {
      // Native IME completion keeps its default action; suppress only an implicit form submit.
      committingWithEnter = true;
      setTimeout(() => { committingWithEnter = false; }, 0);
    }
  });
  form.onsubmit = async event => {
    event.preventDefault();
    const value = input.value;
    const title = value.trim();
    if (!tasksReady || !tasks.status().canEdit || composing || committingWithEnter || !title) return;
    const scope = tasks.status().scope;
    const key = selected;
    const draft = currentDraft();
    const highlights = marker.readTrimmed();
    loadDraft();
    drafts.delete(key);
    try {
      await tasks.add(key,title,{highlights});
      if (tasks.status().scope !== scope) return;
      if (selected === key && !input.value) {
        if (afterMidnight) selectDate(today);
        if (document.activeElement === el('submit')) input.focus();
      }
    } catch {
      if (tasks.status().scope !== scope) return;
      if (selected === key && !input.value && !marker.pendingColor()) loadDraft(draft);
      else if (selected !== key && !drafts.has(key)) drafts.set(key,draft);
      notify('할 일을 저장하지 못했어요.');
    }
  };
  const hover = document.querySelector('.hover-track');
  native.onHoverState(({phase, durationMs}) => {
    hover.hidden = phase === 'idle';
    hover.style.setProperty('--fill-time', durationMs + 'ms');
    hover.dataset.phase = phase;
  });
  for (const eventName of ['pointerenter','pointerleave']) {
    document.documentElement.addEventListener(eventName, event => {
      if (settings.mode === 'through' && event.pointerType === 'mouse') native.pointerBoundary(eventName === 'pointerenter');
    });
  }
  let receivedDate = false;
  let receivedSettings = false;
  native.onDate(key => { receivedDate = true; selectDate(key); });
  native.onSettings(value => { receivedSettings = true; applySettings(value); });
  native.getSettings().then(value => { if (!receivedSettings) applySettings(value); });
  native.getDate().then(key => { if (!receivedDate && key) selectDate(key); });
  systemDark.addEventListener('change', renderPalette);
  window.addEventListener('focus', () => { refreshDay(); midnight(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshDay(); midnight(); } });
  input.disabled = true;
  tasks.subscribe(source => {
    if (source === 'scope') {
      drafts.clear(); loadDraft(); composing = false;
      window.simpleMarkers.closeEditor();
      clearTimeout(toastTimer); el('toast').hidden = true; el('undo').onclick = null;
    }
    if (tasksReady) renderList();
  });
  tasks.ready.then(() => { tasksReady = true; renderList(); })
    .catch(() => notify('할 일 목록을 불러오지 못했어요.'));
  midnight();
})();
