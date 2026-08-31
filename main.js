const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain, Notification, dialog, Tray, Menu, nativeImage, shell, screen } = require('electron');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const koreanHolidays = require('./src/main/koreanHolidays');
const { writeSettlement, COL_LETTERS } = require('./src/main/settlementWriter');
const googleAuth = require('./src/main/googleAuth');
const firebaseClient = require('./src/main/firebaseClient');
const fileSearch = require('./src/main/fileSearch');

// 개발 모드(npm start)와 설치된 정품 앱이 같은 이름을 쓰면 같은 설정 폴더(userData)를
// 공유하게 되고, Electron의 단일 인스턴스 잠금이 "이미 실행 중"으로 보고 개발 모드를
// 아무 에러 메시지 없이 조용히 종료시켜버린다 — 정품 앱이 켜져 있는 한 npm start가
// 매번 원인 불명으로 안 켜지던 문제가 바로 이거였다. 개발 모드만 별도 폴더를 쓰게 분리한다.
if (!app.isPackaged) {
  app.setName('스케줄 캘린더 (dev)');
  app.setPath('userData', path.join(app.getPath('appData'), '스케줄 캘린더 (dev)'));
}

const settingsStore = new Store({ name: 'app-settings' });
const teamEventMapStore = new Store({ name: 'team-event-map' }); // teamEventId -> { googleEventId, signature }

// google:get-events가 호출될 때마다 teamEventMapStore 전체를 훑어 역방향(googleEventId ->
// teamEventId) Map을 새로 만들었는데, 이 store는 삭제 확인된 것만 지워지고 그 외엔 계속
// 쌓이기만 한다(handleTeamEventsUpdate 참고) — 캘린더 조회마다 그 전체를 다시 훑는 대신
// 한 번 만든 걸 캐시해두고, 실제로 store가 바뀔 때만(mutate 시점에) 무효화한다.
let teamEventReverseMapCache = null;
function invalidateTeamEventReverseMap() { teamEventReverseMapCache = null; }
function getTeamEventReverseMap() {
  if (!teamEventReverseMapCache) {
    teamEventReverseMapCache = new Map();
    for (const teamEventId of Object.keys(teamEventMapStore.store)) {
      teamEventReverseMapCache.set(teamEventMapStore.get(teamEventId).googleEventId, teamEventId);
    }
  }
  return teamEventReverseMapCache;
}

const TEAM_EVENT_COLOR_ID = '11'; // Google Calendar "Tomato" red, to visually flag team-shared events

const CONFIG_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'config')
  : path.join(__dirname, 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const CONFIG_EXAMPLE_PATH = path.join(CONFIG_DIR, 'config.example.json');

// 텍스트 매크로는 더 이상 이 앱과 함께 배포하지 않는다.
// 그 도구는 시스템 전역 저수준 키보드 훅(WH_KEYBOARD_LL)을 설치하는데, 붙여넣기 작업
// (클립보드 재시도 + 사진 로딩 + 전송 대기 sleep, 수 초 소요)을 훅을 설치한 바로 그
// 스레드에서 실행했다. 그 사이 그 스레드가 메시지를 못 받으면 Windows 는 훅이 응답할
// 때까지 "모든 프로그램의 키 입력"을 멈춰 세운다 — 직원들이 겪던 "입력칸이 몇십 초씩
// 막힌다"는 증상의 실제 원인이었다. 캘린더와 무관한 도구라 아예 분리했다.

function loadConfig() {
  const configPath = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : CONFIG_EXAMPLE_PATH;
  const raw = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw);
  const isPlaceholder = configPath === CONFIG_EXAMPLE_PATH;
  return { config, isPlaceholder };
}

const { config, isPlaceholder } = loadConfig();
const rootAdminEmails = (config.adminEmails || []).map((e) => e.toLowerCase());
let dynamicAdminEmails = new Set();

let mainWindow;
let tray = null;
let isQuitting = false;
let isPinned = false;
let firebaseHandle = null;

const memoAlarmTimers = new Map(); // memoId -> Timeout
const reminderAlarmTimers = new Map(); // reminderId -> Timeout

let unsubscribeAdmins = null;

let unsubscribeTeamEvents = null;
let teamEventStartDateTimer = null;
// 실시간 구독이 startDate 범위로 걸러지므로, 그 필드가 없는 문서는 아예 안 보인다.
// 아직 업데이트 안 한 구버전 앱(관리자)이 새 팀 일정을 만들면 startDate 없이 저장돼서
// 업데이트한 사람들 화면에선 그 일정이 사라진 것처럼 보인다 — 전 직원이 새 버전으로
// 갈아탈 때까지의 과도기를 버티려고, 로그인 중에는 주기적으로도 채워준다.
const TEAM_EVENT_MIGRATION_INTERVAL_MS = 10 * 60 * 1000;
let teamEventsCache = [];
let isFirstTeamEventsSnapshot = true;
const teamEventSyncFailures = new Map(); // teamEventId -> lastFailedAtMillis
const TEAM_EVENT_RETRY_COOLDOWN_MS = 5 * 60 * 1000; // don't hammer the Calendar API for events that keep failing
const teamEventSyncInFlight = new Map(); // teamEventId -> in-progress Promise (prevents duplicate creates)

let unsubscribeChulgo = null;
let unsubscribeReminders = null;

const APP_ICON_PATH = path.join(__dirname, 'build', 'icon.png');

// --- 분리형 "할 일" 위젯 창 — 메인 창과 독립적으로 띄워두고 위치를 자유롭게 둘 수 있다.
// 데이터(구글 Tasks)는 메인 창의 메모칸과 완전히 같은 걸 보므로, 별도 창이지만 같은
// memos:update/memos:alarm 이벤트를 그대로 받는다.
let tasksWidgetWindow = null;
const TASKS_WIDGET_BOUNDS_KEY = 'tasksWidgetBounds';
const TASKS_WIDGET_WAS_OPEN_KEY = 'tasksWidgetWasOpen';

function broadcastMemos(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  if (tasksWidgetWindow && !tasksWidgetWindow.isDestroyed()) tasksWidgetWindow.webContents.send(channel, payload);
}

function createTasksWidgetWindow() {
  if (tasksWidgetWindow && !tasksWidgetWindow.isDestroyed()) {
    tasksWidgetWindow.show();
    tasksWidgetWindow.focus();
    return;
  }

  // 저장된 위치가 그때는 있었지만 지금은 없는 모니터(외장 모니터를 뺐다든지)에
  // 걸쳐 있으면, 화면 밖 안 보이는 곳에 창이 떠서 "위젯이 사라졌다"처럼 보인다 —
  // 지금 연결된 화면들과 조금이라도 겹치는지 확인하고, 안 겹치면 기본 위치로 되돌린다.
  let savedBounds = settingsStore.get(TASKS_WIDGET_BOUNDS_KEY);
  if (savedBounds) {
    const fitsAnyDisplay = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      const overlapW = Math.min(savedBounds.x + savedBounds.width, a.x + a.width) - Math.max(savedBounds.x, a.x);
      const overlapH = Math.min(savedBounds.y + savedBounds.height, a.y + a.height) - Math.max(savedBounds.y, a.y);
      return overlapW > 40 && overlapH > 40; // 최소 40px는 실제 화면 안에 보여야 "찾을 수 있는" 위치로 친다
    });
    if (!fitsAnyDisplay) savedBounds = null;
  }

  tasksWidgetWindow = new BrowserWindow({
    width: 300,
    height: 420,
    minWidth: 220,
    minHeight: 260,
    ...(savedBounds || {}),
    title: '할 일',
    icon: APP_ICON_PATH,
    backgroundColor: '#161a2b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  tasksWidgetWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'tasks-widget.html'));
  tasksWidgetWindow.setMenuBarVisibility(false);
  tasksWidgetWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[tasks-widget] ${message} (${sourceId}:${line})`);
  });

  const persistBounds = () => {
    if (!tasksWidgetWindow || tasksWidgetWindow.isDestroyed()) return;
    settingsStore.set(TASKS_WIDGET_BOUNDS_KEY, tasksWidgetWindow.getBounds());
  };
  tasksWidgetWindow.on('moved', persistBounds);
  tasksWidgetWindow.on('resized', persistBounds);
  tasksWidgetWindow.on('closed', () => {
    tasksWidgetWindow = null;
    settingsStore.set(TASKS_WIDGET_WAS_OPEN_KEY, false);
  });

  settingsStore.set(TASKS_WIDGET_WAS_OPEN_KEY, true);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 960,
    // "캘린더만 보기" 모드에서 메모장/일정 패널이 빠지면 훨씬 작은 폭에서도 충분히
    // 쓸 수 있어서, 최소 크기를 더 작게 열어둔다.
    minWidth: 860,
    minHeight: 640,
    frame: false,
    maximizable: false,
    backgroundColor: '#161a2b',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 엑셀/구글시트 같은 다른 프로그램에 갔다가 이 창으로 돌아오면 한동안 클릭이
      // 안 먹히던 문제 — Electron이 백그라운드에 오래 있던 창을 절전 모드처럼
      // 스로틀링해서 생기는 현상이다. 이 앱은 항상 바로바로 반응해야 하니 꺼둔다.
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  // Renderer console.error/warn wouldn't otherwise reach the main process's stdout —
  // forward them so they show up wherever this app's own logs are captured.
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`);
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(APP_ICON_PATH).resize({ width: 32, height: 32 });
  tray = new Tray(trayIcon);
  tray.setToolTip('스케줄 캘린더');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '열기',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

// --- 왼쪽 메모장 = Google Tasks("내 할 일 목록") + 로컬 정밀 알람 ---
// 이전엔 Firestore 개인 컬렉션이라 실시간 push 였는데, 이제 폰 Gmail/캘린더 앱의
// "내 할 일 목록" 위젯과 그대로 공유되도록 Google Tasks 로 옮겼다. Tasks API 는 push가
// 없어서 일정 주기로 직접 물어봐서 새로고침한다 — 앱을 켜두는 동안만 돌면 되니 1분이면 충분하다.
const MEMOS_POLL_INTERVAL_MS = 60 * 1000;
let memosPollTimer = null;

async function refreshMemosFromGoogleTasks() {
  if (!googleAuth.isSignedIn()) return;
  try {
    const memos = await googleAuth.listTasks(config.google);
    handleMemosUpdate(memos);
  } catch (err) {
    console.error('할 일 목록 불러오기 실패:', err);
  }
}

function startMemosSubscription() {
  if (memosPollTimer) return; // already polling
  refreshMemosFromGoogleTasks();
  memosPollTimer = setInterval(refreshMemosFromGoogleTasks, MEMOS_POLL_INTERVAL_MS);
  if (typeof memosPollTimer.unref === 'function') memosPollTimer.unref();
}

function stopMemosSubscription() {
  if (memosPollTimer) {
    clearInterval(memosPollTimer);
    memosPollTimer = null;
  }
  memoAlarmTimers.forEach((timer) => clearTimeout(timer));
  memoAlarmTimers.clear();
  broadcastMemos('memos:update', []);
}

function fireMemoAlarm(memo) {
  new Notification({ title: '⏰ 메모 알림', body: memo.text }).show();
  broadcastMemos('memos:alarm', memo);
  // 다시 안 울리게 알람 표식만 지운다 — 메모(할 일) 자체는 그대로 남는다.
  googleAuth
    .updateTask(config.google, { id: memo.id, alarmTime: null })
    .catch((err) => console.error('메모 알람 처리 실패:', err));
}

// Google Tasks 의 마감일(due, 날짜만)과 로컬 alarmTime(HH:mm) 표식을 합쳐서 실제
// 울릴 시각(ms)을 만든다. due 는 자정 UTC로 저장돼 있는데, 한국(UTC+9)에선 그게 이미
// 같은 날 오전 9시라 로컬 날짜로 그대로 읽어도 날짜가 안 밀린다.
function memoAlarmTargetMs(memo) {
  if (!memo.alarmTime || !memo.due) return null;
  const [h, m] = memo.alarmTime.split(':').map(Number);
  const d = new Date(memo.due);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime();
}

// 폴링마다 아직 안 울린 알람들에 타이머를 걸어준다(이미 걸린 건 건너뛰어서 중복
// 방지). 앱이 꺼져있는 동안 지나버린 알람은, 켜지자마자 한 번 바로 울려서 놓치지 않게 한다.
function handleMemosUpdate(memos) {
  const currentIds = new Set(memos.map((m) => m.id));
  for (const [id, timer] of memoAlarmTimers) {
    if (!currentIds.has(id)) {
      clearTimeout(timer);
      memoAlarmTimers.delete(id);
    }
  }

  memos.forEach((memo) => {
    const targetMs = memoAlarmTargetMs(memo);
    if (!targetMs || memo.done || memoAlarmTimers.has(memo.id)) return;
    const delay = targetMs - Date.now();
    if (delay <= 0) {
      fireMemoAlarm(memo);
      return;
    }
    const timer = setTimeout(() => {
      memoAlarmTimers.delete(memo.id);
      fireMemoAlarm(memo);
    }, delay);
    memoAlarmTimers.set(memo.id, timer);
  });

  broadcastMemos('memos:update', memos);
}

// --- 고객 리마인더 알림 — 등록할 때 지정한 날짜 오전 9시에 한 번 알려준다.
// 메모 알람(위)과 같은 패턴: 아직 안 울린 것만 타이머를 걸고, 앱이 꺼져있던 동안
// 지나버린 날짜는 켜지자마자 바로 한 번 울려서 놓치지 않는다. ---

function reminderTargetMs(r) {
  if (!r.remindDate || r.done || r.notified) return null;
  const [y, m, d] = r.remindDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 9, 0, 0, 0).getTime();
}

