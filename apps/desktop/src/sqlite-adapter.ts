import Database from 'better-sqlite3';
import {
  applyMigrations,
  BatchSchema,
  StatementSchema,
  RowsSchema,
  MIGRATIONS,
  type MigrationRecord,
  type DbAdapter,
} from '@vaporflow/core';

/** The production Electron adapter, also exercised by the Electron contract runner. */
export class ElectronDbAdapter implements DbAdapter {
  private readonly database: Database.Database;
  private migrating: Promise<void> | undefined;
  constructor(
    filename: string,
    private readonly migrations: readonly MigrationRecord[] = MIGRATIONS,
  ) {
    this.database = new Database(filename);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const input = StatementSchema.parse({ sql, params });
    const statement = this.database.prepare(input.sql);
    if (statement.reader) return RowsSchema.parse(statement.all(...input.params)) as T[];
    statement.run(...input.params);
    return [];
  }
  async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
    const inputs = BatchSchema.parse(statements);
    this.database.transaction(() => {
      for (const input of inputs) this.database.prepare(input.sql).run(...input.params);
    })();
  }
  migrate(): Promise<void> {
    this.migrating ??= applyMigrations(
      {
        query: (sql) => this.query(sql),
        execute: async (sql) => {
          this.database.exec(sql);
        },
        apply: async (migration) => {
          this.database.transaction(() => {
            this.database.exec(migration.sql);
            this.database
              .prepare("INSERT INTO _migrations(name,applied_at) VALUES (?,datetime('now'))")
              .run(migration.name);
          })();
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
