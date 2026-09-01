const calendarTitle = document.getElementById('calendar-title');
const calendarGrid = document.getElementById('calendar-grid');
const googleStatus = document.getElementById('google-status');
const memoListWrap = document.getElementById('memo-list-wrap');
const memoEmpty = document.getElementById('memo-empty');
const memoTodayLabel = document.getElementById('memo-today-label');
const memoText = document.getElementById('memo-text');
const memoSend = document.getElementById('memo-send');
const memoAlarmEnable = document.getElementById('memo-alarm-enable');
const memoAlarmTime = document.getElementById('memo-alarm-time');
document.getElementById('memo-widget-open').addEventListener('click', () => {
  window.api.openTasksWidget();
});
const configBanner = document.getElementById('config-banner');
const syncBtn = document.getElementById('sync-btn');

// 키 입력마다 표/미리보기 전체를 다시 그리던 몇몇 화면(정산 상세, 비교시트 등)이
// 타이핑할 때마다 버벅여서, 마지막 입력 후 잠깐 멈췄을 때만 실행되게 미룬다.
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth(); // 0-indexed

const holidaysCache = new Map(); // year -> [{date, name}]
let eventsByDate = new Map(); // 'YYYY-MM-DD' -> [event, ...]
let isGoogleSignedIn = false;
let isConfigured = false;
let memos = [];
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

// 여러 날짜짜리(2박3일 등) 하루종일 일정은 칸마다 따로 안 보이고 이어지는 막대로
// 그린다 — 그 자리는 eventsByDate(칸 안의 한 줄짜리 텍스트)에서 빼서 중복 표시를 막는다.
let multiDayEvents = [];

function isMultiDayAllDayEvent(ev) {
  if (!ev.allDay) return false;
  const startMs = new Date(`${ev.start}T00:00:00`).getTime();
  const endMs = new Date(`${ev.end}T00:00:00`).getTime(); // end는 구글 규칙상 다음날(제외)
  return (endMs - startMs) / 86400000 >= 2;
}

async function loadGoogleEventsForGrid(gridStart) {
  if (!isGoogleSignedIn) {
    eventsByDate = new Map();
    multiDayEvents = [];
    return;
  }

  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 42);

  // Build into a local map and swap it in atomically at the end — if two calls
  // race (e.g. one from init() and one from the auth:updated push), reassigning
  // the shared `eventsByDate` mid-fetch used to make both calls' events land in
  // the same map, duplicating every entry.
  const map = new Map();
  const multiDay = [];
  try {
    const events = await window.api.googleGetEvents(gridStart.toISOString(), gridEnd.toISOString());
    events.forEach((ev) => {
      if (isMultiDayAllDayEvent(ev)) {
        multiDay.push(ev);
        return;
      }
      const d = ev.start.slice(0, 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(ev);
    });
    eventsByDate = map;
    multiDayEvents = multiDay;
  } catch (err) {
    console.error('구글 캘린더 이벤트 로드 실패:', err);
    eventsByDate = map;
    multiDayEvents = multiDay;
  }
}

let currentHolidayMap = new Map();
let currentGridStart = null;

const MAX_EVENT_LINES = 4;

// 날짜를 클릭할 때마다 42칸을 통째로 새로 그리면(특히 여러 번 빠르게 누를 때) 버벅이면서
// 다른 입력칸(메모/AI 채팅) 타이핑까지 같이 씹히는 느낌이 났다 — 선택된 날짜 표시(.selected
// 클래스)만 옮겨 붙이면 되는 경우엔 이 가벼운 함수를 쓴다.
function updateSelectedDayCell() {
  calendarGrid.querySelectorAll('.day-cell.selected').forEach((cell) => cell.classList.remove('selected'));
  if (!selectedDateStr) return;
  calendarGrid.querySelectorAll('.day-cell').forEach((cell) => {
    if (cell.dataset.date === selectedDateStr) cell.classList.add('selected');
  });
}

const EVENT_BANNER_HEIGHT = 14;
const EVENT_BANNER_GAP = 2;
const EVENT_BANNER_TOP_OFFSET = 16; // 날짜 숫자 아래부터 시작

// 42칸(6주)을 한 주씩 훑으며, 그 주에 걸쳐있는 여러 날짜짜리 일정들을 서로 안 겹치게
// 줄(track)에 배정한다 — 흔한 달력 UI의 구간 스케줄링(interval scheduling) 방식과 같다.
// 주가 바뀔 때마다 새로 배정하므로, 같은 일정이라도 주마다 다른 줄에 놓일 수 있다
// (그래도 막대 자체는 끊김 없이 이어져 보인다 — 줄 번호가 화면에 드러나지 않으므로).
function computeWeekBanners(gridStartDate, events) {
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const weekStart = new Date(gridStartDate);
    weekStart.setDate(gridStartDate.getDate() + w * 7);
    const weekStartStr = toDateStr(weekStart);
    const weekEndStr = addDaysStr(weekStartStr, 6); // 이 주의 마지막(토요일), inclusive

    const overlapping = events
      .map((ev) => {
        const lastDayStr = addDaysStr(ev.end.slice(0, 10), -1); // end는 exclusive라 하루 빼서 실제 마지막날
        const clipStart = ev.start.slice(0, 10) < weekStartStr ? weekStartStr : ev.start.slice(0, 10);
        const clipEnd = lastDayStr > weekEndStr ? weekEndStr : lastDayStr;
        if (clipStart > clipEnd) return null; // 이 주와 안 겹침
        const startCol = Math.round((new Date(`${clipStart}T00:00:00`) - weekStart) / 86400000);
        const endCol = Math.round((new Date(`${clipEnd}T00:00:00`) - weekStart) / 86400000);
        return {
          event: ev,
          startCol,
          endCol,
          isFirstDayOverall: clipStart === ev.start.slice(0, 10),
          isLastDayOverall: clipEnd === lastDayStr,
        };
      })
      .filter(Boolean)
      // 긴 일정이 먼저 자리를 잡아야 짧은 일정들이 그 밑으로 자연스럽게 채워진다.
      .sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol));

    const trackLastCol = []; // trackLastCol[i] = 그 줄에서 마지막으로 쓴 endCol
    overlapping.forEach((seg) => {
      let track = trackLastCol.findIndex((lastCol) => lastCol < seg.startCol);
      if (track === -1) {
        track = trackLastCol.length;
      }
      trackLastCol[track] = seg.endCol;
      seg.track = track;
    });

    weeks.push({ segments: overlapping, trackCount: trackLastCol.length });
  }
  return weeks;
}

