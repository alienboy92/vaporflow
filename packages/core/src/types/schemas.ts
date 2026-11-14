import { z } from 'zod';

// ---------------------------------------------------------------------------
// Common columns shared by every synced table
// ---------------------------------------------------------------------------

/** Common columns present on every synced row (local SQLite view). */
export const SyncColumnsSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  device_id: z.string().uuid(),
  dirty: z.number().int().min(0).max(1),
  server_updated_at: z.string().nullable(),
});

export type SyncColumns = z.infer<typeof SyncColumnsSchema>;

// ---------------------------------------------------------------------------
// shops
// ---------------------------------------------------------------------------

export const ShopSchema = SyncColumnsSchema.extend({
  name: z.string().min(1),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  logo_base64: z.string().nullable(),
  show_logo_on_receipt: z.number().int().min(0).max(1),
  currency_code: z.string().default('PKR'),
  currency_decimals: z.number().int().default(0),
  receipt_footer: z.string().default('Thank you for shopping with us'),
  default_low_stock_threshold: z.number().int().default(3),
});

export type Shop = z.infer<typeof ShopSchema>;

// ---------------------------------------------------------------------------
// devices
// ---------------------------------------------------------------------------

export const DeviceSchema = SyncColumnsSchema.extend({
  name: z.string().min(1),
  code: z.string().min(2).max(4),
  last_seen_at: z.string().nullable(),
});

export type Device = z.infer<typeof DeviceSchema>;

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------

export const CategorySchema = SyncColumnsSchema.extend({
  name: z.string().min(1),
  sort_order: z.number().int().default(0),
});

export type Category = z.infer<typeof CategorySchema>;

// ---------------------------------------------------------------------------
// products
// ---------------------------------------------------------------------------

export const ProductSchema = SyncColumnsSchema.extend({
  category_id: z.string().uuid().nullable(),
  name: z.string().min(1),
  brand: z.string().nullable(),
  notes: z.string().nullable(),
  is_active: z.number().int().min(0).max(1).default(1),
});

export type Product = z.infer<typeof ProductSchema>;

// ---------------------------------------------------------------------------
// variants
// ---------------------------------------------------------------------------

export const VariantSchema = SyncColumnsSchema.extend({
  product_id: z.string().uuid(),
  name: z.string().default('Default'),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  cost_price: z.number().int(),
  sale_price: z.number().int(),
  low_stock_threshold: z.number().int().nullable(),
  track_stock: z.number().int().min(0).max(1).default(1),
  is_active: z.number().int().min(0).max(1).default(1),
});

export type Variant = z.infer<typeof VariantSchema>;

// ---------------------------------------------------------------------------
// stock_movements (ledger — insert only)
// ---------------------------------------------------------------------------

export const StockMovementTypeSchema = z.enum([
  'opening',
  'restock',
  'adjustment',
  'sale',
  'return',
]);
export type StockMovementType = z.infer<typeof StockMovementTypeSchema>;

export const StockMovementSchema = SyncColumnsSchema.extend({
  variant_id: z.string().uuid(),
  qty_change: z.number().int().refine((n) => n !== 0, 'qty_change must be non-zero'),
  type: StockMovementTypeSchema,
  ref_type: z.string().nullable(),
  ref_id: z.string().uuid().nullable(),
  unit_cost: z.number().int().nullable(),
  note: z.string().nullable(),
  occurred_at: z.string(),
});

export type StockMovement = z.infer<typeof StockMovementSchema>;

// ---------------------------------------------------------------------------
// sales (ledger)
// ---------------------------------------------------------------------------

export const PaymentMethodSchema = z.enum(['cash', 'online']);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const SaleSchema = SyncColumnsSchema.extend({
  receipt_no: z.string(),
  sold_at: z.string(),
  subtotal: z.number().int(),
  discount_amount: z.number().int().default(0),
  total: z.number().int(),
  payment_method: PaymentMethodSchema,
  amount_received: z.number().int().nullable(),
  note: z.string().nullable(),
});

