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

// Applied immediately on change, unlike theme fields which only commit on
// Save — otherwise toggling it and closing without pressing Save silently
// does nothing, and there's no visual cue (unlike the live theme preview)
// to suggest anything was left unsaved.
autostartToggle.addEventListener('change', () => {
  window.api.setAutostart(autostartToggle.checked);
});

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
// Each entry drives its color picker, its CSS custom property, and (via the
// dark/light preset objects below) its two default palettes — one place to
// edit instead of five parallel lists, so adding a color stays a one-liner.
const COLOR_FIELDS = [
  { key: 'bg', id: 'theme-bg', cssVar: '--color-app-bg' },
  { key: 'panelBg', id: 'theme-panel-bg', cssVar: '--color-panel-bg', shadeVars: ['--color-panel-tint-light', '--color-panel-tint-dark'] },
  { key: 'accent', id: 'theme-accent', cssVar: '--color-accent', shadeVars: ['--color-accent-2'] },
  { key: 'border', id: 'theme-border', cssVar: '--color-border' },
  { key: 'divider', id: 'theme-divider', cssVar: '--color-divider' },
  { key: 'calendarBg', id: 'theme-calendar-bg', cssVar: '--color-calendar-bg' },
  { key: 'cellBg', id: 'theme-cell-bg', cssVar: '--color-day-cell-bg' },
  { key: 'cellHover', id: 'theme-cell-hover', cssVar: '--color-day-cell-hover' },
  { key: 'selectedDay', id: 'theme-selected-day', cssVar: '--color-selected-day-bg' },
  { key: 'today', id: 'theme-today', cssVar: '--color-today-bg' },
  { key: 'mutedDate', id: 'theme-muted-date', cssVar: '--color-muted-date' },
  { key: 'sunday', id: 'theme-sunday', cssVar: '--color-sunday' },
  { key: 'saturday', id: 'theme-saturday', cssVar: '--color-saturday' },
  { key: 'eventBg', id: 'theme-event-bg', cssVar: '--color-event-bg' },
  { key: 'eventBorder', id: 'theme-event-border', cssVar: '--color-event-border' },
  { key: 'eventText', id: 'theme-event-text', cssVar: '--color-event-text' },
  { key: 'inputBg', id: 'theme-input-bg', cssVar: '--color-input-bg' },
  { key: 'buttonBg', id: 'theme-button-bg', cssVar: '--color-button-bg' },
  { key: 'buttonText', id: 'theme-button-text', cssVar: '--color-button-text' },
  { key: 'secondaryButtonBg', id: 'theme-secondary-button-bg', cssVar: '--color-secondary-button-bg' },
  { key: 'text', id: 'theme-text', cssVar: '--color-text-primary' },
  { key: 'textSecondary', id: 'theme-text-secondary', cssVar: '--color-text-secondary' },
];

const DARK_DEFAULTS = {
  bg: '#1c1f3a', panelBg: '#262a48', accent: '#7c8cff', border: '#ffffff', divider: '#ffffff',
  calendarBg: '#1c1f3a', cellBg: '#20233d', cellHover: '#2a2e4d', selectedDay: '#3a3f7a', today: '#33395c',
  mutedDate: '#6b7094', sunday: '#ff8f8f', saturday: '#8fb4ff',
  eventBg: '#20233d', eventBorder: '#7ce2b0', eventText: '#b9e8cc',
  inputBg: '#262a48', buttonBg: '#7c8cff', buttonText: '#ffffff', secondaryButtonBg: '#3a3f7a',
  text: '#eef0fa', textSecondary: '#b7bfe6',
  font: '', dateFontSize: '11', eventFontSize: '9',
};

const LIGHT_DEFAULTS = {
  bg: '#f2f4f8', panelBg: '#f7f8fb', accent: '#6366be', border: '#dce1e8', divider: '#e2e8f0',
  calendarBg: '#f1f3f7', cellBg: '#f9fafc', cellHover: '#eef2ff', selectedDay: '#d8dcf5', today: '#e0f2fe',
  mutedDate: '#cbd5e1', sunday: '#f87171', saturday: '#60a5fa',
  eventBg: '#eef2ff', eventBorder: '#c7d2fe', eventText: '#2d3764',
  inputBg: '#ffffff', buttonBg: '#4f46e5', buttonText: '#ffffff', secondaryButtonBg: '#e0e2f7',
  text: '#1e293b', textSecondary: '#64748b',
  font: '', dateFontSize: '11', eventFontSize: '9',
};

const THEME_PRESETS = { dark: DARK_DEFAULTS, light: LIGHT_DEFAULTS };

const themeFontSelect = document.getElementById('theme-font');
const themeDateFontSizeSelect = document.getElementById('theme-date-font-size');
const themeEventFontSizeSelect = document.getElementById('theme-event-font-size');
const themeBoldCheckbox = document.getElementById('theme-bold');
const themeResetBtn = document.getElementById('theme-reset');

function currentThemeFromForm() {
  const checkedStyle = document.querySelector('input[name="card-style"]:checked');
  const checkedMode = document.querySelector('input[name="theme-mode"]:checked');
  const theme = {
    mode: checkedMode ? checkedMode.value : 'dark',
    cardStyle: checkedStyle ? checkedStyle.value : 'glass',
    font: themeFontSelect.value || null,
    dateFontSize: themeDateFontSizeSelect.value,
    eventFontSize: themeEventFontSizeSelect.value,
    bold: themeBoldCheckbox.checked,
  };
  COLOR_FIELDS.forEach((f) => {
    const el = document.getElementById(f.id);
    if (el) theme[f.key] = el.value;
  });
  return theme;
}

function fillColorInputsFromPreset(preset) {
  COLOR_FIELDS.forEach((f) => {
    const el = document.getElementById(f.id);
    if (el && preset[f.key]) el.value = preset[f.key];
  });
}

