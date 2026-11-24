// Slokam Player — Electron main process.
// A small, frameless, transparent, always-on-top window that plays a slokam recording
// from YouTube and shows the lyrics in sync. Most videos play in YouTube's embedded player
// inside the widget; for videos whose uploader has turned embedding off, the normal YouTube
// page is played in a separate (normally hidden) window and controlled from here.

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, globalShortcut, nativeImage, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const PREFERRED_PORT = 47823; // fixed so the page origin (and YouTube's view of it) stays stable
const FULL_DEFAULT = { width: 420, height: 300 };
const COMPACT = { width: 320, height: 52 };

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null;
let tray = null;
let settings = {};
let settingsFile = '';
let compact = false;
let fullscreen = false;
let beforeFullscreen = null; // window bounds to return to when leaving full screen
let quitting = false;

// ---------- settings ----------
function loadSettings() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { settings = {}; }
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch (e) { console.error(e); }
  }, 250);
}

// ---------- tiny static server (YouTube embeds need a real http origin, not file://) ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = path.normalize(path.join(SRC_DIR, rel));
    if (!file.startsWith(SRC_DIR)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.once('error', () => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    server.listen(PREFERRED_PORT, '127.0.0.1', () => resolve(server.address().port));
  });
}

// ---------- window ----------
function visibleBounds(b) {
  // keep the saved position on a screen that still exists
  const area = screen.getDisplayMatching(b).workArea;
  const inside = b.x < area.x + area.width - 40 && b.x + b.width > area.x + 40 && b.y >= area.y - 10 && b.y < area.y + area.height - 40;
  if (inside) return b;
  return { ...b, x: area.x + area.width - b.width - 24, y: area.y + area.height - b.height - 24 };
}

