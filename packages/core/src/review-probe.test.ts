import { BatchSchema } from './adapters/validation.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { previewCsvImport, executeCsvImport } from './csv-import.js';
import { exportBackupJson, validateBackupJson, restoreBackup } from './backup.js';
import { ShopRepo } from './repositories/shop.js';
import { DeviceRepo } from './repositories/device.js';
import { ProductRepo } from './repositories/product.js';
import { StockRepo } from './repositories/stock.js';
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

  it('rejects fractional, non-finite and unsafe CSV prices before import', async () => {
    for (const price of ['12.50', '1.00000000000000001', 'Infinity', '9007199254740992']) {
      const preview = await previewCsvImport(db, shopId, `product_name,cost_price,sale_price\nProbe,${price},20`);
      expect(preview.rows[0]?.errors.length).toBeGreaterThan(0);
    }
  });

  it('review probe: valid restore into populated database', async () => {
    const csv = 'category,product_name,variant_name,cost_price,sale_price,opening_stock\nGeneral,Probe,Default,10,20,5';
    await executeCsvImport(db, shopId, deviceId, (await previewCsvImport(db, shopId, csv)).rows, 'skip');
    const reads = vi.spyOn(db, 'query');
    const backup = validateBackupJson(await exportBackupJson(db, shopId)).data!;
    expect(reads).toHaveBeenCalledTimes(1);
    reads.mockRestore();
    await db.query("INSERT INTO settings(key,value) VALUES ('sync_cursor_sales_timestamp','old'),('sync_cursor_sales_id','old')");
    await restoreBackup(db, backup);
    expect(await db.query("SELECT key FROM settings WHERE key GLOB 'sync_cursor_*'")).toEqual([]);
    expect((await new StockRepo(db).getStockOnHand(shopId))[0]!.on_hand).toBe(5);
    await expect(db.query('DELETE FROM stock_movements')).rejects.toThrow('Ledger rows are immutable');
  });
  it('review probe: failed chunk rolls back cached parents and counts', async () => {
    const csv = ['category,product_name,variant_name,cost_price,sale_price,opening_stock', ...Array.from({length: 201}, (_, i) => `General,Probe,V${i},10,20,1`)].join('\n');
    const preview = await previewCsvImport(db, shopId, csv);
    const original = db.batch.bind(db);
    let calls = 0;
    db.batch = async statements => { if (++calls === 1) throw new Error('injected chunk failure'); await original(statements); };
    const result = await executeCsvImport(db, shopId, deviceId, preview.rows, 'skip');
    expect(result.importedCount).toBe(1);
    expect((await db.query('SELECT * FROM variants')).length).toBe(1);
    expect((await db.query('SELECT * FROM products')).length).toBe(1);
    expect((await db.query('SELECT * FROM categories')).length).toBe(1);
    db.batch = original;
    const retry = await executeCsvImport(db, shopId, deviceId, preview.rows, 'skip');
    expect(retry.importedCount).toBe(200);
    expect(retry.skippedCount).toBe(1);
    expect((await db.query('SELECT * FROM variants')).length).toBe(201);
    expect((await new StockRepo(db).getStockOnHand(shopId)).reduce((sum, row) => sum + row.on_hand, 0)).toBe(201);
  });
  it('review probe: clean restore selects an available device', async () => {
    const backup = validateBackupJson(await exportBackupJson(db, shopId)).data!;
    const target = new SqliteTestAdapter();
    await target.migrate();
    await restoreBackup(target, backup);
    expect(await new SettingsRepo(target).get('active_device_id')).toBe(deviceId);
  });
  it('preserves the local device and PIN when the backup lacks that device', async () => {
    const backup = validateBackupJson(await exportBackupJson(db, shopId)).data!;
    const localId = uuidv7();
    await new DeviceRepo(db).saveDevice({ ...backup.tables.devices[0]!, id: localId, code: 'PH1', name: 'Local phone' });
    const settings = new SettingsRepo(db);
    await settings.set('active_device_id', localId);
    await settings.set('pin_hash', 'local-only');
    await settings.set('pull_cursor_sales', 'stale');
    await restoreBackup(db, backup);
    expect((await new DeviceRepo(db).getActiveDevice(shopId))?.id).toBe(localId);
    expect(await settings.get('pin_hash')).toBe('local-only');
    expect(await settings.get('pull_cursor_sales')).toBeNull();
  });
  it('restores more than 10,000 rows through adapter batch validation', async () => {
    const csv = 'category,product_name,variant_name,cost_price,sale_price,opening_stock\nGeneral,Large,Default,10,20,0';
    await executeCsvImport(db, shopId, deviceId, (await previewCsvImport(db, shopId, csv)).rows, 'skip');
    const backup = validateBackupJson(await exportBackupJson(db, shopId)).data!;
    const template = backup.tables.variants[0]!;
    backup.tables.variants = Array.from({ length: 10001 }, (_, index) => ({ ...template, id: uuidv7(), name: 'V' + index }));
    const batch = db.batch.bind(db);
    db.batch = async (statements) => { BatchSchema.parse(statements); await batch(statements); };
    await restoreBackup(db, backup);
    expect((await new ProductRepo(db).getVariants(shopId)).length).toBe(10001);
  });
  it('rolls back data, counter, and protections when activation fails', async () => {
    const csv = 'category,product_name,variant_name,cost_price,sale_price,opening_stock\nGeneral,Original,Default,10,20,5';
    await executeCsvImport(db, shopId, deviceId, (await previewCsvImport(db, shopId, csv)).rows, 'skip');
    const backup = validateBackupJson(await exportBackupJson(db, shopId)).data!;
    backup.tables.products[0]!.name = 'Replacement';
    await new SettingsRepo(db).set('receipt_counter', '17');
    const batch = db.batch.bind(db);
    for (const boundary of ['receipt_counter', 'CREATE TRIGGER']) {
      db.batch = async (statements) => {
        const index = statements.findIndex((s) => s.sql.includes(boundary));
        expect(index).toBeGreaterThan(0);
        const injected = [...statements];
        injected.splice(index, 0, { sql: 'INSERT INTO _operation_guards(id, valid) VALUES (?, 0)', params: [uuidv7()] });
        await batch(injected);
      };
      await expect(restoreBackup(db, backup)).rejects.toThrow();
      expect((await new ProductRepo(db).getProducts(shopId))[0]!.name).toBe('Original');
      expect(await new SettingsRepo(db).get('receipt_counter')).toBe('17');
      await expect(db.query('DELETE FROM stock_movements')).rejects.toThrow('Ledger rows are immutable');
      await expect(db.query('UPDATE stock_movements SET qty_change = 50')).rejects.toThrow('Ledger rows are immutable');
    }
    db.batch = batch;
    await restoreBackup(db, backup);
    expect((await new ProductRepo(db).getProducts(shopId))[0]!.name).toBe('Replacement');
    expect(await new SettingsRepo(db).get('receipt_counter')).toBe('17');
  });
  it('review probe: concurrent counts do not double-adjust', async () => {
    const csv = 'category,product_name,variant_name,cost_price,sale_price,opening_stock\nGeneral,Probe,Default,10,20,10';
    await executeCsvImport(db, shopId, deviceId, (await previewCsvImport(db, shopId, csv)).rows, 'skip');
    const variant = (await new ProductRepo(db).getVariants(shopId))[0]!;
    const stock = new StockRepo(db);
    const now = new Date().toISOString();
    await Promise.all([stock.adjustStock(shopId, variant.id, 5, 'Count', deviceId, now), stock.adjustStock(shopId, variant.id, 5, 'Count', deviceId, now)]);
    expect((await stock.getStockOnHand(shopId, variant.id))[0]!.on_hand).toBe(5);
  });
});
