const { app, BrowserWindow, Menu, shell, clipboard, screen, session, dialog, ipcMain, webContents } = require('electron');
const path = require('path');
const store = require('./src/main/store');
const settings = require('./src/main/settings');
const hotkeys = require('./src/main/hotkeys');
const downloads = require('./src/main/downloads');
const tray = require('./src/main/tray');
const notify = require('./src/main/notify');
const viewport = require('./src/main/viewport');
const workspaces = require('./src/main/workspaces');
const projects = require('./src/main/projects');
const folders = require('./src/main/folders');
const menu = require('./src/main/menu');
const { PARTITION, isSite, SECTIONS, byId } = require('./src/shared/actions');

// A separate profile folder for testing and development (also gets its own
// single-instance lock, so it can run next to the everyday app).
if (process.env.HIGGSFIELD_PROFILE) app.setPath('userData', process.env.HIGGSFIELD_PROFILE);

const IS_MAC = process.platform === 'darwin';
const BACKGROUND = '#0f1113';
const ICON = path.join(__dirname, 'build', 'icon.png');
const SHELL_PAGE = path.join(__dirname, 'src', 'renderer', 'shell', 'index.html');
const SETTINGS_PAGE = path.join(__dirname, 'src', 'renderer', 'settings', 'index.html');
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
const LAYOUT_FILE = path.join(app.getPath('userData'), 'layout.json');

// Sign-in and payment pages that must open inside the app so the flow
// can hand the session back to Higgsfield. Paths narrow hosts that also
// serve ordinary public pages (a Discord invite should go to the browser).
// Google sign-in is not among them: it cannot work inside the app (see handleGoogleSignIn).
const FLOW_HOSTS = [
  { host: /^appleid\.apple\.com$/ },
  { host: /^login\.(microsoftonline|live)\.com$/ },
  { host: /^(www\.)?facebook\.com$/, path: /^\/(v[\d.]+\/)?dialog\/oauth/ },
  { host: /^discord\.com$/, path: /^\/(api\/)?oauth2/ },
  { host: /^github\.com$/, path: /^\/(login|sessions)/ },
  { host: /\.clerk\.(com|dev)$|\.accounts\.dev$/ },
  { host: /^(checkout|pay|js|hooks|m)\.stripe\.com$/ },
  { host: /^(www\.)?paypal\.com$/ },
];

function parse(url) {
  try { return new URL(url); } catch { return null; }
}

function isFlow(url) {
  const u = parse(url);
  return !!u && u.protocol === 'https:' &&
    FLOW_HOSTS.some(f => f.host.test(u.hostname) && (!f.path || f.path.test(u.pathname)));
}

function openExternal(url) {
  const u = parse(url);
  if (u && ['http:', 'https:', 'mailto:'].includes(u.protocol)) shell.openExternal(url);
}

// Present as plain Chrome: Google refuses sign-in from UAs that name Electron.
function cleanUserAgent(ua) {
  return ua.replace(/\s(?!(?:AppleWebKit|Chrome|Safari)\/)[^\s/()]+\/\S+/g, '');
}

function loadWindowState() {
  const s = store.readJson(STATE_FILE);
  if (!s) return { width: 1440, height: 900 };
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
    s.x < a.x + a.width && s.x + s.width > a.x && s.y < a.y + a.height && s.y + s.height > a.y);
  if (!onScreen) { delete s.x; delete s.y; }
  return s;
}

let mainWindow = null;
let settingsWindow = null;
let openTabs = []; // from the tab UI, in layout order: { webContentsId, title, active, visible }
let currentLayout = null; // the tab UI's live layout, autosaved to layout.json
let savedLayoutJson = ''; // what layout.json holds, so unchanged layouts are not rewritten
let generating = 0;
const savedFiles = new Set(); // downloads the tab UI may reveal in Explorer
const tabProjects = new Map(); // tab webContentsId -> { key, at }: the Cinema Studio project it is in
const shownTabNames = new Map(); // tab webContentsId -> the project name its title shows