function buildCalendarGrid() {
  const todayStr = toDateStr(today);
  calendarGrid.innerHTML = '';
  const weekBanners = computeWeekBanners(currentGridStart, multiDayEvents);

  for (let i = 0; i < 42; i += 1) {
    const cellDate = new Date(currentGridStart);
    cellDate.setDate(currentGridStart.getDate() + i);
    const dateStr = toDateStr(cellDate);
    const dow = cellDate.getDay();
    const weekIndex = Math.floor(i / 7);
    const dayIndexInWeek = i % 7;
    const week = weekBanners[weekIndex];

    const cell = document.createElement('div');
    cell.className = 'day-cell';
    cell.dataset.date = dateStr;
    if (cellDate.getMonth() !== viewMonth) cell.classList.add('other-month');
    if (dateStr === todayStr) cell.classList.add('today');
    if (dateStr === selectedDateStr) cell.classList.add('selected');
    if (dow === 0) cell.classList.add('sunday');
    if (dow === 6) cell.classList.add('saturday');
    const holidayName = currentHolidayMap.get(dateStr);
    if (holidayName) cell.classList.add('holiday');
    // 이 주에 여러 날짜짜리 막대가 있으면, 그 줄 수만큼 위쪽에 자리를 비워둔다 —
    // 한 주 안의 7칸이 전부 같은 만큼 비워야 날짜 숫자 줄이 가지런히 맞는다.
    if (week.trackCount > 0) {
      cell.style.paddingTop = `${EVENT_BANNER_TOP_OFFSET + week.trackCount * (EVENT_BANNER_HEIGHT + EVENT_BANNER_GAP)}px`;
    }

    // 날짜 숫자 + (있으면) 공휴일 이름을 한 줄에 같이 보여준다 — 예전엔 title
    // 툴팁으로 숨겨져 있어서 마우스를 올려야만 "왜 빨간날인지" 알 수 있었다.
    const topRow = document.createElement('div');
    topRow.className = 'day-cell-top-row';
    const num = document.createElement('span');
    num.className = 'day-num';
    num.textContent = cellDate.getDate();
    topRow.appendChild(num);
    if (holidayName) {
      const label = document.createElement('span');
      label.className = 'holiday-name';
      label.textContent = holidayName;
      label.title = holidayName;
      topRow.appendChild(label);
    }
    cell.appendChild(topRow);

    week.segments
      .filter((seg) => seg.startCol <= dayIndexInWeek && dayIndexInWeek <= seg.endCol)
      .forEach((seg) => {
        const bar = document.createElement('div');
        bar.className = 'event-banner-segment';
        bar.title = seg.event.title;
        const color = EVENT_COLOR_BY_ID.get(seg.event.colorId);
        bar.style.background = color ? color.hex : 'var(--color-event-bg)';
        bar.style.color = color ? '#3a3a3a' : 'var(--color-event-text)';
        bar.style.top = `${EVENT_BANNER_TOP_OFFSET + seg.track * (EVENT_BANNER_HEIGHT + EVENT_BANNER_GAP)}px`;
        // 이어지는 것처럼 보이려면, 실제 시작/끝인 쪽만 둥글고 안쪽 여백을 주고
        // 나머지 이어지는 쪽은 칸 끝까지 꽉 채운다(day-cell이 overflow:hidden 이라
        // 칸 밖으로 삐져나가게 하면 잘려서, 대신 칸 사이 gap 만큼만 자연스러운 틈이 남는다).
        const atSegStart = dayIndexInWeek === seg.startCol;
        const atSegEnd = dayIndexInWeek === seg.endCol;
        bar.style.left = atSegStart ? '2px' : '0';
        bar.style.right = atSegEnd ? '2px' : '0';
        bar.style.borderTopLeftRadius = atSegStart && seg.isFirstDayOverall ? '4px' : '0';
        bar.style.borderBottomLeftRadius = atSegStart && seg.isFirstDayOverall ? '4px' : '0';
        bar.style.borderTopRightRadius = atSegEnd && seg.isLastDayOverall ? '4px' : '0';
        bar.style.borderBottomRightRadius = atSegEnd && seg.isLastDayOverall ? '4px' : '0';
        if (atSegStart) bar.textContent = seg.event.title; // 제목은 막대 시작 칸에서만
        cell.appendChild(bar);
      });

    const dayEvents = eventsByDate.get(dateStr) || [];
    if (dayEvents.length > 0) {
      cell.classList.add('has-events');
      dayEvents.slice(0, MAX_EVENT_LINES).forEach((ev) => {
        const line = document.createElement('span');
        line.className = 'event-line';
        line.textContent = ev.title;
        const color = EVENT_COLOR_BY_ID.get(ev.colorId);
        if (color) {
          line.style.background = color.hex;
          line.style.borderColor = color.hex;
          line.style.color = '#3a3a3a';
        }
        cell.appendChild(line);
      });
      if (dayEvents.length > MAX_EVENT_LINES) {
        const more = document.createElement('span');
        more.className = 'event-more';
        more.textContent = `+${dayEvents.length - MAX_EVENT_LINES}개`;
        cell.appendChild(more);
      }
    }

    cell.onclick = () => {
      // 캘린더만 보기에서 떠 있는 패널이 이미 이 날짜로 열려 있으면, 같은 칸을
      // 다시 눌렀을 때 X를 안 눌러도 그냥 닫히게(토글) 한다.
      if (
        calendarRow.classList.contains('calendar-only')
        && dayPanel.classList.contains('floating')
        && selectedDateStr === dateStr
      ) {
        document.getElementById('day-panel-close').click();
        return;
      }
      openDayPanel(dateStr);
      if (calendarRow.classList.contains('calendar-only')) dayPanel.classList.add('floating');
    };

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
  memoText.disabled = !enabled;
  memoSend.disabled = !enabled;
  memoText.placeholder = enabled ? '메모를 입력하세요...' : '구글 로그인 후 메모를 작성할 수 있어요';
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
      renderMemos();
      renderCalendar();
    };
    googleStatus.appendChild(label);
    googleStatus.appendChild(btn);
  } else {
    label.textContent = '구글 로그인이 필요합니다 (캘린더 + 메모)';
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
        renderMemos();
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Things/Todoist/MS 투두 같은 유명 할 일 앱들 공통 패턴을 따른다:
//  - 체크박스 = 바로 완료(선택 모드 없이 원터치) — 표 형태일 땐 체크박스가 "선택용"이라
//    직관적이지 않았다. 완료된 건 밑에 접히는 "완료됨" 칸으로 모아서 눈에서 치운다.
//  - 목록은 날짜로 나눠 섹션으로 보여준다(기한 지남/오늘/내일/이번 주/나중/날짜 없음) —
//    표 한 줄 한 줄보다 스캔하기 훨씬 편하다. 삭제는 마우스를 올렸을 때만 나오는 작은
//    버튼으로(항상 보이면 산만하다), 수정은 글자를 클릭하면 그 자리에서 바로 된다.
function memoSortedAll() {
  return [...memos].sort((a, b) => {
    if (!a.due && !b.due) return 0;
    if (!a.due) return -1;
    if (!b.due) return 1;
    return new Date(a.due) - new Date(b.due);
  });
}

const MEMO_WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
function memoDateLabel(dueIso) {
  if (!dueIso) return '';
  const d = new Date(dueIso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}(${MEMO_WEEKDAY[d.getDay()]})`;
}

function memoBucketOf(dueIso) {
  if (!dueIso) return 'noDate';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dueIso);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / 86400000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays <= 7) return 'week';
  return 'later';
}

const MEMO_BUCKETS = [
  { key: 'overdue', label: '⚠ 기한 지남' },
  { key: 'today', label: '오늘' },
  { key: 'tomorrow', label: '내일' },
  { key: 'week', label: '이번 주' },
  { key: 'later', label: '나중' },
  { key: 'noDate', label: '날짜 없음' },
];

const MEMO_DONE_EXPANDED_KEY = 'memo_done_expanded_v1';
let memoDoneExpanded = localStorage.getItem(MEMO_DONE_EXPANDED_KEY) === '1';

function memoBuildRow(m) {
  const row = document.createElement('div');
  row.className = 'memo-row' + (m.done ? ' done' : '');
  row.dataset.id = m.id;

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'memo-row-check';
  check.checked = !!m.done;
  check.title = m.done ? '완료 취소' : '완료 표시';
  check.onchange = () => {
    const nextDone = check.checked;
    window.api.updateMemo({ id: m.id, done: nextDone }).catch((err) => {
      console.error('메모 완료 처리 실패:', err);
      showToast(chulgoFriendlyError(err));
      check.checked = !nextDone; // 실패하면 원상복구(성공하면 onMemosUpdate가 다시 그려준다)
    });
  };
  row.appendChild(check);

  const body = document.createElement('div');
  body.className = 'memo-row-body';

  const text = document.createElement('div');
  text.className = 'memo-row-text';
  text.textContent = m.text;
  text.title = '클릭해서 수정';
  text.onclick = () => startEditMemo(text, m);
  body.appendChild(text);

  if (m.alarmTime || m.due) {
    const meta = document.createElement('div');
    meta.className = 'memo-row-meta';
    meta.textContent = m.alarmTime ? `⏰ ${m.alarmTime}` : memoDateLabel(m.due);
    body.appendChild(meta);
  }

  row.appendChild(body);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'memo-row-delete';
  delBtn.textContent = '×';
  delBtn.title = '삭제';
  delBtn.onclick = async (ev) => {
    ev.stopPropagation();
    if (!confirm('이 메모를 삭제할까요?')) return;
    try {
      await window.api.deleteMemo(m.id);
    } catch (err) {
      console.error('메모 삭제 실패:', err);
      showToast('삭제에 실패했습니다.');
    }
  };
  row.appendChild(delBtn);

  return row;
}

function memoBuildSection(label, items, extraClass) {
  const section = document.createElement('div');
  section.className = 'memo-section' + (extraClass ? ` ${extraClass}` : '');

  const header = document.createElement('div');
  header.className = 'memo-section-header';
  header.textContent = `${label} · ${items.length}`;
  section.appendChild(header);

  items.forEach((m) => section.appendChild(memoBuildRow(m)));
  return section;
}

function renderMemos() {
  const sorted = memoSortedAll();
  memoTodayLabel.textContent = `전체 ${sorted.length}건`;
  memoEmpty.style.display = sorted.length ? 'none' : 'block';

  const active = sorted.filter((m) => !m.done);
  const done = sorted.filter((m) => m.done);

  memoListWrap.innerHTML = '';

  MEMO_BUCKETS.forEach(({ key, label }) => {
    const items = active.filter((m) => memoBucketOf(m.due) === key);
    if (items.length) memoListWrap.appendChild(memoBuildSection(label, items, key === 'overdue' ? 'memo-section-overdue' : ''));
  });

  if (done.length) {
    const doneSection = document.createElement('div');
    doneSection.className = 'memo-section memo-done-section';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'memo-done-toggle';
    toggle.innerHTML = `<span class="memo-done-chevron">${memoDoneExpanded ? '▾' : '▸'}</span> 완료됨 · ${done.length}`;
    toggle.onclick = () => {
      memoDoneExpanded = !memoDoneExpanded;
      localStorage.setItem(MEMO_DONE_EXPANDED_KEY, memoDoneExpanded ? '1' : '0');
      renderMemos();
    };
    doneSection.appendChild(toggle);

    if (memoDoneExpanded) {
      done.forEach((m) => doneSection.appendChild(memoBuildRow(m)));
    }
    memoListWrap.appendChild(doneSection);
  }
}

function startEditMemo(cellEl, memo) {
  if (cellEl.querySelector('input')) return; // 이미 편집 중

  const original = cellEl.textContent;
  cellEl.textContent = '';
  cellEl.onclick = null;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = memo.text;
  input.maxLength = 500;
  input.className = 'memo-edit-input';

  const finish = () => {
    cellEl.textContent = original;
    cellEl.onclick = () => startEditMemo(cellEl, memo);
  };

  const save = async () => {
    const newText = input.value.trim();
    if (!newText || newText === memo.text) { finish(); return; }
    try {
      await window.api.updateMemo({ id: memo.id, text: newText }); // 성공하면 onMemosUpdate가 다시 그려준다
    } catch (err) {
      console.error('메모 수정 실패:', err);
      showToast('수정에 실패했습니다.');
      finish();
    }
  };

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') save();
    if (ev.key === 'Escape') finish();
  });
  input.addEventListener('blur', save);

  cellEl.appendChild(input);
  input.focus();
  input.select();
}

async function sendMemo() {
  const text = memoText.value.trim();
  if (!text) return;

  const data = { text };
  if (memoAlarmEnable.checked && memoAlarmTime.value) {
    const [h, m] = memoAlarmTime.value.split(':').map(Number);
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1); // 이미 지난 시각이면 내일 그 시각으로
    data.remindAt = target.getTime();
  }

  memoSend.disabled = true;
  try {
    await window.api.createMemo(data);
    memoText.value = '';
    memoAlarmEnable.checked = false;
    memoAlarmTime.value = '';
    memoAlarmTime.classList.add('hidden');
  } catch (err) {
    console.error('메모 등록 실패:', err);
    showToast(chulgoFriendlyError(err));
  } finally {
    memoSend.disabled = false;
    memoText.focus();
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

// 일정 색상 — id는 구글 캘린더의 표준 colorId(1~11) 그대로 써서 실제 구글 캘린더
// 앱/웹에서도 같은 일정으로 정상 동기화되고, hex는 이 앱 화면에서만 쓰는 파스텔
// 톤으로 따로 둔다(구글 원래 색보다 부드럽게 보이도록 — 동기화 값과 화면 표시를 분리).
const EVENT_COLORS = [
  { id: '1', name: '라벤더', hex: '#C9C5F5' },
  { id: '2', name: '세이지', hex: '#B8E0C8' },
  { id: '3', name: '포도', hex: '#D9BFEA' },
  { id: '4', name: '플라밍고', hex: '#F5C6C0' },
  { id: '5', name: '바나나', hex: '#F5E1A0' },
  { id: '6', name: '귤', hex: '#F5C99B' },
  { id: '7', name: '공작', hex: '#A8D8E8' },
  { id: '8', name: '그래파이트', hex: '#D9D9D6' },
  { id: '9', name: '블루베리', hex: '#B8C4EE' },
  { id: '10', name: '바질', hex: '#A8D5B5' },
  { id: '11', name: '토마토', hex: '#F0B8B8' },
];
const EVENT_COLOR_BY_ID = new Map(EVENT_COLORS.map((c) => [c.id, c]));

let selectedEventColorId = null;
const eventColorSwatchesEl = document.getElementById('event-color-swatches');
const eventColorRowEl = document.getElementById('event-color-row');

function renderEventColorSwatches() {
  eventColorSwatchesEl.innerHTML = '';
  EVENT_COLORS.forEach((c) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'event-color-swatch' + (c.id === selectedEventColorId ? ' selected' : '');
    btn.style.background = c.hex;
    btn.title = c.name;
    btn.onclick = () => {
      selectedEventColorId = selectedEventColorId === c.id ? null : c.id; // 다시 누르면 선택 해제
      renderEventColorSwatches();
    };
    eventColorSwatchesEl.appendChild(btn);
  });
}
renderEventColorSwatches();

// 캘린더만 보기 — 메모장/일정 패널을 숨기고 달력을 넓게 쓴다. 날짜를 클릭하면
// 패널을 다시 옆에 고정으로 붙이는 대신 달력 위에 뜨는 카드로 잠깐만 보여준다.
const CALENDAR_ONLY_KEY = 'calendar_only_mode_v1';
const calendarRow = document.querySelector('.calendar-row');
const calendarOnlyToggleBtn = document.getElementById('calendar-only-toggle');

function setCalendarOnly(on) {
  calendarRow.classList.toggle('calendar-only', on);
  calendarOnlyToggleBtn.classList.toggle('active', on);
  calendarOnlyToggleBtn.title = on ? '전체 보기로 돌아가기' : '캘린더만 보기 (메모장/일정 패널 숨기기)';
  localStorage.setItem(CALENDAR_ONLY_KEY, on ? '1' : '0');
  if (!on) dayPanel.classList.remove('floating');
}

calendarOnlyToggleBtn.addEventListener('click', () => {
  setCalendarOnly(!calendarRow.classList.contains('calendar-only'));
});

setCalendarOnly(localStorage.getItem(CALENDAR_ONLY_KEY) === '1');

// 떠 있는 패널 밖(날짜 칸이 아닌 곳)을 클릭하면 X 안 눌러도 자동으로 닫는다.
// 날짜 칸 클릭은 위 cell.onclick 이 이미 열기/토글을 따로 처리하므로 여기서는 빼준다.
document.addEventListener('click', (e) => {
  if (!calendarRow.classList.contains('calendar-only')) return;
  if (!dayPanel.classList.contains('floating')) return;
  if (dayPanel.contains(e.target)) return;
  if (e.target.closest('.day-cell')) return;
  document.getElementById('day-panel-close').click();
});

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
    const color = EVENT_COLOR_BY_ID.get(ev.colorId);
    if (color) item.style.borderLeft = `4px solid ${color.hex}`;

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
          showToast(chulgoFriendlyError(err));
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

  selectedEventColorId = (ev && ev.colorId) || null;
  renderEventColorSwatches();
  // 팀 일정은 서버에서 항상 고정 색으로 덮어써서, 여기서 골라도 조용히 무시된다 —
  // 헷갈리지 않게 그 경우엔 선택기 자체를 숨긴다.
  eventColorRowEl.classList.toggle('hidden', Boolean(ev && ev.teamEventId));

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

// 새 일정 작성 중 "팀 일정으로 업로드"를 체크하면, 그 순간부터도 색 선택은
// 어차피 무시될 것이므로 미리 숨긴다(저장 눌러야만 알게 되는 것보다 낫다).
eventTeamShareCheckbox.addEventListener('change', () => {
  eventColorRowEl.classList.toggle('hidden', eventTeamShareCheckbox.checked);
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
      await window.api.googleUpdateEvent({ eventId: editingEventId, summary, start, end, colorId: selectedEventColorId });
    } else if (asTeamEvent) {
      await window.api.createTeamEvent({ title: summary, start, end, allDay: eventAlldayCheckbox.checked });
    } else {
      await window.api.googleCreateEvent({ summary, start, end, colorId: selectedEventColorId });
    }
    hideEventForm();
    await refreshEventsAndDayPanel();
  } catch (err) {
    console.error('일정 저장 실패:', err);
    showToast(chulgoFriendlyError(err));
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

  updateSelectedDayCell();
}

document.getElementById('day-panel-close').onclick = () => {
  selectedDateStr = null;
  hideEventForm();
  eventAddBtn.classList.add('hidden');
  dayPanelTitle.textContent = '날짜를 선택하세요';
  dayEventList.innerHTML = '<div class="day-event-empty">날짜를 클릭하면 일정이 여기에 표시됩니다.</div>';
  updateSelectedDayCell();
  dayPanel.classList.remove('floating');
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

memoSend.onclick = sendMemo;
memoText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMemo();
});
memoAlarmEnable.addEventListener('change', () => {
  memoAlarmTime.classList.toggle('hidden', !memoAlarmEnable.checked);
  if (memoAlarmEnable.checked && !memoAlarmTime.value) {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5); // 편의상 지금부터 5분 뒤를 기본값으로
    memoAlarmTime.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
});

// --- AI 어시스턴트 (자유 대화 + 필요하면 실제로 메모/개인 일정 추가) ---
// 팀 전체에 보이는 팀 일정은 여기서 안 만든다 — 도구(tool)로는 본인 메모/본인 개인(구글)
// 일정 생성만 준다. AI가 실수해도 다른 사람 화면까지 영향 가지 않게 하기 위함.
const aiChatMessages = document.getElementById('ai-chat-messages');
const aiChatInput = document.getElementById('ai-chat-input');
const aiChatSend = document.getElementById('ai-chat-send');
let aiChatHistory = []; // OpenAI에 그대로 보내는 대화 기록 — {role, content, tool_calls?, tool_call_id?}

// 대화가 길어질수록 매 턴 전체 기록을 다시 보내는 비용(전송량 + OpenAI 처리량)이 계속
// 커진다 — user 메시지 경계를 기준으로 최근 N턴만 남기고 잘라낸다. assistant의
// tool_calls는 바로 뒤따르는 tool 응답과 반드시 붙어 있어야 하므로(안 그러면 API가
// 에러를 낸다), 턴 중간이 아니라 user 메시지가 시작되는 지점에서만 자른다.
const AI_CHAT_MAX_TURNS = 12;
function aiChatTrimHistory() {
  const userIdxs = [];
  aiChatHistory.forEach((m, i) => { if (m.role === 'user') userIdxs.push(i); });
  if (userIdxs.length <= AI_CHAT_MAX_TURNS) return;
  aiChatHistory = aiChatHistory.slice(userIdxs[userIdxs.length - AI_CHAT_MAX_TURNS]);
}

function addHourToTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  d.setHours(d.getHours() + 1);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function aiChatAppendBubble(role, text) {
  const empty = aiChatMessages.querySelector('.ai-chat-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = `ai-chat-msg ${role}`;
  div.textContent = text;
  aiChatMessages.appendChild(div);
  aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
  return div;
}

// 실제로 Firestore/구글 캘린더에 쓰는 건 항상 여기(렌더러)에서만 한다 — main 프로세스는
// OpenAI 호출만 하고 앱 데이터에 직접 손대지 않는다.
// 검색 결과를 채팅창에 "클릭하면 열리는 목록"으로 붙인다. AI 가 경로를 글로 늘어놓는
// 것보다, 사용자가 눈으로 보고 직접 고르는 게 안전하고 빠르다.
function aiChatAppendFileResults(keyword, results, total) {
  const empty = aiChatMessages.querySelector('.ai-chat-empty');
  if (empty) empty.remove();

  const box = document.createElement('div');
  box.className = 'ai-file-results';

  const head = document.createElement('div');
  head.className = 'ai-file-results-head';
  head.textContent = `🔎 "${keyword}" 검색 결과 ${total}건`
    + (total > results.length ? ` (아래 ${results.length}건 표시)` : '');
  box.appendChild(head);

  results.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'ai-file-row';

    const openBtn = document.createElement('button');
    openBtn.className = 'ai-file-open';
    openBtn.title = r.path;
    openBtn.innerHTML = `<span class="ai-file-icon">${r.isDir ? '📁' : '📄'}</span>`
      + `<span class="ai-file-name"></span>`
      + `<span class="ai-file-dir"></span>`;
    openBtn.querySelector('.ai-file-name').textContent = r.name;
    openBtn.querySelector('.ai-file-dir').textContent = r.dir || '';
    openBtn.addEventListener('click', async () => {
      try {
        await window.api.openFile({ target: r.path });
      } catch (err) {
        console.error('파일 열기 실패:', err);
        showToast(`열 수 없습니다: ${err.message || err}`);
      }
    });

    const revealBtn = document.createElement('button');
    revealBtn.className = 'ai-file-reveal';
    revealBtn.textContent = '폴더';
    revealBtn.title = '이 파일이 있는 폴더 열기';
    revealBtn.addEventListener('click', async () => {
      try {
        await window.api.revealFile({ target: r.path });
      } catch (err) {
        console.error('폴더 열기 실패:', err);
        showToast(`폴더를 열 수 없습니다: ${err.message || err}`);
      }
    });

    row.appendChild(openBtn);
    row.appendChild(revealBtn);
    box.appendChild(row);
  });

  aiChatMessages.appendChild(box);
  aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
}

async function aiChatRunTool(name, args) {
  if (name === 'search_files') {
    const keyword = (args.keyword || '').trim();
    if (!keyword) return '검색어가 없어서 찾지 못했습니다.';
    const { results, total } = await window.api.searchFiles({ keyword, limit: 20 });
    if (!total) return `"${keyword}" 로 찾은 파일이 없습니다.`;
    aiChatAppendFileResults(keyword, results, total);
    // AI 에게는 요약만 돌려준다 — 목록은 이미 화면에 그렸고, 경로 전체를 다시
    // 말하게 하면 답변만 길어지고 토큰도 낭비된다.
    const preview = results.slice(0, 5).map((r) => r.name).join(', ');
    return `"${keyword}" 로 ${total}건 찾았고 목록을 사용자 화면에 표시했다. `
      + `상위 항목: ${preview}. 사용자가 목록에서 눌러 열 수 있으니 짧게만 안내할 것.`;
  }
  if (name === 'open_web_search') {
    const query = (args.query || '').trim();
    if (!query) return '검색어가 없어서 열지 못했습니다.';
    const engine = ['naver', 'google', 'youtube'].includes(args.engine) ? args.engine : 'naver';
    await window.api.openWebSearch({ query, engine });
    const label = { naver: '네이버', google: '구글', youtube: '유튜브' }[engine];
    return `🌐 ${label}에서 "${query}" 검색 결과를 브라우저로 열었다. `
      + '이 도구는 페이지를 열 뿐 내용을 읽지 못하므로, 결과 내용을 아는 것처럼 말하지 말고 열었다고만 안내할 것.';
  }
  if (name === 'create_memo') {
    await window.api.createMemo({ text: args.text || '' });
    return `📝 메모 추가함: ${args.text || ''}`;
  }
  if (name === 'create_personal_event') {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let start, end;
    if (args.allDay || !args.startTime) {
      start = { date: args.date };
      end = { date: addDaysStr(args.date, 1) };
    } else {
      const endTime = args.endTime || addHourToTime(args.startTime);
      start = { dateTime: `${args.date}T${args.startTime}:00`, timeZone };
      end = { dateTime: `${args.date}T${endTime}:00`, timeZone };
    }
    await window.api.googleCreateEvent({ summary: args.title || '(제목 없음)', start, end });
    await refreshEventsAndDayPanel();
    return `📅 일정 추가함: ${args.title || ''} (${args.date}${args.allDay ? '' : ' ' + (args.startTime || '')})`;
  }
  return '알 수 없는 동작이라 실행하지 않았습니다.';
}

async function aiChatSendMessage() {
  const text = aiChatInput.value.trim();
  if (!text) return;

  aiChatAppendBubble('user', text);
  aiChatHistory.push({ role: 'user', content: text });
  aiChatTrimHistory();
  aiChatInput.value = '';
  aiChatInput.disabled = true;
  aiChatSend.disabled = true;

  const thinkingBubble = aiChatAppendBubble('assistant', '...');

  try {
    let response = await window.api.aiChat({ messages: aiChatHistory, today: toDateStr(new Date()) });

    // 모델이 도구를 쓰겠다고 하면 실제로 실행하고, 그 결과를 다시 보내서 최종 답변을 받는다.
    while (response.toolCalls && response.toolCalls.length) {
      aiChatHistory.push({ role: 'assistant', content: response.content || '', tool_calls: response.toolCalls });
      for (const call of response.toolCalls) {
        let args = {};
        try {
          args = JSON.parse(call.arguments || '{}');
        } catch (parseErr) {
          console.error('AI 도구 인자 파싱 실패:', parseErr);
        }
        let resultText;
        try {
          resultText = await aiChatRunTool(call.name, args);
        } catch (err) {
          console.error('AI 도구 실행 실패:', err);
          resultText = `실패: ${err.message || err}`;
        }
        thinkingBubble.className = 'ai-chat-msg system-action';
        thinkingBubble.textContent = resultText;
        aiChatHistory.push({ role: 'tool', tool_call_id: call.id, content: resultText });
      }
      response = await window.api.aiChat({ messages: aiChatHistory, today: toDateStr(new Date()) });
    }

    aiChatHistory.push({ role: 'assistant', content: response.content || '' });
    if (thinkingBubble.classList.contains('system-action')) {
      aiChatAppendBubble('assistant', response.content || '(응답 없음)');
    } else {
      thinkingBubble.textContent = response.content || '(응답 없음)';
    }
  } catch (err) {
    console.error('AI 대화 실패:', err);
    thinkingBubble.className = 'ai-chat-msg error';
    thinkingBubble.textContent = (err.message || '').includes('OPENAI_NOT_CONFIGURED')
      ? 'OpenAI API 키가 아직 설정되지 않았습니다. config/config.json의 openai.apiKey를 채워주세요.'
      : `오류: ${err.message || '알 수 없는 오류'}`;
  } finally {
    aiChatInput.disabled = false;
    aiChatSend.disabled = false;
    // AI 응답은 수십 초 뒤에 올 수도 있다. 그 사이 사용자가 장부나 메모에 타이핑을
    // 시작했는데 여기서 무조건 focus() 를 하면 커서를 뺏어가서 "입력이 튄다".
    // 다른 곳에 입력 중이 아닐 때만 되돌려준다.
    const active = document.activeElement;
    const typingElsewhere = active && active !== aiChatInput
      && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
    if (!typingElsewhere) aiChatInput.focus();
  }
}

aiChatSend.addEventListener('click', aiChatSendMessage);
aiChatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    aiChatSendMessage();
  }
});

// 대화가 쌓이면 맥락이 길어져서 엉뚱한 답이 나오기 쉽다 — 새로 시작하고 싶을 때 누르는 버튼.
// (참고로 프로그램을 껐다 켜면 어차피 대화 기록은 메모리에만 있어서 자동으로 비워진다.)
document.getElementById('ai-chat-reset').addEventListener('click', () => {
  aiChatHistory = [];
  aiChatMessages.innerHTML = '<div class="ai-chat-empty">뭐든 편하게 물어보세요. "내일 3시 미팅 캘린더에 추가해줘"처럼 말하면 실제로 추가도 해드려요.</div>';
});

// 일정/AI 패널 폭을 드래그로 조절 — 장부 표 칸 너비 조절과 같은 방식, 다음에 켜도 기억한다.
const DAY_PANEL_WIDTH_KEY = 'day_panel_width_v1';
{
  const savedWidth = Number(localStorage.getItem(DAY_PANEL_WIDTH_KEY));
  if (savedWidth) dayPanel.style.width = `${savedWidth}px`;
}
document.getElementById('day-panel-resizer').addEventListener('mousedown', (ev) => {
  ev.preventDefault();
  const handle = ev.currentTarget;
  const startX = ev.clientX;
  const startWidth = dayPanel.offsetWidth;
  handle.classList.add('dragging');
  function onMove(e2) {
    // 왼쪽 가장자리를 끄는 거라, 왼쪽으로 끌면(음수 방향) 패널이 넓어진다.
    const newWidth = Math.max(220, Math.min(600, startWidth - (e2.clientX - startX)));
    dayPanel.style.width = `${newWidth}px`;
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    handle.classList.remove('dragging');
    localStorage.setItem(DAY_PANEL_WIDTH_KEY, String(dayPanel.offsetWidth));
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

document.getElementById('btn-minimize').onclick = () => window.api.minimizeWindow();
document.getElementById('btn-close').onclick = () => window.api.closeWindow();

// 제목표시줄 버전 배지 — 평소엔 "v0.22.0"처럼 현재 버전만 보여주다가, 새 버전이 있으면
// 상태에 맞춰 라벨이 바뀌고 눌러서 그 자리에서 바로 진행할 수 있다(재시작은 필요하지만
// 창을 직접 닫았다 켤 필요 없이 배지 클릭 한 번으로 끝난다).
(async () => {
  const badge = document.getElementById('app-version-badge');
  if (!badge) return;

  const version = await window.api.getAppVersion();
  let currentStatus = { state: 'idle' };

  function render() {
    badge.disabled = false;
    switch (currentStatus.state) {
      case 'checking':
        badge.textContent = `v${version} · 확인 중`;
        badge.disabled = true;
        badge.title = '업데이트 확인 중...';
        break;
      case 'available':
        badge.textContent = `⬇ 새 버전 ${currentStatus.version || ''}`;
        badge.title = '눌러서 새 버전 받기';
        break;
      case 'downloading':
        badge.textContent = `⬇ 받는 중 ${currentStatus.percent || 0}%`;
        badge.disabled = true;
        badge.title = '업데이트 다운로드 중...';
        break;
      case 'downloaded':
        badge.textContent = '🔄 새로고침으로 업데이트';
        badge.title = '눌러서 지금 업데이트 적용 (앱이 자동으로 재시작됩니다)';
        break;
      default:
        badge.textContent = `v${version}`;
        badge.title = '클릭해서 업데이트 확인';
    }
    badge.classList.toggle('has-update', currentStatus.state === 'available' || currentStatus.state === 'downloaded');
  }

  currentStatus = await window.api.getUpdateStatus();
  render();
  window.api.onUpdateStatus((status) => {
    currentStatus = status;
    render();
  });

  badge.addEventListener('click', async () => {
    if (currentStatus.state === 'downloaded') {
      await window.api.installUpdate();
      return;
    }
    if (currentStatus.state === 'available') {
      await window.api.downloadUpdate();
      return;
    }
    if (currentStatus.state === 'checking' || currentStatus.state === 'downloading') return;

    const result = await window.api.checkForUpdates();
    if (result && result.reason === 'dev') {
      showToast('개발 모드에서는 업데이트를 확인하지 않습니다.');
    }
  });
})();

// 제목표시줄 바로가기 — 목록은 main 프로세스가 갖고 있고(신뢰 가능한 고정 목록), 여기선
// id로만 열어달라고 요청한다. "본부시트"는 로그인한 계정의 소속에 따라 다르게 뜨는데,
// 앱이 막 켜졌을 때는 소속 정보(Firestore 조회)가 아직 안 온 상태라 처음엔 그 버튼이
// 빠진 채로 뜬다 — 소속 정보가 나중에 도착하면(org:my-info-update) 다시 그려서 반영한다.
async function renderTitlebarShortcuts() {
  const wrap = document.getElementById('titlebar-shortcuts');
  if (!wrap) return;
  let links;
  try {
    links = await window.api.getShortcutLinks();
  } catch (err) {
    console.error('바로가기 목록 불러오기 실패:', err);
    return;
  }
  wrap.innerHTML = '';
  links.forEach((link) => {
    const btn = document.createElement('button');
    btn.className = 'titlebar-shortcut-btn';
    btn.textContent = link.label;
    btn.title = link.label;
    btn.addEventListener('click', () => window.api.openShortcutLink(link.id));
    wrap.appendChild(btn);
  });
}
renderTitlebarShortcuts();
window.api.onOrgMyInfoUpdate(renderTitlebarShortcuts);

const pinBtn = document.getElementById('btn-pin');
pinBtn.onclick = async () => {
  const pinned = await window.api.togglePin();
  pinBtn.classList.toggle('active', pinned);
  pinBtn.title = pinned ? '고정 해제' : '창 위치 고정 (이동 잠금)';
};

// --- Settings panel ---
const settingsPanel = document.getElementById('settings-panel');
const autostartToggle = document.getElementById('autostart-toggle');
const preferredBrowserSelect = document.getElementById('preferred-browser-select');
preferredBrowserSelect.addEventListener('change', () => {
  window.api.setPreferredBrowser(preferredBrowserSelect.value);
});

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
  preferredBrowserSelect.value = await window.api.getPreferredBrowser();
  orgRenderBranchLinksEditor();
  orgRenderMinVersionEditor();
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
    showToast('관리자 목록이 저장되었습니다.');
  } catch (err) {
    console.error('관리자 목록 저장 실패:', err);
    showToast('저장에 실패했습니다.');
  }
};

document.getElementById('settings-close').onclick = () => {
  applyTheme(lastSavedTheme); // discard any unsaved live-preview changes
  settingsPanel.classList.add('hidden');
};

// --- 계정 삭제 (Google Play 정책 대응) ---
const accountDeletePopup = document.getElementById('account-delete-popup');
const accountDeleteEmailEl = document.getElementById('account-delete-email');
const accountDeleteConfirmInput = document.getElementById('account-delete-confirm-input');
const accountDeleteConfirmBtn = document.getElementById('account-delete-confirm-btn');
const accountDeleteStatus = document.getElementById('account-delete-status');

function accountDeleteResetInputState() {
  accountDeleteConfirmBtn.disabled = accountDeleteConfirmInput.value.trim() !== '삭제';
}

document.getElementById('account-delete-open').addEventListener('click', () => {
  if (!currentUser.signedIn) {
    showToast('로그인 상태에서만 계정을 삭제할 수 있습니다.');
    return;
  }
  accountDeleteEmailEl.textContent = currentUser.email || '';
  accountDeleteConfirmInput.value = '';
  accountDeleteConfirmBtn.disabled = true;
  accountDeleteStatus.textContent = '';
  settingsPanel.classList.add('hidden');
  accountDeletePopup.classList.remove('hidden');
});

document.getElementById('account-delete-cancel-btn').addEventListener('click', () => {
  accountDeletePopup.classList.add('hidden');
});

accountDeleteConfirmInput.addEventListener('input', accountDeleteResetInputState);

function accountDeleteFinishSignedOutUI() {
  isGoogleSignedIn = false;
  currentUser = { signedIn: false, uid: null, isAdmin: false };
  renderGoogleStatus();
  updateNoticeInputState();
  renderMemos();
  renderCalendar();
}

accountDeleteConfirmBtn.addEventListener('click', async () => {
  accountDeleteConfirmBtn.disabled = true;
  accountDeleteStatus.textContent = '삭제 중...';
  try {
    await window.api.deleteAccount();
    accountDeletePopup.classList.add('hidden');
    accountDeleteFinishSignedOutUI();
    showToast('계정이 삭제되었습니다.');
    return;
  } catch (err) {
    if (!(err.message || '').includes('REQUIRES_RECENT_LOGIN')) {
      console.error('계정 삭제 실패:', err);
      accountDeleteStatus.textContent = '삭제에 실패했습니다. 다시 시도해주세요.';
      accountDeleteResetInputState();
      return;
    }
  }
  // 보안을 위해 마지막 로그인이 오래되면 삭제가 막힌다 — 다시 로그인만 한 번 더 시키고
  // 자동으로 재시도한다(사용자가 또 버튼을 누를 필요 없게).
  accountDeleteStatus.textContent = '보안을 위해 다시 로그인해주세요...';
  try {
    await window.api.googleSignIn();
    currentUser = await window.api.getCurrentUser();
    accountDeleteStatus.textContent = '다시 삭제 시도 중...';
    await window.api.deleteAccount();
    accountDeletePopup.classList.add('hidden');
    accountDeleteFinishSignedOutUI();
    showToast('계정이 삭제되었습니다.');
  } catch (err2) {
    console.error('재로그인 후 계정 삭제 실패:', err2);
    accountDeleteStatus.textContent = '삭제에 실패했습니다. 다시 시도해주세요.';
    accountDeleteResetInputState();
  }
});

document.getElementById('settings-save').onclick = async () => {
  await window.api.setAutostart(autostartToggle.checked);
  const theme = currentThemeFromForm();
  await window.api.setTheme(theme);
  lastSavedTheme = theme;
  applyTheme(theme);
  settingsPanel.classList.add('hidden');
};

// --- Theme customization ---
// COLOR_FIELDS/DARK_DEFAULTS/LIGHT_DEFAULTS/THEME_PRESETS/shadeHex/applyTheme now live in
// theme.js (loaded before this script) so the 분리형 할 일 위젯 창도 같은 테마를 쓸 수 있다.
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

// 프리셋 카드를 THEME_PRESET_META(theme.js)에서 그려낸다 — 프리셋을 추가/삭제해도
// 여기 마크업은 안 건드려도 된다. "사용자 설정"은 고정 팔레트가 없어서 목록 끝에
// 수동으로 붙인다.
(function renderThemePresetGrid() {
  const grid = document.getElementById('theme-preset-grid');
  if (!grid) return;
  const swatchHTML = (preset) => `
    <div class="theme-preset-swatch" style="background:${preset.bg}">
      <span style="background:${preset.panelBg}"></span>
      <span style="background:${preset.accent}"></span>
    </div>`;
  const cards = THEME_PRESET_META.map((meta) => `
    <label class="theme-preset-card">
      <input type="radio" name="theme-mode" value="${meta.id}" ${meta.id === 'dark' ? 'checked' : ''} />
      ${swatchHTML(THEME_PRESETS[meta.id])}
      <span class="theme-preset-name">${meta.label}</span>
      <span class="theme-preset-blurb">${meta.blurb}</span>
    </label>`);
  cards.push(`
    <label class="theme-preset-card">
      <input type="radio" name="theme-mode" value="custom" />
      <div class="theme-preset-swatch is-custom"></div>
      <span class="theme-preset-name">사용자 설정</span>
      <span class="theme-preset-blurb">아래에서 색을 직접 골라요</span>
    </label>`);
  grid.innerHTML = cards.join('');
})();

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

themeResetBtn.onclick = async () => {
  await window.api.setTheme({});
  lastSavedTheme = {};
  applyTheme({});
  fillThemeInputs({});
};

window.api.onMemosUpdate((updated) => {
  memos = updated;
  renderMemos();
});

const memoAlarmPopup = document.getElementById('memo-alarm-popup');
const memoAlarmPopupText = document.getElementById('memo-alarm-text');
window.api.onMemoAlarm((memo) => {
  memoAlarmPopupText.textContent = memo.text;
  memoAlarmPopup.classList.remove('hidden');
  // 알람 표식은 서버(main)가 곧 지우지만, 다음 폴링(최대 1분)까지 기다리지 않고
  // 화면에서 바로 "⏰" 배지를 없애준다.
  const target = memos.find((m) => m.id === memo.id);
  if (target) {
    target.alarmTime = null;
    renderMemos();
  }
});
document.getElementById('memo-alarm-close').addEventListener('click', () => {
  memoAlarmPopup.classList.add('hidden');
});

window.api.onAuthUpdated(async (user) => {
  currentUser = user;
  // "로그인됨" 표시는 이 앱 자체 계정(Firebase) 상태가 아니라, 실제로 구글 캘린더/할 일
  // 권한이 지금 살아있는지를 따로 확인해서 보여준다 — 둘은 서로 다른 시스템이라, Firebase는
  // 로그인된 채로 구글 캘린더 권한만 없어진 경우(예: 권한 추가로 자동 로그아웃된 뒤 아직
  // 재로그인 전)에도 "로그인됨"으로 잘못 뜨는 걸 막는다.
  isGoogleSignedIn = await window.api.googleIsSignedIn();
  renderGoogleStatus();
  updateNoticeInputState();
  renderMemos();
  renderCalendar();
});

// --- 출고 관리 장부 ---
const chulgoPanel = document.getElementById('chulgo-panel');
const appContentEl = document.querySelector('.content');
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
// 실제 "출고 현황" 엑셀 템플릿의 P열(금융사 작성예시)과 완전히 동일한 목록 +
// 별도로 요청받은 4개 변형(중고/다이렉트/특수/영등포 지점) — 엑셀 추출 시 이 목록에
// 있는 이름 그대로 나가야 하므로, 자유 텍스트 대신 드롭다운으로 강제한다.
const CHULGO_COMPANY_LIST = [
  '하나캐피탈', '하나캐피탈(다이렉트)', 'KB캐피탈', 'IM캐피탈', 'BNK캐피탈', 'MG캐피탈',
  '신한카드', '신한카드(중고)', '롯데렌터카', '농협캐피탈', '메리츠캐피탈', '우리금융캐피탈',
  '오릭스캐피탈', '현대캐피탈', '현대캐피탈(영등포)', '현대캐피탈(특수)', 'JB우리캐피탈', '롯데캐피탈',
  '산은캐피탈', '롯데오토리스', '우리카드', '삼성카드', '하모니렌터카', 'SK렌터카', '아마존카',
  '레드캡', '케이카', '에이원렌터카', '오토핸즈', 'BMW파이낸셜', '벤츠파이낸셜', '아우디파이낸셜',
  '일시불', '할부',
];

// "삼성카드" 아래로는 전부 비제휴(재광님 확인) — AI가 회사를 채울 때 이 목록에 있으면
// 자동으로 비제휴 체크, 없으면 자동으로 해제한다. 리텐션은 비제휴 여부와 무관하게
// 항상 적용되는 거라(재광님 확인: "비제휴도 리텐션 적용이 되니 리텐션은 다 체크") 별도로 늘 켠다.
const CHULGO_NONPARTNER_COMPANIES = [
  '하모니렌터카', 'SK렌터카', '아마존카', '레드캡', '케이카', '에이원렌터카', '오토핸즈',
  'BMW파이낸셜', '벤츠파이낸셜', '아우디파이낸셜', '일시불', '할부',
];

const CHULGO_COLS = [
  { key: 'finType', label: '금융정보', type: 'select', options: ['리스', '렌트', '할부', '일시불', '기타'], w: 90 },
  { key: 'name', label: '고객명', type: 'text', w: 150 },
  { key: 'car', label: '차종', type: 'text', w: 120 },
  // 출고현황/정산서 엑셀에 이미 차량가액으로 매핑되고 있던 필드(vehiclePrice)를
  // 여기서도 바로 적을 수 있게 — 지금까진 💰 팝업의 "차량가격"으로만 넣을 수 있었다.
  { key: 'vehiclePrice', label: '차량가', type: 'money', w: 110 },
  { key: 'company', label: '금융사', type: 'select', options: CHULGO_COMPANY_LIST, w: 150 },
  { key: 'fee', label: '수수료', type: 'money', w: 120 },
  // 프로모션/대리점수당/용품비는 이제 표에 직접 안 적고 💰 팝업에서만 항목으로
  // 관리한다(표 칸은 합계만 보여주는 읽기전용) — 그래서 비워진 이 세 칸에는 대신
  // 자주 쓰는 계약기간/주행거리/초기자금을 바로 적을 수 있게 한다.
  { key: 'contractPeriod', label: '계약기간', type: 'select', options: ['12개월', '24개월', '36개월', '48개월', '60개월', '72개월'], w: 100 },
  { key: 'mileage', label: '주행거리', type: 'select', options: ['X', '5,000KM', '10,000KM', '15,000KM', '17,000KM', '20,000KM', '25,000KM', '30,000KM', '35,000KM', '40,000KM', '45,000KM', '50,000KM', '무제한KM'], w: 100 },
  // 금액+타입 드롭다운으로 만들었더니 "보증 10% 선납 10% 무보증"처럼 섞어 쓰거나
  // 퍼센트로 표현하는 걸 못 써서(재광님 확인), 계약기간/주행거리처럼 자유 텍스트로 되돌렸다.
  { key: 'initialFunds', label: '초기자금', type: 'text', w: 150 },
  { key: 'status', label: '투입여부', type: 'select', options: ['-', '예정', '완료'], w: 90 },
  { key: 'dbType', label: '디비유형', type: 'text', w: 66 },
];

// 정산서에만 쓰이는 값들 — 장부 표에서 바로 켜고 끌 수 있어야 나중에 대조하기 쉬워서
// (엑셀 전용 필드를 미리보기에서만 고치던 기존 방식과 달리) 장부 본표에 같이 둔다.
const CHULGO_NONPARTNER_W = 52;   // 비제휴 체크
const CHULGO_RETENTION_W = 52;    // 리텐션 체크
const CHULGO_UNITS_W = 56;        // 인정 대수(2대 인정 등)
const CHULGO_SETTLE_W = 58;       // 정산 상세(비용/페이백/메모) 버튼
const CHULGO_COMPUTED_W = 150;
const CHULGO_ACTION_W = 66;
const CHULGO_DRAG_W = 24;

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
function chulgoPaybackTotal(e) {
  return (e.paybacks || []).reduce((a, it) => a + (Number(it.amount) || 0), 0);
}
// 정산서 내보내기(chulgoSettleFormulas)는 추가수수료의 '금액' 항목을 H열 합계에 더하는데
// (line 1683 주석 참고), 이 화면 미리보기 총액은 그동안 추가수수료를 아예 안 보고
// 있었다 — 장부에 추가수수료를 적어도 화면 합계가 안 바뀌는, 페이백과 같은 종류의 누락.
function chulgoExtraFeeAmountTotal(e) {
  return chulgoExtraFeeItems(e)
    .filter((it) => it.type !== 'percent')
    .reduce((a, it) => a + (Number(it.value) || 0), 0);
}

function chulgoComputedFee(e) {
  // 재광님 확인: 수수료/대리점수당/프로모션 다 부가세 포함으로 적고, 정산서엔 그 값이
  // 그대로 넘어간 뒤 나중에 사람이 직접 부가세 뺀 금액으로 최종 수정한다. 그래서 여기서
  // ÷1.1 로 정확히 계산해봤자 어차피 나중에 손으로 또 고치는 숫자라 의미가 없고, 오히려
  // 화면 미리보기가 "높았다가 나중에 깎이는" 것보다 "낮았다가 나중에 올라가는" 쪽이
  // 낫다는 판단(재광님) — 그래서 정확한 나눗셈 대신 기존처럼 86.7% 근사치를 그대로 쓴다.
  const base =
    (Number(e.fee) || 0) + (Number(e.promo) || 0) + (Number(e.agencyFee) || 0) + chulgoExtraFeeAmountTotal(e)
    - (Number(e.supplies) || 0) - chulgoPaybackTotal(e);
  const rate = CHULGO_POSITION_RATES[chulgoPosition] ?? 0.5;
  return base * 0.867 * rate;
}
function chulgoEntriesEqual(a, b) {
  if (a.length !== b.length) return false;
  const bMap = new Map(b.map((e) => [e.id, e]));
  return a.every((ea) => {
    const eb = bMap.get(ea.id);
    if (!eb) return false;
    return Object.keys(ea).every((k) => {
      const va = ea[k];
      const vb = eb[k];
      // expenses/paybacks/extraFees/promoItems/agencyFeeItems는 배열이라, Firestore
      // 스냅샷이 올 때마다 내용이 같아도 매번 새 배열 객체로 온다 — ===로 비교하면
      // 항상 "다르다"고 나와서 이 함수가 사실상 아무것도 걸러내지 못했다(그래서 매
      // 저장마다 표 전체가 다시 그려지며 방금 누른 칸의 포커스가 날아갔다).
      if (Array.isArray(va) || Array.isArray(vb)) {
        return JSON.stringify(va) === JSON.stringify(vb);
      }
      return va === vb;
    });
  });
}
function chulgoUpdateFormulaHint() {
  const rate = Math.round((CHULGO_POSITION_RATES[chulgoPosition] ?? 0.5) * 100);
  chulgoFormulaHint.textContent = `공제후총수수료 = (수수료 + 프로모션 + 대리점수당 + 추가수수료 − 용품비 − 페이백) × 86.7% × ${rate}% (직책: ${chulgoPosition})`;
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

// 주행거리 자유 입력(AI 채우기 등)을 표 드롭다운의 표준 표기로 정리한다 —
// "2만"/"2만km"/"2.5만km"/"25000km"는 전부 "20,000KM"/"25,000KM"로,
// "무제한"/"무제한km"는 "무제한KM"으로. 못 알아듣는 형식(순수 텍스트 등)은
// 입력한 그대로 둔다(제네릭 select 렌더러가 목록에 없는 값을 보존해준다).
function chulgoNormalizeMileage(raw) {
  const s = (raw || '').toString().trim();
  if (!s) return '';
  if (s.includes('무제한')) return '무제한KM';
  const manMatch = s.match(/^(\d+(?:\.\d+)?)\s*만/);
  if (manMatch) {
    const km = Math.round(Number(manMatch[1]) * 10000);
    return `${km.toLocaleString('ko-KR')}KM`;
  }
  const numMatch = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (numMatch) {
    const km = Math.round(Number(numMatch[1]));
    return `${km.toLocaleString('ko-KR')}KM`;
  }
  return s;
}

// 비제휴 건은 대수 인정이 안 되고, "2대 인정" 같은 건은 그 수만큼 쳐준다.
// recognizedUnits 하나로 통합돼 있다 (0 = 미인정). countsQuota===false 는 통합 전
// "인정댓수 체크 해제"로 저장된 예전 데이터를 그대로 읽기 위한 호환용이며, 이 값을
// 명시적으로 고치는 순간(chulgo-units-input 핸들러) countsQuota 는 true 로 정리된다.
function chulgoUnitsOf(e) {
  if (e.nonPartner) return 0;
  if (e.countsQuota === false) return 0;
  const n = Number(e.recognizedUnits);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}
function chulgoCountedUnits(list) {
  return list.reduce((a, e) => a + chulgoUnitsOf(e), 0);
}

// 수수료 금액이 화면에 떠 있으면 옆 사람이 보일 수 있어서, 클릭 한 번으로 전부
// 모자이크(블러) 처리하고 다시 클릭할 때까지(창을 바꾸거나 껐다 켜도) 그 상태를
// 유지한다 — localStorage에 저장해서 앱을 다시 켜도 그대로다.
const CHULGO_BLUR_KEY = 'chulgo_amounts_blurred_v1';
let chulgoAmountsBlurred = localStorage.getItem(CHULGO_BLUR_KEY) === '1';

function chulgoApplyBlurState() {
  document.querySelectorAll('.chulgo-blurrable').forEach((el) => {
    el.classList.toggle('chulgo-blurred', chulgoAmountsBlurred);
  });
}

function chulgoToggleBlur() {
  chulgoAmountsBlurred = !chulgoAmountsBlurred;
  localStorage.setItem(CHULGO_BLUR_KEY, chulgoAmountsBlurred ? '1' : '0');
  chulgoApplyBlurState();
}

// 히어로 숫자든, 수수료보고 옆 월 합계든, 표의 칸칸이 다 새로 그려지는 것들이라
// 하나하나 클릭 리스너를 다시 다는 대신, 장부 화면 전체에 한 번만 걸어두고
// "지금 클릭된 게 금액 칸인지"만 확인한다(이벤트 위임) — 어디를 눌러도 전부 같이 켜지고 꺼진다.
chulgoPanel.addEventListener('click', (ev) => {
  if (ev.target.closest('.chulgo-blurrable')) chulgoToggleBlur();
});

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

  // 최신 정산/핀테크 대시보드(토스·스트라이프류)처럼, 가장 중요한 숫자(이번 달 수수료)를
  // 큼직하게 하나로 강조하고 나머지(전체/완료/예정)는 그 옆에 작은 지표 칩으로 붙인다 —
  // 예전의 "네모 4개 균등 배치"보다 뭐가 중요한 숫자인지 한눈에 들어온다.
  chulgoStatRow.innerHTML = `
    <div class="chulgo-hero">
      <div class="chulgo-hero-main">
        <div class="chulgo-hero-label">이번 달 공제 후 총수수료 합계</div>
        <div class="chulgo-hero-value chulgo-blurrable${chulgoAmountsBlurred ? ' chulgo-blurred' : ''}" id="chulgo-hero-value" title="클릭해서 가리기/보이기">${chulgoWon(netTotal)}</div>
      </div>
      <div class="chulgo-hero-stats">
        <div class="chulgo-hero-stat"><span class="dot"></span>전체 <b>${totalCount}건</b></div>
        <div class="chulgo-hero-stat is-done"><span class="dot"></span>완료 <b>${doneCount}건</b></div>
        <div class="chulgo-hero-stat is-pending"><span class="dot"></span>예정 <b>${pendingCount}건</b></div>
      </div>
    </div>
  `;
}

// 투입여부처럼 배지(알약) 모양으로 보여주는 select 칸들 — 색이 상태를 뜻하는
// status 칸과 달리, 여기는 그냥 중립색 배지로만 꾸며서 값을 한눈에 보기 쉽게 한다.
const CHULGO_PILL_COLS = ['finType', 'company', 'contractPeriod', 'mileage'];

function chulgoCellHTML(e, col) {
  const val = e[col.key] ?? (col.type === 'money' ? 0 : '');
  if (col.type === 'select') {
    // 예전에 자유 텍스트로 써놓은 값이 지금 옵션 목록에 없으면(예: 오타, 옛날 방식 표기),
    // 그 값을 그냥 없애버리지 않도록 맨 앞에 임시 옵션으로 얹어서 보존한다.
    const options = val && !col.options.includes(val) ? [val, ...col.options] : col.options;
    const opts = options.map((o) => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('');
    const statusCls = val === '완료' ? 'chulgo-status-완료' : val === '예정' ? 'chulgo-status-예정' : '';
    const pillCls = CHULGO_PILL_COLS.includes(col.key) ? 'chulgo-pill-select' : '';
    const cls = [statusCls, pillCls].filter(Boolean).join(' ');
    return `<select class="${cls}" data-id="${e.id}" data-key="${col.key}">${opts}</select>`;
  }
  if (col.type === 'money') {
    return `<input class="chulgo-money" type="text" inputmode="numeric" data-id="${e.id}" data-key="${col.key}" value="${chulgoFormatMoneyDisplay(val)}" placeholder="0">`;
  }
  return `<input type="text" data-id="${e.id}" data-key="${col.key}" value="${(val || '').toString().replace(/"/g, '&quot;')}">`;
}

