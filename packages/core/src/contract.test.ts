import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { adapterContract, runMigrationFailureContract } from './testing/adapter-contract.js';
import { MIGRATIONS } from './migrations/data.js';

describe('SQLite adapter contract', () => {
  for (const test of adapterContract)
    it(test.name, async () => {
      const db = new SqliteTestAdapter();
      try {
        await test.run(db);
      } finally {
        db.close();
      }
    });
  it('rolls back a failed migration without journaling it', () =>
    runMigrationFailureContract((migrations) => {
      const db = new SqliteTestAdapter(':memory:', migrations);
      return { db, close: () => db.close() };
    }));
  it('bundles exactly the source migrations', () => {
    const directory = new URL('../migrations/', import.meta.url);
    const names = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(MIGRATIONS.map((m) => m.name)).toEqual(names);
    for (const migration of MIGRATIONS)
      expect(migration.sql).toBe(
        fs.readFileSync(new URL(migration.name, directory), 'utf8').replace(/\r\n/g, '\n'),
      );
  });
});
