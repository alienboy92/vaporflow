/**
 * Stock repository and stock calculations.
 */
import { DbAdapter } from '../db-adapter.js';
import { StockMovement, StockOnHand } from '../types/schemas.js';

export class StockRepo {
  constructor(private db: DbAdapter) {}

  getStockOnHand(shopId: string, variantId?: string): StockOnHand[] {
    if (variantId) {
      return this.db.query<StockOnHand>(
        `SELECT variant_id, COALESCE(SUM(qty_change), 0) AS on_hand
         FROM stock_movements
         WHERE shop_id = ? AND variant_id = ?
         GROUP BY variant_id`,
        [shopId, variantId]
      );
    }
    return this.db.query<StockOnHand>(
      `SELECT variant_id, COALESCE(SUM(qty_change), 0) AS on_hand
       FROM stock_movements
       WHERE shop_id = ?
       GROUP BY variant_id`,
      [shopId]
    );
  }

  getLowStockVariants(shopId: string): { variant_id: string; on_hand: number; threshold: number }[] {
    // Low stock rule: on_hand <= (variant threshold, or shop default threshold)
    // Joined with variants and shops
    return this.db.query(
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
      [shopId, shopId]
    );
  }

  addMovement(movement: StockMovement): void {
    this.db.query(
      `INSERT INTO stock_movements (id, shop_id, variant_id, qty_change, type, ref_type, ref_id, unit_cost, note, occurred_at, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [
        movement.id,
        movement.shop_id,
        movement.variant_id,
        movement.qty_change,
        movement.type,
        movement.ref_type,
        movement.ref_id,
        movement.unit_cost,
        movement.note,
        movement.occurred_at,
        movement.created_at,
        movement.updated_at,
        movement.device_id,
        movement.dirty,
        movement.server_updated_at,
      ]
    );
  }

  getMovementsForVariant(shopId: string, variantId: string): StockMovement[] {
    return this.db.query<StockMovement>(
      `SELECT * FROM stock_movements WHERE shop_id = ? AND variant_id = ? ORDER BY occurred_at DESC, created_at DESC`,
      [shopId, variantId]
    );
  }
}
