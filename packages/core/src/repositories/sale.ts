import {
  SaleItemSchema,
  SaleSchema,
  IdSchema,
  TimestampSchema,
  VariantSchema,
  Sale,
  SaleItem,
  CompleteSaleInput,
  CompleteSaleInputSchema,
} from '../types/schemas.js';
import { readRows } from '../query.js';
import { addMoney, fromInteger, allocateDiscount } from '../money.js';
import { DbAdapter } from '../db-adapter.js';
/**
 * Sale repository and completeSale atomic batch.
 */

export class SaleRepo {
  constructor(private db: DbAdapter) {}

  async getSaleById(id: string): Promise<{ sale: Sale; items: SaleItem[] } | undefined> {
    IdSchema.parse(id);
    const sales = await readRows(
      this.db,
      SaleSchema,
      `SELECT * FROM sales WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    const sale = sales[0];
    if (!sale) return undefined;
    const items = await readRows(
      this.db,
      SaleItemSchema,
      `SELECT * FROM sale_items WHERE sale_id = ? AND deleted_at IS NULL`,
      [id],
    );
    return { sale, items };
  }

  async getSales(shopId: string): Promise<Sale[]> {
    IdSchema.parse(shopId);
    return readRows(
      this.db,
      SaleSchema,
      `SELECT * FROM sales WHERE shop_id = ? AND deleted_at IS NULL ORDER BY sold_at DESC, created_at DESC`,
      [shopId],
    );
  }

  /**
   * Complete a sale as ONE atomic batch:
   * 1. Validates input with Zod.
   * 2. Fetches authoritative variant cost_price from DB (tenant-checked).
   * 3. Calculates net_total per line using allocateDiscount.
   * 4. Inserts sale, sale_items, and stock_movements in one batch.
   */
  async completeSale(
    input: CompleteSaleInput,
    saleId: string,
    itemIds: string[],
    movementIds: string[],
    nowIso: string,
  ): Promise<{ sale: Sale; items: SaleItem[] }> {
    const validatedInput = CompleteSaleInputSchema.parse(input);
    TimestampSchema.parse(nowIso);
    const ids = [saleId, ...itemIds, ...movementIds];
    ids.forEach((id) => IdSchema.parse(id));
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate record IDs');

    if (
      validatedInput.lines.length !== itemIds.length ||
      validatedInput.lines.length !== movementIds.length
    ) {
      throw new Error('Inconsistent ID array lengths for sale completion');
    }

    // Determine the receipt number using the per-device counter in settings.
    // Stored counter semantics: the value is the LAST-USED number; the next
    // receipt uses value + 1. The read happens before the batch (candidate
    // number); correctness under concurrency is enforced by the unique index
    // idx_sales_receipt_no_unique (migration 003): if two completions race and
    // compute the same candidate, exactly one batch commits and the loser
    // rolls back — including its counter write — without consuming a number.
    const devices = await this.db.query<{ code: string }>(
      `SELECT code FROM devices WHERE id = ? AND deleted_at IS NULL`,
      [validatedInput.device_id],
    );
    const deviceCode = devices[0]?.code ?? 'PC1';

    const settingRows = await this.db.query<{ value: string | null }>(
      `SELECT value FROM settings WHERE key = 'receipt_counter'`,
    );
    const currentCounter = parseInt(settingRows[0]?.value ?? '0', 10);
    const nextCounter = currentCounter + 1;
    const receipt_no = validatedInput.receipt_no || `${deviceCode}-${String(nextCounter).padStart(6, '0')}`;

    // Verify variant costs from database for security/immutability
    const resolvedLines: {
      variant_id: string;
      product_name: string;
      variant_name: string;
      qty: number;
      list_price: number;
      unit_price: number;
      unit_cost: number;
    }[] = [];

    for (const line of validatedInput.lines) {
      const variants = await this.db.query<{ cost_price: number; shop_id: string }>(
        `SELECT * FROM variants WHERE id = ? AND deleted_at IS NULL`,
        [line.variant_id],
      );
      const v = variants[0] ? VariantSchema.parse(variants[0]) : undefined;
      if (!v) {
        throw new Error(`Variant ${line.variant_id} not found`);
      }
      if (v.shop_id !== validatedInput.shop_id) {
        throw new Error(
          `Variant ${line.variant_id} does not belong to shop ${validatedInput.shop_id}`,
        );
      }

      resolvedLines.push({
        variant_id: line.variant_id,
        product_name: line.product_name,
        variant_name: line.variant_name,
        qty: line.qty,
        list_price: line.list_price,
        unit_price: line.unit_price,
        unit_cost: v.cost_price, // authoritative snapshot from DB
      });
    }

    const subtotal = resolvedLines.reduce(
      (sum, item) => addMoney(sum, fromInteger(BigInt(item.unit_price) * BigInt(item.qty))),
      0,
    );
    const total = addMoney(subtotal, -validatedInput.discount_amount);

    const lineGrosses = resolvedLines.map((l) => ({ unit_price: l.unit_price, qty: l.qty }));
    const netTotals = allocateDiscount(lineGrosses, validatedInput.discount_amount);

    const sale: Sale = {
      id: saleId,
      shop_id: validatedInput.shop_id,
      receipt_no,
      sold_at: validatedInput.sold_at,
      subtotal,
      discount_amount: validatedInput.discount_amount,
      total,
      payment_method: validatedInput.payment_method,
      amount_received: validatedInput.amount_received,
      note: validatedInput.note,
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
      device_id: validatedInput.device_id,
      dirty: 1,
      server_updated_at: null,
    };

    const items: SaleItem[] = [];
    const statements: { sql: string; params?: unknown[] }[] = [];

    statements.push({
      sql: `INSERT INTO settings (key, value) VALUES ('receipt_counter', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      params: [String(nextCounter)],
    });

    statements.push({
      sql: `INSERT INTO sales (id, shop_id, receipt_no, sold_at, subtotal, discount_amount, total, payment_method, amount_received, note, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, NULL)`,
      params: [
        sale.id,
        sale.shop_id,
        sale.receipt_no,
        sale.sold_at,
        sale.subtotal,
        sale.discount_amount,
        sale.total,
        sale.payment_method,
        sale.amount_received,
        sale.note,
        sale.created_at,
        sale.updated_at,
        sale.device_id,
      ],
    });

    for (let i = 0; i < resolvedLines.length; i++) {
      const line = resolvedLines[i]!;
      const itemId = itemIds[i]!;
      const movementId = movementIds[i]!;
      const net_total = netTotals[i]!;

      const saleItem: SaleItem = {
        id: itemId,
        shop_id: validatedInput.shop_id,
        sale_id: saleId,
        variant_id: line.variant_id,
        product_name: line.product_name,
        variant_name: line.variant_name,
        qty: line.qty,
        list_price: line.list_price,
        unit_price: line.unit_price,
        unit_cost: line.unit_cost,
        net_total,
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
        device_id: validatedInput.device_id,
        dirty: 1,
        server_updated_at: null,
      };
      items.push(saleItem);

      statements.push({
        sql: `INSERT INTO sale_items (id, shop_id, sale_id, variant_id, product_name, variant_name, qty, list_price, unit_price, unit_cost, net_total, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, NULL)`,
        params: [
          saleItem.id,
          saleItem.shop_id,
          saleItem.sale_id,
          saleItem.variant_id,
          saleItem.product_name,
          saleItem.variant_name,
          saleItem.qty,
          saleItem.list_price,
          saleItem.unit_price,
          saleItem.unit_cost,
          saleItem.net_total,
          saleItem.created_at,
          saleItem.updated_at,
          saleItem.device_id,
        ],
      });

      statements.push({
        sql: `INSERT INTO stock_movements (id, shop_id, variant_id, qty_change, type, ref_type, ref_id, unit_cost, note, occurred_at, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, NULL)`,
        params: [
          movementId,
          validatedInput.shop_id,
          line.variant_id,
          -line.qty,
          'sale',
          'sale',
          saleId,
          line.unit_cost,
          `Sale receipt ${receipt_no}`,
          validatedInput.sold_at,
          nowIso,
          nowIso,
          validatedInput.device_id,
        ],
      });
    }

    // Check the catalog inside the write transaction as well as before it.
    statements.unshift(
      ...resolvedLines.map((line, index) => ({
        sql: `INSERT INTO _operation_guards (id, valid)
        SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM variants WHERE id = ? AND shop_id = ? AND deleted_at IS NULL AND cost_price = ?) THEN 1 ELSE 0 END`,
        params: [itemIds[index], line.variant_id, validatedInput.shop_id, line.unit_cost],
      })),
    );
    statements.push(
      ...itemIds.map((id) => ({ sql: 'DELETE FROM _operation_guards WHERE id = ?', params: [id] })),
    );
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed') &&
        error.message.includes('receipt_no')
      ) {
        throw new Error(
          'Receipt number conflict: another sale completed concurrently. Retry the sale to get the next number.',
        );
      }
      throw error;
    }

    return { sale, items };
  }
}
