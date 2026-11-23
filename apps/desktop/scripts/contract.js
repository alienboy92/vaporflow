import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
await build({
  entryPoints: [root + '/src/sqlite-contract.ts'],
  outfile: root + '/dist-electron/contract.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const child = spawn(require('electron'), [root + '/dist-electron/contract.cjs'], {
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
