const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  togglePin: () => ipcRenderer.invoke('window:toggle-pin'),
  getPinState: () => ipcRenderer.invoke('window:get-pin-state'),

  getAutostart: () => ipcRenderer.invoke('settings:get-autostart'),
  setAutostart: (enabled) => ipcRenderer.invoke('settings:set-autostart', enabled),
  getConfigStatus: () => ipcRenderer.invoke('config:status'),

  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),

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

  getAdminList: () => ipcRenderer.invoke('admin:get-list'),
  setAdminList: (emails) => ipcRenderer.invoke('admin:set-list', emails),

  postAnnouncement: (text) => ipcRenderer.invoke('announcements:post', text),
  editAnnouncement: (id, text) => ipcRenderer.invoke('announcements:edit', { id, text }),
  deleteAnnouncement: (id) => ipcRenderer.invoke('announcements:delete', id),
  setAnnouncementConfirmed: (id, confirmed) =>
    ipcRenderer.invoke('announcements:set-confirmed', { id, confirmed }),
  shoutAnnouncement: (id) => ipcRenderer.invoke('announcements:shout', id),
  onAnnouncementsUpdate: (callback) => {
    ipcRenderer.on('announcements:update', (_event, announcements) => callback(announcements));
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
  onChulgoUpdate: (callback) => {
    ipcRenderer.on('chulgo:update', (_event, entries) => callback(entries));
  },
});
