import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { VersionedSync } from './sync/versioned.js';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import type { SyncTransport } from './sync/types.js';
import { uuidv7 } from './uuid.js';

describe('PostgreSQL migration and tenant security', () => {
  let pg: PGlite;
  const owner = uuidv7(),
    other = uuidv7(),
    shop = uuidv7(),
    otherShop = uuidv7();
  const time = '2026-11-15T12:00:00.000Z';
  const base = (id = uuidv7(), shopId = shop) => ({
    id,
    shop_id: shopId,
    created_at: time,
    updated_at: time,
    deleted_at: null,
    device_id: shopId,
  });
  async function identity(id: string | null) {
    await pg.exec('RESET ROLE');
    await pg.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
    await pg.exec('SET ROLE authenticated');
  }
  async function push(table: string, rows: unknown[]) {
    return pg.query('SELECT public.sync_push($1, $2::jsonb) AS count', [
      table,
      JSON.stringify(rows),
    ]);
  }
  async function denied(sql: string, params: unknown[] = []) {
    await pg.exec('SAVEPOINT rejected');
    try {
      await expect(pg.query(sql, params)).rejects.toThrow();
    } finally {
      await pg.exec('ROLLBACK TO SAVEPOINT rejected');
    }
  }
  async function catalog() {
    const product = {
      ...base(),
      category_id: null,
      name: 'Product',
      brand: null,
      notes: null,
      is_active: true,
    };
    const variant = {
      ...base(),
      product_id: product.id,
      name: 'Default',
      sku: null,
      barcode: '2000000000008',
      cost_price: 40,
      sale_price: 100,
      low_stock_threshold: null,
      track_stock: true,
      is_active: true,
    };
    await push('products', [product]);
    await push('variants', [variant]);
    return { product, variant };
  }
  beforeAll(async () => {
    pg = await PGlite.create();
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;`);
    await pg.exec(readFileSync('supabase/migrations/00001_initial.sql', 'utf8'));
    await pg.query('INSERT INTO auth.users VALUES ($1), ($2)', [owner, other]);
  }, 30000);
  afterAll(async () => {
    await pg?.close();
  });
  beforeEach(async () => {
    await pg.exec('BEGIN');
    await identity(owner);
    await pg.query('SELECT claim_shop($1)', [shop]);
    await identity(other);
    await pg.query('SELECT claim_shop($1)', [otherShop]);
    await identity(owner);
  });
  afterEach(async () => {
    await pg.exec('ROLLBACK; RESET ROLE');
  });

  async function upgrade() {
    await pg.exec('RESET ROLE');
    for (const file of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql') && !file.startsWith('00001')).sort()) {
      await pg.exec(readFileSync('supabase/migrations/' + file, 'utf8').replace(/^BEGIN;|COMMIT;\s*$/g, ''));
    }
    await identity(owner);
  }
  it('resolves edits from two offline SQLite devices through the real versioned SQL functions', async () => {
    await upgrade();
    const transport: SyncTransport = {
      push: async () => { throw new Error('Legacy push'); },
      pull: async (t,s,ts,id,n) => (await pg.query<{data:unknown[]}>('SELECT sync_pull($1,$2,$3,$4,$5) AS data',[t,s,ts,id,n])).rows[0]!.data,
      manifest: async (t,s,id,n) => (await pg.query('SELECT * FROM sync_manifest_v2($1,$2,$3,$4)',[t,s,id,n])).rows,
      fetchRows: async (t,s,ids) => (await pg.query<{data:unknown[]}>('SELECT sync_rows_v2($1,$2,$3) AS data',[t,s,ids])).rows[0]!.data,
      writeVersioned: async (t,rows) => (await pg.query<{data:unknown}>('SELECT sync_write_v2($1,$2) AS data',[t,JSON.stringify(rows)])).rows[0]!.data,
    };
    const a = new SqliteTestAdapter(), b = new SqliteTestAdapter();
    try {
      await a.migrate(); await b.migrate();
      const first = new VersionedSync(a,transport,shop), second = new VersionedSync(b,transport,shop);
      await first.run(); await second.run();
      expect(await a.query('SELECT id FROM shops')).toEqual([{id:shop}]);
      for(const mine of [true,false]) {
        await a.query("UPDATE shops SET name=?, dirty=1,updated_at='2026-11-15T13:00:00.000Z'", [mine?'A1':'A2']);
        await b.query("UPDATE shops SET name=?, dirty=1,updated_at='2026-11-15T11:00:00.000Z'", [mine?'B1':'B2']);
        await first.run(); await second.run();
        const issues = await second.problems();
        expect(issues).toHaveLength(1);
        expect(issues[0]!.kind).toBe('conflict');
        await second.resolve('shops',shop,issues[0]!.version!,mine);
        await second.run(); await first.run();
        expect(await a.query('SELECT name,dirty FROM shops')).toEqual([{name:mine?'B1':'A2',dirty:0}]);
        expect(await b.query('SELECT name,dirty FROM shops')).toEqual(await a.query('SELECT name,dirty FROM shops'));
      }
    } finally { a.close(); b.close(); }
  });
  it('replays offline stock movements once and refuses a changed ledger identity', async () => {
    const {variant} = await catalog();
    await upgrade();
    const movement = { ...base(), base_version:0, variant_id:variant.id,qty_change:5,type:'opening',ref_type:null,ref_id:null,unit_cost:null,note:null,occurred_at:time };
    const sql = "SELECT sync_write_v2('stock_movements',$1::jsonb)";
    await pg.query(sql,[JSON.stringify([movement])]);
    const second = {...movement,id:uuidv7(),device_id:uuidv7(),qty_change:-2,type:'sale'};
    await pg.query(sql,[JSON.stringify([second])]);
    await pg.query(sql,[JSON.stringify([second,movement])]);
    await denied(sql,[JSON.stringify([{...movement,qty_change:12}])]);
    expect((await pg.query('SELECT on_hand::int FROM v_stock_on_hand')).rows).toEqual([{on_hand:3}]);
    await denied("SELECT sync_push('stock_movements','[]')");
  });
  it('keeps stale edits and tombstones from winning under either clock skew', async () => {
    await upgrade();
    const row = { ...base(), name: 'Initial', sort_order: 1 };
    async function write(baseVersion: number, name: string, deleted: boolean, hour: number) {
      const payload = { ...row, name, deleted_at: deleted ? time : null,
        updated_at: new Date(Date.parse(time) + hour * 3600000).toISOString(), base_version: baseVersion };
      return (await pg.query<{result: {status: string, row: {row_version: number, name: string}}[]}>(
        "SELECT sync_write_v2('categories', $1::jsonb) AS result", [JSON.stringify([payload])]
      )).rows[0]!.result[0]!;
    }
    expect((await write(0,'Initial',false,1)).row.row_version).toBe(1);
    expect((await write(1,'Slow',false,-1)).row.row_version).toBe(2);
    expect((await write(1,'Fast',false,1)).status).toBe('conflict');
    expect((await write(1,'Fast',true,1)).status).toBe('conflict');
    expect((await write(2,'Slow',true,-1)).row.row_version).toBe(3);
    expect((await write(2,'Restore',false,1)).status).toBe('conflict');
    const manifest = await pg.query<{id: string, row_version: number}>("SELECT * FROM sync_manifest_v2('categories',$1,null,500)", [shop]);
    expect(manifest.rows).toEqual([{id: row.id,row_version:3}]);
    await identity(other);
    expect((await pg.query("SELECT * FROM sync_manifest_v2('categories',$1,null,500)", [shop])).rows).toEqual([]);
  });

  it('claims a new shop, is retry-safe, and accepts older real local details', async () => {
    expect(
      (await pg.query<{ claim_shop: boolean }>('SELECT claim_shop($1)', [shop])).rows[0]
        ?.claim_shop,
    ).toBe(true);
    const row = {
      ...base(shop),
      name: 'Real Shop',
      address: null,
      phone: null,
      logo_base64: null,
      show_logo_on_receipt: false,
      currency_code: 'PKR',
      currency_decimals: 0,
      receipt_footer: 'Thanks',
      default_low_stock_threshold: 3,
    };
    await push('shops', [row]);
    expect((await pg.query<{ name: string }>('SELECT name FROM shops')).rows).toEqual([
      { name: 'Real Shop' },
    ]);
    expect(
      (
        await pg.query<{ created_at: Date }>('SELECT created_at FROM shops')
      ).rows[0]?.created_at.toISOString(),
    ).toBe(time);
    await identity(other);
    expect(
      (await pg.query<{ claim_shop: boolean }>('SELECT claim_shop($1)', [shop])).rows[0]
        ?.claim_shop,
    ).toBe(false);
  });
  it('denies direct membership enrollment and all direct table writes', async () => {
    await denied('INSERT INTO shop_members(shop_id,user_id) VALUES ($1,$2)', [otherShop, owner]);
    await denied("UPDATE shops SET name = 'Tampered' WHERE id = $1", [shop]);
    await denied('DELETE FROM shops WHERE id = $1', [shop]);
  });
  it('rejects cross-shop ID collisions and foreign-key references', async () => {
    const { product } = await catalog();
    await identity(other);
    await denied('SELECT sync_push($1,$2::jsonb)', [
      'products',
      JSON.stringify([
        {
          ...product,
          shop_id: otherShop,
          name: 'Tampered',
          updated_at: '2026-11-16T00:00:00.000Z',
        },
      ]),
    ]);
    await denied('SELECT sync_push($1,$2::jsonb)', [
      'variants',
      JSON.stringify([
        {
          ...base(uuidv7(), otherShop),
          product_id: product.id,
          name: 'Default',
          cost_price: 1,
          sale_price: 2,
          track_stock: true,
          is_active: true,
        },
      ]),
    ]);
    await identity(owner);
    expect((await pg.query<{ name: string }>('SELECT name FROM products')).rows[0]?.name).toBe(
      'Product',
    );
  });
  it('applies last-write-wins including soft deletes', async () => {
    const row = { ...base(), name: 'A', sort_order: 0 };
    await push('categories', [row]);
    await push('categories', [
      {
        ...row,
        name: 'B',
        updated_at: '2026-11-16T00:00:00.000Z',
        deleted_at: '2026-11-16T00:00:00.000Z',
      },
    ]);
    await push('categories', [row]);
    const saved = (
      await pg.query<{ name: string; deleted_at: unknown }>(
        'SELECT name,deleted_at FROM categories',
      )
    ).rows[0];
    expect(saved?.name).toBe('B');
    expect(saved?.deleted_at).not.toBeNull();
  });
  it('keeps ledger pushes idempotent and blocks changes even through cascade paths', async () => {
    const { product, variant } = await catalog();
    const row = {
      ...base(),
      variant_id: variant.id,
      qty_change: 5,
      type: 'opening',
      ref_type: null,
      ref_id: null,
      unit_cost: null,
      note: null,
      occurred_at: time,
    };
    await push('stock_movements', [row]);
    await push('stock_movements', [{ ...row, qty_change: 99 }]);
    expect(
      (await pg.query<{ on_hand: number }>('SELECT on_hand::int FROM v_stock_on_hand')).rows[0]
        ?.on_hand,
    ).toBe(5);
    await denied('DELETE FROM stock_movements');
    await denied('UPDATE stock_movements SET qty_change = 99');
    await pg.exec('RESET ROLE');
    await denied('DELETE FROM products WHERE id = $1', [product.id]);
    await denied('UPDATE stock_movements SET qty_change = 99');
    await identity(other);
    expect((await pg.query('SELECT * FROM v_stock_on_hand')).rows).toEqual([]);
  });
  it('rolls back an entire failed push batch', async () => {
    const first = { ...base(), name: 'Valid', sort_order: 0 };
    await denied('SELECT sync_push($1,$2::jsonb)', [
      'categories',
      JSON.stringify([first, { ...base(), name: null }]),
    ]);
    expect((await pg.query('SELECT * FROM categories')).rows).toEqual([]);
  });
  it('paginates by timestamp and ID, includes tombstones, and scopes pulls', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      ...base(),
      name: `Category ${i}`,
      sort_order: i,
    }));
    for (let i = 0; i < rows.length; i += 200) await push('categories', rows.slice(i, i + 200));
    await pg.exec(
      "RESET ROLE; ALTER TABLE categories DISABLE TRIGGER tr_categories_server_updated_at; UPDATE categories SET server_updated_at = '2026-11-15T12:00:00.123456Z'; ALTER TABLE categories ENABLE TRIGGER tr_categories_server_updated_at",
    );
    await identity(owner);
    const pull = async (timestamp: string | null, id: string | null) =>
      (
        await pg.query<{ data: { id: string; server_updated_at: string }[] }>(
          'SELECT sync_pull($1,$2,$3,$4,500) AS data',
          ['categories', shop, timestamp, id],
        )
      ).rows[0]!.data;
    const first = await pull(null, null);
    expect(first).toHaveLength(500);
    expect(first.map((row) => row.id)).toEqual(
      rows
        .map((row) => row.id)
        .sort()
        .slice(0, 500),
    );
    const last = first[499]!;
    const second = await pull(last.server_updated_at, last.id);
    expect(second).toHaveLength(1);
    expect(new Set([...first, ...second].map((row) => row.id)).size).toBe(501);
    await identity(other);
    await denied('SELECT sync_pull($1,$2,NULL,NULL,500)', ['categories', shop]);
  });
  it('requires authentication and validates table names and batch/page limits', async () => {
    await denied('SELECT sync_push($1,$2::jsonb)', ['shop_members', '[]']);
    await denied('SELECT sync_push($1,$2::jsonb)', [
      'categories',
      JSON.stringify(Array(201).fill({})),
    ]);
    await denied('SELECT sync_pull($1,$2,NULL,NULL,501)', ['categories', shop]);
    await identity(null);
    await denied('SELECT claim_shop($1)', [uuidv7()]);
    await pg.exec('RESET ROLE; SET ROLE anon');
    await denied('SELECT claim_shop($1)', [uuidv7()]);
  });
});
