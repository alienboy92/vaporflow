/**
 * Return repository and processReturn atomic batch.
 */
import { DbAdapter } from '../db-adapter.js';
import { Return, ReturnItem, StockMovement, ProcessReturnInput } from '../types/schemas.js';
import { calcRefundAmount } from '../money.js';

export class ReturnRepo {
  constructor(private db: DbAdapter) {}

  processReturn(
    input: ProcessReturnInput,
    returnId: string,
    returnItemIds: string[],
    movementIds: string[],
    nowIso: string
  ): { ret: Return; items: ReturnItem[] } {
    let totalRefund = 0;
    const returnItems: ReturnItem[] = [];
    const movements: StockMovement[] = [];
    const statements: { sql: string; params?: unknown[] }[] = [];

    // First fetch sale items to know net_total and sold qty
    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i]!;
      const returnItemId = returnItemIds[i]!;
      const movementId = movementIds[i]!;

      const saleItems = this.db.query<Record<string, unknown>>(
        `SELECT * FROM sale_items WHERE id = ?`,
        [line.sale_item_id]
      );
      const saleItem = saleItems[0];
      if (!saleItem) {
        throw new Error(`Sale item ${line.sale_item_id} not found`);
      }

      const netTotal = Number(saleItem['net_total'] || 0);
      const soldQty = Number(saleItem['qty'] || 0);
      const unitCost = Number(saleItem['unit_cost'] || 0);

      // Calculate refund amount for this line
      const refundAmount = calcRefundAmount(netTotal, line.qty, soldQty);
      totalRefund += refundAmount;

      const retItem: ReturnItem = {
        id: returnItemId,
        shop_id: input.shop_id,
        return_id: returnId,
        sale_item_id: line.sale_item_id,
        variant_id: line.variant_id,
        qty: line.qty,
        refund_amount: refundAmount,
        unit_cost: unitCost,
        restocked: line.restocked ? 1 : 0,
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        device_id: input.device_id,
        dirty: 1,
        server_updated_at: null,
      };
      returnItems.push(retItem);

      statements.push({
        sql: `INSERT INTO return_items (id, shop_id, return_id, sale_item_id, variant_id, qty, refund_amount, unit_cost, restocked, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, NULL)`,
        params: [
          retItem.id,
          retItem.shop_id,
          retItem.return_id,
          retItem.sale_item_id,
          retItem.variant_id,
          retItem.qty,
          retItem.refund_amount,
          retItem.unit_cost,
          retItem.restocked,
          retItem.created_at,
          retItem.updated_at,
          retItem.device_id,
        ],
      });

      // If restocked, add stock movement of type 'return' (positive qty_change)
      if (line.restocked) {
        const movement: StockMovement = {
          id: movementId,
          shop_id: input.shop_id,
          variant_id: line.variant_id,
          qty_change: line.qty,
          type: 'return',
          ref_type: 'return',
          ref_id: returnId,
          unit_cost: unitCost,
          note: `Return restock for sale item ${line.sale_item_id}`,
          occurred_at: input.returned_at,
          created_at: nowIso,
          updated_at: nowIso,
          deleted_at: null,
          device_id: input.device_id,
          dirty: 1,
          server_updated_at: null,
        };
        movements.push(movement);

        statements.push({
          sql: `INSERT INTO stock_movements (id, shop_id, variant_id, qty_change, type, ref_type, ref_id, unit_cost, note, occurred_at, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, NULL)`,
          params: [
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
          ],
        });
      }
    }

    const ret: Return = {
      id: returnId,
      shop_id: input.shop_id,
      sale_id: input.sale_id,
      returned_at: input.returned_at,
      refund_amount: totalRefund,
      refund_method: input.refund_method,
      note: input.note,
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
      device_id: input.device_id,
      dirty: 1,
      server_updated_at: null,
    };

    // Insert return header at the beginning of batch
    statements.unshift({
      sql: `INSERT INTO returns (id, shop_id, sale_id, returned_at, refund_amount, refund_method, note, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, NULL)`,
      params: [
        ret.id,
        ret.shop_id,
        ret.sale_id,
        ret.returned_at,
        ret.refund_amount,
        ret.refund_method,
        ret.note,
        ret.created_at,
        ret.updated_at,
        ret.device_id,
      ],
    });

    this.db.batch(statements);

    return { ret, items: returnItems };
  }
}