function fillThemeInputs(theme) {
  // fall back to the SAME mode's defaults, not always dark — otherwise a
  // light-themed user with an older save (missing newer fields) gets a
  // mismatched dark/light color clash for whatever fields weren't saved yet.
  const defaults = THEME_PRESETS[theme.mode] || DARK_DEFAULTS;
  COLOR_FIELDS.forEach((f) => {
    const el = document.getElementById(f.id);
    if (el) el.value = theme[f.key] || defaults[f.key];
  });
  themeFontSelect.value = theme.font || '';
  themeDateFontSizeSelect.value = theme.dateFontSize || defaults.dateFontSize;
  themeEventFontSizeSelect.value = theme.eventFontSize || defaults.eventFontSize;
  themeBoldCheckbox.checked = Boolean(theme.bold);

  const style = theme.cardStyle || 'glass';
  const styleRadio = document.querySelector(`input[name="card-style"][value="${style}"]`);
  if (styleRadio) styleRadio.checked = true;

  const mode = theme.mode || 'dark';
  const modeRadio = document.querySelector(`input[name="theme-mode"][value="${mode}"]`);
  if (modeRadio) modeRadio.checked = true;
}

document.querySelectorAll('input[name="theme-mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const preset = THEME_PRESETS[radio.value];
    if (radio.checked && preset) fillColorInputsFromPreset(preset);
    applyTheme(currentThemeFromForm()); // live preview, independent of Save
  });
});

document.querySelectorAll('input[name="card-style"]').forEach((radio) => {
  radio.addEventListener('change', () => applyTheme(currentThemeFromForm()));
});

COLOR_FIELDS.forEach((f) => {
  const el = document.getElementById(f.id);
  if (el) el.addEventListener('input', () => applyTheme(currentThemeFromForm()));
});
[themeFontSelect, themeDateFontSizeSelect, themeEventFontSizeSelect].forEach((el) => {
  el.addEventListener('change', () => applyTheme(currentThemeFromForm()));
});
themeBoldCheckbox.addEventListener('change', () => applyTheme(currentThemeFromForm()));

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

  COLOR_FIELDS.forEach((f) => {
    const value = theme[f.key];
    if (value) {
      root.setProperty(f.cssVar, value);
      if (f.shadeVars) {
        // one shade lighter, one shade darker — enough for a gradient or a hover/active tint
        root.setProperty(f.shadeVars[0], shadeHex(value, 40));
        if (f.shadeVars[1]) root.setProperty(f.shadeVars[1], shadeHex(value, -40));
      }
    } else {
      root.removeProperty(f.cssVar);
      (f.shadeVars || []).forEach((v) => root.removeProperty(v));
    }
  });

  if (theme.font) root.setProperty('--font-family', theme.font);
  else root.removeProperty('--font-family');

  root.setProperty('--calendar-date-font-size', `${theme.dateFontSize || DARK_DEFAULTS.dateFontSize}px`);
  root.setProperty('--calendar-event-font-size', `${theme.eventFontSize || DARK_DEFAULTS.eventFontSize}px`);

  document.body.setAttribute('data-bold', theme.bold ? 'true' : 'false');
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

// --- 출고 관리 장부 ---
const chulgoPanel = document.getElementById('chulgo-panel');
const chulgoStatRow = document.getElementById('chulgo-stat-row');
const chulgoMonthPicker = document.getElementById('chulgo-month-picker');
const chulgoTableWrap = document.getElementById('chulgo-table-wrap');
const chulgoEmpty = document.getElementById('chulgo-empty');
const chulgoActiveMonthLabel = document.getElementById('chulgo-active-month-label');
const chulgoActiveMonthCount = document.getElementById('chulgo-active-month-count');
const chulgoActiveMonthTotal = document.getElementById('chulgo-active-month-total');
const chulgoFormulaHint = document.getElementById('chulgo-formula-hint');
const chulgoPositionSelect = document.getElementById('chulgo-position-select');
const chulgoPhoneInput = document.getElementById('chulgo-phone-input');

const CHULGO_COLW_KEY = 'chulgo_colwidths_v1';
const CHULGO_COLS = [
  { key: 'finType', label: '금융정보', type: 'select', options: ['리스', '렌트', '일시불', '기타'], w: 90 },
  { key: 'name', label: '고객명', type: 'text', w: 150 },
  { key: 'car', label: '차종', type: 'text', w: 120 },
  { key: 'company', label: '금융사', type: 'text', w: 130 },
  { key: 'fee', label: '수수료', type: 'money', w: 120 },
  { key: 'promo', label: '프로모션', type: 'money', w: 115 },
  { key: 'agencyFee', label: '대리점수당', type: 'money', w: 120 },
  { key: 'supplies', label: '용품비', type: 'money', w: 110 },
  { key: 'status', label: '투입여부', type: 'select', options: ['-', '예정', '완료'], w: 90 },
  { key: 'dbType', label: '디비유형', type: 'text', w: 66 },
];
const CHULGO_COMPUTED_W = 150;
const CHULGO_ACTION_W = 66;
const CHULGO_CHECK_W = 42;

const CHULGO_POSITION_RATES = { 주임: 0.4, 대리: 0.4, 과장: 0.5, 차장: 0.5, 팀장: 0.5 };
const CHULGO_POSITION_STIPEND = { 주임: 0, 대리: 0, 과장: 0, 차장: 500000, 팀장: 1000000 };
const CHULGO_DESK_FEE = 400000;

// 에이원오토 직급 별 대수 프로모션 — [댓수 도달, 지급액], 도달한 것 중 가장 높은 구간이 적용된다.
// 과장/차장/팀장은 전부 "과장 이상" 한 표를 같이 씀.
const CHULGO_QUOTA_PROMO_TIERS = {
  주임: [
    [5, 300000],
    [8, 600000],
    [12, 1000000],
    [15, 1500000],
  ],
  대리: [
    [7, 500000],
    [9, 800000],
    [12, 1200000],
    [15, 1700000],
    [18, 2000000],
    [21, 2500000],
  ],
  과장: [
    [9, 1000000],
    [12, 1500000],
    [15, 2000000],
    [18, 2500000],
    [21, 3000000],
  ],
};
CHULGO_QUOTA_PROMO_TIERS.차장 = CHULGO_QUOTA_PROMO_TIERS.과장;
CHULGO_QUOTA_PROMO_TIERS.팀장 = CHULGO_QUOTA_PROMO_TIERS.과장;

