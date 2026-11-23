import { buildElectron } from './electron-build.js';

await buildElectron({ minify: true });
console.log('[build] Electron main/preload built');
