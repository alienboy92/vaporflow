import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { allocateDiscount } from './money.js';
import { ProductRepo } from './repositories/product.js';
import { StockRepo } from './repositories/stock.js';
import { SaleRepo } from './repositories/sale.js';
import { ReturnRepo } from './repositories/return.js';
import { ExpenseRepo } from './repositories/expense.js';
import { ReportRepo } from './repositories/report.js';
import { uuidv7 } from './uuid.js';
import path from 'node:path';

describe('VaporFlow Core Correction Pass Tests', () => {
  let db: SqliteTestAdapter;

  beforeEach(async () => {
    db = new SqliteTestAdapter(':memory:');
    const migrationsDir = path.resolve('packages/core/migrations');
    await db.migrate(migrationsDir);
  });

  afterEach(() => {
    db.close();
  });

  describe('1. Variant Saving Fix & UUID v7', () => {
    it('generates valid UUID v7 and saves, reads, and updates variant correctly', async () => {
      const id = uuidv7();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(36);

      const shopId = uuidv7();
      const productId = uuidv7();
      const deviceId = uuidv7();
      const now = new Date().toISOString();

      await db.query(
        `INSERT INTO shops (id, shop_id, name, created_at, updated_at, device_id, dirty) VALUES (?, ?, 'Shop', ?, ?, ?, 1)`,
        [shopId, shopId, now, now, deviceId],
      );
      await db.query(
        `INSERT INTO products (id, shop_id, name, created_at, updated_at, device_id, dirty) VALUES (?, ?, 'Prod', ?, ?, ?, 1)`,
        [productId, shopId, now, now, deviceId],
      );

      const productRepo = new ProductRepo(db);
      const variant = {
        id,
        shop_id: shopId,
        product_id: productId,
        name: 'XL Variant',
        sku: 'SKU123',
        barcode: '2000000000012',
        cost_price: 250,
        sale_price: 500,
        low_stock_threshold: 3,
        track_stock: 1,
        is_active: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        device_id: deviceId,
        dirty: 1,
        server_updated_at: null,
      };

      await productRepo.saveVariant(variant);
      const fetched = await productRepo.getVariantById(id);
      expect(fetched).toBeDefined();
      expect(fetched?.name).toBe('XL Variant');
      expect(fetched?.is_active).toBe(1);

      // Update variant
      const updated = { ...fetched!, sale_price: 550, is_active: 0 };
      await productRepo.saveVariant(updated);
      const fetchedUpdated = await productRepo.getVariantById(id);
      expect(fetchedUpdated?.sale_price).toBe(550);
      expect(fetchedUpdated?.is_active).toBe(0);
    });
  });

  describe('2. Discount Allocation Reproduction & Invariants', () => {
    it('correctly allocates discount for reproduction case [1,1,1,1,1,0] with discount 2', () => {
      const items = [1, 1, 1, 1, 1, 0].map((unit_price) => ({ unit_price, qty: 1 }));
      const nets = allocateDiscount(items, 2);

      expect(nets.length).toBe(6);
      expect(nets.reduce((a, b) => a + b, 0)).toBe(5 - 2); // total gross 5 - discount 2 = 3
      expect(nets).toEqual([1, 1, 1, 1, 1, -2]);
    });

    it('rejects invalid inputs or zero gross correctly', () => {
      expect(() => allocateDiscount([{ unit_price: 0, qty: 1 }], 5)).toThrow();
      expect(allocateDiscount([{ unit_price: 0, qty: 1 }], 0)).toEqual([0]);
    });
  });

  describe('3. Return Integrity & Rollback Atomicity', () => {
    it('enforces return limits, duplicate line aggregation, and rolls back on error', async () => {
      const shopId = uuidv7();
      const deviceId = uuidv7();
      const variantId = uuidv7();
      const productId = uuidv7();
      const saleId = uuidv7();
      const saleItemId = uuidv7();
      const now = new Date().toISOString();

      await db.query(
        `INSERT INTO shops (id, shop_id, name, created_at, updated_at, device_id, dirty) VALUES (?, ?, 'Shop', ?, ?, ?, 1)`,
        [shopId, shopId, now, now, deviceId],
      );
      await db.query(
        `INSERT INTO products (id, shop_id, name, created_at, updated_at, device_id, dirty) VALUES (?, ?, 'Prod', ?, ?, ?, 1)`,
        [productId, shopId, now, now, deviceId],
      );
      await db.query(
        `INSERT INTO variants (id, shop_id, product_id, name, cost_price, sale_price, created_at, updated_at, device_id, dirty) VALUES (?, ?, ?, 'Default', 100, 200, ?, ?, ?, 1)`,
        [variantId, shopId, productId, now, now, deviceId],
      );

      const stockRepo = new StockRepo(db);
      await stockRepo.addMovement({
        id: uuidv7(),
        shop_id: shopId,
        variant_id: variantId,
        qty_change: 10,
        type: 'opening',
        ref_type: null,
        ref_id: null,
        unit_cost: 100,
        note: null,
        occurred_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        device_id: deviceId,
        dirty: 1,
        server_updated_at: null,
      });

      const saleRepo = new SaleRepo(db);
      await saleRepo.completeSale(
        {
          shop_id: shopId,
          device_id: deviceId,
          receipt_no: 'PC1-000001',
          sold_at: now,
          payment_method: 'cash',
          amount_received: 400,
          discount_amount: 0,
          note: null,
          lines: [
            {
              variant_id: variantId,
              product_name: 'Prod',
              variant_name: 'Default',
              qty: 2,
              list_price: 200,
              unit_price: 200,
            },
          ],
        },
        saleId,
        [saleItemId],
        [uuidv7()],
        now,
      );

      const returnRepo = new ReturnRepo(db);

      // Over-return attempt (trying to return 3 when only 2 sold) should throw error
      await expect(
        returnRepo.processReturn(
          {
            shop_id: shopId,
            device_id: deviceId,
            sale_id: saleId,
            returned_at: now,
            refund_method: 'cash',
            note: null,
            lines: [{ sale_item_id: saleItemId, variant_id: variantId, qty: 3, restocked: true }],
          },
          uuidv7(),
          [uuidv7()],
          [uuidv7()],
          now,
        ),
      ).rejects.toThrow();

      // Successful partial return of 1 item with restock
      await returnRepo.processReturn(
        {
          shop_id: shopId,
          device_id: deviceId,
          sale_id: saleId,
          returned_at: now,
          refund_method: 'cash',
          note: null,
          lines: [{ sale_item_id: saleItemId, variant_id: variantId, qty: 1, restocked: true }],
        },
        uuidv7(),
        [uuidv7()],
        [uuidv7()],
        now,
      );

      // Stock should be 10 - 2 (sale) + 1 (return) = 9
      const onHand = await stockRepo.getStockOnHand(shopId, variantId);
      expect(onHand[0]?.on_hand).toBe(9);
    });
  });

  describe('4. Report Queries & Seeded P&L Verification', () => {
    it('computes exact seeded P&L numbers and top items / daily series', async () => {
      const shopId = uuidv7();
      const deviceId = uuidv7();
      const now = '2026-11-15T12:00:00.000Z';

      await db.query(
        `INSERT INTO shops (id, shop_id, name, currency_code, currency_decimals, created_at, updated_at, device_id, dirty) VALUES (?, ?, 'Vapor Shop', 'PKR', 0, ?, ?, ?, 1)`,
        [shopId, shopId, now, now, deviceId],
      );
      const prodId = uuidv7();
      const varId = uuidv7();
      await db.query(
        `INSERT INTO products (id, shop_id, name, created_at, updated_at, device_id, dirty) VALUES (?, ?, 'Juice', ?, ?, ?, 1)`,
        [prodId, shopId, now, now, deviceId],
      );
      await db.query(
        `INSERT INTO variants (id, shop_id, product_id, name, cost_price, sale_price, created_at, updated_at, device_id, dirty) VALUES (?, ?, ?, 'Default', 400, 1000, ?, ?, ?, 1)`,
        [varId, shopId, prodId, now, now, deviceId],
      );

      const stockRepo = new StockRepo(db);
      await stockRepo.addMovement({
        id: uuidv7(),
        shop_id: shopId,
        variant_id: varId,
        qty_change: 50,
        type: 'opening',
        ref_type: null,
        ref_id: null,
        unit_cost: 400,
        note: null,
        occurred_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        device_id: deviceId,
        dirty: 1,
        server_updated_at: null,
      });

      const saleRepo = new SaleRepo(db);
      await saleRepo.completeSale(
        {
          shop_id: shopId,
          device_id: deviceId,
          receipt_no: 'PC1-000001',
          sold_at: '2026-11-15T10:00:00.000Z',
          payment_method: 'cash',
          amount_received: 5000,
          discount_amount: 0,
          note: null,
          lines: [
            {
              variant_id: varId,
              product_name: 'Juice',
              variant_name: 'Default',
              qty: 5,
              list_price: 1000,
              unit_price: 1000,
            },
          ],
        },
        '01900000-0000-7000-8000-0000000000a1',
        ['01900000-0000-7000-8000-0000000000a2'],
        [uuidv7()],
        now,
      );

      await saleRepo.completeSale(
        {
          shop_id: shopId,
          device_id: deviceId,
          receipt_no: 'PC1-000002',
          sold_at: '2026-11-15T11:00:00.000Z',
          payment_method: 'online',
          amount_received: null,
          discount_amount: 0,
          note: null,
          lines: [
            {
              variant_id: varId,
              product_name: 'Juice',
              variant_name: 'Default',
              qty: 2,
              list_price: 1000,
              unit_price: 1000,
            },
          ],
        },
        '01900000-0000-7000-8000-0000000000b1',
        ['01900000-0000-7000-8000-0000000000b2'],
        [uuidv7()],
        now,
      );

      const returnRepo = new ReturnRepo(db);
      await returnRepo.processReturn(
        {
          shop_id: shopId,
          device_id: deviceId,
          sale_id: '01900000-0000-7000-8000-0000000000a1',
          returned_at: '2026-11-15T11:30:00.000Z',
          refund_method: 'cash',
          note: null,
          lines: [
            {
              sale_item_id: '01900000-0000-7000-8000-0000000000a2',
              variant_id: varId,
              qty: 1,
              restocked: true,
            },
          ],
        },
        '01900000-0000-7000-8000-0000000000c1',
        ['01900000-0000-7000-8000-0000000000c2'],
        [uuidv7()],
        now,
      );

      const expenseRepo = new ExpenseRepo(db);
      await expenseRepo.save({
        id: uuidv7(),
        shop_id: shopId,
        expense_date: '2026-11-15',
        amount: 500,
        category: 'Utilities',
        note: 'Electricity',
        created_at: now,
        updated_at: now,
        deleted_at: null,
        device_id: deviceId,
        dirty: 1,
        server_updated_at: null,
      });

      const reportRepo = new ReportRepo(db);
      const pnl = await reportRepo.getProfitAndLoss(shopId, '2026-11-15', '2026-11-15');

      expect(pnl.net_revenue).toBe(6000);
      expect(pnl.net_cogs).toBe(2400);
      expect(pnl.gross_profit).toBe(3600);
      expect(pnl.expenses_total).toBe(500);
      expect(pnl.net_profit).toBe(3100);
      expect(pnl.sales_count).toBe(2);
      expect(pnl.avg_sale_value).toBe(3500);
      expect(pnl.cash_total).toBe(5000);
      expect(pnl.online_total).toBe(2000);

      const topQty = await reportRepo.getTopItemsByQty(shopId, '2026-11-15', '2026-11-15');
      expect(topQty.length).toBe(1);
      expect(topQty[0]?.value).toBe(7); // 5 + 2 = 7 sold qty

      const daily = await reportRepo.getDailySeries(shopId, '2026-11-15', '2026-11-15');
      expect(daily.length).toBe(1);
      expect(daily[0]?.revenue).toBe(6000);
      expect(daily[0]?.profit).toBe(3100);
    });
  });
});
