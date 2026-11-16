import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { SQLiteSyncServer } from './sync/transport.js';
import { SyncEngine } from './sync/engine.js';
import { NetworkAdapter } from './adapters/types.js';
import { SyncTransport } from './sync/types.js';
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

/** Injectable fake timers so backoff/queued-sync behavior is deterministic. */
class TimerHarness {
  private timers = new Map<number, { cb: () => void; delay: number }>();
  private nextId = 1;

  setTimeout = ((cb: () => void, delay?: number) => {
    const id = this.nextId++;
    this.timers.set(id, { cb, delay: delay ?? 0 });
    return id as unknown as NodeJS.Timeout;
  }) as unknown as typeof setTimeout;

  clearTimeout = ((id: NodeJS.Timeout | null | undefined) => {
    if (id != null) this.timers.delete(Number(id));
  }) as unknown as typeof clearTimeout;

  // The 30s interval is never exercised in these tests (they call syncNow
  // directly instead of start()); a no-op stub keeps open handles away.
  setInterval = ((_cb: () => void, _ms?: number) =>
    this.nextId++ as unknown as NodeJS.Timeout) as unknown as typeof setInterval;
  clearInterval = (() => {}) as unknown as typeof clearInterval;

  delays(): number[] {
    return [...this.timers.values()].map((t) => t.delay);
  }
  /** Runs and clears every pending callback (callback re-arms are kept). */
  runAll(): void {
    const pending = [...this.timers.values()];
    this.timers.clear();
    for (const t of pending) t.cb();
  }
}

/** Injects a poisoned row into every variants pull, to exercise rollback. */
class PoisonedPullTransport implements SyncTransport {
  constructor(private inner: SyncTransport, private poison: Record<string, unknown>) {}
  async push(table: string, rows: unknown[]) {
    return this.inner.push(table, rows);
  }
  async pull(table: string, shopId: string, ts: string | null, id: string | null, limit: number) {
    const rows = await this.inner.pull(table, shopId, ts, id, limit);
    if (table === 'variants') {
      return [...rows, this.poison];
    }
    return rows;
  }
}

/** Records every push/pull and can fail pushes on demand. */
class SpyTransport implements SyncTransport {
  pushCalls: Array<{ table: string; rows: unknown[] }> = [];
  pullCalls: Array<{ table: string; ts: string | null; id: string | null; limit: number }> = [];
  failNextPushes = 0;

  constructor(private inner: SyncTransport) {}

  async push(table: string, rows: unknown[]) {
    this.pushCalls.push({ table, rows });
    if (this.failNextPushes > 0) {
      this.failNextPushes--;
      throw new Error('Simulated transport failure');
    }
    return this.inner.push(table, rows);
  }

  async pull(table: string, shopId: string, ts: string | null, id: string | null, limit: number) {
    this.pullCalls.push({ table, ts, id, limit });
    return this.inner.pull(table, shopId, ts, id, limit);
  }

  pullsFor(table: string) {
    return this.pullCalls.filter((c) => c.table === table);
  }
}

/** Hangs pushes for a chosen table until settle() is called. */
class DeferredPushTransport implements SyncTransport {
  private pending: Array<{ resolve: () => void }> = [];
  private passThrough = false;
  pushCalled: Promise<void>;
  private notifyPush!: () => void;

  constructor(
    private hangTable: string,
    private inner: SyncTransport,
  ) {
    this.pushCalled = new Promise((resolve) => {
      this.notifyPush = resolve;
    });
  }

  async push(table: string, rows: unknown[]): Promise<{ accepted: number }> {
    if (table !== this.hangTable) {
      return this.inner.push(table, rows);
    }
    this.notifyPush();
    if (this.passThrough) {
      return this.inner.push(table, rows);
    }
    await new Promise<void>((resolve) => {
      this.pending.push({ resolve });
    });
    return this.inner.push(table, rows);
  }

