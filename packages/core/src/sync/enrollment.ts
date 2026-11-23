/**
 * Cloud enrollment flows that run on real devices.
 *
 * `enrollExistingShop` implements the second-device flow: on an EMPTY device,
 * verify the shop exists in the cloud, register this device with a device code
 * unique across the shop, pull every synced table from scratch, and recover the
 * receipt counter with the last-used convention. Authentication (sign-in) and
 * the claim_shop RPC stay with the caller — this module only needs a transport.
 */
import { DbAdapter } from '../db-adapter.js';
import { NetworkAdapter } from '../adapters/types.js';
import { SyncTransport } from './types.js';
import { SyncEngine, SyncEngineOptions } from './engine.js';
import { DeviceRepo } from '../repositories/device.js';
import { SettingsRepo } from '../repositories/settings.js';
import { uuidv7 } from '../uuid.js';
import type { Device } from '../types/schemas.js';

export interface EnrollmentResult {
  /** Fully synced engine; NOT started — the caller starts it. */
  engine: SyncEngine;
  deviceId: string;
  deviceCode: string;
}

/** Characters for generated device codes (same alphabet as manual codes). */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

/**
 * Cheap existence probe that does NOT create anything: claim_shop inserts a
 * placeholder shop when the ID is unknown, so a typo'd shop ID must be
 * detected with a read-only pull BEFORE claiming.
 */
export async function probeShopExists(transport: SyncTransport, shopId: string): Promise<boolean> {
  const rows = await transport.pull('shops', shopId, null, null, 1);
  return rows.length > 0;
}

/**
 * Recover the receipt counter from the highest receipt number across ALL
 * sales (any device prefix). The counter stores the LAST-USED number (Phase
 * 5 convention: the next sale uses value + 1), so it must equal the max —
 * writing max + 1 would permanently skip a number. Used after a full restore
 * (backup.ts) and after enrolling a device into an existing shop, where the
 * freshly pulled sales must never collide with future local receipt numbers.
 */
export async function recoverReceiptCounter(db: DbAdapter): Promise<void> {
  const salesRes = await db.query<{ receipt_no: string }>('SELECT receipt_no FROM sales');
  let maxCounter = 0;
  for (const s of salesRes) {
    const parts = s.receipt_no.split('-');
    const num = parseInt(parts[parts.length - 1] ?? '', 10);
    if (!isNaN(num) && num > maxCounter) maxCounter = num;
  }
  await db.query(
    "INSERT INTO settings(key, value) VALUES('receipt_counter', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [String(maxCounter)],
  );
}

export interface EnrollOptions {
  /** Human label for the new device row (e.g. "Counter Phone"). */
  deviceName?: string;
  identity?: string;
  /** Passed through to the engine (injectable clock/timers for tests). */
  engineOptions?: SyncEngineOptions;
  engineClass?: typeof SyncEngine;
}

/**
 * Enroll this (empty) device into an existing cloud shop. Idempotent on
 * retry: if a device was already registered for this shop, it is reused
 * instead of creating a duplicate device row.
 */
