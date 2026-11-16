import { DbAdapter } from '../db-adapter.js';
import { SYNC_TABLES, MUTABLE_TABLES, SyncTransport } from './types.js';

export class SQLiteSyncServer implements SyncTransport {
  constructor(private serverDb: DbAdapter) {}

  async push(
    table: string,
    rows: unknown[],
  ): Promise<{ accepted: number; errors?: Array<{ id: string; error: string }> }> {
    if (!SYNC_TABLES.includes(table as (typeof SYNC_TABLES)[number])) {
      throw new Error(`Invalid table: ${table}`);
    }
    if (!Array.isArray(rows) || rows.length > 200) {
      throw new Error('Rows must be an array of at most 200 items');
    }

    const mutable = MUTABLE_TABLES.has(table);
    let accepted = 0;
    const errors: Array<{ id: string; error: string }> = [];

    const statements: { sql: string; params?: unknown[] }[] = [];

    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        continue;
      }
      const r = row as Record<string, unknown>;
      const id = r.id as string;
      const shopId = r.shop_id as string;
      if (!id || !shopId) {
        errors.push({ id: String(id ?? 'unknown'), error: 'Missing id or shop_id' });
        continue;
      }

      if (table === 'variants' && r.barcode && !r.deleted_at) {
        const existingBarcode = await this.serverDb.query<{ id: string }>(
          `SELECT id FROM variants WHERE shop_id = ? AND barcode = ? AND id != ? AND deleted_at IS NULL`,
          [shopId, r.barcode, id],
        );
        if (existingBarcode.length > 0) {
          errors.push({
            id,
            error: `Duplicate barcode conflict: barcode ${r.barcode} already exists in shop`,
          });
          continue;
        }
      }

      const nowIso = new Date().toISOString();

      if (mutable) {
        const keys = Object.keys(r).filter(
          (k) => k !== 'dirty' && k !== 'server_updated_at',
        );
        const placeholders = keys.map(() => '?').join(', ');
        const updateSets = keys
          .filter((k) => k !== 'id' && k !== 'shop_id' && k !== 'created_at' && k !== 'device_id')
          .map((k) => `${k} = ?`)
          .join(', ');

        const values = keys.map((k) => r[k]);
        const updateValues = keys
          .filter((k) => k !== 'id' && k !== 'shop_id' && k !== 'created_at' && k !== 'device_id')
          .map((k) => r[k]);

        const sql = `
          INSERT INTO ${table} (${keys.join(', ')}, server_updated_at)
          VALUES (${placeholders}, ?)
          ON CONFLICT(id) DO UPDATE SET
            ${updateSets},
            server_updated_at = ?
          WHERE excluded.updated_at >= ${table}.updated_at AND ${table}.shop_id = excluded.shop_id
        `;
        const params = [...values, nowIso, ...updateValues, nowIso];
        statements.push({ sql, params });
      } else {
        const keys = Object.keys(r).filter(
          (k) => k !== 'dirty' && k !== 'server_updated_at',
        );
        const placeholders = keys.map(() => '?').join(', ');
        const values = keys.map((k) => r[k]);

        const sql = `
          INSERT INTO ${table} (${keys.join(', ')}, server_updated_at)
          VALUES (${placeholders}, ?)
          ON CONFLICT(id) DO NOTHING
        `;
        statements.push({ sql, params: [...values, nowIso] });
      }
      accepted++;
    }

    if (statements.length > 0) {
      try {
        await this.serverDb.batch(statements);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Server push batch failed: ${message}`);
      }
    }

    return { accepted, errors: errors.length > 0 ? errors : undefined };
  }

  async pull(
    table: string,
    shopId: string,
    timestamp: string | null,
    id: string | null,
    limit = 500,
  ): Promise<unknown[]> {
    if (!SYNC_TABLES.includes(table as (typeof SYNC_TABLES)[number])) {
      throw new Error(`Invalid table: ${table}`);
    }
    if (limit < 1 || limit > 500) {
      throw new Error('Limit must be between 1 and 500');
    }
    if ((timestamp === null) !== (id === null)) {
      throw new Error('Both cursor timestamp and id must be provided or both null');
    }

    let sql = `SELECT * FROM ${table} WHERE shop_id = ?`;
    const params: unknown[] = [shopId];

    if (timestamp !== null && id !== null) {
      sql += ` AND (server_updated_at, id) > (?, ?)`;
      params.push(timestamp, id);
    }

    sql += ` ORDER BY server_updated_at ASC, id ASC LIMIT ?`;
    params.push(limit);

    return this.serverDb.query(sql, params);
  }
}