function chulgoQuotaPromo(position, countedUnits) {
  const tiers = CHULGO_QUOTA_PROMO_TIERS[position] || [];
  let amount = 0;
  for (const [threshold, tierAmount] of tiers) {
    if (countedUnits >= threshold) amount = tierAmount;
  }
  return amount;
}

let chulgoEntries = [];
let chulgoPosition = '과장';
let chulgoPhone = '';
let chulgoSelectedId = null;
let chulgoColWidths = {};
try {
  chulgoColWidths = JSON.parse(localStorage.getItem(CHULGO_COLW_KEY) || '{}');
} catch (e) {
  chulgoColWidths = {};
}
function chulgoWidthFor(key, fallback) {
  return chulgoColWidths[key] || fallback;
}

function chulgoWon(n) {
  const r = Math.round(n || 0);
  if (!r) return '-';
  return (r < 0 ? '-' : '') + Math.abs(r).toLocaleString('ko-KR') + '원';
}
function chulgoComputedFee(e) {
  const base =
    (Number(e.fee) || 0) + (Number(e.promo) || 0) + (Number(e.agencyFee) || 0) - (Number(e.supplies) || 0);
  const rate = CHULGO_POSITION_RATES[chulgoPosition] ?? 0.5;
  return base * 0.867 * rate;
}
function chulgoEntriesEqual(a, b) {
  if (a.length !== b.length) return false;
  const bMap = new Map(b.map((e) => [e.id, e]));
  return a.every((ea) => {
    const eb = bMap.get(ea.id);
    if (!eb) return false;
    return Object.keys(ea).every((k) => ea[k] === eb[k]);
  });
}
function chulgoUpdateFormulaHint() {
  const rate = Math.round((CHULGO_POSITION_RATES[chulgoPosition] ?? 0.5) * 100);
  chulgoFormulaHint.textContent = `공제후총수수료 = (수수료 + 프로모션 + 대리점수당 − 용품비) × 86.7% × ${rate}% (직책: ${chulgoPosition})`;
}
function chulgoMonthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${y}년 ${Number(m)}월`;
}
function chulgoShiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function chulgoActiveMonth() {
  return chulgoMonthPicker.value;
}
function chulgoFormatMoneyDisplay(n) {
  const r = Math.round(Number(n) || 0);
  return r ? r.toLocaleString('ko-KR') + '원' : '';
}
function chulgoParseMoneyRaw(str) {
  return Number((str || '').toString().replace(/[^\d-]/g, '')) || 0;
}

function chulgoCountedUnits(list) {
  return list.filter((e) => e.countsQuota !== false).length;
}

function renderChulgoStats() {
  const totalCount = chulgoEntries.length;
  const doneCount = chulgoEntries.filter((e) => e.status === '완료').length;
  const pendingCount = chulgoEntries.filter((e) => e.status === '예정').length;

  const ym = chulgoActiveMonth();
  const monthList = chulgoEntries.filter((e) => e.month === ym);
  const monthSum = monthList.reduce((a, e) => a + chulgoComputedFee(e), 0);
  const stipend = CHULGO_POSITION_STIPEND[chulgoPosition] ?? 0;
  const quotaPromo = chulgoQuotaPromo(chulgoPosition, chulgoCountedUnits(monthList));
  const netTotal = monthSum - CHULGO_DESK_FEE + stipend + quotaPromo;

  chulgoStatRow.innerHTML = `
    <div class="chulgo-stat-tile"><div class="label">전체 출고 건수</div><div class="value">${totalCount}건</div></div>
    <div class="chulgo-stat-tile">
      <div class="label">이번 달 공제 후 총수수료 합계</div>
      <div class="value">${chulgoWon(netTotal)}</div>
    </div>
    <div class="chulgo-stat-tile"><div class="label">완료</div><div class="value" style="color:#0ca30c">${doneCount}건</div></div>
    <div class="chulgo-stat-tile"><div class="label">예정</div><div class="value" style="color:#b5790a">${pendingCount}건</div></div>
  `;
}

function chulgoCellHTML(e, col) {
  const val = e[col.key] ?? (col.type === 'money' ? 0 : '');
  if (col.type === 'select') {
    const opts = col.options.map((o) => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('');
    const cls = val === '완료' ? 'chulgo-status-완료' : val === '예정' ? 'chulgo-status-예정' : '';
    return `<select class="${cls}" data-id="${e.id}" data-key="${col.key}">${opts}</select>`;
  }
  if (col.type === 'money') {
    return `<input class="chulgo-money" type="text" inputmode="numeric" data-id="${e.id}" data-key="${col.key}" value="${chulgoFormatMoneyDisplay(val)}" placeholder="0">`;
  }
  return `<input type="text" data-id="${e.id}" data-key="${col.key}" value="${(val || '').toString().replace(/"/g, '&quot;')}">`;
}

function chulgoBuildColgroup() {
  const cols = CHULGO_COLS.map((c) => `<col style="width:${chulgoWidthFor(c.key, c.w)}px">`).join('');
  return `<colgroup><col style="width:${CHULGO_CHECK_W}px">${cols}<col style="width:${chulgoWidthFor('_computed', CHULGO_COMPUTED_W)}px"><col style="width:${CHULGO_ACTION_W}px"></colgroup>`;
}

