// Application menu. Shortcuts are shown here but handled by hotkeys.js
// (registerAccelerator: false), so user-configured bindings apply everywhere.
const { app, Menu } = require('electron');
const { SECTIONS, byId } = require('../shared/actions');

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// opts: { dispatch(id), accelerator(id), sendCommand(cmd), openSettings(section), clearAllData(),
//         workspaces: [{ id, name, tabCount }], loadWorkspace(id), locked }
function build(opts) {
  const { dispatch, accelerator, sendCommand, openSettings, clearAllData, workspaces, loadWorkspace, locked } = opts;

  const action = (id, extra) => ({
    label: byId[id].label,
    accelerator: accelerator(id),
    registerAccelerator: false,
    click: () => dispatch(id),
    ...extra,
  });
  const sep = { type: 'separator' };
  const mac = process.platform === 'darwin';

  const workspaceItems = workspaces.length
    ? workspaces.map(w => ({
      label: mac ? truncate(w.name, 48) : truncate(w.name, 48).replace(/&/g, '&&'),
      sublabel: `${w.tabCount} ${w.tabCount === 1 ? 'tab' : 'tabs'}`,
      click: () => loadWorkspace(w.id),
    }))
    : [{ label: 'No saved workspaces yet', enabled: false }];

  // macOS keeps Settings and Quit in the app menu named after the app, with the
  // system's Services, Hide and Show All beside them.
  const appMenu = {
    label: app.name,
    submenu: [
      { role: 'about', label: 'About Higgsfield' },
      sep,
      action('openSettings', { label: 'Settings…' }),
      action('openHotkeys', { label: 'Hotkeys…' }),
      sep,
      { role: 'services' },
      sep,
      { role: 'hide', label: 'Hide Higgsfield' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      sep,
      { role: 'quit', label: 'Quit Higgsfield' },
    ],
  };

  const template = [
    ...(mac ? [appMenu] : []),
    {
      label: '&File',
      submenu: [
        action('newTab', { label: 'New Tab' }),
        action('reopenClosedTab', { label: 'Reopen Closed Tab' }),
        action('closeTab', { label: 'Close Tab' }),
        sep,
        action('openDownloads', { label: 'Open Downloads Folder' }),
        sep,
        ...(mac ? [] : [
          action('openSettings', { label: 'Settings…' }),
          action('openHotkeys', { label: 'Hotkeys…' }),
          sep,
        ]),
        action('clearCache', { label: 'Clear Cache' }),
        { label: 'Clear All Data and Sign Out…', click: clearAllData },
        ...(mac ? [] : [sep, { role: 'quit', label: 'Quit Higgsfield' }]),
      ],
    },
    { role: 'editMenu', label: '&Edit' },
    {
      label: '&View',
      submenu: [
        action('reload', { label: 'Reload' }),
        action('hardReload', { label: 'Reload Without Cache' }),
        sep,
        action('zoomIn', { label: 'Zoom In' }),
        action('zoomOut', { label: 'Zoom Out' }),
        action('resetZoom', { label: 'Reset Zoom' }),
        sep,
        action('toggleFullscreen', { label: 'Full Screen' }),
        sep,
        action('devTools', { label: 'Developer Tools for This Tab' }),
      ],
    },
    {
      label: '&Tabs',
      submenu: [
        action('back', { label: 'Back' }),
        action('forward', { label: 'Forward' }),
        action('home', { label: 'Home' }),
        sep,
        action('newTab', { label: 'New Tab' }),
        {
          label: 'Open in New Tab',
          submenu: SECTIONS.map(s => action('open:' + s.id, { label: s.label })),
        },
        action('closeTab', { label: 'Close Tab' }),
        sep,
        action('nextTab', { label: 'Next Tab' }),
        action('prevTab', { label: 'Previous Tab' }),
        sep,
        action('splitRight', { label: 'Split Right' }),
        action('splitDown', { label: 'Split Down' }),
      ],
    },
    {
      label: '&Workspaces',
      submenu: [
        ...workspaceItems,
        sep,
        action('saveWorkspace', { label: 'Save Workspace…' }),
        { label: 'Manage Workspaces…', click: () => openSettings('workspaces') },
        sep,
        action('toggleLock', { label: 'Lock Layout', type: 'checkbox', checked: locked }),
        { label: 'Reset Layout', click: () => sendCommand({ type: 'resetLayout' }) },
      ],
    },
    ...(mac ? [{ role: 'windowMenu' }] : []),
  ];

  // "&File": the & marks the Alt-key letter on Windows; macOS has no such letters.
  if (mac) for (const item of template) if (item.label) item.label = item.label.replace(/&(?!&)/g, '');
  return Menu.buildFromTemplate(template);
}

module.exports = { build };
