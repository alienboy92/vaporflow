import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '@bali-hub-pos/core';

const bridge: DesktopBridge = {
  platform: 'desktop',
  db: {
    query: (sql, params) => ipcRenderer.invoke('db:query', sql, params),
    batch: (statements) => ipcRenderer.invoke('db:batch', statements),
    backupForCloudChange: () => ipcRenderer.invoke('db:cloudBackup'),
    migrate: () => ipcRenderer.invoke('db:migrate'),
  },
  app: {
    ...(process.platform === 'win32' ? { getSetupSql: () => ipcRenderer.invoke('app:getSetupSql') } : {}),
    downloadUpdate: () => ipcRenderer.invoke('update:download'),
    restartToUpdate: () => ipcRenderer.invoke('update:restart'),
    openBackupFolder: () => ipcRenderer.invoke('app:openBackupFolder'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  },
};
contextBridge.exposeInMainWorld('vaporflow', bridge);
