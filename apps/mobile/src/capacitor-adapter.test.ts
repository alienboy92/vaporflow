import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { MIGRATIONS, type MigrationRecord } from '@bali-hub-pos/core';
import {
  adapterContract,
  runMigrationFailureContract,
} from '@bali-hub-pos/core/testing/adapter-contract';
import { CapacitorDbAdapter, type MobileConnection } from './capacitor-adapter.js';

// Plugin API double backed by SQLite; native device acceptance remains separate.
function factory(migrations: readonly MigrationRecord[] = MIGRATIONS) {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  let opens = 0;
  const connection: MobileConnection = {
    async query(sql, params = []) {
      return { values: sqlite.prepare(sql).all(...params) };
    },
    async run(sql, params = []) {
      const result = sqlite.prepare(sql).run(...params);
      return { changes: { changes: result.changes } };
    },
    async execute(sql) {
      sqlite.exec(sql);
      return { changes: { changes: 0 } };
    },
    async executeTransaction(tasks) {
      sqlite.exec('BEGIN');
      try {
        for (const task of tasks) {
          await Promise.resolve();
          if (task.values?.length) sqlite.prepare(task.statement).run(...task.values);
          else sqlite.exec(task.statement);
        }
        sqlite.exec('COMMIT');
        return { changes: { changes: 0 } };
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const db = new CapacitorDbAdapter('test', migrations, async () => {
    opens++;
    return {
      db: connection,
      close: async () => {
        sqlite.close();
      },
    };
  });
  return { db, close: () => db.close(), opens: () => opens };
}
describe('Capacitor adapter using SQLite-backed plugin double', () => {
  for (const test of adapterContract)
    it(test.name, async () => {
      const handle = factory();
      try {
        await test.run(handle.db);
      } finally {
        await handle.close();
      }
    });
  it('rolls back a failed migration including its journal entry', () =>
    runMigrationFailureContract(factory));
  it('serializes overlapping calls and recovers after a transaction failure', async () => {
    const handle = factory();
    try {
      await handle.db.query('CREATE TABLE test (id INTEGER PRIMARY KEY)');
      const failed = handle.db.batch([
        { sql: 'INSERT INTO test VALUES (1)' },
        { sql: 'INSERT INTO missing VALUES (1)' },
      ]);
      const pendingRead = handle.db.query('SELECT * FROM test');
      await expect(failed).rejects.toThrow();
      expect(await pendingRead).toEqual([]);
      expect(handle.opens()).toBe(1);
    } finally {
      await handle.close();
    }
  });
});
