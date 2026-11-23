import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { SqliteTestAdapter } from '../testing/sqlite-test-adapter.js';
import { SQLiteSyncServer } from './transport.js';
import { LegacySyncEngine as SyncEngine } from '../testing/legacy-sync-engine.js';
import { probeShopExists, enrollExistingShop as enroll, enrollOwnerShop } from './enrollment.js';
import type { NetworkAdapter } from '../adapters/types.js';
import type { SyncTransport } from './types.js';
import { uuidv7 } from '../uuid.js';
import { ShopRepo } from '../repositories/shop.js';
import { DeviceRepo } from '../repositories/device.js';
import { SettingsRepo } from '../repositories/settings.js';
import { CategoryRepo } from '../repositories/category.js';
import { ProductRepo } from '../repositories/product.js';
import { StockRepo } from '../repositories/stock.js';
import { SaleRepo } from '../repositories/sale.js';

function enrollExistingShop(...[db,transport,network,shop,options]: Parameters<typeof enroll>) {
  return enroll(db,transport,network,shop,{...options,engineClass:SyncEngine});
}

class MockNetworkAdapter implements NetworkAdapter {
  constructor(private online = true) {}
  isOnline(): boolean {
    return this.online;
  }
  setOnline(online: boolean) {
    this.online = online;
  }
  onChange(): () => void {
    return () => {};
  }
}

/** Fails a chosen call (default: the device-row push), then passes through. */
class FailOnceTransport implements SyncTransport {
  private calls = 0;
  failOnCall = 2;
  constructor(private inner: SyncTransport) {}
  private gate(): void {
    this.calls++;
    if (this.calls === this.failOnCall) {
      throw new Error('Simulated enrollment outage');
    }
  }
  async push(table: string, rows: unknown[]) {
    this.gate();
    return this.inner.push(table, rows);
  }
  async pull(table: string, shopId: string, ts: string | null, id: string | null, limit: number) {
    this.gate();
    return this.inner.pull(table, shopId, ts, id, limit);
  }
}

