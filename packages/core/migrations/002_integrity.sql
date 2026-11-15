-- Transaction-local assertions used by repository batches. No rows survive a commit.
CREATE TABLE _operation_guards (
  id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);
CREATE UNIQUE INDEX idx_devices_code_unique ON devices(shop_id, code);

CREATE TRIGGER sales_immutable_update BEFORE UPDATE ON sales
WHEN OLD.id IS NOT NEW.id OR OLD.shop_id IS NOT NEW.shop_id OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at OR OLD.deleted_at IS NOT NEW.deleted_at OR OLD.device_id IS NOT NEW.device_id OR OLD.receipt_no IS NOT NEW.receipt_no OR OLD.sold_at IS NOT NEW.sold_at OR OLD.subtotal IS NOT NEW.subtotal OR OLD.discount_amount IS NOT NEW.discount_amount OR OLD.total IS NOT NEW.total OR OLD.payment_method IS NOT NEW.payment_method OR OLD.amount_received IS NOT NEW.amount_received OR OLD.note IS NOT NEW.note
BEGIN SELECT RAISE(ABORT, 'Ledger rows are immutable'); END;
CREATE TRIGGER sales_immutable_delete BEFORE DELETE ON sales
BEGIN SELECT RAISE(ABORT, 'Ledger rows are immutable'); END;
CREATE TRIGGER sale_items_immutable_update BEFORE UPDATE ON sale_items
WHEN OLD.id IS NOT NEW.id OR OLD.shop_id IS NOT NEW.shop_id OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at OR OLD.deleted_at IS NOT NEW.deleted_at OR OLD.device_id IS NOT NEW.device_id OR OLD.sale_id IS NOT NEW.sale_id OR OLD.variant_id IS NOT NEW.variant_id OR OLD.product_name IS NOT NEW.product_name OR OLD.variant_name IS NOT NEW.variant_name OR OLD.qty IS NOT NEW.qty OR OLD.list_price IS NOT NEW.list_price OR OLD.unit_price IS NOT NEW.unit_price OR OLD.unit_cost IS NOT NEW.unit_cost OR OLD.net_total IS NOT NEW.net_total
BEGIN SELECT RAISE(ABORT, 'Ledger rows are immutable'); END;
CREATE TRIGGER sale_items_immutable_delete BEFORE DELETE ON sale_items
BEGIN SELECT RAISE(ABORT, 'Ledger rows are immutable'); END;
CREATE TRIGGER returns_immutable_update BEFORE UPDATE ON returns
WHEN OLD.id IS NOT NEW.id OR OLD.shop_id IS NOT NEW.shop_id OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at OR OLD.deleted_at IS NOT NEW.deleted_at OR OLD.device_id IS NOT NEW.device_id OR OLD.sale_id IS NOT NEW.sale_id OR OLD.returned_at IS NOT NEW.returned_at OR OLD.refund_amount IS NOT NEW.refund_amount OR OLD.refund_method IS NOT NEW.refund_method OR OLD.note IS NOT NEW.note
BEGIN SELECT RAISE(ABORT, 'Ledger rows are immutable'); END;
CREATE TRIGGER returns_immutable_delete BEFORE DELETE ON returns
BEGIN SELECT RAISE(ABORT, 'Ledger rows are immutable'); END;
CREATE TRIGGER return_items_immutable_update BEFORE UPDATE ON return_items
WHEN OLD.id IS NOT NEW.id OR OLD.shop_id IS NOT NEW.shop_id OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at OR OLD.deleted_at IS NOT NEW.deleted_at OR OLD.device_id IS NOT NEW.device_id OR OLD.return_id IS NOT NEW.return_id OR OLD.sale_item_id IS NOT NEW.sale_item_id OR OLD.variant_id IS NOT NEW.variant_id OR OLD.qty IS NOT NEW.qty OR OLD.refund_amount IS NOT NEW.refund_amount OR OLD.unit_cost IS NOT NEW.unit_cost OR OLD.restocked IS NOT NEW.restocked
BEGIN SELECT RAISE(ABORT, 'Ledger rows are immutable'); END;
CREATE TRIGGER return_items_immutable_delete BEFORE DELETE ON return_items
BEGIN SELECT RAISE(ABORT, 'Ledger rows are immutable'); END;
CREATE TRIGGER stock_movements_immutable_update BEFORE UPDATE ON stock_movements
WHEN OLD.id IS NOT NEW.id OR OLD.shop_id IS NOT NEW.shop_id OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at OR OLD.deleted_at IS NOT NEW.deleted_at OR OLD.device_id IS NOT NEW.device_id OR OLD.variant_id IS NOT NEW.variant_id OR OLD.qty_change IS NOT NEW.qty_change OR OLD.type IS NOT NEW.type OR OLD.ref_type IS NOT NEW.ref_type OR OLD.ref_id IS NOT NEW.ref_id OR OLD.unit_cost IS NOT NEW.unit_cost OR OLD.note IS NOT NEW.note OR OLD.occurred_at IS NOT NEW.occurred_at
BEGIN SELECT RAISE(ABORT, 'Ledger rows are immutable'); END;
CREATE TRIGGER stock_movements_immutable_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'Ledger rows are immutable'); END;
