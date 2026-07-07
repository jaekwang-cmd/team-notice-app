const calendarTitle = document.getElementById('calendar-title');
const calendarGrid = document.getElementById('calendar-grid');
const googleStatus = document.getElementById('google-status');
const noticeList = document.getElementById('notice-list');
const noticeText = document.getElementById('notice-text');
const noticeSend = document.getElementById('notice-send');
const configBanner = document.getElementById('config-banner');
const syncBtn = document.getElementById('sync-btn');

const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth(); // 0-indexed

const holidaysCache = new Map(); // year -> [{date, name}]
let eventsByDate = new Map(); // 'YYYY-MM-DD' -> [event, ...]
let isGoogleSignedIn = false;
let isConfigured = false;
let announcements = [];
let currentUser = { signedIn: false, uid: null, isAdmin: false };

function pad(n) {
  return String(n).padStart(2, '0');
}

function toDateStr(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return toDateStr(date);
}

function startOfGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  return new Date(year, month, 1 - firstDay.getDay());
}

async function getHolidays(year) {
  if (!holidaysCache.has(year)) {
    const holidays = await window.api.getHolidays(year);
    holidaysCache.set(year, holidays);
  }
  return holidaysCache.get(year);
}

async function loadGoogleEventsForGrid(gridStart) {
  if (!isGoogleSignedIn) {
    eventsByDate = new Map();
    return;
  }

  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 42);

  // Build into a local map and swap it in atomically at the end — if two calls
  // race (e.g. one from init() and one from the auth:updated push), reassigning
  // the shared `eventsByDate` mid-fetch used to make both calls' events land in
  // the same map, duplicating every entry.
  const map = new Map();
  try {
    const events = await window.api.googleGetEvents(gridStart.toISOString(), gridEnd.toISOString());
    events.forEach((ev) => {
      const d = ev.start.slice(0, 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(ev);
    });
    eventsByDate = map;
  } catch (err) {
    console.error('구글 캘린더 이벤트 로드 실패:', err);
    eventsByDate = map;
  }
}

let currentHolidayMap = new Map();
let currentGridStart = null;

const MAX_EVENT_LINES = 4;

function buildCalendarGrid() {
  const todayStr = toDateStr(today);
  calendarGrid.innerHTML = '';

  for (let i = 0; i < 42; i += 1) {
    const cellDate = new Date(currentGridStart);
    cellDate.setDate(currentGridStart.getDate() + i);
    const dateStr = toDateStr(cellDate);
    const dow = cellDate.getDay();

    const cell = document.createElement('div');
    cell.className = 'day-cell';
    if (cellDate.getMonth() !== viewMonth) cell.classList.add('other-month');
    if (dateStr === todayStr) cell.classList.add('today');
    if (dateStr === selectedDateStr) cell.classList.add('selected');
    if (dow === 0) cell.classList.add('sunday');
    if (dow === 6) cell.classList.add('saturday');
    if (currentHolidayMap.has(dateStr)) {
      cell.classList.add('holiday');
      cell.title = currentHolidayMap.get(dateStr);
    }

    const num = document.createElement('span');
    num.className = 'day-num';
    num.textContent = cellDate.getDate();
    cell.appendChild(num);

    const dayEvents = eventsByDate.get(dateStr) || [];
    if (dayEvents.length > 0) {
      cell.classList.add('has-events');
      dayEvents.slice(0, MAX_EVENT_LINES).forEach((ev) => {
        const line = document.createElement('span');
        line.className = 'event-line';
        line.textContent = ev.title;
        cell.appendChild(line);
      });
      if (dayEvents.length > MAX_EVENT_LINES) {
        const more = document.createElement('span');
        more.className = 'event-more';
        more.textContent = `+${dayEvents.length - MAX_EVENT_LINES}개`;
        cell.appendChild(more);
      }
    }

    cell.onclick = () => openDayPanel(dateStr);

    calendarGrid.appendChild(cell);
  }
}