function fireReminderAlarm(r) {
  const title = r.car ? `${r.name} (${r.car})` : r.name;
  new Notification({ title: '📇 고객 상담 알림', body: `${title}${r.note ? ' — ' + r.note : ''}` }).show();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reminders:alarm', r);
  // 다시 안 울리게 알림 표식만 남긴다 — 리마인더 자체는 목록에 그대로 남는다(메모 알람과 동일한 정책).
  firebaseClient
    .updateReminder(firebaseHandle.db, r.id, { notified: true })
    .catch((err) => console.error('리마인더 알림 처리 실패:', err));
}

function handleRemindersUpdate(reminders) {
  const currentIds = new Set(reminders.map((r) => r.id));
  for (const [id, timer] of reminderAlarmTimers) {
    if (!currentIds.has(id)) {
      clearTimeout(timer);
      reminderAlarmTimers.delete(id);
    }
  }

  reminders.forEach((r) => {
    const targetMs = reminderTargetMs(r);
    if (!targetMs || reminderAlarmTimers.has(r.id)) return;
    const delay = targetMs - Date.now();
    if (delay <= 0) {
      fireReminderAlarm(r);
      return;
    }
    // setTimeout은 ms가 너무 크면(약 24.8일 이상) 즉시 발동하는 버그가 있다 — 리마인더는
    // 몇 달 뒤가 흔해서 실제로 걸릴 수 있는 케이스다. 하루 단위로 나눠서 다시 걸어준다.
    const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
    const scheduleChunked = (remaining) => {
      const chunk = Math.min(remaining, MAX_TIMEOUT_MS);
      const timer = setTimeout(() => {
        const left = remaining - chunk;
        if (left <= 0) {
          reminderAlarmTimers.delete(r.id);
          fireReminderAlarm(r);
        } else {
          scheduleChunked(left);
        }
      }, chunk);
      reminderAlarmTimers.set(r.id, timer);
    };
    scheduleChunked(delay);
  });

  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reminders:update', reminders);
}

function startReminderSubscription() {
  if (unsubscribeReminders) return;
  const uid = firebaseHandle.auth.currentUser && firebaseHandle.auth.currentUser.uid;
  if (!uid) return;
  unsubscribeReminders = firebaseClient.subscribeToReminders(
    firebaseHandle.db,
    uid,
    handleRemindersUpdate,
    (err) => console.error('리마인더 subscribe error:', err)
  );
}

function stopReminderSubscription() {
  if (unsubscribeReminders) {
    unsubscribeReminders();
    unsubscribeReminders = null;
  }
  reminderAlarmTimers.forEach((timer) => clearTimeout(timer));
  reminderAlarmTimers.clear();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reminders:update', []);
}

// --- Dynamic admin list realtime ---

function startAdminsSubscription() {
  if (unsubscribeAdmins) return;
  unsubscribeAdmins = firebaseClient.subscribeToAdmins(
    firebaseHandle.db,
    (emails) => {
      dynamicAdminEmails = new Set(emails.map((e) => e.toLowerCase()));
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('auth:updated', currentUserPayload());
    },
    (err) => console.error('admins subscribe error:', err)
  );
}

function stopAdminsSubscription() {
  if (unsubscribeAdmins) {
    unsubscribeAdmins();
    unsubscribeAdmins = null;
  }
  dynamicAdminEmails = new Set();
}

// --- Team-shared calendar events: sync into each signed-in user's OWN Google Calendar ---

function teamEventSignature(ev) {
  return JSON.stringify({ title: ev.title, start: ev.start, end: ev.end, allDay: ev.allDay });
}

async function syncTeamEventToCalendar(ev, { notify }) {
  // The Firestore listener and a direct post-write call (from the IPC handler that just
  // made the change) can both land here for the same event almost simultaneously. Without
  // serializing per-id, both would see "no mapping yet" and each create a duplicate Google
  // Calendar event. Piggyback on any in-flight sync for the same id instead of racing it.
  if (teamEventSyncInFlight.has(ev.id)) {
    return teamEventSyncInFlight.get(ev.id);
  }

  const syncPromise = (async () => {
    const lastFailedAt = teamEventSyncFailures.get(ev.id);
    if (lastFailedAt && Date.now() - lastFailedAt < TEAM_EVENT_RETRY_COOLDOWN_MS) {
      return; // recently failed (e.g. API error) — don't hammer the Calendar API every snapshot
    }

    const mapping = teamEventMapStore.get(ev.id);
    const signature = teamEventSignature(ev);

    try {
      if (!mapping) {
        const created = await googleAuth.createEvent(config.google, {
          summary: `👥 ${ev.title}`,
          start: ev.start,
          end: ev.end,
          colorId: TEAM_EVENT_COLOR_ID,
        });
        teamEventMapStore.set(ev.id, { googleEventId: created.id, signature });
        invalidateTeamEventReverseMap();
        if (notify) {
          new Notification({ title: '📅 팀 일정 추가', body: `${ev.title} (${ev.createdByName || '관리자'})` }).show();
        }
      } else if (mapping.signature !== signature) {
        await googleAuth.updateEvent(config.google, {
          eventId: mapping.googleEventId,
          summary: `👥 ${ev.title}`,
          start: ev.start,
          end: ev.end,
          colorId: TEAM_EVENT_COLOR_ID,
        });
        teamEventMapStore.set(ev.id, { googleEventId: mapping.googleEventId, signature });
        invalidateTeamEventReverseMap();
      }
      teamEventSyncFailures.delete(ev.id);
    } catch (err) {
      teamEventSyncFailures.set(ev.id, Date.now());
      throw err;
    }
  })();

  teamEventSyncInFlight.set(ev.id, syncPromise);
  try {
    return await syncPromise;
  } finally {
    teamEventSyncInFlight.delete(ev.id);
  }
}

async function handleTeamEventsUpdate(events) {
  const previousIds = new Set(teamEventsCache.map((e) => e.id));
  const newIds = new Set(events.map((e) => e.id));
  const notify = !isFirstTeamEventsSnapshot;
  teamEventsCache = events;
  isFirstTeamEventsSnapshot = false;

  if (!googleAuth.isSignedIn()) return; // will reconcile once the user signs in

  for (const prevId of previousIds) {
    if (newIds.has(prevId)) continue;
    const mapping = teamEventMapStore.get(prevId);
    if (mapping) {
      // 실시간 구독이 "최근 기간"만 보기 때문에, 사라졌다고 해서 곧 삭제는 아니다 —
      // 날짜를 기간 밖으로 옮겨도 똑같이 사라져 보인다. 진짜 지워진 게 맞는지
      // 확인하고 나서만 각자 구글 캘린더에서 지운다(멀쩡한 일정 삭제 방지).
      let reallyDeleted = true;
      try {
        reallyDeleted = !(await firebaseClient.teamEventExists(firebaseHandle.db, prevId));
      } catch (err) {
        // 확인 자체가 실패하면(네트워크 등) 지우지 않고 넘어간다 — 잘못 지우는 것보다
        // 남겨두는 쪽이 안전하고, 다음 기회에 다시 정리된다.
        console.error('팀 일정 삭제 여부 확인 실패:', err);
        reallyDeleted = false;
      }
      if (!reallyDeleted) continue;

      try {
        await googleAuth.deleteEvent(config.google, { eventId: mapping.googleEventId });
      } catch (err) {
        console.error('팀 일정 삭제 동기화 실패:', err);
      }
      teamEventMapStore.delete(prevId);
      invalidateTeamEventReverseMap();
    }
    teamEventSyncFailures.delete(prevId);
  }

  for (const ev of events) {
    try {
      await syncTeamEventToCalendar(ev, { notify });
    } catch (err) {
      console.error('팀 일정 동기화 실패:', err);
    }
  }
}

async function reconcileTeamEventsForCurrentUser() {
  if (!googleAuth.isSignedIn()) return;
  for (const ev of teamEventsCache) {
    try {
      await syncTeamEventToCalendar(ev, { notify: false });
    } catch (err) {
      console.error('팀 일정 재동기화 실패:', err);
    }
  }
}

function runTeamEventStartDateBackfill() {
  if (!firebaseHandle) return;
  // 컬렉션 전체를 훑는 조회라 과도기가 끝난 뒤에도 10분마다 계속 돌면 낭비다 —
  // 채울 게 하나도 없는 게 한 번 확인되면(=전 직원이 새 버전으로 갈아탐) 다시는 돌지
  // 않게 플래그를 남긴다(tasksScopeMigrationDone과 같은 패턴).
  if (settingsStore.get('teamEventStartDateMigrationDone')) {
    stopTeamEventStartDateBackfill();
    return;
  }
  firebaseClient.migrateTeamEventStartDates(firebaseHandle.db)
    .then((n) => {
      if (n) {
        console.log(`[team-events] startDate 없던 일정 ${n}건 채움`);
      } else {
        settingsStore.set('teamEventStartDateMigrationDone', true);
        stopTeamEventStartDateBackfill();
      }
    })
    .catch((err) => console.error('팀 일정 startDate 보정 실패:', err));
}

