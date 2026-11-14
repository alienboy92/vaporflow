import { contextBridge } from 'electron';

/**
 * Typed preload API exposed to the renderer via contextBridge.
 * Extend this as platform adapters are added in later phases.
 */
const api = {
  platform: 'desktop' as const,
} satisfies VaporFlowAPI;

export interface VaporFlowAPI {
  platform: 'desktop';
}

contextBridge.exposeInMainWorld('vaporflow', api);
