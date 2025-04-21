const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
// Load .env from root directory relative to this file's parent dir
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

let mainWindow;

// Basic security check
if (!process.env.GEMINI_API_KEY) {
    console.warn("WARNING: GEMINI_API_KEY is not set in the .env file. The application backend may not function correctly.");
    // Optionally show a dialog: dialog.showErrorBox(...)
}


function createWindow() {
    mainWindow = new BrowserWindow({
        width: 500, // Slightly wider for better layout
        height: 750,
        frame: false, // Essential for custom title bar & glass effect
        transparent: true, // Enable transparency for the glass effect
        backgroundColor: '#00000000', // Start fully transparent
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: !app.isPackaged // Enable DevTools only when not packaged
        },
        show: false, // Don't show until ready
        resizable: true, // Allow resizing for flexibility
        maximizable: true,
        minimizabile: true,
        // vibrancy: 'under-window', // macOS only: alternative glass effect (experiment if needed)
        // visualEffectState: 'active', // macOS only: Ensure vibrancy is active
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    // --- Graceful Show & Animation Trigger ---
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.webContents.send('window-ready'); // Signal renderer for entry animation
    });

    // --- Window Lifecycle ---
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

     // Open DevTools if not packaged
     if (!app.isPackaged) {
         mainWindow.webContents.openDevTools({ mode: 'detach' });
     }
}

// --- App Lifecycle ---
app.whenReady().then(() => {
    createWindow();

    // Optional: Set up basic menu for standard actions (Copy/Paste, Quit)
    const template = [
        // { role: 'appMenu' } // On macOS includes standard App menu
        ...(process.platform === 'darwin' ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }] : []),
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            ...(process.platform === 'darwin' ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
            ] : [
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' }
            ])
          ]
        },
        {
           label: 'View',
           submenu: [
             { role: 'reload' },
             { role: 'forceReload' },
             ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]), // Only show DevTools toggle if not packaged
             { type: 'separator' },
             { role: 'resetZoom' },
             { role: 'zoomIn' },
             { role: 'zoomOut' },
             { type: 'separator' },
             { role: 'togglefullscreen' }
           ]
         },
        { role: 'windowMenu'}
      ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

});

// Quit when all windows are closed (except macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // Re-create window on macOS if dock icon clicked and no windows open
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// --- IPC Handlers for Custom Window Controls ---
ipcMain.on('close-app', () => {
    app.quit(); // Clean way to close
});

ipcMain.on('minimize-app', () => {
    mainWindow?.minimize();
});

ipcMain.on('maximize-app', () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow?.maximize();
    }
});