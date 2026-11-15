import { z } from 'zod';
import { readRows } from '../query.js';
import { SettingSchema } from '../types/schemas.js';
import type { DbAdapter } from '../db-adapter.js';
/** Local-only settings. */
export class SettingsRepo {
  constructor(private db: DbAdapter) {}
  async get(key: string): Promise<string | null> {
    z.string().min(1).parse(key);
    const rows = await readRows(
      this.db,
      SettingSchema,
      'SELECT key, value FROM settings WHERE key = ?',
      [key],
    );
    return rows[0]?.value ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    SettingSchema.parse({ key, value });
    await this.db.query(
      'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }
  async getAll(): Promise<Record<string, string>> {
    const rows = await readRows(this.db, SettingSchema, 'SELECT key,value FROM settings');
    return Object.fromEntries(
      rows.filter((row) => row.value !== null).map((row) => [row.key, row.value!]),
    );
  }
}