function chulgoBuildColgroup() {
  const cols = CHULGO_COLS.map((c) => `<col style="width:${chulgoWidthFor(c.key, c.w)}px">`).join('');
  return `<colgroup>`
    + `<col style="width:${CHULGO_DRAG_W}px">`
    + `<col style="width:${CHULGO_NONPARTNER_W}px">`
    + `<col style="width:${CHULGO_RETENTION_W}px">`
    + `<col style="width:${CHULGO_UNITS_W}px">`
    + cols
    + `<col style="width:${chulgoWidthFor('_computed', CHULGO_COMPUTED_W)}px">`
    + `<col style="width:${CHULGO_ACTION_W + CHULGO_SETTLE_W}px">`
    + `</colgroup>`;
}

function chulgoRecognizedUnits(e) {
  if (e.countsQuota === false) return 0;    // 예전 "인정댓수 체크 해제" 데이터 호환
  const n = Number(e.recognizedUnits);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}

function chulgoExpenseItems(e) {
  return Array.isArray(e.expenses) ? e.expenses : [];
}
function chulgoPaybackItems(e) {
  return Array.isArray(e.paybacks) ? e.paybacks : [];
}
// 프로모션/대리점수당도 용품비와 같은 방식 — 프로모션이 "프로모션1 50만원 +
// 프로모션2 차량가의 1.2%(직접 계산해서 금액으로 입력)"처럼 여러 건으로 나오는 경우가
// 있어서, 항목을 몇 개든 이름 붙여 넣을 수 있게 한다. %는 계산해주지 않고(재광님 확인:
// 어차피 직접 계산해서 금액으로 넣을 거라 필요 없음) 항목 이름에 적으면 그대로 표기된다.
function chulgoPromoItems(e) {
  return Array.isArray(e.promoItems) ? e.promoItems : [];
}
function chulgoAgencyFeeItems(e) {
  return Array.isArray(e.agencyFeeItems) ? e.agencyFeeItems : [];
}
// 금융사가 매달 다르게 주는 추가 프로모션 — {name, type:'amount'|'percent', value}.
// '%' 는 계산해서 더하지 않는다 — 그냥 "3%" 라고 메모란에 표기만 한다 (재광님 확인:
// 계산은 하지 말고 표기만). '금액'만 다른 필드들처럼 H열 합계에 더해진다.
function chulgoExtraFeeItems(e) {
  return Array.isArray(e.extraFees) ? e.extraFees : [];
}
// 1개면 이름 없이 "수수료"로, 2개 이상이면 "추가수수료1/2/..."로 자동 이름을 붙인다
// (사용자가 직접 이름을 넣으면 그걸 그대로 쓴다).
function chulgoExtraFeeLabel(item, index, total) {
  if (item.name) return item.name;
  return total <= 1 ? '수수료' : `추가수수료${index + 1}`;
}
// 프로모션/대리점수당 항목 이름 자동 채우기 — 이름을 직접 안 적었으면 1개는 그냥
// "프로모션"/"대리점수당", 2개 이상이면 "프로모션1"/"프로모션2" 식으로 번호를 붙인다.
function chulgoItemizedLabel(item, index, total, defaultName) {
  if (item.name) return item.name;
  return total <= 1 ? defaultName : `${defaultName}${index + 1}`;
}
function chulgoHasSettleDetail(e) {
  return chulgoExpenseItems(e).length > 0 || chulgoPaybackItems(e).length > 0
    || chulgoExtraFeeItems(e).length > 0 || chulgoPromoItems(e).length > 0
    || chulgoAgencyFeeItems(e).length > 0 || !!e.settleMemo;
}

function chulgoFriendlyError(err) {
  const msg = (err && err.message) || '';
  if (msg.includes('permission-denied') || msg.includes('PERMISSION_DENIED')) {
    return 'Firestore 보안 규칙이 아직 허용되어 있지 않습니다.\nFirebase 콘솔 → Firestore Database → 규칙 탭에서 README의 규칙을 추가·게시해주세요.';
  }
  if (msg.includes('NOT_SIGNED_IN')) {
    return '구글 로그인이 풀린 것 같습니다. 로그아웃 후 다시 로그인해주세요.';
  }
  if (msg.includes('GOOGLE_TIMEOUT')) {
    return '구글 서버 응답이 너무 오래 걸려서 중단했습니다. 인터넷 연결을 확인하고 다시 시도해주세요.';
  }
  if (msg.includes('insufficient authentication scopes')) {
    return '할 일 권한이 아직 없습니다. 로그아웃 후 다시 로그인해서 권한을 허용해주세요.';
  }
  if (msg.includes('FIREBASE_NOT_CONFIGURED')) {
    return 'config/config.json에 firebase 설정이 채워지지 않았습니다.';
  }
  return `실패했습니다: ${msg || '알 수 없는 오류'}`;
}

// alert() 는 Electron 에서 렌더러를 통째로 멈춰 세운다 — 저장 실패가 여러 건 겹치면
// (예: 잠깐 인터넷이 끊겨서 "전체 리텐션" 9건이 다 실패) 경고창이 줄줄이 쌓여서
// 그동안 클릭도 타이핑도 전혀 안 된다. 앱 전체에서 alert() 대신 이 화면을 막지 않는
// 알림을 쓰고, 같은 메시지가 연달아 뜨지 않게 잠시 묶어둔다.
let appToastEl = null;
let appToastTimer = null;
let lastToastAt = 0;

let lastToastMessage = '';

function showToast(message) {
  const now = Date.now();
  // 도배 방지는 "같은 메시지가 연달아 뜨는 것"만 막는다. 예전엔 시간만 보고 막아서,
  // 3초 안에 뜬 서로 다른 메시지(예: 저장 실패 직후의 "정산서 23줄 초과" 경고)가
  // 통째로 안 보이고 사라졌다 — 정작 봐야 할 안내를 놓치게 되는 쪽이 더 나쁘다.
  if (message === lastToastMessage && now - lastToastAt < 3000) return;
  lastToastMessage = message;
  lastToastAt = now;

  if (!appToastEl) {
    appToastEl = document.createElement('div');
    appToastEl.className = 'app-toast';
    document.body.appendChild(appToastEl);
  }
  appToastEl.textContent = message;
  appToastEl.classList.add('show');
  clearTimeout(appToastTimer);
  appToastTimer = setTimeout(() => appToastEl.classList.remove('show'), 4000);
}

// 개별 버튼 핸들러가 전부 try/catch로 감싸져 있어도, 놓친 곳 하나 때문에 콘솔에만
// 조용히 에러가 찍히고 사용자는 "왜 아무 반응이 없지"만 겪는 상황을 막는 마지막
// 안전망. 여기서 뭔가를 고치는 게 아니라 그냥 사용자에게 알려주기만 한다(같은 메시지
// 반복은 showToast의 도배 방지가 알아서 걸러준다).
window.addEventListener('unhandledrejection', (ev) => {
  console.error('처리되지 않은 오류:', ev.reason);
  showToast('예상치 못한 오류가 발생했습니다. 다시 시도해주세요.');
});
window.addEventListener('error', (ev) => {
  console.error('처리되지 않은 오류:', ev.error || ev.message);
  showToast('예상치 못한 오류가 발생했습니다. 다시 시도해주세요.');
});

// 강제 업데이트 — 닫을 방법이 없다(의도된 동작), "지금 업데이트"는 타이틀바 버전
// 배지랑 완전히 같은, 이미 검증된 업데이트 흐름을 그대로 재사용한다.
window.api.onForceUpdateRequired(({ minVersion, currentVersion }) => {
  document.getElementById('force-update-current').textContent = `v${currentVersion}`;
  document.getElementById('force-update-min').textContent = `v${minVersion}`;
  document.getElementById('force-update-overlay').classList.remove('hidden');
});
document.getElementById('force-update-btn').addEventListener('click', () => {
  document.getElementById('app-version-badge').click();
});

