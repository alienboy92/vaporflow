import path from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { backupName } from '@bali-hub-pos/core';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import {
  applyMigrations,
  BatchSchema,
  StatementSchema,
  RowsSchema,
  MIGRATIONS,
  type MigrationRecord,
  type DbAdapter,
} from '@bali-hub-pos/core';

/** The production Electron adapter, also exercised by the Electron contract runner. */
export class ElectronDbAdapter implements DbAdapter {
  private readonly database: DatabaseSync;
  private migrating: Promise<void> | undefined;
  constructor(
    private readonly filename: string,
    private readonly migrations: readonly MigrationRecord[] = MIGRATIONS,
  ) {
    this.database = new DatabaseSync(filename);
    this.database.exec('PRAGMA journal_mode = WAL');
    this.database.exec('PRAGMA foreign_keys = ON');
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const input = StatementSchema.parse({ sql, params });
    const statement = this.database.prepare(input.sql);
    if (statement.columns().length) return RowsSchema.parse(statement.all(...input.params)) as T[];
    statement.run(...input.params);
    return [];
  }
  async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
    const inputs = BatchSchema.parse(statements);
    this.transaction(() => {
      for (const input of inputs) this.database.prepare(input.sql).run(...input.params);
    });
  }
  async backupForCloudChange(): Promise<string> {
    const directory = path.join(path.dirname(this.filename), 'backups');
    mkdirSync(directory,{recursive:true});
    const file = path.join(directory,backupName());
    if (existsSync(file)) throw Error('A backup with this time already exists. Try again in a second.');
    this.database.prepare('VACUUM INTO ?').run(file);
    const copy = new DatabaseSync(file,{readOnly:true});
    try {
      for (const table of ['products','sales']) {
        const sql = 'SELECT count(*) AS total FROM '+table;
        if(copy.prepare(sql).get()?.total !== this.database.prepare(sql).get()?.total) throw Error('Backup verification failed.');
      }
    } finally { copy.close(); }
    return file;
  }
  private transaction(write: () => void) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      write();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  migrate(): Promise<void> {
    this.migrating ??= applyMigrations(
      {
        query: (sql) => this.query(sql),
        beforeUpgrade: async () => {
          if (this.filename !== ':memory:') {
            await backup(this.database, this.filename + '.pre-upgrade-' + randomUUID() + '.sqlite');
          }
        },
        execute: async (sql) => {
          this.database.exec(sql);
        },
        apply: async (migration) => {
          this.transaction(() => {
            this.database.exec(migration.sql);
            this.database
              .prepare("INSERT INTO _migrations(name,applied_at) VALUES (?,datetime('now'))")
              .run(migration.name);
          });
        },
      },
      this.migrations,
    ).finally(() => {
      this.migrating = undefined;
    });
    return this.migrating;
  }
  close(): void {
    this.database.close();
  }
}
