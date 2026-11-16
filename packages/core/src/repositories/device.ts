import { IdSchema, Device, DeviceSchema } from '../types/schemas.js';
import { SettingsRepo } from './settings.js';
import { readRows } from '../query.js';
import { DbAdapter } from '../db-adapter.js';

export class DeviceRepo {
  constructor(private db: DbAdapter) {}

  async getActiveDevice(shopId: string): Promise<Device | undefined> {
    const id = await new SettingsRepo(this.db).get('active_device_id');
    const device = id ? await this.getDevice(id) : undefined;
    return device?.shop_id === shopId ? device : undefined;
  }

  async getDevice(id: string): Promise<Device | undefined> {
    IdSchema.parse(id);
    const rows = await readRows(
      this.db,
      DeviceSchema,
      `SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return rows[0];
  }

  async getDevices(shopId: string): Promise<Device[]> {
    IdSchema.parse(shopId);
    return readRows(
      this.db,
      DeviceSchema,
      `SELECT * FROM devices WHERE shop_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
      [shopId],
    );
  }

  async saveDevice(device: Device): Promise<void> {
    const validated = DeviceSchema.parse(device);
    await this.db.query(
      `INSERT INTO devices (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, code, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         code = excluded.code,
         last_seen_at = excluded.last_seen_at,
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
        validated.code,
        validated.last_seen_at,
      ],
    );
  }
}
