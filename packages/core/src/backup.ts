import { z } from 'zod';
import { DbAdapter } from './db-adapter.js';
import { APP_VERSION } from './version.js';
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

export async function exportBackupJson(
  db: DbAdapter,
  shopId: string,
  appVersion = APP_VERSION,
): Promise<string> {
  // A single SQLite statement holds one read snapshot across every table.
  const tables = VfBackupSchema.shape.tables.shape;
  const selects = Object.entries(tables).map(([table, schema]) => {
    const columns = Object.keys(schema.element.shape);
    const fields = columns.map((column) => `'${column}', ${column}`).join(', ');
    const owner = table === 'shops' ? 'id' : 'shop_id';
    return `SELECT '${table}' AS source, json_object(${fields}) AS payload FROM ${table} WHERE ${owner} = ?`;
  });
  const rows = z.array(z.object({ source: VfBackupSchema.shape.tables.keyof(), payload: z.string() })).parse(
    await db.query(selects.join(' UNION ALL '), selects.map(() => shopId)),
  );
  const contents: Record<string, unknown[]> = Object.fromEntries(Object.keys(tables).map((name) => [name, []]));
  for (const row of rows) contents[row.source]!.push(JSON.parse(row.payload) as unknown);
  return JSON.stringify(VfBackupSchema.parse({
    format_version: 1, app_version: appVersion, exported_at: new Date().toISOString(),
    shop_id: shopId, tables: contents,
  }), null, 2);
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

    // Referential integrity: every child row must point at a parent present in
    // the same backup. A truncated or hand-edited file must be rejected before
    // any data is touched.
    const shopIds = new Set(backup.tables.shops.map((s) => s.id));
    const deviceIds = new Set(backup.tables.devices.map((d) => d.id));
    const categoryIds = new Set(backup.tables.categories.map((c) => c.id));
    const productIds = new Set(backup.tables.products.map((p) => p.id));
    const variantIds = new Set(backup.tables.variants.map((v) => v.id));
    const saleIds = new Set(backup.tables.sales.map((s) => s.id));
    const saleItemIds = new Set(backup.tables.sale_items.map((si) => si.id));
    const returnIds = new Set(backup.tables.returns.map((r) => r.id));

    const refError = (message: string) =>
      ({ success: false as const, error: `Referential integrity error: ${message}` });

    if (!shopIds.has(backup.shop_id)) {
      return refError(`backup.shop_id ${backup.shop_id} is missing from tables.shops`);
    }

    // Duplicate primary keys would fail mid-batch and abort the restore.
    const idChecks: [string, Set<string>][] = [
      ['shops', shopIds],
      ['devices', deviceIds],
      ['categories', categoryIds],
      ['products', productIds],
      ['variants', variantIds],
      ['expenses', new Set(backup.tables.expenses.map((e) => e.id))],
      ['stock_movements', new Set(backup.tables.stock_movements.map((m) => m.id))],
      ['sales', saleIds],
      ['sale_items', saleItemIds],
      ['returns', returnIds],
      ['return_items', new Set(backup.tables.return_items.map((ri) => ri.id))],
    ];
    const tableLengths: Record<string, number> = {
      shops: backup.tables.shops.length,
      devices: backup.tables.devices.length,
      categories: backup.tables.categories.length,
      products: backup.tables.products.length,
      variants: backup.tables.variants.length,
      expenses: backup.tables.expenses.length,
      stock_movements: backup.tables.stock_movements.length,
      sales: backup.tables.sales.length,
      sale_items: backup.tables.sale_items.length,
      returns: backup.tables.returns.length,
      return_items: backup.tables.return_items.length,
    };
    for (const [table, ids] of idChecks) {
      if (ids.size !== tableLengths[table]) {
        return { success: false, error: `Duplicate record IDs in tables.${table}` };
      }
    }

    for (const device of backup.tables.devices) {
      if (!shopIds.has(device.shop_id)) return refError(`device ${device.id} references missing shop`);
    }
    for (const category of backup.tables.categories) {
      if (category.shop_id !== backup.shop_id) return refError(`category ${category.id} has a foreign shop_id`);
    }
    for (const product of backup.tables.products) {
      if (product.shop_id !== backup.shop_id) return refError(`product ${product.id} has a foreign shop_id`);
      if (product.category_id && !categoryIds.has(product.category_id)) {
        return refError(`product ${product.id} references missing category`);
      }
    }
    for (const variant of backup.tables.variants) {
      if (variant.shop_id !== backup.shop_id) return refError(`variant ${variant.id} has a foreign shop_id`);
      if (!productIds.has(variant.product_id)) {
        return refError(`variant ${variant.id} references missing product`);
      }
    }
    for (const expense of backup.tables.expenses) {
      if (expense.shop_id !== backup.shop_id) return refError(`expense ${expense.id} has a foreign shop_id`);
    }
    for (const movement of backup.tables.stock_movements) {
      if (movement.shop_id !== backup.shop_id) return refError(`stock_movement ${movement.id} has a foreign shop_id`);
      if (!variantIds.has(movement.variant_id)) {
        return refError(`stock_movement ${movement.id} references missing variant`);
      }
    }
    for (const sale of backup.tables.sales) {
      if (sale.shop_id !== backup.shop_id) return refError(`sale ${sale.id} has a foreign shop_id`);
    }
    for (const item of backup.tables.sale_items) {
      if (!saleIds.has(item.sale_id)) {
        return refError(`sale_item ${item.id} references missing sale`);
      }
      if (!variantIds.has(item.variant_id)) {
        return refError(`sale_item ${item.id} references missing variant`);
      }
    }
    for (const ret of backup.tables.returns) {
      if (!saleIds.has(ret.sale_id)) {
        return refError(`return ${ret.id} references missing sale`);
      }
    }
    for (const retItem of backup.tables.return_items) {
      if (!returnIds.has(retItem.return_id)) {
        return refError(`return_item ${retItem.id} references missing return`);
      }
      if (!saleItemIds.has(retItem.sale_item_id)) {
        return refError(`return_item ${retItem.id} references missing sale_item`);
      }
      if (!variantIds.has(retItem.variant_id)) {
        return refError(`return_item ${retItem.id} references missing variant`);
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

  backup = validation.data!;
  const localSettings = z.array(z.object({ key: z.string(), value: z.string().nullable() })).parse(
    await db.query("SELECT key, value FROM settings WHERE key IN ('active_device_id', 'receipt_counter')"),
  );
  const localId = localSettings.find((setting) => setting.key === 'active_device_id')?.value;
  const previousCounter = Number(localSettings.find((setting) => setting.key === 'receipt_counter')?.value ?? '0');
  if (!Number.isSafeInteger(previousCounter) || previousCounter < 0) throw new Error('Invalid local receipt counter');
  const localDevice = localId ? DeviceSchema.array().parse(
    await db.query('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL', [localId]),
  )[0] : undefined;
  if (localDevice) {
    const conflict = backup.tables.devices.find((d) => d.id !== localDevice.id && d.code === localDevice.code);
    if (conflict) throw new Error('Backup device code conflicts with this device. Change this device code before restoring.');
    backup.tables.devices = backup.tables.devices.filter((d) => d.id !== localDevice.id);
    backup.tables.devices.push({ ...localDevice, shop_id: backup.shop_id });
  }
  const activeDevice = localDevice ?? backup.tables.devices.find((d) => !d.deleted_at);
  if (!activeDevice) throw new Error('Backup has no active device');
  const statements: { sql: string; params?: unknown[] }[] = [];

  // Whole-backup recovery only. Transactional DDL restores guards on rollback;
  // no committed database is ever left without its ledger delete protections.
  const ledgers = ['return_items', 'returns', 'sale_items', 'sales', 'stock_movements'];
  for (const table of ledgers) {
    statements.push({ sql: `DROP TRIGGER ${table}_immutable_delete` });
  }
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

  statements.push({
    sql: "INSERT INTO settings(key, value) VALUES('active_shop_id', ?), ('active_device_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    params: [backup.shop_id, activeDevice.id],
  });
  statements.push({
    sql: "DELETE FROM settings WHERE key = 'cloud_enrolled_shop_id' AND value <> ?",
    params: [backup.shop_id],
  });
  // Counter and data must become visible in the same commit.
  const maxCounter = backup.tables.sales.reduce((max, sale) => {
    const suffix = /-(\d+)$/.exec(sale.receipt_no)?.[1];
    const value = Number(suffix ?? 0);
    if (!Number.isSafeInteger(value)) throw new Error('Invalid receipt counter in backup');
    return Math.max(max, value);
  }, previousCounter);
  statements.push({
    sql: "INSERT INTO settings(key, value) VALUES('receipt_counter', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    params: [String(maxCounter)],
  });
  statements.push({sql: 'DELETE FROM sync_versions'}, {sql: 'DELETE FROM sync_attention'},
    {sql: "DELETE FROM settings WHERE key IN ('cloud_join_shop','cloud_join_identity','cloud_claim_shop','cloud_claim_identity')"});
  statements.push({ sql: "DELETE FROM settings WHERE key GLOB 'sync_cursor_*' OR key GLOB 'pull_cursor*' OR key = 'last_sync_at'" });
  for (const table of ledgers) {
    statements.push({ sql: `CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT, 'Ledger rows are immutable'); END` });
  }
  // Keep the single atomic restore within the adapters' 10,000-statement
  // boundary. Bound each multi-row insert below SQLite's 999-parameter floor.
  const compact: typeof statements = [];
  let previousSql = '';
  for (const statement of statements) {
    const values = /^(INSERT INTO (?!settings)[\s\S]+? VALUES )(\([^)]*\))$/.exec(statement.sql);
    const last = compact[compact.length - 1];
    if (values && previousSql === statement.sql && last &&
        (last.params?.length ?? 0) + (statement.params?.length ?? 0) <= 900) {
      last.sql += ', ' + values[2];
      last.params!.push(...statement.params!);
    } else {
      compact.push({ sql: statement.sql, params: statement.params ? [...statement.params] : undefined });
    }
    previousSql = statement.sql;
  }
  await db.batch(compact);
}
