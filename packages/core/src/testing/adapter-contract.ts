import type { DbAdapter } from '../db-adapter.js';
import { MIGRATIONS, type MigrationRecord } from '../migrations/data.js';
import { readDevelopmentDbCheck, runDevelopmentDbCheck } from '../dev-check.js';

type Factory = (migrations: readonly MigrationRecord[]) => {
  db: DbAdapter;
  close(): void | Promise<void>;
};
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function rejects(work: () => Promise<unknown>): Promise<void> {
  let failed = false;
  try {
    await work();
  } catch {
    failed = true;
  }
  check(failed, 'Expected operation to fail');
}
export const adapterContract = [
  {
    name: 'values, nulls, CTE reads and batch commit',
    run: async (db: DbAdapter) => {
      const rows = await db.query<{ text: string; empty: null; num: number }>(
        'WITH value AS (SELECT ? AS text, ? AS empty, ? AS num) SELECT * FROM value',
        ["O'Brien", null, 123],
      );
      check(
        rows.length === 1 &&
          rows[0]?.text === "O'Brien" &&
          rows[0]?.empty === null &&
          rows[0]?.num === 123,
        'Incorrect parameter round trip',
      );
      await db.batch([
        { sql: 'CREATE TABLE contract_rows (id INTEGER PRIMARY KEY, value TEXT)' },
        { sql: 'INSERT INTO contract_rows VALUES (?, ?)', params: [1, 'saved'] },
      ]);
      check((await db.query('SELECT * FROM contract_rows')).length === 1, 'Batch did not commit');
    },
  },
  {
    name: 'middle-statement failure rolls back the whole batch',
    run: async (db: DbAdapter) => {
      await db.query('CREATE TABLE contract_rows (id INTEGER PRIMARY KEY)');
      await rejects(() =>
        db.batch([
          { sql: 'INSERT INTO contract_rows VALUES (1)' },
          { sql: 'INSERT INTO missing_contract_table VALUES (2)' },
          { sql: 'INSERT INTO contract_rows VALUES (3)' },
        ]),
      );
      check(
        (await db.query('SELECT * FROM contract_rows')).length === 0,
        'Partial batch was committed',
      );
      await db.batch([{ sql: 'INSERT INTO contract_rows VALUES (4)' }]);
      check(
        (await db.query('SELECT * FROM contract_rows')).length === 1,
        'Connection did not recover',
      );
    },
  },
  {
    name: 'migration order, idempotence, foreign keys and triggers',
    run: async (db: DbAdapter) => {
      await Promise.all([db.migrate(), db.migrate()]);
      await db.migrate();
      const rows = await db.query<{ name: string }>('SELECT name FROM _migrations ORDER BY name');
      check(
        JSON.stringify(rows.map((row) => row.name)) ===
          JSON.stringify(MIGRATIONS.map((m) => m.name)),
        'Migration journal mismatch',
      );
      check(
        (await db.query<{ foreign_keys: number }>('PRAGMA foreign_keys'))[0]?.foreign_keys === 1,
        'Foreign keys disabled',
      );
      check(
        (await db.query("SELECT name FROM sqlite_master WHERE type = 'trigger'")).length > 0,
        'Migration triggers missing',
      );
    },
  },
  {
    name: 'isolated fixture is explicit, repeatable and readable after creation',
    run: async (db: DbAdapter) => {
      await db.migrate();
      check(!(await readDevelopmentDbCheck(db)).exists, 'Fixture created automatically');
      await runDevelopmentDbCheck(db);
      const result = await runDevelopmentDbCheck(db);
      check(
        result.exists && result.productCount === 1 && result.variantCount === 1,
        'Fixture was duplicated',
      );
      check(
        (await readDevelopmentDbCheck(db)).readBackName === 'Fixture Variant',
        'Fixture read failed',
      );
    },
  },
];

export async function runMigrationFailureContract(factory: Factory): Promise<void> {
  const handle = factory([
    { name: '001_good.sql', sql: 'CREATE TABLE committed (id INTEGER);' },
    {
      name: '002_bad.sql',
      sql: 'CREATE TABLE must_rollback (id INTEGER); INSERT INTO missing_table VALUES (1);',
    },
  ]);
  try {
    await rejects(() => handle.db.migrate());
    check(
      (await handle.db.query("SELECT name FROM sqlite_master WHERE name = 'must_rollback'"))
        .length === 0,
      'Failed migration left a table',
    );
    const rows = await handle.db.query<{ name: string }>('SELECT name FROM _migrations');
    check(rows.length === 1 && rows[0]?.name === '001_good.sql', 'Failed migration was journaled');
    await rejects(() => handle.db.migrate());
  } finally {
    await handle.close();
  }
}
