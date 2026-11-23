export function getTableUpsertStatement(
  table: string,
  r: Record<string, unknown>,
  serverUpdatedAt: string,
): { sql: string; params?: unknown[] } {
  const b = (v: unknown) => (v ? 1 : 0);

  switch (table) {
    case 'shops':
      return {
        sql: `INSERT INTO shops (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, address, phone, logo_base64, show_logo_on_receipt, currency_code, currency_decimals, receipt_footer, default_low_stock_threshold)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                shop_id = excluded.shop_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, device_id = excluded.device_id,
                name = excluded.name, address = excluded.address, phone = excluded.phone, logo_base64 = excluded.logo_base64, show_logo_on_receipt = excluded.show_logo_on_receipt,
                currency_code = excluded.currency_code, currency_decimals = excluded.currency_decimals, receipt_footer = excluded.receipt_footer, default_low_stock_threshold = excluded.default_low_stock_threshold,
                dirty = 0, server_updated_at = ?`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.name, r.address ?? null, r.phone ?? null, r.logo_base64 ?? null, b(r.show_logo_on_receipt),
          r.currency_code, r.currency_decimals, r.receipt_footer, r.default_low_stock_threshold,
          serverUpdatedAt,
        ],
      };
    case 'devices':
      return {
        sql: `INSERT INTO devices (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, code, last_seen_at)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                shop_id = excluded.shop_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, device_id = excluded.device_id,
                name = excluded.name, code = excluded.code, last_seen_at = excluded.last_seen_at,
                dirty = 0, server_updated_at = ?`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.name, r.code, r.last_seen_at ?? null,
          serverUpdatedAt,
        ],
      };
    case 'categories':
      return {
        sql: `INSERT INTO categories (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                shop_id = excluded.shop_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, device_id = excluded.device_id,
                name = excluded.name, sort_order = excluded.sort_order,
                dirty = 0, server_updated_at = ?`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.name, r.sort_order,
          serverUpdatedAt,
        ],
      };
    case 'products':
      return {
        sql: `INSERT INTO products (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, category_id, name, brand, notes, is_active)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                shop_id = excluded.shop_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, device_id = excluded.device_id,
                category_id = excluded.category_id, name = excluded.name, brand = excluded.brand, notes = excluded.notes, is_active = excluded.is_active,
                dirty = 0, server_updated_at = ?`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.category_id ?? null, r.name, r.brand ?? null, r.notes ?? null, b(r.is_active),
          serverUpdatedAt,
        ],
      };
    case 'variants':
      return {
        sql: `INSERT INTO variants (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, product_id, name, sku, barcode, cost_price, sale_price, low_stock_threshold, track_stock, is_active)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                shop_id = excluded.shop_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, device_id = excluded.device_id,
                product_id = excluded.product_id, name = excluded.name, sku = excluded.sku, barcode = excluded.barcode,
                cost_price = excluded.cost_price, sale_price = excluded.sale_price, low_stock_threshold = excluded.low_stock_threshold,
                track_stock = excluded.track_stock, is_active = excluded.is_active,
                dirty = 0, server_updated_at = ?`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.product_id, r.name, r.sku ?? null, r.barcode ?? null, r.cost_price, r.sale_price,
          r.low_stock_threshold ?? null, b(r.track_stock), b(r.is_active),
          serverUpdatedAt,
        ],
      };
    case 'expenses':
      return {
        sql: `INSERT INTO expenses (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, expense_date, amount, category, note)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                shop_id = excluded.shop_id, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, device_id = excluded.device_id,
                expense_date = excluded.expense_date, amount = excluded.amount, category = excluded.category, note = excluded.note,
                dirty = 0, server_updated_at = ?`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.expense_date, r.amount, r.category, r.note ?? null,
          serverUpdatedAt,
        ],
      };
    case 'stock_movements':
      return {
        sql: `INSERT INTO stock_movements (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, variant_id, qty_change, type, ref_type, ref_id, unit_cost, note, occurred_at)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                server_updated_at = excluded.server_updated_at, dirty = 0`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.variant_id, r.qty_change, r.type, r.ref_type ?? null, r.ref_id ?? null, r.unit_cost ?? null, r.note ?? null, r.occurred_at,
        ],
      };
    case 'sales':
      return {
        sql: `INSERT INTO sales (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, receipt_no, sold_at, subtotal, discount_amount, total, payment_method, amount_received, note)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                server_updated_at = excluded.server_updated_at, dirty = 0`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.receipt_no, r.sold_at, r.subtotal, r.discount_amount, r.total, r.payment_method, r.amount_received ?? null, r.note ?? null,
        ],
      };
    case 'sale_items':
      return {
        sql: `INSERT INTO sale_items (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, sale_id, variant_id, product_name, variant_name, qty, list_price, unit_price, unit_cost, net_total)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                server_updated_at = excluded.server_updated_at, dirty = 0`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.sale_id, r.variant_id, r.product_name, r.variant_name, r.qty, r.list_price, r.unit_price, r.unit_cost, r.net_total,
        ],
      };
    case 'returns':
      return {
        sql: `INSERT INTO returns (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, sale_id, returned_at, refund_amount, refund_method, note)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                server_updated_at = excluded.server_updated_at, dirty = 0`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.sale_id, r.returned_at, r.refund_amount, r.refund_method, r.note ?? null,
        ],
      };
    case 'return_items':
      return {
        sql: `INSERT INTO return_items (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, return_id, sale_item_id, variant_id, qty, refund_amount, unit_cost, restocked)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                server_updated_at = excluded.server_updated_at, dirty = 0`,
        params: [
          r.id, r.shop_id, r.created_at, r.updated_at, r.deleted_at ?? null, r.device_id, serverUpdatedAt,
          r.return_id, r.sale_item_id, r.variant_id, r.qty, r.refund_amount, r.unit_cost, b(r.restocked),
        ],
      };
    default:
      throw new Error(`Unknown table: ${table}`);
  }
}
