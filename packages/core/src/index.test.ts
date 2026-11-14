import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteTestAdapter } from './db-adapter.js';
import { allocateDiscount, calcRefundAmount, formatMoney, parseMoney } from './money.js';
import { StockRepo } from './repositories/stock.js';
import { SaleRepo } from './repositories/sale.js';
import { ReturnRepo } from './repositories/return.js';
import { ExpenseRepo } from './repositories/expense.js';
import { ReportRepo } from './repositories/report.js';
import path from 'node:path';

describe('VaporFlow Core Domain & Schema Tests', () => {
  let db: SqliteTestAdapter;

  beforeEach(() => {
    db = new SqliteTestAdapter(':memory:');
    // Run migrations
    const migrationsDir = path.resolve('packages/core/migrations');
    db.migrate(migrationsDir);
  });

  afterEach(() => {
    db.close();
  });

  describe('1. Money & Discount Allocation', () => {
    it('parses and formats money correctly', () => {
      expect(parseMoney(1500, 0)).toBe(1500);
      expect(parseMoney('PKR 1,500', 0)).toBe(1500);
      expect(formatMoney(1500, 0, 'PKR')).toBe('PKR 1,500');
    });

    it('allocates discount proportionally with remainder on last line', () => {
      const items = [
        { unit_price: 100, qty: 1 }, // gross 100
        { unit_price: 200, qty: 1 }, // gross 200
        { unit_price: 300, qty: 1 }, // gross 300
      ]; // total gross = 600
      // Total discount = 100
      // Line 1: (100/600)*100 = 16.67 -> 17 discount -> net 83
      // Line 2: (200/600)*100 = 33.33 -> 33 discount -> net 167
      // Line 3: remainder = 100 - (17 + 33) = 50 discount -> net 250
      const nets = allocateDiscount(items, 100);
      expect(nets).toEqual([83, 167, 250]);
      expect(nets.reduce((a, b) => a + b, 0)).toBe(600 - 100);
    });

    it('calculates refund amount per line correctly', () => {
      // net_total = 900, qty_sold = 3, qty_returned = 1 -> round(900 * 1 / 3) = 300
      expect(calcRefundAmount(900, 1, 3)).toBe(300);
      // full return
      expect(calcRefundAmount(900, 3, 3)).toBe(900);
    });
  });

  describe('2. Complete Sale Atomicity & Stock Movements', () => {
    it('completes a sale as an atomic batch and updates stock on hand', () => {
      const shopId = '01900000-0000-7000-8000-000000000001';
      const deviceId = '01900000-0000-7000-8000-000000000002';
      const nowIso = new Date().toISOString();

      // Insert shop & product & variant
      db.query(
        `INSERT INTO shops (id, name, currency_code, currency_decimals, created_at, updated_at, device_id, dirty) VALUES (?, 'Vapor Shop', 'PKR', 0, ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );
      db.query(
        `INSERT INTO products (id, shop_id, name, created_at, updated_at, device_id, dirty) VALUES ('prod-1', ?, 'Vape Device', ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );
      db.query(
        `INSERT INTO variants (id, shop_id, product_id, name, cost_price, sale_price, created_at, updated_at, device_id, dirty) VALUES ('var-1', ?, 'prod-1', 'Default', 500, 1000, ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );

      // Add opening stock of 10
      const stockRepo = new StockRepo(db);
      stockRepo.addMovement({
        id: 'mov-open',
        shop_id: shopId,
        variant_id: 'var-1',
        qty_change: 10,
        type: 'opening',
        ref_type: null,
        ref_id: null,
        unit_cost: 500,
        note: 'Opening stock',
        occurred_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        device_id: deviceId,
        dirty: 1,
        server_updated_at: null,
      });

      expect(stockRepo.getStockOnHand(shopId, 'var-1')[0]?.on_hand).toBe(10);

      // Complete sale of 2 units
      const saleRepo = new SaleRepo(db);
      const result = saleRepo.completeSale(
        {
          shop_id: shopId,
          device_id: deviceId,
          receipt_no: 'PC1-000001',
          sold_at: nowIso,
          payment_method: 'cash',
          amount_received: 2000,
          discount_amount: 0,
          note: null,
          lines: [
            {
              variant_id: 'var-1',
              product_name: 'Vape Device',
              variant_name: 'Default',
              qty: 2,
              list_price: 1000,
              unit_price: 1000,
              unit_cost: 500,
            },
          ],
        },
        'sale-1',
        ['item-1'],
        ['mov-sale-1'],
        nowIso
      );

      expect(result.sale.total).toBe(2000);
      expect(stockRepo.getStockOnHand(shopId, 'var-1')[0]?.on_hand).toBe(8);
    });
  });

  describe('3. Returns with and without Restock', () => {
    it('processes partial return with restock and without restock', () => {
      const shopId = '01900000-0000-7000-8000-000000000001';
      const deviceId = '01900000-0000-7000-8000-000000000002';
      const nowIso = new Date().toISOString();

      db.query(
        `INSERT INTO shops (id, name, currency_code, currency_decimals, created_at, updated_at, device_id, dirty) VALUES (?, 'Vapor Shop', 'PKR', 0, ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );
      db.query(
        `INSERT INTO products (id, shop_id, name, created_at, updated_at, device_id, dirty) VALUES ('prod-1', ?, 'E-Liquid', ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );
      db.query(
        `INSERT INTO variants (id, shop_id, product_id, name, cost_price, sale_price, created_at, updated_at, device_id, dirty) VALUES ('var-1', ?, 'prod-1', 'Default', 300, 600, ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );

      const stockRepo = new StockRepo(db);
      stockRepo.addMovement({
        id: 'mov-open',
        shop_id: shopId,
        variant_id: 'var-1',
        qty_change: 10,
        type: 'opening',
        ref_type: null,
        ref_id: null,
        unit_cost: 300,
        note: 'Opening',
        occurred_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        device_id: deviceId,
        dirty: 1,
        server_updated_at: null,
      });

      const saleRepo = new SaleRepo(db);
      saleRepo.completeSale(
        {
          shop_id: shopId,
          device_id: deviceId,
          receipt_no: 'PC1-000001',
          sold_at: nowIso,
          payment_method: 'cash',
          amount_received: 1200,
          discount_amount: 0,
          note: null,
          lines: [
            {
              variant_id: 'var-1',
              product_name: 'E-Liquid',
              variant_name: 'Default',
              qty: 2,
              list_price: 600,
              unit_price: 600,
              unit_cost: 300,
            },
          ],
        },
        'sale-1',
        ['item-1'],
        ['mov-sale-1'],
        nowIso
      );

      // On hand is now 10 - 2 = 8
      expect(stockRepo.getStockOnHand(shopId, 'var-1')[0]?.on_hand).toBe(8);

      // Process return: return 1 item, RESTOCK = true
      const returnRepo = new ReturnRepo(db);
      returnRepo.processReturn(
        {
          shop_id: shopId,
          device_id: deviceId,
          sale_id: 'sale-1',
          returned_at: nowIso,
          refund_method: 'cash',
          note: 'Customer returned 1 item',
          lines: [
            {
              sale_item_id: 'item-1',
              variant_id: 'var-1',
              qty: 1,
              restocked: true,
            },
          ],
        },
        'ret-1',
        ['ret-item-1'],
        ['mov-ret-1'],
        nowIso
      );

      // On hand should be back to 8 + 1 = 9
      expect(stockRepo.getStockOnHand(shopId, 'var-1')[0]?.on_hand).toBe(9);
    });
  });

  describe('4. Low Stock Rule', () => {
    it('identifies variants below low stock threshold correctly', () => {
      const shopId = '01900000-0000-7000-8000-000000000001';
      const deviceId = '01900000-0000-7000-8000-000000000002';
      const nowIso = new Date().toISOString();

      db.query(
        `INSERT INTO shops (id, name, default_low_stock_threshold, created_at, updated_at, device_id, dirty) VALUES (?, 'Shop', 3, ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );
      db.query(
        `INSERT INTO products (id, shop_id, name, created_at, updated_at, device_id, dirty) VALUES ('p1', ?, 'Prod 1', ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );
      db.query(
        `INSERT INTO variants (id, shop_id, product_id, name, cost_price, sale_price, low_stock_threshold, created_at, updated_at, device_id, dirty) VALUES ('v1', ?, 'p1', 'Var 1', 100, 200, 2, ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );
      db.query(
        `INSERT INTO variants (id, shop_id, product_id, name, cost_price, sale_price, low_stock_threshold, created_at, updated_at, device_id, dirty) VALUES ('v2', ?, 'p1', 'Var 2', 100, 200, NULL, ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );

      const stockRepo = new StockRepo(db);
      // v1 on hand = 1 (threshold = 2 -> low stock)
      stockRepo.addMovement({
        id: 'm1', shop_id: shopId, variant_id: 'v1', qty_change: 1, type: 'opening',
        ref_type: null, ref_id: null, unit_cost: 100, note: null, occurred_at: nowIso,
        created_at: nowIso, updated_at: nowIso, deleted_at: null, device_id: deviceId, dirty: 1, server_updated_at: null
      });
      // v2 on hand = 3 (shop default threshold = 3 -> low stock)
      stockRepo.addMovement({
        id: 'm2', shop_id: shopId, variant_id: 'v2', qty_change: 3, type: 'opening',
        ref_type: null, ref_id: null, unit_cost: 100, note: null, occurred_at: nowIso,
        created_at: nowIso, updated_at: nowIso, deleted_at: null, device_id: deviceId, dirty: 1, server_updated_at: null
      });

      const lowStock = stockRepo.getLowStockVariants(shopId);
      expect(lowStock.length).toBe(2);
      expect(lowStock.map((l) => l.variant_id).sort()).toEqual(['v1', 'v2']);
    });
  });

  describe('5. Seeded P&L Dataset Report', () => {
    it('computes exact P&L formulas for a seeded dataset with sales, returns, and expenses', () => {
      const shopId = '01900000-0000-7000-8000-000000000001';
      const deviceId = '01900000-0000-7000-8000-000000000002';
      const nowIso = '2026-11-15T12:00:00.000Z';

      db.query(
        `INSERT INTO shops (id, name, currency_code, currency_decimals, created_at, updated_at, device_id, dirty) VALUES (?, 'Vapor Shop', 'PKR', 0, ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );
      db.query(
        `INSERT INTO products (id, shop_id, name, created_at, updated_at, device_id, dirty) VALUES ('prod-1', ?, 'Juice', ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );
      db.query(
        `INSERT INTO variants (id, shop_id, product_id, name, cost_price, sale_price, created_at, updated_at, device_id, dirty) VALUES ('var-1', ?, 'prod-1', 'Default', 400, 1000, ?, ?, ?, 1)`,
        [shopId, nowIso, nowIso, deviceId]
      );

      const stockRepo = new StockRepo(db);
      stockRepo.addMovement({
        id: 'm-open', shop_id: shopId, variant_id: 'var-1', qty_change: 50, type: 'opening',
        ref_type: null, ref_id: null, unit_cost: 400, note: null, occurred_at: nowIso,
        created_at: nowIso, updated_at: nowIso, deleted_at: null, device_id: deviceId, dirty: 1, server_updated_at: null
      });

      // Sale 1: 5 items @ 1000 = 5000 total (Cash)
      const saleRepo = new SaleRepo(db);
      saleRepo.completeSale(
        {
          shop_id: shopId, device_id: deviceId, receipt_no: 'PC1-000001',
          sold_at: '2026-11-15T10:00:00.000Z', payment_method: 'cash', amount_received: 5000,
          discount_amount: 0, note: null,
          lines: [{ variant_id: 'var-1', product_name: 'Juice', variant_name: 'Default', qty: 5, list_price: 1000, unit_price: 1000, unit_cost: 400 }]
        },
        'sale-1', ['si-1'], ['ms-1'], nowIso
      );

      // Sale 2: 2 items @ 1000 = 2000 total (Online)
      saleRepo.completeSale(
        {
          shop_id: shopId, device_id: deviceId, receipt_no: 'PC1-000002',
          sold_at: '2026-11-15T11:00:00.000Z', payment_method: 'online', amount_received: null,
          discount_amount: 0, note: null,
          lines: [{ variant_id: 'var-1', product_name: 'Juice', variant_name: 'Default', qty: 2, list_price: 1000, unit_price: 1000, unit_cost: 400 }]
        },
        'sale-2', ['si-2'], ['ms-2'], nowIso
      );
      // Gross Revenue = 7000 (Cash 5000, Online 2000)
      // Gross COGS = (5 * 400) + (2 * 400) = 2000 + 800 = 2800

      // Return: return 1 item from Sale 1 (which had net_total 5000 for 5 items, so 1 item refund = 1000), restocked = true
      const returnRepo = new ReturnRepo(db);
      returnRepo.processReturn(
        {
          shop_id: shopId, device_id: deviceId, sale_id: 'sale-1',
          returned_at: '2026-11-15T11:30:00.000Z', refund_method: 'cash', note: null,
          lines: [{ sale_item_id: 'si-1', variant_id: 'var-1', qty: 1, restocked: true }]
        },
        'ret-1', ['ri-1'], ['mr-1'], nowIso
      );
      // Refunds = 1000
      // Restocked COGS = 1 * 400 = 400

      // Expenses: 500 PKR electricity
      const expenseRepo = new ExpenseRepo(db);
      expenseRepo.save({
        id: 'exp-1', shop_id: shopId, expense_date: '2026-11-15', amount: 500,
        category: 'Utilities', note: 'Electricity', created_at: nowIso, updated_at: nowIso,
        deleted_at: null, device_id: deviceId, dirty: 1, server_updated_at: null
      });

      // Compute P&L
      const reportRepo = new ReportRepo(db);
      const pnl = reportRepo.getProfitAndLoss(shopId, '2026-11-15', '2026-11-15');

      // Expected numbers:
      // Gross Revenue = 7000
      // Refunds = 1000
      // Net Revenue = 7000 - 1000 = 6000
      // Gross COGS = 2800
      // Restocked COGS = 400
      // Net COGS = 2800 - 400 = 2400
      // Gross Profit = 6000 - 2400 = 3600
      // Expenses Total = 500
      // Net Profit = 3600 - 500 = 3100
      // Sales count = 2
      // Avg sale value = round(7000 / 2) = 3500
      // Cash total = 5000, Online total = 2000

      console.log('Seeded P&L Result:', pnl);

      expect(pnl.net_revenue).toBe(6000);
      expect(pnl.net_cogs).toBe(2400);
      expect(pnl.gross_profit).toBe(3600);
      expect(pnl.expenses_total).toBe(500);
      expect(pnl.net_profit).toBe(3100);
      expect(pnl.sales_count).toBe(2);
      expect(pnl.avg_sale_value).toBe(3500);
      expect(pnl.cash_total).toBe(5000);
      expect(pnl.online_total).toBe(2000);
    });
  });
});
