import { z } from 'zod';
import {
  IdSchema,
  TimestampSchema,
  StockOnHandSchema,
  StockMovement,
  StockOnHand,
  StockMovementSchema,
} from '../types/schemas.js';
import { readRows } from '../query.js';
import { DbAdapter } from '../db-adapter.js';
import { uuidv7 } from '../uuid.js';

/**
 * Stock repository and stock calculations.
 */
export class StockRepo {
  constructor(private db: DbAdapter) {}

  async getStockOnHand(shopId: string, variantId?: string): Promise<StockOnHand[]> {
    IdSchema.parse(shopId);
    if (variantId) IdSchema.parse(variantId);
    return readRows(
      this.db,
      StockOnHandSchema,
      `SELECT v.id AS variant_id, COALESCE(SUM(m.qty_change),0) AS on_hand
       FROM variants v LEFT JOIN stock_movements m ON m.variant_id = v.id AND m.shop_id = v.shop_id AND m.deleted_at IS NULL
       WHERE v.shop_id = ? AND v.deleted_at IS NULL AND (? IS NULL OR v.id = ?)
       GROUP BY v.id`,
      [shopId, variantId ?? null, variantId ?? null],
    );
  }

  async getLowStockVariants(
    shopId: string,
  ): Promise<{ variant_id: string; on_hand: number; threshold: number }[]> {
    IdSchema.parse(shopId);
    return readRows(
      this.db,
      z.object({ variant_id: IdSchema, on_hand: z.number().int(), threshold: z.number().int() }),
      `SELECT
         v.id AS variant_id,
         COALESCE(sm.on_hand, 0) AS on_hand,
         COALESCE(v.low_stock_threshold, s.default_low_stock_threshold, 3) AS threshold
       FROM variants v
       JOIN shops s ON s.id = v.shop_id
       LEFT JOIN (
         SELECT variant_id, SUM(qty_change) AS on_hand
         FROM stock_movements
         WHERE shop_id = ? AND deleted_at IS NULL
         GROUP BY variant_id
       ) sm ON sm.variant_id = v.id
       WHERE v.shop_id = ?
         AND v.deleted_at IS NULL
         AND v.track_stock = 1
         AND v.is_active = 1
         AND COALESCE(sm.on_hand, 0) <= COALESCE(v.low_stock_threshold, s.default_low_stock_threshold, 3)`,
      [shopId, shopId],
    );
  }

  async getInventoryList(
    shopId: string,
    filter: 'all' | 'low' | 'out' | 'negative' = 'all',
    search?: string,
  ): Promise<
    {
      product_id: string;
      product_name: string;
      brand: string | null;
      variant_id: string;
      variant_name: string;
      sku: string | null;
      barcode: string | null;
      cost_price: number;
      sale_price: number;
      track_stock: number;
      on_hand: number;
      threshold: number;
    }[]
  > {
    IdSchema.parse(shopId);
    const searchParam = search ? `%${search.trim()}%` : null;

    let sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.brand,
        v.id AS variant_id,
        v.name AS variant_name,
        v.sku,
        v.barcode,
        v.cost_price,
        v.sale_price,
        v.track_stock,
        COALESCE(sm.on_hand, 0) AS on_hand,
        COALESCE(v.low_stock_threshold, s.default_low_stock_threshold, 3) AS threshold
      FROM variants v
      JOIN products p ON p.id = v.product_id
      JOIN shops s ON s.id = v.shop_id
      LEFT JOIN (
        SELECT variant_id, SUM(qty_change) AS on_hand
        FROM stock_movements
        WHERE shop_id = ? AND deleted_at IS NULL
        GROUP BY variant_id
      ) sm ON sm.variant_id = v.id
      WHERE v.shop_id = ? AND v.deleted_at IS NULL AND p.deleted_at IS NULL
        AND (? IS NULL OR p.name LIKE ? OR v.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)
    `;

    const params: unknown[] = [shopId, shopId, searchParam, searchParam, searchParam, searchParam, searchParam];

    if (filter === 'low') {
      sql += ` AND COALESCE(sm.on_hand, 0) <= COALESCE(v.low_stock_threshold, s.default_low_stock_threshold, 3)`;
    } else if (filter === 'out') {
      sql += ` AND COALESCE(sm.on_hand, 0) <= 0`;
    } else if (filter === 'negative') {
      sql += ` AND COALESCE(sm.on_hand, 0) < 0`;
    }

    sql += ` ORDER BY p.name ASC, v.name ASC`;

    const rowSchema = z.object({
      product_id: IdSchema,
      product_name: z.string(),
      brand: z.string().nullable(),
      variant_id: IdSchema,
      variant_name: z.string(),
      sku: z.string().nullable(),
      barcode: z.string().nullable(),
      cost_price: z.number().int(),
      sale_price: z.number().int(),
      track_stock: z.number().int(),
      on_hand: z.number().int(),
      threshold: z.number().int(),
    });

    return readRows(this.db, rowSchema, sql, params);
  }

  async addMovement(movement: StockMovement): Promise<void> {
    const validated = StockMovementSchema.parse(movement);
    await this.db.query(
      `INSERT INTO stock_movements (id, shop_id, variant_id, qty_change, type, ref_type, ref_id, unit_cost, note, occurred_at, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [
        validated.id,
        validated.shop_id,
        validated.variant_id,
        validated.qty_change,
        validated.type,
        validated.ref_type,
        validated.ref_id,
        validated.unit_cost,
        validated.note,
        validated.occurred_at,
        validated.created_at,
        validated.updated_at,
        validated.device_id,
        validated.dirty,
        validated.server_updated_at,
      ],
    );
  }

