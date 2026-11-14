// Build Electron main/preload for production.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await build({
  entryPoints: [
    path.join(root, 'src', 'main.ts'),
    path.join(root, 'src', 'preload.ts'),
  ],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outdir: path.join(root, 'dist-electron'),
  format: 'esm',
  external: ['electron'],
  minify: true,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});

console.log('[build] Electron main/preload built');