function sendCommand(command, { reveal = true } = {}) {
  if (!mainWindow) return;
  if (reveal && !mainWindow.isVisible()) tray.showWindow();
  mainWindow.webContents.send('shell:command', command);
}

// filePath: a saved file the toast offers to show in Explorer.
function toast(text, filePath) {
  sendCommand({ type: 'toast', text, filePath }, { reveal: false });
}

function sendToSettings(channel, value) {
  if (settingsWindow) settingsWindow.webContents.send(channel, value);
}

// Asks for a line of text in a dialog drawn by the tab UI.
let promptSeq = 0;
const pendingPrompts = new Map();
function prompt(options) {
  if (!mainWindow) return Promise.resolve(null);
  const requestId = ++promptSeq;
  return new Promise(resolve => {
    pendingPrompts.set(requestId, resolve);
    sendCommand({ type: 'prompt', requestId, ...options });
  });
}

async function saveWorkspace() {
  const name = await prompt({
    title: 'Save workspace',
    message: 'Saves your current tabs and layout under a name, so you can load them again later.',
    value: '',
    okLabel: 'Save',
  });
  if (!name) return;
  let result = workspaces.create(name, currentLayout);
  if (!result.ok && result.code === 'exists') {
    const { response } = await showMessage({
      type: 'question',
      title: 'Higgsfield',
      message: `Replace the workspace "${name}"?`,
      detail: 'It will be overwritten with your current tabs and layout.',
      buttons: ['Replace', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;
    result = workspaces.replace(result.id, currentLayout);
  }
  if (result.ok) toast(`Workspace "${result.workspace.name}" saved`);
  else showMessage({ type: 'error', title: 'Higgsfield', message: 'Could not save the workspace', detail: result.error });
}

function loadWorkspace(id) {
  const ws = workspaces.get(id);
  if (!ws) return { ok: false, error: 'That workspace no longer exists.' };
  sendCommand({ type: 'loadLayout', layout: ws.layout });
  toast(`Workspace "${ws.name}" loaded`);
  return { ok: true };
}

// What the tab UI's Workspace menu lists.
function workspaceSummaries() {
  return workspaces.list().map(({ id, name }) => ({ id, name }));
}

// The Cinema Studio project the active tab is in, or null.
function activeProject() {
  const tab = openTabs.find(t => t.active);
  const entry = tab && tabProjects.get(tab.webContentsId);
  return entry ? projects.get(entry.key) : null;
}

let shownProjectKey;
function showActiveProject() {
  const project = activeProject();
  const key = project ? project.key + '|' + project.name + '|' + projects.folderFor(project) : null;
  if (key === shownProjectKey) return;
  shownProjectKey = key;
  sendCommand(project
    ? { type: 'csProject', key: project.key, name: project.name, folder: projects.folderFor(project) }
    : { type: 'csProject', name: null }, { reveal: false });
}

// What the toolbar's Projects menu and pinned project buttons show, most recently used first.
function menuProjects() {
  return projects.list().map(({ key, name, url, owner, shared, color, pinned }) => ({ key, name, url, owner, shared, color, pinned }));
}

// Called whenever a tab changes page.
function trackTab(contents, url) {
  const project = projects.seen(url, tabProjects.get(contents.id));
  if (project) tabProjects.set(contents.id, { key: project.key, at: Date.now() });
  else tabProjects.delete(contents.id);
  showTabProject(contents.id);
  showActiveProject();
}

// A tab inside a project is titled with the project's name.
function showTabProject(id) {
  const entry = tabProjects.get(id);
  const project = entry && projects.get(entry.key);
  const name = project ? project.name : null;
  if (shownTabNames.get(id) === name) return;
  shownTabNames.set(id, name);
  sendCommand({ type: 'tabProject', webContentsId: id, name }, { reveal: false });
}

// Downloads started in a tab that is inside a Cinema Studio project go to its folder.
function downloadFolderFor(contents) {
  const entry = contents && tabProjects.get(contents.id);
  const project = entry && projects.get(entry.key);
  return project ? projects.folderFor(project) : settings.get().downloads.folder;
}

async function renameActiveProject() {
  const project = activeProject();
  if (!project) return;
  const name = await prompt({
    title: 'Rename project folder',
    message: 'The name used for this project in the app and for its download folder. Higgsfield is not changed.',
    value: project.name,
    okLabel: 'Rename',
  });
  if (name) projects.rename(project.key, name);
}

function projectOp(op, args) {
  const a = args && typeof args === 'object' ? args : {};
  const project = projects.get(a.key);
  if (!project) return { ok: false, error: 'That project is no longer in the list.' };
  switch (op) {
    case 'rename': return projects.rename(a.key, a.name);
    case 'resetFolder': return projects.setFolder(a.key, null);
    case 'openFolder': downloads.openFolder(projects.folderFor(project)); return { ok: true };
    case 'open': sendCommand({ type: 'newTab', url: project.url }); return { ok: true };
    case 'pin': return projects.setPinned(a.key, true);
    case 'unpin': return projects.setPinned(a.key, false);
    case 'moveLeft': return projects.movePinned(a.key, -1);
    case 'moveRight': return projects.movePinned(a.key, 1);
    case 'forget': return projects.forget(a.key);
    default: return { ok: false, error: 'Unknown project operation.' };
  }
}

async function chooseProjectFolder(key) {
  if (!projects.get(key)) return { ok: false, error: 'That project is no longer in the list.' };
  const folder = await downloads.chooseFolder(settingsWindow || mainWindow);
  return folder ? projects.setFolder(key, folder) : { ok: true };
}

// The site sections shown as toolbar buttons, in the site's own order.
function quickSections(ids = settings.get().toolbar.sections) {
  return Array.isArray(ids) ? SECTIONS.map(s => s.id).filter(id => ids.includes(id)) : [];
}

function setLocked(locked) {
  settings.update({ layout: { locked: !!locked } });
}

function dispatch(id) {
  const action = byId[id];
  if (!action) return;
  if (action.handler === 'shell') return sendCommand({ type: id });
  if (id.startsWith('open:')) return sendCommand({ type: 'newTab', url: action.url });
  switch (id) {
    case 'saveWorkspace': saveWorkspace(); break;
    case 'toggleLock': setLocked(!settings.get().layout.locked); break;
    case 'toggleFullscreen':
      if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
      break;
    case 'openDownloads': {
      const project = activeProject();
      downloads.openFolder(project ? projects.folderFor(project) : undefined);
      break;
    }
    case 'openSettings': openSettings('general'); break;
    case 'openHotkeys': openSettings('hotkeys'); break;
    case 'clearCache': clearCache(); break;
    case 'toggleWindow': tray.toggleWindow(); break;
  }
}

let menuTimer = null;
function refreshMenu() {
  clearTimeout(menuTimer);
  menuTimer = setTimeout(() => {
    const { hotkeys: binds, layout } = settings.get();
    Menu.setApplicationMenu(menu.build({
      dispatch,
      accelerator: id => binds[id] || undefined,
      sendCommand,
      openSettings,
      clearAllData,
      workspaces: workspaces.list(),
      loadWorkspace,
      locked: layout.locked,
    }));
  }, 150);
}

function showMessage(options) {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

function formatBytes(n) {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(1)} MB`;
}

// Drops cached files and scripts but keeps cookies and local storage,
// so the login survives.
async function clearCache() {
  const ses = session.fromPartition(PARTITION);
  const size = await ses.getCacheSize();
  await Promise.all([
    ses.clearCache(),
    ses.clearCodeCaches({}),
    ses.clearStorageData({ storages: ['cachestorage', 'serviceworkers', 'shadercache'] }),
  ]);
  sendCommand({ type: 'reloadAll' }, { reveal: false });
  showMessage({
    type: 'info',
    title: 'Higgsfield',
    message: 'Cache cleared',
    detail: `${formatBytes(size)} of cached files removed. You are still signed in.`,
  });
}

// Google does not allow signing in inside an app's embedded browser, so
// "Continue with Google" runs in a separate Chrome or Edge window instead.
// Where a tab would go to sign in with a Google account.
function isGoogleSignIn(url) {
  try { return /^accounts\.google\.[a-z.]+$/.test(new URL(url).hostname); } catch { return false; }
}

// Google refuses to sign in to a Google account inside an embedded browser like
// this app's tabs, and a login moved from a real browser is rejected by
// Higgsfield's sign-in service. So Continue with Google explains that and offers
// email sign-in, which works because it is created in the app's own session.
let googleDialogOpen = false;
async function handleGoogleSignIn(contents) {
  if (googleDialogOpen) return;
  googleDialogOpen = true;
  try {
    const { response } = await showMessage({
      type: 'info',
      title: 'Higgsfield',
      message: 'Google sign-in is not available in the app',
      detail: 'Google does not allow signing in to a Google account inside an app like this one, and making it '
        + 'work here needs official support from Higgsfield.\n\n'
        + 'You can sign in to the same account with email instead: Higgsfield emails you a code, and the app '
        + 'stays signed in afterwards.',
      buttons: ['Sign in with email', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0 && contents && !contents.isDestroyed()) openEmailSignIn(contents);
  } finally {
    googleDialogOpen = false;
  }
}

// Opens Higgsfield's own email sign-in in the tab, the same step its page shows
// behind "Continue with Email".
function openEmailSignIn(contents) {
  contents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const find = labels => [...document.querySelectorAll('button, a, [role="button"]')].find(el => {
      const t = (el.textContent || '').trim().toLowerCase();
      return labels.some(l => t === l || t.startsWith(l));
    });
    const EMAIL = ['continue with email', 'sign in with email'];
    const OPEN = ['log in', 'login', 'sign in', 'get started'];
    for (let i = 0; i < 20; i++) {
      let email = find(EMAIL);
      if (email) { email.click(); return; }
      const open = find(OPEN);
      if (open) open.click();
      await sleep(400);
    }
  })().catch(() => {})`).catch(() => {});
}

async function clearAllData() {
  const { response } = await showMessage({
    type: 'warning',
    title: 'Higgsfield',
    message: 'Clear all Higgsfield data?',
    detail: 'This signs you out and removes cookies, site settings and cached files. '
      + 'Your generations are stored on your Higgsfield account and are not affected.',
    buttons: ['Clear and Sign Out', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return;
  const ses = session.fromPartition(PARTITION);
  await Promise.all([ses.clearStorageData(), ses.clearCache(), ses.clearAuthCache()]);
  sendCommand({ type: 'reloadAll' });
}

function buildContextMenu(contents, p) {
  const sep = { type: 'separator' };
  const history = contents.navigationHistory;
  const groups = [];

  if (p.misspelledWord && p.dictionarySuggestions.length) {
    groups.push(p.dictionarySuggestions.slice(0, 5).map(word => ({
      label: word, click: () => contents.replaceMisspelling(word),
    })));
  }
  if (p.linkURL) {
    groups.push([
      ...(isSite(p.linkURL) ? [{ label: 'Open Link in New Tab', click: () => sendCommand({ type: 'newTab', url: p.linkURL }) }] : []),
      { label: 'Open Link in Browser', click: () => openExternal(p.linkURL) },
      { label: 'Copy Link Address', click: () => clipboard.writeText(p.linkURL) },
    ]);
  }
  if (p.mediaType === 'image' && p.srcURL) {
    groups.push([
      { label: 'Save Image', click: () => downloads.save(contents, p.srcURL) },
      { label: 'Save Image As…', click: () => downloads.saveAs(contents, p.srcURL) },
      { label: 'Copy Image', click: () => contents.copyImageAt(p.x, p.y) },
      { label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) },
    ]);
  }
  if (p.mediaType === 'video' && p.srcURL) {
    groups.push([
      { label: 'Save Video', click: () => downloads.save(contents, p.srcURL) },
      { label: 'Save Video As…', click: () => downloads.saveAs(contents, p.srcURL) },
      { label: 'Copy Video Address', click: () => clipboard.writeText(p.srcURL) },
    ]);
  }
  if (p.isEditable) {
    groups.push([
      { role: 'cut', enabled: p.editFlags.canCut },
      { role: 'copy', enabled: p.editFlags.canCopy },
      { role: 'paste', enabled: p.editFlags.canPaste },
      { role: 'selectAll' },
    ]);
  } else if (p.selectionText.trim()) {
    groups.push([{ role: 'copy' }]);
  }
  groups.push([
    { label: 'Back', enabled: history.canGoBack(), click: () => history.goBack() },
    { label: 'Forward', enabled: history.canGoForward(), click: () => history.goForward() },
    { label: 'Reload', click: () => contents.reload() },
  ]);
  groups.push([{ label: 'Inspect Element', click: () => contents.inspectElement(p.x, p.y) }]);

  return Menu.buildFromTemplate(groups.flatMap((g, i) => (i ? [sep, ...g] : g)));
}

// A Higgsfield page: a tab's webview, or a sign-in popup opened from one.
function wirePage(contents) {
  contents.on('did-navigate', (_e, url) => trackTab(contents, url));
  contents.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) trackTab(contents, url); });
  contents.once('destroyed', () => {
    tabProjects.delete(contents.id);
    shownTabNames.delete(contents.id);
  });
  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (isGoogleSignIn(url)) {
      handleGoogleSignIn(contents);
      return { action: 'deny' };
    }
    if (isSite(url)) {
      sendCommand({ type: 'newTab', url, background: disposition === 'background-tab' });
      return { action: 'deny' };
    }
    if (url === 'about:blank' || isFlow(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { icon: ICON, backgroundColor: BACKGROUND, autoHideMenuBar: true },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  contents.on('did-create-window', win => wirePage(win.webContents));

  contents.on('will-navigate', (event, url) => {
    if (isGoogleSignIn(url)) {
      event.preventDefault();
      handleGoogleSignIn(contents);
      return;
    }
    // Once a sign-in or checkout flow has left Higgsfield, let it finish
    // wherever it goes; it returns to Higgsfield on its own.
    if (isSite(url) || isFlow(url) || !isSite(contents.getURL())) return;
    event.preventDefault();
    openExternal(url);
  });
  // Higgsfield's sign-in service redirects to Google rather than linking to it.
  contents.on('will-redirect', event => {
    if (event.isMainFrame && isGoogleSignIn(event.url)) {
      event.preventDefault();
      handleGoogleSignIn(contents);
    }
  });

  contents.on('context-menu', (_event, params) => {
    buildContextMenu(contents, params).popup();
  });
}

// The app's own pages (tab UI, settings) never navigate or open windows.
function lockDown(contents) {
  contents.on('will-navigate', event => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function createMainWindow() {
  const state = loadWindowState();
  const autoHide = settings.get().menuBar.autoHide;
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 800,
    minHeight: 600,
    title: 'Higgsfield',
    icon: ICON,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: autoHide,
    // macOS: no title bar; the window buttons sit in the toolbar, which drags the window.
    ...(IS_MAC ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 13, y: 12 } } : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload', 'shell.js'),
      webviewTag: true,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false, // keep layout saves and tab updates prompt while minimised
    },
  });

  const contents = mainWindow.webContents;
  lockDown(contents);
  hotkeys.attach(contents);

  contents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isSite(params.src) && !isFlow(params.src)) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.spellcheck = true;
    // Background tabs must keep polling so generation alerts arrive on time.
    webPreferences.backgroundThrottling = false;
    params.partition = PARTITION;
  });

  if (state.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('focus', () => mainWindow.flashFrame(false));
  mainWindow.on('close', event => {
    store.writeJson(STATE_FILE, { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() });
    tray.handleClose(event);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  // The toolbar leaves room for the window buttons, which full screen hides.
  mainWindow.on('enter-full-screen', () => sendCommand({ type: 'fullScreen', on: true }, { reveal: false }));
  mainWindow.on('leave-full-screen', () => sendCommand({ type: 'fullScreen', on: false }, { reveal: false }));

  // Mouse side buttons
  mainWindow.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') sendCommand({ type: 'back' });
    if (cmd === 'browser-forward') sendCommand({ type: 'forward' });
  });

  mainWindow.loadFile(SHELL_PAGE);
}

