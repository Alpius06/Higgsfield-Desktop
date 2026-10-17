// System tray icon. Closing the window hides to the tray (when enabled) rather
// than quitting, so the site's session and any running generations stay alive.
// macOS has no tray icon: a closed window stays in the Dock, whose icon brings it back.
const { Tray, Menu, nativeImage } = require('electron');

let tray = null;
let settings;
let getWindow;
let quitting = false;

function showWindow() {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

// opts: { settings, icon, getWindow(), onNewTab(), onOpenDownloads(), onQuit() }
function init(opts) {
  ({ settings, getWindow } = opts);
  if (process.platform === 'darwin') return;

  const image = nativeImage.createFromPath(opts.icon).resize({ width: 32, height: 32, quality: 'best' });
  tray = new Tray(image);
  tray.setToolTip('Higgsfield');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Higgsfield', click: showWindow },
    { label: 'New tab', click: opts.onNewTab },
    { label: 'Open downloads folder', click: opts.onOpenDownloads },
    { type: 'separator' },
    { label: 'Quit Higgsfield', click: opts.onQuit },
  ]));
  tray.on('click', toggleWindow);
}

function handleClose(event) {
  const s = settings.get();
  if (quitting || !s.tray.closeToTray) return;

  event.preventDefault();
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    // A full-screen window hidden on macOS leaves an empty black Space behind.
    if (win.isFullScreen()) {
      win.once('leave-full-screen', () => win.hide());
      win.setFullScreen(false);
    } else {
      win.hide();
    }
  }

  if (!s.tray.hintShown) {
    if (tray && process.platform === 'win32') {
      tray.displayBalloon({
        title: 'Higgsfield is still running in the tray',
        content: 'Click the tray icon to show it again, right-click it to quit, '
          + 'or turn this off in Settings.',
      });
    }
    settings.update({ tray: { hintShown: true } });
  }
}

function setQuitting() {
  quitting = true;
}

function destroy() {
  if (tray) { tray.destroy(); tray = null; }
}

module.exports = { init, toggleWindow, showWindow, handleClose, setQuitting, destroy };
