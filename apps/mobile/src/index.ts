import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite } from '@capacitor-community/sqlite';
import {
  adapterContract,
  runMigrationFailureContract,
} from '@vaporflow/core/testing/adapter-contract';
import { MIGRATIONS, type MigrationRecord } from '@vaporflow/core';
import { CapacitorDbAdapter } from './capacitor-adapter.js';
import {
  readDevelopmentDbCheck,
  runDevelopmentDbCheck,
  type DiagnosticsAdapter,
} from '@vaporflow/core';
import { capacitorShare } from './share.js';
export { CapacitorDbAdapter } from './capacitor-adapter.js';
export { Capacitor } from '@capacitor/core';
let primary: CapacitorDbAdapter | undefined;
let diagnostics: CapacitorDbAdapter | undefined;
async function runNativeContract(): Promise<string[]> {
  let counter = 0;
  const prefix = `vf_contract_${Date.now()}`;
  const factory = (migrations: readonly MigrationRecord[] = MIGRATIONS) => {
    const name = `${prefix}_${counter++}`;
    const db = new CapacitorDbAdapter(name, migrations);
    return {
      db,
      close: async () => {
        // Native deleteDatabase requires the connection to remain registered.
        try {
          await CapacitorSQLite.deleteDatabase({ database: name });
        } finally {
          await db.close();
        }
      },
    };
  };
  const passed: string[] = [];
  for (const test of adapterContract) {
    const handle = factory();
    try {
      await test.run(handle.db);
      passed.push(test.name);
    } catch (error) {
      throw new Error(`${test.name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await handle.close();
    }
  }
  await runMigrationFailureContract(factory);
  return [...passed, 'failed migration rollback and journal'];
}
export async function createMobileDatabase(enableDiagnostics: boolean) {
  if (Capacitor.getPlatform() !== 'android')
    throw new Error('Run this app in Electron or on Android. Browser SQLite is not configured.');
  primary ??= new CapacitorDbAdapter('vaporflow');
  await primary.migrate();
  let diagnosticAdapter: DiagnosticsAdapter | undefined;
  if (enableDiagnostics) {
    diagnostics ??= new CapacitorDbAdapter('vaporflow_diagnostics');
    await diagnostics.migrate();
    diagnosticAdapter = {
      read: () => readDevelopmentDbCheck(diagnostics!),
      createFixture: () => runDevelopmentDbCheck(diagnostics!),
      runContract: runNativeContract,
    };
  }
  return { db: primary, diagnostics: diagnosticAdapter, share: capacitorShare };
}
