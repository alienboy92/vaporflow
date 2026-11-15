import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildElectron(options = {}) {
  const common = {
    bundle: true,
    platform: 'node',
    target: 'node20',
    external: ['electron', 'better-sqlite3'],
    ...options,
  };
  await build({
    ...common,
    entryPoints: [path.join(root, 'src/main.ts')],
    outfile: path.join(root, 'dist-electron/main.js'),
    format: 'esm',
  });
  // Sandboxed preloads cannot use ESM or Node's createRequire banner.
  await build({
    ...common,
    entryPoints: [path.join(root, 'src/preload.ts')],
    outfile: path.join(root, 'dist-electron/preload.cjs'),
    format: 'cjs',
  });
}