function startTeamEventStartDateBackfill() {
  runTeamEventStartDateBackfill();
  if (teamEventStartDateTimer) return;
  teamEventStartDateTimer = setInterval(runTeamEventStartDateBackfill, TEAM_EVENT_MIGRATION_INTERVAL_MS);
  if (typeof teamEventStartDateTimer.unref === 'function') teamEventStartDateTimer.unref();
}

function stopTeamEventStartDateBackfill() {
  if (!teamEventStartDateTimer) return;
  clearInterval(teamEventStartDateTimer);
  teamEventStartDateTimer = null;
}

function startTeamEventsSubscription() {
  if (unsubscribeTeamEvents) return;
  isFirstTeamEventsSnapshot = true;
  unsubscribeTeamEvents = firebaseClient.subscribeToTeamEvents(
    firebaseHandle.db,
    handleTeamEventsUpdate,
    (err) => console.error('team events subscribe error:', err)
  );
}

function stopTeamEventsSubscription() {
  if (unsubscribeTeamEvents) {
    unsubscribeTeamEvents();
    unsubscribeTeamEvents = null;
  }
  teamEventsCache = [];
  isFirstTeamEventsSnapshot = true;
}

// --- Personal 출고 관리 장부 realtime (scoped to the signed-in user's own uid) ---

function startChulgoSubscription() {
  if (unsubscribeChulgo) return;
  const uid = firebaseHandle.auth.currentUser && firebaseHandle.auth.currentUser.uid;
  if (!uid) return;
  unsubscribeChulgo = firebaseClient.subscribeToChulgoEntries(
    firebaseHandle.db,
    uid,
    (entries) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('chulgo:update', entries);
    },
    (err) => console.error('출고 장부 subscribe error:', err)
  );
}

function stopChulgoSubscription() {
  if (unsubscribeChulgo) {
    unsubscribeChulgo();
    unsubscribeChulgo = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('chulgo:update', []);
}

// --- Shared helpers ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Subscriptions are driven centrally by onAuthStateChanged (see setupAuthStateListener),
// not from here — this function's only job is to get Firebase signed in. Right after a
// reboot, networking can still be settling, so a single failed attempt used to leave the
// user looking "signed in" (their Google Calendar token was still cached locally) while
// Firestore silently never connected — every subscription's data (개인 메모, the
// 출고 장부, etc.) stayed empty with no visible error. Retrying here closes that window.
async function trySignInFirebaseFromStoredGoogleSession() {
  if (!firebaseHandle || !googleAuth.isSignedIn()) return;
  const attempts = 4;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const idToken = await googleAuth.getFreshIdToken(config.google);
      await firebaseClient.signInWithGoogleIdToken(firebaseHandle.auth, idToken);
      return;
    } catch (err) {
      console.error(`저장된 구글 세션으로 재로그인 실패 (시도 ${i + 1}/${attempts}):`, err);
      if (i < attempts - 1) await sleep(2000 * (i + 1));
    }
  }
}

