import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import type { DbAdapter } from './db-adapter.js';
import { ProductRepo } from './repositories/product.js';
import { SaleRepo } from './repositories/sale.js';
import { ReturnRepo } from './repositories/return.js';
import { StockRepo } from './repositories/stock.js';
import { ReportRepo } from './repositories/report.js';
import { allocateDiscount, calcRefundAmount, parseMoney, formatMoney } from './money.js';
import { IdSchema, TimestampSchema } from './types/schemas.js';
import { uuidv7 } from './uuid.js';
import { reportRange } from './dates.js';

describe('Phase 1 regression coverage', () => {
  let db: SqliteTestAdapter;
  let shop: string, device: string, variant: string;
  const time = '2026-11-15T12:00:00.000Z';
  const input = (qty = 2) => ({
    shop_id: shop,
    device_id: device,
    receipt_no: 'PC-000001',
    sold_at: time,
    payment_method: 'cash' as const,
    amount_received: null,
    discount_amount: 0,
    note: null,
    lines: [
      {
        variant_id: variant,
        product_name: 'Product',
        variant_name: 'Default',
        qty,
        list_price: 100,
        unit_price: 100,
      },
    ],
  });
  async function sell(qty = 2, adapter: DbAdapter = db) {
    return new SaleRepo(adapter).completeSale(input(qty), uuidv7(), [uuidv7()], [uuidv7()], time);
  }
  const retInput = (saleId: string, itemId: string, qty = 1, restocked = true) => ({
    shop_id: shop,
    device_id: device,
    sale_id: saleId,
    returned_at: time,
    refund_method: 'cash' as const,
    note: null,
    lines: [{ sale_item_id: itemId, variant_id: variant, qty, restocked }],
  });
  async function returnSale(value: ReturnType<typeof retInput>, adapter: DbAdapter = db) {
    return new ReturnRepo(adapter).processReturn(
      value,
      uuidv7(),
      value.lines.map(() => uuidv7()),
      value.lines.map(() => uuidv7()),
      time,
    );
  }
  const failingAdapter = (): DbAdapter => ({
    query: db.query.bind(db),
    migrate: db.migrate.bind(db),
    batch: (statements) =>
      db.batch([...statements, { sql: 'INSERT INTO missing_table VALUES (1)' }]),
  });
  beforeEach(async () => {
    db = new SqliteTestAdapter();
    await db.migrate('packages/core/migrations');
    shop = uuidv7();
    device = uuidv7();
    variant = uuidv7();
    const product = uuidv7();
    await db.query(
      'INSERT INTO shops(id,shop_id,name,created_at,updated_at,device_id) VALUES (?,?,?,?,?,?)',
      [shop, shop, 'Shop', time, time, device],
    );
    await new ProductRepo(db).saveProduct({
      id: product,
      shop_id: shop,
      category_id: null,
      name: 'Product',
      brand: null,
      notes: null,
      is_active: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: device,
      dirty: 1,
      server_updated_at: null,
    });
    await new ProductRepo(db).saveVariant({
      id: variant,
      shop_id: shop,
      product_id: product,
      name: 'Default',
      sku: null,
      barcode: null,
      cost_price: 40,
      sale_price: 100,
      low_stock_threshold: null,
      track_stock: 1,
      is_active: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: device,
      dirty: 1,
      server_updated_at: null,
    });
  });
  afterEach(() => db.close());

  it('conserves discount totals over many small carts, with remainder only on last line', () => {
    for (let a = 0; a < 6; a++)
      for (let b = 0; b < 6; b++)
        for (let c = 0; c < 6; c++) {
          const values = [a, b, c];
          const gross = a + b + c;
          for (let discount = 0; discount <= gross; discount++) {
            const nets = allocateDiscount(
              values.map((unit_price) => ({ unit_price, qty: 1 })),
              discount,
            );
            expect(nets.reduce((sum, n) => sum + n, 0)).toBe(gross - discount);
            if (gross)
              expect(nets.slice(0, 2)).toEqual([
                a - Math.round((a * discount) / gross),
                b - Math.round((b * discount) / gross),
              ]);
          }
        }
    expect(
      allocateDiscount(
        [1, 1, 1, 1, 1].map((unit_price) => ({ unit_price, qty: 1 })),
        3,
      ),
    ).toEqual([0, 0, 0, 0, 2]);
    expect(
      allocateDiscount(
        [1, 1, 1, 1, 1, 0].map((unit_price) => ({ unit_price, qty: 1 })),
        2,
      ),
    ).toEqual([1, 1, 1, 1, 1, -2]);
  });
  it('parses and rounds exactly, rejects malformed money and overflow', () => {
    expect(parseMoney('1.005', 2)).toBe(101);
    expect(parseMoney('PKR 1,500')).toBe(1500);
    expect(formatMoney(-12345, 2)).toBe('PKR -123.45');
    expect(calcRefundAmount(101, 1, 2)).toBe(51);
    expect(calcRefundAmount(-3, 1, 2)).toBe(-1);
    for (const value of ['garbage', '12x34', '1,2', 'Infinity', '9007199254740992'])
      expect(() => parseMoney(value)).toThrow();
    expect(() => allocateDiscount([{ unit_price: Number.MAX_SAFE_INTEGER, qty: 2 }], 0)).toThrow();
    expect(() => allocateDiscount([{ unit_price: 1, qty: 1 }], 2)).toThrow();
  });
  it('prevents two concurrent return calls, including separate repository instances', async () => {
    const { sale, items } = await sell(1);
    const result = await Promise.allSettled([
      returnSale(retInput(sale.id, items[0]!.id)),
      returnSale(retInput(sale.id, items[0]!.id)),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.query('SELECT SUM(qty) AS qty FROM return_items')).toEqual([{ qty: 1 }]);
    expect(await db.query('SELECT * FROM _operation_guards')).toEqual([]);
  });
  it.each([true, false])(
    'handles partial then full return, restock=%s, and rejects subsequent returns',
    async (restocked) => {
      const { sale, items } = await sell(2);
      const value = retInput(sale.id, items[0]!.id, 1, restocked);
      expect((await returnSale(value)).ret.refund_amount).toBe(100);
      expect((await returnSale(value)).ret.refund_amount).toBe(100);
      await expect(returnSale(value)).rejects.toThrow();
      expect((await new StockRepo(db).getStockOnHand(shop, variant))[0]?.on_hand).toBe(
        restocked ? 0 : -2,
      );
    },
  );
  it('rejects wrong sale, wrong variant, duplicate lines and fractional returns', async () => {
    const { sale, items } = await sell();
    const value = retInput(sale.id, items[0]!.id);
    await expect(returnSale({ ...value, sale_id: uuidv7() })).rejects.toThrow();
    await expect(
      returnSale({ ...value, lines: [{ ...value.lines[0]!, variant_id: uuidv7() }] }),
    ).rejects.toThrow();
    await expect(
      returnSale({ ...value, lines: [...value.lines, ...value.lines] }),
    ).rejects.toThrow();
    await expect(
      returnSale({ ...value, lines: [{ ...value.lines[0]!, qty: 0.5 }] }),
    ).rejects.toThrow();
    expect(await db.query('SELECT * FROM returns')).toEqual([]);
  });
  it('rolls back sale header, items and stock on an error inside its batch', async () => {
    await expect(sell(2, failingAdapter())).rejects.toThrow();
    for (const table of ['sales', 'sale_items', 'stock_movements'])
      expect(await db.query(`SELECT * FROM ${table}`)).toEqual([]);
  });
  it('rolls back return header, items, stock and guards on an error inside its batch', async () => {
    const { sale, items } = await sell();
    await expect(returnSale(retInput(sale.id, items[0]!.id), failingAdapter())).rejects.toThrow();
    for (const table of ['returns', 'return_items', '_operation_guards'])
      expect(await db.query(`SELECT * FROM ${table}`)).toEqual([]);
    expect((await new StockRepo(db).getStockOnHand(shop, variant))[0]?.on_hand).toBe(-2);
  });
  it('rejects invalid transaction quantities, IDs, dates, discounts and overflow before writing', async () => {
    for (const value of [
      input(1.5),
      { ...input(), sold_at: 'tomorrow' },
      { ...input(), lines: [] },
      { ...input(), discount_amount: 201 },
      { ...input(), lines: [{ ...input().lines[0]!, unit_price: Number.MAX_SAFE_INTEGER }] },
    ]) {
      await expect(
        new SaleRepo(db).completeSale(value, uuidv7(), [uuidv7()], [uuidv7()], time),
      ).rejects.toThrow();
    }
    await expect(
      new SaleRepo(db).completeSale(input(), 'bad', [uuidv7()], [uuidv7()], time),
    ).rejects.toThrow();
    expect(await db.query('SELECT * FROM sales')).toEqual([]);
  });
  it('keeps original sale costs after a later price change and validates read rows', async () => {
    const { sale } = await sell();
    await db.query('UPDATE variants SET cost_price = 90 WHERE id = ?', [variant]);
    expect((await new SaleRepo(db).getSaleById(sale.id))?.items[0]?.unit_cost).toBe(40);
    await db.query('UPDATE variants SET cost_price = 1.5 WHERE id = ?', [variant]);
    await expect(new ProductRepo(db).getVariantById(variant)).rejects.toThrow();
  });
  it('restores threshold, zero-stock and negative-stock coverage', async () => {
    expect((await new StockRepo(db).getLowStockVariants(shop)).map((v) => v.variant_id)).toContain(
      variant,
    );
    await sell();
    expect((await new StockRepo(db).getStockOnHand(shop, variant))[0]?.on_hand).toBe(-2);
    await db.query('UPDATE variants SET low_stock_threshold = 0 WHERE id = ?', [variant]);
    expect(await new StockRepo(db).getLowStockVariants(shop)).toHaveLength(1);
  });
  it('uses local day boundaries and applies returns on their own reporting date', async () => {
    // TZ is set to Asia/Karachi before workers start in vitest.config.ts.
    const range = reportRange('2026-11-15', '2026-11-15');
    expect(range.startStr).toBe('2026-11-14T19:00:00.000Z');
    expect(range.endStr).toBe('2026-11-15T18:59:59.999Z');
    const sold = await new SaleRepo(db).completeSale(
      { ...input(1), sold_at: '2026-11-14T19:00:00.000Z' },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      time,
    );
    await returnSale({
      ...retInput(sold.sale.id, sold.items[0]!.id),
      returned_at: '2026-11-15T19:00:00.000Z',
    });
    const reports = new ReportRepo(db);
    expect((await reports.getProfitAndLoss(shop, '2026-11-15', '2026-11-15')).net_revenue).toBe(
      100,
    );
    expect((await reports.getProfitAndLoss(shop, '2026-11-16', '2026-11-16')).net_revenue).toBe(
      -100,
    );
    expect(await reports.getDailySeries(shop, '2026-11-15', '2026-11-16')).toEqual([
      { date: '2026-11-15', revenue: 100, profit: 60 },
      { date: '2026-11-16', revenue: -100, profit: -60 },
    ]);
    expect((await reports.getProfitAndLoss(shop, '2026-11-17', '2026-11-17')).net_profit).toBe(0);
  });
  it('uses UUID v7 and validates canonical UTC timestamps; migrations are idempotent', async () => {
    expect(IdSchema.parse(uuidv7())).toHaveLength(36);
    expect(() => TimestampSchema.parse('2026-02-30T00:00:00.000Z')).toThrow();
    await db.migrate('packages/core/migrations');
    const applied = (await db.query('SELECT * FROM _migrations')) as unknown[];
    // 001_initial, 002_ledger_immutability, 003_receipt_unique
    expect(applied).toHaveLength(3);
    // Re-running adds nothing: idempotent.
    await db.migrate('packages/core/migrations');
    expect(await db.query('SELECT * FROM _migrations')).toHaveLength(applied.length);
  });
  it('enforces local ledger immutability but permits sync metadata updates', async () => {
    const { sale } = await sell();
    await expect(db.query('UPDATE sales SET total = 0 WHERE id = ?', [sale.id])).rejects.toThrow(
      'immutable',
    );
    await expect(db.query('DELETE FROM sales WHERE id = ?', [sale.id])).rejects.toThrow(
      'immutable',
    );
    await db.query('UPDATE sales SET dirty = 0, server_updated_at = ? WHERE id = ?', [
      time,
      sale.id,
    ]);
    expect((await new SaleRepo(db).getSaleById(sale.id))?.sale.dirty).toBe(0);
  });
  it('treats threshold equality as low stock and honors the variant override', async () => {
    await new StockRepo(db).addMovement({
      id: uuidv7(),
      shop_id: shop,
      variant_id: variant,
      qty_change: 3,
      type: 'opening',
      ref_type: null,
      ref_id: null,
      unit_cost: null,
      note: null,
      occurred_at: time,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: device,
      dirty: 1,
      server_updated_at: null,
    });
    expect(await new StockRepo(db).getLowStockVariants(shop)).toHaveLength(1);
    await db.query('UPDATE variants SET low_stock_threshold = 2 WHERE id = ?', [variant]);
    expect(await new StockRepo(db).getLowStockVariants(shop)).toHaveLength(0);
    await db.query('UPDATE variants SET low_stock_threshold = 3, track_stock = 0 WHERE id = ?', [
      variant,
    ]);
    expect(await new StockRepo(db).getLowStockVariants(shop)).toHaveLength(0);
  });

  it('does not commit a stale cost snapshot when a price edit races the sale', async () => {
    const adapter: DbAdapter = {
      query: db.query.bind(db),
      migrate: db.migrate.bind(db),
      batch: async (statements) => {
        await db.query('UPDATE variants SET cost_price = 50 WHERE id = ?', [variant]);
        await db.batch(statements);
      },
    };
    await expect(sell(1, adapter)).rejects.toThrow();
    expect(await db.query('SELECT * FROM sales')).toEqual([]);
    expect((await sell(1)).items[0]?.unit_cost).toBe(50);
  });
});
