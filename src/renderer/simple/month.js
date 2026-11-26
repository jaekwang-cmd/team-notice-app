(() => {
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const pad = number => String(number).padStart(2, '0');
  const monthKey = date => date.getFullYear() + '-' + pad(date.getMonth() + 1);
  const dayKey = date => monthKey(date) + '-' + pad(date.getDate());
  let currentGrid;
  let pickedDate;
  let openedControl;
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

  function openCell(cell, control) {
    pickedDate = cell.dataset.date;
    openedControl = control.dataset.eventId || control.className;
    currentGrid.panel.querySelector('.sdm-selected')?.classList.remove('sdm-selected');
    cell.classList.add('sdm-selected');
    post({ type: 'simple-calendar-open', date: pickedDate, eventId: control.dataset.eventId,
      list: control.classList.contains('sdm-more') });
  }

  function findControl(cell, key) {
    return [...cell.querySelectorAll('button')].find(control => (control.dataset.eventId || control.className) === key);
  }

  function dayCell(date, state, displayMonth) {
    const key = dayKey(date);
    const label = date.getMonth() + 1 + '월 ' + date.getDate() + '일 ' + weekdays[date.getDay()] + '요일';
    const cell = element('div', 'sdm-day');
    cell.setAttribute('role', 'group');
    cell.classList.toggle('sdm-outside', date.getMonth() !== displayMonth);
    cell.dataset.date = key;
    cell.classList.toggle('sdm-selected', key === (pickedDate || state.selected));
    cell.classList.toggle('sdm-sunday', date.getDay() === 0);
    cell.classList.toggle('sdm-saturday', date.getDay() === 6);
    if (key === state.today) cell.setAttribute('aria-current', 'date');
    cell.dataset.summary = label + (key === state.today ? ', 오늘' : '');
    cell.setAttribute('aria-label', cell.dataset.summary);
    const add = element('button', 'sdm-add');
    add.type = 'button';
    add.setAttribute('aria-label', cell.dataset.summary + ', 일정 추가');
    add.addEventListener('click', () => openCell(cell, add));

    const dateLine = element('span', 'sdm-date-line');
    dateLine.append(element('span', 'sdm-number', date.getDate()), element('span', 'sdm-holiday-name'));
    cell.append(add, dateLine, element('span', 'sdm-events'));
    return cell;
  }

  function paintEvents(calendarDays, holidays, statusText, retryAvailable) {
    const status = currentGrid.panel.querySelector('.sdm-status');
    status.querySelector('span').textContent = statusText || '';
    status.querySelector('button').hidden = !retryAvailable;
    status.hidden = !statusText;
    for (const cell of currentGrid.panel.querySelectorAll('.sdm-day')) {
      const items = calendarDays[cell.dataset.date] || [];
      const holiday = holidays[cell.dataset.date] || '';
      cell.classList.toggle('sdm-holiday', Boolean(holiday));
      cell.querySelector('.sdm-holiday-name').textContent = holiday;
      const list = cell.querySelector('.sdm-events');
      const active = document.activeElement;
      const restore = document.hasFocus() && list.contains(active) ? active.dataset.eventId || active.className : null;
      list.replaceChildren();
      const label = [cell.dataset.summary, holiday, '일정 ' + items.length + '건'].filter(Boolean).join(', ');
      cell.setAttribute('aria-label', label);
      cell.querySelector('.sdm-add').setAttribute('aria-label', label + ', 일정 추가');
      cell.title = [holiday, ...items.map(e => e.label)].filter(Boolean).join('\n');
      for (const item of items.slice(0, 2)) {
        const entry = element('button', 'sdm-event', item.label);
        entry.type = 'button';
        entry.dataset.eventId = item.id;
        entry.setAttribute('aria-label', item.label + (item.editable ? ' 일정 수정' : ' 일정 보기'));
        entry.addEventListener('click', () => openCell(cell, entry));
        if (item.color) entry.style.backgroundColor = item.color;
        entry.title = item.label;
        list.append(entry);
      }
      if (items.length > 2) {
        const more = element('button', 'sdm-more', '+' + (items.length - 2) + '건');
        more.type = 'button';
        more.setAttribute('aria-label', cell.dataset.summary + ', 전체 일정 ' + items.length + '건 보기');
        more.addEventListener('click', () => openCell(cell, more));
        list.append(more);
      }
      if (restore) (findControl(cell, restore) || cell.querySelector('.sdm-add')).focus({ preventScroll: true });
    }
  }

  window.addEventListener('message', ({ source, data }) => {
    if (source !== parent || !currentGrid?.panel.isConnected) return;
    if (data?.type === 'simple-calendar-events' && data.first === currentGrid.first && data.limit === currentGrid.limit) {
      paintEvents(data.days, data.holidays || {}, data.statusText, data.retryAvailable);
    }
    if (data?.type === 'simple-calendar-closed') {
      const cell = currentGrid.panel.querySelector('.sdm-selected');
      if (cell) (findControl(cell, openedControl) || cell.querySelector('.sdm-add')).focus({ preventScroll: true });
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
      const weekColor = index === 0 ? ' sdm-sunday' : index === 6 ? ' sdm-saturday' : '';
      calendar.append(element('span', 'sdm-weekday' + weekColor, name));
    }
    for (let index = 0; index < slots; index++) {
      calendar.append(dayCell(new Date(year, month, index + 1 - first.getDay(), 12), state, month));
    }

    panel.append(toolbar, calendar);
    host.replaceChildren(panel);
    const start = new Date(year, month, 1 - first.getDay(), 12);
    const limit = new Date(year, month, 1 - first.getDay() + slots, 12);
    currentGrid = { panel, first: dayKey(start), limit: dayKey(limit) };
    post({ type: 'simple-calendar-range', first: currentGrid.first, limit: currentGrid.limit });
  };
})();
