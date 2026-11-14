import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IS_DEV = !app.isPackaged;
const DEV_SERVER_URL = 'http://localhost:5173';

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'VaporFlow',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[electron] Preload failed:', preloadPath, error);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[electron] Renderer exited:', details);
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    console.log('[electron] Window shown');
  });
  const loaded = IS_DEV
    ? mainWindow.loadURL(DEV_SERVER_URL)
    : mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  loaded.then(() => {
    console.log('[electron] Loaded:', mainWindow.webContents.getURL());
  }).catch((error: unknown) => {
    console.error('[electron] Window load failed:', error);
    app.exit(1);
  });
  if (IS_DEV) {
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  }
}

app.whenReady().then(createWindow).catch((error: unknown) => {
  console.error('[electron] Startup failed:', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
