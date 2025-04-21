const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window Controls
  closeApp: () => ipcRenderer.send('close-app'),
  minimizeApp: () => ipcRenderer.send('minimize-app'),
  maximizeApp: () => ipcRenderer.send('maximize-app'), // Added maximize/restore

  // Lifecycle Events
  onWindowReady: (callback) => ipcRenderer.on('window-ready', callback),

  // Example for future use: Invoking main process functions
  // getAppPath: () => ipcRenderer.invoke('get-app-path'),
});

// We'll use fetch directly in the renderer for simplicity and security
// and include marked.js via script tag in HTML.
// No need to expose Node modules here.