export async function enrollExistingShop(
  db: DbAdapter,
  transport: SyncTransport,
  network: NetworkAdapter,
  shopId: string,
  options: EnrollOptions = {},
): Promise<EnrollmentResult> {
  const settingsRepo = new SettingsRepo(db);
  const settings = await settingsRepo.getAll();
  const identity = options.identity ?? shopId;
  const pending = settings.cloud_join_shop;
  if (pending && (pending !== shopId || settings.cloud_join_identity !== identity)) {
    throw new Error('Resume enrollment with the original shop and cloud account.');
  }
  const existing = await db.query<{id:string}>('SELECT id FROM shops');
  if (existing.some(row => row.id !== shopId) || (existing.length && !pending)) {
    throw new Error('This device already has a local shop.');
  }
  // syncNow() no-ops silently when offline, which would otherwise let an
  // enrollment "succeed" with nothing pulled — reject it loudly instead.
  if (!network.isOnline()) {
    throw new Error('You are offline. Reconnect to the internet and try joining again.');
  }

  if (!pending) {
    await db.batch([
      {sql:"INSERT OR REPLACE INTO settings VALUES('cloud_join_shop',?)",params:[shopId]},
      {sql:"INSERT OR REPLACE INTO settings VALUES('cloud_join_identity',?)",params:[identity]},
      {sql:"INSERT OR REPLACE INTO settings VALUES('active_device_id',?)",params:[uuidv7()]},
    ]);
  }

  // Reuse the device registered by a previous (interrupted) attempt, or
  // register a new one with a code unique across every cloud device.
  const previousDeviceId = await settingsRepo.get('active_device_id');
  let device: Device | undefined;
  if (previousDeviceId) {
    device = await new DeviceRepo(db).getDevice(previousDeviceId);
  }
  if (!device) {
    // Uniqueness must be judged against the CLOUD devices — this local db is
    // empty by definition on a join, so local queries would always look free.
    const cloudDevices = await transport.pull('devices', shopId, null, null, 500);
    const taken = new Set(
      cloudDevices
        .map((row) => (row as { code?: unknown }).code)
        .filter((code): code is string => typeof code === 'string'),
    );
    let code = '';
    for (let length = 3; length <= 4 && !code; length++) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = randomCode(length);
        if (!taken.has(candidate)) {
          code = candidate;
          break;
        }
      }
    }
    if (!code) {
      throw new Error('Could not generate a unique device code; all codes are taken.');
    }
    const deviceId = previousDeviceId ?? uuidv7();
    const now = new Date().toISOString();
    device = {
      id: deviceId,
      shop_id: shopId,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      device_id: deviceId,
      dirty: 1,
      server_updated_at: null,
      name: options.deviceName?.trim() || 'My Device',
      code,
      last_seen_at: now,
    };
    await new DeviceRepo(db).saveDevice(device);
  }
  await settingsRepo.set('active_device_id', device.id);

  // Fresh database means null cursors: the first syncNow is the full pull of
  // every synced table (and pushes this device's row).
  const Engine = options.engineClass ?? SyncEngine;
  const engine = new Engine(db, transport, network, shopId, options.engineOptions);
  try {
    await engine.syncNow();
    const status = await engine.getStatus();
    if (status.status !== 'synced') throw new Error('First sync is incomplete. Resume enrollment to retry.');
  } catch (error) { engine.stop(); throw error; }

  // The pulled sales must never collide with future local receipt numbers.
  await recoverReceiptCounter(db);

  await db.batch([
    {sql:"INSERT OR REPLACE INTO settings VALUES('cloud_enrolled_shop_id',?)", params:[shopId]},
    {sql:"DELETE FROM settings WHERE key IN ('cloud_join_shop','cloud_join_identity')"},
  ]);
  return { engine, deviceId: device.id, deviceCode: device.code };
}

/** Journal the intended owner before claim_shop can commit remotely. */
export async function enrollOwnerShop(
  db: DbAdapter, shopId: string, identity: string, claim: (id: string) => Promise<boolean>,
) {
  const settings = new SettingsRepo(db);
  const current = await settings.getAll();
  if (current.cloud_claim_shop && (current.cloud_claim_shop !== shopId || current.cloud_claim_identity !== identity)) {
    throw new Error('Resume this claim using the original shop and cloud account.');
  }
  await db.batch([
    {sql:"INSERT OR REPLACE INTO settings VALUES('cloud_claim_shop',?)",params:[shopId]},
    {sql:"INSERT OR REPLACE INTO settings VALUES('cloud_claim_identity',?)",params:[identity]},
  ]);
  if (!await claim(shopId)) throw new Error('Shop claim denied for this account.');
  await db.batch([
    {sql:"INSERT OR REPLACE INTO settings VALUES('cloud_enrolled_shop_id',?)",params:[shopId]},
    {sql:"DELETE FROM settings WHERE key IN ('cloud_claim_shop','cloud_claim_identity')"},
  ]);
}
