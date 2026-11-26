(() => {
  'use strict';
  const api = window.api;
  const frame = document.getElementById('simple-pane');
  const modeButtons = document.querySelectorAll('#mode-switch button');
  const google = document.getElementById('simple-google-button');
  const widget = document.getElementById('open-daily-widget');
  const detail = document.createElement('dialog');
  detail.id = 'simple-calendar-detail';
  detail.setAttribute('aria-labelledby', 'day-panel-title');
  const originalPosition = document.createComment('달력 날짜 상세');
  dayPanel.before(originalPosition);
  document.body.append(detail);
  const close = document.getElementById('day-panel-close');
  close.setAttribute('aria-label','날짜 상세 닫기');
  const send = data => frame.contentWindow?.postMessage(data, '*');
  const modeKey = 'yeobaek.desktop.mode.v1';
  const designKey = 'yeobaek.desktop.simpleDesign.v1';
  const design = document.getElementById('simple-design');
  try {
    const saved = localStorage.getItem(designKey);
    if ([...design.options].some(option => option.value === saved)) design.value = saved;
  } catch {}
  function applyDesign() {
    document.body.dataset.simpleDesign = design.value;
    send({type:'simple-design', value:design.value});
  }
  design.addEventListener('change', () => {
    try { localStorage.setItem(designKey, design.value); } catch {}
    applyDesign();
  });
  let selectedPage = 'day';
  let range;
  let holidayNames = {};
  let holidayRange;
  let cachedEvents = [];
  let status = '';
  let failed = false;
  let account = null;
  function validDay(key) {
    return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && toDateStr(new Date(key + 'T12:00:00')) === key;
  }
  function activeMonth() {
    return document.body.hasAttribute('data-simple-mode') && selectedPage === 'month' && !document.hidden;
  }
  function timed(value) { return new Date(value.length === 10 ? value + 'T00:00:00' : value).getTime(); }
  function onDay(key) {
    if (!validDay(key)) return [];
    const from = timed(key), until = timed(addDaysStr(key,1));
    return cachedEvents.filter(ev => {
      const start = timed(ev.start);
      return start < until && Math.max(start + 1, timed(ev.end)) > from;
    }).sort((a,b) => Number(b.allDay) - Number(a.allDay) || timed(a.start) - timed(b.start));
  }
  function paint() {
    if (!range || !activeMonth()) return;
    const days = {};
    for (let key = range.first; key < range.limit; key = addDaysStr(key,1)) {
      const events = onDay(key);
      if (events.length) days[key] = events.map(ev => {
        const start = new Date(ev.start);
        const time = !ev.allDay && toDateStr(start) === key ? start.toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit',hourCycle:'h23'}) + ' ' : '';
        return {id:calendarEventKey(ev), editable:canManageCalendarEvent(ev),
          label:time + ev.title, color:EVENT_COLOR_BY_ID.get(String(ev.colorId))?.hex};
      });
    }
    send({type:'simple-calendar-events', ...range, days, holidays:holidayNames, statusText:status, retryAvailable:failed});
    if (detail.open && selectedDateStr && isGoogleSignedIn) renderDayEventList();
  }
  async function loadMonthHolidays(requested) {
    if (holidayRange === requested) return;
    holidayRange = requested;
    const firstYear = Number(requested.first.slice(0,4));
    const lastYear = Number(addDaysStr(requested.limit,-1).slice(0,4));
    try {
      const years = firstYear === lastYear ? [firstYear] : [firstYear,lastYear];
      const entries = (await Promise.all(years.map(getHolidays))).flat();
      if (range !== requested) return;
      const names = {};
      for (const {date,name} of entries) {
        if (date >= requested.first && date < requested.limit) names[date] = names[date] ? names[date] + ' · ' + name : name;
      }
      holidayNames = names;
      if (detail.open && selectedDateStr) setDayPanelTitle(selectedDateStr, names[selectedDateStr]);
      paint();
    } catch {
      if (range === requested) holidayRange = null; // Retry on the next calendar refresh.
    }
  }
  function alignMonth() {
    if (!range || !activeMonth()) return;
    loadMonthHolidays(range);
    const middle = new Date(addDaysStr(range.first,14) + 'T12:00:00');
    viewYear = middle.getFullYear();
    viewMonth = middle.getMonth();
    if (!isGoogleSignedIn) { status = 'Google을 연결하면 일정을 볼 수 있어요.'; failed = false; paint(); return; }
    status = '일정 불러오는 중';
    failed = false;
    paint();
    renderCalendar().catch(() => { status = '일정을 불러오지 못했어요.'; failed = true; paint(); });
  }
  function receivedEvents(gridStart, events) {
    if (!range || toDateStr(gridStart) !== range.first || !activeMonth()) return;
    failed = !events;
    if (events) cachedEvents = events;
    status = failed ? '일정을 불러오지 못했어요.' : '';
    paint();
  }
  function closeDetail() {
    if (detail.open) close.click();
  }
  close.addEventListener('click', () => { if (detail.open) detail.close(); });
  detail.addEventListener('cancel', e => { e.preventDefault(); close.click(); });
  detail.addEventListener('close', () => { originalPosition.after(dayPanel); if (activeMonth()) send({type:'simple-calendar-closed'}); });
  const nav = [];
  let previous = document.querySelector('#app-sidebar .journal-brand');
  for (const [view,label,icon] of [['day','금일 할 일','☑'], ['month','월간 다이어리','▦']]) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = label; b.className = 'sidebar-nav-btn simple-nav';
    b.setAttribute('aria-label', label);
    b.dataset.simplePage = view;
    const glyph = document.createElement('span');
    glyph.setAttribute('aria-hidden','true'); glyph.className = 'sidebar-nav-icon'; glyph.textContent = icon;
    const name = document.createElement('span');
    name.className = 'sidebar-nav-label'; name.textContent = label;
    b.append(glyph,name);
    b.setAttribute('aria-pressed', String(view === selectedPage));
    b.onclick = () => send({type:'select-simple-page',view});
    previous.after(b); previous = b; nav.push(b);
  }
  function setMode(simple) {
    document.body.toggleAttribute('data-simple-mode', simple);
    if (simple && !frame.hasAttribute('src')) frame.src = 'simple/index.html';
    if (simple) applyDesign();
    else delete document.body.dataset.simpleDesign;
    if (!simple) closeDetail();
    if (simple && selectedPage === 'month') alignMonth();
    for (const b of modeButtons) b.setAttribute('aria-pressed', String((b.dataset.mode === 'simple') === simple));
  }
  for (const b of modeButtons) b.onclick = () => {
    const simple = b.dataset.mode === 'simple';
    try { localStorage.setItem(modeKey, simple ? 'simple' : 'classic'); } catch {}
    setMode(simple);
  };
  widget.onclick = async () => {
    try {
      const state = await api.openSimpleWidget();
      if (state?.mode === 'desktop') showToast('바탕화면에서 할 일 위젯을 볼 수 있어요.');
    } catch { showToast('할 일 위젯을 열지 못했어요.'); }
  };
  const accountMenu = document.createElement('div');
  accountMenu.id = 'simple-account-menu';
  accountMenu.popover = 'auto';
  const accountName = document.createElement('p');
  const accountSignOut = document.createElement('button');
  accountSignOut.textContent = '로그아웃';
  accountSignOut.onclick = () => { accountMenu.hidePopover(); googleStatus.querySelector('button')?.click(); };
  accountMenu.append(accountName, accountSignOut);
  document.body.append(accountMenu);
  function authChanged() {
    const next = isGoogleSignedIn ? currentUser?.uid || currentUser?.email || 'google' : null;
    if (next !== account) {
      if (detail.open) document.querySelector('.calendar-confirm[open]')?.dispatchEvent(new Event('cancel',{cancelable:true}));
      closeDetail();
      accountMenu.hidePopover();
      cachedEvents = [];
      account = next;
      alignMonth();
    }
    google.disabled = googleSignInPending;
    google.textContent = googleSignInPending ? '연결 중…' : isGoogleSignedIn ? 'Google 연결됨' : 'Google 연결';
    google.title = googleSignInError || (isGoogleSignedIn ? currentUser?.email || '연결 계정' : 'Google 로그인');
    google.toggleAttribute('data-connected', isGoogleSignedIn);
    accountName.textContent = currentUser?.email || currentUser?.displayName || '연결된 Google 계정';
    if (!next) paint();
  }
  google.onclick = async () => {
    if (!isGoogleSignedIn) { await signInWithGoogle(); if (googleSignInError) showToast(googleSignInError); return; }
    const rect = google.getBoundingClientRect();
    accountMenu.style.top = (rect.bottom + 4) + 'px';
    accountMenu.style.right = (innerWidth - rect.right) + 'px';
    accountMenu.togglePopover();
  };
  api.onSimpleTasks?.(value => { send({type:'diary-task-state',value}); });
  window.addEventListener('message', async event => {
    if (event.source !== frame.contentWindow || !event.data ||
        (event.origin !== location.origin && !(location.protocol === 'file:' && event.origin === 'null'))) return;
    const data = event.data;
    if (data.type === 'diary-task-request' && typeof data.token === 'string' && ['read','change'].includes(data.action)) {
      try {
        const value = data.action === 'read' ? await api.readSimpleTasks() : await api.mutateSimpleTask(data.value);
        send({type:'diary-task-reply', token:data.token, value});
      } catch { send({type:'diary-task-reply', token:data.token, error:'할 일을 저장하거나 불러오지 못했어요.'}); }
    }
    if (data.type === 'simple-page' && ['day','month'].includes(data.view)) {
      selectedPage = data.view;
      if (document.body.hasAttribute('data-simple-mode')) applyDesign();
      for (const b of nav) b.setAttribute('aria-pressed', String(b.dataset.simplePage === selectedPage));
    }
    if (data.type === 'simple-calendar-range' && validDay(data.first) && validDay(data.limit) &&
        data.limit > data.first && data.limit <= addDaysStr(data.first,42)) {
      selectedPage = 'month';
      if (range?.first === data.first && range.limit === data.limit) { paint(); return; }
      range = {first:data.first,limit:data.limit}; cachedEvents = []; holidayNames = {};
      alignMonth();
    }
    if (data.type === 'simple-calendar-retry' && activeMonth()) alignMonth();
    if (data.type === 'simple-calendar-open' && activeMonth() && validDay(data.date) && range && data.date >= range.first && data.date < range.limit) {
      if (detail.open) return;
      detail.append(dayPanel);
      detail.showModal();
      openDayPanel(data.date, holidayNames[data.date] || '');
      if (!isGoogleSignedIn) return;
      if (data.eventId !== undefined) {
        const ev = onDay(data.date).find(item => calendarEventKey(item) === data.eventId);
        if (!ev) { showToast('일정이 변경됐어요. 날짜 목록을 확인해 주세요.'); return; }
        if (canManageCalendarEvent(ev)) showEventForm(ev);
        else [...dayEventList.children].find(item => item.dataset.eventKey === data.eventId)?.focus();
      } else if (!data.list) showEventForm(null);
    }
  });
  window.simpleMode = {receivedEvents, authChanged, onDay, detail};
  window.addEventListener('focus', () => { if (activeMonth()) alignMonth(); });
  document.addEventListener('visibilitychange', () => { if (activeMonth()) alignMonth(); });
  setInterval(() => { if (activeMonth()) alignMonth(); },60000);
  let initial = false;
  try { initial = localStorage.getItem(modeKey) === 'simple'; } catch {}
  setMode(initial);
  authChanged();
})();