describe('Second-Device Cloud Enrollment (Phase 8B)', () => {
  let serverDb: SqliteTestAdapter;
  let ownerDb: SqliteTestAdapter;
  let joinDb: SqliteTestAdapter;

  let server: SQLiteSyncServer;
  let networkOwner: MockNetworkAdapter;
  let networkJoin: MockNetworkAdapter;

  const shopId = uuidv7();
  const time = '2026-11-16T12:00:00.000Z';
  let devOwnerId: string;
  const variantId = uuidv7();

  async function seedOwner(): Promise<void> {
    const shopRepo = new ShopRepo(ownerDb);
    const deviceRepo = new DeviceRepo(ownerDb);
    devOwnerId = uuidv7();

    await shopRepo.saveShop({
      id: shopId,
      shop_id: shopId,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: devOwnerId,
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
    });
    await deviceRepo.saveDevice({
      id: devOwnerId,
      shop_id: shopId,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      device_id: devOwnerId,
      dirty: 1,
      server_updated_at: null,
      name: 'Counter PC',
      code: 'PC1',
      last_seen_at: null,
    });
    await ownerDb.batch([
      { sql: `INSERT INTO settings (key, value) VALUES ('receipt_counter', '0')` },
    ]);

    await new CategoryRepo(ownerDb).save({
      id: uuidv7(),
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
    const productId = uuidv7();
    await new ProductRepo(ownerDb).saveProduct({
      id: productId,
      shop_id: shopId,
      category_id: null,
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
    await new ProductRepo(ownerDb).saveVariant({
      id: variantId,
      shop_id: shopId,
      product_id: productId,
      name: 'Mint',
      sku: null,
      barcode: null,
      cost_price: 100,
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
    await new StockRepo(ownerDb).addMovement({
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

    // Two sales so the receipt counter must recover to the max last-used value.
    const saleRepo = new SaleRepo(ownerDb);
    for (const qty of [10, 15]) {
      await saleRepo.completeSale(
        {
          shop_id: shopId,
          device_id: devOwnerId,
          sold_at: time,
          payment_method: 'cash',
          amount_received: qty * 500,
          discount_amount: 0,
          note: null,
          lines: [
            {
              variant_id: variantId,
              product_name: 'Juice',
              variant_name: 'Mint',
              qty,
              list_price: 500,
              unit_price: 500,
            },
          ],
        },
        uuidv7(),
        [uuidv7()],
        [uuidv7()],
        time,
      );
    }
  }

  beforeEach(async () => {
    const migrationsDir = path.resolve('packages/core/migrations');
    serverDb = new SqliteTestAdapter(':memory:');
    await serverDb.migrate(migrationsDir);
    ownerDb = new SqliteTestAdapter(':memory:');
    await ownerDb.migrate(migrationsDir);
    joinDb = new SqliteTestAdapter(':memory:');
    await joinDb.migrate(migrationsDir);

    server = new SQLiteSyncServer(serverDb);
    networkOwner = new MockNetworkAdapter(true);
    networkJoin = new MockNetworkAdapter(true);

    await seedOwner();
    await new SyncEngine(ownerDb, server, networkOwner, shopId).syncNow();
  });

  afterEach(() => {
    serverDb.close();
    ownerDb.close();
    joinDb.close();
  });

  it('probes shop existence without creating anything', async () => {
    expect(await probeShopExists(server, shopId)).toBe(true);
    expect(await probeShopExists(server, uuidv7())).toBe(false);
    // The probe is read-only: no placeholder shop row was created server-side.
    const shops = await serverDb.query<{ c: number }>('SELECT COUNT(*) AS c FROM shops');
    expect(shops[0]?.c).toBe(1);
  });

  it('enrolls an empty device: unique code, full pull, counter recovery', async () => {
    const result = await enrollExistingShop(joinDb, server, networkJoin, shopId, {
      deviceName: 'Counter Phone',
    });

    // Unique device code, not reusing the owner's.
    expect(result.deviceCode).toMatch(/^[A-Z0-9]{3,4}$/);
    expect(result.deviceCode).not.toBe('PC1');

    // Device is the locally active one and was pushed to the server.
    const activeId = await new SettingsRepo(joinDb).get('active_device_id');
    expect(activeId).toBe(result.deviceId);
    const deviceRow = await new DeviceRepo(joinDb).getDevice(result.deviceId);
    expect(deviceRow?.code).toBe(result.deviceCode);
    expect(deviceRow?.name).toBe('Counter Phone');
    const serverDevices = await serverDb.query<{ code: string }>(
      'SELECT code FROM devices WHERE shop_id = ?',
      [shopId],
    );
    expect(serverDevices.map((d) => d.code).sort()).toEqual(
      ['PC1', result.deviceCode].sort(),
    );

    // Full pull: shop, catalog and both sales are present.
    const shop = await new ShopRepo(joinDb).getActiveShop();
    expect(shop?.id).toBe(shopId);
    expect(shop?.name).toBe('Vapor Shop');
    const sales = await joinDb.query<{ receipt_no: string }>('SELECT receipt_no FROM sales');
    expect(sales.length).toBe(2);

    // Counter recovered with the last-used convention: max receipt number.
    const counter = await new SettingsRepo(joinDb).get('receipt_counter');
    expect(counter).toBe('2');

    // Stock converged to the owner's post-sale balance (50 - 10 - 15).
    const onHand = await new StockRepo(joinDb).getStockOnHand(shopId, variantId);
    expect(onHand[0]?.on_hand).toBe(25);

    // Local device row is clean after the push; nothing remains pending.
    const dirty = await joinDb.query<{ c: number }>('SELECT COUNT(*) AS c FROM devices WHERE dirty = 1');
    expect(dirty[0]?.c).toBe(0);
  });

  it('rejects enrollment on a device that already has a local shop', async () => {
    await expect(
      enrollExistingShop(ownerDb, server, networkOwner, uuidv7(), {}),
    ).rejects.toThrow(/already has a local shop/);
  });

  it('rejects enrollment while offline instead of silently enrolling with nothing pulled', async () => {
    networkJoin.setOnline(false);
    await expect(
      enrollExistingShop(joinDb, server, networkJoin, shopId, {}),
    ).rejects.toThrow(/offline/i);
  });

  it('reuses the registered device (same code) when the first attempt is interrupted', async () => {
    const failing = new FailOnceTransport(server);
    await expect(
      enrollExistingShop(joinDb, failing, networkJoin, shopId, { deviceName: 'Phone' }),
    ).rejects.toThrow('Simulated enrollment outage');

    // The interrupted attempt left a registered device behind.
    const firstActiveId = await new SettingsRepo(joinDb).get('active_device_id');
    expect(firstActiveId).not.toBeNull();
    const firstDevice = await new DeviceRepo(joinDb).getDevice(firstActiveId!);
    expect(firstDevice?.code).toMatch(/^[A-Z0-9]{3,4}$/);

    // Retry: same device, same code, exactly one local row for it. (The full
    // pull also inserts the owner's device row — that's expected.)
    const retry = await enrollExistingShop(joinDb, server, networkJoin, shopId, {
      deviceName: 'Phone',
    });
    expect(retry.deviceId).toBe(firstActiveId);
    expect(retry.deviceCode).toBe(firstDevice?.code);
    const ownRows = await joinDb.query<{ c: number }>(
      'SELECT COUNT(*) AS c FROM devices WHERE id = ?',
      [firstActiveId!],
    );
    expect(ownRows[0]?.c).toBe(1);

    // And the retry still completes the full pull.
    const shop = await new ShopRepo(joinDb).getActiveShop();
    expect(shop?.id).toBe(shopId);
    const counter = await new SettingsRepo(joinDb).get('receipt_counter');
    expect(counter).toBe('2');
  });

  it.each([1,2])('resumes an owner claim after stopping at local commit %i', async stopAt => {
    const settings = new SettingsRepo(ownerDb);
    const batch = ownerDb.batch.bind(ownerDb);
    let calls = 0;
    ownerDb.batch = async statements => {
      await batch(statements);
      if (++calls === stopAt) throw new Error('process stopped after commit');
    };
    const shops = new Set<string>();
    const claim = async (id:string) => { shops.add(id); return true; };
    await expect(enrollOwnerShop(ownerDb,shopId,'owner',claim)).rejects.toThrow('stopped');
    ownerDb.batch = batch;
    if (!await settings.get('cloud_enrolled_shop_id')) await enrollOwnerShop(ownerDb,shopId,'owner',claim);
    expect(await settings.get('cloud_enrolled_shop_id')).toBe(shopId);
    expect(await settings.get('cloud_claim_shop')).toBeNull();
    expect([...shops]).toEqual([shopId]);
  });

  it('recovers an owner claim whose cloud commit succeeded before the response was lost', async () => {
    const shops = new Set<string>();
    const claim = async (id: string) => { shops.add(id); return true; };
    await expect(enrollOwnerShop(ownerDb, shopId, 'project-owner', async id => {
      await claim(id);
      throw new Error('lost response');
    })).rejects.toThrow('lost response');
    const settings = new SettingsRepo(ownerDb);
    expect(await settings.get('cloud_claim_shop')).toBe(shopId);
    await expect(enrollOwnerShop(ownerDb, shopId, 'other-account', claim)).rejects.toThrow();
    await enrollOwnerShop(ownerDb, shopId, 'project-owner', claim);
    await enrollOwnerShop(ownerDb, shopId, 'project-owner', claim);
    expect([...shops]).toEqual([shopId]);
    expect(await settings.get('cloud_enrolled_shop_id')).toBe(shopId);
    expect(await settings.get('cloud_claim_shop')).toBeNull();
  });
  it('resumes after the shop page committed and the process stopped', async () => {
    const interrupted: SyncTransport = {
      push: server.push.bind(server),
      pull: (table, ...args) => table === 'categories' ? Promise.reject(new Error('process stopped')) : server.pull(table, ...args),
    };
    await expect(enrollExistingShop(joinDb, interrupted, networkJoin, shopId)).rejects.toThrow('process stopped');
    expect((await new ShopRepo(joinDb).getActiveShop())?.id).toBe(shopId);
    const id = await new SettingsRepo(joinDb).get('active_device_id');
    const result = await enrollExistingShop(joinDb, server, networkJoin, shopId);
    expect(result.deviceId).toBe(id);
    expect(await new SettingsRepo(joinDb).get('cloud_enrolled_shop_id')).toBe(shopId);
  });

  it('generates a code that does not collide with cloud device codes', async () => {
    // Seed the server with a device row for every 3-char code generated would
    // be impractical; instead run enrollment many times on fresh devices and
    // verify every code differs from the owner's and prior ones.
    const seen = new Set<string>(['PC1']);
    for (let i = 0; i < 8; i++) {
      const db = new SqliteTestAdapter(':memory:');
      await db.migrate(path.resolve('packages/core/migrations'));
      try {
        const result = await enrollExistingShop(db, server, new MockNetworkAdapter(true), shopId, {});
        expect(seen.has(result.deviceCode)).toBe(false);
        seen.add(result.deviceCode);
      } finally {
        db.close();
      }
    }
    expect(seen.size).toBe(9);
  });
});