async function chulgoUpdateField(id, key, value) {
  try {
    await window.api.updateChulgoEntry({ id, [key]: value });
  } catch (err) {
    console.error('출고 건 수정 실패:', err);
    showToast(chulgoFriendlyError(err));
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
      <td class="chulgo-drag-handle" draggable="true" title="드래그해서 순서 변경">⠿</td>
      <td class="chulgo-check-cell"><input type="checkbox" class="chulgo-nonpartner-check" data-id="${e.id}" ${e.nonPartner ? 'checked' : ''} title="비제휴 (대수 인정 제외, 정산서에서 별도 묶음)"></td>
      <td class="chulgo-check-cell"><input type="checkbox" class="chulgo-retention-check" data-id="${e.id}" ${e.retention ? 'checked' : ''} title="리텐션 (정산서 S열 차감 + 리텐션 횟수 부여)"></td>
      <td class="chulgo-check-cell">
        <input type="number" class="chulgo-units-input${e.nonPartner ? ' is-overridden' : ''}" min="0" max="9"
               data-id="${e.id}" value="${chulgoRecognizedUnits(e)}" ${e.nonPartner ? 'disabled' : ''}
               title="이 건이 대수 프로모션에 몇 대로 잡히는지 — 0이면 안 잡힘(예전 '인정댓수' 해제와 같음), 2 이상이면 정산서에 그 수만큼 줄이 생기고 둘째 줄부터 수수료는 비웁니다${e.nonPartner ? ' (비제휴라 자동으로 0대 처리됨)' : ''}">
      </td>
      ${CHULGO_COLS.map((c) => `<td>${chulgoCellHTML(e, c)}</td>`).join('')}
      <td class="chulgo-computed chulgo-blurrable${chulgoAmountsBlurred ? ' chulgo-blurred' : ''}" title="클릭해서 가리기/보이기">${chulgoWon(chulgoComputedFee(e))}</td>
      <td>
        <div class="chulgo-row-actions">
          <button class="chulgo-settle-btn${chulgoHasSettleDetail(e) ? ' has-memo' : ''}" data-id="${e.id}" title="정산 상세 (비용 항목 / 페이백 / 메모)">💰</button>
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
        <th></th>
        <th class="chulgo-check-cell">비제휴</th>
        <th class="chulgo-check-cell">리텐션<br><input type="checkbox" id="chulgo-retention-all" title="이 달 전체 리텐션 켜기/끄기"></th>
        <th class="chulgo-check-cell" title="이 건이 대수 프로모션에 몇 대로 잡히는지. 0 = 안 잡힘">인정대수</th>
        ${CHULGO_COLS.map((c) => `<th data-key="${c.key}">${c.label}<span class="chulgo-col-resizer" data-key="${c.key}"></span></th>`).join('')}
        <th data-key="_computed">공제후총수수료<span class="chulgo-col-resizer" data-key="_computed"></span></th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="${CHULGO_COLS.length + 4}">월 합계</td><td class="chulgo-blurrable${chulgoAmountsBlurred ? ' chulgo-blurred' : ''}" title="클릭해서 가리기/보이기">${chulgoWon(monthTotal)}</td><td></td></tr></tfoot>
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

  // 비제휴/리텐션/인정대수는 data-key 가 없고 자기만의 저장 로직(아래)을 따로 갖고
  // 있다 — 여기서 빠뜨리면 이 범용 핸들러가 el.dataset.key(=undefined)로 저장을
  // 시도해서 문서에 "undefined" 라는 가짜 필드가 매번 같이 저장된다(실제로 있던 문제).
  chulgoTableWrap.querySelectorAll(
    'input:not(.chulgo-nonpartner-check):not(.chulgo-retention-check):not(.chulgo-units-input), select'
  ).forEach((el) => {
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
        showToast(chulgoFriendlyError(err));
      }
    });
  });

  // 비제휴는 대수 인정에서 항상 0으로 계산되므로(chulgoUnitsOf), 저장값 자체는 안
  // 건드리고 인정대수 입력칸만 회색으로 비활성화해서 "지금 이 값이 안 먹힌다"를
  // 눈으로 보여준다 — 다시 끄면 원래 넣어뒀던 숫자가 그대로 돌아온다.
  chulgoTableWrap.querySelectorAll('.chulgo-nonpartner-check').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.dataset.id;
      const entry = chulgoEntries.find((x) => x.id === id);
      if (entry) entry.nonPartner = el.checked;
      const row = el.closest('tr');
      const unitsInput = row && row.querySelector('.chulgo-units-input');
      if (unitsInput) {
        unitsInput.disabled = el.checked;
        unitsInput.classList.toggle('is-overridden', el.checked);
      }
      renderChulgoStats();
      chulgoActiveMonthCount.textContent = `${list.length}건 (인정 ${chulgoCountedUnits(list)}대)`;
      chulgoUpdateField(id, 'nonPartner', el.checked);
    });
  });

  const retentionAll = document.getElementById('chulgo-retention-all');
  const syncRetentionAll = () => {
    if (!retentionAll) return;
    const boxes = Array.from(chulgoTableWrap.querySelectorAll('.chulgo-retention-check'));
    const on = boxes.filter((b) => b.checked).length;
    retentionAll.checked = boxes.length > 0 && on === boxes.length;
    retentionAll.indeterminate = on > 0 && on < boxes.length;
  };

  chulgoTableWrap.querySelectorAll('.chulgo-retention-check').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.dataset.id;
      const entry = chulgoEntries.find((x) => x.id === id);
      if (entry) entry.retention = el.checked;
      syncRetentionAll();
      chulgoUpdateField(id, 'retention', el.checked);
    });
  });
  syncRetentionAll();

  // 리텐션은 보통 그 달 대부분의 건에 붙어서 한 건씩 누르면 빠뜨리기 쉽다 — 머리글에서 한 번에 켠다.
  if (retentionAll) {
    retentionAll.addEventListener('change', async () => {
      const on = retentionAll.checked;
      // 한꺼번에 8~9건을 동시에 저장 요청하면 가끔 "indexOf of undefined" 에러가 나서
      // (Firestore SDK가 그 순간 몰린 요청을 못 견디는 것으로 보임), 하나씩 순서대로 저장한다.
      const boxes = Array.from(chulgoTableWrap.querySelectorAll('.chulgo-retention-check'));
      for (const el of boxes) {
        if (el.checked === on) continue;
        el.checked = on;
        const id = el.dataset.id;
        if (!id) continue;
        const entry = chulgoEntries.find((x) => x.id === id);
        if (entry) entry.retention = on;
        await chulgoUpdateField(id, 'retention', on);
      }
      retentionAll.indeterminate = false;
    });
  }

  chulgoTableWrap.querySelectorAll('.chulgo-units-input').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.dataset.id;
      // 비워서 0 을 의도한 것과, 숫자가 아닌 값이 들어와 못 읽는 것을 구분한다
      // (그냥 || 1 로 처리하면 지워서 0 을 만들려던 게 도로 1로 튕겨나온다).
      const raw = el.value === '' ? 0 : Number(el.value);
      const n = Math.max(0, Math.min(9, Number.isFinite(raw) ? Math.floor(raw) : 1));
      el.value = n;
      const entry = chulgoEntries.find((x) => x.id === id);
      // 이 칸을 직접 고치면 그 값이 최종 기준이 된다 — 예전 "인정댓수 체크 해제"
      // (countsQuota=false) 데이터가 남아 있어도 여기서 정리해서 새 값을 덮어쓰지 못하게 한다.
      if (entry) { entry.recognizedUnits = n; entry.countsQuota = true; }
      renderChulgoStats();
      chulgoActiveMonthCount.textContent = `${list.length}건 (인정 ${chulgoCountedUnits(list)}대)`;
      chulgoUpdateField(id, 'recognizedUnits', n);
      chulgoUpdateField(id, 'countsQuota', true);
    });
  });

  chulgoTableWrap.querySelectorAll('.chulgo-settle-btn').forEach((btn) => {
    btn.addEventListener('click', () => openChulgoSettleDetail(btn.dataset.id));
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

  chulgoBindDragReorder();
  chulgoBindResizers();
  chulgoUpdateActionRowState();
}

// --- 행 순서 드래그로 바꾸기 (실제 출고 순서대로 위아래 재배열) ---
let chulgoDragSourceId = null;

function chulgoBindDragReorder() {
  chulgoTableWrap.querySelectorAll('.chulgo-drag-handle').forEach((handle) => {
    handle.addEventListener('dragstart', (ev) => {
      const tr = handle.closest('tr');
      chulgoDragSourceId = tr.dataset.rowId;
      ev.dataTransfer.effectAllowed = 'move';
      tr.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => {
      chulgoTableWrap.querySelectorAll('tr.dragging').forEach((tr) => tr.classList.remove('dragging'));
      chulgoDragSourceId = null;
    });
  });

  chulgoTableWrap.querySelectorAll('tr[data-row-id]').forEach((tr) => {
    tr.addEventListener('dragover', (ev) => {
      if (!chulgoDragSourceId) return;
      ev.preventDefault();
      tr.classList.add('drag-over');
    });
    tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
    tr.addEventListener('drop', async (ev) => {
      ev.preventDefault();
      tr.classList.remove('drag-over');
      const targetId = tr.dataset.rowId;
      const sourceId = chulgoDragSourceId;
      chulgoDragSourceId = null;
      if (!sourceId || sourceId === targetId) return;
      await chulgoReorderRows(sourceId, targetId);
    });
  });
}

async function chulgoReorderRows(sourceId, targetId) {
  const ym = chulgoActiveMonth();
  const list = chulgoEntries.filter((x) => x.month === ym).sort((a, b) => (a.order || 0) - (b.order || 0));
  const fromIndex = list.findIndex((x) => x.id === sourceId);
  const toIndex = list.findIndex((x) => x.id === targetId);
  if (fromIndex === -1 || toIndex === -1) return;

  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  list.forEach((entry, i) => {
    entry.order = i; // optimistic — Firestore snapshot reconciles right after
  });
  renderChulgo();

  try {
    await Promise.all(list.map((entry) => window.api.updateChulgoEntry({ id: entry.id, order: entry.order })));
  } catch (err) {
    console.error('순서 변경 저장 실패:', err);
    showToast(chulgoFriendlyError(err));
  }
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
  // 이름만 다른 지점/상품 변형 — 연락처는 본점과 동일
  '신한카드(중고)': { call: '1544-7100', accident: '1544-7751', succession: '1544-7100' },
  '하나캐피탈(다이렉트)': { call: '1800-1110', accident: '1688-2040', succession: '02-2037-1390' },
  '현대캐피탈(특수)': { call: '1588-2114', accident: '1588-2114', succession: '1588-2114' },
  '현대캐피탈(영등포)': { call: '1588-2114', accident: '1588-2114', succession: '1588-2114' },
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

// 계약기간/주행거리/초기자금은 이제 표에 직접 치는 전용 칸(contractPeriod/mileage/
// initialFunds)이 있는데, 안내문자 생성기는 여전히 옛날 방식인 📝 메모 팝업 텍스트만
// 파싱하고 있어서 표에 적은 값을 못 읽어 왔다. 표 칸을 최우선으로 쓰고, 비어 있는
// 항목만 예전 메모 텍스트에서 뽑아온다(옛날 방식으로 적어둔 기존 건과 호환).
function chulgoResolveContractInfo_(e) {
  const memoParsed = chulgoParseMemo_(e.memo, Number(e.fee) || 0);
  const period = String(e.contractPeriod || '').trim() || memoParsed.period;
  const mileage = String(e.mileage || '').trim() || memoParsed.mileage;
  const initialFund = String(e.initialFunds || '').trim() || memoParsed.initialFund;
  return { period, mileage, initialFund };
}

// 차량가/수수료 등 큰 금액을 "8130만원"처럼 짧게, 딱 안 떨어지면 "1,325,978원"처럼 그대로.
function chulgoFormatMoneyShort_(amount) {
  const n = Number(amount) || 0;
  if (!n) return '';
  if (n % 10000 === 0) return `${Math.trunc(n / 10000)}만원`;
  return `${chulgoAddComma_(n)}원`;
}

// "0.7%" 처럼 소수점 1자리까지, 딱 떨어지면 "1%" 로 — 억지로 ".0" 을 안 붙인다.
function chulgoFormatPercent_(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

// 수수료보고용 — 금액이 있으면 "0.7% (580,115원)", 차량가가 없어서 %를 못 구하면
// 금액만, 아예 0/없음이면 "X".
function chulgoFeeReportLine_(amount, vehiclePrice) {
  const n = Number(amount) || 0;
  if (!n) return 'X';
  const pct = chulgoFormatPercent_(n, Number(vehiclePrice) || 0);
  const amountText = `${chulgoAddComma_(n)}원`;
  return pct != null ? `${pct}% (${amountText})` : amountText;
}

// 용품지원 항목들을 "탁송(-250,000)" 처럼 — 여러 개면 " / " 로 이어붙인다.
function chulgoExpensesReportLine_(expenses) {
  const items = (expenses || []).filter((it) => Number(it.amount) > 0);
  if (!items.length) return 'X';
  return items.map((it) => `${it.name || '용품'}(-${chulgoAddComma_(Number(it.amount) || 0)})`).join(' / ');
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
  document.getElementById('chulgo-carry-over').disabled = !entry;
}

// --- 이월하기: 선택된 건을 이전/다음 달로 옮긴다 (복사가 아니라 이동 — month 값만 바꾸면
// 원래 달 목록에서는 자동으로 빠지고, 대상 달 목록에는 자동으로 들어온다) ---
const chulgoCarryPopup = document.getElementById('chulgo-carry-popup');

document.getElementById('chulgo-carry-over').addEventListener('click', () => {
  if (!chulgoSelectedEntry()) return;
  chulgoCarryPopup.classList.remove('hidden');
});

document.getElementById('chulgo-carry-cancel').addEventListener('click', () => {
  chulgoCarryPopup.classList.add('hidden');
});

async function chulgoCarryOver(delta) {
  const entry = chulgoSelectedEntry();
  if (!entry) return;
  const targetMonth = chulgoShiftMonth(entry.month, delta);
  const order = chulgoEntries.filter((x) => x.month === targetMonth).length;
  chulgoCarryPopup.classList.add('hidden');
  try {
    await window.api.updateChulgoEntry({ id: entry.id, month: targetMonth, order });
  } catch (err) {
    console.error('이월 실패:', err);
    showToast(chulgoFriendlyError(err));
    return;
  }
  entry.month = targetMonth;
  entry.order = order;
  chulgoSelectedId = null; // moved out of the currently viewed month
  renderChulgo();
}

document.getElementById('chulgo-carry-prev').addEventListener('click', () => chulgoCarryOver(-1));
document.getElementById('chulgo-carry-next').addEventListener('click', () => chulgoCarryOver(1));

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
    showToast(chulgoFriendlyError(err));
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

// --- 정산 상세 팝업 (비용 항목 / 페이백 / 자유 메모) ---
// 여기 입력한 항목이 정산서의 "=150000+220000+280000" 수식과
// "쿠팡(-150,000) / 용품작업(-220,000)" 메모란으로 그대로 나간다.
const chulgoSettlePopup = document.getElementById('chulgo-settle-popup');
const chulgoSettleWho = document.getElementById('chulgo-settle-who');
const chulgoSettleExpensesEl = document.getElementById('chulgo-settle-expenses');
const chulgoSettlePaybacksEl = document.getElementById('chulgo-settle-paybacks');
const chulgoSettleMemoEl = document.getElementById('chulgo-settle-memo');
const chulgoSettlePreviewEl = document.getElementById('chulgo-settle-preview');
const chulgoSettleExtraFeesEl = document.getElementById('chulgo-settle-extrafees');
const chulgoSettlePromoEl = document.getElementById('chulgo-settle-promo');
const chulgoSettleAgencyFeeEl = document.getElementById('chulgo-settle-agencyfee');
const chulgoSettleVehiclePriceEl = document.getElementById('chulgo-settle-vehicle-price');
const chulgoSettleFeeRateEl = document.getElementById('chulgo-settle-fee-rate');
let chulgoSettleEditingId = null;
let chulgoSettleDraft = { expenses: [], paybacks: [], extraFees: [], vehiclePrice: 0, feeRate: '' };

const CHULGO_EXPENSE_PRESETS = [
  '용품비용', '용품작업', '쿠팡', 'GY캐리어', '캐리어월드', '고고탁송', '코일매트',
  '올인원패키지', '광택비', '성능점검비', '스타오토케어', '굿디', '운전자보험', '선팅', '블랙박스',
];

function chulgoSettleRowHTML(kind, item, i) {
  const opts = CHULGO_EXPENSE_PRESETS
    .map((p) => `<option value="${p}"></option>`)
    .join('');
  return `
    <div class="chulgo-settle-row" data-kind="${kind}" data-index="${i}">
      <input type="text" class="cs-name" list="chulgo-expense-presets" placeholder="항목명 (예: 쿠팡)"
             value="${(item.name || '').replace(/"/g, '&quot;')}">
      <input type="text" class="cs-amount chulgo-money" inputmode="numeric" placeholder="금액"
             value="${item.amount ? Number(item.amount).toLocaleString('ko-KR') : ''}">
      <button type="button" class="cs-del" title="삭제">✕</button>
      <datalist id="chulgo-expense-presets">${opts}</datalist>
    </div>`;
}

function chulgoExtraFeeRowHTML(item, i, total) {
  const placeholder = total <= 1 ? '수수료 (비우면 자동)' : `추가수수료${i + 1}`;
  const isPercent = item.type === 'percent';
  return `
    <div class="chulgo-settle-row chulgo-extrafee-row" data-index="${i}">
      <input type="text" class="cs-name" placeholder="${placeholder}"
             value="${(item.name || '').replace(/"/g, '&quot;')}">
      <select class="cs-type">
        <option value="percent" ${isPercent ? 'selected' : ''}>%</option>
        <option value="amount" ${!isPercent ? 'selected' : ''}>금액</option>
      </select>
      <input type="text" class="cs-value" inputmode="${isPercent ? 'decimal' : 'numeric'}"
             placeholder="${isPercent ? '예: 3' : '금액'}"
             value="${chulgoExtraFeeValueDisplay(item)}">
      <button type="button" class="cs-del" title="삭제">✕</button>
    </div>`;
}
function chulgoExtraFeeValueDisplay(item) {
  if (!item.value) return '';
  return item.type === 'percent' ? String(item.value) : Number(item.value).toLocaleString('ko-KR');
}

// 미리보기는 계산+innerHTML 재작성이 있어서, 글자 하나하나가 아니라 입력이 잠깐
// 멈췄을 때만 다시 그린다 — 초기 표시(팝업 열 때)나 클릭/선택 액션은 그대로 즉시.
const chulgoSettleRenderPreviewDebounced = debounce(() => chulgoSettleRenderPreview(), 200);

function chulgoSettleRenderLists() {
  chulgoSettleExpensesEl.innerHTML = chulgoSettleDraft.expenses.length
    ? chulgoSettleDraft.expenses.map((it, i) => chulgoSettleRowHTML('expenses', it, i)).join('')
    : '<div class="chulgo-mini-hint">항목이 없습니다. "+ 항목 추가"를 눌러주세요.</div>';
  chulgoSettlePaybacksEl.innerHTML = chulgoSettleDraft.paybacks.length
    ? chulgoSettleDraft.paybacks.map((it, i) => chulgoSettleRowHTML('paybacks', it, i)).join('')
    : '<div class="chulgo-mini-hint">항목이 없습니다.</div>';
  chulgoSettleExtraFeesEl.innerHTML = chulgoSettleDraft.extraFees.length
    ? chulgoSettleDraft.extraFees.map((it, i, arr) => chulgoExtraFeeRowHTML(it, i, arr.length)).join('')
    : '<div class="chulgo-mini-hint">항목이 없습니다. 금융사가 이번 달 추가로 주는 게 있으면 넣어주세요.</div>';
  chulgoSettlePromoEl.innerHTML = chulgoSettleDraft.promoItems.length
    ? chulgoSettleDraft.promoItems.map((it, i) => chulgoSettleRowHTML('promoItems', it, i)).join('')
    : '<div class="chulgo-mini-hint">항목이 없습니다. 프로모션이 여러 건이면 나눠서 적어주세요.</div>';
  chulgoSettleAgencyFeeEl.innerHTML = chulgoSettleDraft.agencyFeeItems.length
    ? chulgoSettleDraft.agencyFeeItems.map((it, i) => chulgoSettleRowHTML('agencyFeeItems', it, i)).join('')
    : '<div class="chulgo-mini-hint">항목이 없습니다.</div>';

  chulgoSettlePopup.querySelectorAll('.chulgo-settle-row:not(.chulgo-extrafee-row):not(.chulgo-settle-plain-row)').forEach((row) => {
    const kind = row.dataset.kind;
    const idx = Number(row.dataset.index);
    row.querySelector('.cs-name').addEventListener('input', (ev) => {
      chulgoSettleDraft[kind][idx].name = ev.target.value;
      chulgoSettleRenderPreviewDebounced();
    });
    const amt = row.querySelector('.cs-amount');
    amt.addEventListener('input', (ev) => {
      const raw = ev.target.value.replace(/[^\d]/g, '');
      ev.target.value = raw ? Number(raw).toLocaleString('ko-KR') : '';
      chulgoSettleDraft[kind][idx].amount = Number(raw) || 0;
      chulgoSettleRenderPreviewDebounced();
    });
    row.querySelector('.cs-del').addEventListener('click', () => {
      chulgoSettleDraft[kind].splice(idx, 1);
      chulgoSettleRenderLists();
      chulgoSettleRenderPreview();
    });
  });

  chulgoSettlePopup.querySelectorAll('.chulgo-extrafee-row').forEach((row) => {
    const idx = Number(row.dataset.index);
    const item = chulgoSettleDraft.extraFees[idx];
    row.querySelector('.cs-name').addEventListener('input', (ev) => {
      item.name = ev.target.value;
      chulgoSettleRenderPreviewDebounced();
    });
    row.querySelector('.cs-type').addEventListener('change', (ev) => {
      item.type = ev.target.value;
      chulgoSettleRenderLists();     // placeholder/inputmode 가 타입에 따라 달라져서 다시 그린다
      chulgoSettleRenderPreview();
    });
    row.querySelector('.cs-value').addEventListener('input', (ev) => {
      const isPercent = item.type === 'percent';
      const raw = isPercent
        ? ev.target.value.replace(/[^\d.]/g, '')
        : ev.target.value.replace(/[^\d]/g, '');
      ev.target.value = isPercent ? raw : (raw ? Number(raw).toLocaleString('ko-KR') : '');
      item.value = isPercent ? (Number(raw) || 0) : (Number(raw) || 0);
      chulgoSettleRenderPreviewDebounced();
    });
    row.querySelector('.cs-del').addEventListener('click', () => {
      chulgoSettleDraft.extraFees.splice(idx, 1);
      chulgoSettleRenderLists();
      chulgoSettleRenderPreview();
    });
  });
}

function chulgoSettleRenderPreview() {
  const entry = chulgoEntries.find((x) => x.id === chulgoSettleEditingId);
  if (!entry) return;
  const draft = {
    ...entry,
    expenses: chulgoSettleDraft.expenses,
    paybacks: chulgoSettleDraft.paybacks,
    extraFees: chulgoSettleDraft.extraFees,
    promoItems: chulgoSettleDraft.promoItems,
    agencyFeeItems: chulgoSettleDraft.agencyFeeItems,
    vehiclePrice: chulgoSettleDraft.vehiclePrice,
    settleMemo: chulgoSettleMemoEl.value,
  };
  const f = chulgoSettleFormulas(draft);
  const line = (label, v) => `<div><span>${label}</span><code>${v || '(비움)'}</code></div>`;
  chulgoSettlePreviewEl.innerHTML =
    line('H열 수수료', f.feeFormula) +
    line('J열 용품비', f.expenseFormula) +
    line('M열 페이백', f.paybackFormula) +
    line('메모란', f.memoText);
}

// 정산서에 실제로 들어갈 문자열을 만든다 (미리보기와 내보내기가 같은 함수를 쓴다).
function chulgoSettleFormulas(e) {
  const num = (v) => Number(v) || 0;
  const won = (v) => num(v).toLocaleString('ko-KR');

  const extraFees = chulgoExtraFeeItems(e).filter((it) => num(it.value) > 0);
  // '%' 항목은 계산해서 더하지 않고 메모란에 표기만 한다 — '금액' 항목만 H열에 더한다.
  const extraFeeAmountsForFee = extraFees.filter((it) => it.type !== 'percent').map((it) => num(it.value));

  const promoItems = chulgoPromoItems(e).filter((it) => num(it.amount) > 0);
  const agencyFeeItems = chulgoAgencyFeeItems(e).filter((it) => num(it.amount) > 0);
  // 항목이 하나라도 있으면 그 합계를 쓰고, 없으면(예전 단일값 데이터) 원래 값을 그대로 쓴다.
  const promoTotal = promoItems.length ? promoItems.reduce((a, it) => a + num(it.amount), 0) : num(e.promo);
  const agencyFeeTotal = agencyFeeItems.length
    ? agencyFeeItems.reduce((a, it) => a + num(it.amount), 0)
    : num(e.agencyFee);

  // 재광님 확인: 장부의 수수료/대리점수당/프로모션은 부가세 포함 금액으로 적고, 정산서
  // H열엔 그 값 그대로 넘긴다 — 어차피 나중에 사람이 직접 부가세 뺀 금액으로 최종
  // 수정하는 단계가 있어서, 여기서 미리 ÷1.1 해봤자 의미가 없다.
  const feeParts = [num(e.fee), agencyFeeTotal, promoTotal, ...extraFeeAmountsForFee].filter((v) => v > 0);
  const feeFormula = feeParts.length ? '=' + feeParts.join('+') : '';

  const expenses = chulgoExpenseItems(e).filter((it) => num(it.amount) > 0);
  const expenseFormula = expenses.length ? '=' + expenses.map((it) => num(it.amount)).join('+') : '';

  const paybacks = chulgoPaybackItems(e).filter((it) => num(it.amount) > 0);
  const paybackFormula = paybacks.length ? '=' + paybacks.map((it) => num(it.amount)).join('+') : '';

  // 메모란: 더하는 항목은 (금액), 빼는 항목은 (-금액). 리텐션 얘기는 여기 쓰지 않는다.
  // 대리점수당/프로모션은 항목이 있으면 각 항목 이름 그대로 하나씩 적고(예: "프로모션2(차량가
  // 1.2%)(96,000)"), 없으면(예전 단일값 데이터) 기존처럼 한 줄로 합쳐 적는다.
  const memoParts = [];
  if (agencyFeeItems.length) {
    agencyFeeItems.forEach((it, i) => {
      memoParts.push(`${chulgoItemizedLabel(it, i, agencyFeeItems.length, '대리점수당')}(${won(it.amount)})`);
    });
  } else if (num(e.agencyFee) > 0) {
    memoParts.push(`대리점수당(${won(e.agencyFee)})`);
  }
  if (promoItems.length) {
    promoItems.forEach((it, i) => {
      memoParts.push(`${chulgoItemizedLabel(it, i, promoItems.length, '프로모션')}(${won(it.amount)})`);
    });
  } else if (num(e.promo) > 0) {
    memoParts.push(`프로모션(${won(e.promo)})`);
  }
  extraFees.forEach((it, i) => {
    const label = chulgoExtraFeeLabel(it, i, extraFees.length);
    const shown = it.type === 'percent' ? `${num(it.value)}%` : won(it.value);
    memoParts.push(`${label}(${shown})`);
  });
  expenses.forEach((it) => memoParts.push(`${it.name || '항목'}(-${won(it.amount)})`));
  paybacks.forEach((it) => memoParts.push(`${it.name || '페이백'}(-${won(it.amount)})`));
  if (e.settleMemo) memoParts.push(e.settleMemo);

  return { feeFormula, expenseFormula, paybackFormula, memoText: memoParts.join(' / ') };
}

// 표 칸이 이제 읽기전용이라, 항목 배열이 비어있는데 예전 단일값(직접입력 시절 데이터)만
// 있는 경우는 그 값을 항목 하나로 미리 채워서 팝업을 열어준다 — 안 그러면 예전 값이
// "항목이 없습니다"에 가려져 안 보이고, 아무 수정도 없이 저장하면 0으로 지워질 수 있다.
function chulgoDraftItemsFor(entry, itemsFn, legacyKey, defaultName) {
  const items = itemsFn(entry).map((it) => ({ ...it }));
  if (items.length) return items;
  const legacy = Number(entry[legacyKey]) || 0;
  return legacy > 0 ? [{ name: defaultName, amount: legacy }] : [];
}

function openChulgoSettleDetail(id) {
  const entry = chulgoEntries.find((x) => x.id === id);
  if (!entry) return;
  chulgoSettleEditingId = id;
  chulgoSettleDraft = {
    expenses: chulgoDraftItemsFor(entry, chulgoExpenseItems, 'supplies', '용품비'),
    paybacks: chulgoPaybackItems(entry).map((it) => ({ ...it })),
    extraFees: chulgoExtraFeeItems(entry).map((it) => ({ ...it })),
    promoItems: chulgoDraftItemsFor(entry, chulgoPromoItems, 'promo', '프로모션'),
    agencyFeeItems: chulgoDraftItemsFor(entry, chulgoAgencyFeeItems, 'agencyFee', '대리점수당'),
    vehiclePrice: Number(entry.vehiclePrice) || 0,
  };
  chulgoSettleWho.textContent = [entry.name, entry.car].filter(Boolean).join(' / ') || '(이름 없음)';
  chulgoSettleMemoEl.value = entry.settleMemo || '';
  chulgoSettleVehiclePriceEl.value = chulgoFormatMoneyDisplay(entry.vehiclePrice);
  chulgoSettleFeeRateEl.value = entry.feeRate != null && entry.feeRate !== '' ? entry.feeRate : '';
  chulgoSettleRenderLists();
  chulgoSettleRenderPreview();
  chulgoSettlePopup.classList.remove('hidden');
}

document.getElementById('chulgo-settle-add-expense').addEventListener('click', () => {
  chulgoSettleDraft.expenses.push({ name: '', amount: 0 });
  chulgoSettleRenderLists();
});
document.getElementById('chulgo-settle-add-payback').addEventListener('click', () => {
  chulgoSettleDraft.paybacks.push({ name: '페이백', amount: 0 });
  chulgoSettleRenderLists();
});
document.getElementById('chulgo-settle-add-extrafee').addEventListener('click', () => {
  chulgoSettleDraft.extraFees.push({ name: '', type: 'percent', value: 0 });
  chulgoSettleRenderLists();
});
document.getElementById('chulgo-settle-add-promo').addEventListener('click', () => {
  chulgoSettleDraft.promoItems.push({ name: '', amount: 0 });
  chulgoSettleRenderLists();
});
document.getElementById('chulgo-settle-add-agencyfee').addEventListener('click', () => {
  chulgoSettleDraft.agencyFeeItems.push({ name: '', amount: 0 });
  chulgoSettleRenderLists();
});
chulgoSettleMemoEl.addEventListener('input', chulgoSettleRenderPreviewDebounced);
chulgoSettleVehiclePriceEl.addEventListener('focus', () => {
  chulgoSettleVehiclePriceEl.value = chulgoParseMoneyRaw(chulgoSettleVehiclePriceEl.value) || '';
});
chulgoSettleVehiclePriceEl.addEventListener('input', () => {
  const raw = chulgoSettleVehiclePriceEl.value.replace(/[^\d]/g, '');
  chulgoSettleVehiclePriceEl.value = raw;
  chulgoSettleDraft.vehiclePrice = Number(raw) || 0;
  chulgoSettleRenderPreviewDebounced();
});
chulgoSettleVehiclePriceEl.addEventListener('blur', () => {
  chulgoSettleVehiclePriceEl.value = chulgoFormatMoneyDisplay(chulgoSettleDraft.vehiclePrice);
});
chulgoSettleFeeRateEl.addEventListener('input', () => {
  chulgoSettleFeeRateEl.value = chulgoSettleFeeRateEl.value.replace(/[^\d.]/g, '');
});

document.getElementById('chulgo-settle-save').addEventListener('click', async () => {
  if (!chulgoSettleEditingId) return;
  const id = chulgoSettleEditingId;
  const expenses = chulgoSettleDraft.expenses.filter((it) => (Number(it.amount) || 0) > 0);
  const paybacks = chulgoSettleDraft.paybacks.filter((it) => (Number(it.amount) || 0) > 0);
  const extraFees = chulgoSettleDraft.extraFees.filter((it) => (Number(it.value) || 0) > 0);
  const promoItems = chulgoSettleDraft.promoItems.filter((it) => (Number(it.amount) || 0) > 0);
  const agencyFeeItems = chulgoSettleDraft.agencyFeeItems.filter((it) => (Number(it.amount) || 0) > 0);
  const settleMemo = chulgoSettleMemoEl.value;
  const vehiclePrice = chulgoParseMoneyRaw(chulgoSettleVehiclePriceEl.value) || 0;
  const feeRateRaw = chulgoSettleFeeRateEl.value;
  const feeRate = feeRateRaw === '' ? '' : Number(feeRateRaw) || 0;

  const entry = chulgoEntries.find((x) => x.id === id);
  const payload = { id, expenses, paybacks, extraFees, promoItems, agencyFeeItems, settleMemo, vehiclePrice, feeRate };
  // 장부의 용품비/프로모션/대리점수당 칸은 각 항목 합계와 맞춰준다 — 단, 항목을 한 번도
  // 안 쓴 건은 장부에 직접 적어둔 값을 0으로 덮어쓰면 안 된다 (그냥 저장만 눌러도 지워졌었다).
  if (expenses.length || (entry && chulgoExpenseItems(entry).length)) {
    payload.supplies = expenses.reduce((a, it) => a + (Number(it.amount) || 0), 0);
  }
  if (promoItems.length || (entry && chulgoPromoItems(entry).length)) {
    payload.promo = promoItems.reduce((a, it) => a + (Number(it.amount) || 0), 0);
  }
  if (agencyFeeItems.length || (entry && chulgoAgencyFeeItems(entry).length)) {
    payload.agencyFee = agencyFeeItems.reduce((a, it) => a + (Number(it.amount) || 0), 0);
  }
  try {
    await window.api.updateChulgoEntry(payload);
  } catch (err) {
    console.error('정산 상세 저장 실패:', err);
    showToast(chulgoFriendlyError(err));
    return;
  }
  if (entry) {
    Object.assign(entry, { expenses, paybacks, extraFees, promoItems, agencyFeeItems, settleMemo, vehiclePrice, feeRate });
    if (payload.supplies !== undefined) entry.supplies = payload.supplies;
    if (payload.promo !== undefined) entry.promo = payload.promo;
    if (payload.agencyFee !== undefined) entry.agencyFee = payload.agencyFee;
  }
  chulgoSettlePopup.classList.add('hidden');
  renderChulgo();
});

document.getElementById('chulgo-settle-cancel').addEventListener('click', () => {
  chulgoSettlePopup.classList.add('hidden');
});

// --- AI로 장부 채우기 ---
// 자연어로 붙여넣으면 OpenAI가 어느 건인지 찾고 항목들을 구조화해서 돌려준다.
// 여기서는 그 결과를 미리보기로만 보여주고, "적용"을 눌러야 실제로 저장된다
// (AI가 엉뚱한 건을 잘못 골랐을 수 있으니 바로 쓰지 않는다).
const chulgoAiFillPopup = document.getElementById('chulgo-ai-fill-popup');
const chulgoAiFillText = document.getElementById('chulgo-ai-fill-text');
const chulgoAiFillStatus = document.getElementById('chulgo-ai-fill-status');
const chulgoAiFillPreviewEl = document.getElementById('chulgo-ai-fill-preview');
const chulgoAiFillApplyBtn = document.getElementById('chulgo-ai-fill-apply');
let chulgoAiFillResult = null;

function chulgoAiFillItemsHTML(label, items) {
  if (!items || !items.length) return '';
  const lines = items
    .map((it) => {
      const shown = it.type ? (it.type === 'percent' ? `${it.value}%` : chulgoWon(Number(it.value) || 0)) : chulgoWon(Number(it.amount) || 0);
      return `${escapeHtml(it.name || '(이름 없음)')}: ${shown}`;
    })
    .join('<br>');
  return `<div class="chulgo-ai-fill-row"><strong>${label}</strong><div>${lines}</div></div>`;
}

function chulgoAiFillBasicFieldsHTML(r) {
  let html = '';
  if (r.name) html += `<div class="chulgo-ai-fill-row"><strong>고객명</strong><div>${escapeHtml(r.name)}</div></div>`;
  if (r.car) html += `<div class="chulgo-ai-fill-row"><strong>차종</strong><div>${escapeHtml(r.car)}</div></div>`;
  if (r.company) {
    const isNonPartner = CHULGO_NONPARTNER_COMPANIES.includes(r.company);
    html += `<div class="chulgo-ai-fill-row"><strong>금융사</strong><div>${escapeHtml(r.company)}</div></div>`;
    html += `<div class="chulgo-ai-fill-row"><strong>비제휴/리텐션</strong><div>${isNonPartner ? '비제휴' : '제휴'} / 리텐션 자동 체크</div></div>`;
  }
  if (r.finType) html += `<div class="chulgo-ai-fill-row"><strong>금융정보</strong><div>${escapeHtml(r.finType)}</div></div>`;
  if (r.vehiclePrice != null) html += `<div class="chulgo-ai-fill-row"><strong>차량가</strong><div>${chulgoWon(r.vehiclePrice)}</div></div>`;
  if (r.contractPeriod) html += `<div class="chulgo-ai-fill-row"><strong>계약기간</strong><div>${escapeHtml(r.contractPeriod)}</div></div>`;
  if (r.mileage) html += `<div class="chulgo-ai-fill-row"><strong>주행거리</strong><div>${escapeHtml(chulgoNormalizeMileage(r.mileage))}</div></div>`;
  if (r.initialFunds) html += `<div class="chulgo-ai-fill-row"><strong>초기자금</strong><div>${escapeHtml(r.initialFunds)}</div></div>`;
  return html;
}

function chulgoAiFillFinancialFieldsHTML(r) {
  let html = '';
  if (r.fee != null) html += `<div class="chulgo-ai-fill-row"><strong>실 수수료</strong><div>${chulgoWon(r.fee)}</div></div>`;
  html += chulgoAiFillItemsHTML('용품비', r.expenses);
  html += chulgoAiFillItemsHTML('페이백', r.paybacks);
  html += chulgoAiFillItemsHTML('대리점수당', r.agencyFeeItems);
  html += chulgoAiFillItemsHTML('프로모션', r.promoItems);
  html += chulgoAiFillItemsHTML('추가수수료', r.extraFees);
  if (r.settleMemo) html += `<div class="chulgo-ai-fill-row"><strong>메모 추가</strong><div>${escapeHtml(r.settleMemo)}</div></div>`;
  return html;
}

// create/update 공용 — 항목 배열을 넣을 때 합계(supplies/promo/agencyFee)도 같이 채운다.
// settleMemo는 create/update에서 의미가 달라서(새로 쓰기 vs 기존에 이어붙이기) 여기 포함 안 한다.
function chulgoAiFillBuildPayload(r) {
  const payload = {};
  if (r.name != null) payload.name = r.name;
  if (r.car != null) payload.car = r.car;
  if (r.company != null) {
    payload.company = r.company;
    // AI가 판단하게 두지 않고 여기서 확정적으로 계산한다 — 회사명만 정확히 뽑히면
    // 매번 똑같이 정확하게 나온다(AI한테 맡기면 가끔 놓칠 수 있어서).
    payload.nonPartner = CHULGO_NONPARTNER_COMPANIES.includes(r.company);
    payload.retention = true;
  }
  if (r.finType != null) payload.finType = r.finType;
  if (r.vehiclePrice != null) payload.vehiclePrice = Number(r.vehiclePrice) || 0;
  if (r.contractPeriod != null) payload.contractPeriod = r.contractPeriod;
  if (r.mileage != null) payload.mileage = chulgoNormalizeMileage(r.mileage);
  if (r.initialFunds != null) payload.initialFunds = r.initialFunds;
  if (r.fee != null) payload.fee = Number(r.fee) || 0;
  if (r.expenses) {
    payload.expenses = r.expenses.map((it) => ({ name: it.name || '', amount: Number(it.amount) || 0 }));
    payload.supplies = payload.expenses.reduce((a, it) => a + it.amount, 0);
  }
  if (r.paybacks) {
    payload.paybacks = r.paybacks.map((it) => ({ name: it.name || '', amount: Number(it.amount) || 0 }));
  }
  if (r.agencyFeeItems) {
    payload.agencyFeeItems = r.agencyFeeItems.map((it) => ({ name: it.name || '', amount: Number(it.amount) || 0 }));
    payload.agencyFee = payload.agencyFeeItems.reduce((a, it) => a + it.amount, 0);
  }
  if (r.promoItems) {
    payload.promoItems = r.promoItems.map((it) => ({ name: it.name || '', amount: Number(it.amount) || 0 }));
    payload.promo = payload.promoItems.reduce((a, it) => a + it.amount, 0);
  }
  if (r.extraFees) {
    payload.extraFees = r.extraFees.map((it) => ({
      name: it.name || '',
      type: it.type === 'percent' ? 'percent' : 'amount',
      value: Number(it.value) || 0,
    }));
  }
  return payload;
}

document.getElementById('chulgo-ai-fill-btn').addEventListener('click', () => {
  chulgoAiFillText.value = '';
  chulgoAiFillStatus.textContent = '';
  chulgoAiFillPreviewEl.innerHTML = '';
  chulgoAiFillApplyBtn.disabled = true;
  chulgoAiFillResult = null;
  chulgoAiFillPopup.classList.remove('hidden');
});

document.getElementById('chulgo-ai-fill-cancel').addEventListener('click', () => {
  chulgoAiFillPopup.classList.add('hidden');
});

document.getElementById('chulgo-ai-fill-analyze').addEventListener('click', async () => {
  const text = chulgoAiFillText.value.trim();
  if (!text) {
    chulgoAiFillStatus.textContent = '내용을 입력해주세요.';
    return;
  }

  const ym = chulgoActiveMonth();
  const candidates = chulgoEntries
    .filter((e) => e.month === ym)
    .map((e) => ({ id: e.id, name: e.name, car: e.car, company: e.company }));

  chulgoAiFillStatus.textContent = '분석 중...';
  chulgoAiFillPreviewEl.innerHTML = '';
  chulgoAiFillApplyBtn.disabled = true;
  chulgoAiFillResult = null;

  try {
    const result = await window.api.aiFillChulgo({
      text,
      candidates,
      companyList: CHULGO_COMPANY_LIST,
      financeAliases: CHULGO_FINANCE_ALIAS,
    });

    if (result.action === 'create') {
      chulgoAiFillResult = result;
      chulgoAiFillStatus.textContent = '';
      let html = '<div class="chulgo-ai-fill-row"><strong>동작</strong><div>새 출고 건 추가</div></div>';
      html += chulgoAiFillBasicFieldsHTML(result);
      html += chulgoAiFillFinancialFieldsHTML(result);
      if (result.notes) html += `<div class="chulgo-ai-fill-row chulgo-mini-hint"><strong>AI 참고사항</strong><div>${escapeHtml(result.notes)}</div></div>`;
      chulgoAiFillPreviewEl.innerHTML = html;
      chulgoAiFillApplyBtn.disabled = false;
      return;
    }

    if (result.action === 'update') {
      const matched = chulgoEntries.find((e) => e.id === result.matchedEntryId);
      if (!matched) {
        chulgoAiFillStatus.textContent = `어느 건인지 확실하지 않아요. 고객명/차종을 더 명확히 적어주세요.${result.notes ? ` (${result.notes})` : ''}`;
        return;
      }
      chulgoAiFillResult = result;
      chulgoAiFillStatus.textContent = '';
      let html = `<div class="chulgo-ai-fill-row"><strong>대상(수정)</strong><div>${escapeHtml([matched.name, matched.car].filter(Boolean).join(' / '))}</div></div>`;
      html += chulgoAiFillBasicFieldsHTML(result);
      html += chulgoAiFillFinancialFieldsHTML(result);
      if (result.notes) html += `<div class="chulgo-ai-fill-row chulgo-mini-hint"><strong>AI 참고사항</strong><div>${escapeHtml(result.notes)}</div></div>`;
      chulgoAiFillPreviewEl.innerHTML = html || '<div class="chulgo-mini-hint">바뀌는 항목이 없습니다.</div>';
      chulgoAiFillApplyBtn.disabled = false;
      return;
    }

    // action === 'unclear' — 새 건인지 기존 건 수정인지 AI가 확신 못 함. 억지로 적용하지 않는다.
    chulgoAiFillStatus.textContent = `새 건 추가인지 기존 건 수정인지 확실하지 않아요.${result.notes ? ` (${result.notes})` : ' "새로 추가해줘" 처럼 명확히 적어주세요.'}`;
  } catch (err) {
    console.error('AI 분석 실패:', err);
    chulgoAiFillStatus.textContent = (err.message || '').includes('OPENAI_NOT_CONFIGURED')
      ? 'OpenAI API 키가 아직 설정되지 않았습니다. config/config.json의 openai.apiKey를 채워주세요.'
      : `분석 실패: ${err.message || '알 수 없는 오류'}`;
  }
});

document.getElementById('chulgo-ai-fill-apply').addEventListener('click', async () => {
  if (!chulgoAiFillResult) return;
  const r = chulgoAiFillResult;
  chulgoAiFillApplyBtn.disabled = true;

  if (r.action === 'create') {
    const ym = chulgoActiveMonth();
    const order = chulgoEntries.filter((x) => x.month === ym).length;
    const payload = { month: ym, order, status: '-', countsQuota: true, ...chulgoAiFillBuildPayload(r) };
    if (r.settleMemo) payload.settleMemo = r.settleMemo;
    if (!payload.finType) payload.finType = '렌트';
    // 할부 등은 원문에 주행거리 언급이 아예 없는 경우가 많다 — AI가 억지로 추측해서
    // 엉뚱한 값을 매핑하다 오류나는 것보다, 새로 만드는 건에 한해 'X'(해당없음)로
    // 비워둔다(기존 건 업데이트는 여기 안 타서 이미 적어둔 값을 지우지 않는다).
    if (!payload.mileage) payload.mileage = 'X';
    try {
      await window.api.createChulgoEntry(payload);
    } catch (err) {
      console.error('AI 추가 실패:', err);
      showToast(chulgoFriendlyError(err));
      chulgoAiFillApplyBtn.disabled = false;
      return;
    }
    chulgoAiFillPopup.classList.add('hidden');
    return; // 새 건은 Firestore 실시간 동기화로 곧 목록에 나타난다
  }

  if (r.action === 'update' && r.matchedEntryId) {
    const id = r.matchedEntryId;
    const entry = chulgoEntries.find((e) => e.id === id);
    if (!entry) {
      chulgoAiFillApplyBtn.disabled = false;
      return;
    }
    const payload = { id, ...chulgoAiFillBuildPayload(r) };
    if (r.settleMemo) {
      payload.settleMemo = entry.settleMemo ? `${entry.settleMemo} / ${r.settleMemo}` : r.settleMemo;
    }
    try {
      await window.api.updateChulgoEntry(payload);
    } catch (err) {
      console.error('AI 적용 실패:', err);
      showToast(chulgoFriendlyError(err));
      chulgoAiFillApplyBtn.disabled = false;
      return;
    }
    Object.assign(entry, payload);
    chulgoAiFillPopup.classList.add('hidden');
    renderChulgo();
  }
});

// --- 정산서 만들기 ---
// 정산서 줄 순서는 "렌트·리스 → (빈 줄) → 비제휴 → (빈 줄) → 할부·일시불" 이고,
// 각 묶음 안에서는 장부에 적어둔 순서를 그대로 따른다 (렌트만 몰아 쓰지 않는다).
function chulgoSettlementGroup(e) {
  if (e.nonPartner) return 1;
  return e.finType === '렌트' || e.finType === '리스' ? 0 : 2;
}

function chulgoBuildSettlementRows(list) {
  const groups = [[], [], []];
  list.forEach((e) => {
    const f = chulgoSettleFormulas(e);
    const base = {
      dbType: e.dbType || '',
      company: e.company || '',
      finType: e.finType || '',
      name: e.name || '',
      car: e.car || '',
      vehiclePrice: Number(e.vehiclePrice) || 0,
    };
    groups[chulgoSettlementGroup(e)].push({
      ...base,
      feeFormula: f.feeFormula,
      expenseFormula: f.expenseFormula,
      paybackFormula: f.paybackFormula,
      memoText: f.memoText,
      retention: !!e.retention,
    });
    // "2대 인정" 같은 건 같은 내용을 그 수만큼 더 쓰되, 급여가 곱절이 되지 않도록
    // 둘째 줄부터는 금액칸을 비운다.
    for (let k = 1; k < chulgoRecognizedUnits(e); k++) {
      groups[chulgoSettlementGroup(e)].push({ ...base, extraUnitRow: true });
    }
  });

  const out = [];
  groups.forEach((g) => {
    if (!g.length) return;
    if (out.length) out.push({ blank: true });   // 묶음 사이 한 줄 비우기
    out.push(...g);
  });
  return out;
}

const chulgoSettlementPopup = document.getElementById('chulgo-settlement-popup');
const chulgoRetentionStartEl = document.getElementById('chulgo-retention-start');
const chulgoUnsettledCountEl = document.getElementById('chulgo-unsettled-count');

function chulgoSettlementRows() {
  const ym = chulgoActiveMonth();
  const list = chulgoEntries.filter((e) => e.month === ym).sort((a, b) => (a.order || 0) - (b.order || 0));
  return { ym, list, rows: chulgoBuildSettlementRows(list) };
}

// 정산서에 실제로 들어갈 값을 행 단위로 계산한다 (미리보기와 내보내기가 같은 규칙을 쓴다).
function chulgoSettlementPlan() {
  const { ym, list, rows } = chulgoSettlementRows();
  const start = Number(chulgoRetentionStartEl.value) || 0;
  const reset = document.querySelector('input[name="retention-mode"]:checked').value === 'reset';

  let n = start;
  let hit100 = false;
  const nums = [];
  const plan = rows.map((r, i) => {
    const sheetRow = 7 + i;
    const out = { ...r, sheetRow, no: sheetRow - 6 };
    if (r.blank || r.extraUnitRow || !r.retention) return out;
    n += 1;
    if (n === 100) hit100 = true;
    nums.push(n);
    out.retentionNo = n;
    out.carFee = -(50000 + Math.floor(Math.max(0, n - 1) / 100) * 10000);
    if (n >= 100 && reset) n = 0;
    return out;
  });
  return { ym, list, rows, plan, nums, hit100, retentionEnd: n };
}

const CHULGO_PROMO_TIERS_UI = {
  주임: [[5, '주임_5대이상'], [8, '주임_8대이상'], [12, '주임_12대이상'], [15, '주임_15대이상']],
  대리: [[7, '대리_7대이상'], [9, '대리_9대이상'], [12, '대리_12대이상'], [15, '대리_15대이상'],
        [18, '대리_18대이상'], [21, '대리_21대이상']],
  기본: [[9, '과장_9대이상'], [12, '과장_12대이상'], [15, '과장_15대이상'], [18, '과장_18대이상'],
        [21, '과장_21대이상'], [24, '과장_24대이상']],
};
function chulgoPromoLabelUI(position, units) {
  const tiers = CHULGO_PROMO_TIERS_UI[position] || CHULGO_PROMO_TIERS_UI.기본;
  let label = '미달성';
  for (const [need, name] of tiers) if (units >= need) label = name;
  return label;
}

function chulgoRenderSettlementSummary() {
  const { ym, list, rows, plan, nums, hit100 } = chulgoSettlementPlan();

  const retPreview = document.getElementById('chulgo-retention-preview');
  retPreview.textContent = nums.length
    ? `이번 달 부여: ${nums[0]}회 ~ ${nums[nums.length - 1]}회 (${nums.length}건)`
        + (hit100 ? '  ※ 100회 도달 — 33행에 천만원이 들어갑니다' : '')
    : '⚠ 리텐션 체크된 건이 없습니다 — 개인차비(-50,000)와 리텐션 횟수가 비어서 나갑니다.'
      + ' 장부의 "리텐션" 칸을 체크해주세요 (머리글 체크박스로 한 번에 켤 수 있습니다).';
  retPreview.classList.toggle('chulgo-warn', nums.length === 0);

  const filled = rows.filter((r) => !r.blank).length;
  const units = chulgoCountedUnits(list);
  const stipend = { 차장: 1000000, 팀장: 2000000 }[chulgoPosition] || 0;
  const line = (l, v) => `<div><span>${l}</span><code>${v}</code></div>`;
  document.getElementById('chulgo-settlement-summary').innerHTML =
    line('대상 월', chulgoMonthLabel(ym))
    + line('정산서 줄수', `${filled}줄 (빈 줄 포함 ${rows.length}줄 / 최대 23줄)`)
    + line('인정 대수', `${units}대 → 프로모션 "${chulgoPromoLabelUI(chulgoPosition, units)}"`)
    + line('직책수당', stipend ? `H30 = ${stipend.toLocaleString('ko-KR')} (실지급 ${(stipend / 2).toLocaleString('ko-KR')})` : '없음 (과장 이하)')
    + line('리텐션 보너스', hit100 ? 'H33 = 10,000,000' : '없음');

  // --- 실제 셀 미리보기 표 ---
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const money = (v) => (v ? Number(v).toLocaleString('ko-KR') : '');
  const body = plan.map((r) => {
    if (r.blank) {
      return `<tr class="sp-blank"><td>${r.sheetRow}</td><td colspan="12">— 묶음 구분 빈 줄 —</td></tr>`;
    }
    return `<tr${r.extraUnitRow ? ' class="sp-extra"' : ''}>
      <td>${r.sheetRow}</td>
      <td>${esc(r.dbType)}</td>
      <td>${esc(r.company)}</td>
      <td>${esc(r.finType)}</td>
      <td class="sp-name">${esc(r.name)}</td>
      <td>${esc(r.car)}</td>
      <td class="sp-num">${money(r.vehiclePrice)}</td>
      <td class="sp-formula">${esc(r.feeFormula)}</td>
      <td class="sp-formula">${esc(r.expenseFormula)}</td>
      <td class="sp-formula">${esc(r.paybackFormula)}</td>
      <td class="sp-num">${r.carFee ? money(r.carFee) : ''}</td>
      <td class="sp-memo">${esc(r.memoText)}</td>
      <td>${r.extraUnitRow ? '' : 'X'}</td>
      <td>${r.retentionNo ? r.retentionNo + '회' : ''}</td>
    </tr>`;
  }).join('');

  document.getElementById('chulgo-settlement-preview').innerHTML = `
    <table class="chulgo-settlement-preview-table">
      <thead><tr>
        <th>행</th><th>DB경로</th><th>진행금융사</th><th>상품</th><th>대표자명</th><th>차종</th>
        <th>차량가액<br>G</th><th>수수료<br>H</th><th>용품비<br>J</th><th>페이백<br>M</th>
        <th>개인차비<br>S</th><th>메모란</th><th>0p</th><th>리텐션</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

document.getElementById('chulgo-settlement-btn').addEventListener('click', async () => {
  const { ym, list, rows } = chulgoSettlementRows();
  if (!list.length) {
    showToast('이 달에는 출고 건이 없습니다.');
    return;
  }
  if (rows.filter((r) => !r.blank).length > 23) {
    showToast(`정산서에 들어갈 수 있는 줄은 23줄인데 ${rows.filter((r) => !r.blank).length}줄이 필요합니다.\n인정 대수를 확인해주세요.`);
    return;
  }

  document.getElementById('chulgo-settlement-title').textContent =
    `${currentUser.displayName || ''}${chulgoPosition} / ${chulgoMonthLabel(ym)} 출고분`;

  let saved = 0;
  try {
    saved = await window.api.getRetentionCount();
  } catch (_e) { /* 저장된 값이 없으면 0부터 */ }
  chulgoRetentionStartEl.value = saved;
  document.getElementById('chulgo-retention-count').textContent = `(앱에 저장된 값: ${saved}회)`;

  // 미정산 대수 = 다음 달 장부의 총 건수 (인정 여부와 무관)
  const nextYm = chulgoShiftMonth(ym, 1);
  chulgoUnsettledCountEl.value = chulgoEntries.filter((e) => e.month === nextYm).length;

  chulgoRenderSettlementSummary();
  chulgoSettlementPopup.classList.remove('hidden');
});

chulgoRetentionStartEl.addEventListener('input', debounce(chulgoRenderSettlementSummary, 200));
document.querySelectorAll('input[name="retention-mode"]').forEach((el) =>
  el.addEventListener('change', chulgoRenderSettlementSummary));

document.getElementById('chulgo-settlement-cancel').addEventListener('click', () => {
  chulgoSettlementPopup.classList.add('hidden');
});

document.getElementById('chulgo-settlement-export').addEventListener('click', async () => {
  const btn = document.getElementById('chulgo-settlement-export');
  const { ym, list, rows } = chulgoSettlementPlan();
  const reset = document.querySelector('input[name="retention-mode"]:checked').value === 'reset';

  btn.disabled = true;
  try {
    const result = await window.api.exportSettlement({
      yearMonth: ym,
      staffName: currentUser.displayName || '',
      position: chulgoPosition,
      rows,
      promoUnits: chulgoCountedUnits(list),
      unsettledCount: Number(chulgoUnsettledCountEl.value) || 0,
      retentionStart: Number(chulgoRetentionStartEl.value) || 0,
      retentionResetAt100: reset,
    });
    if (result.error) {
      showToast(result.error);
      return;
    }
    if (!result.canceled) {
      // 다음 달에 이어서 번호를 매길 수 있도록 끝 번호를 저장해둔다.
      await window.api.setRetentionCount(result.retentionEnd);
      chulgoSettlementPopup.classList.add('hidden');
      showToast(`저장했습니다.\n${result.filePath}`);
    }
  } catch (err) {
    console.error('정산서 내보내기 실패:', err);
    showToast('정산서를 만드는 데 실패했습니다.\n' + (err && err.message ? err.message : ''));
  } finally {
    btn.disabled = false;
  }
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
차량가액 : ${chulgoFormatMoneyShort_(e.vehiclePrice)}
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
차량가액 : ${chulgoFormatMoneyShort_(e.vehiclePrice)}
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
  const parsed = chulgoResolveContractInfo_(e);
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
    showToast(`차종 "${e.car || ''}"이(가) 제네시스/현대/기아로 판별되지 않았습니다.\n다른 브랜드 커넥티드 안내 영상 링크를 알려주시면 추가해드릴게요.`);
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
  const parsed = chulgoResolveContractInfo_(e);
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

document.getElementById('chulgo-gen-fee-report').addEventListener('click', () => {
  const e = chulgoSelectedEntry();
  if (!e) return;
  const promoTotal = (e.promoItems || []).reduce((a, it) => a + (Number(it.amount) || 0), 0);
  const agencyTotal = (e.agencyFeeItems || []).reduce((a, it) => a + (Number(it.amount) || 0), 0);

  chulgoShowResult(
    '수수료보고',
    `- 고객명 : ${e.name || '-'}
- 금융사 : ${e.company || '-'}
- 상품 : ${e.finType || '-'}
- 차종 : ${e.car || '-'}
- 차량가 : ${chulgoFormatMoneyShort_(e.vehiclePrice) || '-'}
- 수수료 : ${chulgoFeeReportLine_(e.fee, e.vehiclePrice)}
- 프로모션 : ${chulgoFeeReportLine_(promoTotal, e.vehiclePrice)}
- 대리점 수당 : ${chulgoFeeReportLine_(agencyTotal, e.vehiclePrice)}
- 용품지원 : ${chulgoExpensesReportLine_(e.expenses)}`
  );
});

// --- 출고현황 미리보기 + 엑셀로 저장 ---
// 엑셀에만 필요한 값(투입일/차량가격/CM·AG/대리점/비고)은 장부 자체엔 없는 필드라,
// 여기서만 편집한다 — 편집 즉시 계정(Firestore)에 저장되고, "엑셀로 저장"을
// 눌렀을 때 그 시점 값 그대로 실제 파일로 나간다.
const chulgoExcelPopup = document.getElementById('chulgo-excel-popup');
const chulgoExcelMonthLabel = document.getElementById('chulgo-excel-month-label');
const chulgoExcelTableWrap = document.getElementById('chulgo-excel-table-wrap');

// 대리점 여부는 별도 체크박스가 아니라, 장부의 "대리점수당" 칸에 금액이 있는지로 자동 판정한다.
function chulgoHasAgency(e) {
  return Number(e.agencyFee) > 0;
}

function chulgoDefaultRemark(e) {
  const hasPromo = Number(e.promo) > 0;
  const hasAgency = chulgoHasAgency(e);
  if (hasPromo && hasAgency) return '추가수수료 % / 대리점';
  if (hasAgency) return '대리점';
  if (hasPromo) return '추가수수료 %';
  return '';
}

function renderChulgoExcelPreview() {
  const ym = chulgoActiveMonth();
  const list = chulgoEntries.filter((e) => e.month === ym).sort((a, b) => (a.order || 0) - (b.order || 0));
  chulgoExcelMonthLabel.textContent = `${chulgoMonthLabel(ym)} — ${list.length}건`;

  const rows = list
    .map(
      (e, i) => `
    <tr data-id="${e.id}">
      <td class="chulgo-check-cell">${i + 1}</td>
      <td>${escapeHtml(e.dbType || '')}</td>
      <td>${escapeHtml(e.company || '')}</td>
      <td>${escapeHtml(e.finType || '')}</td>
      <td>${escapeHtml(e.name || '')}</td>
      <td>${escapeHtml(e.car || '')}</td>
      <td><input type="text" data-key="deployDate" value="${(e.deployDate || '').replace(/"/g, '&quot;')}" placeholder="예: 7월 31일 예정"></td>
      <td><input class="chulgo-money" type="text" inputmode="numeric" data-key="vehiclePrice" value="${chulgoFormatMoneyDisplay(e.vehiclePrice)}" placeholder="0"></td>
      <td class="chulgo-computed">${chulgoWon(Number(e.fee) || 0)}</td>
      <td>
        <input class="chulgo-rate" type="text" inputmode="decimal" data-key="feeRate"
               value="${e.feeRate != null && e.feeRate !== '' ? e.feeRate : ''}"
               placeholder="${e.vehiclePrice ? chulgoAutoRatePreview(e) : '예: 5.2'}" title="비워두면 차량가격 대비 자동 계산">
      </td>
      <td>
        <select data-key="feeMethod">
          <option value="AG" ${(e.feeMethod || 'AG') === 'AG' ? 'selected' : ''}>AG</option>
          <option value="CM" ${e.feeMethod === 'CM' ? 'selected' : ''}>CM</option>
        </select>
      </td>
      <td class="chulgo-check-cell" title="장부의 대리점수당 금액으로 자동 판정됨">${chulgoHasAgency(e) ? '✓' : ''}</td>
      <td><input type="text" data-key="remark" value="${(e.remark != null ? e.remark : chulgoDefaultRemark(e)).replace(/"/g, '&quot;')}"></td>
    </tr>
  `
    )
    .join('');

  chulgoExcelTableWrap.innerHTML = list.length
    ? `
    <table class="chulgo-ledger">
      <thead><tr>
        <th class="chulgo-check-cell">댓수</th>
        <th>DB유형</th><th>금융사</th><th>렌트/리스</th><th>고객명</th><th>차종</th>
        <th>투입일</th><th>차량가격</th><th>수수료</th><th>수수료율(%)</th><th>CM/AG</th>
        <th class="chulgo-check-cell">대리점</th><th>비고</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `
    : '<div class="chulgo-empty">이 달에는 출고 건이 없습니다.</div>';

  chulgoExcelTableWrap.querySelectorAll('input.chulgo-money').forEach((el) => {
    el.addEventListener('focus', () => {
      el.value = chulgoParseMoneyRaw(el.value) || '';
    });
    el.addEventListener('blur', () => {
      el.value = chulgoFormatMoneyDisplay(chulgoParseMoneyRaw(el.value));
    });
  });

  chulgoExcelTableWrap.querySelectorAll('input.chulgo-rate').forEach((el) => {
    // 숫자와 소수점만 남기고, 지우면 다시 자동 계산으로 돌아가도록 빈 문자열을 허용한다.
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^\d.]/g, '');
    });
  });

  chulgoExcelTableWrap.querySelectorAll('[data-key]').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.closest('tr').dataset.id;
      const key = el.dataset.key;
      let value;
      if (el.classList.contains('chulgo-money')) value = chulgoParseMoneyRaw(el.value);
      else if (key === 'feeRate') value = el.value === '' ? '' : Number(el.value) || 0;
      else value = el.value;
      const entry = chulgoEntries.find((x) => x.id === id);
      if (entry) entry[key] = value; // optimistic — Firestore snapshot reconciles right after
      chulgoUpdateField(id, key, value);
    });
  });
}

// 수수료율을 직접 안 넣었을 때, 입력칸 placeholder 로 "차량가격 대비 자동 계산되면
// 몇 %가 되는지" 미리 보여준다 (실제 값을 채우는 게 아니라 참고용 회색 글씨).
function chulgoAutoRatePreview(e) {
  const price = Number(e.vehiclePrice) || 0;
  const fee = Number(e.fee) || 0;
  if (!price) return '예: 5.2';
  return `자동 ${((fee / price) * 100).toFixed(2)}%`;
}

document.getElementById('chulgo-excel-preview-btn').addEventListener('click', () => {
  renderChulgoExcelPreview();
  chulgoExcelPopup.classList.remove('hidden');
});

document.getElementById('chulgo-excel-close').addEventListener('click', () => {
  chulgoExcelPopup.classList.add('hidden');
});

document.getElementById('chulgo-excel-export').addEventListener('click', async () => {
  const ym = chulgoActiveMonth();
  const list = chulgoEntries.filter((e) => e.month === ym).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!list.length) {
    showToast('이 달에는 출고 건이 없습니다.');
    return;
  }

  const rows = list.map((e) => ({
    dbType: e.dbType || '',
    company: e.company || '',
    finType: e.finType || '',
    name: e.name || '',
    car: e.car || '',
    deployDate: e.deployDate || '',
    vehiclePrice: Number(e.vehiclePrice) || 0,
    fee: Number(e.fee) || 0,
    feeRate: e.feeRate != null && e.feeRate !== '' ? Number(e.feeRate) : '',
    feeMethod: e.feeMethod || 'AG',
    remark: e.remark != null ? e.remark : chulgoDefaultRemark(e),
  }));

  const exportBtn = document.getElementById('chulgo-excel-export');
  exportBtn.disabled = true;
  try {
    const result = await window.api.exportChulgoExcel({
      yearMonth: ym,
      staffName: currentUser.displayName || '',
      position: chulgoPosition,
      rows,
    });
    if (!result.canceled) showToast(`저장했습니다.\n${result.filePath}`);
  } catch (err) {
    console.error('엑셀 내보내기 실패:', err);
    showToast('엑셀로 저장하는 데 실패했습니다.');
  } finally {
    exportBtn.disabled = false;
  }
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

document.getElementById('chulgo-add-row').addEventListener('click', async (ev) => {
  // 연타하면 Firestore 왕복이 끝나기 전에 order가 같은 빈 행이 여러 개 생길 수 있어서,
  // 요청이 끝날 때까지 버튼을 잠근다(기능/데이터 구조는 그대로, 중복 제출만 막는다).
  const btn = ev.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  const ym = chulgoActiveMonth();
  const order = chulgoEntries.filter((x) => x.month === ym).length;
  try {
    await window.api.createChulgoEntry({ month: ym, order, finType: '렌트', status: '-', countsQuota: true });
  } catch (err) {
    console.error('출고 건 추가 실패:', err);
    showToast(chulgoFriendlyError(err));
  } finally {
    btn.disabled = false;
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
// 화면(캘린더/메모장/장부/비교시트)마다 창 크기를 따로 기억한다 — 표가 넓어야 편한
// 화면과 캘린더처럼 작게 써도 되는 화면이 서로 다른 크기를 유지해준다(수동으로 늘리면
// 그 화면 전용으로 저장돼서, 다음에 그 화면으로 돌아왔을 때도 그대로 유지된다).
// 왼쪽에 사이드바(168px)가 항상 붙어있으니, 표가 필요한 화면은 그만큼 기본폭을 더 준다.
const CALENDAR_WINDOW_SIZE_KEY = 'calendar_window_size_v1';
const CHULGO_WINDOW_SIZE_KEY = 'chulgo_window_size_v1';
const CHULGO_DEFAULT_WINDOW_SIZE = { width: 1848, height: 960 };

// 장부 화면에 처음 들어갈 때만 할 일(직책/연락처 불러오기, 이번 달 기본 선택)을 해준다 —
// 사이드바 버튼을 눌러 다시 들어올 때는 매번 반복할 필요 없다.
async function initChulgoViewOnce() {
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
}

// 화면 전환마다 실제 창 크기를 기억/복원하는 기능은 그대로 유지하되(장부는 넓게,
// 비교시트는 좁게 등 화면별 목적이 있음), 지금 창 크기와 이미 같으면 setSize를
// 다시 부르지 않는다 — 매번 네이티브 리사이즈(리페인트)가 발생해 전환이 튀어 보이던
// 문제의 원인이었다. saveCurrentWindowSize가 저장한 값을 그대로 "현재 크기"로 재사용해
// getSize를 한 번 더 왕복하지 않는다.
let lastKnownWindowSize = null;

async function saveCurrentWindowSize(key) {
  try {
    const size = await window.api.getWindowSize();
    localStorage.setItem(key, JSON.stringify(size));
    lastKnownWindowSize = size;
  } catch (err) {
    console.error('창 크기 저장 실패:', err);
  }
}

async function restoreWindowSize(key, fallback) {
  let size = fallback;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      size = JSON.parse(saved);
    } catch { /* 저장값이 깨졌으면 fallback 사용 */ }
  }
  if (!size) return;
  if (lastKnownWindowSize && lastKnownWindowSize.width === size.width && lastKnownWindowSize.height === size.height) {
    return;
  }
  try {
    await window.api.setWindowSize(size);
    lastKnownWindowSize = size;
  } catch (err) {
    console.error('창 크기 복원 실패:', err);
  }
}

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

// 다른 기기/동료의 수정이 들어왔는데 마침 내가 어느 칸에 타이핑 중이면, 표를 통째로
// 다시 그리는 순간 그 입력칸이 파괴돼서 글자가 씹히고 커서가 사라진다. 그럴 땐 다시
// 그리기를 미뤄놨다가, 입력칸에서 손을 떼는 순간(blur) 반영한다.
let chulgoRenderDeferred = false;

function chulgoIsEditing() {
  const active = document.activeElement;
  return !!active && chulgoTableWrap.contains(active)
    && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
}

function chulgoRenderWhenIdle() {
  if (chulgoIsEditing()) {
    chulgoRenderDeferred = true;
    return;
  }
  chulgoRenderDeferred = false;
  renderChulgo();
}

// focusout 은 표 안의 입력칸에서 포커스가 빠질 때마다 올라온다 — 미뤄둔 갱신을 그때 반영.
chulgoTableWrap.addEventListener('focusout', () => {
  if (!chulgoRenderDeferred) return;
  setTimeout(() => {
    if (chulgoRenderDeferred && !chulgoIsEditing()) {
      chulgoRenderDeferred = false;
      renderChulgo();
    }
  }, 0);
});

window.api.onChulgoUpdate((entries) => {
  const changed = !chulgoEntriesEqual(entries, chulgoEntries);
  chulgoEntries = entries;
  if (!chulgoPanel.classList.contains('hidden')) {
    // Skip the full table rebuild when nothing actually differs from what's already on screen —
    // this is what was making clicks/typing need a double-click: a Firestore round-trip echoing
    // back our own just-made edit would replace the whole <table>, stealing focus mid-interaction.
    if (changed) chulgoRenderWhenIdle();
    else renderChulgoStats();
  } else {
    renderChulgoStats();
  }
});

// ─── 고객 리마인더 (몇 달 뒤 다시 연락하기로 한 고객) ─────────────────────────
// 메모장의 "날짜별 섹션 + 완료는 접어서 숨김" 패턴을 그대로 따르되, 리마인더는
// 몇 달 뒤가 흔해서 버킷을 오늘/내일/이번 주 대신 이번 달/다음 달/그 이후로 나눈다.
const reminderPanel = document.getElementById('reminder-panel');
const reminderListWrap = document.getElementById('reminder-list-wrap');
const reminderEmpty = document.getElementById('reminder-empty');
const reminderCountLabel = document.getElementById('reminder-count-label');
const reminderPopup = document.getElementById('reminder-popup');
const reminderPopupTitle = document.getElementById('reminder-popup-title');
const reminderNameInput = document.getElementById('reminder-name');
const reminderPhoneInput = document.getElementById('reminder-phone');
const reminderCarInput = document.getElementById('reminder-car');
const reminderDateInput = document.getElementById('reminder-date');
const reminderNoteInput = document.getElementById('reminder-note');
const reminderStatusEl = document.getElementById('reminder-status');
const reminderSearchInput = document.getElementById('reminder-search');
const REMINDER_WINDOW_SIZE_KEY = 'reminder_window_size_v1';
const REMINDER_DEFAULT_WINDOW_SIZE = { width: 900, height: 760 };

let reminders = [];
let reminderEditingId = null;
const REMINDER_DONE_EXPANDED_KEY = 'reminder_done_expanded_v1';
let reminderDoneExpanded = localStorage.getItem(REMINDER_DONE_EXPANDED_KEY) === '1';

function reminderSortedAll() {
  return [...reminders].sort((a, b) => (a.remindDate || '').localeCompare(b.remindDate || ''));
}

let reminderSearchQuery = '';
function reminderMatchesSearch(r) {
  if (!reminderSearchQuery) return true;
  const haystack = [r.name, r.phone, r.car, r.note].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(reminderSearchQuery);
}

function reminderDateLabel(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}(${MEMO_WEEKDAY[date.getDay()]})`;
}

