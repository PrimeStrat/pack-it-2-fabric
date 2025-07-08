const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkPath: (path) => ipcRenderer.invoke('check-path', path),
});
