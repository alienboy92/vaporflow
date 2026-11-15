import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
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
    const rows = Array.from({ length: 3 }, (_, i) => ({
      ...base(),
      name: `Category ${i}`,
      sort_order: i,
    }));
    await push('categories', rows);
    await pg.exec(
      "RESET ROLE; ALTER TABLE categories DISABLE TRIGGER tr_categories_server_updated_at; UPDATE categories SET server_updated_at = '2026-11-15T12:00:00Z'; ALTER TABLE categories ENABLE TRIGGER tr_categories_server_updated_at",
    );
    await identity(owner);
    const pull = async (timestamp: string | null, id: string | null) =>
      (
        await pg.query<{ data: { id: string; server_updated_at: string }[] }>(
          'SELECT sync_pull($1,$2,$3,$4,2) AS data',
          ['categories', shop, timestamp, id],
        )
      ).rows[0]!.data;
    const first = await pull(null, null);
    expect(first).toHaveLength(2);
    expect(first.map((row) => row.id)).toEqual(
      rows
        .map((row) => row.id)
        .sort()
        .slice(0, 2),
    );
    const last = first[1]!;
    const second = await pull(last.server_updated_at, last.id);
    expect(second).toHaveLength(1);
    expect(new Set([...first, ...second].map((row) => row.id)).size).toBe(3);
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
