import { buildElectron } from './electron-build.js';
import { prepareNative } from './native.js';

await prepareNative();
await buildElectron({ minify: true });
console.log('[build] Electron main/preload built');