// 기한 지남만 따로 모으고, 나머지는 실제 연·월(2026년 12월 등)로 묶는다 — "다음 달"
// 다음부터 전부 "그 이후"에 뭉치면 몇 달치가 쌓였을 때 한눈에 안 들어와서, 달마다
// 펼쳐 보이게 바꿨다.
function reminderIsOverdue(iso) {
  if (!iso) return false;
  const today = new Date();
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return target < today;
}

function reminderMonthKeyOf(iso) {
  if (!iso) return '날짜 없음';
  const [y, m] = iso.split('-');
  return `${y}-${m}`;
}

function reminderMonthLabelOf(monthKey) {
  if (monthKey === '날짜 없음') return monthKey;
  const [y, m] = monthKey.split('-').map(Number);
  return `${y}년 ${m}월`;
}

function reminderBuildRow(r) {
  const row = document.createElement('div');
  row.className = 'reminder-row' + (r.done ? ' done' : '');
  row.dataset.id = r.id;

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'reminder-row-check';
  check.checked = !!r.done;
  check.title = r.done ? '완료 취소' : '완료 표시';
  check.onchange = () => {
    const nextDone = check.checked;
    window.api.updateReminder({ id: r.id, done: nextDone }).catch((err) => {
      console.error('리마인더 완료 처리 실패:', err);
      showToast(chulgoFriendlyError(err));
      check.checked = !nextDone;
    });
  };
  row.appendChild(check);

  const body = document.createElement('div');
  body.className = 'reminder-row-body';
  body.title = '클릭해서 수정';
  body.onclick = () => reminderOpenPopup(r);

  const line1 = document.createElement('div');
  line1.className = 'reminder-row-line1';
  line1.innerHTML = `<strong>${escapeHtml(r.name || '(이름 없음)')}</strong>${r.car ? ` <span class="reminder-row-car">${escapeHtml(r.car)}</span>` : ''}`;
  body.appendChild(line1);

  const line2 = document.createElement('div');
  line2.className = 'reminder-row-line2';
  const parts = [reminderDateLabel(r.remindDate)];
  if (r.phone) parts.push(r.phone);
  if (r.note) parts.push(r.note);
  line2.textContent = parts.filter(Boolean).join(' · ');
  body.appendChild(line2);

  row.appendChild(body);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'memo-row-delete';
  delBtn.textContent = '×';
  delBtn.title = '삭제';
  delBtn.onclick = async (ev) => {
    ev.stopPropagation();
    if (!confirm(`"${r.name || '이 리마인더'}"를 삭제할까요?`)) return;
    try {
      await window.api.deleteReminder(r.id);
    } catch (err) {
      console.error('리마인더 삭제 실패:', err);
      showToast('삭제에 실패했습니다.');
    }
  };
  row.appendChild(delBtn);

  return row;
}

