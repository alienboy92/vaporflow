import { z } from 'zod';
import { DbAdapter } from './db-adapter.js';
import {
  ShopSchema,
  DeviceSchema,
  CategorySchema,
  ProductSchema,
  VariantSchema,
  ExpenseSchema,
  StockMovementSchema,
  SaleSchema,
  SaleItemSchema,
  ReturnSchema,
  ReturnItemSchema,
  Shop,
  Device,
  Category,
  Product,
  Variant,
  Expense,
  StockMovement,
  Sale,
  SaleItem,
  Return,
  ReturnItem,
} from './types/schemas.js';

export const VfBackupSchema = z.object({
  format_version: z.literal(1),
  app_version: z.string(),
  exported_at: z.string(),
  shop_id: z.string(),
  tables: z.object({
    shops: z.array(ShopSchema),
    devices: z.array(DeviceSchema),
    categories: z.array(CategorySchema),
    products: z.array(ProductSchema),
    variants: z.array(VariantSchema),
    expenses: z.array(ExpenseSchema),
    stock_movements: z.array(StockMovementSchema),
    sales: z.array(SaleSchema),
    sale_items: z.array(SaleItemSchema),
    returns: z.array(ReturnSchema),
    return_items: z.array(ReturnItemSchema),
  }),
});

export type VfBackup = z.infer<typeof VfBackupSchema>;

export async function exportBackupJson(db: DbAdapter, shopId: string): Promise<string> {
  const shopRows = await db.query<Shop>('SELECT * FROM shops WHERE id = ?', [shopId]);
  const deviceRows = await db.query<Device>('SELECT * FROM devices');
  const categoryRows = await db.query<Category>('SELECT * FROM categories');
  const productRows = await db.query<Product>('SELECT * FROM products');
  const variantRows = await db.query<Variant>('SELECT * FROM variants');
  const expenseRows = await db.query<Expense>('SELECT * FROM expenses');
  const stockMovementRows = await db.query<StockMovement>('SELECT * FROM stock_movements');
  const saleRows = await db.query<Sale>('SELECT * FROM sales');
  const saleItemRows = await db.query<SaleItem>('SELECT * FROM sale_items');
  const returnRows = await db.query<Return>('SELECT * FROM returns');
  const returnItemRows = await db.query<ReturnItem>('SELECT * FROM return_items');

  const backup: VfBackup = {
    format_version: 1,
    app_version: '1.0.0',
    exported_at: new Date().toISOString(),
    shop_id: shopId,
    tables: {
      shops: shopRows,
      devices: deviceRows,
      categories: categoryRows,
      products: productRows,
      variants: variantRows,
      expenses: expenseRows,
      stock_movements: stockMovementRows,
      sales: saleRows,
      sale_items: saleItemRows,
      returns: returnRows,
      return_items: returnItemRows,
    },
  };

  return JSON.stringify(backup, null, 2);
}

export function validateBackupJson(jsonString: string): { success: boolean; data?: VfBackup; error?: string } {
  try {
    const parsedObj = JSON.parse(jsonString) as unknown;
    const result = VfBackupSchema.safeParse(parsedObj);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return { success: false, error: `Invalid backup schema: ${issues}` };
    }

    const backup = result.data;
    const saleIds = new Set(backup.tables.sales.map((s) => s.id));
    const variantIds = new Set(backup.tables.variants.map((v) => v.id));

    for (const item of backup.tables.sale_items) {
      if (!saleIds.has(item.sale_id)) {
        return { success: false, error: `Referential integrity error: sale_item references missing sale_id ${item.sale_id}` };
      }
      if (!variantIds.has(item.variant_id)) {
        return { success: false, error: `Referential integrity error: sale_item references missing variant_id ${item.variant_id}` };
      }
    }

    for (const ret of backup.tables.returns) {
      if (!saleIds.has(ret.sale_id)) {
        return { success: false, error: `Referential integrity error: return references missing sale_id ${ret.sale_id}` };
      }
    }

    return { success: true, data: backup };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Corrupt or invalid JSON backup file' };
  }
}