function openSettings(section = 'general') {
  if (settingsWindow) {
    settingsWindow.webContents.send('settings:show-section', section);
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 820,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    parent: mainWindow || undefined,
    title: 'Higgsfield Settings',
    icon: ICON,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload', 'settings.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  settingsWindow.setMenu(null);
  lockDown(settingsWindow.webContents);
  // The app's shortcuts belong to the main window; ⌘W here closes Settings, as in any Mac app.
  if (IS_MAC) {
    settingsWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.meta && !input.control && !input.alt && input.code === 'KeyW') {
        event.preventDefault();
        settingsWindow.close();
      }
    });
  }
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
    hotkeys.suspendGlobal(false);
  });
  settingsWindow.loadFile(SETTINGS_PAGE, { query: { section } });
}

// A tab of the main window, by its webContents id.
function isTab(id) {
  const contents = Number.isInteger(id) ? webContents.fromId(id) : null;
  return !!contents && contents.getType() === 'webview' && !!mainWindow
    && contents.hostWebContents === mainWindow.webContents;
}

// Used by the Settings page's Workspaces list.
function workspaceOp(op, args) {
  const a = args && typeof args === 'object' ? args : {};
  switch (op) {
    case 'load': return loadWorkspace(a.id);
    case 'rename': return workspaces.rename(a.id, a.name);
    case 'delete': return workspaces.remove(a.id);
    default: return { ok: false, error: 'Unknown workspace operation.' };
  }
}

