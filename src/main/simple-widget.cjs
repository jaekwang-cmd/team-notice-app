const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const Store = require('electron-store');

const defaults = Object.freeze({
  mode: 'top', color: 'auto', opacity: 100, filter: 'all',
  textColor: 'auto', fontWeight: 500, fontSize: 16
});
const modes = new Set(['top', 'through', 'desktop']);
const colors = new Set(['auto', '#ffffff', '#272a2f', '#fff1ad', '#f7d5df', '#d3e6ff', '#ceecd9', '#e3dafa', '#e3e7ec']);
const filters = new Set(['all', 'pending', 'done']);
const weights = new Set([400, 500, 600, 700, 800]);
const pages = path.join(__dirname, '..', 'renderer', 'simple');
const icon = path.join(__dirname, '..', '..', 'build', 'icon.png');
const desktopMonitor = app.isPackaged
  ? path.join(process.resourcesPath, 'desktop-foreground.exe')
  : path.join(__dirname, '..', '..', 'build', 'desktop-foreground.exe');
const hoverDwellMs = 2000;
const hoverFillMs = 800;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function preferences(previous, patch) {
  const merged = { ...previous };
  if (!patch || typeof patch !== 'object') return merged;
  if (modes.has(patch.mode)) merged.mode = patch.mode;
  if (colors.has(patch.color)) merged.color = patch.color;
  if (Number.isFinite(patch.opacity)) merged.opacity = clamp(Math.round(patch.opacity), 15, 100);
  if (filters.has(patch.filter)) merged.filter = patch.filter;
  if (patch.textColor === 'auto' || (typeof patch.textColor === 'string' && /^#[0-9a-f]{6}$/i.test(patch.textColor))) {
    merged.textColor = patch.textColor.toLowerCase();
  }
  if (weights.has(patch.fontWeight)) merged.fontWeight = patch.fontWeight;
  if (Number.isFinite(patch.fontSize)) merged.fontSize = clamp(Math.round(patch.fontSize), 12, 32);
  return merged;
}

function fitBounds(saved, anchor, size) {
  const valid = saved && ['x', 'y', 'width', 'height'].every(k => Number.isSafeInteger(saved[k])) &&
    saved.width > 0 && saved.height > 0;
  const work = screen.getDisplayMatching(valid ? saved : anchor).workArea;
  const width = clamp(valid ? saved.width : size.width, Math.min(work.width, size.minWidth), work.width);
  const height = clamp(valid ? saved.height : size.height, Math.min(work.height, size.minHeight), work.height);
  return {
    width, height,
    x: clamp(valid ? saved.x : anchor.x + Math.round((anchor.width - width) / 2), work.x, work.x + work.width - width),
    y: clamp(valid ? saved.y : anchor.y + Math.round((anchor.height - height) / 2), work.y, work.y + work.height - height)
  };
}

function contains(bounds, point) {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width &&
    point.y >= bounds.y && point.y < bounds.y + bounds.height;
}

function nativeId(win) {
  if (!win || win.isDestroyed()) return '';
  const handle = win.getNativeWindowHandle();
  return handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
}

function installSimpleWidget(getMainWindow, refreshTray, notifyRecovery, taskIdentity, getDb) {
  const store = new Store({ name: 'simple-widget' });
  let settings = preferences(defaults, store.get('preferences'));
  let widget = null;
  let settingsWin = null;
  let quitting = false;
  let selectedDate = null;
  let hoverTimer = null;
  let hoverSince = null;
  let hoverPhase = 'idle';
  let lastHoverCheck = 0;
  let watcher = null;
  let currentPassThrough = false;
  let ready = false;
  let persistPreferences = null;
  const widgetSize = { width: 670, height: 465, minWidth: 300, minHeight: 200 };
  const settingsSize = { width: 365, height: 565, minWidth: 300, minHeight: 320 };

  function send(win, channel, payload) {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
  }
  function flushPreferences() {
    if (!persistPreferences) return;
    clearTimeout(persistPreferences);
    persistPreferences = null;
    store.set('preferences', settings);
  }
  function stopWatcher() {
    if (!watcher) return;
    const processToStop = watcher;
    watcher = null;
    processToStop.kill();
  }
  function setHoverPhase(phase) {
    if (phase === hoverPhase) return;
    hoverPhase = phase;
    send(widget, 'simple-widget:hover', {phase, durationMs:hoverFillMs});
  }
  function stopHover() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    hoverSince = null;
    lastHoverCheck = 0;
    setHoverPhase('idle');
  }
  function passThrough(enabled) {
    if (!widget || widget.isDestroyed() || currentPassThrough === enabled) return;
    currentPassThrough = enabled;
    if (enabled && widget.isFocused()) widget.blur();
    widget.setIgnoreMouseEvents(enabled, { forward: true });
    widget.setFocusable(!enabled);
    widget.setSkipTaskbar(true);
  }
  function checkHover(leftWindow = false) {
    clearTimeout(hoverTimer);
    if (!widget || widget.isDestroyed() || !ready || settings.mode !== 'through') return;
    const pt = screen.getCursorScreenPoint();
    const overSettings = settingsWin?.isVisible() && contains(settingsWin.getBounds(), pt);
    const inside = widget.isVisible() && !overSettings && contains(widget.getBounds(), pt);
    const now = performance.now();
    const interrupted = lastHoverCheck && now - lastHoverCheck > 1000;
    lastHoverCheck = now;
    if (!inside || ((leftWindow || interrupted) && currentPassThrough)) {
      hoverSince = null;
      setHoverPhase('idle');
      passThrough(true);
    }
    if (inside && currentPassThrough) {
      if (hoverSince === null) hoverSince = now;
      const elapsed = now - hoverSince;
      if (hoverPhase === 'idle' && elapsed >= hoverDwellMs) {
        hoverSince = now;
        setHoverPhase('fill');
      } else if (hoverPhase === 'fill' && elapsed >= hoverFillMs) {
        setHoverPhase('ready');
        passThrough(false);
      }
    }
    // Windows may omit forwarded boundary events while another app receives the clicks.
    // Poll as a fallback. The renderer animates locally and receives only phase changes.
    hoverTimer = setTimeout(checkHover, inside ? 100 : 300);
  }
  function startHover() {
    passThrough(true);
    checkHover();
  }
  function monitorDesktop() {
    // Keep the widget present alongside its own settings while editing, or when the
    // widget itself has keyboard focus. A foreground application hides it entirely.
    if (widget.isVisible() && !widget.isFocused() && !settingsWin?.isFocused()) widget.hide();
    const monitor = spawn(desktopMonitor, [String(process.pid)], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    watcher = monitor;
    const lines = createInterface({ input: monitor.stdout });
    lines.on('line', state => {
      if (watcher !== monitor || !widget || state === 'transient') return;
      const visible = state === 'desktop' || state === nativeId(widget) || state === nativeId(settingsWin);
      if (visible && !widget.isVisible()) widget.showInactive();
      if (!visible && widget.isVisible()) widget.hide();
    });
    function recover() {
      if (watcher !== monitor) return;
      watcher = null;
      // A missing or terminated helper must never strand an invisible widget.
      updateSettings({ mode: 'top' });
      notifyRecovery();
    }
    monitor.on('error', recover);
    monitor.on('exit', recover);
  }
  function applyMode() {
    stopHover();
    stopWatcher();
    if (!widget || !ready) return;
    const desktop = settings.mode === 'desktop';
    widget.setAlwaysOnTop(!desktop, 'floating');
    passThrough(false);
    if (desktop) { monitorDesktop(); return; }
    if (!widget.isVisible()) widget.showInactive();
    if (settings.mode === 'through') startHover();
  }
  function trayItems() {
    if (!widget) return [];
    return [
      { label: '할 일 위젯 설정', click: openSettings },
      { label: '클릭 통과 끄기', enabled: settings.mode === 'through', click: () => {
        updateSettings({ mode: 'top' });
        widget?.focus();
      } },
      { label: '할 일 위젯 닫기', click: () => widget?.close() },
    ];
  }
  function updateSettings(patch) {
    const previous = settings;
    settings = preferences(settings, patch);
    if (Object.keys(defaults).every(k => previous[k] === settings[k])) return settings;
    clearTimeout(persistPreferences);
    persistPreferences = setTimeout(flushPreferences, 120);
    if (previous.mode !== settings.mode) { applyMode(); refreshTray(); }
    for (const win of [widget, settingsWin]) send(win, 'simple-widget:settings-changed', settings);
    return settings;
  }
  function createLocalWindow(type, size, anchor) {
    const boundsKey = type + 'Bounds';
    const bounds = fitBounds(store.get(boundsKey), anchor, size);
    const win = new BrowserWindow({
      ...bounds, minWidth: size.minWidth, minHeight: size.minHeight,
      title: type === 'widget' ? '여백 · 할 일 위젯' : '여백 · 위젯 설정',
      show: false, frame: false, transparent: type === 'widget', icon,
      backgroundColor: type === 'widget' ? '#00000000' : '#ffffff',
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, 'simple-widget-preload.cjs'), contextIsolation: true,
        sandbox: true, nodeIntegration: false, backgroundThrottling: false
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    let timer = null;
    function saveBounds() {
      clearTimeout(timer);
      if (!win.isDestroyed()) store.set(boundsKey, win.getBounds());
    }
    function queueBounds() { clearTimeout(timer); timer = setTimeout(saveBounds, 250); }
    win.on('moved', queueBounds);
    win.on('resized', queueBounds);
    win.on('close', saveBounds);
    win.once('closed', () => clearTimeout(timer));
    return win;
  }
  function openSettings() {
    if (!widget) return;
    if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
    const win = createLocalWindow('settings', settingsSize, widget.getBounds());
    settingsWin = win;
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    win.once('closed', () => { settingsWin = null; flushPreferences(); });
    win.loadFile(path.join(pages, 'widget-settings.html'));
  }
  function openWidget(date) {
    selectedDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    if (widget) {
      send(widget, 'simple-widget:date-changed', selectedDate);
      if (settings.mode === 'top') { widget.show(); widget.focus(); }
      return { mode: settings.mode };
    }
    const win = createLocalWindow('widget', widgetSize, getMainWindow().getBounds());
    widget = win;
    currentPassThrough = false;
    store.set('wasOpen', true);
    refreshTray();
    win.once('ready-to-show', () => {
      ready = true;
      applyMode();
      if (settings.mode === 'top') win.show();
    });
    win.once('closed', () => {
      stopWatcher(); stopHover();
      ready = false; widget = null;
      settingsWin?.close();
      if (!quitting) {
        store.set('wasOpen', false);
        refreshTray();
      }
      flushPreferences();
    });
    win.loadFile(path.join(pages, 'widget.html'));
    return { mode: settings.mode };
  }
  function fitToDisplays() {
    for (const [win, size] of [[widget, widgetSize], [settingsWin, settingsSize]]) {
      if (!win || win.isDestroyed()) continue;
      const current = win.getBounds();
      const fitted = fitBounds(current, current, size);
      if (Object.keys(fitted).some(k => current[k] !== fitted[k])) win.setBounds(fitted);
    }
  }
  screen.on('display-removed', fitToDisplays);
  screen.on('display-metrics-changed', fitToDisplays);
  app.once('before-quit', () => {
    quitting = true;
    stopHover(); stopWatcher(); flushPreferences();
    tasks.stop();
    screen.removeListener('display-removed', fitToDisplays);
    screen.removeListener('display-metrics-changed', fitToDisplays);
  });

  function matchesPage(win, file) {
    return win && !win.isDestroyed() && !win.webContents.isDestroyed() &&
      win.webContents.getURL().split(/[?#]/)[0] === pathToFileURL(file).href;
  }
  function trustedWindows() {
    const main = getMainWindow();
    return [
      matchesPage(main, path.join(pages, '..', 'index.html')) && main,
      matchesPage(widget, path.join(pages, 'widget.html')) && widget,
      matchesPage(settingsWin, path.join(pages, 'widget-settings.html')) && settingsWin,
    ].filter(Boolean);
  }
  function handle(channel, allowed, action) {
    ipcMain.handle('simple-widget:' + channel, (event, ...args) => {
      const source = BrowserWindow.fromWebContents(event.sender);
      if (!source || event.senderFrame !== event.sender.mainFrame ||
          !allowed().includes(source) || !trustedWindows().includes(source)) throw new Error('Invalid widget window');
      return action(source, ...args);
    });
  }
  const widgetWindows = () => [widget, settingsWin];
  ipcMain.on('simple-widget:pointer-boundary', (event, inside) => {
    if (widget && event.sender === widget.webContents && event.senderFrame === event.sender.mainFrame &&
        typeof inside === 'boolean' && settings.mode === 'through') checkHover(!inside);
  });
  handle('open', () => [getMainWindow()], (_, date) => openWidget(date));
  handle('open-settings', () => [widget], () => openSettings());
  handle('date', () => [widget], () => selectedDate);
  handle('settings', widgetWindows, () => settings);
  handle('update-settings', () => [settingsWin], (_, patch) => updateSettings(patch));
  handle('close', widgetWindows, source => { source.close(); });
  const tasks = require('./simple-tasks.cjs')(() => trustedWindows().filter(win => win !== settingsWin), taskIdentity, getDb);
  return { trayItems, tasks, restore: () => { if (store.get('wasOpen') === true) openWidget(); } };
}

module.exports = { installSimpleWidget };
