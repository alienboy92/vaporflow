import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { SQLiteSyncServer } from './sync/transport.js';
import { SyncEngine } from './sync/engine.js';
import { NetworkAdapter } from './adapters/types.js';
import { uuidv7 } from './uuid.js';
import { ShopRepo } from './repositories/shop.js';
import { DeviceRepo } from './repositories/device.js';
import { CategoryRepo } from './repositories/category.js';
import { ProductRepo } from './repositories/product.js';
import { StockRepo } from './repositories/stock.js';
import { SaleRepo } from './repositories/sale.js';

class MockNetworkAdapter implements NetworkAdapter {
  constructor(private online = true) {}
  isOnline(): boolean {
    return this.online;
  }
  setOnline(online: boolean) {
    this.online = online;
    for (const cb of this.listeners) {
      cb(online);
    }
  }
  private listeners: ((online: boolean) => void)[] = []
  onChange(callback: (online: boolean) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }
}

describe('Sync Engine & Two-Device Convergence (Phase 8A)', () => {
  let serverDb: SqliteTestAdapter;
  let clientADb: SqliteTestAdapter;
  let clientBDb: SqliteTestAdapter;

  let server: SQLiteSyncServer;
  let networkA: MockNetworkAdapter;
  let networkB: MockNetworkAdapter;

  let engineA: SyncEngine;
  let engineB: SyncEngine;

  const shopId = uuidv7();
  const time = '2026-11-16T12:00:00.000Z';
  let devAId: string;
  let devBId: string;

  beforeEach(async () => {
    const migrationsDir = path.resolve('packages/core/migrations');

    serverDb = new SqliteTestAdapter(':memory:');
    await serverDb.migrate(migrationsDir);

    clientADb = new SqliteTestAdapter(':memory:');
    await clientADb.migrate(migrationsDir);

    clientBDb = new SqliteTestAdapter(':memory:');
    await clientBDb.migrate(migrationsDir);

    server = new SQLiteSyncServer(serverDb);

    networkA = new MockNetworkAdapter(true);
    networkB = new MockNetworkAdapter(true);

    engineA = new SyncEngine(clientADb, server, networkA, shopId);
    engineB = new SyncEngine(clientBDb, server, networkB, shopId);

    // Initialize shop and devices on both clients
    const shopRepoA = new ShopRepo(clientADb);
    const shopRepoB = new ShopRepo(clientBDb);
    const deviceRepoA = new DeviceRepo(clientADb);
    const deviceRepoB = new DeviceRepo(clientBDb);

    devAId = uuidv7();
    devBId = uuidv7();

    const shopData = {
      id: shopId,
      shop_id: shopId,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: devAId,
      dirty: 1,
      server_updated_at: null,
      name: 'Vapor Shop',
      address: null,
      phone: null,
      logo_base64: null,
      show_logo_on_receipt: 0,
      currency_code: 'PKR',
      currency_decimals: 0,
      receipt_footer: 'Thanks',
      default_low_stock_threshold: 3,
    };

    await shopRepoA.saveShop(shopData);
    await deviceRepoA.saveDevice({
      id: devAId,
      shop_id: shopId,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: devAId,
      dirty: 1,
      server_updated_at: null,
      name: 'PC One',
      code: 'PC1',
      last_seen_at: null,
    });

    // Client B gets same shop but its own device
    await shopRepoB.saveShop(shopData);
    await deviceRepoB.saveDevice({
      id: devBId,
      shop_id: shopId,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: devBId,
      dirty: 1,
      server_updated_at: null,
      name: 'Phone One',
      code: 'PH1',
      last_seen_at: null,
    });

    // Initialize receipt counters for both devices
    await clientADb.batch([
      { sql: `INSERT INTO settings (key, value) VALUES ('receipt_counter', '0')` },
    ]);
    await clientBDb.batch([
      { sql: `INSERT INTO settings (key, value) VALUES ('receipt_counter', '0')` },
    ]);
  });

  afterEach(() => {
    serverDb.close();
    clientADb.close();
    clientBDb.close();
  });

  it('converges products, categories, and inventory between two devices via server sync', async () => {
    const catRepoA = new CategoryRepo(clientADb);
    const prodRepoA = new ProductRepo(clientADb);
    const stockRepoA = new StockRepo(clientADb);

    const categoryId = uuidv7();
    const productId = uuidv7();
    const variantId = uuidv7();

    await catRepoA.save({
      id: categoryId,
      shop_id: shopId,
      name: 'Vapes',
      sort_order: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });

    await prodRepoA.saveProduct({
      id: productId,
      shop_id: shopId,
      category_id: categoryId,
      name: 'Disposable',
      brand: 'BrandX',
      notes: null,
      is_active: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });

    await prodRepoA.saveVariant({
      id: variantId,
      shop_id: shopId,
      product_id: productId,
      name: 'Mint',
      sku: 'SKU1',
      barcode: '2000000000015',
      cost_price: 100,
      sale_price: 250,
      low_stock_threshold: 3,
      track_stock: 1,
      is_active: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });

    await stockRepoA.addMovement({
      id: uuidv7(),
      shop_id: shopId,
      variant_id: variantId,
      qty_change: 50,
      type: 'opening',
      ref_type: null,
      ref_id: null,
      unit_cost: 100,
      note: 'Opening stock',
      occurred_at: time,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });

    await engineA.syncNow();
    await engineB.syncNow();

    const stockRepoB = new StockRepo(clientBDb);
    const onHandB = await stockRepoB.getStockOnHand(shopId, variantId);
    expect(onHandB[0]?.on_hand).toBe(50);
  });

  it('both devices sell offline and converge to summed stock and identical totals', async () => {
    const catRepoA = new CategoryRepo(clientADb);
    const prodRepoA = new ProductRepo(clientADb);
    const stockRepoA = new StockRepo(clientADb);

    const categoryId = uuidv7();
    const productId = uuidv7();
    const variantId = uuidv7();

    await catRepoA.save({
      id: categoryId,
      shop_id: shopId,
      name: 'General',
      sort_order: 0,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });

    await prodRepoA.saveProduct({
      id: productId,
      shop_id: shopId,
      category_id: categoryId,
      name: 'Juice',
      brand: null,
      notes: null,
      is_active: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });

    await prodRepoA.saveVariant({
      id: variantId,
      shop_id: shopId,
      product_id: productId,
      name: 'Default',
      sku: null,
      barcode: '2000000000022',
      cost_price: 200,
      sale_price: 500,
      low_stock_threshold: null,
      track_stock: 1,
      is_active: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });

    await stockRepoA.addMovement({
      id: uuidv7(),
      shop_id: shopId,
      variant_id: variantId,
      qty_change: 100,
      type: 'opening',
      ref_type: null,
      ref_id: null,
      unit_cost: 200,
      note: 'Opening',
      occurred_at: time,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });

    await engineA.syncNow();
    await engineB.syncNow();

    networkA.setOnline(false);
    networkB.setOnline(false);

    // Device A sells 10 units
    const saleRepoA = new SaleRepo(clientADb);
    const saleIdA = uuidv7();
    const itemIdA = uuidv7();
    const movementIdA = uuidv7();
    await saleRepoA.completeSale(
      {
        shop_id: shopId,
        device_id: devAId,
        sold_at: time,
        payment_method: 'cash',
        amount_received: 5000,
        discount_amount: 0,
        note: null,
        lines: [
          {
            variant_id: variantId,
            product_name: 'Juice',
            variant_name: 'Default',
            qty: 10,
            list_price: 500,
            unit_price: 500,
          },
        ],
      },
      saleIdA,
      [itemIdA],
      [movementIdA],
      time,
    );

    // Device B sells 15 units
    const saleRepoB = new SaleRepo(clientBDb);
    const saleIdB = uuidv7();
    const itemIdB = uuidv7();
    const movementIdB = uuidv7();
    await saleRepoB.completeSale(
      {
        shop_id: shopId,
        device_id: devBId,
        sold_at: time,
        payment_method: 'online',
        amount_received: null,
        discount_amount: 0,
        note: null,
        lines: [
          {
            variant_id: variantId,
            product_name: 'Juice',
            variant_name: 'Default',
            qty: 15,
            list_price: 500,
            unit_price: 500,
          },
        ],
      },
      saleIdB,
      [itemIdB],
      [movementIdB],
      time,
    );

    networkA.setOnline(true);
    networkB.setOnline(true);

    await engineA.syncNow();
    await engineB.syncNow();
    await engineA.syncNow();

    const stockA = await new StockRepo(clientADb).getStockOnHand(shopId, variantId);
    const stockB = await new StockRepo(clientBDb).getStockOnHand(shopId, variantId);

    expect(stockA[0]?.on_hand).toBe(75);
    expect(stockB[0]?.on_hand).toBe(75);

    const salesA = await saleRepoA.getSales(shopId);
    const salesB = await saleRepoB.getSales(shopId);
    expect(salesA).toHaveLength(2);
    expect(salesB).toHaveLength(2);
  });

  it('preserves a dirty newer local mutable row over older server row', async () => {
    const prodRepoA = new ProductRepo(clientADb);
    const productId = uuidv7();

    await prodRepoA.saveProduct({
      id: productId,
      shop_id: shopId,
      category_id: null,
      name: 'Original Name',
      brand: null,
      notes: null,
      is_active: 1,
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });

    await engineA.syncNow();
    await engineB.syncNow();

    const prodRepoB = new ProductRepo(clientBDb);
    await prodRepoB.saveProduct({
      id: productId,
      shop_id: shopId,
      category_id: null,
      name: 'Client B Newer Name',
      brand: null,
      notes: null,
      is_active: 1,
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T14:00:00.000Z',
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: '2026-11-16T11:00:00.000Z',
    });

    await engineB.syncNow();

    const productB = await prodRepoB.getProductById(productId);
    expect(productB?.name).toBe('Client B Newer Name');
  });

  it('handles duplicate barcode conflict and exposes sync problem', async () => {
    const prodRepoA = new ProductRepo(clientADb);
    const prodRepoB = new ProductRepo(clientBDb);

    const productIdA = uuidv7();
    const productIdB = uuidv7();
    const barcode = '3000000000001';

    await prodRepoA.saveProduct({
      id: productIdA,
      shop_id: shopId,
      category_id: null,
      name: 'Prod A',
      brand: null,
      notes: null,
      is_active: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });
    await prodRepoA.saveVariant({
      id: uuidv7(),
      shop_id: shopId,
      product_id: productIdA,
      name: 'V1',
      sku: null,
      barcode,
      cost_price: 10,
      sale_price: 20,
      low_stock_threshold: null,
      track_stock: 1,
      is_active: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });

    await prodRepoB.saveProduct({
      id: productIdB,
      shop_id: shopId,
      category_id: null,
      name: 'Prod B',
      brand: null,
      notes: null,
      is_active: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });
    await prodRepoB.saveVariant({
      id: uuidv7(),
      shop_id: shopId,
      product_id: productIdB,
      name: 'V2',
      sku: null,
      barcode,
      cost_price: 15,
      sale_price: 25,
      low_stock_threshold: null,
      track_stock: 1,
      is_active: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });

    await engineA.syncNow();
    await engineB.syncNow();

    const statusB = await engineB.getStatus();
    expect(statusB.problems.length).toBeGreaterThan(0);
    expect(statusB.problems[0]?.error).toContain('Duplicate barcode conflict');
  });
});