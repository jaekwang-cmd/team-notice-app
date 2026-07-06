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
let firebaseHandle = null;

let unsubscribeAnnouncements = null;
let knownAnnouncementIds = new Set();
let knownShoutedAt = new Map();
let isFirstAnnouncementSnapshot = true;

let unsubscribeAdmins = null;

let unsubscribeTeamEvents = null;
let teamEventsCache = [];
let isFirstTeamEventsSnapshot = true;
const teamEventSyncFailures = new Map(); // teamEventId -> lastFailedAtMillis
const TEAM_EVENT_RETRY_COOLDOWN_MS = 5 * 60 * 1000; // don't hammer the Calendar API for events that keep failing
const teamEventSyncInFlight = new Map(); // teamEventId -> in-progress Promise (prevents duplicate creates)

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 940,
    minWidth: 880,
    minHeight: 860,
    frame: false,
    backgroundColor: '#161a2b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTrayIcon() {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const offset = i * 4;
    buffer[offset] = 0xff; // B
    buffer[offset + 1] = 0x8c; // G
    buffer[offset + 2] = 0x7c; // R  (~#7c8cff accent color, in BGRA order)
    buffer[offset + 3] = 0xff; // A
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Team Notice');

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

// --- Announcements realtime ---

function startAnnouncementsSubscription() {
  if (unsubscribeAnnouncements) return; // already subscribed
  isFirstAnnouncementSnapshot = true;
  knownAnnouncementIds = new Set();
  knownShoutedAt = new Map();
  unsubscribeAnnouncements = firebaseClient.subscribeToAnnouncements(
    firebaseHandle.db,
    handleAnnouncementsUpdate,
    (err) => console.error('Firestore subscribe error:', err)
  );
}

function stopAnnouncementsSubscription() {
  if (unsubscribeAnnouncements) {
    unsubscribeAnnouncements();
    unsubscribeAnnouncements = null;
  }
  knownAnnouncementIds = new Set();
  knownShoutedAt = new Map();
  isFirstAnnouncementSnapshot = true;
  if (mainWindow) mainWindow.webContents.send('announcements:update', []);
}

function handleAnnouncementsUpdate(announcements) {
  if (!isFirstAnnouncementSnapshot) {
    const newOnes = announcements.filter((a) => !knownAnnouncementIds.has(a.id));
    newOnes.forEach((a) => {
      new Notification({
        title: `📢 새 공지: ${a.author || '팀'}`,
        body: a.text,
      }).show();
    });

    announcements.forEach((a) => {
      const prevShout = knownShoutedAt.get(a.id) || null;
      if (knownAnnouncementIds.has(a.id) && a.shoutedAt && a.shoutedAt !== prevShout) {
        new Notification({
          title: `📢🔊 긴급 재알림: ${a.author || '관리자'}`,
          body: a.text,
        }).show();
      }
    });
  }
  isFirstAnnouncementSnapshot = false;
  knownAnnouncementIds = new Set(announcements.map((a) => a.id));
  knownShoutedAt = new Map(announcements.map((a) => [a.id, a.shoutedAt]));

  if (mainWindow) {
    mainWindow.webContents.send('announcements:update', announcements);
  }
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

// --- Shared helpers ---

async function trySignInFirebaseFromStoredGoogleSession() {
  if (!firebaseHandle || !googleAuth.isSignedIn()) return;
  try {
    const idToken = await googleAuth.getFreshIdToken(config.google);
    await firebaseClient.signInWithGoogleIdToken(firebaseHandle.auth, idToken);
    startAnnouncementsSubscription();
    startAdminsSubscription();
    startTeamEventsSubscription();
    await reconcileTeamEventsForCurrentUser();
    if (mainWindow) mainWindow.webContents.send('auth:updated', currentUserPayload());
  } catch (err) {
    console.error('저장된 구글 세션으로 재로그인 실패:', err);
  }
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
  stopAnnouncementsSubscription();
  stopAdminsSubscription();
  stopTeamEventsSubscription();
});

// Window is hidden (not destroyed) on close, and the tray keeps the process
// alive — so window-all-closed should no longer quit the app on Windows/Linux.
app.on('window-all-closed', () => {});

// --- Window controls ---
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:close', () => mainWindow.close());

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

// --- Korean holidays ---
ipcMain.handle('calendar:get-holidays', (_e, year) => koreanHolidays.getHolidaysForYear(year));

// --- Google Calendar + Firebase identity (one Google login covers both) ---
ipcMain.handle('google:is-signed-in', () => googleAuth.isSignedIn());
ipcMain.handle('google:sign-in', async () => {
  const { idToken } = await googleAuth.signIn(config.google);
  if (firebaseHandle) {
    await firebaseClient.signInWithGoogleIdToken(firebaseHandle.auth, idToken);
    startAnnouncementsSubscription();
    startAdminsSubscription();
    startTeamEventsSubscription();
    await reconcileTeamEventsForCurrentUser();
  }
  return currentUserPayload();
});
ipcMain.handle('google:sign-out', async () => {
  googleAuth.signOut();
  stopAnnouncementsSubscription();
  stopAdminsSubscription();
  stopTeamEventsSubscription();
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

// --- Announcements ---
ipcMain.handle('announcements:post', async (_e, text) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  const user = firebaseHandle.auth.currentUser;
  if (!user) throw new Error('NOT_SIGNED_IN');
  const author = user.displayName || user.email || '익명';
  await firebaseClient.postAnnouncement(firebaseHandle.db, { text, author, authorUid: user.uid });
});

ipcMain.handle('announcements:edit', async (_e, { id, text }) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  await firebaseClient.updateAnnouncement(firebaseHandle.db, id, { text });
});

ipcMain.handle('announcements:delete', async (_e, id) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  await firebaseClient.deleteAnnouncement(firebaseHandle.db, id);
});

ipcMain.handle('announcements:set-confirmed', async (_e, { id, confirmed }) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  const user = firebaseHandle.auth.currentUser;
  if (!user) throw new Error('NOT_SIGNED_IN');
  const name = user.displayName || user.email || '익명';
  await firebaseClient.setConfirmedBy(firebaseHandle.db, id, user.uid, name, confirmed);
});

ipcMain.handle('announcements:shout', async (_e, id) => {
  if (!firebaseHandle) throw new Error('FIREBASE_NOT_CONFIGURED');
  requireAdmin();
  await firebaseClient.shoutAnnouncement(firebaseHandle.db, id);
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