function reminderBuildSection(label, items, extraClass) {
  const section = document.createElement('div');
  section.className = 'memo-section' + (extraClass ? ` ${extraClass}` : '');
  const header = document.createElement('div');
  header.className = 'memo-section-header';
  header.textContent = `${label} · ${items.length}`;
  section.appendChild(header);
  items.forEach((r) => section.appendChild(reminderBuildRow(r)));
  return section;
}

function renderReminders() {
  const all = reminderSortedAll();
  const sorted = all.filter(reminderMatchesSearch);
  reminderCountLabel.textContent = all.length ? `전체 ${all.length}건${sorted.length !== all.length ? ` · ${sorted.length}건 검색됨` : ''}` : '';
  reminderEmpty.style.display = sorted.length ? 'none' : 'block';
  reminderEmpty.textContent = reminderSearchQuery && all.length
    ? '검색 결과가 없습니다.'
    : '등록된 리마인더가 없습니다. "+ 리마인더 추가"로 시작하세요.';

  const active = sorted.filter((r) => !r.done);
  const done = sorted.filter((r) => r.done);

  reminderListWrap.innerHTML = '';

  const overdue = active.filter((r) => reminderIsOverdue(r.remindDate));
  if (overdue.length) reminderListWrap.appendChild(reminderBuildSection('⚠ 기한 지남', overdue, 'memo-section-overdue'));

  const upcoming = active.filter((r) => !reminderIsOverdue(r.remindDate));
  const monthKeys = [...new Set(upcoming.map((r) => reminderMonthKeyOf(r.remindDate)))].sort();
  monthKeys.forEach((monthKey) => {
    const items = upcoming.filter((r) => reminderMonthKeyOf(r.remindDate) === monthKey);
    reminderListWrap.appendChild(reminderBuildSection(reminderMonthLabelOf(monthKey), items));
  });

  if (done.length) {
    const doneSection = document.createElement('div');
    doneSection.className = 'memo-section memo-done-section';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'memo-done-toggle';
    toggle.innerHTML = `<span class="memo-done-chevron">${reminderDoneExpanded ? '▾' : '▸'}</span> 완료됨 · ${done.length}`;
    toggle.onclick = () => {
      reminderDoneExpanded = !reminderDoneExpanded;
      localStorage.setItem(REMINDER_DONE_EXPANDED_KEY, reminderDoneExpanded ? '1' : '0');
      renderReminders();
    };
    doneSection.appendChild(toggle);
    if (reminderDoneExpanded) done.forEach((r) => doneSection.appendChild(reminderBuildRow(r)));
    reminderListWrap.appendChild(doneSection);
  }
}

function reminderOpenPopup(r) {
  reminderEditingId = r ? r.id : null;
  reminderPopupTitle.textContent = r ? '리마인더 수정' : '리마인더 추가';
  reminderNameInput.value = r ? r.name : '';
  reminderPhoneInput.value = r ? r.phone : '';
  reminderCarInput.value = r ? r.car : '';
  reminderDateInput.value = r ? r.remindDate : '';
  reminderNoteInput.value = r ? r.note : '';
  reminderStatusEl.textContent = '';
  reminderPopup.classList.remove('hidden');
  reminderNameInput.focus();
}

function reminderClosePopup() {
  reminderPopup.classList.add('hidden');
  reminderEditingId = null;
}

// 010-1234-5678처럼 자동으로 하이픈을 넣어준다. 커서는 끝으로 밀리는데, 전화번호
// 입력은 보통 처음부터 끝까지 순서대로 치는 짧은 입력이라 실사용에 문제 없다.
function formatKoreanPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.startsWith('02')) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
reminderPhoneInput.addEventListener('input', () => {
  reminderPhoneInput.value = formatKoreanPhone(reminderPhoneInput.value);
});

document.getElementById('reminder-add-open').addEventListener('click', () => reminderOpenPopup(null));
document.getElementById('reminder-cancel').addEventListener('click', reminderClosePopup);

document.getElementById('reminder-save').addEventListener('click', async () => {
  const name = reminderNameInput.value.trim();
  const remindDate = reminderDateInput.value;
  if (!name) { reminderStatusEl.textContent = '고객명을 입력해주세요.'; return; }
  if (!remindDate) { reminderStatusEl.textContent = '연락 예정일을 선택해주세요.'; return; }

  const data = {
    name,
    phone: reminderPhoneInput.value.trim(),
    car: reminderCarInput.value.trim(),
    remindDate,
    note: reminderNoteInput.value.trim(),
  };

  const saveBtn = document.getElementById('reminder-save');
  saveBtn.disabled = true;
  reminderStatusEl.textContent = '저장 중...';
  try {
    if (reminderEditingId) {
      // 날짜를 바꿔서 미래로 다시 미루는 경우가 흔해서, 수정 시 알림 표식을 초기화해
      // 새 날짜에 다시 알려주게 한다.
      await window.api.updateReminder({ id: reminderEditingId, ...data, notified: false });
    } else {
      await window.api.createReminder(data);
    }
    reminderClosePopup();
  } catch (err) {
    console.error('리마인더 저장 실패:', err);
    reminderStatusEl.textContent = chulgoFriendlyError(err);
  } finally {
    saveBtn.disabled = false;
  }
});

reminderSearchInput.addEventListener('input', () => {
  reminderSearchQuery = reminderSearchInput.value.trim().toLowerCase();
  renderReminders();
});

window.api.onReminderUpdate((items) => {
  reminders = items;
  renderReminders();
});

window.api.onReminderAlarm((r) => {
  showToast(`📇 ${r.name}${r.car ? ` (${r.car})` : ''} 연락할 때예요${r.note ? ' — ' + r.note : ''}`);
});

// ─── 조직 관리 (본부/지점/팀/직급/권한) ──────────────────────────────────────
// superAdmin은 전체를 배정/수정, orgManager(본부장/지점장)·teamManager(팀장)는 자기
// 담당 범위를 조회만 한다 — 화면에 뜨는 버튼 자체를 권한별로 다르게 구성해서 처리한다
// (실제 쓰기 차단은 Firestore 규칙이 최종 방어선).
const orgPanel = document.getElementById('org-panel');
const orgNavBtn = document.getElementById('org-nav-btn');
const orgNavLabel = document.getElementById('org-nav-label');
const orgPanelTitle = document.getElementById('org-panel-title');
const orgListWrap = document.getElementById('org-list-wrap');
const orgEmpty = document.getElementById('org-empty');
const orgSearchInput = document.getElementById('org-search');
const orgFilterOrgSelect = document.getElementById('org-filter-org');
const orgFilterActiveSelect = document.getElementById('org-filter-active');
const orgAddTeamBtn = document.getElementById('org-add-team');
const orgAddMemberBtn = document.getElementById('org-add-member');
const orgHistoryOpenBtn = document.getElementById('org-history-open');
const orgChartView = document.getElementById('org-chart-view');
const orgLedgerView = document.getElementById('org-ledger-view');
const orgLedgerMonthInput = document.getElementById('org-ledger-month');
const orgLedgerSummaryEl = document.getElementById('org-ledger-summary');
const orgLedgerWrap = document.getElementById('org-ledger-wrap');
const ORG_WINDOW_SIZE_KEY = 'org_window_size_v1';
const ORG_DEFAULT_WINDOW_SIZE = { width: 1400, height: 900 };

let orgConstants = null; // { organizations, positionsByType, permissions }
let myOrgInfo = null;
let orgMembersCache = [];
let orgTeamsCache = [];
let orgSearchQuery = '';
let orgFilterOrg = '';
let orgFilterActiveOnly = true;
let orgMemberEditingUid = null;
let orgTeamEditingId = null;

function orgTypeOf(orgKey) {
  const found = (orgConstants?.organizations || []).find((o) => o.key === orgKey);
  return found ? found.type : null;
}
function orgLabelOf(orgKey) {
  const found = (orgConstants?.organizations || []).find((o) => o.key === orgKey);
  return found ? found.label : (orgKey || '미배정');
}

function orgFillSelect(selectEl, options, { placeholder } = {}) {
  selectEl.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    selectEl.appendChild(opt);
  }
  options.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    selectEl.appendChild(opt);
  });
}

async function orgLoadConstantsOnce() {
  if (orgConstants) return orgConstants;
  orgConstants = await window.api.getOrgConstants();
  orgFillSelect(orgFilterOrgSelect, orgConstants.organizations.map((o) => ({ value: o.key, label: o.label })), { placeholder: '전체 소속' });
  return orgConstants;
}

