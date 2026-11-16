import { DbAdapter } from '../db-adapter.js';
import { SYNC_TABLES, MUTABLE_TABLES, SyncTransport } from './types.js';
import { wireToLocal, storageToWire } from './convert.js';

/**
 * Simulated sync server backed by SQLite, faithful to the Supabase
 * sync_push / sync_pull RPC semantics (supabase/migrations/00001_initial.sql,
 * proven against the real RPCs by postgres.test.ts with PGlite):
 *
 *  - push() accepts and pull() returns WIRE-format rows: PG booleans, any
 *    offset/precision timestamps, no `dirty` column. Storage conversion is
 *    done here, exactly as jsonb_populate_record casts the JSON into PG
 *    columns.
 *  - push() is batch-atomic like the real RPC: any rejected row RAISES, so
 *    the whole batch throws and nothing is written — there are no per-row
 *    error arrays.
 *  - Mutable tables use strict last-write-wins: EXCLUDED.updated_at >
 *    stored.updated_at. An equal or older row is acknowledged but NOT applied.
 *  - Ledger tables are insert-only idempotent (ON CONFLICT (id) DO NOTHING);
 *    a duplicate ledger row is acknowledged.
 *  - pull() orders by (server_updated_at, id) with a 1..500 limit.
 */
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
    const statements: { sql: string; params?: unknown[] }[] = [];
    const nowIso = new Date().toISOString();

    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error('Row must be an object');
      }
      const r = row as Record<string, unknown>;
      const id = r.id;
      const shopId = r.shop_id;
      if (typeof id !== 'string' || !id || typeof shopId !== 'string' || !shopId) {
        throw new Error(`Row missing id or shop_id: ${JSON.stringify(row).slice(0, 120)}`);
      }

      // Wire -> storage, exactly as jsonb_populate_record casts the JSON into
      // the table's columns: booleans cast to 0/1, timestamps normalize, and
      // the absent `dirty` column takes its default (0 here).
      const stored = wireToLocal(table, r);

      // Duplicate barcode conflicts raise in PostgreSQL via the partial
      // unique index; pre-checking here just produces a readable message.
      // Either way the whole batch is rejected before anything is written.
      if (table === 'variants' && stored.barcode && !stored.deleted_at) {
        const existing = await this.serverDb.query<{ id: string }>(
          `SELECT id FROM variants WHERE shop_id = ? AND barcode = ? AND id != ? AND deleted_at IS NULL`,
          [shopId, stored.barcode, id],
        );
        if (existing.length > 0) {
          throw new Error(
            `Duplicate barcode conflict: barcode ${String(stored.barcode)} already exists in shop (batch rejected, nothing was written)`,
          );
        }
      }

      if (mutable) {
        const keys = Object.keys(stored);
        const placeholders = keys.map(() => '?').join(', ');
        const updateSets = keys
          .filter((k) => k !== 'id' && k !== 'shop_id' && k !== 'created_at' && k !== 'device_id')
          .map((k) => `${k} = ?`)
          .join(', ');
        const updateValues = keys
          .filter((k) => k !== 'id' && k !== 'shop_id' && k !== 'created_at' && k !== 'device_id')
          .map((k) => stored[k]);

        const sql = `
          INSERT INTO ${table} (${keys.join(', ')}, server_updated_at)
          VALUES (${placeholders}, ?)
          ON CONFLICT(id) DO UPDATE SET
            ${updateSets},
            server_updated_at = ?
          WHERE excluded.updated_at > ${table}.updated_at AND ${table}.shop_id = excluded.shop_id
        `;
        statements.push({ sql, params: [...keys.map((k) => stored[k]), nowIso, ...updateValues, nowIso] });
      } else {
        const keys = Object.keys(stored);
        const placeholders = keys.map(() => '?').join(', ');
        const sql = `
          INSERT INTO ${table} (${keys.join(', ')}, server_updated_at)
          VALUES (${placeholders}, ?)
          ON CONFLICT(id) DO NOTHING
        `;
        statements.push({ sql, params: [...keys.map((k) => stored[k]), nowIso] });
      }
    }

    // The batch is a single transaction: a constraint violation (e.g. two
    // rows in the same batch sharing a barcode) throws and rolls back
    // everything, matching the real RPC's whole-batch rollback.
    if (statements.length > 0) {
      await this.serverDb.batch(statements);
    }

    // Stale mutable rows and duplicate ledger rows are acknowledged too,
    // exactly as the real RPC counts them.
    return { accepted: rows.length };
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

    const rows = await this.serverDb.query<Record<string, unknown>>(sql, params);
    // Mirror to_jsonb(t): the server never exposes the local-only dirty column.
    return rows.map((row) => storageToWire(table, row));
  }
}
