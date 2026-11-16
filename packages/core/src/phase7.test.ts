import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { generateCsvTemplate, previewCsvImport, executeCsvImport } from './csv-import.js';
import { exportBackupJson, validateBackupJson, restoreBackup, type VfBackup } from './backup.js';
import { ShopRepo } from './repositories/shop.js';
import { DeviceRepo } from './repositories/device.js';
import { ProductRepo } from './repositories/product.js';
import { StockRepo } from './repositories/stock.js';
import { SaleRepo } from './repositories/sale.js';
import { ReturnRepo } from './repositories/return.js';
import { ExpenseRepo } from './repositories/expense.js';
import { ReportRepo } from './repositories/report.js';
import { SettingsRepo } from './repositories/settings.js';
import { uuidv7 } from './uuid.js';

describe('Phase 7: CSV Import and Backup/Restore', () => {
  let db: SqliteTestAdapter;
  const shopId = uuidv7();
  const deviceId = uuidv7();

  beforeEach(async () => {
    db = new SqliteTestAdapter();
    await db.migrate();

    const shopRepo = new ShopRepo(db);
    await shopRepo.saveShop({
      id: shopId,
      shop_id: shopId,
      name: 'Test Shop',
      address: '123 Main St',
      phone: '555-0100',
      logo_base64: null,
      show_logo_on_receipt: 0,
      currency_code: 'PKR',
      currency_decimals: 0,
      receipt_footer: 'Thank you',
      default_low_stock_threshold: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
    });

    const deviceRepo = new DeviceRepo(db);
    await deviceRepo.saveDevice({
      id: deviceId,
      shop_id: shopId,
      name: 'PC One',
      code: 'PC1',
      last_seen_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
    });
  });

  it('generates valid CSV template', () => {
    const template = generateCsvTemplate();
    expect(template).toContain('category,product_name,variant_name,barcode');
    expect(template).toContain('Vapes');
  });

  it('previews and executes CSV import correctly', async () => {
    const csvData = [
      'category,product_name,variant_name,barcode,sku,cost_price,sale_price,opening_stock,low_stock_threshold',
      'Vapes,Disposable 1500,Blueberry,BARCODE101,SKU-B1,1000,1500,20,3',
      'Vapes,Disposable 1500,Mint,BARCODE102,SKU-M1,1000,1500,15,3',
      'Accessories,Charger Fast,White,BARCODE103,SKU-C1,300,750,50,5',
    ].join('\n');

    const preview = await previewCsvImport(db, shopId, csvData);
    expect(preview.globalErrors).toHaveLength(0);
    expect(preview.rows).toHaveLength(3);
    expect(preview.rows[0]?.errors).toHaveLength(0);

    const result = await executeCsvImport(db, shopId, deviceId, preview.rows, 'skip');
    expect(result.importedCount).toBe(3);
    expect(result.errors).toHaveLength(0);

    const productRepo = new ProductRepo(db);
    const products = await productRepo.getProducts(shopId);
    expect(products).toHaveLength(2);

    const variants = await productRepo.getVariants(shopId);
    expect(variants.length).toBeGreaterThan(0);
    const firstVariant = variants[0];
    expect(firstVariant).toBeDefined();

    const stockRepo = new StockRepo(db);
    const stockList = await stockRepo.getStockOnHand(shopId, firstVariant!.id);
    const onHand1 = stockList[0]?.on_hand ?? 0;
    expect(onHand1).toBe(20);
  });

  it('imports 2,000 rows in under 15 seconds without duplicates', async () => {
    const lines = [
      'category,product_name,variant_name,barcode,sku,cost_price,sale_price,opening_stock,low_stock_threshold',
    ];
    for (let i = 1; i <= 2000; i++) {
      lines.push(`Cat${i % 10},Product ${i},Default,BC${100000 + i},SKU${i},500,1000,10,2`);
    }
    const csvText = lines.join('\n');

    const start = performance.now();
    const preview = await previewCsvImport(db, shopId, csvText);
    expect(preview.globalErrors).toHaveLength(0);
    expect(preview.rows).toHaveLength(2000);

    const result = await executeCsvImport(db, shopId, deviceId, preview.rows, 'skip');
    const duration = performance.now() - start;

    expect(result.importedCount).toBe(2000);
    expect(duration).toBeLessThan(15000);

    const preview2 = await previewCsvImport(db, shopId, csvText);
    const result2 = await executeCsvImport(db, shopId, deviceId, preview2.rows, 'skip');
    expect(result2.importedCount).toBe(0);
    expect(result2.skippedCount).toBe(2000);
  });

  it('re-import does not repeat opening stock', async () => {
    const csvText = [
      'category,product_name,variant_name,barcode,sku,cost_price,sale_price,opening_stock,low_stock_threshold',
      'Vapes,Juice Pod,Mango,BARCODE999,SKU-MP,400,800,30,2',
    ].join('\n');

    const preview = await previewCsvImport(db, shopId, csvText);
    await executeCsvImport(db, shopId, deviceId, preview.rows, 'update');

    const productRepo = new ProductRepo(db);
    const variants = await productRepo.getVariants(shopId);
    const firstVariant = variants[0];
    expect(firstVariant).toBeDefined();

    const stockRepo = new StockRepo(db);
    const stockList1 = await stockRepo.getStockOnHand(shopId, firstVariant!.id);
    const onHand1 = stockList1[0]?.on_hand ?? 0;
    expect(onHand1).toBe(30);

    const preview2 = await previewCsvImport(db, shopId, csvText);
    await executeCsvImport(db, shopId, deviceId, preview2.rows, 'update');

    const stockList2 = await stockRepo.getStockOnHand(shopId, firstVariant!.id);
    const onHand2 = stockList2[0]?.on_hand ?? 0;
    expect(onHand2).toBe(30);
  });

  it('exports and restores a backup to a clean database', async () => {
    const csvText = [
      'category,product_name,variant_name,barcode,sku,cost_price,sale_price,opening_stock,low_stock_threshold',
      'Vapes,Test Vape,Default,B-TEST1,SKU-T1,500,1000,10,2',
    ].join('\n');
    const preview = await previewCsvImport(db, shopId, csvText);
    await executeCsvImport(db, shopId, deviceId, preview.rows, 'skip');

    const backupJson = await exportBackupJson(db, shopId);
    const validation = validateBackupJson(backupJson);
    expect(validation.success).toBe(true);
    expect(validation.data?.tables.products).toHaveLength(1);

    const dbNew = new SqliteTestAdapter();
    await dbNew.migrate();

    await restoreBackup(dbNew, validation.data!);

    const productRepoNew = new ProductRepo(dbNew);
    const productsNew = await productRepoNew.getProducts(shopId);
    expect(productsNew).toHaveLength(1);
    expect(productsNew[0]?.name).toBe('Test Vape');
  });

  it('restores stock, sales, returns, expenses, and the seeded P&L exactly', async () => {
    // Seed a full shop: one variant (cost 500, sale 1000, opening 10), two
    // cash sales (2 + 1 units), a restocked return of 1 unit, and an expense.
    const csvText = [
      'category,product_name,variant_name,barcode,sku,cost_price,sale_price,opening_stock,low_stock_threshold',
      'Vapes,Restore Vape,Default,B-REST1,SKU-R1,500,1000,10,2',
    ].join('\n');
    const preview = await previewCsvImport(db, shopId, csvText);
    await executeCsvImport(db, shopId, deviceId, preview.rows, 'skip');

    const variant = (await new ProductRepo(db).getVariants(shopId))[0]!;
    const saleRepo = new SaleRepo(db);
    const soldAt = '2026-11-16T10:00:00.000Z';
    const sale1 = await saleRepo.completeSale(
      {
        shop_id: shopId,
        device_id: deviceId,
        sold_at: soldAt,
        payment_method: 'cash',
        amount_received: 2000,
        discount_amount: 0,
        note: null,
        lines: [{ variant_id: variant.id, product_name: 'Restore Vape', variant_name: 'Default', qty: 2, list_price: 1000, unit_price: 1000 }],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      soldAt,
    );
    await saleRepo.completeSale(
      {
        shop_id: shopId,
        device_id: deviceId,
        sold_at: soldAt,
        payment_method: 'cash',
        amount_received: 1000,
        discount_amount: 0,
        note: null,
        lines: [{ variant_id: variant.id, product_name: 'Restore Vape', variant_name: 'Default', qty: 1, list_price: 1000, unit_price: 1000 }],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      soldAt,
    );
    await new ReturnRepo(db).processReturn(
      {
        shop_id: shopId,
        device_id: deviceId,
        sale_id: sale1.sale.id,
        returned_at: soldAt,
        refund_method: 'cash',
        note: 'Restocked return',
        lines: [{ sale_item_id: sale1.items[0]!.id, variant_id: variant.id, qty: 1, restocked: true }],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      soldAt,
    );
    await new ExpenseRepo(db).save({
      id: uuidv7(),
      shop_id: shopId,
      expense_date: '2026-11-16',
      amount: 100,
      category: 'Utilities',
      note: null,
      created_at: soldAt,
      updated_at: soldAt,
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
    });

    const backupJson = await exportBackupJson(db, shopId);
    const validation = validateBackupJson(backupJson);
    expect(validation.success).toBe(true);

    const dbNew = new SqliteTestAdapter();
    await dbNew.migrate();
    await restoreBackup(dbNew, validation.data!);

    // Stock: 10 opening - 3 sold + 1 restocked = 8
    const onHand = await new StockRepo(dbNew).getStockOnHand(shopId, variant.id);
    expect(onHand[0]!.on_hand).toBe(8);

    // Sales and returns reproduced with the same IDs.
    const salesNew = await new SaleRepo(dbNew).getSales(shopId);
    expect(salesNew).toHaveLength(2);
    const returnsNew = await new ReturnRepo(dbNew).getReturns(shopId);
    expect(returnsNew).toHaveLength(1);
    expect(returnsNew[0]!.sale_id).toBe(sale1.sale.id);
    expect(returnsNew[0]!.refund_amount).toBe(1000);

    // The seeded P&L is reproduced exactly (all nine fields).
    const pnl = await new ReportRepo(dbNew).getProfitAndLoss(shopId, '2026-11-01', '2026-11-30');
    expect(pnl.net_revenue).toBe(2000); // 3000 gross - 1000 refund
    expect(pnl.net_cogs).toBe(1000); // 3 x 500 - 500 restocked
    expect(pnl.gross_profit).toBe(1000);
    expect(pnl.expenses_total).toBe(100);
    expect(pnl.net_profit).toBe(900);
    expect(pnl.sales_count).toBe(2);
    expect(pnl.avg_sale_value).toBe(1500); // 3000 gross / 2 sales
    expect(pnl.cash_total).toBe(3000);
    expect(pnl.online_total).toBe(0);

    // Every restored synced row is marked dirty for sync.
    const tables = ['shops', 'devices', 'categories', 'products', 'variants', 'expenses', 'stock_movements', 'sales', 'sale_items', 'returns', 'return_items'];
    for (const table of tables) {
      const res = await dbNew.query<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table} WHERE dirty <> 1`);
      expect(res[0]!.c, `${table} rows must be dirty`).toBe(0);
    }

    // Counter recovery: the counter stores LAST-USED (Phase 5 convention), so
    // after two sales it must be '2' and the next receipt must be PC1-000003
    // without colliding with the restored ones.
    expect(await new SettingsRepo(dbNew).get('receipt_counter')).toBe('2');
    const nextSale = await new SaleRepo(dbNew).completeSale(
      {
        shop_id: shopId,
        device_id: deviceId,
        sold_at: soldAt,
        payment_method: 'cash',
        amount_received: 1000,
        discount_amount: 0,
        note: 'Post-restore sale',
        lines: [{ variant_id: variant.id, product_name: 'Restore Vape', variant_name: 'Default', qty: 1, list_price: 1000, unit_price: 1000 }],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      soldAt,
    );
    expect(nextSale.sale.receipt_no).toBe('PC1-000003');
  });

  it('rejects truncated and reference-inconsistent backups', async () => {
    // Seed one product so the backup has a cross-reference to break.
    const csvText = [
      'category,product_name,variant_name,barcode,sku,cost_price,sale_price,opening_stock,low_stock_threshold',
      'Vapes,Integrity Vape,Default,B-INT1,SKU-I1,500,1000,5,2',
    ].join('\n');
    const preview = await previewCsvImport(db, shopId, csvText);
    await executeCsvImport(db, shopId, deviceId, preview.rows, 'skip');

    const backupJson = await exportBackupJson(db, shopId);

    // Truncated JSON is rejected.
    expect(validateBackupJson(backupJson.slice(0, 40)).success).toBe(false);

    // An inconsistent backup (variant pointing at a deleted product row)
    // passes the schema but must fail referential validation.
    const tampered = JSON.parse(backupJson) as VfBackup;
    tampered.tables.products = [];
    const result = validateBackupJson(JSON.stringify(tampered));
    expect(result.success).toBe(false);
    expect(result.error).toContain('missing product');
  });

  it('leaves the old database usable when a restore fails mid-way', async () => {
    // Seed shop A (one product, one sale) and restore it onto a clean db.
    const csvText = [
      'category,product_name,variant_name,barcode,sku,cost_price,sale_price,opening_stock,low_stock_threshold',
      'Vapes,Backup A,Default,B-BKA1,SKU-A1,500,1000,5,2',
    ].join('\n');
    const preview = await previewCsvImport(db, shopId, csvText);
    await executeCsvImport(db, shopId, deviceId, preview.rows, 'skip');
    const variantA = (await new ProductRepo(db).getVariants(shopId))[0]!;
    const soldAt = '2026-11-16T10:00:00.000Z';
    await new SaleRepo(db).completeSale(
      {
        shop_id: shopId,
        device_id: deviceId,
        sold_at: soldAt,
        payment_method: 'cash',
        amount_received: 1000,
        discount_amount: 0,
        note: null,
        lines: [{ variant_id: variantA.id, product_name: 'Backup A', variant_name: 'Default', qty: 1, list_price: 1000, unit_price: 1000 }],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      soldAt,
    );

    const valid = validateBackupJson(await exportBackupJson(db, shopId));
    expect(valid.success).toBe(true);
    const dbNew = new SqliteTestAdapter();
    await dbNew.migrate();
    await restoreBackup(dbNew, valid.data!);

    // A schema-valid but corrupt backup: two variants sharing one barcode,
    // which violates idx_variants_barcode_unique mid-batch.
    const corrupt = JSON.parse(JSON.stringify(valid.data)) as VfBackup;
    const duplicate = { ...corrupt.tables.variants[0]!, id: uuidv7(), sku: 'SKU-DUP' };
    corrupt.tables.variants.push(duplicate);

    await expect(restoreBackup(dbNew, corrupt)).rejects.toThrow();

    // The failed restore wrote nothing: shop A's data is intact and usable.
    const productsAfter = await new ProductRepo(dbNew).getProducts(shopId);
    expect(productsAfter).toHaveLength(1);
    const salesAfter = await new SaleRepo(dbNew).getSales(shopId);
    expect(salesAfter).toHaveLength(1);
    expect(await new SettingsRepo(dbNew).get('receipt_counter')).toBe('1');

    // And the database still works: a new sale completes with the next number.
    const retry = await new SaleRepo(dbNew).completeSale(
      {
        shop_id: shopId,
        device_id: deviceId,
        sold_at: soldAt,
        payment_method: 'cash',
        amount_received: 1000,
        discount_amount: 0,
        note: null,
        lines: [{ variant_id: variantA.id, product_name: 'Backup A', variant_name: 'Default', qty: 1, list_price: 1000, unit_price: 1000 }],
      },
      uuidv7(),
      [uuidv7()],
      [uuidv7()],
      soldAt,
    );
    expect(retry.sale.receipt_no).toBe('PC1-000002');
  });

  it('rejects corrupt or invalid backup JSON', () => {
    const invalidJson = '{ "format_version": 1, "tables": { "shops": "not-an-array" } }';
    const validation = validateBackupJson(invalidJson);
    expect(validation.success).toBe(false);
    expect(validation.error).toBeDefined();
  });
});
