const { contextBridge, ipcRenderer, clipboard } = require('electron');

// Define a secure API to expose to the renderer process
// Only exposes specific functionalities, not entire modules
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Window Controls ---
  // Allows the renderer to request closing the application window
  closeApp: () => ipcRenderer.send('close-app'),
  // Allows the renderer to request minimizing the application window
  minimizeApp: () => ipcRenderer.send('minimize-app'),
  // Allows the renderer to request maximizing/restoring the application window
  maximizeApp: () => ipcRenderer.send('maximize-app'),

  // --- Lifecycle Events ---
  // Allows the renderer to register a callback function that will be executed
  // when the main process sends the 'window-ready' signal.
  onWindowReady: (callback) => {
      // Validate callback is a function for security/stability
      if (typeof callback === 'function') {
        ipcRenderer.on('window-ready', callback);
      } else {
        console.error('Invalid callback provided for onWindowReady');
      }
  },

  // --- Clipboard Access ---
  // Allows the renderer to read text from the system clipboard
  readClipboard: () => {
      try {
          return clipboard.readText();
      } catch (error) {
          console.error("Error reading clipboard via preload:", error);
          return ""; // Return empty string on error
      }
  },

  // --- Other Potential APIs (Example - Not currently used) ---
  // Example: Invoke a main process handler that returns a value
  // getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // Example: Open a file dialog
  // openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

});

console.log('Preload script executed successfully.');