// Each page may only use its own channels; a message from anywhere else is ignored.
function fromShell(event) {
  return !!mainWindow && event.sender === mainWindow.webContents;
}

function fromSettings(event) {
  return !!settingsWindow && event.sender === settingsWindow.webContents;
}

function on(allowed, channel, fn) {
  ipcMain.on(channel, (event, ...args) => { if (allowed(event)) fn(...args); });
}

function handle(allowed, channel, fn) {
  ipcMain.handle(channel, (event, ...args) => (allowed(event) ? fn(...args) : null));
}

function registerIpc() {
  handle(fromShell, 'shell:get-initial-state', () => ({
    layout: currentLayout,
    csProjects: menuProjects(),
    workspaces: workspaceSummaries(),
    locked: settings.get().layout.locked,
    quickSections: quickSections(),
    generating,
  }));
  on(fromShell, 'shell:save-layout', layout => {
    if (!layout || typeof layout !== 'object') return;
    currentLayout = layout;
    const json = JSON.stringify(layout);
    if (json === savedLayoutJson) return;
    savedLayoutJson = json;
    store.writeJson(LAYOUT_FILE, layout);
  });
  on(fromShell, 'shell:project', r => {
    if (!r) return;
    if (r.op === 'openFolder' && !r.key) dispatch('openDownloads');
    else if (r.op === 'rename') renameActiveProject();
    else if (r.op === 'manage') openSettings('projects');
    else if (['openFolder', 'pin', 'unpin', 'moveLeft', 'moveRight'].includes(r.op)) projectOp(r.op, { key: r.key });
  });
  on(fromShell, 'shell:viewport', v => {
    if (v && isTab(v.webContentsId)) viewport.update(v.webContentsId, v);
  });
  on(fromShell, 'shell:prompt-result', r => {
    const resolve = r && pendingPrompts.get(r.requestId);
    if (!resolve) return;
    pendingPrompts.delete(r.requestId);
    resolve(typeof r.value === 'string' && r.value.trim() ? r.value.trim() : null);
  });
  on(fromShell, 'shell:workspace', r => {
    if (!r) return;
    if (r.op === 'save') saveWorkspace();
    else if (r.op === 'manage') openSettings('workspaces');
    else if (r.op === 'load' && r.args) loadWorkspace(r.args.id);
  });
  on(fromShell, 'shell:set-locked', setLocked);
  on(fromShell, 'shell:set-quick-sections', ids => settings.update({ toolbar: { sections: quickSections(ids) } }));
  on(fromShell, 'shell:tabs-changed', tabs => {
    if (!Array.isArray(tabs)) return;
    openTabs = tabs.map(t => ({
      webContentsId: Number.isInteger(t.webContentsId) ? t.webContentsId : null,
      title: String(t.title || ''),
      active: !!t.active,
      visible: !!t.visible,
    }));
    showActiveProject();
  });
  on(fromShell, 'shell:show-in-folder', filePath => {
    if (savedFiles.has(filePath)) shell.showItemInFolder(filePath);
  });

  handle(fromSettings, 'settings:get-state', () => ({
    settings: settings.get(),
    workspaces: workspaces.list(),
    projects: projects.list(),
  }));
  handle(fromSettings, 'settings:project', async (op, args) => {
    const result = op === 'chooseFolder'
      ? await chooseProjectFolder(args && args.key)
      : projectOp(String(op), args);
    return { ...result, projects: projects.list() };
  });
  handle(fromSettings, 'settings:workspace', (op, args) => {
    const { workspace: _ws, ...result } = workspaceOp(String(op), args); // its layout stays here
    return { ...result, workspaces: workspaces.list() };
  });
  handle(fromSettings, 'settings:update', patch => {
    if (!patch || typeof patch !== 'object') return settings.get();
    const { hotkeys: _ignored, ...rest } = patch; // shortcuts go through set-hotkey validation
    return settings.update(rest);
  });
  handle(fromSettings, 'settings:set-hotkey', (id, accelerator) => hotkeys.setHotkey(String(id), String(accelerator || '')));
  handle(fromSettings, 'settings:reset-hotkeys', () => hotkeys.resetHotkeys());
  handle(fromSettings, 'settings:choose-folder', () => downloads.chooseFolder(settingsWindow));
  on(fromSettings, 'settings:open-folder', () => downloads.openFolder(settings.get().downloads.folder));
  on(fromSettings, 'settings:recording', recording => hotkeys.suspendGlobal(!!recording));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId('ro.badwolf.higgsfield');
  if (IS_MAC) {
    app.setAboutPanelOptions({
      applicationName: 'Higgsfield',
      applicationVersion: app.getVersion(),
      credits: 'An unofficial desktop app for higgsfield.ai. Not affiliated with Higgsfield.',
      website: 'https://github.com/badwolf-ro/Higgsfield-Desktop',
    });
  }
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback);

  app.on('second-instance', () => tray.showWindow());

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    wirePage(contents);
    hotkeys.attach(contents);
    notify.watch(contents);
    folders.watch(contents);
    viewport.watch(contents);
  });

  app.whenReady().then(() => {
    settings.load();
    workspaces.load();
    projects.load({ getRoot: () => settings.get().downloads.folder });
    currentLayout = store.readJson(LAYOUT_FILE);
    savedLayoutJson = JSON.stringify(currentLayout);
    const ses = session.fromPartition(PARTITION);

    // Only Higgsfield and its sign-in/payment pages get camera, mic, clipboard, notifications.
    ses.setPermissionRequestHandler((_wc, _permission, callback, details) => {
      const url = details.requestingUrl || '';
      callback(isSite(url) || isFlow(url));
    });

    hotkeys.init({ settings, dispatch });

    downloads.init({
      session: ses,
      settings,
      getWindow: () => mainWindow,
      getFolder: downloadFolderFor,
      onSaved: ({ filePath, filename }) => {
        savedFiles.add(filePath);
        const project = projects.list().find(p => path.dirname(filePath) === p.downloadFolder);
        const where = project ? ` to ${project.name}` : '';
        toast(`Saved ${filename}${where}`, filePath);
      },
    });

    if (IS_MAC) {
      // A packaged app takes its Dock icon from the bundle; running from source shows Electron's.
      if (!app.isPackaged) app.dock.setIcon(path.join(__dirname, 'build', 'icon-mac.png'));
      app.dock.setMenu(Menu.buildFromTemplate([
        { label: 'New Tab', click: () => sendCommand({ type: 'newTab' }) },
        { label: 'Open Downloads Folder', click: () => downloads.openFolder() },
      ]));
    }

    tray.init({
      getWindow: () => mainWindow,
      settings,
      icon: ICON,
      onNewTab: () => sendCommand({ type: 'newTab' }),
      onOpenDownloads: () => downloads.openFolder(),
      onQuit: () => app.quit(),
    });

    notify.init({
      settings,
      icon: ICON,
      getWindow: () => mainWindow,
      getTab: id => openTabs.find(t => t.webContentsId === id) || null,
      onFolderRenamed: (id, name) => projects.renamedOnHiggsfield(id, name),
      // Only generations started in a tab that is still open, so the file goes to that tab's folder.
      onFileReady: (id, url) => {
        if (settings.get().downloads.autoDownload && isTab(id)) downloads.save(webContents.fromId(id), url);
      },
      onClick: id => {
        tray.showWindow();
        sendCommand({ type: 'focusTab', webContentsId: id });
      },
      onStatus: count => {
        generating = count;
        sendCommand({ type: 'status', generating: count }, { reveal: false });
        if (IS_MAC) app.dock.setBadge(count > 0 ? String(count) : '');
      },
    });

    viewport.init({
      settings,
      onInfo: info => sendCommand({ type: 'viewportInfo', ...info }, { reveal: false }),
      onZoomRequest: (id, direction) => {
        sendCommand({ type: direction === 'in' ? 'zoomIn' : 'zoomOut', webContentsId: id }, { reveal: false });
      },
    });

    projects.on('change', list => {
      sendCommand({ type: 'csProjects', items: menuProjects() }, { reveal: false });
      for (const id of tabProjects.keys()) showTabProject(id);
      showActiveProject();
      sendToSettings('settings:projects-changed', list);
    });

    workspaces.on('change', list => {
      sendCommand({ type: 'workspaces', items: workspaceSummaries() }, { reveal: false });
      sendToSettings('settings:workspaces-changed', list);
      refreshMenu();
    });

    settings.on('change', (snapshot, patch) => {
      sendToSettings('settings:changed', snapshot);
      if (mainWindow && patch.menuBar) {
        mainWindow.setAutoHideMenuBar(snapshot.menuBar.autoHide);
        mainWindow.setMenuBarVisibility(!snapshot.menuBar.autoHide);
      }
      if (patch.layout && 'fitDesktop' in patch.layout) viewport.refreshAll();
      if (patch.toolbar) sendCommand({ type: 'quickSections', ids: quickSections() }, { reveal: false });
      if (patch.layout && 'locked' in patch.layout) {
        sendCommand({ type: 'setLocked', locked: snapshot.layout.locked }, { reveal: false });
      }
      // Projects without a folder of their own are saved inside the download folder.
      if (patch.downloads) sendToSettings('settings:projects-changed', projects.list());
      if (patch.hotkeys || patch.layout) refreshMenu();
    });

    registerIpc();
    refreshMenu();
    createMainWindow();
  });

  // Clicking the Dock icon brings back a window closed to the Dock.
  app.on('activate', () => {
    if (mainWindow) tray.showWindow();
    else if (app.isReady()) createMainWindow();
  });

  app.on('before-quit', () => tray.setQuitting());
  app.on('will-quit', () => {
    hotkeys.dispose();
    tray.destroy();
  });
  app.on('window-all-closed', () => app.quit());
}
