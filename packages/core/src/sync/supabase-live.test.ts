/**
 * Phase 8B live acceptance against the HOSTED Supabase project.
 *
 * Skipped entirely unless every variable is provided:
 *   LIVE_SUPABASE_URL, LIVE_SUPABASE_ANON_KEY,
 *   LIVE_TEST_EMAIL, LIVE_TEST_PASSWORD
 *
 * Uses disposable per-run shop IDs (UUID v7); repeated runs create new shops
 * and do not interfere with each other.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SqliteTestAdapter } from '../testing/sqlite-test-adapter.js';
import { SupabaseSyncTransport } from './supabase-transport.js';
import { claimShop } from './supabase-client.js';
import { SyncEngine } from './engine.js';
import { probeShopExists, enrollExistingShop } from './enrollment.js';
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

const LIVE_URL = process.env.LIVE_SUPABASE_URL;
const LIVE_KEY = process.env.LIVE_SUPABASE_ANON_KEY;
const LIVE_EMAIL = process.env.LIVE_TEST_EMAIL;
const LIVE_PASSWORD = process.env.LIVE_TEST_PASSWORD;
// Second account for authorization-denial checks (email confirmation must be
// off so a session is granted on sign-up).
const LIVE_EMAIL_2 = process.env.LIVE_TEST_EMAIL_2 ?? 'vaporflow-livecheck2@example.com';
const LIVE_PASSWORD_2 = process.env.LIVE_TEST_PASSWORD_2 ?? 'VaporFlow!Live2026b';
const liveIt = it.skipIf(!LIVE_URL || !LIVE_KEY || !LIVE_EMAIL || !LIVE_PASSWORD);

class OnlineNetwork implements NetworkAdapter {
  isOnline(): boolean {
    return true;
  }
  onChange(): () => void {
    return () => {};
  }
}

const time = '2026-11-17T12:00:00.000Z';

interface LiveFixture {
  supabase: SupabaseClient;
  transport: SupabaseSyncTransport;
  shopId: string;
  dbA: SqliteTestAdapter;
  dbB: SqliteTestAdapter;
  variantId: string;
  devAId: string;
}

async function seedOwnerDevice(db: SqliteTestAdapter, shopId: string): Promise<string> {
  const devAId = uuidv7();
  await new ShopRepo(db).saveShop({
    id: shopId,
    shop_id: shopId,
    created_at: time,
    updated_at: time,
    deleted_at: null,
    device_id: devAId,
    dirty: 1,
    server_updated_at: null,
    name: 'Live Check Shop',
    address: null,
    phone: null,
    logo_base64: null,
    show_logo_on_receipt: 0,
    currency_code: 'PKR',
    currency_decimals: 0,
    receipt_footer: 'Thanks',
    default_low_stock_threshold: 3,
  });
  await new DeviceRepo(db).saveDevice({
    id: devAId,
    shop_id: shopId,
    created_at: time,
    updated_at: time,
    deleted_at: null,
    device_id: devAId,
    dirty: 1,
    server_updated_at: null,
    name: 'Counter PC',
    code: 'PC1',
    last_seen_at: null,
  });
  await db.batch([
    { sql: `INSERT INTO settings (key, value) VALUES ('receipt_counter', '0')` },
  ]);
  return devAId;
}

async function seedCatalogAndSales(db: SqliteTestAdapter, shopId: string): Promise<string> {
  const variantId = uuidv7();
  const productId = uuidv7();
  await new CategoryRepo(db).save({
    id: uuidv7(),
    shop_id: shopId,
    name: 'Live',
    sort_order: 1,
    created_at: time,
    updated_at: time,
    deleted_at: null,
    device_id: shopId,
    dirty: 1,
    server_updated_at: null,
  });
  await new ProductRepo(db).saveProduct({
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
  await new ProductRepo(db).saveVariant({
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
  await new StockRepo(db).addMovement({
    id: uuidv7(),
    shop_id: shopId,
    variant_id: variantId,
    qty_change: 50,
    type: 'opening',
    ref_type: null,
    ref_id: null,
    unit_cost: 100,
    note: 'Opening',
    occurred_at: time,
    created_at: time,
    updated_at: time,
    deleted_at: null,
    device_id: shopId,
    dirty: 1,
    server_updated_at: null,
  });
  const saleRepo = new SaleRepo(db);
  for (const qty of [10, 15]) {
    await saleRepo.completeSale(
      {
        shop_id: shopId,
        device_id: shopId,
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
  return variantId;
}

describe('Phase 8B live hosted Supabase acceptance', () => {
  let fx: LiveFixture;

  beforeAll(async () => {
    const supabase = createClient(LIVE_URL!, LIVE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    fx = {
      supabase,
      transport: new SupabaseSyncTransport(supabase),
      shopId: uuidv7(),
      dbA: new SqliteTestAdapter(':memory:'),
      dbB: new SqliteTestAdapter(':memory:'),
      variantId: '',
      devAId: '',
    };
    const migrationsDir = path.resolve('packages/core/migrations');
    await fx.dbA.migrate(migrationsDir);
    await fx.dbB.migrate(migrationsDir);
  }, 60_000);

  afterAll(() => {
    fx?.dbA.close();
    fx?.dbB.close();
  });

  beforeEach(() => {
    if (!LIVE_URL || !LIVE_KEY) {
      throw new Error('live credentials missing');
    }
  });

  liveIt('authenticates against the hosted project (sign-up or sign-in, then sign-out)', async () => {
    const first = await fx.supabase.auth.signInWithPassword({
      email: LIVE_EMAIL!,
      password: LIVE_PASSWORD!,
    });
    let session = first.data.session;
    if (first.error || !session) {
      const signUp = await fx.supabase.auth.signUp({
        email: LIVE_EMAIL!,
        password: LIVE_PASSWORD!,
      });
      if (signUp.error) throw new Error(`Auth sign-up failed: ${signUp.error.message}`);
      if (!signUp.data.session) {
        throw new Error(
          'Email confirmation is pending — disable "Confirm email" in the Supabase dashboard for the live checks.',
        );
      }
      session = signUp.data.session;
    }
    expect(session.user?.id).toBeTruthy();
    const out = await fx.supabase.auth.signOut();
    expect(out.error).toBeNull();
    const again = await fx.supabase.auth.signInWithPassword({
      email: LIVE_EMAIL!,
      password: LIVE_PASSWORD!,
    });
    expect(again.error).toBeNull();
  }, 60_000);

  liveIt('claims a fresh shop, converges two engines over the hosted cloud, and enrolls a second device', async () => {
    // Fresh signed-in session for this test.
    const auth = await fx.supabase.auth.signInWithPassword({
      email: LIVE_EMAIL!,
      password: LIVE_PASSWORD!,
    });
    if (auth.error) throw new Error(`Auth failed: ${auth.error.message}`);

    fx.devAId = await seedOwnerDevice(fx.dbA, fx.shopId);
    fx.variantId = await seedCatalogAndSales(fx.dbA, fx.shopId);

    // Claim, then push everything through the real hosted RPCs.
    const claimed = await claimShop(fx.supabase, fx.shopId);
    expect(claimed).toBe(true);
    const engineA = new SyncEngine(fx.dbA, fx.transport, new OnlineNetwork(), fx.shopId);
    await engineA.syncNow();

    // Second device: probe, claim, enroll (full pull + counter recovery).
    expect(await probeShopExists(fx.transport, fx.shopId)).toBe(true);
    const result = await enrollExistingShop(fx.dbB, fx.transport, new OnlineNetwork(), fx.shopId, {
      deviceName: 'Live Phone',
    });
    expect(result.deviceCode).toMatch(/^[A-Z0-9]{3,4}$/);
    expect(result.deviceCode).not.toBe('PC1');
    const shopB = await new ShopRepo(fx.dbB).getActiveShop();
    expect(shopB?.id).toBe(fx.shopId);
    const salesB = await fx.dbB.query<{ c: number }>('SELECT COUNT(*) AS c FROM sales');
    expect(salesB[0]?.c).toBe(2);
    expect(await new SettingsRepo(fx.dbB).get('receipt_counter')).toBe('2');
    const onHandB = await new StockRepo(fx.dbB).getStockOnHand(fx.shopId, fx.variantId);
    expect(onHandB[0]?.on_hand).toBe(25);
    const serverDevices = await fx.dbB.query<{ code: string }>(
      'SELECT code FROM devices WHERE shop_id = ?',
      [fx.shopId],
    );
    expect(serverDevices.map((d) => d.code).sort()).toEqual(['PC1', result.deviceCode].sort());

    // Incremental sync: a third sale on A reaches B through the hosted cloud.
    await new SaleRepo(fx.dbA).completeSale(
      {
        shop_id: fx.shopId,
        device_id: fx.devAId,
        sold_at: time,
        payment_method: 'cash',
        amount_received: 2500,
        discount_amount: 0,
        note: null,
        lines: [
          {
            variant_id: fx.variantId,
            product_name: 'Juice',
            variant_name: 'Mint',
            qty: 5,
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
    await engineA.syncNow();
    const engineB = new SyncEngine(fx.dbB, fx.transport, new OnlineNetwork(), fx.shopId);
    await engineB.syncNow();
    const salesB2 = await fx.dbB.query<{ c: number }>('SELECT COUNT(*) AS c FROM sales');
    expect(salesB2[0]?.c).toBe(3);
    const onHandB2 = await new StockRepo(fx.dbB).getStockOnHand(fx.shopId, fx.variantId);
    expect(onHandB2[0]?.on_hand).toBe(20);

    engineA.stop();
    engineB.stop();
  }, 120_000);

  liveIt('rejects shop access without a session', async () => {
    const anonymous = createClient(LIVE_URL!, LIVE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    // Signed-out claim must fail (the RPC raises 'Not authenticated').
    await expect(claimShop(anonymous, uuidv7())).rejects.toThrow();
  }, 60_000);

  liveIt('resolves concurrent claims of one fresh shop to exactly one shop row', async () => {
    const auth = await fx.supabase.auth.signInWithPassword({
      email: LIVE_EMAIL!,
      password: LIVE_PASSWORD!,
    });
    if (auth.error) throw new Error(`Auth failed: ${auth.error.message}`);
    const concurrentId = uuidv7();
    const results = await Promise.allSettled([
      claimShop(fx.supabase, concurrentId),
      claimShop(fx.supabase, concurrentId),
    ]);
    const values = results.map((r) => (r.status === 'fulfilled' ? r.value : `rejected: ${String(r.reason)}`));
    // Same account: the loser of the race still reports membership.
    expect(values.filter((v) => v === true).length).toBe(2);
    // Exactly one shop row exists for that ID.
    const pulled = await fx.transport.pull('shops', concurrentId, null, null, 10);
    expect(pulled.length).toBe(1);
  }, 60_000);

  liveIt('retries an interrupted enrollment against the hosted cloud with the same device code', async () => {
    const auth = await fx.supabase.auth.signInWithPassword({
      email: LIVE_EMAIL!,
      password: LIVE_PASSWORD!,
    });
    if (auth.error) throw new Error(`Auth failed: ${auth.error.message}`);

    const shopC = uuidv7();
    const dbC = new SqliteTestAdapter(':memory:');
    const dbD = new SqliteTestAdapter(':memory:');
    try {
      const migrationsDir = path.resolve('packages/core/migrations');
      await dbC.migrate(migrationsDir);
      await dbD.migrate(migrationsDir);
      await seedOwnerDevice(dbC, shopC);
      const claimed = await claimShop(fx.supabase, shopC);
      expect(claimed).toBe(true);
      const engineC = new SyncEngine(dbC, fx.transport, new OnlineNetwork(), shopC);
      await engineC.syncNow();

      // First attempt dies right after the device row is registered.
      class FailOnDevicePush implements SyncTransport {
        private calls = 0;
        async push(table: string, rows: unknown[]) {
          this.calls++;
          if (this.calls === 2) throw new Error('Simulated hosted outage');
          return fx.transport.push(table, rows);
        }
        async pull(table: string, shopId: string, ts: string | null, id: string | null, limit: number) {
          this.calls++;
          if (this.calls === 2) throw new Error('Simulated hosted outage');
          return fx.transport.pull(table, shopId, ts, id, limit);
        }
      }
      await expect(
        enrollExistingShop(dbD, new FailOnDevicePush(), new OnlineNetwork(), shopC, { deviceName: 'Retry Phone' }),
      ).rejects.toThrow('Simulated hosted outage');
      const firstDeviceId = await new SettingsRepo(dbD).get('active_device_id');
      expect(firstDeviceId).not.toBeNull();

      // Retry against the real hosted transport: same device, no duplicates.
      const retry = await enrollExistingShop(dbD, fx.transport, new OnlineNetwork(), shopC, {
        deviceName: 'Retry Phone',
      });
      expect(retry.deviceId).toBe(firstDeviceId);
      const ownRows = await dbD.query<{ c: number }>(
        'SELECT COUNT(*) AS c FROM devices WHERE id = ?',
        [firstDeviceId!],
      );
      expect(ownRows[0]?.c).toBe(1);
      const shopD = await new ShopRepo(dbD).getActiveShop();
      expect(shopD?.id).toBe(shopC);
      const serverDevices = await dbD.query<{ c: number }>(
        'SELECT COUNT(*) AS c FROM devices WHERE shop_id = ? AND code = ?',
        [shopC, retry.deviceCode],
      );
      expect(serverDevices[0]?.c).toBe(1);
      engineC.stop();
    } finally {
      dbC.close();
      dbD.close();
    }
  }, 120_000);

  liveIt('denies a second account access to another account\u2019s shop', async () => {
    // Ensure the primary shop exists and is claimed by the primary account.
    const primaryAuth = await fx.supabase.auth.signInWithPassword({
      email: LIVE_EMAIL!,
      password: LIVE_PASSWORD!,
    });
    if (primaryAuth.error) throw new Error(`Auth failed: ${primaryAuth.error.message}`);
    const claimedPrimary = await claimShop(fx.supabase, fx.shopId);
    expect(claimedPrimary).toBe(true);

    // Sign in / sign up the second disposable account.
    const secondIn = await fx.supabase.auth.signInWithPassword({
      email: LIVE_EMAIL_2,
      password: LIVE_PASSWORD_2,
    });
    let secondSession = secondIn.data.session;
    if (secondIn.error || !secondSession) {
      const secondUp = await fx.supabase.auth.signUp({
        email: LIVE_EMAIL_2,
        password: LIVE_PASSWORD_2,
      });
      if (secondUp.error) throw new Error(`Second account sign-up failed: ${secondUp.error.message}`);
      if (!secondUp.data.session) {
        throw new Error('Second account needs email confirmation — disable "Confirm email".');
      }
      secondSession = secondUp.data.session;
    }
    expect(secondSession.user?.id).toBeTruthy();

    // Claiming an existing shop it is not a member of returns false (denied),
    // and pulling that shop's data raises.
    expect(await claimShop(fx.supabase, fx.shopId)).toBe(false);
    await expect(fx.transport.pull('shops', fx.shopId, null, null, 10)).rejects.toThrow();
    // Pushing a rogue row into the other account's shop is batch-rejected.
    // (An EMPTY push legitimately accepts 0 rows — nothing to authorize.)
    const now = new Date().toISOString();
    await expect(
      fx.transport.push('devices', [
        {
          id: uuidv7(),
          shop_id: fx.shopId,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          device_id: uuidv7(),
          name: 'Rogue Device',
          code: 'RX1',
          last_seen_at: now,
        },
      ]),
    ).rejects.toThrow();

    // Restore the primary session for any later use.
    await fx.supabase.auth.signInWithPassword({ email: LIVE_EMAIL!, password: LIVE_PASSWORD! });
  }, 60_000);
});