// Single source of truth for "is Firebase actually signed in right now" — fires
// immediately with the current state and again on every future change, so a slow or
// retried sign-in (or a sign-out) always starts/stops the right subscriptions exactly
// once, regardless of timing.
function setupAuthStateListener() {
  firebaseClient.onAuthStateChangedListener(firebaseHandle.auth, (user) => {
    if (user) {
      startTeamEventStartDateBackfill();
      startMemosSubscription();
      startAdminsSubscription();
      startTeamEventsSubscription();
      startChulgoSubscription();
      startReminderSubscription();
      reconcileTeamEventsForCurrentUser().catch((err) => console.error('팀 일정 재동기화 실패:', err));
    } else {
      stopMemosSubscription();
      stopAdminsSubscription();
      stopTeamEventsSubscription();
      stopTeamEventStartDateBackfill();
      stopChulgoSubscription();
      stopReminderSubscription();
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('auth:updated', currentUserPayload());
  });
}

function currentUserPayload() {
  const user = firebaseHandle && firebaseHandle.auth.currentUser;
  if (!user) return { signedIn: false };
  const email = (user.email || '').toLowerCase();
  return {
    signedIn: true,
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    isAdmin: rootAdminEmails.includes(email) || dynamicAdminEmails.has(email),
    isRootAdmin: rootAdminEmails.includes(email),
  };
}

// 업데이트될 때마다 뭐가 바뀌었는지 앱 안에서 바로 보여주기 위한 목록 — 채팅에서
// 설명하는 내용을 그대로 여기 한 줄씩 남겨둔다. 버전 하나하나 다 안 적어도 되고,
// 사용자에게 보여줄 만한 버전에만 적어두면 그 사이 버전은 자동으로 같이 묶여 보인다.
const CHANGELOG = {
  '0.30.2': ['장부의 "공제후총수수료" 계산에서 페이백이 반영되지 않던 버그 수정 (페이백을 넣어도 합계가 그대로였던 문제)'],
  '0.30.5': ['장부 수수료 계산에 빠져있던 추가수수료 항목 반영'],
  '0.31.0': ['🆕 금융사 비교시트 추가 — 금융사별 월납입금/잔존가치로 총인수비용을 자동 계산하고, 저렴한 순위를 보여줍니다'],
  '0.31.1': ['비교시트: 뒤로가기 버튼 표시 개선, 차종/차량가/초기자금/할인 입력칸 추가, 금액 입력 시 자동 콤마 표시'],
  '0.31.2': ['비교시트: 순위 박스에서 금액이 길어도 줄이 안 밀리도록 레이아웃 개선'],
  '0.31.3': ['비교시트: 월납입금이 가장 저렴한 금융사 행이 실시간으로 강조 표시됩니다'],
  '0.31.4': ['업데이트 과정을 완전히 자동화 — 이제 "다운로드 하시겠습니까?" 확인 없이 새 버전이 있으면 바로 백그라운드로 받고, 재시작 여부만 한 번 물어봅니다', '업데이트 후 첫 실행 시 이 화면처럼 무엇이 바뀌었는지 자동으로 보여줍니다'],
  '0.31.5': [
    '🆕 전체 UI 개편 — 왼쪽에 캘린더/메모장/AI 어시스턴트/정산장부/비교시트 카테고리 사이드바를 추가했습니다. 타이틀바에 흩어져 있던 아이콘 대신 사이드바에서 바로 전환합니다',
    '메모장이 캘린더 옆 좁은 칸 대신 독립된 화면이 되었고, "오늘 것만"이 아니라 전체 메모를 표로 보여줍니다 — 체크박스로 여러 개 골라서 한 번에 완료 처리/삭제할 수 있습니다',
    'AI 어시스턴트도 캘린더 날짜를 클릭해야만 보이던 것에서, 언제든 바로 들어갈 수 있는 독립 화면이 되었습니다',
  ],
  '0.31.6': ['일정/할 일 저장이 가끔 20~30초씩 멈추던 문제 — 구글 로그인이 조용히 갱신되는 과정에 시간 제한이 없어서였습니다. 이제 20초 안에 응답이 없으면 멈춰있지 않고 바로 오류로 알려드립니다'],
  '0.31.7': ['메모장을 Things/Todoist 같은 유명 할 일 앱 스타일로 다시 디자인 — 표 대신 기한 지남/오늘/내일/이번 주/나중 섹션으로 나눠 보여주고, 체크박스는 바로 완료 처리(원터치), 완료된 건 아래 접히는 칸으로 모입니다. 삭제 버튼은 마우스를 올렸을 때만 보입니다'],
  '0.31.8': [
    '정산 장부 UI를 토스·스트라이프류 최신 정산 대시보드 스타일로 새로 디자인 — 이번 달 수수료를 큼직하게 강조하는 히어로 카드, 상태 배지, 겹친 그림자로 입체감을 살렸습니다. 색감은 더 청량한 블루 톤으로, 한글 전용 모던 서체(Pretendard)를 적용했습니다',
    '🆕 금액 가리기(모자이크) 기능 추가 — 히어로 카드/월 합계/표의 수수료 칸을 아무 곳이나 클릭하면 전부 한 번에 블러 처리됩니다. 다시 클릭할 때까지, 화면을 바꾸거나 앱을 껐다 켜도 그 상태가 유지됩니다',
  ],
  '0.32.0': [
    '정산 장부 표의 금융정보/금융사/계약기간/주행거리 칸이 투입여부처럼 알약 모양 드롭다운이 되었습니다. 계약기간은 12~72개월, 주행거리는 5,000~50,000KM(+무제한/해당없음) 중에서 고르면 됩니다',
    '🆕 캘린더가 대체공휴일까지 정확히 계산해서 빨간날로 표시합니다 — 설날·추석 연휴가 하루가 아니라 실제 3일 전부 빨간날로 나오고, 날짜 옆에 공휴일 이름도 바로 보입니다(예: "15 광복절"). 오늘 날짜는 파란 원형 배지로 한눈에 띄게 했습니다',
    '🆕 금융사 비교시트 UI를 정산 장부와 같은 토스·스트라이프풍 스타일로 전면 개편했습니다',
    '앱 전반 최적화 — 구글 로그인 창을 닫고 방치하면 생기던 메모리 누수와 드문 크래시 위험을 고쳤고, 팀 일정 동기화·내 PC 파일 찾기 속도를 개선했으며, 정산/비교시트에서 타이핑할 때 버벅이던 부분들을 손봤습니다',
  ],
  '0.33.0': [
    '🆕 UI/UX 전면 개편 — 캘린더·장부·비교시트가 하나의 제품처럼 보이도록 색상/여백/버튼/모달 스타일을 통일하고, 앞으로 모바일(안드로이드) 버전을 만들 때도 그대로 재사용할 수 있는 디자인 시스템을 마련했습니다',
    '탭을 바꿀 때 창 크기가 다시 맞춰지느라 화면이 튀던 현상을 줄였습니다 — 같은 크기면 다시 조절하지 않고, 화면 내용부터 먼저 바뀌도록 순서를 정리했습니다(화면별 창 크기 기억 기능은 그대로입니다)',
    '창을 작게 줄여도(그리고 향후 모바일 화면에서도) 레이아웃이 깨지지 않도록 반응형 구조를 처음 도입했습니다',
    '정산 장부 화면의 버튼/입력이 너무 몰려 보이던 문제를 정리했습니다 — 주요 액션(+ 출고 건 추가)은 더 눈에 띄게, 엑셀 출력·문구 생성은 낮은 강조로 그룹을 나누고, 직책/연락처 입력은 액션 버튼과 분리했습니다',
    '헷갈리던 금액 두 개(히어로 카드의 실수령액과 표 위 합계)에 각각 무엇을 뜻하는지 라벨을 붙였습니다',
    '공휴일 이름·요일·캘린더 안내 문구 등 너무 작았던 글씨 크기를 최소 11px로 올렸습니다',
    '"정산서 엑셀 (내 급여 확인용)" 같은 버튼 안 설명 문구를 짧게 정리하고, 자세한 설명은 마우스를 올렸을 때 보이도록 옮겼습니다',
  ],
  '0.33.1': [
    '자주 쓰는 "출고현황 엑셀" / "정산서 엑셀" 버튼을 더 눈에 띄게 키우고 아이콘을 붙였습니다',
  ],
  '0.34.0': [
    '🆕 테마 프리셋 5종(소프트 다크/미드나잇/포레스트/오션/라벤더) 추가 — 설정에서 색상 미리보기를 보고 바로 고를 수 있습니다. 기존 다크/라이트/사용자 설정 테마는 그대로 있고, 다크 테마는 순검정 대신 눈이 편한 차콜 톤으로, 라이트 테마는 배경/카드 계층이 더 또렷하게 다듬어졌습니다',
    '🆕 글씨체 선택지에 Noto Sans KR / IBM Plex Sans KR을 추가하고, 고를 때 바로 문장으로 미리 볼 수 있게 했습니다',
    '버튼 클릭/마우스 오버 반응, 모달 등장, 사이드바 선택 표시, 캘린더 일정 hover 등 화면 곳곳의 자잘한 인터랙션을 다듬었습니다',
  ],
  '0.34.1': [
    '출고현황 엑셀의 수수료율(%) 칸에 자동으로 걸리던 계산식을 없앴습니다 — 이제 직접 입력한 값만 들어가고, 안 채웠으면 빈 칸으로 나와서 손으로 채우실 수 있습니다',
    '출고현황 엑셀 P열의 "금융사 작성예시" 목록이 빠져있던 걸 복구했습니다(장부 화면의 금융사 목록과 항상 같게 유지됩니다)',
  ],
  '0.34.2': [
    '출고현황 미리보기의 "비고" 칸이 너무 좁아 글자가 잘리던 것을 넓혔습니다',
    '맨 아래 "합계" 줄은 요청에 따라 손대지 않고 그대로 둡니다',
  ],
  '0.34.3': [
    '출고현황 엑셀 P열 "금융사 작성예시" 순서가 실제 파일과 어긋나 있던 것을 보내주신 파일 기준으로 정확히 맞췄습니다',
  ],
  '0.34.4': [
    '출고현황 엑셀 맨 아래 빈칸으로 나오던 부분("할부 : 0건 / 렌트 : 0건 / 리스: 0건 / 총합 0건")을 원본 파일 그대로 다시 채웠습니다',
  ],
  '0.34.5': [
    '위 부분에 배경색(노란색)이 빠져있던 것과 셀 병합이 안 되어 있던 것을 원본 파일 그대로 맞췄습니다',
  ],
  '0.34.6': [
    '방금 추가한 배경색/셀 병합 때문에 표가 이상해져서 원래대로(문구만 있는 상태로) 되돌렸습니다',
  ],
  '0.34.7': [
    '"비고 / 할부·렌트·리스·총합" 문구 위치를 51행이 아니라 이미 병합돼 있던 148~149행으로 옮기고, 그 칸에 노란 배경을 채웠습니다',
  ],
  '0.35.0': [
    '🆕 설정에 "계정 삭제" 기능을 추가했습니다 — 로그인 정보를 삭제할 수 있고, 출고/정산 기록은 세무·회계 보존 목적으로 회사 자료로 남습니다(향후 모바일/Play스토어 배포를 위한 준비 작업)',
  ],
  '0.35.1': [
    '금융사 비교시트 표 줄 간격을 좁혀서 스크롤 없이 더 많은 금융사가 한눈에 보입니다',
    '비교시트에서 선택한 계약기간 버튼이 흐리게 보이던 문제를 고쳐서, 선택된 상태가 확실히 눈에 띕니다',
  ],
  '0.36.0': [
    '🆕 사이드바에 "고객 리마인더"를 추가했습니다 — 몇 달 뒤 다시 연락하기로 한 고객을 이름/연락처/차종/연락 예정일로 등록해두면, 그 날짜 오전 9시에 알려드립니다',
  ],
};

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// 방금 업데이트돼서 켜진 건지 판단한다. 아예 처음 설치한 사람은 비교할 "이전 버전"이
// 없으니 안내 없이 지금 버전을 기준점으로만 저장해둔다.
function computeWhatsNew() {
  const current = app.getVersion();
  const seen = settingsStore.get('lastSeenAppVersion');
  if (!seen) {
    settingsStore.set('lastSeenAppVersion', current);
    return null;
  }
  if (compareVersions(current, seen) <= 0) return null;
  const versions = Object.keys(CHANGELOG)
    .filter((v) => compareVersions(v, seen) > 0 && compareVersions(v, current) <= 0)
    .sort(compareVersions);
  if (!versions.length) return null;
  const notes = versions.flatMap((v) => CHANGELOG[v].map((line) => ({ version: v, line })));
  return { version: current, notes };
}

ipcMain.handle('app:get-whats-new', () => computeWhatsNew());
ipcMain.handle('app:ack-whats-new', () => {
  settingsStore.set('lastSeenAppVersion', app.getVersion());
  return true;
});

// 제목표시줄의 버전 표시 겸 업데이트 버튼이 지금 상태를 알 수 있도록, 여기 저장해두고
// 바뀔 때마다 렌더러로도 쏴준다 — 렌더러가 나중에 켜져도 get-update-status 로 바로 받아간다.
let updateStatus = { state: 'idle' };

function broadcastUpdateStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:update-status', updateStatus);
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;

  autoUpdater.on('checking-for-update', () => {
    updateStatus = { state: 'checking' };
    broadcastUpdateStatus();
  });

  autoUpdater.on('update-not-available', () => {
    updateStatus = { state: 'idle' };
    broadcastUpdateStatus();
  });

  autoUpdater.on('update-available', (info) => {
    updateStatus = { state: 'available', version: info.version };
    broadcastUpdateStatus();
    // 재광님 확인: "다운로드 하시겠습니까?" 라고 한 번 더 묻는 것도 매번 눌러야 하는
    // 번거로운 단계라, 새 버전이 있으면 묻지 않고 바로 백그라운드로 받는다. 사용자가
    // 확인해야 할 순간은 다 받고 나서 "재시작할지" 한 번뿐이다(update-downloaded).
    autoUpdater.downloadUpdate().catch((err) => console.error('업데이트 다운로드 실패:', err));
  });

  autoUpdater.on('download-progress', (progress) => {
    updateStatus = { state: 'downloading', percent: Math.round(progress.percent) };
    broadcastUpdateStatus();
  });

  autoUpdater.on('update-downloaded', async () => {
    updateStatus = { state: 'downloaded' };
    broadcastUpdateStatus();
    // 여기가 사용자가 실제로 눌러야 하는 유일한 순간 — "재시작"만 누르면 nsis가
    // oneClick(조용히 설치)이라 별도 설치 화면 없이 앱이 껐다 켜지는 것만으로 끝난다.
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 완료',
      message: '업데이트가 완료되었습니다. 재시작 할까요?',
      buttons: ['재시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (err) => {
    console.error('업데이트 확인 실패:', err);
    updateStatus = { state: 'idle' };
    broadcastUpdateStatus();
  });

  autoUpdater.checkForUpdates().catch((err) => console.error('업데이트 확인 실패:', err));
}

ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:get-update-status', () => updateStatus);

// 제목표시줄 버전 배지를 눌렀을 때 쓰는 수동 트리거들 — 패키징 안 된 개발 모드에선
// electron-updater 가 애초에 동작하지 않으므로(설치 파일이 없다) 그 사실만 알려준다.
ipcMain.handle('app:check-for-updates', () => {
  if (!app.isPackaged) return { ok: false, reason: 'dev' };
  autoUpdater.checkForUpdates().catch((err) => console.error('업데이트 확인 실패:', err));
  return { ok: true };
});

ipcMain.handle('app:download-update', () => {
  if (!app.isPackaged) return { ok: false, reason: 'dev' };
  autoUpdater.downloadUpdate().catch((err) => console.error('업데이트 다운로드 실패:', err));
  return { ok: true };
});

ipcMain.handle('app:install-update', () => {
  if (!app.isPackaged) return { ok: false, reason: 'dev' };
  autoUpdater.quitAndInstall();
  return { ok: true };
});

// 창을 닫아도 트레이에 남아 계속 도는 앱이라, 아이콘을 다시 누르면 두 번째 인스턴스가
// 떠서 같은 장부를 양쪽에서 편집하게 된다(서로 덮어씀). 두 번째 실행은 조용히 끝내고
// 대신 원래 창을 앞으로 띄운다.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  createWindow();
  createTray();

  // 지난번에 할 일 위젯을 띄워둔 채로 껐다면, 이번에도 자동으로 같이 띄운다.
  if (settingsStore.get(TASKS_WIDGET_WAS_OPEN_KEY)) createTasksWidgetWindow();

  // 파일 색인을 미리 만들어 둔다 — 그래야 "김범석 서류 찾아줘" 첫 요청도 바로 나온다.
  // 중간중간 이벤트 루프에 양보하며 도는 방식이라 이 동안에도 앱은 평소처럼 반응한다.
  fileSearch.buildIndex().catch((err) => console.error('[file-search] 초기 색인 실패:', err));

  if (!isPlaceholder) {
    firebaseHandle = firebaseClient.initFirebase(config.firebase);
    setupAuthStateListener();

    // 0.29.0 에서 할 일(Tasks) 권한이 새로 추가됐다 — 그 전에 로그인해둔 사람은 저장된
    // 토큰에 이 권한이 없어서, 로그아웃 후 재로그인하라고 일일이 안내해야 했다. 이번
    // 업데이트에서 딱 한 번만 감지해서 자동으로 로그아웃시킨다(다음에 로그인 버튼을
    // 누르면 새 권한까지 포함해서 다시 받게 된다) — 상시로 도는 검사가 아니라 이번
    // 마이그레이션 한 번만 처리하고 플래그를 남겨서 다시는 건드리지 않는다.
    if (!settingsStore.get('tasksScopeMigrationDone')) {
      if (googleAuth.isSignedIn() && !googleAuth.hasTasksScope()) {
        console.log('[auth] 저장된 로그인에 할 일 권한이 없어 1회성으로 자동 로그아웃합니다.');
        googleAuth.signOut();
      }
      settingsStore.set('tasksScopeMigrationDone', true);
    }

    trySignInFirebaseFromStoredGoogleSession();
  }

  if (app.isPackaged) setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  stopMemosSubscription();
  stopAdminsSubscription();
  stopTeamEventsSubscription();
  stopTeamEventStartDateBackfill();
  stopChulgoSubscription();
});

// Window is hidden (not destroyed) on close, and the tray keeps the process
// alive — so window-all-closed should no longer quit the app on Windows/Linux.
app.on('window-all-closed', () => {});

ipcMain.handle('app:is-dev', () => !app.isPackaged);

// --- Window controls ---
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:close', () => mainWindow.close());
ipcMain.handle('window:toggle-pin', () => {
  isPinned = !isPinned;
  // 예전엔 "항상 위"도 같이 켰는데, 다른 창 뒤로 밀려도 상관없고 위치만 안 움직이면
  // 된다는 피드백에 따라 위치 잠금만 남긴다.
  mainWindow.setMovable(!isPinned);
  return isPinned;
});
ipcMain.handle('window:get-pin-state', () => isPinned);

