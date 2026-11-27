import { MIGRATIONS } from '@bali-hub-pos/core';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { getSetupSql } from './setup-sql.js';
import updater from 'electron-updater';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { ElectronDbAdapter } from './sqlite-adapter.js';
import { assertSender, validateBatch, validateExternalUrl, validateQuery } from './ipc-policy.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const development = !app.isPackaged;
const smokeDirectory = app.commandLine.getSwitchValue('vaporflow-smoke-directory');
// Test launches explicitly choose an isolated directory; ordinary launches use userData.
if (smokeDirectory) {
  if (!path.isAbsolute(smokeDirectory)) throw new Error('Smoke directory must be absolute');
  mkdirSync(smokeDirectory, { recursive: true });
  app.setPath('userData', smokeDirectory);
} else {
  // Preserve the original shop profile across the product rename.
  app.setPath('userData', path.join(app.getPath('appData'), 'VaporFlow'));
}
const entryUrl =
  development && !smokeDirectory
    ? 'http://localhost:5173/'
    : pathToFileURL(path.join(dirname, '..', 'renderer', 'index.html')).href;
let database: ElectronDbAdapter | undefined;

async function start(): Promise<void> {
  const dataPath = app.getPath('userData');
  mkdirSync(dataPath, { recursive: true });
  database = new ElectronDbAdapter(path.join(dataPath, 'vaporflow.sqlite'));
  // Do not serve UI/IPC against a partially migrated database.
  await database.migrate();
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: !smokeDirectory,
    title: 'Bali Hub POS',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: development,
      preload: path.join(dirname, 'preload.cjs'),
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
  ipcMain.handle('app:getSetupSql', event => { guard(event); return getSetupSql(); });
  const { autoUpdater } = updater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  let ready = false;
  let downloading: Promise<void> | undefined;
  ipcMain.handle('update:download', async event => {
    guard(event);
    if (!app.isPackaged) throw new Error('Updates require an installed app.');
    if (ready) return;
    downloading ??= (async () => {
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable) throw new Error('No Windows update is available.');
      await autoUpdater.downloadUpdate();
      ready = true;
    })().finally(() => { downloading = undefined; });
    await downloading;
  });
  ipcMain.handle('update:restart', event => {
    guard(event);
    if (!ready) throw new Error('Download the update first.');
    autoUpdater.quitAndInstall(true, true);
  });
  ipcMain.handle('db:query', async (event, sql: unknown, params: unknown) => {
    guard(event);
    const input = validateQuery(sql, params);
    return database!.query(input.sql, input.params);
  });
  ipcMain.handle('db:batch', async (event, statements: unknown) => {
    guard(event);
    return database!.batch(validateBatch(statements));
  });
  ipcMain.handle('db:cloudBackup', async event => {guard(event); return database!.backupForCloudChange();});
  ipcMain.handle('app:openBackupFolder', async event => {
    guard(event);
    const error = await shell.openPath(path.join(dataPath,'backups'));
    if(error) throw Error(error);
  });
  ipcMain.handle('db:migrate', async (event) => {
    guard(event);
    await database!.migrate();
  });
  ipcMain.handle('app:openExternal', async (event, url: unknown) => {
    guard(event);
    await shell.openExternal(validateExternalUrl(url));
  });
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
  if (development) console.log('[electron] Loaded', window.webContents.getURL());
  if (smokeDirectory) {
    // Real renderer -> sandboxed preload -> validated main IPC. No production fixtures.
    const result: unknown = await window.webContents.executeJavaScript(`(async () => {
      const api = window.vaporflow;
      if (!api) throw new Error('Missing bridge');
      await api.db.migrate();
      const before = await api.db.query("SELECT value FROM settings WHERE key = 'smoke-persistence'");
      await api.db.batch([{sql:"INSERT INTO settings(key,value) VALUES ('smoke-persistence','persisted') ON CONFLICT(key) DO NOTHING"}]);
      let rolledBack = false;
      try { await api.db.batch([{sql:"INSERT INTO settings(key,value) VALUES ('smoke-rollback','bad')"},{sql:'INSERT INTO missing_smoke_table VALUES (1)'}]); }
      catch { rolledBack = (await api.db.query("SELECT * FROM settings WHERE key = 'smoke-rollback'")).length === 0; }
      if (!rolledBack) throw new Error('IPC batch failed rollback test');
      const migrations = await api.db.query('SELECT name FROM _migrations ORDER BY name');
      if (JSON.stringify(migrations.map(row => row.name)) !== ${JSON.stringify(JSON.stringify(MIGRATIONS.map(migration => migration.name)))}) throw new Error('Missing migrations');
      for (let i = 0; i < 100 && !document.body.innerText.includes('First-Run Setup'); i++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!document.body.innerText.includes('First-Run Setup')) throw new Error('Renderer database provider did not initialize');
      const prior = [{sql:"INSERT OR REPLACE INTO settings VALUES('supabase_url','https://original.invalid')"},{sql:"INSERT OR REPLACE INTO settings VALUES('supabase_anon_key','sb_publishable_fixture')"}];
      await api.db.batch(prior);
      const keys = "SELECT key,value FROM settings WHERE key IN ('supabase_url','supabase_anon_key') ORDER BY key";
      const saved = JSON.stringify(await api.db.query(keys));
      Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Join an existing shop')).click();
      await new Promise(resolve=>setTimeout(resolve,50));
      const setInput=(selector,value)=>{
        const input=document.querySelector(selector);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
        input.dispatchEvent(new Event('input',{bubbles:true}));
      };
      setInput('input[type=url]','https://different.invalid');
      for (const candidate of ['sb_secret_fixture', 'e30.'+btoa(JSON.stringify({role:'service_role'})).replace(/=+$/,'')+'.fixture']) {
        setInput('input[placeholder^="Paste the anon"]',candidate);
        document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        await new Promise(resolve=>setTimeout(resolve,150));
        if(document.querySelector('[role=alert]')?.textContent.trim()!=='This key was rejected') throw Error('Missing key rejection');
        if(JSON.stringify(await api.db.query(keys))!==saved) throw Error('Saved credentials changed');
      }
      await api.db.batch([{sql:"DELETE FROM settings WHERE key IN ('supabase_url','supabase_anon_key')"}]);
      return { persisted: before[0]?.value === 'persisted', rolledBack, migrationsVerified: true, renderer: true };
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
  database?.close();
});
