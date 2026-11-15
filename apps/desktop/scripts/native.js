import { rebuild } from '@electron/rebuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
export async function prepareNative() {
  await rebuild({
    buildPath: fileURLToPath(new URL('..', import.meta.url)),
    electronVersion: require('electron/package.json').version,
    onlyModules: ['better-sqlite3'],
    types: ['prod'],
  });
}