// 캘린더 화면과 장부 화면이 서로 다른 크기가 편해서(장부는 표가 넓어야 하고,
// 캘린더는 작게 써도 됨), 렌더러가 화면을 오갈 때마다 각자 크기를 따로 저장/복원한다.
ipcMain.handle('window:get-size', () => {
  const [width, height] = mainWindow.getSize();
  return { width, height };
});
ipcMain.handle('window:set-size', (_e, { width, height } = {}) => {
  if (!width || !height) return false;
  mainWindow.setSize(Math.round(width), Math.round(height));
  return true;
});

ipcMain.handle('tasks-widget:open', () => {
  createTasksWidgetWindow();
});

// --- Settings ---
ipcMain.handle('settings:get-autostart', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('settings:set-autostart', (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
});
ipcMain.handle('config:status', () => ({
  configured: !isPlaceholder,
}));

// --- Theme (per-Windows-user, stored locally — never synced) ---
ipcMain.handle('theme:get', () => settingsStore.get('theme', {}));
ipcMain.handle('theme:set', (_e, theme) => {
  settingsStore.set('theme', theme);
  // 할 일 위젯이 떠 있으면 재시작 없이 바로 같은 테마로 갱신한다.
  if (tasksWidgetWindow && !tasksWidgetWindow.isDestroyed()) {
    tasksWidgetWindow.webContents.send('theme:update', theme);
  }
});

// --- 출고 장부: 직책 설정 (per-Windows-user, stored locally like theme) ---
ipcMain.handle('chulgo:get-position', () => settingsStore.get('chulgoPosition', '과장'));
ipcMain.handle('chulgo:set-position', (_e, position) => settingsStore.set('chulgoPosition', position));

// --- 출고 장부: 안내문자용 연락처 (per-Windows-user, stored locally like theme) ---
ipcMain.handle('chulgo:get-phone', () => settingsStore.get('chulgoPhone', ''));
ipcMain.handle('chulgo:set-phone', (_e, phone) => settingsStore.set('chulgoPhone', phone));

// --- Korean holidays ---
ipcMain.handle('calendar:get-holidays', (_e, year) => koreanHolidays.getHolidaysForYear(year));

// --- Google Calendar + Firebase identity (one Google login covers both) ---
ipcMain.handle('google:is-signed-in', () => googleAuth.isSignedIn());
ipcMain.handle('google:sign-in', async () => {
  const { idToken } = await googleAuth.signIn(config.google);
  // Subscriptions start from setupAuthStateListener once this actually lands, not from here.
  if (firebaseHandle) await firebaseClient.signInWithGoogleIdToken(firebaseHandle.auth, idToken);
  refreshMemosFromGoogleTasks(); // 방금 부여받은 권한으로 바로 한 번 당겨온다(다음 폴링까지 안 기다림)
  return currentUserPayload();
});
ipcMain.handle('google:sign-out', async () => {
  googleAuth.signOut();
  // Subscriptions stop from setupAuthStateListener once this actually lands, not from here.
  if (firebaseHandle) await firebaseClient.signOutFirebase(firebaseHandle.auth);
});
ipcMain.handle('google:get-events', async (_e, { timeMin, timeMax }) => {
  const events = await googleAuth.getUpcomingEvents(config.google, { timeMin, timeMax });
  const reverseMap = getTeamEventReverseMap();
  return events.map((ev) => ({ ...ev, teamEventId: reverseMap.get(ev.id) || null }));
});
ipcMain.handle('google:create-event', (_e, payload) => googleAuth.createEvent(config.google, payload));
ipcMain.handle('google:update-event', (_e, payload) => googleAuth.updateEvent(config.google, payload));
ipcMain.handle('google:delete-event', (_e, payload) => googleAuth.deleteEvent(config.google, payload));

// --- Current user / admin status ---
ipcMain.handle('auth:get-current-user', () => currentUserPayload());

// Manual escape hatch for the "looked signed in right after boot but Firestore never
// actually connected" case — retries the same sign-in path setupAuthStateListener reacts
// to, without making the user log out and back in.
ipcMain.handle('auth:refresh', async () => {
  await trySignInFirebaseFromStoredGoogleSession();
  return currentUserPayload();
});

function requireAdmin() {
  const { isAdmin } = currentUserPayload();
  if (!isAdmin) throw new Error('NOT_ADMIN');
}

// --- Dynamic admin management (root admins from config.json cannot be removed here) ---
ipcMain.handle('admin:get-list', () => ({
  rootAdmins: rootAdminEmails,
  dynamicAdmins: Array.from(dynamicAdminEmails),
}));
ipcMain.handle('admin:set-list', async (_e, emails) => {
  requireAdmin();
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  const cleaned = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  await firebaseClient.setAdmins(firebaseHandle.db, cleaned);
});

// --- 계정 삭제 (Google Play 정책 대응) — 로그인 계정만 지우고, 출고/정산 기록은
// 회사 보존 자료라 그대로 둔다(firebaseClient.deleteFirebaseAccount 주석 참고).
ipcMain.handle('auth:delete-account', async () => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  if (!firebaseHandle.auth.currentUser) throw new Error('NOT_SIGNED_IN');
  try {
    await firebaseClient.deleteFirebaseAccount(firebaseHandle.auth, firebaseHandle.db);
  } catch (err) {
    if (err && err.code === 'auth/requires-recent-login') {
      throw new Error('REQUIRES_RECENT_LOGIN');
    }
    console.error('[auth:delete-account] 실패:', err);
    throw new Error('계정 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }
  googleAuth.signOut();
  return { deleted: true };
});

// --- 개인 메모 (계정에만 저장, 다른 사람에게 공유되지 않음) ---
function dateKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

ipcMain.handle('memos:create', async (_e, { text, remindAt } = {}) => {
  if (!googleAuth.isSignedIn()) throw new Error('NOT_SIGNED_IN');
  let due = dateKeyOf(new Date());
  let alarmTime = null;
  if (remindAt) {
    const d = new Date(remindAt);
    due = dateKeyOf(d);
    alarmTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const created = await googleAuth.createTask(config.google, { text, due, alarmTime });
  refreshMemosFromGoogleTasks(); // 방금 만든 걸 화면에 바로 반영
  return created;
});

ipcMain.handle('memos:update', async (_e, { id, ...data }) => {
  if (!googleAuth.isSignedIn()) throw new Error('NOT_SIGNED_IN');
  await googleAuth.updateTask(config.google, { id, ...data });
  refreshMemosFromGoogleTasks();
});

ipcMain.handle('memos:delete', async (_e, id) => {
  if (!googleAuth.isSignedIn()) throw new Error('NOT_SIGNED_IN');
  await googleAuth.deleteTask(config.google, { id });
  refreshMemosFromGoogleTasks();
});

// --- Team-shared calendar events (admin manages; auto-synced into everyone's own calendar) ---
//
// The cross-team sync (syncTeamEventToCalendar via the Firestore listener) is
// necessarily async for OTHER clients. But the admin making the change would
// otherwise have to wait for their own listener round-trip too, which showed up
// as "delete doesn't seem to work" when the UI refreshed before that arrived.
// So here we also apply the change to the *caller's own* calendar immediately.
ipcMain.handle('team-events:create', async (_e, payload) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  requireAdmin();
  const user = firebaseHandle.auth.currentUser;
  const createdByName = user.displayName || user.email || '관리자';
  const id = await firebaseClient.createTeamEvent(firebaseHandle.db, { ...payload, createdByName });
  if (googleAuth.isSignedIn()) {
    try {
      await syncTeamEventToCalendar({ id, ...payload, createdByName }, { notify: false });
    } catch (err) {
      console.error('팀 일정 즉시 동기화 실패:', err);
    }
  }
});

ipcMain.handle('team-events:update', async (_e, { id, ...data }) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  requireAdmin();
  await firebaseClient.updateTeamEvent(firebaseHandle.db, id, data);
  if (googleAuth.isSignedIn()) {
    try {
      await syncTeamEventToCalendar({ id, ...data }, { notify: false });
    } catch (err) {
      console.error('팀 일정 즉시 동기화 실패:', err);
    }
  }
});

ipcMain.handle('team-events:delete', async (_e, id) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  requireAdmin();
  await firebaseClient.deleteTeamEvent(firebaseHandle.db, id);
  const mapping = teamEventMapStore.get(id);
  if (mapping) {
    if (googleAuth.isSignedIn()) {
      try {
        await googleAuth.deleteEvent(config.google, { eventId: mapping.googleEventId });
      } catch (err) {
        console.error('팀 일정 즉시 삭제 동기화 실패:', err);
      }
    }
    teamEventMapStore.delete(id);
    invalidateTeamEventReverseMap();
  }
  teamEventSyncFailures.delete(id);
});

// --- 출고 관리 장부 (personal — only ever visible/writable by its own author) ---
function requireSignedInUser() {
  const user = firebaseHandle && firebaseHandle.auth.currentUser;
  if (!user) throw new Error('NOT_SIGNED_IN');
  return user;
}

ipcMain.handle('chulgo:create', async (_e, data) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  const user = requireSignedInUser();
  return firebaseClient.createChulgoEntry(firebaseHandle.db, { ...data, authorUid: user.uid });
});

ipcMain.handle('chulgo:update', async (_e, { id, ...data }) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  requireSignedInUser();
  // authorUid is never accepted from the renderer here, so a user can only ever
  // edit fields on entries their own query already scoped them to.
  delete data.authorUid;
  await firebaseClient.updateChulgoEntry(firebaseHandle.db, id, data);
});

ipcMain.handle('chulgo:delete', async (_e, id) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  requireSignedInUser();
  await firebaseClient.deleteChulgoEntry(firebaseHandle.db, id);
});

// --- 고객 리마인더 (personal — 장부와 동일한 authorUid 스코프 패턴) ---

ipcMain.handle('reminders:create', async (_e, data) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  const user = requireSignedInUser();
  return firebaseClient.createReminder(firebaseHandle.db, { ...data, authorUid: user.uid });
});

ipcMain.handle('reminders:update', async (_e, { id, ...data }) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  requireSignedInUser();
  delete data.authorUid;
  await firebaseClient.updateReminder(firebaseHandle.db, id, data);
});

ipcMain.handle('reminders:delete', async (_e, id) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  requireSignedInUser();
  await firebaseClient.deleteReminder(firebaseHandle.db, id);
});

// 실제 회사 엑셀 템플릿을 그대로 로드해서 값만 채워넣는다 — 새로 스타일을 만들지
// 않고 원본 서식(글씨체/굵기/테두리/행 높이 등)을 그대로 유지하기 위함.
const CHULGO_EXPORT_TEMPLATE_PATH = path.join(__dirname, 'assets', 'chulgo-export-template.xlsx');