function chulgoFriendlyError(err) {
  const msg = (err && err.message) || '';
  if (msg.includes('permission-denied') || msg.includes('PERMISSION_DENIED')) {
    return 'Firestore 보안 규칙에 chulgoEntries 컬렉션이 아직 허용되어 있지 않습니다.\nFirebase 콘솔 → Firestore Database → 규칙 탭에서 README의 규칙을 추가해주세요.';
  }
  if (msg.includes('NOT_SIGNED_IN')) {
    return '구글 로그인이 풀린 것 같습니다. 로그아웃 후 다시 로그인해주세요.';
  }
  if (msg.includes('FIREBASE_NOT_CONFIGURED')) {
    return 'config/config.json에 firebase 설정이 채워지지 않았습니다.';
  }
  return `실패했습니다: ${msg || '알 수 없는 오류'}`;
}

async function chulgoUpdateField(id, key, value) {
  try {
    await window.api.updateChulgoEntry({ id, [key]: value });
  } catch (err) {
    console.error('출고 건 수정 실패:', err);
    alert(chulgoFriendlyError(err));
  }
}

function renderChulgo() {
  renderChulgoStats();
  const ym = chulgoActiveMonth();
  const list = chulgoEntries.filter((e) => e.month === ym).sort((a, b) => (a.order || 0) - (b.order || 0));
  const monthTotal = list.reduce((a, e) => a + chulgoComputedFee(e), 0);

  // A selected row that scrolled out of view (deleted, or the month changed) shouldn't
  // leave the generator buttons pointing at a row the user can no longer see.
  if (chulgoSelectedId && !list.some((x) => x.id === chulgoSelectedId)) chulgoSelectedId = null;

  chulgoActiveMonthLabel.textContent = chulgoMonthLabel(ym);
  chulgoActiveMonthCount.textContent = `${list.length}건 (인정 ${chulgoCountedUnits(list)}대)`;
  chulgoActiveMonthTotal.textContent = chulgoWon(monthTotal);
  chulgoEmpty.style.display = list.length ? 'none' : 'block';

  if (!list.length) {
    chulgoTableWrap.innerHTML = '';
    chulgoTableWrap.style.display = 'none';
    chulgoUpdateActionRowState();
    return;
  }
  chulgoTableWrap.style.display = 'block';

  const rows = list
    .map(
      (e) => `
    <tr data-row-id="${e.id}" class="${e.id === chulgoSelectedId ? 'selected' : ''}">
      <td class="chulgo-check-cell"><input type="checkbox" class="chulgo-quota-check" data-id="${e.id}" ${e.countsQuota !== false ? 'checked' : ''} title="댓수 인정"></td>
      ${CHULGO_COLS.map((c) => `<td>${chulgoCellHTML(e, c)}</td>`).join('')}
      <td class="chulgo-computed">${chulgoWon(chulgoComputedFee(e))}</td>
      <td>
        <div class="chulgo-row-actions">
          <button class="chulgo-memo-btn${e.memo ? ' has-memo' : ''}" data-id="${e.id}" title="메모 (계약기간/주행거리/초기자금)">📝</button>
          <button class="chulgo-del-btn" data-id="${e.id}" title="삭제">✕</button>
        </div>
      </td>
    </tr>
  `
    )
    .join('');

  chulgoTableWrap.innerHTML = `
    <table class="chulgo-ledger">
      ${chulgoBuildColgroup()}
      <thead><tr>
        <th class="chulgo-check-cell">인정댓수</th>
        ${CHULGO_COLS.map((c) => `<th data-key="${c.key}">${c.label}<span class="chulgo-col-resizer" data-key="${c.key}"></span></th>`).join('')}
        <th data-key="_computed">공제후총수수료<span class="chulgo-col-resizer" data-key="_computed"></span></th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="${CHULGO_COLS.length + 1}">월 합계</td><td>${chulgoWon(monthTotal)}</td><td></td></tr></tfoot>
    </table>
  `;

  chulgoTableWrap.querySelectorAll('input.chulgo-money').forEach((el) => {
    el.addEventListener('focus', () => {
      el.value = chulgoParseMoneyRaw(el.value) || '';
    });
    el.addEventListener('input', () => {
      const cursorFromEnd = el.value.length - el.selectionStart;
      const raw = el.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
      const formatted = raw ? Number(raw).toLocaleString('ko-KR') : '';
      el.value = formatted;
      const pos = Math.max(0, el.value.length - cursorFromEnd);
      el.setSelectionRange(pos, pos);
    });
    el.addEventListener('blur', () => {
      const raw = chulgoParseMoneyRaw(el.value);
      el.value = chulgoFormatMoneyDisplay(raw);
    });
  });

  chulgoTableWrap.querySelectorAll('input:not(.chulgo-quota-check), select').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.dataset.id;
      const key = el.dataset.key;
      const value = el.classList.contains('chulgo-money') ? chulgoParseMoneyRaw(el.value) : el.value;
      const entry = chulgoEntries.find((x) => x.id === id);
      if (entry) entry[key] = value; // optimistic local update — Firestore snapshot reconciles right after
      if (el.tagName === 'SELECT') {
        el.className = value === '완료' ? 'chulgo-status-완료' : value === '예정' ? 'chulgo-status-예정' : '';
      }
      const row = el.closest('tr');
      const computedCell = row && row.querySelector('td.chulgo-computed');
      if (computedCell && entry) computedCell.textContent = chulgoWon(chulgoComputedFee(entry));
      renderChulgoStats();
      const total = chulgoEntries.filter((x) => x.month === ym).reduce((a, x) => a + chulgoComputedFee(x), 0);
      chulgoActiveMonthTotal.textContent = chulgoWon(total);
      chulgoUpdateField(id, key, value);
    });
    // Enter moves to the next cell in the row, like Excel's Tab-on-Enter — instead of
    // doing nothing (inputs aren't inside a <form>, so Enter had no effect before).
    el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const row = el.closest('tr');
      const controls = Array.from(row.querySelectorAll('input, select'));
      const next = controls[controls.indexOf(el) + 1];
      if (next) {
        next.focus();
        if (typeof next.select === 'function') next.select();
      } else {
        el.blur();
      }
    });
  });

  chulgoTableWrap.querySelectorAll('.chulgo-del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 출고 건을 삭제할까요?')) return;
      try {
        await window.api.deleteChulgoEntry(btn.dataset.id);
      } catch (err) {
        console.error('출고 건 삭제 실패:', err);
        alert(chulgoFriendlyError(err));
      }
    });
  });

  chulgoTableWrap.querySelectorAll('.chulgo-quota-check').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.dataset.id;
      const entry = chulgoEntries.find((x) => x.id === id);
      if (entry) entry.countsQuota = el.checked; // optimistic — Firestore snapshot reconciles right after
      renderChulgoStats();
      chulgoActiveMonthCount.textContent = `${list.length}건 (인정 ${chulgoCountedUnits(list)}대)`;
      chulgoUpdateField(id, 'countsQuota', el.checked);
    });
  });

  // Clicking anywhere on a row (but not its inputs/buttons) selects it as the
  // target for the 계약보고/투입보고/안내문자 generator buttons above the table.
  chulgoTableWrap.querySelectorAll('tr[data-row-id]').forEach((tr) => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('input, select, button, textarea')) return;
      chulgoSelectedId = tr.dataset.rowId;
      chulgoTableWrap.querySelectorAll('tr[data-row-id]').forEach((r) => r.classList.toggle('selected', r === tr));
      chulgoUpdateActionRowState();
    });
  });

  chulgoTableWrap.querySelectorAll('.chulgo-memo-btn').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      chulgoOpenMemoPopup(btn.dataset.id);
    });
  });

  chulgoBindResizers();
  chulgoUpdateActionRowState();
}

