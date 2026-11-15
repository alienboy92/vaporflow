-- VaporFlow Initial Supabase Migration (PostgreSQL)

-- ---------------------------------------------------------------------------
-- 1. Trigger function for server_updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_server_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
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
  shop_id UUID NOT NULL CHECK (shop_id = id),
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
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ DEFAULT now(),
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shop_id),
  CHECK (role = 'owner')
);

-- devices
CREATE TABLE devices (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
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
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
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
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  category_id UUID REFERENCES categories(id) ON DELETE RESTRICT,
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
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
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
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
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
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
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
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
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
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
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
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  return_id UUID NOT NULL REFERENCES returns(id) ON DELETE RESTRICT,
  sale_item_id UUID NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
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
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
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

-- Tenant-consistent foreign keys. A valid ID from another shop is not sufficient.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shops','devices','categories','products','variants','stock_movements','sales','sale_items','returns','return_items','expenses'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD UNIQUE(shop_id, id)', t);
    EXECUTE format('ALTER TABLE public.%I ADD CHECK (substring(id::text, 15, 1) = ''7'')', t);
  END LOOP;
END $$;
CREATE UNIQUE INDEX idx_devices_code_unique ON public.devices(shop_id, code);
ALTER TABLE public.products ADD FOREIGN KEY(shop_id, category_id) REFERENCES public.categories(shop_id, id);
ALTER TABLE public.variants ADD FOREIGN KEY(shop_id, product_id) REFERENCES public.products(shop_id, id);
ALTER TABLE public.stock_movements ADD FOREIGN KEY(shop_id, variant_id) REFERENCES public.variants(shop_id, id);
ALTER TABLE public.sale_items ADD FOREIGN KEY(shop_id, sale_id) REFERENCES public.sales(shop_id, id);
ALTER TABLE public.sale_items ADD FOREIGN KEY(shop_id, variant_id) REFERENCES public.variants(shop_id, id);
ALTER TABLE public.returns ADD FOREIGN KEY(shop_id, sale_id) REFERENCES public.sales(shop_id, id);
ALTER TABLE public.return_items ADD FOREIGN KEY(shop_id, return_id) REFERENCES public.returns(shop_id, id);
ALTER TABLE public.return_items ADD FOREIGN KEY(shop_id, sale_item_id) REFERENCES public.sale_items(shop_id, id);
ALTER TABLE public.return_items ADD FOREIGN KEY(shop_id, variant_id) REFERENCES public.variants(shop_id, id);
ALTER TABLE public.variants ADD CHECK(cost_price >= 0 AND sale_price >= 0);
ALTER TABLE public.sale_items ADD CHECK(qty > 0 AND unit_price >= 0 AND unit_cost >= 0 AND list_price >= 0);
ALTER TABLE public.return_items ADD CHECK(qty > 0 AND unit_cost >= 0);
ALTER TABLE public.sales ADD CHECK(subtotal >= 0 AND discount_amount BETWEEN 0 AND subtotal AND total = subtotal - discount_amount);
ALTER TABLE public.expenses ADD CHECK(amount > 0);

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE FUNCTION private.prevent_ledger_change() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Ledger rows are immutable';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shops','devices','categories','products','variants','stock_movements','sales','sale_items','returns','return_items','expenses'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY member_read ON public.%I FOR SELECT TO authenticated USING (shop_id IN (SELECT shop_id FROM public.shop_members WHERE user_id = (SELECT auth.uid())))', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['stock_movements','sales','sale_items','returns','return_items'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.prevent_ledger_change()', t);
  END LOOP;
END $$;
ALTER TABLE public.shop_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_membership_read ON public.shop_members FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.shop_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shop_members TO authenticated;
CREATE VIEW public.v_stock_on_hand WITH (security_invoker = true) AS
SELECT shop_id, variant_id, SUM(qty_change) AS on_hand FROM public.stock_movements GROUP BY shop_id, variant_id;
REVOKE ALL ON public.v_stock_on_hand FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_stock_on_hand TO authenticated;

-- Reserving an absent shop and membership is one serialized transaction.
-- The placeholder timestamp predates valid device data so the first push wins.
CREATE FUNCTION public.claim_shop(p_shop_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_shop_id IS NULL OR substring(p_shop_id::text,15,1) <> '7' THEN RAISE EXCEPTION 'Invalid shop ID'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_shop_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.shops WHERE id = p_shop_id) THEN
    RETURN EXISTS (SELECT 1 FROM public.shop_members WHERE shop_id = p_shop_id AND user_id = u);
  END IF;
  INSERT INTO public.shops(id, shop_id, name, created_at, updated_at, device_id)
  VALUES(p_shop_id, p_shop_id, 'Shop', '0001-01-01T00:00:00Z', '0001-01-01T00:00:00Z', p_shop_id);
  INSERT INTO public.shop_members(shop_id, user_id, role) VALUES(p_shop_id, u, 'owner');
  RETURN true;
