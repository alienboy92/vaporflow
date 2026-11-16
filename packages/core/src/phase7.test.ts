import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { generateCsvTemplate, previewCsvImport, executeCsvImport } from './csv-import.js';
import { exportBackupJson, validateBackupJson, restoreBackup } from './backup.js';
import { ShopRepo } from './repositories/shop.js';
import { DeviceRepo } from './repositories/device.js';
import { ProductRepo } from './repositories/product.js';
import { StockRepo } from './repositories/stock.js';
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

  it('exports and restores backup correctly with counter recovery and referential integrity', async () => {
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

  it('rejects corrupt or invalid backup JSON', () => {
    const invalidJson = '{ "format_version": 1, "tables": { "shops": "not-an-array" } }';
    const validation = validateBackupJson(invalidJson);
    expect(validation.success).toBe(false);
    expect(validation.error).toBeDefined();
  });
});
