const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, Notification, dialog } = require('electron');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const koreanHolidays = require('./src/main/koreanHolidays');
const googleAuth = require('./src/main/googleAuth');
const firebaseClient = require('./src/main/firebaseClient');

const settingsStore = new Store({ name: 'app-settings' });

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
const adminEmails = (config.adminEmails || []).map((e) => e.toLowerCase());

let mainWindow;
let firebaseHandle = null;
let unsubscribeAnnouncements = null;
let knownAnnouncementIds = new Set();
let isFirstAnnouncementSnapshot = true;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 900,
    minWidth: 880,
    minHeight: 760,
    frame: false,
    backgroundColor: '#161a2b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
}

function startAnnouncementsSubscription() {
  if (unsubscribeAnnouncements) return; // already subscribed
  isFirstAnnouncementSnapshot = true;
  knownAnnouncementIds = new Set();
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
  isFirstAnnouncementSnapshot = true;
  if (mainWindow) mainWindow.webContents.send('announcements:update', []);
}

async function trySignInFirebaseFromStoredGoogleSession() {
  if (!firebaseHandle || !googleAuth.isSignedIn()) return;
  try {
    const idToken = await googleAuth.getFreshIdToken(config.google);
    await firebaseClient.signInWithGoogleIdToken(firebaseHandle.auth, idToken);
    startAnnouncementsSubscription();
    if (mainWindow) mainWindow.webContents.send('auth:updated', currentUserPayload());
  } catch (err) {
    console.error('저장된 구글 세션으로 재로그인 실패:', err);
  }
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
  }
  isFirstAnnouncementSnapshot = false;
  knownAnnouncementIds = new Set(announcements.map((a) => a.id));

  if (mainWindow) {
    mainWindow.webContents.send('announcements:update', announcements);
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
    isAdmin: adminEmails.includes(email),
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

  if (!isPlaceholder) {
    firebaseHandle = firebaseClient.initFirebase(config.firebase);
    trySignInFirebaseFromStoredGoogleSession();
  }

  if (app.isPackaged) setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopAnnouncementsSubscription();
  if (process.platform !== 'darwin') app.quit();
});

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
  }
  return currentUserPayload();
});
ipcMain.handle('google:sign-out', async () => {
  googleAuth.signOut();
  stopAnnouncementsSubscription();
  if (firebaseHandle) await firebaseClient.signOutFirebase(firebaseHandle.auth);
});
ipcMain.handle('google:get-events', (_e, { timeMin, timeMax }) =>
  googleAuth.getUpcomingEvents(config.google, { timeMin, timeMax })
);
ipcMain.handle('google:create-event', (_e, payload) => googleAuth.createEvent(config.google, payload));
ipcMain.handle('google:update-event', (_e, payload) => googleAuth.updateEvent(config.google, payload));
ipcMain.handle('google:delete-event', (_e, payload) => googleAuth.deleteEvent(config.google, payload));

// --- Current user / admin status ---
ipcMain.handle('auth:get-current-user', () => currentUserPayload());

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
  const { isAdmin } = currentUserPayload();
  if (!isAdmin) throw new Error('NOT_ADMIN');
  await firebaseClient.updateAnnouncement(firebaseHandle.db, id, { confirmed });
});
