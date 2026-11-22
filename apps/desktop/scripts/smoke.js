import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const executable = fileURLToPath(new URL('../out/win-unpacked/VaporFlow.exe', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'vaporflow-smoke-'));
async function launch() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [`--vaporflow-smoke-directory=${directory}`], {
      env,
      windowsHide: true,
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Packaged smoke timed out: ' + output));
    }, 60000);
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const result = output.match(/VAPORFLOW_SMOKE (\{[^\r\n]+\})/);
      if (code !== 0 || !result) reject(new Error(`Packaged app failed (${code}): ${output}`));
      else resolve(JSON.parse(result[1]));
    });
  });
}
assert.deepEqual(await launch(), {
  persisted: false,
  rolledBack: true,
  migrationsVerified: true,
  renderer: true,
});
assert.deepEqual(await launch(), {
  persisted: true,
  rolledBack: true,
  migrationsVerified: true,
  renderer: true,
});
console.log(
  'PASS: packaged renderer/preload/IPC, SQLite rollback, migration and restart persistence. Isolated data:',
  directory,
);