async function renderCalendar() {
  calendarTitle.textContent = `${viewYear}년 ${viewMonth + 1}월`;

  const holidays = await getHolidays(viewYear);
  currentHolidayMap = new Map(holidays.map((h) => [h.date, h.name]));

  currentGridStart = startOfGrid(viewYear, viewMonth);
  await loadGoogleEventsForGrid(currentGridStart);

  buildCalendarGrid();
}

function updateNoticeInputState() {
  const enabled = isConfigured && isGoogleSignedIn;
  noticeText.disabled = !enabled;
  noticeSend.disabled = !enabled;
  noticeText.placeholder = enabled ? '공지를 입력하세요...' : '구글 로그인 후 공지를 작성할 수 있어요';
}

function renderGoogleStatus() {
  googleStatus.innerHTML = '';
  const label = document.createElement('span');

  if (isGoogleSignedIn) {
    label.textContent = '✅ 구글 계정으로 로그인됨';
    const btn = document.createElement('button');
    btn.textContent = '로그아웃';
    btn.onclick = async () => {
      await window.api.googleSignOut();
      isGoogleSignedIn = false;
      currentUser = { signedIn: false, uid: null, isAdmin: false };
      renderGoogleStatus();
      updateNoticeInputState();
      renderAnnouncements();
      renderCalendar();
    };
    googleStatus.appendChild(label);
    googleStatus.appendChild(btn);
  } else {
    label.textContent = '구글 로그인이 필요합니다 (캘린더 + 공지 작성)';
    const btn = document.createElement('button');
    btn.textContent = '로그인';
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '로그인 대기 중...';
      try {
        await window.api.googleSignIn();
        isGoogleSignedIn = true;
        currentUser = await window.api.getCurrentUser();
        renderGoogleStatus();
        updateNoticeInputState();
        renderAnnouncements();
        renderCalendar();
      } catch (err) {
        console.error('구글 로그인 실패:', err);
        btn.disabled = false;
        btn.textContent = '로그인';
      }
    };
    googleStatus.appendChild(label);
    googleStatus.appendChild(btn);
  }
}

