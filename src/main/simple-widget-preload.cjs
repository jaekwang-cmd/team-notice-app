const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('simpleWidget', {
  getSettings: () => ipcRenderer.invoke('simple-widget:settings'),
  setSettings: patch => ipcRenderer.invoke('simple-widget:update-settings', patch),
  onSettings: callback => subscribe('simple-widget:settings-changed', callback),
  openSettings: () => ipcRenderer.invoke('simple-widget:open-settings'),
  close: () => ipcRenderer.invoke('simple-widget:close'),
  onHoverState: callback => subscribe('simple-widget:hover', callback),
  pointerBoundary: inside => ipcRenderer.send('simple-widget:pointer-boundary', inside),
  getDate: () => ipcRenderer.invoke('simple-widget:date'),
  onDate: callback => subscribe('simple-widget:date-changed', callback),
  readSimpleTasks: () => ipcRenderer.invoke('simple-tasks:read'),
  mutateSimpleTask: op => ipcRenderer.invoke('simple-tasks:change', op),
  onSimpleTasks: callback => subscribe('simple-tasks:state', callback)
});
