/**
 * Settings repository (local-only key/value).
 */
import { DbAdapter } from '../db-adapter.js';

export class SettingsRepo {
  constructor(private db: DbAdapter) {}

  get(key: string): string | null {
    const rows = this.db.query<{ value: string | null }>(
      `SELECT value FROM settings WHERE key = ?`,
      [key]
    );
    return rows[0]?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db.query(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );
  }

  getAll(): Record<string, string> {
    const rows = this.db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM settings`
    );
    const result: Record<string, string> = {};
    for (const r of rows) {
      if (r.value !== null) {
        result[r.key] = r.value;
      }
    }
    return result;
  }
}
