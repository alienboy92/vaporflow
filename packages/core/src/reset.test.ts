import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { resetLocalDatabase } from './reset.js';
import { MIGRATIONS } from './migrations/data.js';

const TABLES = [
  'shops',
  'devices',
  'categories',
  'products',
  'variants',
  'expenses',
  'stock_movements',
  'sales',
  'sale_items',
  'returns',
  'return_items',
  'settings',
] as const;

describe('resetLocalDatabase', () => {
  let db: SqliteTestAdapter;

  beforeEach(async () => {
    db = new SqliteTestAdapter(':memory:');
    await db.migrate();
  });

  afterEach(() => {
    db.close();
  });

  async function seed(): Promise<void> {
    const now = new Date().toISOString();
    await db.batch([
      {
        sql: `INSERT INTO shops (id, shop_id, created_at, updated_at, device_id, name) VALUES (?, ?, ?, ?, ?, ?)`,
        params: ['shop-1', 'shop-1', now, now, 'device-1', 'Test Shop'],
      },
      {
        sql: `INSERT INTO devices (id, shop_id, created_at, updated_at, device_id, name, code) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: ['device-1', 'shop-1', now, now, 'device-1', 'Counter', 'PC1'],
      },
      {
        sql: `INSERT INTO settings (key, value) VALUES ('active_shop_id', 'shop-1'), ('pin_hash', 'x')`,
      },
      {
        sql: `INSERT INTO categories (id, shop_id, created_at, updated_at, device_id, name) VALUES (?, ?, ?, ?, ?, ?)`,
        params: ['cat-1', 'shop-1', now, now, 'device-1', 'Pods'],
      },
      {
        sql: `INSERT INTO products (id, shop_id, created_at, updated_at, device_id, name) VALUES (?, ?, ?, ?, ?, ?)`,
        params: ['product-1', 'shop-1', now, now, 'device-1', 'Pod Kit'],
      },
      {
        sql: `INSERT INTO variants (id, shop_id, product_id, cost_price, sale_price, created_at, updated_at, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: ['variant-1', 'shop-1', 'product-1', 100, 200, now, now, 'device-1'],
      },
      {
        sql: `INSERT INTO stock_movements (id, shop_id, created_at, updated_at, device_id, variant_id, qty_change, type, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: ['stock-1', 'shop-1', now, now, 'device-1', 'variant-1', 5, 'opening', now],
      },
      {
        sql: `INSERT INTO sales (id, shop_id, created_at, updated_at, device_id, receipt_no, sold_at, subtotal, total, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: ['sale-1', 'shop-1', now, now, 'device-1', 'PC1-000001', now, 200, 200, 'cash'],
      },
      {
        sql: `INSERT INTO sale_items (id, shop_id, created_at, updated_at, device_id, sale_id, variant_id, product_name, variant_name, qty, list_price, unit_price, unit_cost, net_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: ['sale-item-1', 'shop-1', now, now, 'device-1', 'sale-1', 'variant-1', 'Pod Kit', 'Default', 1, 200, 200, 100, 200],
      },
      {
        sql: `INSERT INTO returns (id, shop_id, created_at, updated_at, device_id, sale_id, returned_at, refund_amount, refund_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: ['return-1', 'shop-1', now, now, 'device-1', 'sale-1', now, 200, 'cash'],
      },
      {
        sql: `INSERT INTO return_items (id, shop_id, created_at, updated_at, device_id, return_id, sale_item_id, variant_id, qty, refund_amount, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: ['return-item-1', 'shop-1', now, now, 'device-1', 'return-1', 'sale-item-1', 'variant-1', 1, 200, 100],
      },
      {
        sql: `INSERT INTO expenses (id, shop_id, created_at, updated_at, device_id, expense_date, amount, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: ['expense-1', 'shop-1', now, now, 'device-1', now.slice(0, 10), 50, 'Rent'],
      },
    ]);
  }

  it('removes every seeded row and recreates the schema', async () => {
    await seed();
    await resetLocalDatabase(db);

    for (const table of TABLES) {
      const rows = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
      expect(rows[0]?.n, table).toBe(0);
    }

    const applied = await db.query<{ name: string }>(
      'SELECT name FROM _migrations ORDER BY name',
    );
    expect(applied.map((row) => row.name)).toEqual(MIGRATIONS.map((m) => m.name));

    const view = await db.query(
      `SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'v_stock_on_hand'`,
    );
    expect(view).toHaveLength(1);
  });

  it('restores ledger immutability triggers after the reset', async () => {
    await seed();
    await resetLocalDatabase(db);

    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO sales (id, shop_id, created_at, updated_at, device_id, receipt_no, sold_at, subtotal, total, payment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['sale-2', 'shop-1', now, now, 'device-1', 'PC1-000002', now, 100, 100, 'cash'],
    );

    await expect(db.query(`DELETE FROM sales WHERE id = 'sale-2'`)).rejects.toThrow(
      'Ledger rows are immutable',
    );
  });

  it('is safe to run twice', async () => {
    await seed();
    await resetLocalDatabase(db);
    await resetLocalDatabase(db);

    const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM shops');
    expect(rows[0]?.n).toBe(0);
  });
});