function createWindow(port) {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = settings.bounds || { ...FULL_DEFAULT, x: area.x + area.width - FULL_DEFAULT.width - 24, y: area.y + area.height - FULL_DEFAULT.height - 24 };
  const b = visibleBounds(saved);

  win = new BrowserWindow({
    ...b,
    minWidth: 260, minHeight: 140,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    maximizable: false, // double-clicking the drag bar would otherwise maximise it; full screen is our own mode
    alwaysOnTop: true,
    skipTaskbar: false,
    title: 'Slokam Player',
    icon: ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep audio + timing alive when the widget isn't focused
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver'); // stay above normal windows, including maximised ones
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // No page zoom: Ctrl − / Ctrl + / Ctrl 0 and Ctrl + mouse wheel would shrink the lyrics, and Chromium
  // remembers the zoom between launches. Text size is set in ⚙ instead. Zoom is also reset on every
  // load, which undoes any zoom left over from an earlier version.
  const wc = win.webContents;
  const resetZoom = () => { wc.setZoomLevel(0); wc.setZoomFactor(1); };
  wc.on('did-finish-load', resetZoom);
  wc.on('zoom-changed', resetZoom);
  wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
  wc.on('before-input-event', (e, input) => {
    if ((input.control || input.meta) && ['-', '_', '=', '+', '0', 'Add', 'Subtract'].includes(input.key)) e.preventDefault();
  });

  win.loadURL(`http://127.0.0.1:${port}/index.html`);
  win.once('ready-to-show', () => win.show());

  const remember = () => {
    if (!win || compact || fullscreen || win.isMinimized()) return;
    settings.bounds = win.getBounds();
    saveSettings();
  };
  win.on('moved', remember);
  win.on('resized', remember);
  win.on('close', (e) => {
    // the × button only hides to the tray; quitting happens from the tray menu
    if (!quitting) { e.preventDefault(); win.hide(); }
  });

  // open any external link (e.g. "open on YouTube") in the user's browser
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function setCompact(on) {
  if (!win || on === compact) return;
  if (on && fullscreen) setFullscreen(false); // leave full screen first, then shrink to the pill
  if (on) {
    settings.bounds = win.getBounds();
    saveSettings();
    const b = win.getBounds();
    compact = true;
    win.setMinimumSize(200, COMPACT.height);
    win.setResizable(false);
    // keep the pill anchored to the bottom-right of where the widget was
    win.setBounds({ x: b.x + b.width - COMPACT.width, y: b.y + b.height - COMPACT.height, ...COMPACT });
  } else {
    compact = false;
    const pill = win.getBounds();
    const full = settings.bounds || { ...FULL_DEFAULT };
    win.setResizable(true);
    win.setMinimumSize(260, 140);
    win.setBounds(visibleBounds({
      x: pill.x + pill.width - full.width, y: pill.y + pill.height - full.height, width: full.width, height: full.height,
    }));
  }
  win.webContents.send('compact-changed', compact);
  rebuildTrayMenu();
}

// Full screen: cover the whole display the widget is on (taskbar included). Done by resizing the
// window rather than with native full screen, so the frameless, transparent window behaves the same.
function setFullscreen(on) {
  if (!win || on === fullscreen) return;
  if (on) {
    if (compact) setCompact(false);
    beforeFullscreen = win.getBounds();
    fullscreen = true;
    const { bounds } = screen.getDisplayMatching(beforeFullscreen);
    win.setResizable(false);
    win.setMinimumSize(1, 1);
    win.setBounds(bounds);
    win.setAlwaysOnTop(false);   // full screen behaves like a normal window you can switch away from
    win.show(); win.focus();
  } else {
    fullscreen = false;
    if (settings.alwaysOnTop !== false) win.setAlwaysOnTop(true, 'screen-saver');
    win.setResizable(true);
    win.setMinimumSize(260, 140);
    win.setBounds(visibleBounds(beforeFullscreen || settings.bounds || { ...FULL_DEFAULT, x: 100, y: 100 }));
  }
  win.webContents.send('fullscreen-changed', fullscreen);
  rebuildTrayMenu();
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide(); else { win.show(); if (!fullscreen && settings.alwaysOnTop !== false) win.setAlwaysOnTop(true, 'screen-saver'); }
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: win && win.isVisible() ? 'Hide widget' : 'Show widget', click: toggleVisible },
    { label: fullscreen ? 'Exit full screen' : 'Full screen', click: () => { if (!win.isVisible()) win.show(); setFullscreen(!fullscreen); } },
    { label: compact ? 'Expand' : 'Minimize to pill', click: () => { if (!win.isVisible()) win.show(); setCompact(!compact); } },
    { label: 'Play / Pause', click: () => win && win.webContents.send('command', 'toggle-play') },
    { type: 'separator' },
    {
      label: 'Always on top', type: 'checkbox', checked: settings.alwaysOnTop !== false,
      click: (item) => {
        settings.alwaysOnTop = item.checked; saveSettings();
        win.setAlwaysOnTop(item.checked, 'screen-saver');
      },
    },
    {
      label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Slokam Player  (Ctrl+Alt+L)');
  tray.on('click', toggleVisible);
  rebuildTrayMenu();
}

// ---------- YouTube page player (for videos that can't be embedded) ----------
let yt = null; // { win, timer, videoId, shownForHelp }
const YT_PROBE = `(() => {
  const v = document.querySelector('#movie_player video, video');
  if (!v) return { found: false, consent: !!document.querySelector('form[action*="consent"], ytd-consent-bump-v2-lightbox, tp-yt-paper-dialog') };
  const ad = !!document.querySelector('#movie_player.ad-showing');
  return { found: true, t: v.currentTime, d: v.duration || 0, paused: v.paused, ended: v.ended, ad };
})()`;

function ytSend(msg) { if (win && !win.isDestroyed()) win.webContents.send('ytpage:state', msg); }

function ytClose() {
  if (!yt) return;
  clearInterval(yt.timer);
  if (!yt.win.isDestroyed()) yt.win.destroy();
  yt = null;
}

function ytOpen(videoId, show) {
  ytClose();
  const w = new BrowserWindow({
    width: 640, height: 400, show: !!show, title: 'Slokam Player — YouTube', icon: ICON, autoHideMenuBar: true,
    webPreferences: { partition: 'persist:youtube', backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  // look like a normal browser so YouTube serves its regular page
  w.webContents.setUserAgent(w.webContents.getUserAgent().replace(/\s(Electron|slokam-player)\/\S+/g, ''));
  w.on('close', (e) => { if (!quitting) { e.preventDefault(); w.hide(); settings.video = false; ytSend({ hidden: true }); } });
  w.loadURL(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
  yt = { win: w, videoId, startedAt: Date.now(), userPlayed: false, ready: false, shownForHelp: false };
  yt.timer = setInterval(async () => {
    if (!yt || yt.win.isDestroyed()) return;
    // YouTube may autoplay another video when ours ends: go back to ours, paused
    const url = yt.win.webContents.getURL();
    if (url.includes('/watch') && !url.includes(yt.videoId)) {
      yt.userPlayed = false; yt.ready = false;
      yt.win.loadURL(`https://www.youtube.com/watch?v=${encodeURIComponent(yt.videoId)}`);
      return;
    }
    let st;
    try { st = await yt.win.webContents.executeJavaScript(YT_PROBE, true); } catch { return; }
    if (!st.found) {
      // a consent / sign-in page is in the way: show the window so the user can click through it
      if (!yt.shownForHelp && (st.consent || Date.now() - yt.startedAt > 15000)) {
        yt.shownForHelp = true; yt.win.show(); ytSend({ needsUser: true });
      }
      return;
    }
    if (!yt.ready && !st.ad) {
      yt.ready = true;
      // YouTube autoplays the page; wait for the user to press play in the widget
      if (!yt.userPlayed) yt.win.webContents.executeJavaScript('document.querySelector("#movie_player video, video").pause()', true).catch(() => {});
    }
    ytSend(st);
  }, 200);
}

function ytCommand(cmd, arg) {
  if (!yt || yt.win.isDestroyed()) return;
  if (cmd === 'play') yt.userPlayed = true;
  const js = {
    play: 'v.play()',
    pause: 'v.pause()',
    seek: `v.currentTime = ${Number(arg) || 0}`,
  }[cmd];
  if (cmd === 'show') { arg ? yt.win.show() : yt.win.hide(); return; }
  if (js) yt.win.webContents.executeJavaScript(`(() => { const v = document.querySelector('#movie_player video, video'); if (v) { ${js}; } })()`, true).catch(() => {});
}

// ---------- IPC ----------
ipcMain.handle('settings:get', () => settings);
ipcMain.on('settings:set', (_e, patch) => { Object.assign(settings, patch); saveSettings(); });
ipcMain.on('win:compact', (_e, on) => setCompact(!!on));
ipcMain.on('win:fullscreen', (_e, on) => setFullscreen(!!on));
ipcMain.on('win:hide', () => { win && win.hide(); rebuildTrayMenu(); });
ipcMain.on('win:quit', () => { quitting = true; app.quit(); });
ipcMain.on('ytpage:open', (_e, videoId, show) => ytOpen(String(videoId), show));
ipcMain.on('ytpage:close', () => ytClose());
ipcMain.on('ytpage:cmd', (_e, cmd, arg) => ytCommand(cmd, arg));

// ---------- app lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); setCompact(false); } });
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.slokamplayer.app');
    loadSettings();
    Menu.setApplicationMenu(null);   // drop the default menu and its Ctrl −/+/0 zoom and Ctrl R reload shortcuts
    const port = await startServer();
    createWindow(port);
    if (settings.alwaysOnTop === false) win.setAlwaysOnTop(false);
    createTray();
    globalShortcut.register('CommandOrControl+Alt+L', toggleVisible);
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
