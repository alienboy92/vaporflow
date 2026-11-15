import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { ElectronDbAdapter } from './sqlite-adapter.js';
import { assertSender, validateBatch, validateQuery } from './ipc-policy.js';
import { readDevelopmentDbCheck, runDevelopmentDbCheck } from '@vaporflow/core';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const development = !app.isPackaged;
const smokeDirectory = app.commandLine.getSwitchValue('vaporflow-smoke-directory');
// Test launches explicitly choose an isolated directory; ordinary launches use userData.
if (smokeDirectory) {
  if (!path.isAbsolute(smokeDirectory)) throw new Error('Smoke directory must be absolute');
  mkdirSync(smokeDirectory, { recursive: true });
  app.setPath('userData', smokeDirectory);
}
const entryUrl =
  development && !smokeDirectory
    ? 'http://localhost:5173/'
    : pathToFileURL(path.join(dirname, '..', 'renderer', 'index.html')).href;
let database: ElectronDbAdapter | undefined;
let diagnosticDatabase: ElectronDbAdapter | undefined;

async function start(): Promise<void> {
  const dataPath = app.getPath('userData');
  mkdirSync(dataPath, { recursive: true });
  database = new ElectronDbAdapter(path.join(dataPath, 'vaporflow.sqlite'));
  // Do not serve UI/IPC against a partially migrated database.
  await database.migrate();
  if (development && !smokeDirectory) {
    diagnosticDatabase = new ElectronDbAdapter(path.join(dataPath, 'diagnostics.sqlite'));
    await diagnosticDatabase.migrate();
  }
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: !smokeDirectory,
    title: 'VaporFlow',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(dirname, 'preload.cjs'),
      additionalArguments: diagnosticDatabase ? ['--vaporflow-diagnostics'] : [],
    },
  });
  const guard = (event: Electron.IpcMainInvokeEvent) =>
    assertSender(
      {
        webContentsId: event.sender.id,
        isMainFrame: event.senderFrame === window.webContents.mainFrame,
        url: event.senderFrame?.url ?? '',
      },
      { webContentsId: window.webContents.id, url: entryUrl },
    );
  ipcMain.handle('db:query', async (event, sql: unknown, params: unknown) => {
    guard(event);
    const input = validateQuery(sql, params);
    return database!.query(input.sql, input.params);
  });
  ipcMain.handle('db:batch', async (event, statements: unknown) => {
    guard(event);
    return database!.batch(validateBatch(statements));
  });
  ipcMain.handle('db:migrate', async (event) => {
    guard(event);
    await database!.migrate();
  });
  if (diagnosticDatabase) {
    ipcMain.handle('diagnostics:read', async (event) => {
      guard(event);
      return readDevelopmentDbCheck(diagnosticDatabase!);
    });
    ipcMain.handle('diagnostics:create', async (event) => {
      guard(event);
      return runDevelopmentDbCheck(diagnosticDatabase!);
    });
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== entryUrl) event.preventDefault();
  });
  window.webContents.on('preload-error', (_event, _file, error) => {
    console.error(error);
    app.exit(1);
  });
  window.webContents.on('render-process-gone', (_event, detail) => {
    console.error(detail);
    app.exit(1);
  });
  await window.loadURL(entryUrl);
  console.log('[electron] Loaded', window.webContents.getURL());
  if (smokeDirectory) {
    // Real renderer -> sandboxed preload -> validated main IPC. No production fixtures.
    const result: unknown = await window.webContents.executeJavaScript(`(async () => {
      const api = window.vaporflow;
      if (!api || api.diagnostics) throw new Error('Missing bridge or exposed diagnostics');
      await api.db.migrate();
      const before = await api.db.query("SELECT value FROM settings WHERE key = 'phase2-smoke'");
      await api.db.batch([{sql:"INSERT INTO settings(key,value) VALUES ('phase2-smoke','persisted') ON CONFLICT(key) DO NOTHING"}]);
      let rolledBack = false;
      try { await api.db.batch([{sql:"INSERT INTO settings(key,value) VALUES ('phase2-failure','bad')"},{sql:'INSERT INTO missing_smoke_table VALUES (1)'}]); }
      catch { rolledBack = (await api.db.query("SELECT * FROM settings WHERE key = 'phase2-failure'")).length === 0; }
      if (!rolledBack) throw new Error('IPC batch failed rollback test');
      const migrations = await api.db.query('SELECT name FROM _migrations ORDER BY name');
      if (migrations.length !== 2) throw new Error('Missing migrations');
      for (let i = 0; i < 100 && !document.body.innerText.includes('Database connected'); i++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!document.body.innerText.includes('Database connected')) throw new Error('Renderer database provider did not initialize');
      return { persisted: before[0]?.value === 'persisted', rolledBack, migrations: migrations.length, renderer: true };
    })()`);
    console.log('VAPORFLOW_SMOKE ' + JSON.stringify(result));
    app.quit();
  }
}
app
  .whenReady()
  .then(start)
  .catch((error: unknown) => {
    console.error('[electron] Startup failed', error);
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  diagnosticDatabase?.close();
  database?.close();
});
