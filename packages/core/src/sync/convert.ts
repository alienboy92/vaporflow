/**
 * Wire conversion between local rows and the Supabase PostgreSQL wire format.
 *
 * The sync_push / sync_pull RPCs (supabase/migrations/00001_initial.sql) speak
 * a PostgreSQL-shaped JSON dialect:
 *  - BOOLEAN columns (shops.show_logo_on_receipt, products.is_active,
 *    variants.track_stock / is_active, return_items.restocked) arrive as
 *    true/false; local SQLite stores 0/1.
 *  - timestamptz columns serialize with offsets and microsecond precision
 *    (e.g. `2026-11-15T12:00:00.123456+00:00`); local rows store exactly-3ms
 *    UTC ISO strings.
 *  - pulled rows have no `dirty` column (dirty is local-only state) and no
 *    server-managed `server_updated_at` should ever be pushed back up.
 *
 * Every row crossing the transport boundary goes through this module, so the
 * engine and the local Zod schemas only ever see local shape.
 */

/** Columns that are PostgreSQL BOOLEAN on the wire, stored as 0/1 locally. */
export const BOOLEAN_COLUMNS: Record<string, readonly string[]> = {
  shops: ['show_logo_on_receipt'],
  products: ['is_active'],
  variants: ['track_stock', 'is_active'],
  return_items: ['restocked'],
};

/** Timestamp columns as they appear across the synced tables. */
const TIMESTAMP_COLUMNS = new Set([
  'created_at',
  'updated_at',
  'deleted_at',
  'server_updated_at',
  'last_seen_at',
  'occurred_at',
  'sold_at',
  'returned_at',
]);

/**
 * Normalize any ISO-ish timestamp (any precision, any offset) to an
 * exactly-3-millisecond UTC ISO string. Sub-millisecond precision is
 * truncated, never rounded, so a normalized local value can never sort
 * strictly after the server's own stored value for the same instant.
 */
export function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid timestamp: ${JSON.stringify(value)}`);
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return new Date(Math.floor(date.getTime())).toISOString();
}

function booleanToInt(value: unknown, column: string): number {
  if (value === true) return 1;
  if (value === false) return 0;
  if (value === 0 || value === 1) return value;
  throw new Error(`Invalid boolean value for ${column}: ${JSON.stringify(value)}`);
}

function intToBoolean(value: unknown, column: string): boolean {
  if (value === 1) return true;
  if (value === 0) return false;
  if (value === true || value === false) return value;
  throw new Error(`Invalid boolean value for ${column}: ${JSON.stringify(value)}`);
}

/**
 * Local row (SQLite shape, dirty/server_updated_at present) -> wire row
 * (PostgreSQL JSON shape, accepted by sync_push). Drops `dirty` (PG has no
 * such column) and `server_updated_at` (the trigger owns it server-side);
 * converts boolean columns to true/false.
 */
export function toWire(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'dirty' || key === 'server_updated_at') continue;
    if (TIMESTAMP_COLUMNS.has(key)) {
      out[key] = value === null ? null : normalizeTimestamp(value);
      continue;
    }
    if ((BOOLEAN_COLUMNS[table] ?? []).includes(key)) {
      out[key] = intToBoolean(value, key);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Wire row (as returned by sync_pull) -> local-shaped row ready for the
 * local Zod schemas. Converts booleans to 0/1, normalizes every timestamp to
 * 3ms UTC, and injects `dirty: 0` — the value the upsert statements write
 * when the row is applied locally.
 */
export function wireToLocal(table: string, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (TIMESTAMP_COLUMNS.has(key)) {
      out[key] = value === null ? null : normalizeTimestamp(value);
      continue;
    }
    if ((BOOLEAN_COLUMNS[table] ?? []).includes(key)) {
      out[key] = booleanToInt(value, key);
      continue;
    }
    out[key] = value;
  }
  out.dirty = 0;
  return out;
}

/**
 * Simulated-server storage row (local SQLite shape) -> wire row, mirroring
 * what `to_jsonb(t)` returns in sync_pull: no `dirty` column, PG booleans.
 * Timestamps were normalized on the way in, so they pass through.
 */
export function storageToWire(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'dirty') continue;
    if ((BOOLEAN_COLUMNS[table] ?? []).includes(key)) {
      out[key] = intToBoolean(value, key);
      continue;
    }
    out[key] = value;
  }
  return out;
}
