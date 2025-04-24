const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');

// Load environment variables from .env file in the project root directory
// Ensure this path is correct relative to where 'npm start' is run (root folder)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow = null;

// Optional: Check for API key early and warn if missing
if (!process.env.GEMINI_API_KEY) {
    console.warn("WARNING: GEMINI_API_KEY is not set in the .env file in the project root.");
    // Consider showing a dialog box on app ready if the key is critical
    // app.on('ready', () => {
    //   dialog.showErrorBox('API Key Missing', 'GEMINI_API_KEY is required. Please set it in the .env file.');
    //   app.quit(); // Optionally quit if the key is essential
    // });
}

function createWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 550, // Adjusted width
        height: 750,
        frame: false,       // Remove default OS window frame
        transparent: true,  // Enable window transparency for effects
        backgroundColor: '#00000000', // Start fully transparent background
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // Path to the preload script
            contextIsolation: true,  // Security: Isolate renderer context from preload
            nodeIntegration: false,  // Security: Disable Node.js integration in renderer
            devTools: !app.isPackaged // Security/Dev: Enable DevTools only when not packaged
        },
        show: false, // Don't show window until it's ready to avoid flash
        resizable: true, // Allow user resizing
        maximizable: true, // Allow maximizing
        minimizable: true, // Allow minimizing
        title: "Zenith Assistant", // Window title (though frame is off)
        icon: path.join(__dirname, 'renderer', 'assets', 'icon.png') // Optional: Path to your app icon
        // vibrancy: 'under-window', // macOS specific effect
    });

    // Load the index.html file into the window
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    // Show the window gracefully once the page has finished loading
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // Send a signal to the renderer process that the window is ready
        mainWindow.webContents.send('window-ready');
    });

    // Event handler for when the window is closed
    mainWindow.on('closed', () => {
        // Dereference the window object, allowing garbage collection
        mainWindow = null;
    });

    // Automatically open Developer Tools if the app is not packaged
    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools({ mode: 'detach' }); // Open in a separate window
    }
}

// --- Electron App Lifecycle Events ---

// This method will be called when Electron has finished initialization
// and is ready to create browser windows.
app.whenReady().then(() => {
    createWindow();

    // --- Application Menu Setup ---
    // Define the standard application menu (File, Edit, View, etc.)
    const template = [
        // { role: 'appMenu' } // Standard macOS app menu (includes About, Quit, etc.)
        ...(process.platform === 'darwin' ? [{
          label: app.name,
          submenu: [
            { role: 'about' }, { type: 'separator' }, { role: 'services' },
            { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' },
            { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }
          ]
        }] : []),
        // { role: 'fileMenu' } // Standard File menu (New Window, Open, etc. - often less needed here)
        {
          label: 'Edit', // Standard Edit menu
          submenu: [
            { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
            { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
            ...(process.platform === 'darwin' ? [
              { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }, { type: 'separator' }
              // macOS specific edit options
            ] : [
              { role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }
              // Windows/Linux specific edit options
            ])
          ]
        },
        // { role: 'viewMenu' } // Standard View menu
        {
          label: 'View',
          submenu: [
            { role: 'reload' }, { role: 'forceReload' },
            ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]), // Only show DevTools toggle if not packaged
            { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
            { type: 'separator' }, { role: 'togglefullscreen' }
          ]
        },
        // { role: 'windowMenu' } // Standard Window menu
        {
          label: 'Window',
          submenu: [
            { role: 'minimize' }, { role: 'zoom' },
            ...(process.platform === 'darwin' ? [
              { type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }
            ] : [
              { role: 'close' } // Close action on Windows/Linux
            ])
          ]
        },
        // { role: 'help' } // Optional Help menu
        // { label: 'Help', submenu: [ { label: 'Learn More', click: async () => { const { shell } = require('electron'); await shell.openExternal('https://your-help-url.com') } } ] }
      ];

    // Build the menu from the template and set it for the application
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

}); // End app.whenReady()

// Quit the app when all windows are closed (Windows & Linux)
app.on('window-all-closed', () => {
    // On macOS, applications usually stay active until explicitly quit
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // On macOS, re-create the window if the dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// --- IPC Handlers for Renderer Communication ---
// Listen for messages from the renderer process to control the window

ipcMain.on('close-app', () => {
    console.log('Received close-app signal from renderer.');
    app.quit(); // Quit the entire application
});

ipcMain.on('minimize-app', () => {
    console.log('Received minimize-app signal from renderer.');
    mainWindow?.minimize(); // Minimize the main window if it exists
});

ipcMain.on('maximize-app', () => {
    console.log('Received maximize-app signal from renderer.');
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize(); // Restore from maximized state
        } else {
            mainWindow.maximize(); // Maximize the window
        }
    }
});

// --- End of Main Process ---