import { readRows } from '../query.js';
import {
  SaleSchema,
  IdSchema,
  TimestampSchema,
  SaleItemSchema,
  Return,
  ReturnItem,
  ReturnSchema,
  ReturnItemSchema,
  ProcessReturnInput,
  ProcessReturnInputSchema,
} from '../types/schemas.js';
import { addMoney, calcRefundAmount } from '../money.js';
import { DbAdapter } from '../db-adapter.js';
/**
 * Return repository and processReturn atomic batch.
 * Phase 1 correction: strict return integrity checks, duplicate rejection, tenant/sale verification.
 */

export class ReturnRepo {
  constructor(private db: DbAdapter) {}

  /** All live returns for a shop, newest first. */
  async getReturns(shopId: string): Promise<Return[]> {
    IdSchema.parse(shopId);
    return readRows(
      this.db,
      ReturnSchema,
      `SELECT * FROM returns WHERE shop_id = ? AND deleted_at IS NULL
       ORDER BY returned_at DESC, created_at DESC`,
      [shopId],
    );
  }

  /** All live return items for a shop (joined to a live return header). */
  async getReturnItems(shopId: string): Promise<ReturnItem[]> {
    IdSchema.parse(shopId);
    return readRows(
      this.db,
      ReturnItemSchema,
      `SELECT ri.* FROM return_items ri
       JOIN returns r ON r.id = ri.return_id
       WHERE ri.shop_id = ? AND ri.deleted_at IS NULL AND r.deleted_at IS NULL`,
      [shopId],
    );
  }

