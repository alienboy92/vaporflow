import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { MIGRATIONS, switchConnection } from '@vaporflow/core';
import {
  adapterContract,
  runMigrationFailureContract,
} from '@vaporflow/core/testing/adapter-contract';
import { ElectronDbAdapter } from './sqlite-adapter.js';
async function run(): Promise<void> {
  for (const test of adapterContract) {
    const db = new ElectronDbAdapter(':memory:');
    try {
      await test.run(db);
      console.log('PASS Electron: ' + test.name);
    } finally {
      db.close();
    }
  }
  await runMigrationFailureContract((migrations) => {
    const db = new ElectronDbAdapter(':memory:', migrations);
    return { db, close: () => db.close() };
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'vf-upgrade-'));
  const file = path.join(directory, 'shop.sqlite');
  const oldest = MIGRATIONS.slice(0, 1);
  const original = new ElectronDbAdapter(file, oldest);
  try {
    await original.migrate();
    await original.query("INSERT INTO settings(key,value) VALUES('upgrade-check','retained')");
  } finally { original.close(); }
  const latest = new ElectronDbAdapter(file);
  try {
    await latest.migrate();
    await latest.migrate();
    const snapshot=await switchConnection(latest,'https://example.invalid','sb_publishable_fixture','keep',()=>latest.backupForCloudChange());
    assert.ok(snapshot);
    assert.equal(path.dirname(snapshot),path.join(directory,'backups'));
    assert.match(path.basename(snapshot),/^vaporflow-backup-\d{4}-\d{2}-\d{2}-\d{6}$/);
    const readback=new ElectronDbAdapter(snapshot);
    try {
      assert.deepEqual(await readback.query("SELECT value FROM settings WHERE key='upgrade-check'"),[{value:'retained'}]);
      for(const table of ['products','sales']) assert.deepEqual(await readback.query('SELECT count(*) AS n FROM '+table),await latest.query('SELECT count(*) AS n FROM '+table));
    } finally { readback.close(); }
    console.log('PASS Electron: verified readable project-change backup and product/sale counts');
    assert.deepEqual(await latest.query("SELECT value FROM settings WHERE key='upgrade-check'"), [{ value: 'retained' }]);
  } finally { latest.close(); }
  const backups = (await readdir(directory)).filter(name => name.includes('.pre-upgrade-'));
  assert.equal(backups.length, 1);
  const backup = new ElectronDbAdapter(path.join(directory, backups[0]!), oldest);
  try {
    assert.deepEqual(await backup.query('SELECT name FROM _migrations'), [{ name: oldest[0]!.name }]);
    assert.deepEqual(await backup.query("SELECT value FROM settings WHERE key='upgrade-check'"), [{ value: 'retained' }]);
  } finally { backup.close(); }
  const olderApp = new ElectronDbAdapter(file, oldest);
  try { await assert.rejects(olderApp.migrate(), /Unsupported database/); }
  finally { olderApp.close(); }
  console.log('PASS Electron: oldest schema upgrade preserves records, backup and downgrade refusal');
  console.log('PASS Electron: failed migration rollback and journal');
}
void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