END $$;

CREATE FUNCTION public.sync_push(p_table text, p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u uuid := auth.uid(); row_data jsonb; shop uuid; row_id uuid; existing_shop uuid;
  mutable boolean; assignments text; accepted integer := 0;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_table IS NULL OR p_table NOT IN ('shops','devices','categories','products','variants','stock_movements','sales','sale_items','returns','return_items','expenses') THEN
    RAISE EXCEPTION 'Invalid table';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'Rows must be an array'; END IF;
  IF jsonb_array_length(p_rows) > 200 THEN RAISE EXCEPTION 'Maximum 200 rows'; END IF;
  mutable := p_table IN ('shops','devices','categories','products','variants','expenses');
  -- Identifiers come only from the allowlisted relation's catalog, never JSON keys.
  SELECT string_agg(format('%I = EXCLUDED.%I', a.attname, a.attname), ', ' ORDER BY a.attnum)
  INTO assignments FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = format('public.%I', p_table)::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname NOT IN ('id','shop_id','created_at','device_id','server_updated_at');
  IF p_table = 'shops' THEN
    assignments := assignments || ', created_at = CASE WHEN stored.updated_at = ''0001-01-01T00:00:00Z''::timestamptz THEN EXCLUDED.created_at ELSE stored.created_at END, device_id = CASE WHEN stored.updated_at = ''0001-01-01T00:00:00Z''::timestamptz THEN EXCLUDED.device_id ELSE stored.device_id END';
  END IF;
  FOR row_data IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(row_data) <> 'object' THEN RAISE EXCEPTION 'Row must be an object'; END IF;
    row_id := (row_data->>'id')::uuid;
    shop := (row_data->>'shop_id')::uuid;
    IF row_id IS NULL OR shop IS NULL OR NOT EXISTS (SELECT 1 FROM public.shop_members WHERE shop_id = shop AND user_id = u) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_table || row_id::text, 1));
    EXECUTE format('SELECT shop_id FROM public.%I WHERE id = $1 FOR UPDATE', p_table) INTO existing_shop USING row_id;
    IF existing_shop IS NOT NULL AND existing_shop <> shop THEN RAISE EXCEPTION 'Row belongs to another shop'; END IF;
    IF mutable THEN
      EXECUTE format('INSERT INTO public.%1$I AS stored SELECT * FROM jsonb_populate_record(NULL::public.%1$I, $1)
        ON CONFLICT (id) DO UPDATE SET %2$s WHERE stored.shop_id = EXCLUDED.shop_id AND EXCLUDED.updated_at > stored.updated_at', p_table, assignments)
        USING row_data;
    ELSE
      EXECUTE format('INSERT INTO public.%1$I SELECT * FROM jsonb_populate_record(NULL::public.%1$I, $1) ON CONFLICT (id) DO NOTHING', p_table)
        USING row_data;
    END IF;
    -- A stale mutable row or duplicate ledger row is successfully acknowledged.
    accepted := accepted + 1;
  END LOOP;
  RETURN accepted;
END $$;

CREATE FUNCTION public.sync_pull(p_table text, p_shop_id uuid, p_cursor_updated_at timestamptz, p_cursor_id uuid, p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; u uuid := auth.uid();
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_table IS NULL OR p_table NOT IN ('shops','devices','categories','products','variants','stock_movements','sales','sale_items','returns','return_items','expenses') THEN RAISE EXCEPTION 'Invalid table'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shop_members WHERE shop_id = p_shop_id AND user_id = u) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Limit must be 1 to 500'; END IF;
  IF (p_cursor_updated_at IS NULL) <> (p_cursor_id IS NULL) THEN RAISE EXCEPTION 'Both cursor fields are required'; END IF;
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.server_updated_at, t.id), ''[]''::jsonb)
    FROM (SELECT * FROM public.%I WHERE shop_id = $1 AND ($2 IS NULL OR (server_updated_at, id) > ($2, $3)) ORDER BY server_updated_at, id LIMIT $4) t', p_table)
    INTO result USING p_shop_id, p_cursor_updated_at, p_cursor_id, p_limit;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.claim_shop(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_push(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_pull(text, uuid, timestamptz, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_server_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.prevent_ledger_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_shop(uuid), public.sync_push(text, jsonb), public.sync_pull(text, uuid, timestamptz, uuid, integer) TO authenticated;
