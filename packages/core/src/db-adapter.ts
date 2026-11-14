/**
 * DbAdapter interface definition and SqliteTestAdapter implementation (better-sqlite3 in-memory).
 * Phase 1 correction: Made asynchronous to support Capacitor operations and Electron IPC.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';

export interface DbAdapter {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<void>;
  migrate(migrationsDir: string): Promise<void>;
}

/**
 * better-sqlite3 implementation for local SQLite (and unit tests in-memory).
 */
export class SqliteTestAdapter implements DbAdapter {
  private db: Database.Database;

  constructor(filename = ':memory:') {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    if (sql.trim().toLowerCase().startsWith('select') || sql.trim().toLowerCase().startsWith('with')) {
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

  async migrate(migrationsDir: string): Promise<void> {
    // Create _migrations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    if (!fs.existsSync(migrationsDir)) return;

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const applied = new Set(
      this.db
        .prepare(`SELECT name FROM _migrations`)
        .all()
        .map((row: unknown) => (row as { name: string }).name)
    );

    for (const file of files) {
      if (!applied.has(file)) {
        const filePath = `${migrationsDir}/${file}`;
        const sql = fs.readFileSync(filePath, 'utf-8');
        this.db.exec(sql);
        this.db
          .prepare(`INSERT INTO _migrations (name, applied_at) VALUES (?, datetime('now'))`)
          .run(file);
      }
    }
  }

  close(): void {
    this.db.close();
  }
}
