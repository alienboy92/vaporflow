import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { ShopRepo } from './repositories/shop.js';
import { ProductRepo } from './repositories/product.js';
import { SaleRepo } from './repositories/sale.js';
import { ReturnRepo } from './repositories/return.js';
import { ExpenseRepo } from './repositories/expense.js';
import { ReportRepo } from './repositories/report.js';
import { StockRepo } from './repositories/stock.js';
import { uuidv7 } from './uuid.js';
import path from 'node:path';

describe('Phase 6: History, Returns, Expenses, and Reports', () => {
  let db: SqliteTestAdapter;
  let shopId: string;
  let deviceId: string;
  let variantId: string;
  const now = '2026-11-15T12:00:00.000Z';

  beforeEach(async () => {
    db = new SqliteTestAdapter(':memory:');
    await db.migrate(path.resolve('packages/core/migrations'));

    shopId = uuidv7();
    deviceId = uuidv7();
    variantId = uuidv7();

    const shop = {
      id: shopId,
      shop_id: shopId,
      name: 'Vapor Shop Central',
      address: '123 Main St',
      phone: '555-0100',
      logo_base64: null,
      show_logo_on_receipt: 1,
      currency_code: 'PKR',
      currency_decimals: 0,
      receipt_footer: 'Thank you',
      default_low_stock_threshold: 3,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 0,
      server_updated_at: null,
    };

    const device = {
      id: deviceId,
      shop_id: shopId,
      name: 'Main POS',
      code: 'PC1',
      last_seen_at: now,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 0,
      server_updated_at: null,
    };

    await new ShopRepo(db).saveFirstRun(shop, device);

    const product = {
      id: uuidv7(),
      shop_id: shopId,
      category_id: null,
      name: 'E-Liquid',
      brand: 'VaporCo',
      notes: null,
      is_active: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
    };

    const variant = {
      id: variantId,
      shop_id: shopId,
      product_id: product.id,
      name: 'Menthol 6mg',
      sku: 'MENT-6',
      barcode: '1234567890123',
      cost_price: 1200,
      sale_price: 3000,
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

    await new ProductRepo(db).saveProductWithVariantsAndOpeningStock(
      product,
      [variant],
      [{ variantId: variant.id, qty: 100, unitCost: 1200, note: 'Opening' }],
      deviceId,
      now,
    );
  });

  afterEach(() => {
    db.close();
  });

  it('settles two partial refunds against a one-rupee line', async () => {
    const lineId = uuidv7();
    const saleId = uuidv7();
    await new SaleRepo(db).completeSale({
      shop_id: shopId, device_id: deviceId, sold_at: now, payment_method: 'cash', amount_received: 1,
      discount_amount: 1, note: null, lines: [{ product_name: 'Test', variant_name: 'Test',
        variant_id: variantId, qty: 2, list_price: 1, unit_price: 1 }],
    }, saleId, [lineId], [uuidv7()], now);
    const refund = () => new ReturnRepo(db).processReturn({
      shop_id: shopId, device_id: deviceId, returned_at: now, sale_id: saleId, refund_method: 'cash',
      note: null, lines: [{ sale_item_id: lineId, variant_id: variantId, qty: 1, restocked: true }],
    }, uuidv7(), [uuidv7()], [uuidv7()], now);
    expect((await refund()).ret.refund_amount).toBe(1);
    expect((await refund()).ret.refund_amount).toBe(0);
  });

  it('matches the seeded assertions for revenue, COGS, gross profit, expenses, and net profit', async () => {
    // Canonical seeded P&L from PHASE1_REVIEW.md: 2 sales totaling 7000
    // (cash 5000 + online 2000), 3 units sold at unit_cost 1200, expense 500.
    const saleRepo = new SaleRepo(db);
    const expenseRepo = new ExpenseRepo(db);

    // Sale 1: cash 5000 (qty 2 @ 2500)
    await saleRepo.completeSale(
      {
        shop_id: shopId,
        device_id: deviceId,
        sold_at: '2026-11-15T10:00:00.000Z',
        payment_method: 'cash',
        amount_received: 5000,
        discount_amount: 0,
        note: 'Cash sale',
        lines: [
          {
            variant_id: variantId,
            product_name: 'E-Liquid',
            variant_name: 'Menthol 6mg',
            qty: 2,
            list_price: 2500,
            unit_price: 2500,
          },
        ],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      now,
    );

    // Sale 2: online 2000 (qty 1 @ 2000)
    await saleRepo.completeSale(
      {
        shop_id: shopId,
        device_id: deviceId,
        sold_at: '2026-11-15T11:00:00.000Z',
        payment_method: 'online',
        amount_received: null,
        discount_amount: 0,
        note: 'Online sale',
        lines: [
          {
            variant_id: variantId,
            product_name: 'E-Liquid',
            variant_name: 'Menthol 6mg',
            qty: 1,
            list_price: 2000,
            unit_price: 2000,
          },
        ],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      now,
    );

    // Expense: 500
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

    // All nine P&L fields on the canonical seed:
    expect(pnl.net_revenue).toBe(7000);
    expect(pnl.net_cogs).toBe(3600); // 3 units at unit_cost 1200
    expect(pnl.gross_profit).toBe(3400); // 7000 - 3600
    expect(pnl.expenses_total).toBe(500);
    expect(pnl.net_profit).toBe(2900); // 3400 - 500
    expect(pnl.sales_count).toBe(2);
    expect(pnl.avg_sale_value).toBe(3500); // gross 7000 / 2 sales
    expect(pnl.cash_total).toBe(5000);
    expect(pnl.online_total).toBe(2000);
    expect(pnl.refunds_total).toBe(0);

    // Combined top-items table still reconciles with the P&L totals.
    const topByProfit = await reportRepo.getTopItems(shopId, '2026-11-15', '2026-11-15', 'profit');
    expect(topByProfit.length).toBeGreaterThan(0);
    expect(topByProfit.reduce((sum, row) => sum + row.revenue, 0)).toBe(7000);
    expect(topByProfit.reduce((sum, row) => sum + row.profit, 0)).toBe(3400);
    for (let i = 1; i < topByProfit.length; i += 1) {
      expect(topByProfit[i - 1]!.profit).toBeGreaterThanOrEqual(topByProfit[i]!.profit);
    }
    const topByQty = await reportRepo.getTopItems(shopId, '2026-11-15', '2026-11-15', 'qty');
    for (let i = 1; i < topByQty.length; i += 1) {
      expect(topByQty[i - 1]!.qty).toBeGreaterThanOrEqual(topByQty[i]!.qty);
    }
  });

  it('supports returns with partial/full/no-restock and bounded quantities', async () => {
    const saleRepo = new SaleRepo(db);
    const returnRepo = new ReturnRepo(db);
    const stockRepo = new StockRepo(db);

    const saleRes = await saleRepo.completeSale(
      {
        shop_id: shopId,
        device_id: deviceId,
        sold_at: now,
        payment_method: 'cash',
        amount_received: 3000,
        discount_amount: 0,
        note: null,
        lines: [
          {
            variant_id: variantId,
            product_name: 'E-Liquid',
            variant_name: 'Menthol 6mg',
            qty: 3,
            list_price: 1000,
            unit_price: 1000,
          },
        ],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      now,
    );

    const saleItem = saleRes.items[0]!;

    // Return 1 unit with restock
    const retRes = await returnRepo.processReturn(
      {
        shop_id: shopId,
        device_id: deviceId,
        sale_id: saleRes.sale.id,
        returned_at: now,
        refund_method: 'cash',
        note: 'Partial return',
        lines: [{ sale_item_id: saleItem.id, variant_id: variantId, qty: 1, restocked: true }],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      now,
    );

    expect(retRes.ret.refund_amount).toBe(1000);
    expect(retRes.items[0]!.restocked).toBe(1);

    // Restocked return moves stock back: 100 opening - 3 sold + 1 restocked = 98
    const onHandAfterRestock = await stockRepo.getStockOnHand(shopId, variantId);
    expect(onHandAfterRestock[0]!.on_hand).toBe(98);

    // Try returning another 3 units (exceeds remaining quantity of 2) -> should throw
    await expect(
      returnRepo.processReturn(
        {
          shop_id: shopId,
          device_id: deviceId,
          sale_id: saleRes.sale.id,
          returned_at: now,
          refund_method: 'cash',
          note: 'Too many',
          lines: [{ sale_item_id: saleItem.id, variant_id: variantId, qty: 3, restocked: false }],
        },
        uuidv7(),
        [uuidv7()],
        [uuidv7()],
        now,
      ),
    ).rejects.toThrow();

    // Return 1 unit WITHOUT restock: refund is paid but stock does not move.
    const noRestockRes = await returnRepo.processReturn(
      {
        shop_id: shopId,
        device_id: deviceId,
        sale_id: saleRes.sale.id,
        returned_at: now,
        refund_method: 'cash',
        note: 'Damaged, no restock',
        lines: [{ sale_item_id: saleItem.id, variant_id: variantId, qty: 1, restocked: false }],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      now,
    );
    expect(noRestockRes.ret.refund_amount).toBe(1000);
    expect(noRestockRes.items[0]!.restocked).toBe(0);

    // No-restock return writes no stock movement: on-hand stays 98 and the
    // movement ledger still holds only opening + sale + restocked return.
    const onHandAfterNoRestock = await stockRepo.getStockOnHand(shopId, variantId);
    expect(onHandAfterNoRestock[0]!.on_hand).toBe(98);
    const movementsAfterNoRestock = await stockRepo.getMovementsForVariant(shopId, variantId);
    expect(movementsAfterNoRestock).toHaveLength(3); // opening, sale, restocked return

    // Full return of the remaining unit.
    const fullRes = await returnRepo.processReturn(
      {
        shop_id: shopId,
        device_id: deviceId,
        sale_id: saleRes.sale.id,
        returned_at: now,
        refund_method: 'cash',
        note: 'Full return',
        lines: [{ sale_item_id: saleItem.id, variant_id: variantId, qty: 1, restocked: false }],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      now,
    );
    expect(fullRes.ret.refund_amount).toBe(1000);

    // Everything is returned: any further return is rejected.
    await expect(
      returnRepo.processReturn(
        {
          shop_id: shopId,
          device_id: deviceId,
          sale_id: saleRes.sale.id,
          returned_at: now,
          refund_method: 'cash',
          note: 'Nothing left',
          lines: [{ sale_item_id: saleItem.id, variant_id: variantId, qty: 1, restocked: false }],
        },
        uuidv7(),
        [uuidv7()],
        [uuidv7()],
        now,
      ),
    ).rejects.toThrow();

    // P&L nets the returns: revenue 3000 - 3000 refunds = 0; the restocked
    // unit credits 1200 of COGS back, leaving net_cogs 2400.
    const pnl = await new ReportRepo(db).getProfitAndLoss(shopId, '2026-11-01', '2026-11-30');
    expect(pnl.net_revenue).toBe(0);
    expect(pnl.net_cogs).toBe(2400);
    expect(pnl.gross_profit).toBe(-2400);
    expect(pnl.expenses_total).toBe(0);
    expect(pnl.net_profit).toBe(-2400);
    expect(pnl.sales_count).toBe(1);
    expect(pnl.avg_sale_value).toBe(3000); // gross revenue / count, before refunds
    expect(pnl.refunds_total).toBe(3000);
  });

  it('supports expense CRUD operations and soft-deletes', async () => {
    const expenseRepo = new ExpenseRepo(db);
    const expId = uuidv7();

    await expenseRepo.save({
      id: expId,
      shop_id: shopId,
      expense_date: '2026-11-15',
      amount: 1500,
      category: 'Rent',
      note: 'November Rent',
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
    });

    let list = await expenseRepo.getAll(shopId);
    expect(list).toHaveLength(1);
    expect(list[0]!.amount).toBe(1500);

    // Soft delete
    await expenseRepo.softDelete(expId, now);
    list = await expenseRepo.getAll(shopId);
    expect(list).toHaveLength(0);
  });

  it('runs a 50-sale smoke benchmark in under 3 seconds', async () => {
    const saleRepo = new SaleRepo(db);
    const startTime = performance.now();

    // 50-sale smoke benchmark: a small, always-run performance sanity check.
    for (let i = 0; i < 50; i++) {
      await saleRepo.completeSale(
        {
          shop_id: shopId,
          device_id: deviceId,
          sold_at: now,
          payment_method: 'cash',
          amount_received: 3000,
          discount_amount: 0,
          note: `Bulk sale ${i}`,
          lines: [
            {
              variant_id: variantId,
              product_name: 'E-Liquid',
              variant_name: 'Menthol 6mg',
              qty: 1,
              list_price: 3000,
              unit_price: 3000,
            },
          ],
        },
        uuidv7(),
        [uuidv7()],
        [uuidv7()],
        now,
      );
    }

    const reportRepo = new ReportRepo(db);
    const pnl = await reportRepo.getProfitAndLoss(shopId, '2026-11-01', '2026-11-30');
    expect(pnl.sales_count).toBe(50);

    const duration = performance.now() - startTime;
    console.log(`Benchmark 50 sales completed in ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(3000);
  });

  // Real 1,000-sale throughput benchmark, opt-in so the normal suite stays fast:
  //   VAPORFLOW_BENCH=1 pnpm test
  (process.env.VAPORFLOW_BENCH ? it : it.skip)(
    'completes 1,000 sales in under 10 seconds (VAPORFLOW_BENCH=1)',
    async () => {
      const saleRepo = new SaleRepo(db);
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        await saleRepo.completeSale(
          {
            shop_id: shopId,
            device_id: deviceId,
            sold_at: now,
            payment_method: 'cash',
            amount_received: 3000,
            discount_amount: 0,
            note: `Bench sale ${i}`,
            lines: [
              {
                variant_id: variantId,
                product_name: 'E-Liquid',
                variant_name: 'Menthol 6mg',
                qty: 1,
                list_price: 3000,
                unit_price: 3000,
              },
            ],
          },
          uuidv7(),
          [uuidv7()],
          [uuidv7()],
          now,
        );
      }

      const pnl = await new ReportRepo(db).getProfitAndLoss(shopId, '2026-11-01', '2026-11-30');
      expect(pnl.sales_count).toBe(1000);

      const duration = performance.now() - startTime;
      console.log(`Benchmark 1,000 sales completed in ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(10000);
    },
  );
});
