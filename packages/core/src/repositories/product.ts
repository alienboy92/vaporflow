import { IdSchema, Product, Variant, ProductSchema, VariantSchema } from '../types/schemas.js';
import { readRows } from '../query.js';
import { DbAdapter } from '../db-adapter.js';
/**
 * Product and Variant repository.
 */

export class ProductRepo {
  constructor(private db: DbAdapter) {}

  async getProducts(shopId: string): Promise<Product[]> {
    IdSchema.parse(shopId);
    return readRows(
      this.db,
      ProductSchema,
      `SELECT * FROM products WHERE shop_id = ? AND deleted_at IS NULL ORDER BY name ASC`,
      [shopId],
    );
  }

  async getProductById(id: string): Promise<Product | undefined> {
    IdSchema.parse(id);
    const rows = await readRows(
      this.db,
      ProductSchema,
      `SELECT * FROM products WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return rows[0];
  }

  async saveProduct(product: Product): Promise<void> {
    const validated = ProductSchema.parse(product);
    await this.db.query(
      `INSERT INTO products (id, shop_id, category_id, name, brand, notes, is_active, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         category_id = excluded.category_id,
         name = excluded.name,
         brand = excluded.brand,
         notes = excluded.notes,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         dirty = excluded.dirty,
         server_updated_at = excluded.server_updated_at`,
      [
        validated.id,
        validated.shop_id,
        validated.category_id,
        validated.name,
        validated.brand,
        validated.notes,
        validated.is_active,
        validated.created_at,
        validated.updated_at,
        validated.deleted_at,
        validated.device_id,
        validated.dirty,
        validated.server_updated_at,
      ],
    );
  }

  async getVariants(shopId: string, productId?: string): Promise<Variant[]> {
    IdSchema.parse(shopId);
    if (productId) {
      return readRows(
        this.db,
        VariantSchema,
        `SELECT * FROM variants WHERE shop_id = ? AND product_id = ? AND deleted_at IS NULL ORDER BY name ASC`,
        [shopId, productId],
      );
    }
    return readRows(
      this.db,
      VariantSchema,
      `SELECT * FROM variants WHERE shop_id = ? AND deleted_at IS NULL ORDER BY name ASC`,
      [shopId],
    );
  }

  async getVariantById(id: string): Promise<Variant | undefined> {
    IdSchema.parse(id);
    const rows = await readRows(
      this.db,
      VariantSchema,
      `SELECT * FROM variants WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return rows[0];
  }

  async getVariantByBarcode(shopId: string, barcode: string): Promise<Variant | undefined> {
    IdSchema.parse(shopId);
    const rows = await readRows(
      this.db,
      VariantSchema,
      `SELECT * FROM variants WHERE shop_id = ? AND barcode = ? AND deleted_at IS NULL`,
      [shopId, barcode],
    );
    return rows[0];
  }

  async saveVariant(variant: Variant): Promise<void> {
    const validated = VariantSchema.parse(variant);
    await this.db.query(
      `INSERT INTO variants (id, shop_id, product_id, name, sku, barcode, cost_price, sale_price, low_stock_threshold, track_stock, is_active, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         product_id = excluded.product_id,
         name = excluded.name,
         sku = excluded.sku,
         barcode = excluded.barcode,
         cost_price = excluded.cost_price,
         sale_price = excluded.sale_price,
         low_stock_threshold = excluded.low_stock_threshold,
         track_stock = excluded.track_stock,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         dirty = excluded.dirty,
         server_updated_at = excluded.server_updated_at`,
      [
        validated.id,
        validated.shop_id,
        validated.product_id,
        validated.name,
        validated.sku,
        validated.barcode,
        validated.cost_price,
        validated.sale_price,
        validated.low_stock_threshold,
        validated.track_stock,
        validated.is_active,
        validated.created_at,
        validated.updated_at,
        validated.deleted_at,
        validated.device_id,
        validated.dirty,
        validated.server_updated_at,
      ],
    );
  }
}
