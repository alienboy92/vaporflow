import { TimestampSchema, IdSchema, Category, CategorySchema } from '../types/schemas.js';
import { readRows } from '../query.js';
import { DbAdapter } from '../db-adapter.js';
/**
 * Category repository.
 */

export class CategoryRepo {
  constructor(private db: DbAdapter) {}

  async getAll(shopId: string): Promise<Category[]> {
    IdSchema.parse(shopId);
    return readRows(
      this.db,
      CategorySchema,
      `SELECT * FROM categories WHERE shop_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC`,
      [shopId],
    );
  }

  async getById(id: string): Promise<Category | undefined> {
    IdSchema.parse(id);
    const rows = await readRows(
      this.db,
      CategorySchema,
      `SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return rows[0];
  }

  async save(category: Category): Promise<void> {
    const validated = CategorySchema.parse(category);
    await this.db.query(
      `INSERT INTO categories (id, shop_id, name, sort_order, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         dirty = excluded.dirty,
         server_updated_at = excluded.server_updated_at`,
      [
        validated.id,
        validated.shop_id,
        validated.name,
        validated.sort_order,
        validated.created_at,
        validated.updated_at,
        validated.deleted_at,
        validated.device_id,
        validated.dirty,
        validated.server_updated_at,
      ],
    );
  }

  async softDelete(id: string, updatedAt: string): Promise<void> {
    IdSchema.parse(id);
    TimestampSchema.parse(updatedAt);
    await this.db.query(
      `UPDATE categories SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      [updatedAt, updatedAt, id],
    );
  }
}