function formatTimestamp(ms) {
  const d = new Date(ms);
  const sameDay = toDateStr(d) === toDateStr(new Date());
  const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderAnnouncements() {
  noticeList.innerHTML = '';

  if (announcements.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'notice-empty';
    empty.textContent = '아직 등록된 공지가 없습니다.';
    noticeList.appendChild(empty);
    return;
  }

  // announcements arrive newest-first from Firestore; show oldest-first (chat style)
  const ordered = [...announcements].reverse();
  ordered.forEach((a) => {
    const confirmedBy = a.confirmedBy || {};
    const confirmedNames = Object.values(confirmedBy);
    const iConfirmed = currentUser.signedIn && Boolean(confirmedBy[currentUser.uid]);

    const item = document.createElement('div');
    item.className = 'notice-item' + (iConfirmed ? ' confirmed' : '');

    const meta = document.createElement('div');
    meta.className = 'notice-meta';
    meta.innerHTML = `<span>${escapeHtml(a.author || '익명')}</span><span>${formatTimestamp(a.createdAt)}</span>`;

    const text = document.createElement('div');
    text.className = 'notice-text';
    text.textContent = a.text;

    item.appendChild(meta);
    item.appendChild(text);

    const isOwner = currentUser.signedIn && a.authorUid === currentUser.uid;
    const canManage = isOwner || currentUser.isAdmin;

    const actions = document.createElement('div');
    actions.className = 'notice-actions';

    if (canManage) {
      const editBtn = document.createElement('button');
      editBtn.textContent = '수정';
      editBtn.onclick = () => startEditAnnouncement(item, a);
      actions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.textContent = '삭제';
      delBtn.onclick = async () => {
        if (!confirm('이 공지를 삭제할까요?')) return;
        try {
          await window.api.deleteAnnouncement(a.id);
        } catch (err) {
          console.error('공지 삭제 실패:', err);
          alert('삭제에 실패했습니다.');
        }
      };
      actions.appendChild(delBtn);
    }

    if (currentUser.isAdmin) {
      const shoutBtn = document.createElement('button');
      shoutBtn.textContent = '📢 외치기';
      shoutBtn.onclick = async () => {
        if (!confirm('이 공지를 모든 팀원에게 다시 알림으로 보낼까요?')) return;
        try {
          await window.api.shoutAnnouncement(a.id);
        } catch (err) {
          console.error('외치기 실패:', err);
          alert('실패했습니다.');
        }
      };
      actions.appendChild(shoutBtn);
    }

    if (currentUser.signedIn) {
      const confirmLabel = document.createElement('label');
      confirmLabel.className = 'confirm-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = iConfirmed;
      checkbox.onchange = async () => {
        try {
          await window.api.setAnnouncementConfirmed(a.id, checkbox.checked);
        } catch (err) {
          console.error('확인 처리 실패:', err);
          checkbox.checked = !checkbox.checked;
        }
      };
      confirmLabel.appendChild(checkbox);
      confirmLabel.appendChild(document.createTextNode('확인함'));
      actions.appendChild(confirmLabel);
    }

    item.appendChild(actions);

    if (confirmedNames.length > 0) {
      const confirmedList = document.createElement('div');
      confirmedList.className = 'notice-confirmed-list';
      confirmedList.textContent = `확인: ${confirmedNames.map(escapeHtml).join(', ')}`;
      item.appendChild(confirmedList);
    }

    noticeList.appendChild(item);
  });

  noticeList.scrollTop = noticeList.scrollHeight;
}

function startEditAnnouncement(itemEl, announcement) {
  const existingRow = itemEl.querySelector('.notice-edit-row');
  if (existingRow) return;

  const row = document.createElement('div');
  row.className = 'notice-edit-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = announcement.text;
  input.maxLength = 500;

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '저장';
  saveBtn.onclick = async () => {
    const newText = input.value.trim();
    if (!newText) return;
    try {
      await window.api.editAnnouncement(announcement.id, newText);
      row.remove();
    } catch (err) {
      console.error('공지 수정 실패:', err);
      alert('수정에 실패했습니다.');
    }
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '취소';
  cancelBtn.onclick = () => row.remove();

  row.appendChild(input);
  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);
  itemEl.appendChild(row);
  input.focus();
}

async function sendAnnouncement() {
  const text = noticeText.value.trim();
  if (!text) return;

  noticeSend.disabled = true;
  try {
    await window.api.postAnnouncement(text);
    noticeText.value = '';
  } catch (err) {
    console.error('공지 등록 실패:', err);
    alert('공지 등록에 실패했습니다. 설정을 확인해주세요.');
  } finally {
    noticeSend.disabled = false;
    noticeText.focus();
  }
}

// --- Day panel (view/add/edit/delete Google Calendar events for one day) ---
const dayPanel = document.getElementById('day-panel');
const dayPanelTitle = document.getElementById('day-panel-title');
const dayEventList = document.getElementById('day-event-list');
const eventForm = document.getElementById('event-form');
const eventAddBtn = document.getElementById('event-add-btn');
const eventTitleInput = document.getElementById('event-title');
const eventAlldayCheckbox = document.getElementById('event-allday');
const eventTimeRow = document.getElementById('event-time-row');
const eventStartTime = document.getElementById('event-start-time');
const eventEndTime = document.getElementById('event-end-time');
const eventCancelBtn = document.getElementById('event-cancel');
const eventTeamShareRow = document.getElementById('event-team-share-row');
const eventTeamShareCheckbox = document.getElementById('event-team-share');

let selectedDateStr = null;
let editingEventId = null;
let editingTeamEventId = null;

function formatEventTime(ev) {
  if (ev.allDay) return '하루 종일';
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  const fmt = (d) => d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(start)} - ${fmt(end)}`;
}

function renderDayEventList() {
  dayEventList.innerHTML = '';
  const events = eventsByDate.get(selectedDateStr) || [];

  if (events.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'day-event-empty';
    empty.textContent = '이 날짜에 일정이 없습니다.';
    dayEventList.appendChild(empty);
    return;
  }

  events.forEach((ev) => {
    const item = document.createElement('div');
    item.className = 'day-event-item';

    const title = document.createElement('div');
    title.className = 'event-title';
    title.textContent = ev.title;

    const time = document.createElement('div');
    time.className = 'event-time';
    time.textContent = formatEventTime(ev);

    if (ev.teamEventId) {
      const badge = document.createElement('div');
      badge.className = 'event-team-badge';
      badge.textContent = '👥 팀 공유 일정';
      item.appendChild(badge);
    }

    const canManageEvent = ev.teamEventId ? currentUser.isAdmin : true;

    if (canManageEvent) {
      const actions = document.createElement('div');
      actions.className = 'event-actions';

      const editBtn = document.createElement('button');
      editBtn.textContent = '수정';
      editBtn.onclick = () => showEventForm(ev);

      const delBtn = document.createElement('button');
      delBtn.textContent = '삭제';
      delBtn.onclick = async () => {
        const msg = ev.teamEventId
          ? '이 팀 공유 일정을 삭제할까요? (모든 팀원 캘린더에서 삭제됩니다)'
          : '이 일정을 삭제할까요? (구글 캘린더에서도 삭제됩니다)';
        if (!confirm(msg)) return;
        try {
          if (ev.teamEventId) {
            await window.api.deleteTeamEvent(ev.teamEventId);
          } else {
            await window.api.googleDeleteEvent({ eventId: ev.id });
          }
          await refreshEventsAndDayPanel();
        } catch (err) {
          console.error('일정 삭제 실패:', err);
          alert('삭제에 실패했습니다.');
        }
      };

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      item.appendChild(title);
      item.appendChild(time);
      item.appendChild(actions);
    } else {
      item.appendChild(title);
      item.appendChild(time);
    }

    dayEventList.appendChild(item);
  });
}

function showEventForm(ev) {
  editingEventId = ev && !ev.teamEventId ? ev.id : null;
  editingTeamEventId = ev && ev.teamEventId ? ev.teamEventId : null;
  eventForm.classList.remove('hidden');
  eventAddBtn.classList.add('hidden');
  eventTeamShareCheckbox.checked = false;
  // Only offer "share as team event" when creating a brand-new event, not when editing.
  eventTeamShareRow.classList.toggle('hidden', !(currentUser.isAdmin && !ev));

  if (ev) {
    eventTitleInput.value = ev.title;
    eventAlldayCheckbox.checked = ev.allDay;
    if (!ev.allDay) {
      const start = new Date(ev.start);
      const end = new Date(ev.end);
      eventStartTime.value = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
      eventEndTime.value = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
    }
  } else {
    eventTitleInput.value = '';
    eventAlldayCheckbox.checked = true;
    eventStartTime.value = '09:00';
    eventEndTime.value = '10:00';
  }
  eventTimeRow.style.display = eventAlldayCheckbox.checked ? 'none' : 'flex';

  // Focusing right after un-hiding (display:none -> visible) can silently no-op
  // before the browser finishes layout — defer to the next frame so it reliably sticks.
  requestAnimationFrame(() => {
    eventTitleInput.focus();
    eventTitleInput.select();
  });
}

function hideEventForm() {
  eventForm.classList.add('hidden');
  eventAddBtn.classList.remove('hidden');
  editingEventId = null;
  editingTeamEventId = null;
}

eventAlldayCheckbox.addEventListener('change', () => {
  eventTimeRow.style.display = eventAlldayCheckbox.checked ? 'none' : 'flex';
});

eventAddBtn.onclick = () => showEventForm(null);
eventCancelBtn.onclick = hideEventForm;

function buildEventTimesFromForm() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (eventAlldayCheckbox.checked) {
    return { start: { date: selectedDateStr }, end: { date: addDaysStr(selectedDateStr, 1) } };
  }
  return {
    start: { dateTime: `${selectedDateStr}T${eventStartTime.value}:00`, timeZone },
    end: { dateTime: `${selectedDateStr}T${eventEndTime.value}:00`, timeZone },
  };
}

eventForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const summary = eventTitleInput.value.trim();
  if (!summary) return;

  const { start, end } = buildEventTimesFromForm();
  const asTeamEvent = !editingEventId && !editingTeamEventId && eventTeamShareCheckbox.checked;

  const saveBtn = document.getElementById('event-save');
  saveBtn.disabled = true;
  try {
    if (editingTeamEventId) {
      await window.api.updateTeamEvent({
        id: editingTeamEventId,
        title: summary,
        start,
        end,
        allDay: eventAlldayCheckbox.checked,
      });
    } else if (editingEventId) {
      await window.api.googleUpdateEvent({ eventId: editingEventId, summary, start, end });
    } else if (asTeamEvent) {
      await window.api.createTeamEvent({ title: summary, start, end, allDay: eventAlldayCheckbox.checked });
    } else {
      await window.api.googleCreateEvent({ summary, start, end });
    }
    hideEventForm();
    await refreshEventsAndDayPanel();
  } catch (err) {
    console.error('일정 저장 실패:', err);
    alert('일정 저장에 실패했습니다.');
  } finally {
    saveBtn.disabled = false;
  }
});

async function refreshEventsAndDayPanel() {
  const gridStart = startOfGrid(viewYear, viewMonth);
  await loadGoogleEventsForGrid(gridStart);
  await renderCalendar();
  if (selectedDateStr) renderDayEventList();
}

function openDayPanel(dateStr) {
  selectedDateStr = dateStr;
  hideEventForm();
  const [y, m, d] = dateStr.split('-').map(Number);
  const holidayName = currentHolidayMap.get(dateStr);
  dayPanelTitle.textContent = holidayName ? `${y}년 ${m}월 ${d}일 (${holidayName})` : `${y}년 ${m}월 ${d}일`;

  if (!isGoogleSignedIn) {
    dayEventList.innerHTML = '<div class="day-event-empty">구글 로그인 후 일정을 볼 수 있어요.</div>';
    eventAddBtn.classList.add('hidden');
  } else {
    renderDayEventList();
    eventAddBtn.classList.remove('hidden');
  }

  buildCalendarGrid();
}

document.getElementById('day-panel-close').onclick = () => {
  selectedDateStr = null;
  hideEventForm();
  eventAddBtn.classList.add('hidden');
  dayPanelTitle.textContent = '날짜를 선택하세요';
  dayEventList.innerHTML = '<div class="day-event-empty">날짜를 클릭하면 일정이 여기에 표시됩니다.</div>';
  buildCalendarGrid();
};

// --- Event wiring ---
document.getElementById('prev-month').onclick = () => {
  viewMonth -= 1;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear -= 1;
  }
  renderCalendar();
};

document.getElementById('next-month').onclick = () => {
  viewMonth += 1;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear += 1;
  }
  renderCalendar();
};

syncBtn.onclick = async () => {
  syncBtn.disabled = true;
  try {
    await refreshEventsAndDayPanel();
  } finally {
    syncBtn.disabled = false;
  }
};

noticeSend.onclick = sendAnnouncement;
noticeText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendAnnouncement();
});

document.getElementById('btn-minimize').onclick = () => window.api.minimizeWindow();
document.getElementById('btn-close').onclick = () => window.api.closeWindow();

const pinBtn = document.getElementById('btn-pin');
pinBtn.onclick = async () => {
  const pinned = await window.api.togglePin();
  pinBtn.classList.toggle('active', pinned);
  pinBtn.title = pinned ? '고정 해제' : '창 고정 (항상 위 + 이동 잠금)';
};

// --- Settings panel ---
const settingsPanel = document.getElementById('settings-panel');
const autostartToggle = document.getElementById('autostart-toggle');

const adminSection = document.getElementById('admin-section');
const rootAdminList = document.getElementById('root-admin-list');
const adminEmailsInput = document.getElementById('admin-emails-input');

let lastSavedTheme = {};

document.getElementById('btn-settings').onclick = async () => {
  autostartToggle.checked = await window.api.getAutostart();
  const theme = await window.api.getTheme();
  lastSavedTheme = theme;
  fillThemeInputs(theme);

  if (currentUser.isAdmin) {
    const { rootAdmins, dynamicAdmins } = await window.api.getAdminList();
    rootAdminList.textContent = rootAdmins.join(', ');
    adminEmailsInput.value = dynamicAdmins.join('\n');
    adminSection.classList.remove('hidden');
  } else {
    adminSection.classList.add('hidden');
  }

  settingsPanel.classList.remove('hidden');
};

document.getElementById('admin-save-btn').onclick = async () => {
  const emails = adminEmailsInput.value
    .split('\n')
    .map((e) => e.trim())
    .filter(Boolean);
  try {
    await window.api.setAdminList(emails);
    alert('관리자 목록이 저장되었습니다.');
  } catch (err) {
    console.error('관리자 목록 저장 실패:', err);
    alert('저장에 실패했습니다.');
  }
};

document.getElementById('settings-close').onclick = () => {
  applyTheme(lastSavedTheme); // discard any unsaved live-preview changes
  settingsPanel.classList.add('hidden');
};

document.getElementById('settings-save').onclick = async () => {
  await window.api.setAutostart(autostartToggle.checked);
  const theme = currentThemeFromForm();
  await window.api.setTheme(theme);
  lastSavedTheme = theme;
  applyTheme(theme);
  settingsPanel.classList.add('hidden');
};

// --- Theme customization ---
const themeBgInput = document.getElementById('theme-bg');
const themeCellBgInput = document.getElementById('theme-cell-bg');
const themeTextInput = document.getElementById('theme-text');
const themeAccentInput = document.getElementById('theme-accent');
const themeEventTextInput = document.getElementById('theme-event-text');
const themeFontSelect = document.getElementById('theme-font');
const themeResetBtn = document.getElementById('theme-reset');

const DEFAULT_THEME_INPUTS = {
  bg: '#1c1f3a',
  cellBg: '#20233d',
  text: '#eef0fa',
  accent: '#7c8cff',
  eventText: '#b9e8cc',
  font: '',
};

const THEME_PRESETS = {
  dark: DEFAULT_THEME_INPUTS,
  light: {
    bg: '#f4f5fa',
    cellBg: '#ffffff',
    text: '#20232b',
    accent: '#5865f2',
    eventText: '#1f8a5c',
    font: '',
  },
};

function currentThemeFromForm() {
  const checkedStyle = document.querySelector('input[name="card-style"]:checked');
  const checkedMode = document.querySelector('input[name="theme-mode"]:checked');
  return {
    mode: checkedMode ? checkedMode.value : 'dark',
    bg: themeBgInput.value,
    cellBg: themeCellBgInput.value,
    text: themeTextInput.value,
    accent: themeAccentInput.value,
    eventText: themeEventTextInput.value,
    font: themeFontSelect.value || null,
    cardStyle: checkedStyle ? checkedStyle.value : 'glass',
  };
}

document.querySelectorAll('input[name="theme-mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const preset = THEME_PRESETS[radio.value];
    if (radio.checked && preset) fillColorInputs(preset);
    applyTheme(currentThemeFromForm()); // live preview, independent of Save
  });
});

document.querySelectorAll('input[name="card-style"]').forEach((radio) => {
  radio.addEventListener('change', () => applyTheme(currentThemeFromForm()));
});

[themeBgInput, themeCellBgInput, themeTextInput, themeAccentInput, themeEventTextInput].forEach((input) => {
  input.addEventListener('input', () => applyTheme(currentThemeFromForm()));
});
themeFontSelect.addEventListener('change', () => applyTheme(currentThemeFromForm()));

function fillColorInputs(colors) {
  themeBgInput.value = colors.bg;
  themeCellBgInput.value = colors.cellBg;
  themeTextInput.value = colors.text;
  themeAccentInput.value = colors.accent;
  themeEventTextInput.value = colors.eventText;
}

function fillThemeInputs(theme) {
  themeBgInput.value = theme.bg || DEFAULT_THEME_INPUTS.bg;
  themeCellBgInput.value = theme.cellBg || DEFAULT_THEME_INPUTS.cellBg;
  themeTextInput.value = theme.text || DEFAULT_THEME_INPUTS.text;
  themeAccentInput.value = theme.accent || DEFAULT_THEME_INPUTS.accent;
  themeEventTextInput.value = theme.eventText || DEFAULT_THEME_INPUTS.eventText;
  themeFontSelect.value = theme.font || '';

  const style = theme.cardStyle || 'glass';
  const styleRadio = document.querySelector(`input[name="card-style"][value="${style}"]`);
  if (styleRadio) styleRadio.checked = true;

  const mode = theme.mode || 'dark';
  const modeRadio = document.querySelector(`input[name="theme-mode"][value="${mode}"]`);
  if (modeRadio) modeRadio.checked = true;
}

function darkenHex(hex, amount) {
  return shadeHex(hex, -amount);
}

// positive amount lightens, negative darkens (clamped to the 0-255 range per channel)
function shadeHex(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function applyTheme(theme) {
  const root = document.documentElement.style;

  if (theme.bg) {
    root.setProperty('--app-bg', theme.bg);
    // matte/3d card styles are opaque (no blur), so they need their own
    // theme-derived shades instead of just blurring whatever is behind them.
    root.setProperty('--card-tint', theme.bg);
    root.setProperty('--card-tint-light', shadeHex(theme.bg, 40));
    root.setProperty('--card-tint-dark', shadeHex(theme.bg, -40));
  } else {
    root.removeProperty('--app-bg');
    root.removeProperty('--card-tint');
    root.removeProperty('--card-tint-light');
    root.removeProperty('--card-tint-dark');
  }

  if (theme.cellBg) root.setProperty('--cell-bg', theme.cellBg);
  else root.removeProperty('--cell-bg');

  if (theme.text) root.setProperty('--text-color', theme.text);
  else root.removeProperty('--text-color');

  if (theme.accent) {
    root.setProperty('--accent', theme.accent);
    root.setProperty('--accent-2', darkenHex(theme.accent, 40));
  } else {
    root.removeProperty('--accent');
    root.removeProperty('--accent-2');
  }

  if (theme.eventText) root.setProperty('--event-text-color', theme.eventText);
  else root.removeProperty('--event-text-color');

  if (theme.font) root.setProperty('--font-family', theme.font);
  else root.removeProperty('--font-family');

  document.body.setAttribute('data-card-style', theme.cardStyle || 'glass');
}

themeResetBtn.onclick = async () => {
  await window.api.setTheme({});
  lastSavedTheme = {};
  applyTheme({});
  fillThemeInputs({});
};

window.api.onAnnouncementsUpdate((updated) => {
  announcements = updated;
  renderAnnouncements();
});

window.api.onAuthUpdated((user) => {
  currentUser = user;
  isGoogleSignedIn = Boolean(user && user.signedIn);
  renderGoogleStatus();
  updateNoticeInputState();
  renderAnnouncements();
  renderCalendar();
});

// --- Init ---
(async function init() {
  const theme = await window.api.getTheme();
  applyTheme(theme);

  const status = await window.api.getConfigStatus();
  isConfigured = status.configured;
  if (!isConfigured) configBanner.classList.remove('hidden');

  isGoogleSignedIn = await window.api.googleIsSignedIn();
  if (isGoogleSignedIn) currentUser = await window.api.getCurrentUser();
  renderGoogleStatus();
  updateNoticeInputState();
  renderAnnouncements();
  await renderCalendar();
})();
