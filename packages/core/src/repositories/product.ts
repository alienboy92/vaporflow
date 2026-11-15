import { z } from 'zod';
import { IdSchema, TimestampSchema, Product, Variant, ProductSchema, VariantSchema } from '../types/schemas.js';
import { readRows } from '../query.js';
import { DbAdapter } from '../db-adapter.js';
import { uuidv7 } from '../uuid.js';

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

  async checkBarcodeExists(
    shopId: string,
    barcode: string,
    excludeVariantId?: string,
  ): Promise<boolean> {
    IdSchema.parse(shopId);
    if (!barcode) return false;
    const rows = await readRows(
      this.db,
      VariantSchema,
      `SELECT * FROM variants WHERE shop_id = ? AND barcode = ? AND deleted_at IS NULL AND (? IS NULL OR id != ?)`,
      [shopId, barcode, excludeVariantId ?? null, excludeVariantId ?? null],
    );
    return rows.length > 0;
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

  async saveProductWithVariantsAndOpeningStock(
    product: Product,
    variants: Variant[],
    openingStocks: { variantId: string; qty: number; unitCost: number; note?: string }[],
    deviceId: string,
    timestamp: string,
  ): Promise<void> {
    IdSchema.parse(product.shop_id);
    ProductSchema.parse(product);
    for (const v of variants) {
      VariantSchema.parse(v);
      if (v.barcode) {
        const exists = await this.checkBarcodeExists(product.shop_id, v.barcode, v.id);
        if (exists) {
          throw new Error(`Duplicate live barcode: ${v.barcode}`);
        }
      }
    }

    const statements: { sql: string; params?: unknown[] }[] = [];

    // Save product
    statements.push({
      sql: `INSERT INTO products (id, shop_id, category_id, name, brand, notes, is_active, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
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
      params: [
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
      ],
    });

    // Save variants
    for (const v of variants) {
      statements.push({
        sql: `INSERT INTO variants (id, shop_id, product_id, name, sku, barcode, cost_price, sale_price, low_stock_threshold, track_stock, is_active, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
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
        params: [
          v.id,
          v.shop_id,
          v.product_id,
          v.name,
          v.sku,
          v.barcode,
          v.cost_price,
          v.sale_price,
          v.low_stock_threshold,
          v.track_stock,
          v.is_active,
          v.created_at,
          v.updated_at,
          v.deleted_at,
          v.device_id,
          v.dirty,
          v.server_updated_at,
        ],
      });
    }

    // Opening stock movements (only if qty > 0 and no opening movement exists yet)
    for (const os of openingStocks) {
      if (os.qty <= 0) continue;
      // Check if opening movement already exists for this variant
      const existingOpening = await readRows(
        this.db,
        z.object({ id: IdSchema }),
        `SELECT id FROM stock_movements WHERE variant_id = ? AND type = 'opening' AND deleted_at IS NULL`,
        [os.variantId],
      );
      if (existingOpening.length === 0) {
        const movementId = uuidv7();
        statements.push({
          sql: `INSERT INTO stock_movements (id, shop_id, variant_id, qty_change, type, ref_type, ref_id, unit_cost, note, occurred_at, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
                VALUES (?, ?, ?, ?, 'opening', NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, 1, NULL)`,
          params: [
            movementId,
            product.shop_id,
            os.variantId,
            os.qty,
            os.unitCost,
            os.note ?? 'Opening stock',
            timestamp,
            timestamp,
            timestamp,
            deviceId,
          ],
        });
      }
    }

    await this.db.batch(statements);
  }

  async softDeleteProduct(productId: string, updatedAt: string): Promise<void> {
    IdSchema.parse(productId);
    TimestampSchema.parse(updatedAt);
    const product = await this.getProductById(productId);
    if (!product) return;

    const variants = await this.getVariants(product.shop_id, productId);
    const statements: { sql: string; params?: unknown[] }[] = [];

    statements.push({
      sql: `UPDATE products SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      params: [updatedAt, updatedAt, productId],
    });

    for (const v of variants) {
      statements.push({
        sql: `UPDATE variants SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
        params: [updatedAt, updatedAt, v.id],
      });
    }

    await this.db.batch(statements);
  }
}