// --- 문구 생성 (계약보고 / 투입보고 / 계약내용 안내문자 / 커넥티드 안내문자 / 정리문구) ---
// 구글시트에 만들어둔 GAS 스크립트 로직을 이식한 것 — 다만 이 장부엔
// 차량가격/계약조건/모터스 담당자 같은 컬럼이 없어서, 그 자리는 아래처럼 대체한다:
//   차량가액 → 수수료(fee) 금액을 그대로 사용
//   모터스 담당자/연락처 → 항상 'X' (안 씀)
//   계약기간/주행거리/초기자금 → 행별 "메모"에 자유 텍스트로 적으면 파싱해서 사용
//   영업담당 → 현재 로그인된 구글 계정 이름

const CHULGO_FINANCE_CENTER = {
  롯데렌터카: { call: '1588-1230', accident: '1588-1230', succession: '1588-1230' },
  SK렌터카: { call: '1599-9111', accident: '1599-9111', succession: '1577-2280' },
  롯데캐피탈: { call: '1899-4400', accident: '1588-4800', succession: '1899-4400' },
  MG캐피탈: { call: '1588-9688', accident: '1644-1199', succession: '1588-9688' },
  IM캐피탈: { call: '1566-0050', accident: '1577-0565', succession: '1566-8808' },
  레드캡렌터카: { call: '1544-4599', accident: '1544-4599', succession: '02-3660-2940' },
  아마존렌터카: { call: '02-392-4242', accident: '1588-6688', succession: '1588-5211' },
  JB우리캐피탈: { call: '1688-2300', accident: '1666-8800', succession: '02-6222-7957' },
  메리츠캐피탈: { call: '1588-9666', accident: '1577-0565', succession: '02-3462-6600,6700' },
  우리금융캐피탈: { call: '1544-8600', accident: '1644-5222', succession: '02-2017-5560' },
  하나캐피탈: { call: '1800-1110', accident: '1688-2040', succession: '02-2037-1390' },
  BNK캐피탈: { call: '1577-2280', accident: '1644-2254', succession: '1599-9111' },
  현대캐피탈: { call: '1588-2114', accident: '1588-2114', succession: '1588-2114' },
  KB캐피탈: { call: '1544-1200', accident: '1544-9770', succession: '1522-1112' },
  오릭스캐피탈: { call: '02-2050-6700', accident: '1670-5330', succession: '02-2050-6700' },
  신한카드: { call: '1544-7100', accident: '1544-7751', succession: '1544-7100' },
  우리카드: { call: '1544-9800', accident: '1644-1199', succession: '1544-9800' },
  농협캐피탈: { call: '1644-3700', accident: '02-2038-3676', succession: '1644-3700' },
  삼성카드: { call: '1688-3001', accident: '1577-8778', succession: '02-2172-7219' },
  산은캐피탈: { call: '1899-6114', accident: '', succession: '1899-6114' },
  오토핸즈: { call: '1800-5873', accident: '1800-5873', succession: '' },
  롯데오토리스: { call: '1899-8700', accident: '', succession: '1899-8700( 1 -> 1-> 4 )' },
};

// 자주 쓰는 줄임말 → 위 표의 정식 명칭 (장부에 짧게 써놔도 알아서 찾도록)
const CHULGO_FINANCE_ALIAS = {
  IM: 'IM캐피탈', MG: 'MG캐피탈', BNK: 'BNK캐피탈', JB: 'JB우리캐피탈',
  우리: '우리금융캐피탈', 메리츠: '메리츠캐피탈', 하나: '하나캐피탈',
  신한: '신한카드', KB: 'KB캐피탈', 농협: '농협캐피탈', 삼성: '삼성카드',
  현대: '현대캐피탈', 오릭스: '오릭스캐피탈', 산은: '산은캐피탈',
};

function chulgoNormalizeFinanceName_(name) {
  return String(name || '').replace(/\s/g, '').replace(/[()]/g, '').toUpperCase();
}