// 사이드바 노출 여부 — superAdmin/orgManager/teamManager만. 시스템 권한이 바뀌면
// (예: 재광님이 다른 사람을 superAdmin으로 바꿈) 실시간으로 즉시 반영된다.
function orgApplyMyInfo(info) {
  myOrgInfo = info;
  financeNavBtn.classList.toggle('hidden', !(info && info.organization));
  const scope = info && ['superAdmin', 'orgManager', 'teamManager'].includes(info.permission) ? info.permission : null;
  orgNavBtn.classList.toggle('hidden', !scope);
  document.getElementById('org-branch-links-section').classList.toggle('hidden', info?.permission !== 'superAdmin');
  document.getElementById('min-version-section').classList.toggle('hidden', info?.permission !== 'superAdmin');
  if (!scope) return;
  orgNavLabel.textContent = scope === 'superAdmin' ? '조직 관리' : '우리 조직';
  orgPanelTitle.textContent = scope === 'superAdmin' ? '조직 관리' : '우리 조직';
  orgAddMemberBtn.classList.toggle('hidden', scope !== 'superAdmin');
  orgAddTeamBtn.classList.toggle('hidden', scope !== 'superAdmin');
  orgHistoryOpenBtn.classList.toggle('hidden', scope !== 'superAdmin');
}

// 본부/지점별 시트 링크(superAdmin 전용) — 설정 화면 열릴 때 채운다.
async function orgRenderBranchLinksEditor() {
  const section = document.getElementById('org-branch-links-section');
  if (section.classList.contains('hidden')) return;
  try {
    await orgLoadConstantsOnce();
    const links = await window.api.getBranchLinks();
    const listEl = document.getElementById('org-branch-links-list');
    listEl.innerHTML = '';
    orgConstants.organizations.forEach((org) => {
      const row = document.createElement('div');
      row.className = 'theme-row';
      row.innerHTML = `<span>${escapeHtml(org.label)}</span>
        <input type="text" class="org-branch-link-input" data-org="${org.key}" placeholder="https://docs.google.com/..." value="${escapeHtml(links[org.key] || '')}">`;
      listEl.appendChild(row);
    });
  } catch (err) {
    console.error('본부/지점 시트 링크 불러오기 실패:', err);
  }
}

async function orgRenderMinVersionEditor() {
  const section = document.getElementById('min-version-section');
  if (section.classList.contains('hidden')) return;
  try {
    const cfg = await window.api.getMinVersionConfig();
    document.getElementById('min-version-input').value = cfg?.minVersion || '';
  } catch (err) {
    console.error('최소 버전 불러오기 실패:', err);
  }
}

document.getElementById('min-version-save').addEventListener('click', async () => {
  const value = document.getElementById('min-version-input').value.trim();
  try {
    await window.api.setMinVersion(value);
    showToast('최소 버전이 저장되었습니다.');
  } catch (err) {
    showToast(err.message === 'INVALID_VERSION' ? '버전 형식이 올바르지 않아요 (예: 0.37.3)' : chulgoFriendlyError(err));
  }
});

document.getElementById('org-branch-links-save').addEventListener('click', async () => {
  const links = {};
  document.querySelectorAll('.org-branch-link-input').forEach((input) => {
    if (input.value.trim()) links[input.dataset.org] = input.value.trim();
  });
  try {
    await window.api.setBranchLinks(links);
    showToast('시트 링크가 저장되었습니다.');
  } catch (err) {
    showToast(chulgoFriendlyError(err));
  }
});

window.api.onOrgMyInfoUpdate(orgApplyMyInfo);
window.api.getMyOrgInfo().then(orgApplyMyInfo).catch(() => {});

async function orgFetchMembers() {
  await orgLoadConstantsOnce();
  const [members, teams] = await Promise.all([window.api.getOrgMembers(), window.api.getOrgTeams()]);
  orgMembersCache = members;
  orgTeamsCache = teams.sort((a, b) => a.order - b.order);
}

function orgMatchesSearch(m) {
  if (!orgSearchQuery) return true;
  const team = orgTeamsCache.find((t) => t.id === m.teamId);
  const haystack = [m.name, m.email, m.position, orgLabelOf(m.organization), team?.teamName].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(orgSearchQuery);
}

function orgMemberCardHTML(m) {
  const team = orgTeamsCache.find((t) => t.id === m.teamId);
  return `
    <div class="org-member-card${m.active ? '' : ' inactive'}" data-uid="${m.uid}">
      <div>
        <div class="org-member-name">${escapeHtml(m.name || '(이름 미설정)')}</div>
        <div class="org-member-position">${escapeHtml(m.position || '-')}${m.active ? '' : ' · 비활성'}</div>
      </div>
    </div>
    <div class="org-member-detail" data-detail-for="${m.uid}">
      이메일: ${escapeHtml(m.email)}<br>
      소속: ${escapeHtml(orgLabelOf(m.organization))} ${team ? '· ' + escapeHtml(team.teamName) : ''}<br>
      권한: ${escapeHtml(orgPermissionLabel(m.permission))}<br>
      상태: ${m.active ? '재직' : '비활성'}
    </div>`;
}

function orgPermissionLabel(p) {
  return { superAdmin: '최고관리자', orgManager: '본부장/지점장', teamManager: '팀장', member: '일반 직원' }[p] || p;
}

function renderOrgChart() {
  const canEdit = myOrgInfo && myOrgInfo.permission === 'superAdmin';
  const visibleMembers = orgMembersCache.filter((m) => (orgFilterActiveOnly ? m.active : true) && orgMatchesSearch(m));
  const orgs = orgFilterOrg
    ? (orgConstants.organizations || []).filter((o) => o.key === orgFilterOrg)
    : (orgConstants.organizations || []);

  orgListWrap.innerHTML = '';
  let anyShown = false;

  orgs.forEach((org) => {
    const orgMembers = visibleMembers.filter((m) => m.organization === org.key);
    const orgTeamsHere = orgTeamsCache.filter((t) => t.organization === org.key);
    // superAdmin은 소속에 인원이 하나도 없어도 구조 자체는 보여준다(공석 배정을 위해).
    if (!canEdit && orgMembers.length === 0 && orgFilterOrg !== org.key) return;
    anyShown = true;

    const topPosition = org.type === 'hq' ? '본부장' : '지점장';
    const topManager = orgMembers.find((m) => m.position === topPosition && !m.teamId);

    const block = document.createElement('div');
    block.className = 'org-unit-block';

    const head = document.createElement('div');
    head.className = 'org-unit-head';
    head.innerHTML = `
      <span class="org-unit-title">${escapeHtml(org.label)}</span>
      <span class="org-unit-manager${topManager ? '' : ' vacant'}" data-vacant-org="${org.key}" data-vacant-position="${topPosition}">
        ${topManager ? `${escapeHtml(topManager.name)} ${escapeHtml(topPosition)}` : `${topPosition} 공석${canEdit ? ' (클릭해서 배정)' : ''}`}
      </span>`;
    block.appendChild(head);

    const teamsRow = document.createElement('div');
    teamsRow.className = 'org-teams-row';
    orgTeamsHere.forEach((team) => {
      const teamMembers = orgMembers.filter((m) => m.teamId === team.id);
      // 본부장/지점장과 같은 방식 — 별도 teamManagerUid 필드에 기대지 않고, 그냥 그
      // 팀 안에서 직급이 "팀장"인 사람을 찾는다(그 필드를 채워주는 화면이 없었음).
      const manager = teamMembers.find((m) => m.position === '팀장');
      const others = teamMembers.filter((m) => m !== manager);

      const card = document.createElement('div');
      card.className = 'org-team-card';
      card.innerHTML = `
        <div class="org-team-card-head">
          <span class="org-team-card-title">${escapeHtml(team.teamName)}</span>
          ${canEdit ? `<button type="button" class="org-team-edit-btn" data-edit-team="${team.id}">✎</button>` : ''}
        </div>
        <div class="org-team-manager${manager ? '' : ' vacant'}" data-vacant-team="${team.id}">
          ${manager ? `👑 ${escapeHtml(manager.name)} ${escapeHtml(manager.position)}` : `팀장 공석${canEdit ? ' (클릭해서 배정)' : ''}`}
        </div>
        <div class="org-team-members"></div>`;
      const membersWrap = card.querySelector('.org-team-members');
      others.forEach((m) => {
        membersWrap.insertAdjacentHTML('beforeend', orgMemberCardHTML(m));
      });
      teamsRow.appendChild(card);
    });
    block.appendChild(teamsRow);
    orgListWrap.appendChild(block);
  });

  // 미배정 계정 — 이 앱에 로그인은 했지만 아직 본부/지점을 안 정한 사람들. 여기서
  // 클릭하면 바로 배정 화면이 뜬다("+ 직원"으로 새 계정을 만들 수는 없고, 이렇게
  // 이미 로그인해본 계정 중에서 고르는 방식).
  if (canEdit) {
    const unassigned = visibleMembers.filter((m) => !m.organization);
    if (unassigned.length) {
      anyShown = true;
      const block = document.createElement('div');
      block.className = 'org-unit-block';
      block.id = 'org-unassigned-block';
      block.innerHTML = `<div class="org-unit-head"><span class="org-unit-title">🟡 미배정 계정 (${unassigned.length})</span></div>
        <div class="org-team-card" style="max-width:none"><div class="org-team-members"></div></div>`;
      const membersWrap = block.querySelector('.org-team-members');
      unassigned.forEach((m) => {
        membersWrap.insertAdjacentHTML('beforeend', orgMemberCardHTML(m));
      });
      orgListWrap.appendChild(block);
    }
  }

  orgEmpty.style.display = anyShown ? 'none' : 'block';
}

// 카드 클릭(펼치기) / 공석 클릭(배정) / 팀 수정 버튼 — 위임 처리
orgListWrap.addEventListener('click', (ev) => {
  const memberCard = ev.target.closest('.org-member-card');
  const vacantOrg = ev.target.closest('[data-vacant-org]');
  const vacantTeam = ev.target.closest('[data-vacant-team]');
  const editTeamBtn = ev.target.closest('[data-edit-team]');

  if (editTeamBtn) {
    orgOpenTeamPopup(orgTeamsCache.find((t) => t.id === editTeamBtn.dataset.editTeam));
    return;
  }
  if (vacantOrg && myOrgInfo?.permission === 'superAdmin') {
    orgOpenMemberPopup(null, { organization: vacantOrg.dataset.vacantOrg, position: vacantOrg.dataset.vacantPosition });
    return;
  }
  if (vacantTeam && myOrgInfo?.permission === 'superAdmin') {
    const team = orgTeamsCache.find((t) => t.id === vacantTeam.dataset.vacantTeam);
    orgOpenMemberPopup(null, { organization: team.organization, teamId: team.id, position: '팀장' });
    return;
  }
  if (memberCard) {
    if (myOrgInfo?.permission === 'superAdmin') {
      orgOpenMemberPopup(orgMembersCache.find((m) => m.uid === memberCard.dataset.uid));
    } else {
      memberCard.classList.toggle('expanded');
    }
  }
});

function orgOpenMemberPopup(member, presetForVacant) {
  orgMemberEditingUid = member ? member.uid : null;
  document.getElementById('org-member-name').value = member ? member.name : '(신규 배정은 먼저 로그인한 계정 목록에서 고르세요)';
  document.getElementById('org-member-email').value = member ? member.email : '';
  document.getElementById('org-member-active').checked = member ? member.active : true;

  const orgSelect = document.getElementById('org-member-org');
  orgFillSelect(orgSelect, orgConstants.organizations.map((o) => ({ value: o.key, label: o.label })));
  const initialOrg = member ? member.organization : (presetForVacant?.organization || orgConstants.organizations[0].key);
  orgSelect.value = initialOrg;

  const permSelect = document.getElementById('org-member-permission');
  permSelect.value = member ? member.permission : 'member';

  orgRefreshMemberPositionAndTeamSelects(initialOrg, member, presetForVacant);
  document.getElementById('org-member-status').textContent = member
    ? ''
    : '⚠ 새 계정 배정은 아직 지원하지 않아요 — 그 계정으로 한 번 로그인한 뒤, 목록에서 골라 배정해주세요.';
  document.getElementById('org-member-popup').classList.remove('hidden');
}

function orgRefreshMemberPositionAndTeamSelects(orgKey, member, presetForVacant) {
  const type = orgTypeOf(orgKey);
  const positionSelect = document.getElementById('org-member-position');
  orgFillSelect(positionSelect, (orgConstants.positionsByType[type] || []).map((p) => ({ value: p, label: p })));
  positionSelect.value = member ? member.position : (presetForVacant?.position || positionSelect.options[0]?.value || '');

  const teamSelect = document.getElementById('org-member-team');
  const teamsHere = orgTeamsCache.filter((t) => t.organization === orgKey);
  orgFillSelect(teamSelect, teamsHere.map((t) => ({ value: t.id, label: t.teamName })), { placeholder: '(팀 없음 — 본부장/지점장 등)' });
  teamSelect.value = member ? (member.teamId || '') : (presetForVacant?.teamId || '');
}

document.getElementById('org-member-org').addEventListener('change', (ev) => {
  orgRefreshMemberPositionAndTeamSelects(ev.target.value, orgMemberEditingUid ? orgMembersCache.find((m) => m.uid === orgMemberEditingUid) : null);
});

document.getElementById('org-member-cancel').addEventListener('click', () => {
  document.getElementById('org-member-popup').classList.add('hidden');
});

document.getElementById('org-member-save').addEventListener('click', async () => {
  if (!orgMemberEditingUid) { document.getElementById('org-member-popup').classList.add('hidden'); return; }
  const statusEl = document.getElementById('org-member-status');
  const payload = {
    uid: orgMemberEditingUid,
    name: document.getElementById('org-member-name').value.trim(),
    organization: document.getElementById('org-member-org').value,
    teamId: document.getElementById('org-member-team').value || null,
    position: document.getElementById('org-member-position').value,
    permission: document.getElementById('org-member-permission').value,
    active: document.getElementById('org-member-active').checked,
  };
  statusEl.textContent = '저장 중...';
  try {
    await window.api.upsertOrgMember(payload);
    document.getElementById('org-member-popup').classList.add('hidden');
    await orgFetchMembers();
    renderOrgChart();
  } catch (err) {
    console.error('직원 정보 저장 실패:', err);
    statusEl.textContent = chulgoFriendlyError(err);
  }
});

function orgOpenTeamPopup(team) {
  orgTeamEditingId = team ? team.id : null;
  document.getElementById('org-team-popup-title').textContent = team ? '팀 수정' : '팀 추가';
  const orgSelect = document.getElementById('org-team-org');
  orgFillSelect(orgSelect, orgConstants.organizations.map((o) => ({ value: o.key, label: o.label })));
  orgSelect.value = team ? team.organization : orgFilterOrg || orgConstants.organizations[0].key;
  document.getElementById('org-team-name').value = team ? team.teamName : '';
  document.getElementById('org-team-delete').classList.toggle('hidden', !team);
  document.getElementById('org-team-status').textContent = '';
  document.getElementById('org-team-popup').classList.remove('hidden');
}

orgAddTeamBtn.addEventListener('click', () => orgOpenTeamPopup(null));
document.getElementById('org-team-cancel').addEventListener('click', () => {
  document.getElementById('org-team-popup').classList.add('hidden');
});

document.getElementById('org-team-save').addEventListener('click', async () => {
  const statusEl = document.getElementById('org-team-status');
  const organization = document.getElementById('org-team-org').value;
  const teamName = document.getElementById('org-team-name').value.trim();
  if (!teamName) { statusEl.textContent = '팀 이름을 입력해주세요.'; return; }
  statusEl.textContent = '저장 중...';
  try {
    if (orgTeamEditingId) {
      await window.api.updateOrgTeam({ id: orgTeamEditingId, organization, teamName });
    } else {
      const order = orgTeamsCache.filter((t) => t.organization === organization).length;
      await window.api.createOrgTeam({ organization, teamName, order, teamManagerUid: null });
    }
    document.getElementById('org-team-popup').classList.add('hidden');
    await orgFetchMembers();
    renderOrgChart();
  } catch (err) {
    console.error('팀 저장 실패:', err);
    statusEl.textContent = chulgoFriendlyError(err);
  }
});

document.getElementById('org-team-delete').addEventListener('click', async () => {
  if (!orgTeamEditingId) return;
  if (!confirm('이 팀을 삭제할까요? (배정된 직원이 있으면 삭제되지 않아요)')) return;
  const statusEl = document.getElementById('org-team-status');
  try {
    await window.api.deleteOrgTeam(orgTeamEditingId);
    document.getElementById('org-team-popup').classList.add('hidden');
    await orgFetchMembers();
    renderOrgChart();
  } catch (err) {
    statusEl.textContent = err.message === 'TEAM_HAS_MEMBERS' ? '이 팀에 배정된 직원이 있어 삭제할 수 없어요.' : chulgoFriendlyError(err);
  }
});

orgAddMemberBtn.addEventListener('click', () => {
  const block = document.getElementById('org-unassigned-block');
  if (block) {
    block.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    showToast('아직 미배정 계정이 없어요 — 배정할 사람이 한 번 로그인하면 여기 목록에 나타나요.');
  }
});

orgSearchInput.addEventListener('input', () => {
  orgSearchQuery = orgSearchInput.value.trim().toLowerCase();
  renderOrgChart();
});
orgFilterOrgSelect.addEventListener('change', () => {
  orgFilterOrg = orgFilterOrgSelect.value;
  renderOrgChart();
});
orgFilterActiveSelect.addEventListener('change', () => {
  orgFilterActiveOnly = orgFilterActiveSelect.value === 'active';
  renderOrgChart();
});

document.getElementById('org-tab-chart').addEventListener('click', () => orgSwitchTab('chart'));
document.getElementById('org-tab-ledger').addEventListener('click', () => orgSwitchTab('ledger'));

function orgSwitchTab(tab) {
  document.getElementById('org-tab-chart').classList.toggle('active', tab === 'chart');
  document.getElementById('org-tab-ledger').classList.toggle('active', tab === 'ledger');
  orgChartView.classList.toggle('hidden', tab !== 'chart');
  orgLedgerView.classList.toggle('hidden', tab !== 'ledger');
  if (tab === 'ledger') renderOrgLedger();
}

function orgCurrentLedgerMonth() {
  return orgLedgerMonthInput.value || new Date().toISOString().slice(0, 7);
}

async function renderOrgLedger() {
  if (!orgLedgerMonthInput.value) orgLedgerMonthInput.value = orgCurrentLedgerMonth();
  const month = orgCurrentLedgerMonth();
  orgLedgerWrap.innerHTML = '<div class="chulgo-mini-hint">불러오는 중...</div>';
  try {
    await renderOrgLedgerInner(month);
  } catch (err) {
    console.error('조직 장부 표시 실패:', err);
    orgLedgerWrap.innerHTML = `<div class="chulgo-mini-hint">${escapeHtml(chulgoFriendlyError(err))}</div>`;
  }
}

// chulgoComputedFee(e)는 "지금 로그인한 나"의 직급(chulgoPosition 전역값)을 쓰기 때문에
// 조직 장부(다른 사람들 것)에는 못 쓴다 — 계산식 자체(chulgoComputedFee 본문)는 그대로,
// 직급만 각 멤버 것으로 바꿔서 여기서 따로 계산한다.
function orgComputedFeeFor(e, position) {
  const base =
    (Number(e.fee) || 0) + (Number(e.promo) || 0) + (Number(e.agencyFee) || 0) + chulgoExtraFeeAmountTotal(e)
    - (Number(e.supplies) || 0) - chulgoPaybackTotal(e);
  const rate = CHULGO_POSITION_RATES[position] ?? 0.5;
  return base * 0.867 * rate;
}

// 실제 렌더링은 여기서 — 화면을 그리다 생기는 예외까지 위 renderOrgLedger의 try가
// 전부 감싸서, 전역 안전망 토스트("예상치 못한 오류...") 대신 이 패널 안에 이유가
// 뜨게 한다.
async function renderOrgLedgerInner(month) {
  const data = await window.api.getOrgLedgerForScope({ month });
  const { members, entries } = data;
  const teamsById = new Map(orgTeamsCache.map((t) => [t.id, t]));
  const entriesByAuthor = new Map();
  entries.forEach((e) => {
    if (!entriesByAuthor.has(e.authorUid)) entriesByAuthor.set(e.authorUid, []);
    entriesByAuthor.get(e.authorUid).push(e);
  });

  let totalCount = 0;
  let totalFee = 0;

  const grouped = new Map(); // teamId(or 'none') -> members[]
  members.filter((m) => m.active).forEach((m) => {
    const key = m.teamId || 'none';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(m);
  });

  orgLedgerWrap.innerHTML = '';
  grouped.forEach((teamMembers, teamId) => {
    const team = teamsById.get(teamId);
    const section = document.createElement('div');
    section.className = 'org-unit-block';
    const head = document.createElement('div');
    head.className = 'org-unit-head';
    head.innerHTML = `<span class="org-unit-title">${escapeHtml(team ? team.teamName : '팀 미배정')}</span>`;
    section.appendChild(head);

    teamMembers.forEach((m) => {
      const myEntries = entriesByAuthor.get(m.uid) || [];
      const feeSum = myEntries.reduce((a, e) => a + orgComputedFeeFor(e, m.position), 0);
      totalCount += myEntries.length;
      totalFee += feeSum;

      const row = document.createElement('div');
      row.className = 'org-member-card';
      row.innerHTML = `
        <div>
          <div class="org-member-name">${escapeHtml(m.name)} <span class="org-member-position">${escapeHtml(m.position)}</span></div>
          <div class="org-member-position">출고 ${myEntries.length}건</div>
        </div>
        <div class="org-member-name">${escapeHtml(chulgoWon(feeSum))}</div>`;
      section.appendChild(row);
    });
    orgLedgerWrap.appendChild(section);
  });

  orgLedgerSummaryEl.textContent = `총 출고 ${totalCount}건 · 합계 ${chulgoWon(totalFee)}`;
}

orgLedgerMonthInput.addEventListener('change', renderOrgLedger);

orgHistoryOpenBtn.addEventListener('click', async () => {
  const listEl = document.getElementById('org-history-list');
  listEl.innerHTML = '불러오는 중...';
  document.getElementById('org-history-popup').classList.remove('hidden');
  try {
    const items = await window.api.getOrgHistory();
    listEl.innerHTML = items.length ? '' : '기록이 없습니다.';
    items.forEach((h) => {
      const row = document.createElement('div');
      row.className = 'org-history-row';
      const when = h.at?.seconds ? new Date(h.at.seconds * 1000).toLocaleString('ko-KR') : '';
      row.innerHTML = `<div class="org-history-when">${escapeHtml(when)}</div>${escapeHtml(orgHistoryLine(h))}`;
      listEl.appendChild(row);
    });
  } catch (err) {
    listEl.innerHTML = escapeHtml(chulgoFriendlyError(err));
  }
});
document.getElementById('org-history-close').addEventListener('click', () => {
  document.getElementById('org-history-popup').classList.add('hidden');
});

function orgHistoryLine(h) {
  if (h.type === 'member_update') {
    const b = h.before || {};
    const a = h.after || {};
    return `직원 정보 변경 — ${orgLabelOf(b.organization)}/${b.position || '-'} → ${orgLabelOf(a.organization)}/${a.position || '-'} (권한: ${orgPermissionLabel(a.permission)})`;
  }
  if (h.type === 'team_create') return `팀 생성 — ${orgLabelOf(h.organization)} · ${h.teamName}`;
  if (h.type === 'team_update') return `팀 수정 — ${JSON.stringify(h.changes)}`;
  if (h.type === 'team_delete') return `팀 삭제`;
  if (h.type === 'branch_links_update') return `본부/지점 시트 링크 설정 변경`;
  return h.type || '변경';
}

// ─── 계정 메모 (상호명/ID/PW, 같은 소속끼리만 공유) ──────────────────────────
// 재광님 확인: 마스킹/펼치기 없이 목록에서 바로 다 보여준다. 암호화는 아직 없음(평문) —
// 대신 Firestore 규칙으로 "같은 소속" 사람만 읽을 수 있게 좁혀뒀다.
const financePanel = document.getElementById('finance-panel');
const financeNavBtn = document.getElementById('finance-nav-btn');
const financeOrgLabel = document.getElementById('finance-org-label');
const financeListWrap = document.getElementById('finance-list-wrap');
const financeEmpty = document.getElementById('finance-empty');
const financeSearchInput = document.getElementById('finance-search');
const FINANCE_WINDOW_SIZE_KEY = 'finance_window_size_v1';
const FINANCE_DEFAULT_WINDOW_SIZE = { width: 1100, height: 800 };

let financeCredentials = [];
let financeSearchQuery = '';
let financeEditingId = null;

function financeMatchesSearch(f) {
  if (!financeSearchQuery) return true;
  return `${f.siteName || ''} ${f.authorName || ''}`.toLowerCase().includes(financeSearchQuery);
}

// 사람 1명(1건)의 미니 블록 — 같은 상호명 카드 안에 이게 여러 개 나란히 들어간다.
function financePersonBlockHTML(f) {
  const canEdit = myOrgInfo && (myOrgInfo.uid === f.authorUid || myOrgInfo.permission === 'superAdmin');
  return `
    <div class="finance-person-block" data-id="${f.id}">
      <div class="finance-person-name">
        ${escapeHtml(f.authorName || '')}
        ${canEdit ? `<button type="button" class="finance-edit-icon" data-finance-edit="${f.id}" title="수정">✎</button>` : ''}
      </div>
      <div class="finance-mini-row">
        <span class="finance-mini-label">ID</span>
        <span class="finance-mini-value">${escapeHtml(f.loginId)}</span>
        <button type="button" class="finance-mini-copy" data-copy="${escapeHtml(f.loginId)}" data-copy-label="ID" title="ID 복사">⧉</button>
      </div>
      <div class="finance-mini-row">
        <span class="finance-mini-label">PW</span>
        <span class="finance-mini-value">${escapeHtml(f.loginPw)}</span>
        <button type="button" class="finance-mini-copy" data-copy="${escapeHtml(f.loginPw)}" data-copy-label="비밀번호" title="PW 복사">⧉</button>
      </div>
    </div>`;
}

// 카드 하나 = 상호명 하나. 같은 금융사를 여러 관리자가 갖고 있으면 그 사람들 블록이
// 한 카드 안에 나란히 들어가서(가로 배치) 비교하기 쉽다.
function financeSiteCardHTML(siteName, entries) {
  return `
    <div class="finance-site-card">
      <div class="finance-site-name">${escapeHtml(siteName)}</div>
      <div class="finance-persons-row">
        ${entries.map(financePersonBlockHTML).join('')}
      </div>
    </div>`;
}