  async processReturn(
    input: ProcessReturnInput,
    returnId: string,
    returnItemIds: string[],
    movementIds: string[],
    nowIso: string,
  ): Promise<{ ret: Return; items: ReturnItem[] }> {
    const validatedInput = ProcessReturnInputSchema.parse(input);
    TimestampSchema.parse(nowIso);
    const ids = [returnId, ...returnItemIds, ...movementIds];
    ids.forEach((id) => IdSchema.parse(id));
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate record IDs');

    if (
      validatedInput.lines.length !== returnItemIds.length ||
      validatedInput.lines.length !== movementIds.length
    ) {
      throw new Error('Inconsistent ID array lengths for return processing');
    }

    if (
      new Set(validatedInput.lines.map((line) => line.sale_item_id)).size !==
      validatedInput.lines.length
    ) {
      throw new Error('Select each sale item only once per return');
    }

    // 1. Verify sale exists and belongs to shop
    const sales = await readRows(
      this.db,
      SaleSchema,
      `SELECT * FROM sales WHERE id = ? AND deleted_at IS NULL`,
      [validatedInput.sale_id],
    );
    const sale = sales[0];
    if (!sale) {
      throw new Error(`Sale ${validatedInput.sale_id} not found`);
    }
    if (sale.shop_id !== validatedInput.shop_id) {
      throw new Error(`Sale does not belong to shop ${validatedInput.shop_id}`);
    }

    // 2. Aggregate requested quantities per sale_item_id in this request
    const requestedQtys: Record<string, number> = {};
    for (const line of validatedInput.lines) {
      requestedQtys[line.sale_item_id] = (requestedQtys[line.sale_item_id] || 0) + line.qty;
    }

    // 3. Validate each sale item and already-returned quantities
    const saleItemMap: Record<
      string,
      {
        id: string;
        variant_id: string;
        qty: number;
        net_total: number;
        unit_cost: number;
        shop_id: string;
      }
    > = {};

    for (const saleItemId of Object.keys(requestedQtys)) {
      const items = await this.db.query<Record<string, unknown>>(
        `SELECT * FROM sale_items WHERE id = ? AND sale_id = ? AND deleted_at IS NULL`,
        [saleItemId, validatedInput.sale_id],
      );
      const si = items[0] ? SaleItemSchema.parse(items[0]) : undefined;
      if (!si) {
        throw new Error(`Sale item ${saleItemId} not found in sale ${validatedInput.sale_id}`);
      }
      if (si['shop_id'] !== validatedInput.shop_id) {
        throw new Error(`Sale item does not belong to shop ${validatedInput.shop_id}`);
      }

      saleItemMap[saleItemId] = {
        id: String(si['id']),
        variant_id: String(si['variant_id']),
        qty: Number(si['qty']),
        net_total: Number(si['net_total']),
        unit_cost: Number(si['unit_cost']),
        shop_id: String(si['shop_id']),
      };

      // Check already returned qty for this sale item across previous return items
      const returnedStats = await this.db.query<Record<string, unknown>>(
        `SELECT COALESCE(SUM(ri.qty), 0) AS total_returned
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         WHERE ri.sale_item_id = ? AND r.deleted_at IS NULL AND ri.deleted_at IS NULL`,
        [saleItemId],
      );
      const alreadyReturned = Number(returnedStats[0]?.['total_returned'] || 0);
      const requested = requestedQtys[saleItemId]!;

      if (alreadyReturned + requested > Number(si['qty'])) {
        throw new Error(
          `Cannot return ${requested} units for sale item ${saleItemId}: sold ${si['qty']}, already returned ${alreadyReturned}`,
        );
      }
    }

    let totalRefund = 0;
    const returnItems: ReturnItem[] = [];
    const statements: { sql: string; params?: unknown[] }[] = [];

    for (let i = 0; i < validatedInput.lines.length; i++) {
      const line = validatedInput.lines[i]!;
      const returnItemId = returnItemIds[i]!;
      const movementId = movementIds[i]!;
      const si = saleItemMap[line.sale_item_id]!;

      if (line.variant_id !== si.variant_id) {
        throw new Error(`Variant mismatch for sale item ${line.sale_item_id}`);
      }

      // SPEC §8.5 refund_amount per line = round(net_total x qty_returned / qty_sold)
      const refundAmount = calcRefundAmount(si.net_total, line.qty, si.qty);
      totalRefund = addMoney(totalRefund, refundAmount);

      const retItem: ReturnItem = {
        id: returnItemId,
        shop_id: validatedInput.shop_id,
        return_id: returnId,
        sale_item_id: line.sale_item_id,
        variant_id: line.variant_id,
        qty: line.qty,
        refund_amount: refundAmount,
        unit_cost: si.unit_cost,
        restocked: line.restocked ? 1 : 0,
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        device_id: validatedInput.device_id,
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

      if (line.restocked) {
        statements.push({
          sql: `INSERT INTO stock_movements (id, shop_id, variant_id, qty_change, type, ref_type, ref_id, unit_cost, note, occurred_at, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, NULL)`,
          params: [
            movementId,
            validatedInput.shop_id,
            line.variant_id,
            line.qty,
            'return',
            'return',
            returnId,
            si.unit_cost,
            `Return restock for sale item ${line.sale_item_id}`,
            validatedInput.returned_at,
            nowIso,
            nowIso,
            validatedInput.device_id,
          ],
        });
      }
    }

    const ret: Return = {
      id: returnId,
      shop_id: validatedInput.shop_id,
      sale_id: validatedInput.sale_id,
      returned_at: validatedInput.returned_at,
      refund_amount: totalRefund,
      refund_method: validatedInput.refund_method,
      note: validatedInput.note,
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
      device_id: validatedInput.device_id,
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

    // Guard reads run INSIDE the write transaction. Concurrent callers cannot both
    // consume the same remaining quantity, even through separate repo instances.
    const guards = validatedInput.lines.map((line) => ({
      sql: `INSERT INTO _operation_guards (id, valid)
        SELECT ?, CASE WHEN EXISTS (
          SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE si.id = ? AND si.sale_id = ? AND si.shop_id = ?
            AND s.shop_id = si.shop_id AND si.variant_id = ?
            AND si.deleted_at IS NULL AND s.deleted_at IS NULL
            AND si.qty >= ? + COALESCE((SELECT SUM(qty) FROM return_items WHERE sale_item_id = si.id), 0)
        ) THEN 1 ELSE 0 END`,
      params: [
        line.sale_item_id,
        line.sale_item_id,
        validatedInput.sale_id,
        validatedInput.shop_id,
        line.variant_id,
        line.qty,
      ],
    }));
    statements.unshift(...guards);
    statements.push(
      ...validatedInput.lines.map((line) => ({
        sql: 'DELETE FROM _operation_guards WHERE id = ?',
        params: [line.sale_item_id],
      })),
    );

    // Execute in exactly ONE atomic batch
    await this.db.batch(statements);

    return { ret, items: returnItems };
  }
}