function chulgoLookupFinanceCenter_(companyRaw) {
  const company = String(companyRaw || '').trim();
  if (!company) return null;
  const normalized = chulgoNormalizeFinanceName_(company);

  for (const key in CHULGO_FINANCE_CENTER) {
    if (chulgoNormalizeFinanceName_(key) === normalized) return CHULGO_FINANCE_CENTER[key];
  }
  const aliasKey = CHULGO_FINANCE_ALIAS[company];
  if (aliasKey && CHULGO_FINANCE_CENTER[aliasKey]) return CHULGO_FINANCE_CENTER[aliasKey];
  // 부분 일치 — 장부에 줄여 쓴 경우("신한"만 적었다든지)까지 커버
  for (const key in CHULGO_FINANCE_CENTER) {
    const keyNorm = chulgoNormalizeFinanceName_(key);
    if (keyNorm.includes(normalized) || normalized.includes(keyNorm)) return CHULGO_FINANCE_CENTER[key];
  }
  return null;
}

const CHULGO_CONNECTED_GUIDE = {
  GENESIS: { label: '제네시스', name: '커넥티드 서비스', url: 'https://youtu.be/iLa380FOCPQ?si=bEg2cwvxH99JJ6Bo' },
  HYUNDAI: { label: '현대', name: '블루링크', url: 'https://youtu.be/xeyEyVL-nYQ?si=tZT5Y3kZMhq_LOyy' },
  KIA: { label: '기아', name: 'KIA 커넥트', url: 'https://youtu.be/ISEQgcQmx6I?si=2TWmlo2CfsGfwMHs' },
};

const CHULGO_BRAND_KEYWORDS = {
  GENESIS: ['G70', 'G80', 'G90', 'GV60', 'GV70', 'GV80', 'GV90', 'EQ900', '제네시스'],
  KIA: ['K3', 'K5', 'K7', 'K8', 'K9', '모닝', 'MORNING', '레이', 'RAY', '쏘렌토', 'SORENTO', '스포티지', 'SPORTAGE', '셀토스', 'SELTOS', '카니발', 'CARNIVAL', 'EV3', 'EV4', 'EV5', 'EV6', 'EV9', '봉고'],
  HYUNDAI: ['아반떼', 'AVANTE', '쏘나타', 'SONATA', '그랜저', 'GRANDEUR', '투싼', 'TUCSON', '싼타페', 'SANTAFE', 'SANTA FE', '팰리세이드', 'PALISADE', '캐스퍼', 'CASPER', '코나', 'KONA', '아이오닉', 'IONIQ', '포터', 'PORTER', '스타리아', 'STARIA', '넥쏘', 'NEXO', '벨로스터', 'VELOSTER'],
};

function chulgoDetectBrand_(modelName) {
  const model = String(modelName || '').trim().toUpperCase();
  if (!model) return null;
  for (const brand in CHULGO_BRAND_KEYWORDS) {
    if (CHULGO_BRAND_KEYWORDS[brand].some((k) => model.includes(String(k).toUpperCase()))) return brand;
  }
  return null;
}

function chulgoAddComma_(n) {
  return Number(n || 0).toLocaleString('ko-KR');
}

// "48개월 30000km 무보증" / "36개월 3만km 보증금 20%" / "60개월 20000km 보증금 500만원" 같은
// 자유 텍스트 메모에서 계약기간/주행거리/초기자금을 뽑아낸다 (구글시트 parseContractCondition_ 이식).
function chulgoParseMemo_(memoText, feeAmount) {
  const text = String(memoText || '').replace(/\s+/g, ' ').trim();
  let period = '-';
  let mileage = '-';
  let initialFund = '없음';

  const periodMatch = text.match(/(\d+)\s*개월/);
  if (periodMatch) period = `${periodMatch[1]}개월`;

  const mileageMatchMan = text.match(/(\d+)\s*만\s*KM/i);
  const mileageMatchNum = text.match(/([\d,]+)\s*KM/i);
  if (mileageMatchMan) {
    mileage = `${chulgoAddComma_(Number(mileageMatchMan[1]) * 10000)}km`;
  } else if (mileageMatchNum) {
    mileage = `${chulgoAddComma_(Number(String(mileageMatchNum[1]).replace(/,/g, '')))}km`;
  }

  if (/무보증/.test(text)) {
    initialFund = '무보증';
  } else if (/무선납/.test(text)) {
    initialFund = '무선납';
  } else {
    const percentMatch = text.match(/보증금\s*(\d+)\s*%/);
    const amountMatch = text.match(/보증금\s*([\d,]+)\s*(만원|원)?/);
    if (percentMatch) {
      const pct = Number(percentMatch[1]);
      const amountText = feeAmount > 0 ? ` (${chulgoAddComma_(Math.round((feeAmount * pct) / 100))}원)` : '';
      initialFund = `보증금 ${pct}%${amountText}`;
    } else if (amountMatch) {
      const raw = Number(String(amountMatch[1]).replace(/,/g, ''));
      const amountWon = amountMatch[2] === '만원' ? raw * 10000 : raw;
      initialFund = `보증금 ${chulgoAddComma_(amountWon)}원`;
    }
  }

  return { period, mileage, initialFund };
}

function chulgoFormatFeeForReport_(feeAmount) {
  const amount = Number(feeAmount) || 0;
  if (!amount) return '';
  if (amount % 10000 === 0) return `${Math.trunc(amount / 10000)}만원`;
  return `${chulgoAddComma_(amount)}원`;
}

