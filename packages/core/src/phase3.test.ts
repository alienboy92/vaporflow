import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteTestAdapter } from './testing/sqlite-test-adapter.js';
import { ShopRepo } from './repositories/shop.js';
import { DeviceRepo } from './repositories/device.js';
import { hashPin, verifyPin, updatePin } from './pin.js';
import { uuidv7 } from './uuid.js';
import path from 'node:path';
import { SettingsRepo } from './repositories/settings.js';
import { ShopSchema, DeviceSchema } from './types/schemas.js';

describe('Phase 3 — Setup, navigation, and settings', () => {
  let db: SqliteTestAdapter;

  beforeEach(async () => {
    db = new SqliteTestAdapter(':memory:');
    const migrationsDir = path.resolve('packages/core/migrations');
    await db.migrate(migrationsDir);
  });

  afterEach(() => {
    db.close();
  });

  it('saves and retrieves shop and device', async () => {
    const shopId = uuidv7();
    const deviceId = uuidv7();
    const now = new Date().toISOString();

    const shopRepo = new ShopRepo(db);
    const deviceRepo = new DeviceRepo(db);

    const shop = {
      id: shopId,
      shop_id: shopId,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
      name: 'Vapor Vapes',
      address: '123 Main St',
      phone: '03001234567',
      logo_base64: null,
      show_logo_on_receipt: 0,
      currency_code: 'PKR',
      currency_decimals: 0,
      receipt_footer: 'Thank you',
      default_low_stock_threshold: 3,
    };

    const device = {
      id: deviceId,
      shop_id: shopId,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
      name: 'PC Terminal',
      code: 'PC1',
      last_seen_at: now,
    };

    await shopRepo.saveFirstRun(shop, device);

    const fetchedShop = await shopRepo.getShop(shopId);
    expect(fetchedShop?.name).toBe('Vapor Vapes');

    const fetchedDevice = await deviceRepo.getDevice(deviceId);
    expect(fetchedDevice?.code).toBe('PC1');

    const devices = await deviceRepo.getDevices(shopId);
    expect(devices.length).toBe(1);
  });

  it('rolls back first-run save entirely if any statement fails', async () => {
    const shopId = uuidv7();
    const deviceId = uuidv7();
    const now = new Date().toISOString();

    const shopRepo = new ShopRepo(db);

    const common = {
      shop_id: shopId,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
    };
    const shop = ShopSchema.parse({
      ...common,
      id: shopId,
      name: 'Shop',
      address: null,
      phone: null,
      logo_base64: null,
      show_logo_on_receipt: 0,
    });
    const device = DeviceSchema.parse({
      ...common,
      id: deviceId,
      name: 'Terminal',
      code: 'PC1',
      last_seen_at: now,
    });
    // Fail the real repository's final statement after both entity inserts succeeded.
    await db.query(
      "CREATE TRIGGER fail_setup BEFORE INSERT ON settings BEGIN SELECT RAISE(ABORT, 'forced setup failure'); END",
    );
    await expect(shopRepo.saveFirstRun(shop, device)).rejects.toThrow('forced setup failure');
    for (const table of ['shops', 'devices', 'settings'])
      expect(await db.query('SELECT * FROM ' + table)).toEqual([]);
    await db.query('DROP TRIGGER fail_setup');
    await shopRepo.saveFirstRun(shop, device);
    expect(await new SettingsRepo(db).get('active_device_id')).toBe(deviceId);
  });

  it('sets, changes and removes PIN only with the correct current credential', async () => {
    const settings = new SettingsRepo(db);
    await updatePin(settings, '', '1234');
    const original = await settings.get('pin_hash');
    await expect(updatePin(settings, '9999', '5678')).rejects.toThrow();
    await expect(updatePin(settings, '9999', '')).rejects.toThrow();
    await expect(updatePin(settings, '1234', 'bad')).rejects.toThrow();
    expect(await settings.get('pin_hash')).toBe(original);
    await updatePin(settings, '1234', '5678');
    expect(await verifyPin('5678', (await settings.get('pin_hash'))!)).toBe(true);
    await updatePin(settings, '5678', '');
    expect(await settings.get('pin_hash')).toBe('');
  });

  it('hashes and verifies PIN securely without plaintext storage', async () => {
    const pin = '1234';
    const hash = await hashPin(pin);
    expect(hash).not.toBe(pin);
    expect(hash.length).toBe(64); // SHA-256 hex

    expect(await verifyPin('1234', hash)).toBe(true);
    expect(await verifyPin('9999', hash)).toBe(false);

    await expect(hashPin('abc')).rejects.toThrow();
  });
});
