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
  console.log('PASS Electron: failed migration rollback and journal');
}
void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