  async pull(
    table: string,
    shopId: string,
    ts: string | null,
    id: string | null,
    limit: number,
  ): Promise<unknown[]> {
    return this.inner.pull(table, shopId, ts, id, limit);
  }

  /** Releases all pending pushes; later pushes pass through immediately. */
  settle(): void {
    this.passThrough = true;
    const pending = this.pending;
    this.pending = [];
    for (const p of pending) p.resolve();
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
    // The transport is batch-atomic like the real sync_push RPC: B's variant
    // batch (the one carrying the conflicting barcode) is rejected whole and
    // nothing in it is written. B's earlier batches (shop, device, product)
    // have no conflict and do land — each table pushes as its own batch.
    await expect(engineB.syncNow()).rejects.toThrow(/Duplicate barcode conflict/);

    const statusB = await engineB.getStatus();
    expect(statusB.lastError).toContain('Duplicate barcode conflict');
    expect(statusB.problems.length).toBeGreaterThan(0);
    expect(statusB.problems[0]?.error).toContain('Duplicate barcode conflict');
    // The conflicting variant never reached the server and stays dirty on B.
    const serverVariant = await serverDb.query<{ id: string }>(
      `SELECT id FROM variants WHERE name = 'V2'`,
    );
    expect(serverVariant).toHaveLength(0);
    const localVariant = await clientBDb.query<{ dirty: number }>(
      `SELECT dirty FROM variants WHERE name = 'V2'`,
    );
    expect(localVariant[0]!.dirty).toBe(1);
  });

  it('pushes production-shaped wire rows (booleans, no dirty/server_updated_at)', async () => {
    const spy = new SpyTransport(server);
    const engine = new SyncEngine(clientADb, spy, networkA, shopId);
    const prodRepo = new ProductRepo(clientADb);
    await prodRepo.saveProduct({
      id: uuidv7(),
      shop_id: shopId,
      category_id: null,
      name: 'Wire Shape',
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

    await engine.syncNow();

    const push = spy.pushCalls.find((c) => c.table === 'products');
    expect(push).toBeDefined();
    const row = push!.rows[0] as Record<string, unknown>;
    // Exactly what jsonb_populate_record receives in production.
    expect(row.is_active).toBe(true);
    expect('dirty' in row).toBe(false);
    expect('server_updated_at' in row).toBe(false);
  });

  it('keeps the stored row on equal or older updated_at (strict LWW) and serves wire rows to pullers', async () => {
    // Wire-shaped rows straight from "PostgreSQL": booleans true/false, no
    // dirty column. The fake server accepts exactly this shape.
    await server.push('shops', [
      {
        id: shopId,
        shop_id: shopId,
        created_at: time,
        updated_at: time,
        deleted_at: null,
        device_id: devAId,
        name: 'Vapor Shop',
        address: null,
        phone: null,
        logo_base64: null,
        show_logo_on_receipt: false,
        currency_code: 'PKR',
        currency_decimals: 0,
        receipt_footer: 'Thanks',
        default_low_stock_threshold: 3,
      },
    ]);
    const productId = uuidv7();
    const variantId = uuidv7();
    await server.push('products', [
      {
        id: productId,
        shop_id: shopId,
        created_at: time,
        updated_at: time,
        deleted_at: null,
        device_id: devAId,
        category_id: null,
        name: 'Tie Product',
        brand: null,
        notes: null,
        is_active: true,
      },
    ]);
    const variant = {
      id: variantId,
      shop_id: shopId,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: devAId,
      product_id: productId,
      name: 'Default',
      sku: null,
      barcode: '9000000000009',
      cost_price: 100,
      sale_price: 200,
      low_stock_threshold: null,
      track_stock: true,
      is_active: true,
    };
    await server.push('variants', [variant]);

    // Equal updated_at: acknowledged, but NOT applied (real RPC uses strict >).
    await server.push('variants', [{ ...variant, sale_price: 999 }]);
    let stored = await serverDb.query<{ sale_price: number }>(
      `SELECT sale_price FROM variants WHERE id = ?`,
      [variantId],
    );
    expect(stored[0]!.sale_price).toBe(200);

    // Older: not applied either.
    await server.push('variants', [
      { ...variant, sale_price: 555, updated_at: '2026-11-16T11:00:00.000Z' },
    ]);
    stored = await serverDb.query(`SELECT sale_price FROM variants WHERE id = ?`, [variantId]);
    expect(stored[0]!.sale_price).toBe(200);

    // Strictly newer: applied.
    await server.push('variants', [
      { ...variant, sale_price: 777, updated_at: '2026-11-16T15:00:00.000Z' },
    ]);
    stored = await serverDb.query(`SELECT sale_price FROM variants WHERE id = ?`, [variantId]);
    expect(stored[0]!.sale_price).toBe(777);

    // A fresh client pulls the wire-shaped row and stores local shape.
    await engineB.syncNow();
    const pulled = await clientBDb.query<{ is_active: number; sale_price: number; dirty: number }>(
      `SELECT is_active, sale_price, dirty FROM variants WHERE id = ?`,
      [variantId],
    );
    expect(pulled[0]!.is_active).toBe(1);
    expect(pulled[0]!.sale_price).toBe(777);
    expect(pulled[0]!.dirty).toBe(0);
  });

  it('schedules an exponential backoff retry and clears lastError after success', async () => {
    const timers = new TimerHarness();
    const spy = new SpyTransport(server);
    spy.failNextPushes = 1;
    const engine = new SyncEngine(clientADb, spy, networkA, shopId, {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
    });
    await new ProductRepo(clientADb).saveProduct({
      id: uuidv7(),
      shop_id: shopId,
      category_id: null,
      name: 'Backoff Product',
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

    await expect(engine.syncNow()).rejects.toThrow('Simulated transport failure');

    let status = await engine.getStatus();
    expect(status.status).toBe('error');
    expect(status.lastError).toBe('Simulated transport failure');
    expect(status.lastSuccessAt).toBeNull();
    // First failure -> 1s backoff, scheduled and tracked.
    expect(timers.delays()).toEqual([1000]);

    // The backoff retry succeeds.
    timers.runAll();
    await vi.waitFor(async () => {
      const s = await engine.getStatus();
      expect(s.lastSuccessAt).not.toBeNull();
    });
    status = await engine.getStatus();
    expect(status.lastError).toBeNull();
    expect(status.status).toBe('synced');
    expect(status.pendingCount).toBe(0);
  });

  it('preserves a local edit made while a push is in flight', async () => {
    const deferred = new DeferredPushTransport('products', server);
    const engine = new SyncEngine(clientADb, deferred, networkA, shopId);
    const prodRepo = new ProductRepo(clientADb);
    const productId = uuidv7();
    await prodRepo.saveProduct({
      id: productId,
      shop_id: shopId,
      category_id: null,
      name: 'In Flight',
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

    const syncing = engine.syncNow();
    await deferred.pushCalled; // the products push hangs; earlier tables passed

    // The user edits the product while the push is still in flight.
    await prodRepo.saveProduct({
      id: productId,
      shop_id: shopId,
      category_id: null,
      name: 'Edited In Flight',
      brand: null,
      notes: null,
      is_active: 1,
      created_at: time,
      updated_at: '2026-11-16T13:00:00.000Z',
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });
    deferred.settle();
    await syncing;

    // The pre-edit snapshot must not clear the edited row's dirty flag: the
    // conditional clear only matches the exact acknowledged version.
    const row = await clientADb.query<{ name: string; dirty: number }>(
      `SELECT name, dirty FROM products WHERE id = ?`,
      [productId],
    );
    expect(row[0]!.name).toBe('Edited In Flight');
    expect(row[0]!.dirty).toBe(1);

    // The follow-up sync pushes the edited version and everything settles.
    await engine.syncNow();
    const after = await clientADb.query<{ dirty: number }>(
      `SELECT dirty FROM products WHERE id = ?`,
      [productId],
    );
    expect(after[0]!.dirty).toBe(0);
    const serverRow = await serverDb.query<{ name: string }>(
      `SELECT name FROM products WHERE id = ?`,
      [productId],
    );
    expect(serverRow[0]!.name).toBe('Edited In Flight');
  });

  it('does not advance the pull cursor when applying a page fails, and re-pulls it on retry', async () => {
    // Baseline: A creates a variant; both devices sync so B holds a cursor.
    const prodRepoA = new ProductRepo(clientADb);
    const productId = uuidv7();
    const variantId = uuidv7();
    const barcode = '7000000000003';
    await prodRepoA.saveProduct({
      id: productId,
      shop_id: shopId,
      category_id: null,
      name: 'Rollback Product',
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
      barcode,
      cost_price: 100,
      sale_price: 200,
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

    const cursorBefore = await clientBDb.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key LIKE 'sync_cursor_variants%'`,
    );

    // Simulate a page the client cannot apply: a valid wire-shaped variant
    // row whose barcode collides with the local partial unique index (the
    // RPC itself could never create it, but the client must survive the
    // situation without wedging or advancing the cursor).
    const poisoned = new PoisonedPullTransport(server, {
      id: uuidv7(),
      shop_id: shopId,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      product_id: productId,
      name: 'Rogue',
      sku: null,
      barcode,
      cost_price: 100,
      sale_price: 200,
      low_stock_threshold: null,
      track_stock: true,
      is_active: true,
      server_updated_at: '2026-11-16T14:00:00.000Z',
    });
    const spy = new SpyTransport(poisoned);
    const engine = new SyncEngine(clientBDb, spy, networkB, shopId);
    await engine.syncNow(); // applies nothing; records a problem

    const status = await engine.getStatus();
    expect(status.problems.some((p) => p.error.includes('Pull apply failed'))).toBe(true);

    const cursorAfter = await clientBDb.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key LIKE 'sync_cursor_variants%'`,
    );
    expect(new Map(cursorAfter.map((r) => [r.key, r.value]))).toEqual(
      new Map(cursorBefore.map((r) => [r.key, r.value])),
    );

    // Retry re-pulls the same page: cursor rewound from the same stored value.
    await engine.syncNow();
    const pulls = spy.pullsFor('variants');
    expect(pulls.length).toBe(2);
    expect(pulls[0]!.ts).toBe(pulls[1]!.ts);
    expect(pulls[0]!.id).toBe(pulls[1]!.id);
  });

  it('re-pulls each cycle with a 5-second rewound cursor', async () => {
    const spy = new SpyTransport(server);
    const engine = new SyncEngine(clientBDb, spy, networkB, shopId);
    const catRepoA = new CategoryRepo(clientADb);

    await catRepoA.save({
      id: uuidv7(),
      shop_id: shopId,
      name: 'Overlap One',
      sort_order: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });
    await engineA.syncNow();
    await engine.syncNow(); // first pull: null cursor

    // The cursor stored after the first cycle is what the second cycle
    // rewinds by 5 seconds.
    const stored = await clientBDb.query<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'sync_cursor_categories_timestamp'`,
    );
    const expected = new Date(new Date(stored[0]!.value).getTime() - 5000).toISOString();

    await catRepoA.save({
      id: uuidv7(),
      shop_id: shopId,
      name: 'Overlap Two',
      sort_order: 2,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });
    await engineA.syncNow();
    await engine.syncNow(); // second pull: stored cursor rewound by 5s

    const pulls = spy.pullsFor('categories');
    expect(pulls[0]!.ts).toBeNull();
    expect(pulls[1]!.ts).toBe(expected);
  });

  it('catches up more than 500 offline rows across push and pull pages', async () => {
    const catRepoA = new CategoryRepo(clientADb);
    const prodRepoA = new ProductRepo(clientADb);
    const stockRepoA = new StockRepo(clientADb);
    const categoryId = uuidv7();
    const productId = uuidv7();
    const variantId = uuidv7();
    await catRepoA.save({
      id: categoryId,
      shop_id: shopId,
      name: 'Bulk',
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
      name: 'Bulk Product',
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
      barcode: '6000000000006',
      cost_price: 100,
      sale_price: 200,
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

    // 1200 offline movements: push pages 200 at a time, pull pages 500.
    for (let i = 0; i < 1200; i++) {
      await stockRepoA.addMovement({
        id: uuidv7(),
        shop_id: shopId,
        variant_id: variantId,
        qty_change: 1,
        type: 'restock',
        ref_type: null,
        ref_id: null,
        unit_cost: null,
        note: `Restock ${i}`,
        occurred_at: time,
        created_at: time,
        updated_at: time,
        deleted_at: null,
        device_id: devAId,
        dirty: 1,
        server_updated_at: null,
      });
    }
    await engineA.syncNow();
    await engineB.syncNow();

    const onB = await clientBDb.query<{ c: number }>(
      `SELECT COUNT(*) AS c FROM stock_movements WHERE variant_id = ?`,
      [variantId],
    );
    expect(onB[0]!.c).toBe(1200);
    const onA = await clientADb.query<{ c: number }>(
      `SELECT COUNT(*) AS c FROM stock_movements WHERE variant_id = ?`,
      [variantId],
    );
    expect(onA[0]!.c).toBe(1200);
    const statusA = await engineA.getStatus();
    expect(statusA.pendingCount).toBe(0);
  });

  it('queues an overlapping sync request and completes it afterwards', async () => {
    const timers = new TimerHarness();
    const engine = new SyncEngine(clientADb, server, networkA, shopId, {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
    });
    await new CategoryRepo(clientADb).save({
      id: uuidv7(),
      shop_id: shopId,
      name: 'Queued',
      sort_order: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });

    const first = engine.syncNow();
    const second = engine.syncNow(); // arrives mid-run: must queue, not race
    await first;
    await second;
    // The queued run is scheduled, then runs through the timer.
    expect(timers.delays()).toContain(100);
    timers.runAll();
    await vi.waitFor(async () => {
      const s = await engine.getStatus();
      expect(s.isSyncing).toBe(false);
    });
    const status = await engine.getStatus();
    expect(status.pendingCount).toBe(0);
    expect(status.lastError).toBeNull();
    expect(status.status).toBe('synced');
  });

  it('propagates soft deletes to the other device and never resurrects them', async () => {
    const catRepoA = new CategoryRepo(clientADb);
    const catId = uuidv7();
    await catRepoA.save({
      id: catId,
      shop_id: shopId,
      name: 'Doomed',
      sort_order: 1,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: shopId,
      dirty: 1,
      server_updated_at: null,
    });
    await engineA.syncNow();
    await engineB.syncNow();
    let onB = await clientBDb.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM categories WHERE id = ?`,
      [catId],
    );
    expect(onB[0]!.deleted_at).toBeNull();

    const deletedAt = '2026-11-16T14:00:00.000Z';
    await clientADb.batch([
      {
        sql: `UPDATE categories SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
        params: [deletedAt, deletedAt, catId],
      },
    ]);
    await engineA.syncNow();
    await engineB.syncNow();

    onB = await clientBDb.query(`SELECT deleted_at FROM categories WHERE id = ?`, [catId]);
    expect(onB[0]!.deleted_at).toBe(deletedAt);

    // Further cycles must not resurrect the tombstoned row.
    await engineA.syncNow();
    await engineB.syncNow();
    onB = await clientBDb.query(`SELECT deleted_at FROM categories WHERE id = ?`, [catId]);
    expect(onB[0]!.deleted_at).toBe(deletedAt);
  });
});