import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SqliteTestAdapter } from '../testing/sqlite-test-adapter.js';
import { SyncEngine } from './engine.js';
import type { SyncTransport } from './types.js';
import { uuidv7 } from '../uuid.js';

let db: SqliteTestAdapter;
const shop = uuidv7();
const stamp = '2026-11-20T00:00:00.000Z';
const row = {
  id: shop,
  shop_id: shop,
  device_id: shop,
  name: 'Shop',
  address: '',
  phone: '',
  logo_base64: null,
  show_logo_on_receipt: false,
  currency_code: 'PKR',
  currency_decimals: 0,
  receipt_footer: 'Thanks',
  default_low_stock_threshold: 3,
  created_at: stamp,
  updated_at: stamp,
  deleted_at: null,
  server_updated_at: stamp,
  row_version: 1,
};
let directory: string;
beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'vf-quarantine-'));
  db = new SqliteTestAdapter(path.join(directory, 'scratch.sqlite'));
  await db.migrate();
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
function engine(remote: typeof row, page: boolean) {
  const transport = {
    push: async () => ({ accepted: 0 }),
    writeVersioned: async () => [],
    pull: async (table: string) => (table === 'shops' && page ? [remote] : []),
    manifest: async (table: string) => (table === 'shops' ? [{ id: shop, row_version: 1 }] : []),
    fetchRows: async () => [remote],
  };
  return new SyncEngine(
    db,
    transport satisfies SyncTransport,
    { isOnline: () => true, onChange: () => () => {} },
    shop,
  );
}
it('heals a committed row older than the overlap via the startup manifest', async () => {
  await db.query(
    "INSERT INTO settings VALUES('sync_cursor_shops_timestamp','2026-11-22T00:00:00.000Z')",
  );
  await db.query("INSERT INTO settings VALUES('sync_cursor_shops_id',?)", [shop]);
  await engine(row, false).syncNow();
  expect(await db.query('SELECT name FROM shops')).toEqual([{ name: 'Shop' }]);
});
it('keeps an invalid payload with its cursor and exposes it to a restarted engine', async () => {
  const invalid = { ...row, currency_decimals: -1 };
  await engine(invalid, true).syncNow();
  db.close();
  db = new SqliteTestAdapter(path.join(directory, 'scratch.sqlite'));
  const pending = await engine(invalid, false).getStatus();
  expect(pending.problems.some((p) => p.table === 'shops' && p.id === shop)).toBe(true);
  expect(await db.query("SELECT value FROM settings WHERE key='sync_cursor_shops_id'")).toEqual([
    { value: shop },
  ]);
});

it('recovers a late commit within ten minutes without moving the watermark backwards, then reconciles at 24 hours', async () => {
  const high = '2026-11-22T00:00:00.000Z';
  const late = '2026-11-21T23:54:00.000Z';
  let now = Date.parse(high);
  let remote = { ...row, server_updated_at: high };
  let manifests = 0;
  const transport: SyncTransport = {
    push: async () => ({ accepted: 0 }),
    writeVersioned: async () => [],
    manifest: async (t) => {
      if (t !== 'shops') return [];
      manifests++;
      return [{ id: shop, row_version: remote.row_version }];
    },
    fetchRows: async () => [remote],
    pull: async (t, _s, ts) =>
      t === 'shops' && (!ts || remote.server_updated_at > ts) ? [remote] : [],
  };
  const instance = new SyncEngine(
    db,
    transport,
    { isOnline: () => true, onChange: () => () => {} },
    shop,
    { clock: () => new Date(now) },
  );
  await instance.syncNow();
  remote = { ...remote, name: 'Late', row_version: 2, server_updated_at: late };
  await instance.syncNow();
  expect(await db.query('SELECT name FROM shops')).toEqual([{ name: 'Late' }]);
  expect(
    await db.query("SELECT value FROM settings WHERE key='sync_cursor_shops_timestamp'"),
  ).toEqual([{ value: high }]);
  remote = { ...remote, name: 'Old commit', row_version: 3, server_updated_at: stamp };
  now += 86400000 - 1;
  await instance.syncNow();
  expect(manifests).toBe(1);
  now++;
  await instance.syncNow();
  expect(manifests).toBe(2);
  expect(await db.query('SELECT name FROM shops')).toEqual([{ name: 'Old commit' }]);
});
it('rolls back cursor advancement when SQLite cannot persist a rejection', async () => {
  await db.query(
    "CREATE TRIGGER no_quarantine BEFORE INSERT ON sync_attention BEGIN SELECT RAISE(ABORT, 'interrupted'); END",
  );
  const failing = engine({ ...row, currency_decimals: -1 }, true);
  try {
    await expect(failing.syncNow()).rejects.toThrow('interrupted');
  } finally {
    failing.stop();
  }
  expect(await db.query("SELECT * FROM settings WHERE key LIKE 'sync_cursor_shops_%'")).toEqual([]);
  await db.query('DROP TRIGGER no_quarantine');
  await engine({ ...row, currency_decimals: -1 }, true).syncNow();
  expect(await db.query('SELECT version FROM sync_attention')).toEqual([{ version: 1 }]);
});
it('keeps an unaddressable pull payload before refusing the cursor', async () => {
  const transport: SyncTransport = {
    push: async () => ({ accepted: 0 }),
    writeVersioned: async () => [],
    manifest: async () => [],
    fetchRows: async () => [],
    pull: async (table) => (table === 'shops' ? [null] : []),
  };
  const instance = new SyncEngine(
    db,
    transport,
    { isOnline: () => true, onChange: () => () => {} },
    shop,
  );
  try {
    await expect(instance.syncNow()).rejects.toThrow();
  } finally {
    instance.stop();
  }
  expect(await db.query('SELECT kind,payload FROM sync_attention')).toEqual([
    { kind: 'quarantine', payload: 'null' },
  ]);
  expect(await db.query("SELECT * FROM settings WHERE key='sync_cursor_shops_timestamp'")).toEqual(
    [],
  );
});
