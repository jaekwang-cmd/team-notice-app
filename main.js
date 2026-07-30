const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, Notification, dialog, Tray, Menu, nativeImage } = require('electron');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const koreanHolidays = require('./src/main/koreanHolidays');
const googleAuth = require('./src/main/googleAuth');
const firebaseClient = require('./src/main/firebaseClient');

const settingsStore = new Store({ name: 'app-settings' });
const teamEventMapStore = new Store({ name: 'team-event-map' }); // teamEventId -> { googleEventId, signature }

const TEAM_EVENT_COLOR_ID = '11'; // Google Calendar "Tomato" red, to visually flag team-shared events

const CONFIG_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'config')
  : path.join(__dirname, 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const CONFIG_EXAMPLE_PATH = path.join(CONFIG_DIR, 'config.example.json');

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

let unsubscribeMemos = null;
const memoAlarmTimers = new Map(); // memoId -> Timeout

let unsubscribeAdmins = null;

let unsubscribeTeamEvents = null;
let teamEventsCache = [];
let isFirstTeamEventsSnapshot = true;
const teamEventSyncFailures = new Map(); // teamEventId -> lastFailedAtMillis
const TEAM_EVENT_RETRY_COOLDOWN_MS = 5 * 60 * 1000; // don't hammer the Calendar API for events that keep failing
const teamEventSyncInFlight = new Map(); // teamEventId -> in-progress Promise (prevents duplicate creates)

let unsubscribeChulgo = null;

const APP_ICON_PATH = path.join(__dirname, 'build', 'icon.png');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 960,
    minWidth: 1220,
    minHeight: 860,
    frame: false,
    maximizable: false,
    backgroundColor: '#161a2b',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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

// --- 개인 메모 + 시간 알람 realtime (다른 사람에게 공유되지 않음, 계정에만 저장) ---

function startMemosSubscription() {
  if (unsubscribeMemos) return; // already subscribed
  const user = firebaseHandle.auth.currentUser;
  if (!user) return;
  unsubscribeMemos = firebaseClient.subscribeToMemos(
    firebaseHandle.db,
    user.uid,
    handleMemosUpdate,
    (err) => console.error('메모 subscribe error:', err)
  );
}

function stopMemosSubscription() {
  if (unsubscribeMemos) {
    unsubscribeMemos();
    unsubscribeMemos = null;
  }
  memoAlarmTimers.forEach((timer) => clearTimeout(timer));
  memoAlarmTimers.clear();
  if (mainWindow) mainWindow.webContents.send('memos:update', []);
}

function fireMemoAlarm(memo) {
  new Notification({ title: '⏰ 메모 알림', body: memo.text }).show();
  if (mainWindow) mainWindow.webContents.send('memos:alarm', memo);
  firebaseClient
    .updateMemo(firebaseHandle.db, memo.id, { reminded: true })
    .catch((err) => console.error('메모 알람 처리 실패:', err));
}

// Firestore 스냅샷이 올 때마다 아직 안 울린 remindAt 있는 메모들에 타이머를 걸어준다.
// 앱이 꺼져있는 동안 지나버린 알람은, 켜지자마자 한 번 바로 울려서 놓치지 않게 한다.
function handleMemosUpdate(memos) {
  const currentIds = new Set(memos.map((m) => m.id));
  for (const [id, timer] of memoAlarmTimers) {
    if (!currentIds.has(id)) {
      clearTimeout(timer);
      memoAlarmTimers.delete(id);
    }
  }

  memos.forEach((memo) => {
    if (!memo.remindAt || memo.reminded || memoAlarmTimers.has(memo.id)) return;
    const delay = memo.remindAt - Date.now();
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

  if (mainWindow) mainWindow.webContents.send('memos:update', memos);
}

// --- Dynamic admin list realtime ---

function startAdminsSubscription() {
  if (unsubscribeAdmins) return;
  unsubscribeAdmins = firebaseClient.subscribeToAdmins(
    firebaseHandle.db,
    (emails) => {
      dynamicAdminEmails = new Set(emails.map((e) => e.toLowerCase()));
      if (mainWindow) mainWindow.webContents.send('auth:updated', currentUserPayload());
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
    if (!newIds.has(prevId)) {
      const mapping = teamEventMapStore.get(prevId);
      if (mapping) {
        try {
          await googleAuth.deleteEvent(config.google, { eventId: mapping.googleEventId });
        } catch (err) {
          console.error('팀 일정 삭제 동기화 실패:', err);
        }
        teamEventMapStore.delete(prevId);
      }
      teamEventSyncFailures.delete(prevId);
    }
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
      if (mainWindow) mainWindow.webContents.send('chulgo:update', entries);
    },
    (err) => console.error('출고 장부 subscribe error:', err)
  );
}

function stopChulgoSubscription() {
  if (unsubscribeChulgo) {
    unsubscribeChulgo();
    unsubscribeChulgo = null;
  }
  if (mainWindow) mainWindow.webContents.send('chulgo:update', []);
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
      startMemosSubscription();
      startAdminsSubscription();
      startTeamEventsSubscription();
      startChulgoSubscription();
      reconcileTeamEventsForCurrentUser().catch((err) => console.error('팀 일정 재동기화 실패:', err));
    } else {
      stopMemosSubscription();
      stopAdminsSubscription();
      stopTeamEventsSubscription();
      stopChulgoSubscription();
    }
    if (mainWindow) mainWindow.webContents.send('auth:updated', currentUserPayload());
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

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', async (info) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 확인',
      message: `새로운 버전(${info.version})이 있습니다. 업데이트 후 실행하시겠습니까?`,
      buttons: ['업데이트', '나중에'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.downloadUpdate();
  });

  autoUpdater.on('update-downloaded', async () => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 준비 완료',
      message: '업데이트 다운로드가 완료되었습니다. 지금 재시작하여 적용할까요?',
      buttons: ['재시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (err) => console.error('업데이트 확인 실패:', err));

  autoUpdater.checkForUpdates().catch((err) => console.error('업데이트 확인 실패:', err));
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  if (!isPlaceholder) {
    firebaseHandle = firebaseClient.initFirebase(config.firebase);
    setupAuthStateListener();
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
  stopChulgoSubscription();
});

// Window is hidden (not destroyed) on close, and the tray keeps the process
// alive — so window-all-closed should no longer quit the app on Windows/Linux.
app.on('window-all-closed', () => {});

// --- Window controls ---
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:close', () => mainWindow.close());
ipcMain.handle('window:toggle-pin', () => {
  isPinned = !isPinned;
  mainWindow.setAlwaysOnTop(isPinned);
  mainWindow.setMovable(!isPinned);
  return isPinned;
});
ipcMain.handle('window:get-pin-state', () => isPinned);

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
ipcMain.handle('theme:set', (_e, theme) => settingsStore.set('theme', theme));

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
  return currentUserPayload();
});
ipcMain.handle('google:sign-out', async () => {
  googleAuth.signOut();
  // Subscriptions stop from setupAuthStateListener once this actually lands, not from here.
  if (firebaseHandle) await firebaseClient.signOutFirebase(firebaseHandle.auth);
});
ipcMain.handle('google:get-events', async (_e, { timeMin, timeMax }) => {
  const events = await googleAuth.getUpcomingEvents(config.google, { timeMin, timeMax });
  const reverseMap = new Map();
  for (const teamEventId of Object.keys(teamEventMapStore.store)) {
    reverseMap.set(teamEventMapStore.get(teamEventId).googleEventId, teamEventId);
  }
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

// --- 개인 메모 (계정에만 저장, 다른 사람에게 공유되지 않음) ---
ipcMain.handle('memos:create', async (_e, data) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  const user = requireSignedInUser();
  return firebaseClient.createMemo(firebaseHandle.db, { ...data, authorUid: user.uid });
});

ipcMain.handle('memos:update', async (_e, { id, ...data }) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  requireSignedInUser();
  delete data.authorUid;
  await firebaseClient.updateMemo(firebaseHandle.db, id, data);
});

ipcMain.handle('memos:delete', async (_e, id) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  requireSignedInUser();
  await firebaseClient.deleteMemo(firebaseHandle.db, id);
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

// 실제 회사 엑셀 템플릿을 그대로 로드해서 값만 채워넣는다 — 새로 스타일을 만들지
// 않고 원본 서식(글씨체/굵기/테두리/행 높이 등)을 그대로 유지하기 위함.
const CHULGO_EXPORT_TEMPLATE_PATH = path.join(__dirname, 'assets', 'chulgo-export-template.xlsx');

ipcMain.handle('chulgo:export-excel', async (_e, { yearMonth, staffName, position, rows }) => {
  // 앱 시작 시 무겁게 미리 불러오면 초반 반응 속도가 떨어지므로, 실제로 내보내기를
  // 누른 시점에만 로드한다 (require는 이후 캐시되어 재호출 비용이 거의 없음).
  const ExcelJS = require('exceljs');
  const [year, month] = yearMonth.split('-').map(Number);
  const staffLabel = [staffName, position].filter(Boolean).join(' ');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(CHULGO_EXPORT_TEMPLATE_PATH);
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
    row.getCell(10).value = r.vehiclePrice
      ? { formula: `IFERROR(I${rowIndex}/H${rowIndex},"")` }
      : '';
    row.getCell(11).value = staffName || '';
    row.getCell(12).value = r.feeMethod || 'AG';
    row.getCell(13).value = r.remark || '';
    // .commit() is only meaningful for the streaming WorkbookWriter — calling it on a
    // normal Row throws (it reaches into streaming-only internals that are never set up
    // here), which was the exact cause of every export failing.
  });

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '출고현황 엑셀로 저장',
    defaultPath: `${year}년 ${month}월_출고현황 3본부(${staffLabel}).xlsx`,
    filters: [{ name: 'Excel 파일', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  await workbook.xlsx.writeFile(filePath);
  return { canceled: false, filePath };
});
