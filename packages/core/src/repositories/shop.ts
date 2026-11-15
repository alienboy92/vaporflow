import { IdSchema, Shop, ShopSchema, Device, DeviceSchema } from '../types/schemas.js';
import { readRows } from '../query.js';
import { DbAdapter } from '../db-adapter.js';

export class ShopRepo {
  constructor(private db: DbAdapter) {}

  async getShop(shopId: string): Promise<Shop | undefined> {
    IdSchema.parse(shopId);
    const rows = await readRows(
      this.db,
      ShopSchema,
      `SELECT * FROM shops WHERE id = ? AND deleted_at IS NULL`,
      [shopId],
    );
    return rows[0];
  }

  async getActiveShop(): Promise<Shop | undefined> {
    const rows = await readRows(
      this.db,
      ShopSchema,
      `SELECT * FROM shops WHERE deleted_at IS NULL LIMIT 1`,
    );
    return rows[0];
  }

  async saveShop(shop: Shop): Promise<void> {
    const validated = ShopSchema.parse(shop);
    await this.db.query(
      `INSERT INTO shops (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, address, phone, logo_base64, show_logo_on_receipt, currency_code, currency_decimals, receipt_footer, default_low_stock_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         address = excluded.address,
         phone = excluded.phone,
         logo_base64 = excluded.logo_base64,
         show_logo_on_receipt = excluded.show_logo_on_receipt,
         currency_code = excluded.currency_code,
         currency_decimals = excluded.currency_decimals,
         receipt_footer = excluded.receipt_footer,
         default_low_stock_threshold = excluded.default_low_stock_threshold,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         dirty = excluded.dirty,
         server_updated_at = excluded.server_updated_at`,
      [
        validated.id,
        validated.shop_id,
        validated.created_at,
        validated.updated_at,
        validated.deleted_at,
        validated.device_id,
        validated.dirty,
        validated.server_updated_at,
        validated.name,
        validated.address,
        validated.phone,
        validated.logo_base64,
        validated.show_logo_on_receipt,
        validated.currency_code,
        validated.currency_decimals,
        validated.receipt_footer,
        validated.default_low_stock_threshold,
      ],
    );
  }

  async saveFirstRun(shop: Shop, device: Device): Promise<void> {
    const validatedShop = ShopSchema.parse(shop);
    const validatedDevice = DeviceSchema.parse(device);
    if (validatedShop.id !== validatedDevice.shop_id) {
      throw new Error('Shop ID and Device shop_id must match');
    }
    await this.db.batch([
      {
        sql: `INSERT INTO shops (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, address, phone, logo_base64, show_logo_on_receipt, currency_code, currency_decimals, receipt_footer, default_low_stock_threshold)
              VALUES (?, ?, ?, ?, NULL, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          validatedShop.id,
          validatedShop.shop_id,
          validatedShop.created_at,
          validatedShop.updated_at,
          validatedShop.device_id,
          validatedShop.name,
          validatedShop.address,
          validatedShop.phone,
          validatedShop.logo_base64,
          validatedShop.show_logo_on_receipt,
          validatedShop.currency_code,
          validatedShop.currency_decimals,
          validatedShop.receipt_footer,
          validatedShop.default_low_stock_threshold,
        ],
      },
      {
        sql: `INSERT INTO devices (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, code, last_seen_at)
              VALUES (?, ?, ?, ?, NULL, ?, 1, NULL, ?, ?, ?)`,
        params: [
          validatedDevice.id,
          validatedDevice.shop_id,
          validatedDevice.created_at,
          validatedDevice.updated_at,
          validatedDevice.device_id,
          validatedDevice.name,
          validatedDevice.code,
          validatedDevice.last_seen_at,
        ],
      },
      {
        sql: `INSERT INTO settings (key, value) VALUES ('active_shop_id', ?), ('active_device_id', ?), ('receipt_counter', '0')
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        params: [validatedShop.id, validatedDevice.id],
      },
    ]);
  }
}