ipcMain.handle('chulgo:export-excel', async (_e, { yearMonth, staffName, position, rows }) => {
  // 템플릿 파일 누락/손상, 저장 경로 쓰기 실패 등은 여기서 막지 않으면 렌더러엔
  // "엑셀로 저장하는 데 실패했습니다"라는 뭉뚱그린 메시지만 도착하고, 실제 원인은
  // 아무 데도 안 남는다 — 콘솔에 원인을 자세히 남기고, 사용자에겐 쉬운 메시지만 준다.
  try {
    // 앱 시작 시 무겁게 미리 불러오면 초반 반응 속도가 떨어지므로, 실제로 내보내기를
    // 누른 시점에만 로드한다 (require는 이후 캐시되어 재호출 비용이 거의 없음).
    const ExcelJS = require('exceljs');
    const [year, month] = yearMonth.split('-').map(Number);
    const staffLabel = [staffName, position].filter(Boolean).join(' ');

    const workbook = new ExcelJS.Workbook();
    const templateExists = fs.existsSync(CHULGO_EXPORT_TEMPLATE_PATH);
    console.log('[chulgo-export] reading template:', CHULGO_EXPORT_TEMPLATE_PATH, templateExists);
    if (!templateExists) throw new Error(`템플릿 파일을 찾을 수 없습니다: ${CHULGO_EXPORT_TEMPLATE_PATH}`);
    await workbook.xlsx.readFile(CHULGO_EXPORT_TEMPLATE_PATH);
    console.log('[chulgo-export] template read OK, worksheets:', workbook.worksheets.map((w) => w.name));
    const sheet = workbook.worksheets[0];
    sheet.name = `${month}월 출고`;

    sheet.getCell('A1').value = `에이원오토  // ${year}년 ${month}월 출고 현황 // `;
    sheet.getCell('D3').value = staffLabel;

    const startRow = 5;
    rows.forEach((r, i) => {
      const rowIndex = startRow + i;
      const row = sheet.getRow(rowIndex);
      row.getCell(1).value = i + 1; // 댓수
      row.getCell(2).value = r.dbType || '';
      row.getCell(3).value = r.company || '';
      row.getCell(4).value = r.finType || '';
      row.getCell(5).value = r.name || '';
      row.getCell(6).value = r.car || '';
      row.getCell(7).value = r.deployDate || '';
      row.getCell(8).value = r.vehiclePrice || null;
      row.getCell(9).value = r.fee || 0;
      // 수수료율(%) — 여기서 계산하지 않는다(재광님 확인: "수수료율은 우리가 알아서 쓸테니
      // 계산하지 마"). 앱에서 직접 입력해둔 값이 있으면 그대로 옮기고(퍼센트로 입력받아
      // 소수로 저장 — J열이 0.00% 표시형식이라 5(%) 입력 -> 0.05로 나눠 넣어야 5.00%로
      // 보인다), 없으면 수식으로 자동 채우지 않고 그냥 비워서 사람이 직접 채우게 둔다.
      row.getCell(10).value = (r.feeRate != null && r.feeRate !== '') ? Number(r.feeRate) / 100 : '';
      row.getCell(11).value = staffName || '';
      row.getCell(12).value = r.feeMethod || 'AG';
      row.getCell(13).value = r.remark || '';
      // .commit() is only meaningful for the streaming WorkbookWriter — calling it on a
      // normal Row throws (it reaches into streaming-only internals that are never set up
      // here), which was the exact cause of every export failing.
    });

    // P열 "금융사 작성예시" — 예전 템플릿엔 있었는데 어느 시점엔가 템플릿 파일에서 빠진
    // 내용이다. 재광님이 보내주신 실제 파일(2026년 7월_출고현황...xlsx) P열을 그대로
    // 옮겨적었다 — 줄 순서/빈 줄까지 원본과 정확히 같아야 해서, 장부 화면의 금융사
    // 목록(순서가 다름)이 아니라 이 고정 목록을 그대로 쓴다.
    const CHULGO_EXPORT_P_COLUMN_EXAMPLES = [
      '하나캐피탈', null, null, 'KB캐피탈', 'IM캐피탈', 'BNK캐피탈', 'MG캐피탈', '신한카드',
      '롯데렌터카', '농협캐피탈', '메리츠캐피탈', '우리금융캐피탈', '오릭스캐피탈',
      '현대캐피탈 (영등포/특수)', 'JB우리캐피탈', '롯데캐피탈', '산은캐피탈', '롯데오토리스',
      '우리카드', '삼성카드', '하모니렌터카', 'SK렌터카', '아마존카', '레드캡', '케이카',
      '에이엠렌터카', '오토핸즈', 'BMW파이낸셜', '벤츠파이낸셜', '아우디파이낸셜', '일시불', '할부',
    ];
    sheet.getCell('P4').value = ' 금융사 작성예시';
    CHULGO_EXPORT_P_COLUMN_EXAMPLES.forEach((name, i) => {
      if (name != null) sheet.getCell(`P${5 + i}`).value = name;
    });

    // 맨 아래 요약 문구 — 템플릿에 이미 병합되어 있는 A148:A149 / B148:M149 자리에
    // 그대로 넣는다(51행 자리 아님, 재광님 확인). 병합은 템플릿에 이미 있는 상태라
    // mergeCells를 다시 부르지 않는다(중복 병합 시 파일이 깨졌던 원인) — 값과
    // 배경색만 채운다.
    sheet.getCell('A148').value = '비고';
    sheet.getCell('B148').value = '할부 : 0건 / 렌트 : 0건 / 리스: 0건 / 총합 0건';
    const chulgoTotalsFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    ['A148', 'A149', 'B148', 'C148', 'D148', 'E148', 'F148', 'G148', 'H148', 'I148', 'J148', 'K148', 'L148', 'M148',
      'B149', 'C149', 'D149', 'E149', 'F149', 'G149', 'H149', 'I149', 'J149', 'K149', 'L149', 'M149'].forEach((addr) => {
      sheet.getCell(addr).fill = chulgoTotalsFill;
    });

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '출고현황 엑셀로 저장',
      defaultPath: `${year}년 ${month}월_출고현황 3본부(${staffLabel}).xlsx`,
      filters: [{ name: 'Excel 파일', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { canceled: true };

    console.log('[chulgo-export] writing to:', filePath);
    await workbook.xlsx.writeFile(filePath);
    console.log('[chulgo-export] write OK');
    return { canceled: false, filePath };
  } catch (err) {
    console.error('[chulgo-export] 출고현황 엑셀 생성 실패:', err);
    throw new Error('출고현황 엑셀을 만드는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
  }
});

// ─── 정산서 엑셀 ──────────────────────────────────────────────────────────
// 회사에서 받은 실제 정산서를 그대로 템플릿으로 쓴다. 서식(글꼴/색/테두리/병합)과
// 수식 열(I,K,L,N,O,P,Q,R)은 절대 손대지 않고, 사람이 손으로 채워 넣던 칸에만 값을 넣는다.
const SETTLEMENT_TEMPLATES = {
  주임: { file: 'settlement-jooim.xlsx', memo: 16381, zeroP: 16382, retention: 16383, setPosition: false },
  대리: { file: 'settlement-daeri.xlsx', memo: 26, zeroP: 27, retention: 28, setPosition: false },
  기본: { file: 'settlement-gwajang.xlsx', memo: 16381, zeroP: 16382, retention: 16383, setPosition: true },
};

// 직책수당은 정산서에서 50%가 곱해지므로 실지급액의 2배를 H30 에 적는다.
const SETTLEMENT_STIPEND_GROSS = { 차장: 1000000, 팀장: 2000000 };

const SETTLEMENT_PROMO_TIERS = {
  주임: [[5, '주임_5대이상'], [8, '주임_8대이상'], [12, '주임_12대이상'], [15, '주임_15대이상']],
  대리: [[7, '대리_7대이상'], [9, '대리_9대이상'], [12, '대리_12대이상'], [15, '대리_15대이상'],
        [18, '대리_18대이상'], [21, '대리_21대이상']],
  기본: [[9, '과장_9대이상'], [12, '과장_12대이상'], [15, '과장_15대이상'], [18, '과장_18대이상'],
        [21, '과장_21대이상'], [24, '과장_24대이상']],
};

const SETTLEMENT_FIRST_ROW = 7;
const SETTLEMENT_LAST_DATA_ROW = 29;   // 30행은 직책수당 자리

function settlementTemplateFor(position) {
  return SETTLEMENT_TEMPLATES[position] || SETTLEMENT_TEMPLATES.기본;
}

function settlementPromoLabel(position, units) {
  const tiers = SETTLEMENT_PROMO_TIERS[position] || SETTLEMENT_PROMO_TIERS.기본;
  let label = '미달성';
  for (const [need, name] of tiers) if (units >= need) label = name;
  return label;
}

// 정산서에 채워 넣을 셀 목록을 만든다 (파일 쓰기와 분리해서 테스트할 수 있게).
function buildSettlementCells(payload) {
  const {
    rows, staffName, position, promoUnits, unsettledCount,
    retentionStart, retentionResetAt100,
  } = payload;
  const tpl = settlementTemplateFor(position);
  const memoCol = COL_LETTERS(tpl.memo);
  const zeroPCol = COL_LETTERS(tpl.zeroP);
  const retCol = COL_LETTERS(tpl.retention);

  const cells = {};
  const put = (addr, type, value) => { cells[addr] = { type, value }; };

  put('M2', 's', staffName || '');
  if (tpl.setPosition) put('R2', 's', position || '');

  let retentionNo = Number(retentionStart) || 0;
  let hitHundred = false;

  rows.forEach((r, i) => {
    const n = SETTLEMENT_FIRST_ROW + i;
    if (r.blank) return;                                  // 묶음 사이 빈 줄

    put(`B${n}`, 's', r.dbType || '');                    // DB경로
    put(`C${n}`, 's', r.company || '');                   // 진행금융사
    put(`D${n}`, 's', r.finType || '');                   // 상품
    put(`E${n}`, 's', r.name || '');                      // 대표자명/사업자명
    put(`F${n}`, 's', r.car || '');                       // 차종
    if (r.vehiclePrice) put(`G${n}`, 'n', r.vehiclePrice); // 차량가액

    if (r.extraUnitRow) return;   // 2대 인정분의 둘째 줄 — 금액칸은 비워 둔다

    if (r.feeFormula) put(`H${n}`, 'f', r.feeFormula.replace(/^=/, ''));
    if (r.expenseFormula) put(`J${n}`, 'f', r.expenseFormula.replace(/^=/, ''));
    if (r.paybackFormula) put(`M${n}`, 'f', r.paybackFormula.replace(/^=/, ''));

    put(`${zeroPCol}${n}`, 's', 'X');
    if (r.memoText) put(`${memoCol}${n}`, 's', r.memoText);

    if (r.retention) {
      retentionNo += 1;
      if (retentionNo === 100) hitHundred = true;
      put(`${retCol}${n}`, 's', `${retentionNo}회`);
      // 100회를 넘어가면 차감액이 한 단계 커진다 (101~200 = -60,000, 201~300 = -70,000)
      const tier = Math.floor(Math.max(0, retentionNo - 1) / 100);
      put(`S${n}`, 'n', -(50000 + tier * 10000));
      if (retentionNo >= 100 && retentionResetAt100) retentionNo = 0;
    }
  });

  // 직책수당 (30행) — 정산서에서 50%가 곱해지므로 실지급액의 2배를 적는다
  const stipend = SETTLEMENT_STIPEND_GROSS[position] || 0;
  if (stipend) {
    put('H30', 'n', stipend);
    put(`${memoCol}30`, 's', '직책수당');
  }

  // 대수 프로모션 (31행 드롭다운) — 인정 대수에 맞는 구간을 골라 넣는다
  put('F31', 's', settlementPromoLabel(position, Number(promoUnits) || 0));

  if (hitHundred) {                                        // 리텐션 100회 보너스
    put('H33', 'n', 10000000);
    put(`${memoCol}33`, 's', '리텐션 100회');
  }

  put('M35', 's', `미 정산 & 미 지급 : ${Number(unsettledCount) || 0}대`);

  return { cells, retentionEnd: retentionNo, hitHundred };
}

ipcMain.handle('chulgo:export-settlement', async (_e, payload) => {
  const { yearMonth, staffName, position, rows } = payload;
  const [, month] = yearMonth.split('-').map(Number);
  const tpl = settlementTemplateFor(position);
  const templatePath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'assets', tpl.file)
    : path.join(__dirname, 'assets', tpl.file);

  const maxRows = SETTLEMENT_LAST_DATA_ROW - SETTLEMENT_FIRST_ROW + 1;
  if (rows.length > maxRows) {
    return { canceled: true, error: `정산서에 들어갈 수 있는 줄은 ${maxRows}줄인데 ${rows.length}줄이 필요합니다.` };
  }

  // 위와 같은 이유(템플릿 누락/손상, 저장 실패 시 원인 확인 가능하게) — 사용자 입력
  // 검증(줄 수 초과)은 이미 위에서 정상적인 반환으로 처리되므로 이 안에 넣지 않는다.
  try {
    const title = `${staffName}${position}_${month}월출고분 정산서`;
    const templateExists = fs.existsSync(templatePath);
    console.log('[settlement] reading template:', templatePath, templateExists);
    if (!templateExists) throw new Error(`정산서 템플릿 파일을 찾을 수 없습니다: ${templatePath}`);
    const { cells, retentionEnd, hitHundred } = buildSettlementCells(payload);

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '정산서 엑셀로 저장',
      defaultPath: `${title}.xlsx`,
      filters: [{ name: 'Excel 파일', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { canceled: true };

    const buf = await writeSettlement(templatePath, cells, title.slice(0, 31));
    await fs.promises.writeFile(filePath, buf);
    console.log('[settlement] write OK ->', filePath);
    return { canceled: false, filePath, retentionEnd, hitHundred };
  } catch (err) {
    console.error('[settlement] 정산서 엑셀 생성 실패:', err);
    // 렌더러가 이 메시지를 "정산서를 만드는 데 실패했습니다.\n" 뒤에 그대로 이어 붙이므로,
    // 같은 말을 반복하지 않고 이유만 짧게 준다.
    throw new Error('템플릿 파일에 문제가 있거나 저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }
});

// 리텐션 누적 횟수는 매달 이어지므로 앱에 기억시켜 둔다.
ipcMain.handle('settlement:get-retention', () => settingsStore.get('retentionCount', 0));
ipcMain.handle('settlement:set-retention', (_e, n) => settingsStore.set('retentionCount', Number(n) || 0));

// --- AI로 장부 채우기 ---
// 자연어로 "삼아항업 용품작업 85만원, 페이백 25만원(4% 할증), 대리점수당 1825425원,
// 추가수수료 1%, 실수수료 2,452,156원" 식으로 적으면, OpenAI가 어느 건인지 찾고
// 항목들을 구조화된 JSON으로 뽑아준다. 실제 반영은 렌더러가 미리보기를 보여준 뒤
// 사용자가 "적용"을 눌러야만 한다(여기서는 절대 Firestore에 직접 쓰지 않는다).
const CHULGO_AI_SYSTEM_PROMPT = `너는 자동차 리스/렌트 판매 수수료 정산 장부를 관리하는, 숫자 실수를 절대
용납하지 않는 전문 회계사다. 이 데이터는 실제 급여 정산에 그대로 쓰이므로, 애매하면 채우지 않는 쪽을
택하고(추측 금지), 채울 땐 아래 정의를 한 글자도 헷갈리지 않고 정확히 지킨다.
사용자가 자연어로 적은 내용을 분석해서, 아래 스키마에 맞는 JSON 객체 하나로만 답한다. JSON 외의
설명이나 코드블록 표시는 절대 붙이지 않는다.

가장 먼저 판단해야 할 것 — 이게 "새 건 추가"인지 "기존 건 수정"인지:
- "추가해줘", "새로", "신규" 처럼 새 건을 만들라는 말이 있거나, candidates 목록에 있는 어떤 건과도
  겹치지 않는 새로운 고객/차종 정보라면 action은 "create" — 이때 matchedEntryId는 항상 null.
- candidates 목록에 있는 건을 고치라는 말(예: "수정해줘", 특정 고객명을 언급하며 값만 바꿔달라는 말)이면
  action은 "update" — 이때 matchedEntryId를 채운다.
- 새 건인지 기존 건 수정인지 판단이 안 서면 action은 "unclear"로 하고 notes에 이유를 적는다.
  이 경우 matchedEntryId는 null로 둔다 — 애매할 땐 절대 아무 후보에나 억지로 끼워맞추지 않는다.

장부의 각 건(row)은 다음 필드를 가진다:
- name: 고객명(대표자명/사업자명).
- car: 차종.
- company: 금융사 — financeAliases(줄임말 -> 정식 명칭 표)에 있으면 반드시 그 정식 명칭으로 바꾼다
  (예: financeAliases에 "메리츠": "메리츠캐피탈" 이 있으면 "메리츠"라고만 써도 "메리츠캐피탈"로 채운다).
  financeAliases에 없으면 companyList에 있는 이름 중 가장 가까운 정식 명칭으로 정규화한다.
- finType: 금융정보 — "리스"|"렌트"|"할부"|"일시불"|"기타" 중 하나. 명시적으로 언급 안 됐으면 null.
- vehiclePrice: 차량가(숫자, 원). "7850만원"→78500000, "8130만원"→81300000 처럼 환산한다.
  텍스트 전체에서 "차량가", "차값", "얼마짜리", 또는 차종 이름 바로 뒤/앞에 붙은 "OOOO만원"류 금액을
  놓치지 말고 반드시 찾아본다 — 이 필드가 자주 비어서 나중에 사람이 다시 채워 넣는 일이 없어야 한다.
  차량가로 보이는 금액이 텍스트에 있는데도 null로 두는 것은 이 업무에서 가장 흔하고 치명적인 실수다.
- contractPeriod: 계약기간 — 사용자가 말한 표현 그대로("48개월" 등) 문자열로.
- mileage: 주행거리 — 사용자가 말한 표현 그대로("2만km", "무제한" 등) 문자열로. 계산/정규화는 앱이 알아서 하니 그대로 옮기기만 한다.
- initialFunds: 초기자금 — 보증금/선납금 관련해서 말한 내용을 그대로 문자열로("무보증", "보증금 500만원", "보증 10% 선납 10%" 등).
- fee: "실 수수료" — 이 건의 최종 수수료 금액(숫자, 원).
- expenses: "용품비" 항목들 — [{name, amount}] 배열. 용품 작업/쿠팡/탁송료 등, 정산할 때 빼는 비용.
- agencyFeeItems: "대리점수당" 항목들 — [{name, amount}] 배열.
- promoItems: "프로모션" 항목들 — [{name, amount}] 배열. 프로모션이 여러 개면 "프로모션1"/"프로모션2"처럼 이름을 나눈다.
- paybacks: "페이백" 항목들 — [{name, amount}] 배열.
- extraFees: "추가수수료" 항목들 — [{name, type:"amount"|"percent", value}] 배열. "1% 할증"처럼 퍼센트로 말한 건 type을 percent로, value엔 숫자만(1) 넣는다 — 계산해서 금액으로 바꾸지 않는다.
- settleMemo: 자유 메모에 덧붙일 문구 — 항목 이름/금액만으론 설명 안 되는 부가 정보(예: "4% 할증").

★★★ promoItems 와 paybacks 는 돈이 흐르는 방향이 정반대다 — 여기서 실수하면 실제 급여 계산이
틀어지므로 절대, 절대 헷갈리면 안 된다:
- promoItems(프로모션) = 금융사가 나(영업사원)에게 추가로 주는 돈. 무조건 내 수익이다.
  "프로모션", "추가지원", "지원금", "인센티브"처럼 회사/금융사가 나한테 얹어주는 돈은 전부 여기.
- paybacks(페이백) = 내가 고객에게 돌려주는/깎아주는 돈. 무조건 고객에게 나가는 지출이다.
  "페이백", "고객한테 돌려줌", "환급", "캐시백"처럼 고객 쪽으로 나가는 돈은 전부 여기.
  절대 promoItems 안에 넣으면 안 된다.
- 어느 쪽인지 애매하면(돈의 방향을 텍스트만으론 확신 못 하면) 절대 아무 데나 넣지 말고, 두 필드
  모두 null로 둔 채 notes에 "프로모션/페이백 중 어느 쪽인지 불명확 — 원문: '...'" 라고 적어서
  사람이 직접 확인하게 한다.

규칙:
1. 사용자가 언급하지 않은 필드는 절대 채우지 말고 null로 둔다(추측 금지) — 단, vehiclePrice처럼
   텍스트에 실제로 등장한 금액은 놓치지 않는다. "추측 금지"는 "안 읽기"가 아니라 "없는 걸 지어내지
   않기"라는 뜻이다.
2. "기존거 빼고" 같은 말은 그 종류의 항목 배열을 통째로 새로 교체한다는 뜻이다(기존에 더하는 게 아님).
3. 퍼센트로 말했지만 계산할 근거(차량가 등)가 주어지지 않은 프로모션/금액은 억지로 계산하지 말고
   notes에 이유를 적고 해당 필드는 null로 둔다.
4. action이 "update"일 때만 candidates 목록(id, name, car, company)에서 가장 일치하는 것의 id를
   matchedEntryId에 넣는다. 여러 개가 비슷하거나 확신이 안 서면 matchedEntryId를 null로 하고
   notes에 이유를 적는다.
5. 답을 내기 전에 회계사처럼 스스로 한 번 검산한다: vehiclePrice를 놓치지 않았는지, promoItems와
   paybacks가 서로 바뀌어 들어가지 않았는지 반드시 재확인한 뒤에만 최종 JSON을 낸다.

응답 JSON 스키마 (모든 필드 필수, 값이 없으면 null):
{
  "action": "create" | "update" | "unclear",
  "matchedEntryId": string | null,
  "matchConfidence": "high" | "medium" | "low" | "none",
  "name": string | null,
  "car": string | null,
  "company": string | null,
  "finType": "리스" | "렌트" | "할부" | "일시불" | "기타" | null,
  "vehiclePrice": number | null,
  "contractPeriod": string | null,
  "mileage": string | null,
  "initialFunds": string | null,
  "fee": number | null,
  "expenses": [{"name": string, "amount": number}] | null,
  "paybacks": [{"name": string, "amount": number}] | null,
  "agencyFeeItems": [{"name": string, "amount": number}] | null,
  "promoItems": [{"name": string, "amount": number}] | null,
  "extraFees": [{"name": string, "type": "amount" | "percent", "value": number}] | null,
  "settleMemo": string | null,
  "notes": string
}`;

// 타임아웃이 없으면 네트워크가 멈췄을 때 요청이 무한히 매달려 있고, 그동안 화면의
// 입력칸은 "분석 중" 상태로 잠긴 채 영영 안 풀린다 — 반드시 끊어준다.
const OPENAI_TIMEOUT_MS = 45000;

function openAiTimeoutSignal() {
  return AbortSignal.timeout(OPENAI_TIMEOUT_MS);
}

async function callOpenAIJson(apiKey, systemPrompt, userContent) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    signal: openAiTimeoutSignal(),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI API 오류 (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('OpenAI 응답이 비어 있습니다.');
  return JSON.parse(content);
}

ipcMain.handle('chulgo:ai-fill', async (_e, payload) => {
  const apiKey = config.openai && config.openai.apiKey;
  if (!apiKey || /^(PASTE_|YOUR_)/.test(apiKey)) {
    throw new Error('OPENAI_NOT_CONFIGURED');
  }
  const { text, candidates, companyList, financeAliases } = payload || {};
  if (!text || !text.trim()) throw new Error('분석할 내용을 입력해주세요.');

  const userContent = JSON.stringify({
    candidates: (candidates || []).map((c) => ({ id: c.id, name: c.name, car: c.car, company: c.company })),
    companyList: companyList || [],
    // "메리츠"만 써도 "메리츠캐피탈"인 걸 알도록 — 장부에서 이미 쓰던 줄임말 표를 그대로 준다.
    financeAliases: financeAliases || {},
    text,
  });

  try {
    return await callOpenAIJson(apiKey, CHULGO_AI_SYSTEM_PROMPT, userContent);
  } catch (err) {
    console.error('[chulgo:ai-fill] 실패', err);
    throw new Error(err.message || 'AI 분석에 실패했습니다.');
  }
});

// --- AI 어시스턴트 (자유 대화 + 필요하면 실제로 메모/개인 일정 추가) ---
// 챗봇처럼 아무거나 물어봐도 되고, "캘린더에 추가해줘" 식으로 말하면 아래 도구(tool)를
// 실제로 호출해서 만든다. 팀 전체에 보이는 팀 일정은 도구로 안 준다 — AI가 잘못 이해해도
// 본인 메모/본인 개인(구글) 일정에만 영향이 가고, 다른 사람 화면에는 영향이 안 가게 하기 위함.
const CALENDAR_CHAT_SYSTEM_PROMPT_BASE = `너는 사용자의 개인 캘린더/메모 비서다. 편하게 대화 상대가
되어주고, 아무 질문이나 자유롭게 답해도 된다. 사용자가 "메모해줘", "캘린더에 추가해줘", "일정 잡아줘"
처럼 실제로 뭔가 저장하길 원하면, 말로만 답하지 말고 반드시 제공된 도구를 호출해서 실제로 만들어라.
"내일", "모레", "다음주 화요일" 같은 상대적 날짜는 오늘 날짜를 기준으로 계산해서 절대 날짜
(YYYY-MM-DD)로 바꿔서 도구에 넘긴다. 시간이 명시 안 된 일정은 하루종일(allDay=true)로 만든다.
여기서 만드는 일정/메모는 전부 사용자 본인만 보는 개인 항목이다.

파일 찾기: "김범석 서류 찾아줘", "폴스타 견적서 어디 있지", "그 파일 좀 켜줘" 처럼 PC 안의 파일을
찾거나 열어달라고 하면 search_files 도구를 쓴다. 찾은 목록은 사용자 화면에 클릭해서 바로 열 수 있는
형태로 표시되므로, 답변에서는 몇 건 찾았는지와 눌러서 열면 된다는 정도만 짧게 안내한다 —
경로를 길게 나열하지 마라. 보안상 실행파일(.exe 등)은 검색되지도, 열리지도 않는다.

웹 검색 기능은 없다. 인터넷 검색을 대신 해달라는 요청에는 브라우저를 직접 여는 대신, 네이버나
구글에 직접 검색해보라고 안내만 한다.`;

const CALENDAR_CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_memo',
      description: '사용자의 개인 메모장에 할 일/메모를 하나 추가한다.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '메모 내용' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_personal_event',
      description: '사용자의 개인 구글 캘린더에 일정을 하나 추가한다.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '일정 제목' },
          date: { type: 'string', description: 'YYYY-MM-DD 형식의 절대 날짜' },
          allDay: { type: 'boolean', description: '시간 없이 하루종일 일정이면 true' },
          startTime: { type: 'string', description: 'HH:MM 형식, allDay가 false일 때만' },
          endTime: { type: 'string', description: 'HH:MM 형식, 없으면 시작시간+1시간으로 자동 처리됨' },
        },
        required: ['title', 'date', 'allDay'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description:
        '사용자 PC 안에서 이름에 특정 단어가 들어간 파일/폴더를 찾는다(인터넷 검색이 아니다). '
        + '"김범석 서류 찾아줘", "폴스타 견적서 어디 있지", "김범석 폴더 찾아줘" 처럼 파일/폴더/서류를 '
        + '찾거나 열어달라고 하면 이걸 쓴다. '
        + '찾은 목록은 사용자 화면에 클릭 가능한 형태로 바로 표시되므로, 답변에서 경로를 길게 나열할 필요는 없다.',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description:
              '파일/폴더 이름에서 찾을 단어. 여러 낱말을 주면 모두 포함된 것만 찾는다(예: "김범석 약정"). '
              + '"파일", "서류", "찾아줘" 같은 검색과 무관한 말은 빼고 핵심 단어만 넣는다.',
          },
        },
        required: ['keyword'],
      },
    },
  },
  // open_web_search 도구는 껐다 — 키워드 제한을 걸어도 AI가 애매하면 자꾸 네이버부터
  // 검색해버려서("뭐 물어보면 그냥 네이버부터 서칭해버림") 마음에 안 든다는 피드백에 따라
  // 아예 도구 목록에서 뺐다. 채팅에 웹 검색 기능이 필요 없다는 뜻이라, 다시 켜달라는
  // 요청이 없는 한 이 배열엔 웹 검색 도구를 넣지 않는다.
];

