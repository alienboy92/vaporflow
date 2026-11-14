// Start Vite before launching the native Electron executable (no command shell).
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildElectron } from './electron-build.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.resolve(root, '../../packages/app');
const require = createRequire(import.meta.url);
const appRequire = createRequire(path.join(appRoot, 'package.json'));

async function main() {
  let electronPath;
  try {
    electronPath = require('electron');
    await access(electronPath);
  } catch (cause) {
    throw new Error(
      'Electron binary is missing. From the repo root run: pnpm --filter @vaporflow/desktop exec node node_modules/electron/install.js',
      { cause },
    );
  }
  await buildElectron({ sourcemap: true });
  console.log('[dev] Electron main/preload built');
  // Match the Vite CLI's working directory for PostCSS/Tailwind config lookup.
  process.chdir(appRoot);
  const viteEntry = path.join(
    path.dirname(appRequire.resolve('vite/package.json')),
    'dist/node/index.js',
  );
  const { createServer } = await import(pathToFileURL(viteEntry).href);
  const vite = await createServer({ root: appRoot, server: { host: true } });
  let electron;
  const stop = () => electron?.kill();
  try {
    await vite.listen();
    vite.printUrls();
    const env = { ...process.env, NODE_ENV: 'development' };
    if (env.ELECTRON_RUN_AS_NODE !== undefined) {
      console.log('[dev] Clearing ELECTRON_RUN_AS_NODE for Electron');
      delete env.ELECTRON_RUN_AS_NODE;
    }
    const entry = path.join(root, 'dist-electron', 'main.js');
    console.log(`[dev] Launching Electron: ${electronPath} ${entry}`);
    electron = spawn(electronPath, [entry], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      shell: false,
    });
    electron.stdout.on('data', (data) => process.stdout.write(`[electron] ${data}`));
    electron.stderr.on('data', (data) => process.stderr.write(`[electron:stderr] ${data}`));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await new Promise((resolve, reject) => {
      electron.once('spawn', () => console.log(`[dev] Electron PID ${electron.pid}`));
      electron.once('error', reject);
      electron.once('close', (code, signal) => {
        console.log(`[dev] Electron exited: code=${code}, signal=${signal ?? 'none'}`);
        process.exitCode = code ?? 1;
        resolve();
      });
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await vite.close();
  }
}
main().catch((error) => {
  console.error('[dev] Desktop launch failed:', error);
  process.exitCode = 1;
});
