/**
 * DbAdapter interface definition and SqliteTestAdapter implementation (better-sqlite3 in-memory).
 * Phase 1 & 2: Asynchronous contract, bundled portable migrations, transactional safety.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';

import type { DbAdapter } from '../db-adapter.js';
import { MIGRATIONS, type MigrationRecord } from '../migrations/data.js';

export class SqliteTestAdapter implements DbAdapter {
  private db: Database.Database;

  constructor(
    filename = ':memory:',
    private readonly migrations: readonly MigrationRecord[] = MIGRATIONS,
  ) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    if (stmt.reader) {
      return stmt.all(...params) as T[];
    } else {
      stmt.run(...params);
      return [] as T[];
    }
  }

  async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
    const runInTx = this.db.transaction((stmts: { sql: string; params?: unknown[] }[]) => {
      for (const s of stmts) {
        const stmt = this.db.prepare(s.sql);
        stmt.run(...(s.params || []));
      }
    });
    runInTx(statements);
  }

  async migrate(migrationsDir?: string): Promise<void> {
    // Create _migrations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    let migrationsToRun: readonly MigrationRecord[] = this.migrations;
    if (migrationsDir && fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      migrationsToRun = files.map((file) => ({
        name: file,
        sql: fs.readFileSync(`${migrationsDir}/${file}`, 'utf-8'),
      }));
    }

    const applied = new Set(
      this.db
        .prepare(`SELECT name FROM _migrations`)
        .all()
        .map((row: unknown) => (row as { name: string }).name),
    );

    for (const m of migrationsToRun) {
      if (!applied.has(m.name)) {
        const applyTx = this.db.transaction(() => {
          this.db.exec(m.sql);
          this.db
            .prepare(`INSERT INTO _migrations (name, applied_at) VALUES (?, datetime('now'))`)
            .run(m.name);
        });
        applyTx();
      }
    }
  }

  close(): void {
    this.db.close();
  }
}
