import { z } from 'zod';

export const IdSchema = z.uuidv7();
export const TimestampSchema = z.iso.datetime({ precision: 3 });
export const DateSchema = z.iso.date();

export const SyncColumnsSchema = z.object({
  id: IdSchema,
  shop_id: IdSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  deleted_at: TimestampSchema.nullable(),
  device_id: IdSchema,
  dirty: z.number().int().min(0).max(1),
  server_updated_at: z.iso.datetime({ offset: true }).nullable(),
});

export type SyncColumns = z.infer<typeof SyncColumnsSchema>;

// ---------------------------------------------------------------------------
// shops
// ---------------------------------------------------------------------------

export const ShopSchema = SyncColumnsSchema.extend({
  name: z.string().min(1),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  logo_base64: z
    .string()
    .nullable()
    .refine((val) => !val || val.length <= 200000, 'Logo base64 exceeds max size (~150KB)'),
  show_logo_on_receipt: z.number().int().min(0).max(1),
  currency_code: z.string().default('PKR'),
  currency_decimals: z.number().int().default(0),
  receipt_footer: z.string().default('Thank you for shopping with us'),
  default_low_stock_threshold: z.number().int().min(0).default(3),
});

export type Shop = z.infer<typeof ShopSchema>;

// ---------------------------------------------------------------------------
// devices
// ---------------------------------------------------------------------------

export const DeviceSchema = SyncColumnsSchema.extend({
  name: z.string().min(1),
  code: z.string().regex(/^[A-Z0-9]{2,4}$/),
  last_seen_at: TimestampSchema.nullable(),
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
  category_id: IdSchema.nullable(),
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
  product_id: IdSchema,
  name: z.string().min(1).default('Default'),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  cost_price: z.number().int().nonnegative('Cost price must be non-negative integer'),
  sale_price: z.number().int().nonnegative('Sale price must be non-negative integer'),
  low_stock_threshold: z.number().int().nonnegative().nullable(),
  track_stock: z.number().int().min(0).max(1).default(1),
  is_active: z.number().int().min(0).max(1).default(1),
});

export type Variant = z.infer<typeof VariantSchema>;

// ---------------------------------------------------------------------------
// stock_movements
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
  variant_id: IdSchema,
  qty_change: z
    .number()
    .int()
    .refine((n) => n !== 0, 'qty_change must be non-zero integer'),
  type: StockMovementTypeSchema,
  ref_type: z.string().nullable(),
  ref_id: IdSchema.nullable(),
  unit_cost: z.number().int().nonnegative().nullable(),
  note: z.string().nullable(),
  occurred_at: TimestampSchema,
});

export type StockMovement = z.infer<typeof StockMovementSchema>;

// ---------------------------------------------------------------------------
// sales
// ---------------------------------------------------------------------------

export const PaymentMethodSchema = z.enum(['cash', 'online']);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const SaleSchema = SyncColumnsSchema.extend({
  receipt_no: z.string().min(1),
  sold_at: TimestampSchema,
  subtotal: z.number().int().nonnegative(),
  discount_amount: z.number().int().nonnegative().default(0),
  total: z.number().int().nonnegative(),
  payment_method: PaymentMethodSchema,
  amount_received: z.number().int().nonnegative().nullable(),
  note: z.string().nullable(),
});

export type Sale = z.infer<typeof SaleSchema>;

// ---------------------------------------------------------------------------
// sale_items
// ---------------------------------------------------------------------------

export const SaleItemSchema = SyncColumnsSchema.extend({
  sale_id: IdSchema,
  variant_id: IdSchema,
  product_name: z.string().min(1),
  variant_name: z.string().min(1),
  qty: z.number().int().positive('Quantity must be a positive integer'),
  list_price: z.number().int().nonnegative(),
  unit_price: z.number().int().nonnegative(),
  unit_cost: z.number().int().nonnegative(),
  net_total: z.number().int(),
});

export type SaleItem = z.infer<typeof SaleItemSchema>;

// ---------------------------------------------------------------------------
// returns
// ---------------------------------------------------------------------------

export const ReturnSchema = SyncColumnsSchema.extend({
  sale_id: IdSchema,
  returned_at: TimestampSchema,
  refund_amount: z.number().int(),
  refund_method: PaymentMethodSchema,
  note: z.string().nullable(),
});

export type Return = z.infer<typeof ReturnSchema>;

// ---------------------------------------------------------------------------
// return_items
// ---------------------------------------------------------------------------

export const ReturnItemSchema = SyncColumnsSchema.extend({
  return_id: IdSchema,
  sale_item_id: IdSchema,
  variant_id: IdSchema,
  qty: z.number().int().positive('Return quantity must be a positive integer'),
  refund_amount: z.number().int(),
  unit_cost: z.number().int().nonnegative(),
  restocked: z.number().int().min(0).max(1).default(0),
});

export type ReturnItem = z.infer<typeof ReturnItemSchema>;

// ---------------------------------------------------------------------------
// expenses
// ---------------------------------------------------------------------------

export const ExpenseSchema = SyncColumnsSchema.extend({
  expense_date: DateSchema,
  amount: z.number().int().positive('Expense amount must be positive'),
  category: z.string().min(1),
  note: z.string().nullable(),
});

export type Expense = z.infer<typeof ExpenseSchema>;

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export const SettingSchema = z.object({
  key: z.string().min(1),
  value: z.string().nullable(),
});

export type Setting = z.infer<typeof SettingSchema>;

// ---------------------------------------------------------------------------
// v_stock_on_hand view row
// ---------------------------------------------------------------------------

export const StockOnHandSchema = z.object({
  variant_id: IdSchema,
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
  value: number;
}

// ---------------------------------------------------------------------------
// Input validation schemas
// ---------------------------------------------------------------------------

export const CartLineInputSchema = z.object({
  variant_id: IdSchema,
  product_name: z.string().min(1),
  variant_name: z.string().min(1),
  qty: z.number().int().positive('Quantity must be a positive integer'),
  list_price: z.number().int().nonnegative(),
  unit_price: z.number().int().nonnegative(),
});

export type CartLine = z.infer<typeof CartLineInputSchema>;

export const CompleteSaleInputSchema = z.object({
  shop_id: IdSchema,
  device_id: IdSchema,
  receipt_no: z.string().min(1),
  sold_at: TimestampSchema,
  payment_method: PaymentMethodSchema,
  amount_received: z.number().int().nonnegative().nullable(),
  discount_amount: z.number().int().nonnegative().default(0),
  note: z.string().nullable(),
  lines: z.array(CartLineInputSchema).min(1, 'Sale must contain at least one line item'),
});

export type CompleteSaleInput = z.infer<typeof CompleteSaleInputSchema>;

export const ReturnLineInputSchema = z.object({
  sale_item_id: IdSchema,
  variant_id: IdSchema,
  qty: z.number().int().positive('Return quantity must be a positive integer'),
  restocked: z.boolean(),
});

export type ReturnLineInput = z.infer<typeof ReturnLineInputSchema>;

export const ProcessReturnInputSchema = z.object({
  shop_id: IdSchema,
  device_id: IdSchema,
  sale_id: IdSchema,
  returned_at: TimestampSchema,
  refund_method: PaymentMethodSchema,
  note: z.string().nullable(),
  lines: z.array(ReturnLineInputSchema).min(1, 'Return must contain at least one line item'),
});

export type ProcessReturnInput = z.infer<typeof ProcessReturnInputSchema>;
