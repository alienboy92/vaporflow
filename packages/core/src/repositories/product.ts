/**
 * Product and Variant repository.
 */
import { DbAdapter } from '../db-adapter.js';
import { Product, Variant } from '../types/schemas.js';

export class ProductRepo {
  constructor(private db: DbAdapter) {}

  getProducts(shopId: string): Product[] {
    return this.db.query<Product>(
      `SELECT * FROM products WHERE shop_id = ? AND deleted_at IS NULL ORDER BY name ASC`,
      [shopId]
    );
  }

  getProductById(id: string): Product | undefined {
    return this.db.query<Product>(
      `SELECT * FROM products WHERE id = ? AND deleted_at IS NULL`,
      [id]
    )[0];
  }

  saveProduct(product: Product): void {
    this.db.query(
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
        product.id,
        product.shop_id,
        product.category_id,
        product.name,
        product.brand,
        product.notes,
        product.is_active,
        product.created_at,
        product.updated_at,
        product.deleted_at,
        product.device_id,
        product.dirty,
        product.server_updated_at,
      ]
    );
  }

  getVariants(shopId: string, productId?: string): Variant[] {
    if (productId) {
      return this.db.query<Variant>(
        `SELECT * FROM variants WHERE shop_id = ? AND product_id = ? AND deleted_at IS NULL ORDER BY name ASC`,
        [shopId, productId]
      );
    }
    return this.db.query<Variant>(
      `SELECT * FROM variants WHERE shop_id = ? AND deleted_at IS NULL ORDER BY name ASC`,
      [shopId]
    );
  }

  getVariantById(id: string): Variant | undefined {
    return this.db.query<Variant>(
      `SELECT * FROM variants WHERE id = ? AND deleted_at IS NULL`,
      [id]
    )[0];
  }

  getVariantByBarcode(shopId: string, barcode: string): Variant | undefined {
    return this.db.query<Variant>(
      `SELECT * FROM variants WHERE shop_id = ? AND barcode = ? AND deleted_at IS NULL`,
      [shopId, barcode]
    )[0];
  }

  saveVariant(variant: Variant): void {
    this.db.query(
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
        variant.id,
        variant.shop_id,
        variant.product_id,
        variant.name,
        variant.sku,
        variant.barcode,
        variant.cost_price,
        variant.sale_price,
        variant.low_stock_threshold,
        variant.track_stock,
        variant.created_at,
        variant.updated_at,
        variant.deleted_at,
        variant.device_id,
        variant.dirty,
        variant.server_updated_at,
      ]
    );
  }
}
