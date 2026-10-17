// Which addresses belong to Higgsfield, its sections, and every action that can
// have a keyboard shortcut. Shared by the main process (require) and renderer
// pages (window.HFActions).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HFActions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const IS_MAC = typeof process !== 'undefined' && process.platform
    ? process.platform === 'darwin'
    : typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

  const HOME = 'https://higgsfield.ai/';
  const PARTITION = 'persist:higgsfield'; // one login for every tab, kept between launches

  // Hosts (and their subdomains) that belong to Higgsfield; images.higgs.ai serves its images.
  const SITE_HOSTS = ['higgsfield.ai', 'higgs.ai'];

  function isSite(url) {
    let u;
    try { u = new URL(url); } catch { return false; }
    return u.protocol === 'https:' && SITE_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  }

  const SECTIONS = [
    { id: 'explore', label: 'Explore', url: HOME },
    { id: 'image', label: 'Image', url: HOME + 'ai/image' },
    { id: 'video', label: 'Video', url: HOME + 'ai/video' },
    { id: 'audio', label: 'Audio', url: HOME + 'audio' },
    { id: 'cinema', label: 'Cinema Studio', url: HOME + 'generate' },
    { id: 'canvas', label: 'Canvas', url: HOME + 'canvas' },
    { id: 'supercomputer', label: 'Supercomputer', url: HOME + 'supercomputer' },
    { id: 'effects', label: 'Effects', url: HOME + 'effects/use' },
    { id: 'marketing', label: 'Marketing Studio', url: HOME + 'marketing-studio' },
    { id: 'community', label: 'Community', url: HOME + 'community' },
  ];

  // label: the name within its group; title: the name on its own.
  // handler 'shell': the main process forwards { type: id } to the tab UI.
  // handler 'main':  the main process runs it itself.
  // global: registered system-wide, works while another app is focused.
  // mac: the default on macOS, where Command (Super) takes Ctrl's place and Alt+arrows move by word.
  const ACTIONS = [
    { id: 'newTab', group: 'Tabs', label: 'New tab', hotkey: 'Ctrl+T', mac: 'Super+T', handler: 'shell' },
    { id: 'closeTab', group: 'Tabs', label: 'Close tab', hotkey: 'Ctrl+W', mac: 'Super+W', handler: 'shell' },
    { id: 'reopenClosedTab', group: 'Tabs', label: 'Reopen closed tab', hotkey: 'Ctrl+Shift+T', mac: 'Super+Shift+T', handler: 'shell' },
    { id: 'nextTab', group: 'Tabs', label: 'Next tab', hotkey: 'Ctrl+Tab', mac: 'Ctrl+Tab', handler: 'shell' },
    { id: 'prevTab', group: 'Tabs', label: 'Previous tab', hotkey: 'Ctrl+Shift+Tab', mac: 'Ctrl+Shift+Tab', handler: 'shell' },
    { id: 'splitRight', group: 'Tabs', label: 'Split right', hotkey: 'Ctrl+Alt+Right', mac: 'Alt+Super+Right', handler: 'shell' },
    { id: 'splitDown', group: 'Tabs', label: 'Split down', hotkey: 'Ctrl+Alt+Down', mac: 'Alt+Super+Down', handler: 'shell' },

    { id: 'back', group: 'Navigation', label: 'Back', hotkey: 'Alt+Left', mac: 'Super+[', handler: 'shell' },
    { id: 'forward', group: 'Navigation', label: 'Forward', hotkey: 'Alt+Right', mac: 'Super+]', handler: 'shell' },
    { id: 'reload', group: 'Navigation', label: 'Reload', hotkey: 'F5', mac: 'Super+R', handler: 'shell' },
    { id: 'hardReload', group: 'Navigation', label: 'Reload without cache', hotkey: 'Ctrl+F5', mac: 'Shift+Super+R', handler: 'shell' },
    { id: 'home', group: 'Navigation', label: 'Home', hotkey: 'Alt+Home', mac: 'Shift+Super+H', handler: 'shell' },

    ...SECTIONS.map(s => ({
      id: 'open:' + s.id, group: 'Open in new tab', label: s.label, title: `Open ${s.label} in new tab`,
      hotkey: '', handler: 'main', url: s.url,
    })),

    { id: 'saveWorkspace', group: 'Workspaces', label: 'Save workspace…', hotkey: '', handler: 'main' },

    { id: 'zoomIn', group: 'View', label: 'Zoom in', hotkey: 'Ctrl+=', mac: 'Super+=', handler: 'shell' },
    { id: 'zoomOut', group: 'View', label: 'Zoom out', hotkey: 'Ctrl+-', mac: 'Super+-', handler: 'shell' },
    { id: 'resetZoom', group: 'View', label: 'Reset zoom', hotkey: 'Ctrl+0', mac: 'Super+0', handler: 'shell' },
    { id: 'toggleLock', group: 'View', label: 'Lock layout', hotkey: '', handler: 'main' },
    { id: 'toggleFullscreen', group: 'View', label: 'Full screen', hotkey: 'F11', mac: 'Ctrl+Super+F', handler: 'main' },
    { id: 'devTools', group: 'View', label: 'Developer tools for this tab', hotkey: 'Ctrl+Shift+I', mac: 'Alt+Super+I', handler: 'shell' },

    { id: 'openDownloads', group: 'App', label: 'Open downloads folder', hotkey: 'Ctrl+J', mac: 'Alt+Super+L', handler: 'main' },
    { id: 'openSettings', group: 'App', label: 'Settings', hotkey: 'Ctrl+,', mac: 'Super+,', handler: 'main' },
    { id: 'openHotkeys', group: 'App', label: 'Hotkeys', hotkey: '', handler: 'main' },
    { id: 'clearCache', group: 'App', label: 'Clear cache', hotkey: 'Ctrl+Shift+Delete', mac: 'Shift+Super+Backspace', handler: 'main' },

    { id: 'toggleWindow', group: 'From any app', label: 'Show or hide Higgsfield', hotkey: 'Ctrl+Alt+H', mac: 'Ctrl+Alt+H', handler: 'main', global: true },
  ];

  for (const action of ACTIONS) {
    action.title = action.title || action.label;
    if (IS_MAC && action.mac !== undefined) action.hotkey = action.mac;
  }

  const byId = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

  return { IS_MAC, HOME, PARTITION, isSite, SECTIONS, ACTIONS, byId };
});
