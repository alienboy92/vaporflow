-- Receipt numbers must be unique among live sales. The per-device counter is incremented
-- inside the completeSale batch; this index makes a lost concurrent race fail loudly
-- (the whole batch rolls back and no counter number is consumed) instead of writing
-- duplicate receipt numbers. Stored counter value means "last-used"; next = value + 1.
CREATE UNIQUE INDEX idx_sales_receipt_no_unique ON sales(shop_id, receipt_no) WHERE deleted_at IS NULL;
