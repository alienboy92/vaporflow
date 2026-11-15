import { z } from 'zod';
import {
  IdSchema,
  StockOnHandSchema,
  StockMovement,
  StockOnHand,
  StockMovementSchema,
} from '../types/schemas.js';
import { readRows } from '../query.js';
import { DbAdapter } from '../db-adapter.js';
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
       FROM variants v LEFT JOIN stock_movements m ON m.variant_id = v.id AND m.shop_id = v.shop_id
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
         WHERE shop_id = ?
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

  async getMovementsForVariant(shopId: string, variantId: string): Promise<StockMovement[]> {
    IdSchema.parse(shopId);
    return readRows(
      this.db,
      StockMovementSchema,
      `SELECT * FROM stock_movements WHERE shop_id = ? AND variant_id = ? ORDER BY occurred_at DESC, created_at DESC`,
      [shopId, variantId],
    );
  }
}