export async function restoreBackup(db: DbAdapter, backup: VfBackup): Promise<void> {
  const validation = validateBackupJson(JSON.stringify(backup));
  if (!validation.success) {
    throw new Error(validation.error || 'Invalid backup');
  }

  const statements: { sql: string; params?: unknown[] }[] = [];

  statements.push({ sql: 'DELETE FROM return_items' });
  statements.push({ sql: 'DELETE FROM returns' });
  statements.push({ sql: 'DELETE FROM sale_items' });
  statements.push({ sql: 'DELETE FROM sales' });
  statements.push({ sql: 'DELETE FROM stock_movements' });
  statements.push({ sql: 'DELETE FROM expenses' });
  statements.push({ sql: 'DELETE FROM variants' });
  statements.push({ sql: 'DELETE FROM products' });
  statements.push({ sql: 'DELETE FROM categories' });
  statements.push({ sql: 'DELETE FROM devices' });
  statements.push({ sql: 'DELETE FROM shops' });

  for (const row of backup.tables.shops) {
    statements.push({
      sql: `INSERT INTO shops (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, address, phone, logo_base64, show_logo_on_receipt, currency_code, currency_decimals, receipt_footer, default_low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id, row.shop_id, row.created_at, row.updated_at, row.deleted_at ?? null, row.device_id, row.server_updated_at ?? null,
        row.name, row.address ?? null, row.phone ?? null, row.logo_base64 ?? null, row.show_logo_on_receipt,
        row.currency_code, row.currency_decimals, row.receipt_footer, row.default_low_stock_threshold,
      ],
    });
  }

  for (const row of backup.tables.devices) {
    statements.push({
      sql: `INSERT INTO devices (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, code, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      params: [
        row.id, row.shop_id, row.created_at, row.updated_at, row.deleted_at ?? null, row.device_id, row.server_updated_at ?? null,
        row.name, row.code, row.last_seen_at ?? null,
      ],
    });
  }

  for (const row of backup.tables.categories) {
    statements.push({
      sql: `INSERT INTO categories (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, name, sort_order) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      params: [
        row.id, row.shop_id, row.created_at, row.updated_at, row.deleted_at ?? null, row.device_id, row.server_updated_at ?? null,
        row.name, row.sort_order,
      ],
    });
  }

  for (const row of backup.tables.products) {
    statements.push({
      sql: `INSERT INTO products (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, category_id, name, brand, notes, is_active) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id, row.shop_id, row.created_at, row.updated_at, row.deleted_at ?? null, row.device_id, row.server_updated_at ?? null,
        row.category_id ?? null, row.name, row.brand ?? null, row.notes ?? null, row.is_active,
      ],
    });
  }

  for (const row of backup.tables.variants) {
    statements.push({
      sql: `INSERT INTO variants (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, product_id, name, sku, barcode, cost_price, sale_price, low_stock_threshold, track_stock, is_active) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id, row.shop_id, row.created_at, row.updated_at, row.deleted_at ?? null, row.device_id, row.server_updated_at ?? null,
        row.product_id, row.name, row.sku ?? null, row.barcode ?? null, row.cost_price, row.sale_price,
        row.low_stock_threshold ?? null, row.track_stock, row.is_active,
      ],
    });
  }

  for (const row of backup.tables.expenses) {
    statements.push({
      sql: `INSERT INTO expenses (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, expense_date, amount, category, note) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      params: [
        row.id, row.shop_id, row.created_at, row.updated_at, row.deleted_at ?? null, row.device_id, row.server_updated_at ?? null,
        row.expense_date, row.amount, row.category, row.note ?? null,
      ],
    });
  }

  for (const row of backup.tables.stock_movements) {
    statements.push({
      sql: `INSERT INTO stock_movements (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, variant_id, qty_change, type, ref_type, ref_id, unit_cost, note, occurred_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id, row.shop_id, row.created_at, row.updated_at, row.deleted_at ?? null, row.device_id, row.server_updated_at ?? null,
        row.variant_id, row.qty_change, row.type, row.ref_type ?? null, row.ref_id ?? null, row.unit_cost ?? null, row.note ?? null, row.occurred_at,
      ],
    });
  }

  for (const row of backup.tables.sales) {
    statements.push({
      sql: `INSERT INTO sales (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, receipt_no, sold_at, subtotal, discount_amount, total, payment_method, amount_received, note) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id, row.shop_id, row.created_at, row.updated_at, row.deleted_at ?? null, row.device_id, row.server_updated_at ?? null,
        row.receipt_no, row.sold_at, row.subtotal, row.discount_amount, row.total, row.payment_method, row.amount_received ?? null, row.note ?? null,
      ],
    });
  }

  for (const row of backup.tables.sale_items) {
    statements.push({
      sql: `INSERT INTO sale_items (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, sale_id, variant_id, product_name, variant_name, qty, list_price, unit_price, unit_cost, net_total) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id, row.shop_id, row.created_at, row.updated_at, row.deleted_at ?? null, row.device_id, row.server_updated_at ?? null,
        row.sale_id, row.variant_id, row.product_name, row.variant_name, row.qty, row.list_price, row.unit_price, row.unit_cost, row.net_total,
      ],
    });
  }

  for (const row of backup.tables.returns) {
    statements.push({
      sql: `INSERT INTO returns (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, sale_id, returned_at, refund_amount, refund_method, note) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id, row.shop_id, row.created_at, row.updated_at, row.deleted_at ?? null, row.device_id, row.server_updated_at ?? null,
        row.sale_id, row.returned_at, row.refund_amount, row.refund_method, row.note ?? null,
      ],
    });
  }

  for (const row of backup.tables.return_items) {
    statements.push({
      sql: `INSERT INTO return_items (id, shop_id, created_at, updated_at, deleted_at, device_id, dirty, server_updated_at, return_id, sale_item_id, variant_id, qty, refund_amount, unit_cost, restocked) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id, row.shop_id, row.created_at, row.updated_at, row.deleted_at ?? null, row.device_id, row.server_updated_at ?? null,
        row.return_id, row.sale_item_id, row.variant_id, row.qty, row.refund_amount, row.unit_cost, row.restocked,
      ],
    });
  }

  await db.batch(statements);

  try {
    const activeDeviceCodeRes = await db.query<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'active_device_code'"
    );
    const deviceCode = activeDeviceCodeRes[0]?.value;
    if (deviceCode) {
      const salesRes = await db.query<{ receipt_no: string }>(
        "SELECT receipt_no FROM sales WHERE receipt_no LIKE ?",
        [`${deviceCode}-%`]
      );
      let maxCounter = 0;
      for (const s of salesRes) {
        const parts = s.receipt_no.split('-');
        const numStr = parts[parts.length - 1];
        if (numStr) {
          const num = parseInt(numStr, 10);
          if (!isNaN(num) && num > maxCounter) {
            maxCounter = num;
          }
        }
      }
      const nextCounter = maxCounter + 1;
      await db.query(
        "INSERT INTO settings(key, value) VALUES('receipt_counter', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [String(nextCounter)]
      );
    }
  } catch {
    // Non-fatal if settings table or counter recovery fails
  }
}
