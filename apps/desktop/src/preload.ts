import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '@vaporflow/core';

const bridge: DesktopBridge = {
  platform: 'desktop',
  db: {
    query: (sql, params) => ipcRenderer.invoke('db:query', sql, params),
    batch: (statements) => ipcRenderer.invoke('db:batch', statements),
    migrate: () => ipcRenderer.invoke('db:migrate'),
  },
  app: {
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  },
};
contextBridge.exposeInMainWorld('vaporflow', bridge);
