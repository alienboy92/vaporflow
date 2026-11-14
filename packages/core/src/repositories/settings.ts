/**
 * Settings repository (local-only key/value).
 */
import { DbAdapter } from '../db-adapter.js';

export class SettingsRepo {
  constructor(private db: DbAdapter) {}

  async get(key: string): Promise<string | null> {
    const rows = await this.db.query<{ value: string | null }>(
      `SELECT value FROM settings WHERE key = ?`,
      [key]
    );
    return rows[0]?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );
  }

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.db.query<{ key: string; value: string | null }>(
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
