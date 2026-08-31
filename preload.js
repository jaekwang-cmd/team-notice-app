const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  togglePin: () => ipcRenderer.invoke('window:toggle-pin'),
  getPinState: () => ipcRenderer.invoke('window:get-pin-state'),
  getWindowSize: () => ipcRenderer.invoke('window:get-size'),
  setWindowSize: (size) => ipcRenderer.invoke('window:set-size', size),
  openTasksWidget: () => ipcRenderer.invoke('tasks-widget:open'),

  getAutostart: () => ipcRenderer.invoke('settings:get-autostart'),
  setAutostart: (enabled) => ipcRenderer.invoke('settings:set-autostart', enabled),
  getConfigStatus: () => ipcRenderer.invoke('config:status'),
  getIsDev: () => ipcRenderer.invoke('app:is-dev'),

  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  onThemeUpdate: (callback) => {
    ipcRenderer.on('theme:update', (_event, theme) => callback(theme));
  },

  getHolidays: (year) => ipcRenderer.invoke('calendar:get-holidays', year),

  googleIsSignedIn: () => ipcRenderer.invoke('google:is-signed-in'),
  googleSignIn: () => ipcRenderer.invoke('google:sign-in'),
  googleSignOut: () => ipcRenderer.invoke('google:sign-out'),
  googleGetEvents: (timeMin, timeMax) => ipcRenderer.invoke('google:get-events', { timeMin, timeMax }),
  googleCreateEvent: (payload) => ipcRenderer.invoke('google:create-event', payload),
  googleUpdateEvent: (payload) => ipcRenderer.invoke('google:update-event', payload),
  googleDeleteEvent: (payload) => ipcRenderer.invoke('google:delete-event', payload),

  getCurrentUser: () => ipcRenderer.invoke('auth:get-current-user'),
  refreshAuth: () => ipcRenderer.invoke('auth:refresh'),
  deleteAccount: () => ipcRenderer.invoke('auth:delete-account'),

  getAdminList: () => ipcRenderer.invoke('admin:get-list'),
  setAdminList: (emails) => ipcRenderer.invoke('admin:set-list', emails),

  createMemo: (payload) => ipcRenderer.invoke('memos:create', payload),
  updateMemo: (payload) => ipcRenderer.invoke('memos:update', payload),
  deleteMemo: (id) => ipcRenderer.invoke('memos:delete', id),
  onMemosUpdate: (callback) => {
    ipcRenderer.on('memos:update', (_event, memos) => callback(memos));
  },
  onMemoAlarm: (callback) => {
    ipcRenderer.on('memos:alarm', (_event, memo) => callback(memo));
  },
  onAuthUpdated: (callback) => {
    ipcRenderer.on('auth:updated', (_event, user) => callback(user));
  },

  createTeamEvent: (payload) => ipcRenderer.invoke('team-events:create', payload),
  updateTeamEvent: (payload) => ipcRenderer.invoke('team-events:update', payload),
  deleteTeamEvent: (id) => ipcRenderer.invoke('team-events:delete', id),

  createChulgoEntry: (payload) => ipcRenderer.invoke('chulgo:create', payload),
  updateChulgoEntry: (payload) => ipcRenderer.invoke('chulgo:update', payload),
  deleteChulgoEntry: (id) => ipcRenderer.invoke('chulgo:delete', id),
  getChulgoPosition: () => ipcRenderer.invoke('chulgo:get-position'),
  setChulgoPosition: (position) => ipcRenderer.invoke('chulgo:set-position', position),
  getChulgoPhone: () => ipcRenderer.invoke('chulgo:get-phone'),
  setChulgoPhone: (phone) => ipcRenderer.invoke('chulgo:set-phone', phone),
  exportChulgoExcel: (payload) => ipcRenderer.invoke('chulgo:export-excel', payload),
  exportSettlement: (payload) => ipcRenderer.invoke('chulgo:export-settlement', payload),
  getRetentionCount: () => ipcRenderer.invoke('settlement:get-retention'),
  setRetentionCount: (n) => ipcRenderer.invoke('settlement:set-retention', n),
  onChulgoUpdate: (callback) => {
    ipcRenderer.on('chulgo:update', (_event, entries) => callback(entries));
  },
  createReminder: (payload) => ipcRenderer.invoke('reminders:create', payload),
  updateReminder: (payload) => ipcRenderer.invoke('reminders:update', payload),
  deleteReminder: (id) => ipcRenderer.invoke('reminders:delete', id),
  onReminderUpdate: (callback) => {
    ipcRenderer.on('reminders:update', (_event, items) => callback(items));
  },
  onReminderAlarm: (callback) => {
    ipcRenderer.on('reminders:alarm', (_event, reminder) => callback(reminder));
  },
  aiFillChulgo: (payload) => ipcRenderer.invoke('chulgo:ai-fill', payload),
  aiChat: (payload) => ipcRenderer.invoke('ai:chat', payload),

  searchFiles: (payload) => ipcRenderer.invoke('files:search', payload),
  openFile: (payload) => ipcRenderer.invoke('files:open', payload),
  revealFile: (payload) => ipcRenderer.invoke('files:reveal', payload),
  openWebSearch: (payload) => ipcRenderer.invoke('web:search', payload),

  getShortcutLinks: () => ipcRenderer.invoke('shortcuts:get-list'),
  openShortcutLink: (id) => ipcRenderer.invoke('shortcuts:open', { id }),

  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getUpdateStatus: () => ipcRenderer.invoke('app:get-update-status'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('app:update-status', (_event, status) => callback(status));
  },
  getWhatsNew: () => ipcRenderer.invoke('app:get-whats-new'),
  ackWhatsNew: () => ipcRenderer.invoke('app:ack-whats-new'),
});