export type Sale = z.infer<typeof SaleSchema>;

// ---------------------------------------------------------------------------
// sale_items (ledger)
// ---------------------------------------------------------------------------

export const SaleItemSchema = SyncColumnsSchema.extend({
  sale_id: z.string().uuid(),
  variant_id: z.string().uuid(),
  product_name: z.string(),
  variant_name: z.string(),
  qty: z.number().int().min(1),
  list_price: z.number().int(),
  unit_price: z.number().int(),
  unit_cost: z.number().int(),
  net_total: z.number().int(),
});

export type SaleItem = z.infer<typeof SaleItemSchema>;

// ---------------------------------------------------------------------------
// returns (ledger)
// ---------------------------------------------------------------------------

export const ReturnSchema = SyncColumnsSchema.extend({
  sale_id: z.string().uuid(),
  returned_at: z.string(),
  refund_amount: z.number().int(),
  refund_method: PaymentMethodSchema,
  note: z.string().nullable(),
});

export type Return = z.infer<typeof ReturnSchema>;

// ---------------------------------------------------------------------------
// return_items (ledger)
// ---------------------------------------------------------------------------

export const ReturnItemSchema = SyncColumnsSchema.extend({
  return_id: z.string().uuid(),
  sale_item_id: z.string().uuid(),
  variant_id: z.string().uuid(),
  qty: z.number().int().min(1),
  refund_amount: z.number().int(),
  unit_cost: z.number().int(),
  restocked: z.number().int().min(0).max(1).default(0),
});

export type ReturnItem = z.infer<typeof ReturnItemSchema>;

// ---------------------------------------------------------------------------
// expenses (mutable)
// ---------------------------------------------------------------------------

export const ExpenseSchema = SyncColumnsSchema.extend({
  expense_date: z.string(), // YYYY-MM-DD
  amount: z.number().int().min(1),
  category: z.string().min(1),
  note: z.string().nullable(),
});

export type Expense = z.infer<typeof ExpenseSchema>;

// ---------------------------------------------------------------------------
// settings (local only, no sync columns)
// ---------------------------------------------------------------------------

export const SettingSchema = z.object({
  key: z.string(),
  value: z.string().nullable(),
});

export type Setting = z.infer<typeof SettingSchema>;

// ---------------------------------------------------------------------------
// v_stock_on_hand view row
// ---------------------------------------------------------------------------

export const StockOnHandSchema = z.object({
  variant_id: z.string().uuid(),
  on_hand: z.number().int(),
});

export type StockOnHand = z.infer<typeof StockOnHandSchema>;

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export interface ProfitAndLoss {
  net_revenue: number;
  net_cogs: number;
  gross_profit: number;
  expenses_total: number;
  net_profit: number;
  sales_count: number;
  avg_sale_value: number;
  cash_total: number;
  online_total: number;
}

export interface TopItem {
  variant_id: string;
  product_name: string;
  variant_name: string;
  value: number; // qty or profit depending on context
}

// ---------------------------------------------------------------------------
// Input types (for creating records — no id/timestamps yet)
// ---------------------------------------------------------------------------

export interface CartLine {
  variant_id: string;
  product_name: string;
  variant_name: string;
  qty: number;
  list_price: number;
  unit_price: number;
  unit_cost: number;
}

export interface CompleteSaleInput {
  shop_id: string;
  device_id: string;
  receipt_no: string;
  sold_at: string;
  payment_method: PaymentMethod;
  amount_received: number | null;
  discount_amount: number;
  note: string | null;
  lines: CartLine[];
}

export interface ReturnLineInput {
  sale_item_id: string;
  variant_id: string;
  qty: number;
  restocked: boolean;
}

export interface ProcessReturnInput {
  shop_id: string;
  device_id: string;
  sale_id: string;
  returned_at: string;
  refund_method: PaymentMethod;
  note: string | null;
  lines: ReturnLineInput[];
}
