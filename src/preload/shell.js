// Bridge for the tab/dock UI (src/renderer/shell). Sandboxed: only 'electron' can be required.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hf', {
  getInitialState: () => ipcRenderer.invoke('shell:get-initial-state'),
  saveLayout: layout => ipcRenderer.send('shell:save-layout', layout),
  tabsChanged: tabs => ipcRenderer.send('shell:tabs-changed', tabs),
  showInFolder: filePath => ipcRenderer.send('shell:show-in-folder', String(filePath)),
  viewport: info => ipcRenderer.send('shell:viewport', info),
  promptResult: (requestId, value) => ipcRenderer.send('shell:prompt-result', { requestId, value }),
  workspace: (op, args) => ipcRenderer.send('shell:workspace', { op, args }),
  setLocked: value => ipcRenderer.send('shell:set-locked', !!value),
  setQuickSections: ids => ipcRenderer.send('shell:set-quick-sections', ids),
  projectAction: (op, key) => ipcRenderer.send('shell:project', { op, key }),
  onCommand: cb => {
    const listener = (_event, command) => cb(command);
    ipcRenderer.on('shell:command', listener);
    return () => ipcRenderer.removeListener('shell:command', listener);
  },
});
