/**
 * Sale repository and completeSale atomic batch.
 */
import { DbAdapter } from '../db-adapter.js';
import { Sale, SaleItem, StockMovement, CompleteSaleInput } from '../types/schemas.js';
import { allocateDiscount } from '../money.js';

export class SaleRepo {
  constructor(private db: DbAdapter) {}

  getSaleById(id: string): { sale: Sale; items: SaleItem[] } | undefined {
    const sales = this.db.query<Sale>(`SELECT * FROM sales WHERE id = ? AND deleted_at IS NULL`, [id]);
    const sale = sales[0];
    if (!sale) return undefined;
    const items = this.db.query<SaleItem>(`SELECT * FROM sale_items WHERE sale_id = ? AND deleted_at IS NULL`, [id]);
    return { sale, items };
  }

  getSales(shopId: string): Sale[] {
    return this.db.query<Sale>(
      `SELECT * FROM sales WHERE shop_id = ? AND deleted_at IS NULL ORDER BY sold_at DESC, created_at DESC`,
      [shopId]
    );
  }

  /**
   * Complete a sale as ONE atomic batch:
   * 1. Calculates net_total per line using allocateDiscount
   * 2. Inserts sale row
   * 3. Inserts sale_items rows
   * 4. Inserts stock_movements rows (qty_change = -qty, type = 'sale')
   */
  completeSale(input: CompleteSaleInput, saleId: string, itemIds: string[], movementIds: string[], nowIso: string): { sale: Sale; items: SaleItem[] } {
    // 1. Calculate subtotal
    const subtotal = input.lines.reduce((sum, item) => sum + item.unit_price * item.qty, 0);
    const total = Math.max(0, subtotal - input.discount_amount);

    // 2. Allocate discount across lines
    const lineGrosses = input.lines.map((l) => ({ unit_price: l.unit_price, qty: l.qty }));
    const netTotals = allocateDiscount(lineGrosses, input.discount_amount);

    const sale: Sale = {
      id: saleId,
      shop_id: input.shop_id,
      receipt_no: input.receipt_no,
      sold_at: input.sold_at,
      subtotal,
      discount_amount: input.discount_amount,
      total,
      payment_method: input.payment_method,
      amount_received: input.amount_received,
      note: input.note,
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
      device_id: input.device_id,
      dirty: 1,
      server_updated_at: null,
    };

    const items: SaleItem[] = [];
    const movements: StockMovement[] = [];

    const statements: { sql: string; params?: unknown[] }[] = [];

    // Insert sale
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

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i]!;
      const itemId = itemIds[i]!;
      const movementId = movementIds[i]!;
      const net_total = netTotals[i]!;

      const saleItem: SaleItem = {
        id: itemId,
        shop_id: input.shop_id,
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
        device_id: input.device_id,
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

      const movement: StockMovement = {
        id: movementId,
        shop_id: input.shop_id,
        variant_id: line.variant_id,
        qty_change: -line.qty,
        type: 'sale',
        ref_type: 'sale',
        ref_id: saleId,
        unit_cost: line.unit_cost,
        note: `Sale receipt ${input.receipt_no}`,
        occurred_at: input.sold_at,
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

    // Execute atomic batch
    this.db.batch(statements);

    return { sale, items };
  }
}
