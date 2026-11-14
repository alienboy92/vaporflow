-- Migration 001: Initial POS schema

-- 1. shops (Mutable)
CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  shop_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  device_id TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  logo_base64 TEXT,
  show_logo_on_receipt INTEGER NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT 'PKR',
  currency_decimals INTEGER NOT NULL DEFAULT 0,
  receipt_footer TEXT NOT NULL DEFAULT 'Thank you for shopping with us',
  default_low_stock_threshold INTEGER NOT NULL DEFAULT 3
);

-- 2. devices (Mutable)
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  device_id TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  last_seen_at TEXT
);

-- 3. categories (Mutable)
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  device_id TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 4. products (Mutable)
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  device_id TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  category_id TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- 5. variants (Mutable)
CREATE TABLE variants (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  device_id TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Default',
  sku TEXT,
  barcode TEXT,
  cost_price INTEGER NOT NULL,
  sale_price INTEGER NOT NULL,
  low_stock_threshold INTEGER,
  track_stock INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- 6. expenses (Mutable)
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  device_id TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  expense_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  category TEXT NOT NULL,
  note TEXT
);

-- 7. stock_movements (Ledger - insert-only)
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  device_id TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  variant_id TEXT NOT NULL,
  qty_change INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('opening','restock','adjustment','sale','return')),
  ref_type TEXT,
  ref_id TEXT,
  unit_cost INTEGER,
  note TEXT,
  occurred_at TEXT NOT NULL
);

-- 8. sales (Ledger - insert-only)
CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  device_id TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  receipt_no TEXT NOT NULL,
  sold_at TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','online')),
  amount_received INTEGER,
  note TEXT
);

-- 9. sale_items (Ledger - insert-only)
CREATE TABLE sale_items (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  device_id TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  sale_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  list_price INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  net_total INTEGER NOT NULL
);

-- 10. returns (Ledger - insert-only)
CREATE TABLE returns (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  device_id TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  sale_id TEXT NOT NULL,
  returned_at TEXT NOT NULL,
  refund_amount INTEGER NOT NULL,
  refund_method TEXT NOT NULL CHECK(refund_method IN ('cash','online')),
  note TEXT
);

-- 11. return_items (Ledger - insert-only)
CREATE TABLE return_items (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  device_id TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  server_updated_at TEXT,
  return_id TEXT NOT NULL,
  sale_item_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  refund_amount INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  restocked INTEGER NOT NULL DEFAULT 0
);

-- 12. settings (local only, key/value)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Indexes and Views
CREATE UNIQUE INDEX idx_variants_barcode_unique ON variants(shop_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_stock_movements_variant_id ON stock_movements(variant_id);
CREATE INDEX idx_sales_sold_at ON sales(sold_at);

CREATE VIEW v_stock_on_hand AS
SELECT variant_id, SUM(qty_change) as on_hand
FROM stock_movements
GROUP BY variant_id;
