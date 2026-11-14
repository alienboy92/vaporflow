// Dev script: starts Vite dev server for the app, then launches Electron.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const appRoot = path.resolve(root, '..', '..', 'packages', 'app');

async function buildElectron() {
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
    sourcemap: true,
    banner: {
      js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
  });
}

async function main() {
  // 1. Build Electron main/preload
  await buildElectron();
  console.log('[dev] Electron main/preload built');

  // 2. Start Vite dev server for packages/app
  const vite = spawn('npx', ['vite', '--host'], {
    cwd: appRoot,
    stdio: 'pipe',
    shell: true,
  });

  // Wait for Vite to be ready
  await new Promise((resolve) => {
    vite.stdout?.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(`[vite] ${text}`);
      if (text.includes('Local:')) resolve(undefined);
    });
    vite.stderr?.on('data', (data) => {
      process.stderr.write(`[vite-err] ${data}`);
    });
  });

  // 3. Launch Electron
  const require = createRequire(import.meta.url);
  const electronPath = require('electron');
  const electron = spawn(String(electronPath), [path.join(root, 'dist-electron', 'main.js')], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
    shell: true,
  });

  electron.on('close', () => {
    vite.kill();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
