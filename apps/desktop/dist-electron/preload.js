import { contextBridge } from 'electron';
/**
 * Typed preload API exposed to the renderer via contextBridge.
 * Extend this as platform adapters are added in later phases.
 */
const api = {
    platform: 'desktop',
};
contextBridge.exposeInMainWorld('vaporflow', api);
//# sourceMappingURL=preload.js.map