function chulgoFormatMonthDay_(date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function chulgoFormatKoreanDate_(date) {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}월/${String(date.getDate()).padStart(2, '0')}일`;
}

function chulgoAddMonths_(date, months) {
  const targetIndex = date.getMonth() + months;
  const targetYear = date.getFullYear() + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return new Date(targetYear, targetMonth, Math.min(date.getDate(), lastDay));
}

function chulgoSelectedEntry() {
  return chulgoEntries.find((x) => x.id === chulgoSelectedId) || null;
}

function chulgoUpdateActionRowState() {
  const entry = chulgoSelectedEntry();
  document.querySelectorAll('#chulgo-action-row .chulgo-mini-btn').forEach((b) => (b.disabled = !entry));
  document.getElementById('chulgo-action-hint').textContent = entry
    ? `선택됨: ${entry.name || '(이름 없음)'}`
    : '행을 클릭해서 선택하세요';
}

// --- 메모 팝업 (계약기간 / 주행거리 / 초기자금) ---
const chulgoMemoPopup = document.getElementById('chulgo-memo-popup');
const chulgoMemoText = document.getElementById('chulgo-memo-text');
let chulgoMemoEditingId = null;

function chulgoOpenMemoPopup(id) {
  const entry = chulgoEntries.find((x) => x.id === id);
  if (!entry) return;
  chulgoMemoEditingId = id;
  chulgoMemoText.value = entry.memo || '';
  chulgoMemoPopup.classList.remove('hidden');
  chulgoMemoText.focus();
}

document.getElementById('chulgo-memo-save').addEventListener('click', async () => {
  if (!chulgoMemoEditingId) return;
  const id = chulgoMemoEditingId;
  const value = chulgoMemoText.value;
  try {
    // Awaited (unlike other field edits, which fire-and-forget) so a failure — e.g. a
    // Firestore rule mismatch — surfaces as a visible alert instead of a popup that
    // quietly closes without actually having saved anything.
    await window.api.updateChulgoEntry({ id, memo: value });
  } catch (err) {
    console.error('메모 저장 실패:', err);
    alert(chulgoFriendlyError(err));
    return; // leave the popup open so the typed text isn't lost
  }
  const entry = chulgoEntries.find((x) => x.id === id);
  if (entry) entry.memo = value;
  chulgoMemoPopup.classList.add('hidden');
  renderChulgo();
});

document.getElementById('chulgo-memo-cancel').addEventListener('click', () => {
  chulgoMemoPopup.classList.add('hidden');
});

// --- 문구 결과 팝업 (복사하기) ---
const chulgoResultPopup = document.getElementById('chulgo-result-popup');
const chulgoResultTitle = document.getElementById('chulgo-result-title');
const chulgoResultText = document.getElementById('chulgo-result-text');
const chulgoResultCopied = document.getElementById('chulgo-result-copied');

function chulgoShowResult(title, message) {
  chulgoResultTitle.textContent = title;
  chulgoResultText.value = message;
  chulgoResultCopied.textContent = '';
  chulgoResultPopup.classList.remove('hidden');
}

document.getElementById('chulgo-result-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(chulgoResultText.value);
  } catch (err) {
    chulgoResultText.select();
    document.execCommand('copy');
  }
  chulgoResultCopied.textContent = '복사되었습니다.';
});

document.getElementById('chulgo-result-close').addEventListener('click', () => {
  chulgoResultPopup.classList.add('hidden');
});

// --- 문구 생성기 5종 ---
document.getElementById('chulgo-gen-report').addEventListener('click', () => {
  const e = chulgoSelectedEntry();
  if (!e) return;
  const today = new Date();
  chulgoShowResult(
    '계약보고',
    `★[고객계약정보_]★
유형 : ${e.finType || '-'}
금융사 : ${e.company || '-'}
영업담당 : ${currentUser.displayName || '-'}
고객명 : ${e.name || '-'}
DB명 : X
차종 : ${e.car || '-'}
차량가액 : ${chulgoFormatFeeForReport_(e.fee)}
계약일 : ${chulgoFormatMonthDay_(today)}
투입일 : 즉시출고
디비배정일자 :
디비유형 : ${e.dbType || '-'}`
  );
});

document.getElementById('chulgo-gen-deploy').addEventListener('click', () => {
  const e = chulgoSelectedEntry();
  if (!e) return;
  const today = new Date();
  chulgoShowResult(
    '투입보고',
    `[차량투입정보_]
유형 : ${e.finType || '-'}
금융사 : ${e.company || '-'}
영업담당 : ${currentUser.displayName || '-'}
고객명 : ${e.name || '-'}
DB명 :
차량가액 : ${chulgoFormatFeeForReport_(e.fee)}
차종 : ${e.car || '-'}
계약일 :
투입일 : ${chulgoFormatMonthDay_(today)}
디비배정일자 : X
디비유형 : ${e.dbType || '-'}`
  );
});

document.getElementById('chulgo-gen-guide').addEventListener('click', () => {
  const e = chulgoSelectedEntry();
  if (!e) return;
  const center = chulgoLookupFinanceCenter_(e.company) || { call: '-', accident: '-', succession: '-' };
  const parsed = chulgoParseMemo_(e.memo, Number(e.fee) || 0);
  chulgoShowResult(
    '계약내용 안내 문자',
    `■ ${e.name || ''} 계약조건 ■

금융사 : ${e.company || '-'}
금융 : ${e.finType || '-'}
차종 : ${e.car || '-'}
계약기간 : ${parsed.period}
연주행거리 : ${parsed.mileage}
초기자금  : ${parsed.initialFund}

☎ 고객센터 : ${center.call || '-'}
☎ 사고처리 : ${center.accident || '-'}
☎ 승계부서 : ${center.succession || '-'}

차량 출고를 진심으로 축하드립니다~
차량 사고 및 기타 차량 관련한 모든 문의는
언제든 바로 말씀 주세요 ^^

- 대표님의 담당 직원 -
■ 담당 직원 : ${currentUser.displayName || '-'}${chulgoPosition ? ` ${chulgoPosition}` : ''}
■ 연락처 : ${chulgoPhone || '-'}`
  );
});

document.getElementById('chulgo-gen-connected').addEventListener('click', () => {
  const e = chulgoSelectedEntry();
  if (!e) return;
  const brand = chulgoDetectBrand_(e.car);
  if (!brand) {
    alert(`차종 "${e.car || ''}"이(가) 제네시스/현대/기아로 판별되지 않았습니다.\n다른 브랜드 커넥티드 안내 영상 링크를 알려주시면 추가해드릴게요.`);
    return;
  }
  const guide = CHULGO_CONNECTED_GUIDE[brand];
  chulgoShowResult(
    '커넥티드 안내 문자',
    `고객님 ${guide.label} 차량
${guide.name} 가입 방법 안내드립니다 ^^

${guide.url}

영상 보시면서 천천히 진행하시면 되십니다 ~!
감사합니다 !!`
  );
});

document.getElementById('chulgo-gen-settlement').addEventListener('click', () => {
  const e = chulgoSelectedEntry();
  if (!e) return;
  const parsed = chulgoParseMemo_(e.memo, Number(e.fee) || 0);
  const monthsMatch = parsed.period.match(/(\d+)/);
  const months = monthsMatch ? Number(monthsMatch[1]) : null;
  const [y, m] = (e.month || '').split('-').map(Number);
  const startDate = y && m ? new Date(y, m - 1, 1) : new Date();
  const maturityDate = months ? chulgoAddMonths_(startDate, months) : null;

  chulgoShowResult(
    '정리문구',
    `고객명 : ${e.name || ''}
렌트/리스/일시불/할부: ${e.finType || '-'}
차종 : ${e.car || ''}
금융사 : ${e.company || 'X'}
모터스 담당자 : X
수수료 : ${chulgoWon(Number(e.fee) || 0)}
약정기간 : ${chulgoFormatKoreanDate_(startDate)}
만기시점 : ${maturityDate ? chulgoFormatKoreanDate_(maturityDate) : ''}
특이사항 : `
  );
});

function chulgoBindResizers() {
  chulgoTableWrap.querySelectorAll('.chulgo-col-resizer').forEach((handle) => {
    handle.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const key = handle.dataset.key;
      const th = handle.closest('th');
      const table = handle.closest('table');
      const colIndex = Array.from(th.parentElement.children).indexOf(th);
      const col = table.querySelector('colgroup').children[colIndex];
      const startX = ev.clientX;
      const startWidth = col.offsetWidth;
      handle.classList.add('dragging');
      function onMove(e2) {
        const newWidth = Math.max(36, startWidth + (e2.clientX - startX));
        col.style.width = newWidth + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handle.classList.remove('dragging');
        chulgoColWidths[key] = col.offsetWidth;
        localStorage.setItem(CHULGO_COLW_KEY, JSON.stringify(chulgoColWidths));
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

document.getElementById('chulgo-add-row').addEventListener('click', async () => {
  const ym = chulgoActiveMonth();
  const order = chulgoEntries.filter((x) => x.month === ym).length;
  try {
    await window.api.createChulgoEntry({ month: ym, order, finType: '렌트', status: '-', countsQuota: true });
  } catch (err) {
    console.error('출고 건 추가 실패:', err);
    alert(chulgoFriendlyError(err));
  }
});

document.getElementById('chulgo-prev-month').addEventListener('click', () => {
  chulgoMonthPicker.value = chulgoShiftMonth(chulgoMonthPicker.value, -1);
  renderChulgo();
});
document.getElementById('chulgo-next-month').addEventListener('click', () => {
  chulgoMonthPicker.value = chulgoShiftMonth(chulgoMonthPicker.value, 1);
  renderChulgo();
});
chulgoMonthPicker.addEventListener('change', () => {
  if (chulgoMonthPicker.value) renderChulgo();
});

let chulgoPositionLoaded = false;
document.getElementById('btn-chulgo').addEventListener('click', async () => {
  if (!chulgoMonthPicker.value) {
    const now = new Date();
    chulgoMonthPicker.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  }
  if (!chulgoPositionLoaded) {
    chulgoPositionLoaded = true;
    try {
      chulgoPosition = (await window.api.getChulgoPosition()) || '과장';
    } catch (err) {
      console.error('직책 불러오기 실패:', err);
    }
    chulgoPositionSelect.value = chulgoPosition;
    try {
      chulgoPhone = (await window.api.getChulgoPhone()) || '';
    } catch (err) {
      console.error('연락처 불러오기 실패:', err);
    }
    chulgoPhoneInput.value = chulgoPhone;
  }
  chulgoUpdateFormulaHint();
  renderChulgo();
  chulgoPanel.classList.remove('hidden');
});
document.getElementById('chulgo-close').addEventListener('click', () => {
  chulgoPanel.classList.add('hidden');
});

const chulgoRefreshBtn = document.getElementById('chulgo-refresh');
chulgoRefreshBtn.addEventListener('click', async () => {
  chulgoRefreshBtn.disabled = true;
  chulgoRefreshBtn.classList.add('chulgo-spin');
  try {
    // Re-runs the same sign-in path startup uses — covers the "looked signed in but
    // Firestore never actually connected after a reboot" case without a log-out/in.
    await window.api.refreshAuth();
  } catch (err) {
    console.error('새로고침 실패:', err);
  } finally {
    chulgoRefreshBtn.disabled = false;
    chulgoRefreshBtn.classList.remove('chulgo-spin');
  }
});

chulgoPositionSelect.addEventListener('change', async () => {
  chulgoPosition = chulgoPositionSelect.value;
  chulgoUpdateFormulaHint();
  renderChulgo();
  try {
    await window.api.setChulgoPosition(chulgoPosition);
  } catch (err) {
    console.error('직책 저장 실패:', err);
  }
});

chulgoPhoneInput.addEventListener('change', async () => {
  chulgoPhone = chulgoPhoneInput.value.trim();
  try {
    await window.api.setChulgoPhone(chulgoPhone);
  } catch (err) {
    console.error('연락처 저장 실패:', err);
  }
});

window.api.onChulgoUpdate((entries) => {
  const changed = !chulgoEntriesEqual(entries, chulgoEntries);
  chulgoEntries = entries;
  if (!chulgoPanel.classList.contains('hidden')) {
    // Skip the full table rebuild when nothing actually differs from what's already on screen —
    // this is what was making clicks/typing need a double-click: a Firestore round-trip echoing
    // back our own just-made edit would replace the whole <table>, stealing focus mid-interaction.
    if (changed) renderChulgo();
    else renderChulgoStats();
  } else {
    renderChulgoStats();
  }
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
