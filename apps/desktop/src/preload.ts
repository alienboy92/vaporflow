import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '@vaporflow/core';

const diagnosticsEnabled = process.argv.includes('--vaporflow-diagnostics');
const bridge: DesktopBridge = {
  platform: 'desktop',
  db: {
    query: (sql, params) => ipcRenderer.invoke('db:query', sql, params),
    batch: (statements) => ipcRenderer.invoke('db:batch', statements),
    migrate: () => ipcRenderer.invoke('db:migrate'),
  },
  ...(diagnosticsEnabled
    ? {
        diagnostics: {
          read: () => ipcRenderer.invoke('diagnostics:read'),
          createFixture: () => ipcRenderer.invoke('diagnostics:create'),
        },
      }
    : {}),
};
contextBridge.exposeInMainWorld('vaporflow', bridge);