  async stockIn(
    shopId: string,
    items: { variantId: string; qty: number; unitCost?: number; note?: string }[],
    deviceId: string,
    timestamp: string,
  ): Promise<void> {
    IdSchema.parse(shopId);
    IdSchema.parse(deviceId);
    TimestampSchema.parse(timestamp);

    const statements: { sql: string; params?: unknown[] }[] = [];

    for (const item of items) {
      if (item.qty <= 0) continue;
      const movementId = uuidv7();
      statements.push({
        sql: `INSERT INTO stock_movements (id, shop_id, variant_id, qty_change, type, ref_type, ref_id, unit_cost, note, occurred_at, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
              VALUES (?, ?, ?, ?, 'restock', NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, 1, NULL)`,
        params: [
          movementId,
          shopId,
          item.variantId,
          item.qty,
          item.unitCost ?? null,
          item.note ?? 'Stock In',
          timestamp,
          timestamp,
          timestamp,
          deviceId,
        ],
      });

      if (item.unitCost !== undefined) {
        statements.push({
          sql: `UPDATE variants SET cost_price = ?, updated_at = ?, dirty = 1 WHERE id = ? AND shop_id = ?`,
          params: [item.unitCost, timestamp, item.variantId, shopId],
        });
      }
    }

    if (statements.length > 0) {
      await this.db.batch(statements);
    }
  }

  async adjustStock(
    shopId: string,
    variantId: string,
    countedQty: number,
    note: string,
    deviceId: string,
    timestamp: string,
  ): Promise<void> {
    IdSchema.parse(shopId);
    IdSchema.parse(variantId);
    IdSchema.parse(deviceId);
    TimestampSchema.parse(timestamp);
    if (!note || note.trim() === '') {
      throw new Error('Stock adjustment requires a required note.');
    }

    const currentStock = await this.getStockOnHand(shopId, variantId);
    const onHand = currentStock[0]?.on_hand ?? 0;
    const qtyChange = countedQty - onHand;

    if (qtyChange === 0) {
      // Unchanged count must not create a zero movement
      return;
    }

    const movementId = uuidv7();
    await this.db.batch([
      {
        sql: `INSERT INTO stock_movements (id, shop_id, variant_id, qty_change, type, ref_type, ref_id, unit_cost, note, occurred_at, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
              VALUES (?, ?, ?, ?, 'adjustment', NULL, NULL, NULL, ?, ?, ?, ?, NULL, ?, 1, NULL)`,
        params: [
          movementId,
          shopId,
          variantId,
          qtyChange,
          note,
          timestamp,
          timestamp,
          timestamp,
          deviceId,
        ],
      },
    ]);
  }

  async getMovementsForVariant(shopId: string, variantId: string): Promise<StockMovement[]> {
    IdSchema.parse(shopId);
    IdSchema.parse(variantId);
    return readRows(
      this.db,
      StockMovementSchema,
      `SELECT * FROM stock_movements WHERE shop_id = ? AND variant_id = ? AND deleted_at IS NULL ORDER BY occurred_at DESC, created_at DESC`,
      [shopId, variantId],
    );
  }
}
