/**
 * Category repository.
 */
import { DbAdapter } from '../db-adapter.js';
import { Category } from '../types/schemas.js';

export class CategoryRepo {
  constructor(private db: DbAdapter) {}

  getAll(shopId: string): Category[] {
    return this.db.query<Category>(
      `SELECT * FROM categories WHERE shop_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC`,
      [shopId]
    );
  }

  getById(id: string): Category | undefined {
    const rows = this.db.query<Category>(
      `SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    return rows[0];
  }

  save(category: Category): void {
    this.db.query(
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
        category.id,
        category.shop_id,
        category.name,
        category.sort_order,
        category.created_at,
        category.updated_at,
        category.deleted_at,
        category.device_id,
        category.dirty,
        category.server_updated_at,
      ]
    );
  }

  softDelete(id: string, updatedAt: string): void {
    this.db.query(
      `UPDATE categories SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      [updatedAt, updatedAt, id]
    );
  }
}
