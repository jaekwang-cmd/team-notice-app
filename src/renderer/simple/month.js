(() => {
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const pad = number => String(number).padStart(2, '0');
  const monthKey = date => date.getFullYear() + '-' + pad(date.getMonth() + 1);
  const dayKey = date => monthKey(date) + '-' + pad(date.getDate());
  let currentGrid;
  let pickedDate;
  const post = message => parent.postMessage(message, '*');

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function action(label, visible, activate) {
    const button = element('button', 'sdm-control', visible);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', activate);
    return button;
  }

  function countBadge(count, completed) {
    const badge = element('span', 'sdm-count' + (completed ? ' sdm-count-done' : ''), count);
    badge.title = (completed ? '완료 ' : '남은 일 ') + count + '건';
    return badge;
  }

  function dayButton(date, state, displayMonth) {
    const key = dayKey(date);
    const tasks = state.tasksFor(key);
    const undone = tasks.filter(task => !task.done);
    const done = tasks.filter(task => task.done);
    const label = date.getMonth() + 1 + '월 ' + date.getDate() + '일 ' + weekdays[date.getDay()] + '요일';
    const button = element('button', 'sdm-day');
    button.type = 'button';
    button.classList.toggle('sdm-outside', date.getMonth() !== displayMonth);
    button.dataset.date = key;
    button.classList.toggle('sdm-selected', key === (pickedDate || state.selected));
    button.classList.toggle('sdm-sunday', date.getDay() === 0);
    if (key === state.today) button.setAttribute('aria-current', 'date');
    button.dataset.summary = label + (key === state.today ? ', 오늘' : '') + ', 남은 일 ' + undone.length + '건, 완료 ' + done.length + '건';
    button.setAttribute('aria-label', button.dataset.summary + ', 일정 추가');
    button.addEventListener('click', () => {
      pickedDate = key;
      currentGrid.panel.querySelector('.sdm-selected')?.classList.remove('sdm-selected');
      button.classList.add('sdm-selected');
      post({ type: 'simple-calendar-open', date: key });
    });

    const top = element('span', 'sdm-day-top');
    top.append(element('span', 'sdm-number', date.getDate()));
    const counts = element('span', 'sdm-counts');
    if (undone.length) counts.append(countBadge(undone.length, false));
    if (done.length) counts.append(countBadge(done.length, true));
    top.append(counts);
    button.append(top);

    const list = element('span', 'sdm-lines');
    for (const task of undone.concat(done).slice(0, 2)) {
      const line = element('span', 'sdm-line' + (task.done ? ' sdm-line-done' : ''), task.title);
      line.title = task.title;
      list.append(line);
    }
    button.append(element('span', 'sdm-events'), list);
    return button;
  }

  function paintEvents(calendarDays, statusText, retryAvailable) {
    const status = currentGrid.panel.querySelector('.sdm-status');
    status.querySelector('span').textContent = statusText || '';
    status.querySelector('button').hidden = !retryAvailable;
    status.hidden = !statusText;
    for (const cell of currentGrid.panel.querySelectorAll('.sdm-day')) {
      const items = calendarDays[cell.dataset.date] || [];
      const list = cell.querySelector('.sdm-events');
      list.replaceChildren();
      cell.setAttribute('aria-label', cell.dataset.summary + ', 일정 ' + items.length + '건, 일정 추가');
      cell.title = items.map(e => e.label).join('\n');
      for (const item of items.slice(0, 2)) {
        const entry = element('span', 'sdm-event', item.label);
        if (item.color) entry.style.borderInlineStartColor = item.color;
        list.append(entry);
      }
      if (items.length > 2) list.append(element('span', 'sdm-more', '+' + (items.length - 2) + '건'));
    }
  }

  window.addEventListener('message', ({ source, data }) => {
    if (source !== parent || !currentGrid?.panel.isConnected) return;
    if (data?.type === 'simple-calendar-events' && data.first === currentGrid.first && data.limit === currentGrid.limit) {
      paintEvents(data.days, data.statusText, data.retryAvailable);
    }
    if (data?.type === 'simple-calendar-closed') {
      currentGrid.panel.querySelector('.sdm-selected')?.focus({ preventScroll: true });
    }
  });

  window.renderSimpleMonth = function renderSimpleMonth(host, state) {
    const [year, monthNumber] = state.month.split('-').map(Number);
    const month = monthNumber - 1;
    const first = new Date(year, month, 1, 12);
    const last = new Date(year, month + 1, 0, 12);
    const slots = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
    const panel = element('section', 'sdm-month');
    panel.setAttribute('aria-label', '월간 다이어리');

    const toolbar = element('div', 'sdm-toolbar');
    const title = element('h2', 'sdm-title', year + '년 ' + monthNumber + '월');
    const controls = element('div', 'sdm-controls');
    const moveMonth = offset => state.onMonth(monthKey(new Date(year, month + offset, 1, 12)));
    controls.append(
      action('이전 달', '‹', () => moveMonth(-1)),
      action('이번 달 보기', '이번 달', () => state.onMonth(state.today.slice(0, 7))),
      action('다음 달', '›', () => moveMonth(1))
    );
    const status = element('div', 'sdm-status');
    const message = element('span', '');
    message.setAttribute('role', 'status');
    const retry = action('일정 다시 불러오기', '다시 시도', () => post({ type: 'simple-calendar-retry' }));
    status.hidden = true;
    status.append(message, retry);
    toolbar.append(title, status, controls);

    const calendar = element('div', 'sdm-calendar');
    calendar.style.setProperty('--week-count', slots / 7);
    for (const [index, name] of weekdays.entries()) {
      calendar.append(element('span', 'sdm-weekday' + (index === 0 ? ' sdm-sunday' : ''), name));
    }
    for (let index = 0; index < slots; index++) {
      calendar.append(dayButton(new Date(year, month, index + 1 - first.getDay(), 12), state, month));
    }

    const legend = element('div', 'sdm-legend');
    legend.append(element('span', 'sdm-legend-pending', '남은 일'), element('span', 'sdm-legend-done', '완료'));
    panel.append(toolbar, calendar, legend);
    host.replaceChildren(panel);
    const start = new Date(year, month, 1 - first.getDay(), 12);
    const limit = new Date(year, month, 1 - first.getDay() + slots, 12);
    currentGrid = { panel, first: dayKey(start), limit: dayKey(limit) };
    post({ type: 'simple-calendar-range', first: currentGrid.first, limit: currentGrid.limit });
  };
})();