async function callOpenAIChat(apiKey, systemPrompt, messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    signal: openAiTimeoutSignal(),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      tools: CALENDAR_CHAT_TOOLS,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI API 오류 (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  if (!msg) throw new Error('OpenAI 응답이 비어 있습니다.');
  const toolCalls = (msg.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));
  return { content: msg.content || '', toolCalls };
}

// --- 내 PC 파일 찾기 / 열기 ---
ipcMain.handle('files:search', async (_e, { keyword, limit } = {}) => {
  return fileSearch.searchFiles(keyword, limit || 30);
});

// 실행파일은 fileSearch 단계에서 이미 걸러지지만, 여기서 한 번 더 막는다 —
// 실제로 뭔가를 실행시키는 유일한 지점이라 이중으로 확인하는 게 맞다.
ipcMain.handle('files:open', async (_e, { target } = {}) => {
  if (!target || typeof target !== 'string') throw new Error('열 파일이 지정되지 않았습니다.');
  if (!fs.existsSync(target)) throw new Error('파일을 찾을 수 없습니다 (옮겨졌거나 지워진 것 같아요).');
  if (!fileSearch.isOpenable(target)) throw new Error('보안상 실행파일은 열지 않습니다.');
  const err = await shell.openPath(target);
  if (err) throw new Error(err);
  return { ok: true };
});