function renderFinance() {
  financeOrgLabel.textContent = myOrgInfo?.organization ? orgLabelOf(myOrgInfo.organization) : '';
  const items = financeCredentials.filter(financeMatchesSearch);
  financeEmpty.style.display = items.length ? 'none' : 'block';

  // 상호명 기준으로 묶는다 — "금융사 ID/PW를 빨리 찾는 것"이 1차 목적이라, 같은
  // 금융사를 쓰는 관리자들이 한 카드 안에 모여 보이는 게 비교하기 더 편하다.
  const bySite = new Map();
  items.forEach((f) => {
    const key = (f.siteName || '').trim() || '(이름 없음)';
    if (!bySite.has(key)) bySite.set(key, []);
    bySite.get(key).push(f);
  });

  financeListWrap.innerHTML = [...bySite.entries()]
    .map(([siteName, entries]) => financeSiteCardHTML(siteName, entries))
    .join('');
}

financeListWrap.addEventListener('click', async (ev) => {
  const copyBtn = ev.target.closest('[data-copy]');
  const editBtn = ev.target.closest('[data-finance-edit]');
  if (copyBtn) {
    try {
      await navigator.clipboard.writeText(copyBtn.dataset.copy);
      showToast(`${copyBtn.dataset.copyLabel}가 복사되었습니다.`);
    } catch (err) {
      console.error('복사 실패:', err);
      showToast('복사에 실패했습니다.');
    }
    return;
  }
  if (editBtn) {
    financeOpenPopup(financeCredentials.find((f) => f.id === editBtn.dataset.financeEdit));
  }
});

function financeOpenPopup(item) {
  financeEditingId = item ? item.id : null;
  document.getElementById('finance-popup-title').textContent = item ? '계정 수정' : '계정 추가';
  document.getElementById('finance-site-name').value = item ? item.siteName : '';
  document.getElementById('finance-author-name').value = item ? item.authorName : (myOrgInfo?.name || '');
  document.getElementById('finance-login-id').value = item ? item.loginId : '';
  document.getElementById('finance-login-pw').value = item ? item.loginPw : '';
  document.getElementById('finance-delete').classList.toggle('hidden', !item);
  document.getElementById('finance-status').textContent = '';
  document.getElementById('finance-popup').classList.remove('hidden');
}

document.getElementById('finance-add-open').addEventListener('click', () => financeOpenPopup(null));
document.getElementById('finance-cancel').addEventListener('click', () => {
  document.getElementById('finance-popup').classList.add('hidden');
});

document.getElementById('finance-save').addEventListener('click', async () => {
  const statusEl = document.getElementById('finance-status');
  const siteName = document.getElementById('finance-site-name').value.trim();
  const authorName = document.getElementById('finance-author-name').value.trim();
  const loginId = document.getElementById('finance-login-id').value.trim();
  const loginPw = document.getElementById('finance-login-pw').value.trim();
  if (!siteName) { statusEl.textContent = '상호명을 입력해주세요.'; return; }
  statusEl.textContent = '저장 중...';
  try {
    if (financeEditingId) {
      await window.api.updateFinanceCredential({ id: financeEditingId, siteName, authorName, loginId, loginPw });
    } else {
      await window.api.createFinanceCredential({ siteName, authorName, loginId, loginPw });
    }
    document.getElementById('finance-popup').classList.add('hidden');
  } catch (err) {
    console.error('계정 메모 저장 실패:', err);
    statusEl.textContent = err.message === 'NO_ORGANIZATION_ASSIGNED' ? '소속이 아직 배정되지 않았습니다.' : chulgoFriendlyError(err);
  }
});

document.getElementById('finance-delete').addEventListener('click', async () => {
  if (!financeEditingId) return;
  if (!confirm('이 계정 메모를 삭제할까요?')) return;
  try {
    await window.api.deleteFinanceCredential(financeEditingId);
    document.getElementById('finance-popup').classList.add('hidden');
  } catch (err) {
    document.getElementById('finance-status').textContent = chulgoFriendlyError(err);
  }
});

financeSearchInput.addEventListener('input', () => {
  financeSearchQuery = financeSearchInput.value.trim().toLowerCase();
  renderFinance();
});

window.api.onFinanceUpdate((items) => {
  financeCredentials = items;
  renderFinance();
});

// ─── 금융사 비교시트 ──────────────────────────────────────────────────────
// 캘린더 자리를 갈아치우는 "탭 전환" 방식은 장부와 동일 패턴을 그대로 따른다.
// 데이터는 팀 공유가 필요 없는 개인 작업용 계산기라 Firestore 없이 localStorage에만 저장한다.
const COMPARE_DEFAULT_COMPANIES = [
  'MG캐피탈', 'KB캐피탈', '현대캐피탈', 'BNK캐피탈', '신한카드', '우리카드', '오릭스',
  '하나캐피탈', 'JB우리', '농협캐피탈', '롯데캐피탈', '우리금융캐피탈', '롯데오토리스', 'IM캐피탈', '메리츠캐피탈',
];
const COMPARE_MONTH_OPTIONS = [12, 24, 36, 48, 60];
const COMPARE_INFO_FIELDS = [
  { key: 'carModel', label: '차종' },
  { key: 'price', label: '차량가' },
  { key: 'initialFunds', label: '초기자금' },
  { key: 'discount', label: '할인' },
];
const COMPARE_SHEET_COUNT = 2;
const COMPARE_COMPANIES_KEY = 'compare_companies_v1';
const COMPARE_SHEETS_KEY = 'compare_sheets_v1';
const COMPARE_WINDOW_SIZE_KEY = 'compare_window_size_v1';
const COMPARE_DEFAULT_WINDOW_SIZE = { width: 1728, height: 900 };

const comparePanel = document.getElementById('compare-panel');
const compareSettingsPopup = document.getElementById('compare-settings-popup');

function compareEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function compareLoadJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error(`비교시트(${key}) 불러오기 실패:`, err);
    return null;
  }
}
function compareSaveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`비교시트(${key}) 저장 실패:`, err);
  }
}

let compareCompanies = compareLoadJSON(COMPARE_COMPANIES_KEY);
if (!Array.isArray(compareCompanies) || !compareCompanies.length) {
  compareCompanies = [...COMPARE_DEFAULT_COMPANIES];
}

function compareEmptyRow() {
  return { monthly: '', residual: '' };
}
function compareEmptyInfo() {
  return { carModel: '', price: '', initialFunds: '', discount: '' };
}
function compareDefaultSheet() {
  const rows = {};
  compareCompanies.forEach((c) => { rows[c] = compareEmptyRow(); });
  return { info: compareEmptyInfo(), months: 60, rows };
}

let compareSheets = compareLoadJSON(COMPARE_SHEETS_KEY);
if (!Array.isArray(compareSheets)) compareSheets = [];
compareSheets = compareSheets.slice(0, COMPARE_SHEET_COUNT);
while (compareSheets.length < COMPARE_SHEET_COUNT) compareSheets.push(compareDefaultSheet());
// 회사 목록이 나중에 추가/삭제/변경됐을 수 있으니, 저장된 시트를 항상 현재 목록에 맞춰 정리한다.
function compareNormalizeSheets() {
  compareSheets.forEach((sheet) => {
    if (!sheet.rows) sheet.rows = {};
    if (!sheet.info) sheet.info = compareEmptyInfo(); // 옛 버전엔 title 하나만 있었다 — 4칸으로 바뀌면서 새로 만든다
    if (!COMPARE_MONTH_OPTIONS.includes(Number(sheet.months))) sheet.months = 60;
    compareCompanies.forEach((c) => { if (!sheet.rows[c]) sheet.rows[c] = compareEmptyRow(); });
    Object.keys(sheet.rows).forEach((c) => { if (!compareCompanies.includes(c)) delete sheet.rows[c]; });
  });
}
compareNormalizeSheets();

function compareSaveCompanies() { compareSaveJSON(COMPARE_COMPANIES_KEY, compareCompanies); }
function compareSaveSheets() { compareSaveJSON(COMPARE_SHEETS_KEY, compareSheets); }
// 표 전체(두 시트 모두)를 매 키 입력마다 JSON.stringify + localStorage.setItem 하면
// 타이핑할 때마다 버벅인다 — 입력이 잠깐 멈췄을 때만 실제로 저장한다.
const compareSaveSheetsDebounced = debounce(compareSaveSheets, 300);

function compareWon(n) {
  const v = Number(n);
  if (!v) return '';
  return v.toLocaleString('ko-KR') + '원';
}
// 월납입금/잔존가치 입력칸 자체도 타이핑하는 즉시 "1,234,560원"으로 보이게 — 숫자만
// 남겨서 저장하고(sheet.rows), 화면엔 이 함수로 포맷한 값을 넣는다.
function compareFormatMoneyInput(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  return Number(digits).toLocaleString('ko-KR') + '원';
}
function compareRowTotal(row, months) {
  const monthly = Number(row.monthly) || 0;
  if (!monthly) return null;
  const residual = Number(row.residual) || 0;
  return monthly * months + residual;
}

// 금액이 길어지면 "회사명 / 1,234,567,890원"처럼 한 줄에 다 넣을 때 줄바꿈이 지저분하게
// 밀려서, 순위·회사명 줄과 금액 줄을 아예 나눠 고정폭으로 절대 안 밀리게 한다.
function compareRankListHTML(entries, label, unitLabel) {
  if (!entries.length) {
    return `<div class="compare-rank-box"><h4>${label}</h4><div class="compare-rank-empty">데이터를 입력하면 표시됩니다</div></div>`;
  }
  const rows = entries.map((e, i) => `
    <div class="compare-rank-row${i === 0 ? ' compare-rank-top' : ''}">
      <div class="compare-rank-line1"><span class="compare-rank-no">${i + 1}순위</span><span class="compare-rank-company">${compareEsc(e.company)}</span></div>
      <div class="compare-rank-line2">${unitLabel} : ${compareWon(e.value)}</div>
    </div>`).join('');
  return `<div class="compare-rank-box"><h4>${label}</h4>${rows}</div>`;
}

function compareRankEntries(sheet) {
  const monthlyEntries = [];
  const totalEntries = [];
  compareCompanies.forEach((company) => {
    const row = sheet.rows[company];
    if (!row) return;
    const monthly = Number(row.monthly) || 0;
    if (monthly > 0) monthlyEntries.push({ company, value: monthly });
    const total = compareRowTotal(row, sheet.months);
    if (total != null) totalEntries.push({ company, value: total });
  });
  monthlyEntries.sort((a, b) => a.value - b.value);
  totalEntries.sort((a, b) => a.value - b.value);
  return { monthlyEntries, totalEntries };
}

// 입력 중 포커스가 날아가면 안 되니, 표 전체를 다시 그리지 않고 방금 바뀐 줄의
// 합계 칸과 순위 패널만 업데이트한다 (표/순위 재계산 자체는 가벼워서 매 입력마다 해도 된다).
function compareUpdateRow(idx, company) {
  const sheet = compareSheets[idx];
  const el = document.getElementById(`compare-sheet-${idx}`);
  if (!el) return;
  const cell = el.querySelector(`.compare-total[data-total-for="${CSS.escape(company)}"]`);
  if (cell) cell.textContent = compareWon(compareRowTotal(sheet.rows[company], sheet.months));
}
function compareUpdateRanks(idx) {
  const sheet = compareSheets[idx];
  const el = document.getElementById(`compare-sheet-${idx}`);
  if (!el) return;
  const { monthlyEntries, totalEntries } = compareRankEntries(sheet);

  const panel = el.querySelector('.compare-rank-panel');
  if (panel) {
    panel.innerHTML =
      compareRankListHTML(monthlyEntries.slice(0, 3), '월 대여료 저렴한 순위', '월')
      + compareRankListHTML(totalEntries.slice(0, 3), '총 비용 저렴한 순위', '총');
  }

  // 지금 월납입금이 가장 저렴한 금융사 행에만 파스텔 배경을 실시간으로 입힌다 —
  // 입력할 때마다 1위가 바뀔 수 있으니 매번 전체를 다시 훑어서 지웠다 새로 켠다.
  const cheapestMonthly = monthlyEntries.length ? monthlyEntries[0].company : null;
  el.querySelectorAll('tr[data-row-company]').forEach((tr) => {
    tr.classList.toggle('compare-row-cheapest', tr.dataset.rowCompany === cheapestMonthly);
  });
}

function compareRenderSheet(idx) {
  const sheet = compareSheets[idx];
  const el = document.getElementById(`compare-sheet-${idx}`);
  if (!el) return;

  const { monthlyEntries, totalEntries } = compareRankEntries(sheet);
  const cheapestMonthly = monthlyEntries.length ? monthlyEntries[0].company : null;

  const rowsHTML = compareCompanies.map((company) => {
    const row = sheet.rows[company];
    const total = compareRowTotal(row, sheet.months);
    return `
      <tr data-row-company="${compareEsc(company)}"${company === cheapestMonthly ? ' class="compare-row-cheapest"' : ''}>
        <td class="compare-company">${compareEsc(company)}</td>
        <td><input type="text" inputmode="numeric" class="compare-input" data-company="${compareEsc(company)}" data-field="monthly" value="${compareEsc(compareFormatMoneyInput(row.monthly))}" placeholder="0"></td>
        <td><input type="text" inputmode="numeric" class="compare-input" data-company="${compareEsc(company)}" data-field="residual" value="${compareEsc(compareFormatMoneyInput(row.residual))}" placeholder="0"></td>
        <td class="compare-months-cell">${sheet.months}개월</td>
        <td class="compare-total" data-total-for="${compareEsc(company)}">${compareWon(total)}</td>
      </tr>`;
  }).join('');

  const monthsBarHTML = COMPARE_MONTH_OPTIONS.map((m) =>
    `<button type="button" class="compare-months-btn${m === sheet.months ? ' active' : ''}" data-months="${m}">${m}개월</button>`
  ).join('');

  const infoFieldsHTML = COMPARE_INFO_FIELDS.map(({ key, label }) => `
    <label class="compare-info-field">
      <span>${label}</span>
      <input type="text" class="compare-info-input" data-field="${key}" value="${compareEsc(sheet.info[key] || '')}" maxlength="30">
    </label>`).join('');

  el.innerHTML = `
    <div class="compare-sheet-top">
      <div class="compare-info-row">${infoFieldsHTML}</div>
      <button type="button" class="compare-reset-btn" title="월 납입금·잔존가치 초기화">↺ 초기화</button>
    </div>
    <div class="compare-months-bar">
      <span class="compare-months-label">계약기간</span>
      ${monthsBarHTML}
    </div>
    <div class="compare-body">
      <div class="compare-table-scroll">
        <table class="compare-table">
          <thead>
            <tr><th>금융사</th><th>월 납입금</th><th>잔존가치</th><th>계약기간</th><th>총 인수비용</th></tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>
      <div class="compare-rank-panel">
        ${compareRankListHTML(monthlyEntries.slice(0, 3), '월 대여료 저렴한 순위', '월')}
        ${compareRankListHTML(totalEntries.slice(0, 3), '총 비용 저렴한 순위', '총')}
      </div>
    </div>`;

  el.querySelectorAll('.compare-input').forEach((input) => {
    input.addEventListener('input', () => {
      const raw = input.value.replace(/[^0-9]/g, '');
      sheet.rows[input.dataset.company][input.dataset.field] = raw;
      // 입력하는 즉시 "1,234,560원"으로 다시 표시 — 지저분하게 숫자만 나열되지 않게.
      input.value = compareFormatMoneyInput(raw);
      compareSaveSheetsDebounced();
      compareUpdateRow(idx, input.dataset.company);
      compareUpdateRanks(idx);
    });
    // 저장이 미뤄진 채로(디바운스 대기 중) 다른 화면으로 넘어가는 걸 막기 위해,
    // 이 칸에서 포커스가 빠질 땐 미룰 것 없이 바로 저장한다.
    input.addEventListener('blur', compareSaveSheets);
  });

  el.querySelectorAll('.compare-info-input').forEach((input) => {
    input.addEventListener('input', () => {
      sheet.info[input.dataset.field] = input.value;
      compareSaveSheetsDebounced();
    });
    input.addEventListener('blur', compareSaveSheets);
  });

  el.querySelectorAll('.compare-months-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      sheet.months = Number(btn.dataset.months);
      compareSaveSheets();
      compareRenderSheet(idx);
    });
  });

  el.querySelector('.compare-reset-btn').addEventListener('click', () => {
    if (!confirm('이 표의 월 납입금과 잔존가치를 모두 지울까요? (계약기간·제목은 그대로 둡니다)')) return;
    compareCompanies.forEach((c) => { sheet.rows[c] = compareEmptyRow(); });
    compareSaveSheets();
    compareRenderSheet(idx);
  });
}

function renderCompareAll() {
  for (let i = 0; i < COMPARE_SHEET_COUNT; i++) compareRenderSheet(i);
}

// --- 비교시트 금융사 목록 설정(추가/삭제/이름변경) ---
function compareRenderSettingsList() {
  const listEl = document.getElementById('compare-settings-list');
  listEl.innerHTML = compareCompanies.map((name, i) => `
    <div class="compare-settings-row" data-index="${i}">
      <input type="text" class="compare-settings-name-input" value="${compareEsc(name)}" maxlength="20">
      <button type="button" class="compare-settings-remove-btn" title="삭제">삭제</button>
    </div>`).join('');

  listEl.querySelectorAll('.compare-settings-name-input').forEach((input) => {
    const originalName = input.value;
    input.addEventListener('change', () => {
      const newName = input.value.trim();
      if (!newName || newName === originalName) { input.value = originalName; return; }
      if (compareCompanies.includes(newName)) {
        alert('이미 있는 이름이에요.');
        input.value = originalName;
        return;
      }
      compareRenameCompany(originalName, newName);
    });
  });
  listEl.querySelectorAll('.compare-settings-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.compare-settings-row');
      const name = row.querySelector('.compare-settings-name-input').value;
      if (!confirm(`"${name}"을(를) 목록에서 삭제할까요? 두 표에 입력해둔 이 금융사 값도 함께 지워집니다.`)) return;
      compareRemoveCompany(name);
    });
  });
}

function compareRenameCompany(oldName, newName) {
  const i = compareCompanies.indexOf(oldName);
  if (i === -1) return;
  compareCompanies[i] = newName;
  compareSheets.forEach((sheet) => {
    sheet.rows[newName] = sheet.rows[oldName] || compareEmptyRow();
    delete sheet.rows[oldName];
  });
  compareSaveCompanies();
  compareSaveSheets();
  compareRenderSettingsList();
  renderCompareAll();
}
function compareRemoveCompany(name) {
  compareCompanies = compareCompanies.filter((c) => c !== name);
  compareSheets.forEach((sheet) => { delete sheet.rows[name]; });
  compareSaveCompanies();
  compareSaveSheets();
  compareRenderSettingsList();
  renderCompareAll();
}
const COMPARE_MAX_COMPANIES = 50; // 끝없이 늘어나면 표/저장 용량도 같이 계속 불어난다

function compareAddCompany(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return;
  if (compareCompanies.includes(trimmed)) { alert('이미 있는 이름이에요.'); return; }
  if (compareCompanies.length >= COMPARE_MAX_COMPANIES) {
    alert(`금융사는 최대 ${COMPARE_MAX_COMPANIES}개까지만 등록할 수 있어요. 안 쓰는 곳을 먼저 지워주세요.`);
    return;
  }
  compareCompanies.push(trimmed);
  compareSheets.forEach((sheet) => { sheet.rows[trimmed] = compareEmptyRow(); });
  compareSaveCompanies();
  compareSaveSheets();
  compareRenderSettingsList();
  renderCompareAll();
}

// ─── 왼쪽 사이드바 화면 전환 ──────────────────────────────────────────────
// 예전엔 캘린더가 "홈"이고 장부/비교시트가 거기서 열었다 닫았다 하는 팝업 같은
// 개념이라 화면 쌍(캘린더↔장부, 캘린더↔비교시트)마다 따로 코드가 있었다. 이제
// 사이드바에서 4개 화면(캘린더/메모장/장부/비교시트)을 언제든 바로 오갈 수 있어서,
// "지금 화면"을 기억해뒀다가 "떠나는 화면 크기 저장 → 들어가는 화면 크기 복원"으로
// 통일한다.
const MEMO_WINDOW_SIZE_KEY = 'memo_window_size_v1';
const MEMO_DEFAULT_WINDOW_SIZE = { width: 900, height: 760 };
const AI_WINDOW_SIZE_KEY = 'ai_window_size_v1';
const AI_DEFAULT_WINDOW_SIZE = { width: 900, height: 760 };

const memoPanel = document.getElementById('memo-panel');
const aiPanel = document.getElementById('ai-panel');
const VIEW_PANES = { calendar: appContentEl, memo: memoPanel, ai: aiPanel, chulgo: chulgoPanel, reminder: reminderPanel, compare: comparePanel, org: orgPanel, finance: financePanel };
const VIEW_WINDOW_SIZE = {
  calendar: { key: CALENDAR_WINDOW_SIZE_KEY, default: null },
  memo: { key: MEMO_WINDOW_SIZE_KEY, default: MEMO_DEFAULT_WINDOW_SIZE },
  ai: { key: AI_WINDOW_SIZE_KEY, default: AI_DEFAULT_WINDOW_SIZE },
  chulgo: { key: CHULGO_WINDOW_SIZE_KEY, default: CHULGO_DEFAULT_WINDOW_SIZE },
  reminder: { key: REMINDER_WINDOW_SIZE_KEY, default: REMINDER_DEFAULT_WINDOW_SIZE },
  compare: { key: COMPARE_WINDOW_SIZE_KEY, default: COMPARE_DEFAULT_WINDOW_SIZE },
  org: { key: ORG_WINDOW_SIZE_KEY, default: ORG_DEFAULT_WINDOW_SIZE },
  finance: { key: FINANCE_WINDOW_SIZE_KEY, default: FINANCE_DEFAULT_WINDOW_SIZE },
};
let currentView = 'calendar';

async function switchView(name) {
  if (!VIEW_PANES[name] || name === currentView) return;
  if (name === 'chulgo') await initChulgoViewOnce();
  if (name === 'compare') renderCompareAll();
  if (name === 'org') {
    try {
      await orgFetchMembers();
      renderOrgChart();
    } catch (err) {
      console.error('조직 관리 화면 로딩 실패:', err);
      orgListWrap.innerHTML = `<div class="chulgo-mini-hint">${escapeHtml(chulgoFriendlyError(err))}</div>`;
    }
  }

  // 콘텐츠부터 즉시 바꾼다 — 창 크기 IPC 왕복(save/restore)이 끝나야만 화면이
  // 바뀌던 게 "전환이 느리다"는 체감의 주 원인이었다. 클래스 토글은 동기 작업이라
  // 아래 await가 이벤트 루프에 양보하는 순간 브라우저가 바로 새 화면을 그린다.
  const prevView = currentView;
  VIEW_PANES[prevView].classList.add('hidden');
  VIEW_PANES[name].classList.remove('hidden');
  currentView = name;
  document.querySelectorAll('.sidebar-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });

  await saveCurrentWindowSize(VIEW_WINDOW_SIZE[prevView].key);
  await restoreWindowSize(VIEW_WINDOW_SIZE[name].key, VIEW_WINDOW_SIZE[name].default);
}

document.querySelectorAll('.sidebar-nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

document.getElementById('compare-settings-btn').addEventListener('click', () => {
  compareRenderSettingsList();
  compareSettingsPopup.classList.remove('hidden');
});
document.getElementById('compare-settings-close').addEventListener('click', () => {
  compareSettingsPopup.classList.add('hidden');
});
const compareSettingsAddInput = document.getElementById('compare-settings-add-input');
document.getElementById('compare-settings-add-btn').addEventListener('click', () => {
  compareAddCompany(compareSettingsAddInput.value);
  compareSettingsAddInput.value = '';
  compareSettingsAddInput.focus();
});
compareSettingsAddInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') document.getElementById('compare-settings-add-btn').click();
});

document.getElementById('whats-new-close').addEventListener('click', async () => {
  document.getElementById('whats-new-popup').classList.add('hidden');
  try {
    await window.api.ackWhatsNew();
  } catch (err) {
    console.error('업데이트 내용 확인 처리 실패:', err);
  }
});

// --- Init ---
(async function init() {
  // 정품 앱과 개발 모드 창이 똑같이 생겨서 여러 모니터에 켜두면 어느 게 개발 모드인지
  // 구분이 안 됐다 — 제목에 "(dev)"를 붙여서 한눈에 알아볼 수 있게 한다.
  if (await window.api.getIsDev()) {
    document.title = '스케줄 캘린더 (dev)';
    const titleEl = document.querySelector('.app-title');
    if (titleEl) titleEl.textContent = '🗓️ 스케줄 캘린더 (dev)';
  }

  const theme = await window.api.getTheme();
  applyTheme(theme);

  // 방금 업데이트돼서 새로 켜진 거면, 뭐가 바뀌었는지 다른 무엇보다 먼저 보여준다.
  try {
    const whatsNew = await window.api.getWhatsNew();
    if (whatsNew && whatsNew.notes && whatsNew.notes.length) {
      document.getElementById('whats-new-version').textContent = `v${whatsNew.version}`;
      document.getElementById('whats-new-list').innerHTML = whatsNew.notes.map((n) => `
        <li><span class="whats-new-version-tag">v${n.version}</span><span>${n.line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span></li>
      `).join('');
      document.getElementById('whats-new-popup').classList.remove('hidden');
    }
  } catch (err) {
    console.error('업데이트 내용 불러오기 실패:', err);
  }

  const status = await window.api.getConfigStatus();
  isConfigured = status.configured;
  if (!isConfigured) configBanner.classList.remove('hidden');

  isGoogleSignedIn = await window.api.googleIsSignedIn();
  if (isGoogleSignedIn) currentUser = await window.api.getCurrentUser();
  renderGoogleStatus();
  updateNoticeInputState();
  renderMemos();
  await renderCalendar();
})();
