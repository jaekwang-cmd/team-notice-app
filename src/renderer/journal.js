// Presentation layer: reuse existing calendar, memo and navigation actions.
// Authentication, Firebase collections and settlement calculations stay in their original modules.
(() => {
  let selected = new Date();
  let started = false;
  let selecting = false;
  let quickBusy = false;
  let noteBusy = false;
  let lastTimelineKey = '';
  let lastTasksKey = '';
  const el = id => document.getElementById(id);
  const iconPaths = {
    journal: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2"/>',
    memo: '<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M14 3v7h7M14 3l7 7M7 14h9m-9 3h6"/>',
    ai: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3z"/>',
    chulgo: '<path d="M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V3z"/>',
    reminder: '<circle cx="10" cy="8" r="4"/><path d="M3 21v-2a7 7 0 0 1 11-5m3 1v6m-3-3h6"/>',
    compare: '<path d="M3 3v18h18M7 17v-4m5 4V7m5 10v-7"/>',
    finance: '<circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-3-3 3-3m-6 0 3-3"/>',
    org: '<rect x="8" y="3" width="8" height="5" rx="1"/><path d="M12 8v5M5 16v-3h14v3"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/>',
  };
  function decorateIcons() {
    document.querySelectorAll('.sidebar-nav-btn').forEach(button => {
      const target = button.querySelector('.sidebar-nav-icon');
      if (target && iconPaths[button.dataset.view]) target.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconPaths[button.dataset.view] + '</svg>';
    });
  }
  async function loadTheme() {
    const theme = await window.api.getTheme();
    // Only opt this developer profile into the new palette once. Keep its previous palette recoverable.
    if (await window.api.getIsDev() && localStorage.getItem('journal_wood_theme_v1') !== 'applied') {
      localStorage.setItem('journal_previous_theme_v1', JSON.stringify(theme));
      const wood = { ...THEME_PRESETS.wood, mode: 'wood', cardStyle: 'matte', bold: false };
      await window.api.setTheme(wood);
      localStorage.setItem('journal_wood_theme_v1', 'applied');
      return wood;
    }
    return theme;
  }
  function dayEvents(date) {
    const key = toDateStr(date);
    const singles = eventsByDate.get(key) || [];
    const spanning = multiDayEvents.filter(event => {
      const start = String(event.start).slice(0, 10), end = String(event.end).slice(0, 10);
      return start <= key && key < end;
    });
    return [...singles, ...spanning].sort((a, b) => Number(b.allDay) - Number(a.allDay) || String(a.start).localeCompare(String(b.start)));
  }
  function hasDayEvents(date) {
    const key = toDateStr(date);
    return Boolean(eventsByDate.get(key)?.length) || multiDayEvents.some(event =>
      String(event.start).slice(0, 10) <= key && key < String(event.end).slice(0, 10));
  }
  async function chooseDate(date) {
    if (selecting) return;
    selecting = true;
    const previous = selected;
    const previousYear = viewYear, previousMonth = viewMonth;
    selected = date;
    try {
      if (viewYear !== date.getFullYear() || viewMonth !== date.getMonth()) {
        viewYear = date.getFullYear(); viewMonth = date.getMonth();
        renderCalendar().then(render).catch(() => showToast('일정을 불러오지 못했어요. 입력은 계속할 수 있어요.'));
      }
      render();
    } catch (error) {
      selected = previous; viewYear = previousYear; viewMonth = previousMonth;
      showToast('일정을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally { selecting = false; syncEntryControls(); }
  }
  async function openCalendar(add = false) {
    await switchView('calendar');
    if (viewYear !== selected.getFullYear() || viewMonth !== selected.getMonth()) {
      viewYear = selected.getFullYear(); viewMonth = selected.getMonth();
      await renderCalendar();
    }
    openDayPanel(toDateStr(selected));
    if (calendarRow.classList.contains('calendar-only')) dayPanel.classList.add('floating');
    if (add && isGoogleSignedIn) showEventForm(null);
  }
  function render() {
    const panel = el('journal-panel');
    if (!panel) return;
    el('journal-user-name').textContent = currentUser.displayName || '나의 업무 공간';
    el('journal-user-status').textContent = isGoogleSignedIn ? 'Google 계정 연결됨' : 'Google 로그인 필요';
    // switchView renders again when this page opens; keep hidden DOM and any drafts intact.
    if (panel.classList.contains('hidden')) return;
    const date = new Date(selected);
    el('journal-day-number').textContent = String(date.getDate()).padStart(2, '0');
    el('journal-date-title').textContent = `${date.getMonth() + 1}월 ${date.getDate()}일, ${['일','월','화','수','목','금','토'][date.getDay()]}요일`;
    el('journal-month-stamp').textContent = date.toLocaleString('en-US', { month: 'long' }).toUpperCase() + ', ' + date.getFullYear();
    const addButton = el('journal-add-event');
    addButton.disabled = !isGoogleSignedIn || quickBusy;
    addButton.title = isGoogleSignedIn ? '선택한 날짜에 일정 추가' : '화면 위의 Google 로그인으로 계정을 연결하세요';
    syncEntryControls();
    const monday = new Date(date); monday.setDate(date.getDate() - (date.getDay() + 6) % 7);
    const week = el('journal-week');
    const weekKey = toDateStr(monday);
    const rebuildWeek = week.dataset.start !== weekKey;
    if (rebuildWeek) week.replaceChildren();
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      let button = week.children[i];
      if (rebuildWeek) {
        button = document.createElement('button'); button.type = 'button';
        button.setAttribute('aria-label', `${d.getMonth() + 1}월 ${d.getDate()}일`);
        const label = document.createElement('span'); label.textContent = ['월','화','수','목','금','토','일'][i];
        const number = document.createElement('strong'); number.textContent = d.getDate();
        button.append(label, number, document.createElement('i'));
        button.onclick = () => chooseDate(d); week.append(button);
      }
      button.setAttribute('aria-pressed', String(toDateStr(d) === toDateStr(date)));
      button.lastElementChild.className = hasDayEvents(d) ? 'has-events' : '';
    }
    week.dataset.start = weekKey;
    const events = dayEvents(date);
    const timelineKey = JSON.stringify([toDateStr(date), isGoogleSignedIn,
      events.map(event => [event.id, event.title, event.start, event.end, event.allDay, event.teamEventId])]);
    if (timelineKey !== lastTimelineKey) {
      renderTimeline(events);
      lastTimelineKey = timelineKey;
    }
    const tasks = memos.filter(memo => !memo.done);
    el('journal-task-count').textContent = tasks.length + '개의 미완료 메모';
    const visibleTasks = tasks.slice(0, 5);
    const tasksKey = JSON.stringify([toDateStr(new Date()), isGoogleSignedIn,
      visibleTasks.map(memo => [memo.id, memo.text, memo.due, memo.alarmTime, memo.done])]);
    if (tasksKey !== lastTasksKey) {
      const taskList = el('journal-task-list'); taskList.replaceChildren();
      visibleTasks.forEach(memo => taskList.append(memoBuildRow(memo)));
      if (!tasks.length) { const p = document.createElement('p'); p.className = 'journal-muted'; p.textContent = '챙길 일이 생기면 메모로 남겨보세요.'; taskList.append(p); }
      lastTasksKey = tasksKey;
    }
  }
  function renderTimeline(events) {
    const list = el('journal-timeline'); list.replaceChildren();
    el('journal-event-count').textContent = isGoogleSignedIn ? events.length + '개의 약속' : '로그인 필요';
    if (!isGoogleSignedIn || !events.length) {
      const empty = document.createElement('div'); empty.className = 'journal-empty';
      const heading = document.createElement('h3'); heading.textContent = isGoogleSignedIn ? '아직 비어 있는 페이지.' : '나의 다이어리를 연결하세요.';
      const description = document.createElement('p'); description.textContent = isGoogleSignedIn ? '새로운 약속이나 기억할 일을 적어보세요.' : '화면 위의 Google 로그인으로 기존 계정을 연결하면 일정이 표시돼요.';
      empty.append(heading, description); list.append(empty);
    }
    events.forEach(event => {
      const row = document.createElement('div'); row.className = 'journal-event-row';
      const time = document.createElement('span'); time.className = 'journal-event-time';
      time.textContent = event.allDay ? '종일' : new Date(event.start).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
      const card = document.createElement('button'); card.type = 'button'; card.className = 'journal-event-card';
      const title = document.createElement('strong'); title.textContent = event.title || '(제목 없음)';
      const detail = document.createElement('span'); detail.textContent = (event.teamEventId ? '팀 공유 · ' : '') + formatEventTime(event);
      card.append(title, detail); card.onclick = () => openCalendar().catch(() => showToast('일정 화면을 열지 못했습니다.'));
      row.append(time, card); list.append(row);
    });
  }
  function syncEntryControls() {
    const disabled = !isGoogleSignedIn;
    ['journal-quick-title', 'journal-quick-time', 'journal-detailed-event'].forEach(id => el(id).disabled = disabled || selecting);
    el('journal-quick-submit').disabled = disabled || quickBusy || selecting;
    el('journal-quick-submit').textContent = quickBusy ? '저장 중' : '추가';
    el('journal-quick-date').textContent = `${selected.getMonth() + 1}월 ${selected.getDate()}일`;
    el('journal-note-draft').disabled = disabled || noteBusy;
    el('journal-transfer-note').disabled = disabled || noteBusy;
    el('journal-transfer-note').textContent = noteBusy ? '저장 중…' : '메모 저장 ↗';
  }
  function entryStatus(id, text, error = false) {
    const target = el(id); target.textContent = text; target.classList.toggle('is-error', error);
  }
  async function submitQuickEntry(event) {
    event.preventDefault();
    if (quickBusy || selecting || !isGoogleSignedIn) return;
    let payload;
    try { payload = JournalEntry.buildPayload({ title: el('journal-quick-title').value, date: toDateStr(selected), time: el('journal-quick-time').value }); }
    catch (error) { entryStatus('journal-quick-status', error.message, true); return; }
    quickBusy = true; syncEntryControls();
    const submittedTitle = el('journal-quick-title').value;
    const submittedTime = el('journal-quick-time').value;
    const submittedDate = toDateStr(selected);
    entryStatus('journal-quick-status', '일정과 메모를 기록하고 있어요.');
    try {
      const result = await JournalEntry.create(window.api, payload);
      if (result.status === 'event-error') {
        entryStatus('journal-quick-status', '일정 저장 결과를 확인하지 못했어요. 월간 다이어리를 확인한 뒤 다시 시도해주세요.', true);
        return;
      }
      if (toDateStr(selected) === submittedDate && el('journal-quick-title').value === submittedTitle && el('journal-quick-time').value === submittedTime) el('journal-quick-title').value = '';
      if (result.status === 'memo-error') {
        entryStatus('journal-quick-status', '일정은 저장했어요. 메모 저장은 확인하지 못했으니 메모장을 확인해주세요.', true);
      } else {
        entryStatus('journal-quick-status', '일정과 메모장에 함께 기록했어요.');
      }
      // Refresh errors must never cause the successfully saved entry to be submitted again.
      refreshEventsAndDayPanel().then(render).catch(() => showToast('일정은 저장됐어요. 최신 목록은 새로고침해주세요.'));
    } finally {
      quickBusy = false; syncEntryControls();
      const active = document.activeElement;
      if (active === el('journal-quick-submit')) el('journal-quick-title').focus({preventScroll:true});
    }
  }
  async function saveQuickNote() {
    const text = el('journal-note-draft').value.trim();
    if (!text || noteBusy || !isGoogleSignedIn) return;
    noteBusy = true; syncEntryControls(); entryStatus('journal-note-status', '메모를 저장하고 있어요.');
    try {
      await window.api.createMemo({ text, dueDate: toDateStr(selected) });
      el('journal-note-draft').value = '';
      entryStatus('journal-note-status', '메모장에 저장했어요.');
    } catch (_) {
      entryStatus('journal-note-status', '저장 결과를 확인하지 못했어요. 입력 내용은 남겨두었으니 메모장을 확인해주세요.', true);
    } finally { noteBusy = false; syncEntryControls(); }
  }
  function start() {
    if (started) return; started = true;
    decorateIcons();
    const safely = action => () => Promise.resolve().then(action).catch(() => showToast('화면을 열지 못했습니다. 다시 시도해주세요.'));
    el('journal-prev-week').onclick = () => { const d = new Date(selected); d.setDate(d.getDate() - 7); chooseDate(d); };
    el('journal-next-week').onclick = () => { const d = new Date(selected); d.setDate(d.getDate() + 7); chooseDate(d); };
    el('journal-today').onclick = () => chooseDate(new Date());
    el('journal-add-event').onclick = () => { el('journal-quick-form').scrollIntoView({ block: 'nearest' }); el('journal-quick-title').focus(); };
    el('journal-detailed-event').onclick = safely(() => openCalendar(true));
    el('journal-quick-form').addEventListener('submit', submitQuickEntry);
    el('journal-quick-time').addEventListener('input', () => { el('journal-quick-duration').textContent = el('journal-quick-time').value ? '1시간 일정' : '시간을 비우면 종일'; });
    document.querySelectorAll('[data-journal-go]').forEach(button => button.onclick = safely(() => button.dataset.journalGo === 'calendar' ? openCalendar() : switchView(button.dataset.journalGo)));
    el('journal-transfer-note').onclick = saveQuickNote;
    // Existing subscriptions already update these nodes. Observe them; do not add network subscriptions.
    const observer = new MutationObserver(debounce(render, 80));
    [calendarGrid, memoListWrap, googleStatus].forEach(node => observer.observe(node, { childList: true, subtree: true, characterData: true }));
    render();
  }
  window.journalUI = { loadTheme, render, start };
})();