// 파일이 들어있는 폴더를 탐색기로 열고 그 파일을 선택해준다.
ipcMain.handle('files:reveal', async (_e, { target } = {}) => {
  if (!target || typeof target !== 'string') throw new Error('경로가 지정되지 않았습니다.');
  if (!fs.existsSync(target)) throw new Error('파일을 찾을 수 없습니다.');
  shell.showItemInFolder(target);
  return { ok: true };
});

// --- 웹 검색 열기 ---
// AI 가 대신 읽어주는 게 아니라, 검색 결과 페이지를 기본 브라우저로 띄워준다.
// (추가 비용이 없고, 직원들도 아무 설정 없이 바로 쓸 수 있다)
const WEB_SEARCH_ENGINES = {
  naver: (q) => `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`,
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
};

ipcMain.handle('web:search', async (_e, { query, engine } = {}) => {
  const q = String(query || '').trim();
  if (!q) throw new Error('검색어가 비어 있습니다.');
  const build = WEB_SEARCH_ENGINES[engine] || WEB_SEARCH_ENGINES.naver;
  const url = build(q);
  // 우리가 만든 검색 URL 만 연다 — 임의의 주소를 열어주는 통로가 되면 안 된다.
  await shell.openExternal(url);
  return { ok: true, url };
});

// --- 제목표시줄 바로가기 ---
// 자주 쓰는 사내 사이트를 클릭 한 번으로 열게. 목록을 여기(메인 프로세스)에 고정해두고
// id로만 요청받는다 — 렌더러가 임의 URL을 열게 하는 통로를 만들지 않기 위해서다.
const TITLEBAR_SHORTCUTS = [
  { id: 'admin', label: '어드민', url: 'https://admin.a1auto.io/' },
  { id: 'sheet3', label: '3본부시트', url: 'https://docs.google.com/spreadsheets/d/1Idpf57f6UpJAs4VjQdYafMQizJmBSq29l_ElkeFDh4g/edit?gid=784207234#gid=784207234' },
  { id: 'kapan', label: '카판', url: 'http://www.a1autocar.com/desk' },
  { id: 'cafe', label: '에이원카페', url: 'https://cafe.naver.com/a1autocarinformation' },
];

ipcMain.handle('shortcuts:get-list', () => {
  return TITLEBAR_SHORTCUTS.map(({ id, label }) => ({ id, label }));
});

ipcMain.handle('shortcuts:open', async (_e, { id } = {}) => {
  const item = TITLEBAR_SHORTCUTS.find((s) => s.id === id);
  if (!item) throw new Error('등록되지 않은 바로가기입니다.');
  await shell.openExternal(item.url);
  return { ok: true };
});

ipcMain.handle('ai:chat', async (_e, payload) => {
  const apiKey = config.openai && config.openai.apiKey;
  if (!apiKey || /^(PASTE_|YOUR_)/.test(apiKey)) {
    throw new Error('OPENAI_NOT_CONFIGURED');
  }
  const { messages, today } = payload || {};
  if (!Array.isArray(messages) || !messages.length) throw new Error('메시지가 없습니다.');

  // 렌더러는 {role, content, tool_calls?, tool_call_id?} 형태의 단순한 메시지를 보낸다 —
  // 여기서 OpenAI가 기대하는 정확한 tool-calling 메시지 형식으로 바꿔준다.
  const chatMessages = messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
    }
    return { role: m.role, content: m.content };
  });

  const systemPrompt = `${CALENDAR_CHAT_SYSTEM_PROMPT_BASE}\n\n오늘 날짜(today): ${today}`;

  try {
    return await callOpenAIChat(apiKey, systemPrompt, chatMessages);
  } catch (err) {
    console.error('[ai:chat] 실패', err);
    throw new Error(err.message || 'AI 응답에 실패했습니다.');
  }
});
