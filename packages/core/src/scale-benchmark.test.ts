import { it, expect } from 'vitest';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { ReportRepo } from './repositories/report.js';
import { StockRepo } from './repositories/stock.js';

// Disposable in-memory database only. Run with VAPORFLOW_BENCH=1.
it.skipIf(!process.env.VAPORFLOW_BENCH)('reports 50,000 sales across 12 months with 10,000 variants and 100,000 movements', async () => {
  const db = new SqliteTestAdapter();
  const shop = '01900000-0000-7000-8000-000000000001';
  const stamp = '2026-01-01T12:00:00.000Z';
  const id = (kind: number, expression = 'n') => `printf('01900000-0000-7000-800${kind}-%012x', ${expression})`;
  const series = (count: number) => `WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<${count})`;
  try {
    await db.migrate();
    await db.query('INSERT INTO shops(id,shop_id,created_at,updated_at,device_id,name) VALUES(?,?,?,?,?,?)', [shop, shop, stamp, stamp, shop, 'Benchmark']);
    await db.query(`${series(10000)} INSERT INTO products(id,shop_id,created_at,updated_at,device_id,name) SELECT ${id(1)}, ?, ?, ?, ?, 'Product ' || n FROM seq`, [shop, stamp, stamp, shop]);
    await db.query(`${series(10000)} INSERT INTO variants(id,shop_id,created_at,updated_at,device_id,product_id,name,cost_price,sale_price) SELECT ${id(2)}, ?, ?, ?, ?, ${id(1)}, 'Default',10,20 FROM seq`, [shop, stamp, stamp, shop]);
    await db.query(`${series(50000)} INSERT INTO sales(id,shop_id,created_at,updated_at,device_id,receipt_no,sold_at,subtotal,discount_amount,total,payment_method) SELECT ${id(3)}, ?, ?, ?, ?, 'PC1-' || n, strftime('%Y-%m-%dT12:00:00.000Z','2026-01-01','+' || ((n-1)%365) || ' days'),20,0,20,'cash' FROM seq`, [shop, stamp, stamp, shop]);
    await db.query(`${series(50000)} INSERT INTO sale_items(id,shop_id,created_at,updated_at,device_id,sale_id,variant_id,product_name,variant_name,qty,list_price,unit_price,unit_cost,net_total) SELECT ${id(4)}, ?, ?, ?, ?, ${id(3)}, ${id(2, '(n-1)%10000+1')}, 'Product ' || ((n-1)%10000+1),'Default',1,20,20,10,20 FROM seq`, [shop, stamp, stamp, shop]);
    await db.query(`${series(100000)} INSERT INTO stock_movements(id,shop_id,created_at,updated_at,device_id,variant_id,qty_change,type,occurred_at) SELECT ${id(5)}, ?, ?, ?, ?, ${id(2, '(n-1)%10000+1')}, CASE WHEN n<=50000 THEN 2 ELSE -1 END, CASE WHEN n<=50000 THEN 'restock' ELSE 'sale' END, ? FROM seq`, [shop, stamp, stamp, shop, stamp]);
    const report = new ReportRepo(db);
    const start = performance.now();
    const pnl = await report.getProfitAndLoss(shop, '2026-01-01', '2026-12-31');
    const daily = await report.getDailySeries(shop, '2026-01-01', '2026-12-31');
    const qty = await report.getTopItemsByQty(shop, '2026-01-01', '2026-12-31');
    const profit = await report.getTopItemsByProfit(shop, '2026-01-01', '2026-12-31');
    const reportMs = performance.now() - start;
    const inventoryStart = performance.now();
    const inventory = await new StockRepo(db).getInventoryList(shop);
    const inventoryMs = performance.now() - inventoryStart;
    expect(pnl).toMatchObject({ net_revenue: 1000000, net_cogs: 500000, net_profit: 500000, sales_count: 50000 });
    expect(daily).toHaveLength(365);
    expect(daily.reduce((sum, day) => sum + day.revenue, 0)).toBe(1000000);
    expect(qty).toHaveLength(10);
    expect(profit).toHaveLength(10);
    expect(inventory).toHaveLength(10000);
    expect(inventory.every((row) => row.on_hand === 5)).toBe(true);
    console.log(JSON.stringify({ environment: `${process.platform} ${process.version}; Vitest; in-memory SQLite`, reportMs, inventoryMs }));
    expect(reportMs).toBeLessThan(2000);
  } finally { db.close(); }
}, 120000);
