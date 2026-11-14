-- VaporFlow Initial Supabase Migration (PostgreSQL)

-- ---------------------------------------------------------------------------
-- 1. Trigger function for server_updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_server_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.server_updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- shops (no shop_id FK because it is the shop)
CREATE TABLE shops (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  logo_base64 TEXT,
  show_logo_on_receipt BOOLEAN DEFAULT false,
  currency_code TEXT DEFAULT 'PKR',
  currency_decimals INTEGER DEFAULT 0,
  receipt_footer TEXT DEFAULT 'Thank you for shopping with us',
  default_low_stock_threshold INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  device_id UUID NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- shop_members (Postgres only - links users to shops)
CREATE TABLE shop_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ DEFAULT now(),
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shop_id, user_id)
);

-- devices
CREATE TABLE devices (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  device_id UUID NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- categories
CREATE TABLE categories (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  device_id UUID NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- products
CREATE TABLE products (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  brand TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  device_id UUID NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- variants
CREATE TABLE variants (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  sku TEXT,
  barcode TEXT,
  cost_price INTEGER NOT NULL,
  sale_price INTEGER NOT NULL,
  low_stock_threshold INTEGER,
  track_stock BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  device_id UUID NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- stock_movements (ledger - insert only)
CREATE TABLE stock_movements (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  qty_change INTEGER NOT NULL CHECK(qty_change != 0),
  type TEXT NOT NULL CHECK(type IN ('opening','restock','adjustment','sale','return')),
  ref_type TEXT,
  ref_id UUID,
  unit_cost INTEGER,
  note TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  device_id UUID NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- sales (ledger - insert only)
CREATE TABLE sales (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  receipt_no TEXT NOT NULL,
  sold_at TIMESTAMPTZ NOT NULL,
  subtotal INTEGER NOT NULL,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','online')),
  amount_received INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  device_id UUID NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- sale_items (ledger - insert only)
CREATE TABLE sale_items (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  list_price INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  net_total INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  device_id UUID NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- returns (ledger - insert only)
CREATE TABLE returns (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  returned_at TIMESTAMPTZ NOT NULL,
  refund_amount INTEGER NOT NULL,
  refund_method TEXT NOT NULL CHECK(refund_method IN ('cash','online')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  device_id UUID NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- return_items (ledger - insert only)
CREATE TABLE return_items (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  sale_item_id UUID NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL,
  refund_amount INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  restocked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  device_id UUID NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- expenses
CREATE TABLE expenses (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  amount INTEGER NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  device_id UUID NOT NULL,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Triggers for server_updated_at
-- ---------------------------------------------------------------------------
CREATE TRIGGER tr_shops_server_updated_at BEFORE INSERT OR UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
CREATE TRIGGER tr_shop_members_server_updated_at BEFORE INSERT OR UPDATE ON shop_members FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
CREATE TRIGGER tr_devices_server_updated_at BEFORE INSERT OR UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
CREATE TRIGGER tr_categories_server_updated_at BEFORE INSERT OR UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
CREATE TRIGGER tr_products_server_updated_at BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
CREATE TRIGGER tr_variants_server_updated_at BEFORE INSERT OR UPDATE ON variants FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
CREATE TRIGGER tr_stock_movements_server_updated_at BEFORE INSERT OR UPDATE ON stock_movements FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
CREATE TRIGGER tr_sales_server_updated_at BEFORE INSERT OR UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
CREATE TRIGGER tr_sale_items_server_updated_at BEFORE INSERT OR UPDATE ON sale_items FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
CREATE TRIGGER tr_returns_server_updated_at BEFORE INSERT OR UPDATE ON returns FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
CREATE TRIGGER tr_return_items_server_updated_at BEFORE INSERT OR UPDATE ON return_items FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
CREATE TRIGGER tr_expenses_server_updated_at BEFORE INSERT OR UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX idx_variants_barcode_shop ON variants (shop_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_stock_movements_variant_id ON stock_movements (variant_id);
CREATE INDEX idx_sales_sold_at ON sales (sold_at);

-- Sync cursor indexes
CREATE INDEX idx_devices_sync ON devices (shop_id, server_updated_at, id);
CREATE INDEX idx_categories_sync ON categories (shop_id, server_updated_at, id);
CREATE INDEX idx_products_sync ON products (shop_id, server_updated_at, id);
CREATE INDEX idx_variants_sync ON variants (shop_id, server_updated_at, id);
CREATE INDEX idx_stock_movements_sync ON stock_movements (shop_id, server_updated_at, id);
CREATE INDEX idx_sales_sync ON sales (shop_id, server_updated_at, id);
CREATE INDEX idx_sale_items_sync ON sale_items (shop_id, server_updated_at, id);
CREATE INDEX idx_returns_sync ON returns (shop_id, server_updated_at, id);
CREATE INDEX idx_return_items_sync ON return_items (shop_id, server_updated_at, id);
CREATE INDEX idx_expenses_sync ON expenses (shop_id, server_updated_at, id);
CREATE INDEX idx_shops_sync ON shops (id, server_updated_at);

-- ---------------------------------------------------------------------------
-- 5. Views
-- ---------------------------------------------------------------------------
CREATE VIEW v_stock_on_hand AS
SELECT shop_id, variant_id, SUM(qty_change) AS on_hand
FROM stock_movements
GROUP BY shop_id, variant_id;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security (RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- shop_members policy: users can only see/modify rows where user_id = auth.uid()
CREATE POLICY shop_members_policy ON shop_members
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- shops policy: accessible if shop id is in user's shop_members
CREATE POLICY shops_access_policy ON shops
  FOR ALL
  USING (id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()))
  WITH CHECK (id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()));

-- other tables policy: accessible if shop_id is in user's shop_members
CREATE POLICY devices_access_policy ON devices FOR ALL
  USING (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()));

CREATE POLICY categories_access_policy ON categories FOR ALL
  USING (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()));

CREATE POLICY products_access_policy ON products FOR ALL
  USING (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()));

CREATE POLICY variants_access_policy ON variants FOR ALL
  USING (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()));

CREATE POLICY stock_movements_access_policy ON stock_movements FOR ALL
  USING (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()));

CREATE POLICY sales_access_policy ON sales FOR ALL
  USING (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()));

CREATE POLICY sale_items_access_policy ON sale_items FOR ALL
  USING (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()));

CREATE POLICY returns_access_policy ON returns FOR ALL
  USING (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()));

CREATE POLICY return_items_access_policy ON return_items FOR ALL
  USING (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()));

CREATE POLICY expenses_access_policy ON expenses FOR ALL
  USING (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. RPC Functions (Security Definer hardened with search_path)
-- ---------------------------------------------------------------------------

-- 1. claim_shop(p_shop_id UUID)
CREATE OR REPLACE FUNCTION claim_shop(p_shop_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_exists BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if shop_id already has any owner/member (prevent claiming an already claimed shop)
  SELECT EXISTS (
    SELECT 1 FROM shop_members WHERE shop_id = p_shop_id
  ) INTO v_exists;

  IF v_exists THEN
    RETURN FALSE;
  END IF;

  INSERT INTO shop_members (shop_id, user_id, role)
  VALUES (p_shop_id, v_user_id, 'owner')
  ON CONFLICT (shop_id, user_id) DO NOTHING;

  RETURN TRUE;
END;
$$;

-- 2. sync_push(p_table TEXT, p_rows JSONB)
CREATE OR REPLACE FUNCTION sync_push(p_table TEXT, p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_row JSONB;
  v_shop_id UUID;
  v_is_member BOOLEAN;
  v_applied_count INTEGER := 0;
  v_is_mutable BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_table NOT IN ('shops', 'devices', 'categories', 'products', 'variants', 'stock_movements', 'sales', 'sale_items', 'returns', 'return_items', 'expenses') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table;
  END IF;

  v_is_mutable := p_table IN ('shops', 'devices', 'categories', 'products', 'variants', 'expenses');

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF p_table = 'shops' THEN
      v_shop_id := (v_row->>'id')::UUID;
    ELSE
      v_shop_id := (v_row->>'shop_id')::UUID;
    END IF;

    IF v_shop_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Verify user is a member of the shop
    SELECT EXISTS (
      SELECT 1 FROM shop_members WHERE shop_id = v_shop_id AND user_id = v_user_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
      CONTINUE;
    END IF;

    IF v_is_mutable THEN
      IF p_table = 'shops' THEN
        INSERT INTO shops SELECT * FROM jsonb_populate_record(null::shops, v_row)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          address = EXCLUDED.address,
          phone = EXCLUDED.phone,
          logo_base64 = EXCLUDED.logo_base64,
          show_logo_on_receipt = EXCLUDED.show_logo_on_receipt,
          currency_code = EXCLUDED.currency_code,
          currency_decimals = EXCLUDED.currency_decimals,
          receipt_footer = EXCLUDED.receipt_footer,
          default_low_stock_threshold = EXCLUDED.default_low_stock_threshold,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at,
          device_id = EXCLUDED.device_id
        WHERE EXCLUDED.updated_at > shops.updated_at;
      ELSIF p_table = 'devices' THEN
        INSERT INTO devices SELECT * FROM jsonb_populate_record(null::devices, v_row)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          code = EXCLUDED.code,
          last_seen_at = EXCLUDED.last_seen_at,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at,
          device_id = EXCLUDED.device_id
        WHERE EXCLUDED.updated_at > devices.updated_at;
      ELSIF p_table = 'categories' THEN
        INSERT INTO categories SELECT * FROM jsonb_populate_record(null::categories, v_row)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          sort_order = EXCLUDED.sort_order,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at,
          device_id = EXCLUDED.device_id
        WHERE EXCLUDED.updated_at > categories.updated_at;
      ELSIF p_table = 'products' THEN
        INSERT INTO products SELECT * FROM jsonb_populate_record(null::products, v_row)
        ON CONFLICT (id) DO UPDATE SET
          category_id = EXCLUDED.category_id,
          name = EXCLUDED.name,
          brand = EXCLUDED.brand,
          notes = EXCLUDED.notes,
          is_active = EXCLUDED.is_active,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at,
          device_id = EXCLUDED.device_id
        WHERE EXCLUDED.updated_at > products.updated_at;
      ELSIF p_table = 'variants' THEN
        INSERT INTO variants SELECT * FROM jsonb_populate_record(null::variants, v_row)
        ON CONFLICT (id) DO UPDATE SET
          product_id = EXCLUDED.product_id,
          name = EXCLUDED.name,
          sku = EXCLUDED.sku,
          barcode = EXCLUDED.barcode,
          cost_price = EXCLUDED.cost_price,
          sale_price = EXCLUDED.sale_price,
          low_stock_threshold = EXCLUDED.low_stock_threshold,
          track_stock = EXCLUDED.track_stock,
          is_active = EXCLUDED.is_active,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at,
          device_id = EXCLUDED.device_id
        WHERE EXCLUDED.updated_at > variants.updated_at;
      ELSIF p_table = 'expenses' THEN
        INSERT INTO expenses SELECT * FROM jsonb_populate_record(null::expenses, v_row)
        ON CONFLICT (id) DO UPDATE SET
          expense_date = EXCLUDED.expense_date,
          amount = EXCLUDED.amount,
          category = EXCLUDED.category,
          note = EXCLUDED.note,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at,
          device_id = EXCLUDED.device_id
        WHERE EXCLUDED.updated_at > expenses.updated_at;
      END IF;
    ELSE
      -- Ledger tables are insert-only. Prevent modifications on conflict.
      IF p_table = 'stock_movements' THEN
        INSERT INTO stock_movements SELECT * FROM jsonb_populate_record(null::stock_movements, v_row)
        ON CONFLICT (id) DO NOTHING;
      ELSIF p_table = 'sales' THEN
        INSERT INTO sales SELECT * FROM jsonb_populate_record(null::sales, v_row)
        ON CONFLICT (id) DO NOTHING;
      ELSIF p_table = 'sale_items' THEN
        INSERT INTO sale_items SELECT * FROM jsonb_populate_record(null::sale_items, v_row)
        ON CONFLICT (id) DO NOTHING;
      ELSIF p_table = 'returns' THEN
        INSERT INTO returns SELECT * FROM jsonb_populate_record(null::returns, v_row)
        ON CONFLICT (id) DO NOTHING;
      ELSIF p_table = 'return_items' THEN
        INSERT INTO return_items SELECT * FROM jsonb_populate_record(null::return_items, v_row)
        ON CONFLICT (id) DO NOTHING;
      END IF;
    END IF;

    v_applied_count := v_applied_count + 1;
  END LOOP;

  RETURN v_applied_count;
END;
$$;

-- 3. sync_pull(p_table TEXT, p_shop_id UUID, p_cursor_updated_at TIMESTAMPTZ, p_cursor_id UUID, p_limit INTEGER DEFAULT 500)
CREATE OR REPLACE FUNCTION sync_pull(
  p_table TEXT,
  p_shop_id UUID,
  p_cursor_updated_at TIMESTAMPTZ,
  p_cursor_id UUID,
  p_limit INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_is_member BOOLEAN;
  v_result JSONB;
  v_sql TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_table NOT IN ('shops', 'devices', 'categories', 'products', 'variants', 'stock_movements', 'sales', 'sale_items', 'returns', 'return_items', 'expenses') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table;
  END IF;

  -- Verify user is a member of the shop
  SELECT EXISTS (
    SELECT 1 FROM shop_members WHERE shop_id = p_shop_id AND user_id = v_user_id
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Access denied: user is not a member of shop %', p_shop_id;
  END IF;

  IF p_table = 'shops' THEN
    v_sql := format(
      'SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]'::jsonb) FROM (SELECT * FROM %I WHERE id = %L AND (server_updated_at, id) > (%L, %L) ORDER BY server_updated_at, id LIMIT %s) t',
      p_table, p_shop_id, p_cursor_updated_at, p_cursor_id, p_limit
    );
  ELSE
    v_sql := format(
      'SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]'::jsonb) FROM (SELECT * FROM %I WHERE shop_id = %L AND (server_updated_at, id) > (%L, %L) ORDER BY server_updated_at, id LIMIT %s) t',
      p_table, p_shop_id, p_cursor_updated_at, p_cursor_id, p_limit
    );
  END IF;

  EXECUTE v_sql INTO v_result;
  RETURN v_result;
END;
$$;
