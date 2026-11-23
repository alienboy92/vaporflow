import { z } from 'zod';
import { MIGRATIONS, type MigrationRecord } from './data.js';

export interface MigrationDriver {
  query(sql: string): Promise<unknown>;
  execute(sql: string): Promise<void>;
  beforeUpgrade?(): Promise<void>;
  /** Execute the entire SQL script and journal insertion in one transaction. */
  apply(migration: MigrationRecord): Promise<void>;
}

export async function applyMigrations(
  driver: MigrationDriver,
  migrations: readonly MigrationRecord[] = MIGRATIONS,
): Promise<void> {
  const names = migrations.map((m) => m.name);
  if (
    new Set(names).size !== names.length ||
    names.some((name, i) => name !== [...names].sort()[i])
  ) {
    throw new Error('Migrations must have unique names in ascending order');
  }
  await driver.execute(
    'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const rows = z
    .array(z.object({ name: z.string() }))
    .parse(await driver.query('SELECT name FROM _migrations'));
  const applied = new Set(rows.map((row) => row.name));
  if (rows.some(({ name }) => !names.slice(0, applied.size).includes(name))) {
    throw new Error("Unsupported database migration history. Update VaporFlow before opening this shop.");
  }
  if (applied.size > 0 && applied.size < migrations.length) await driver.beforeUpgrade?.();
  for (const migration of migrations)
    if (!applied.has(migration.name)) await driver.apply(migration);
}
