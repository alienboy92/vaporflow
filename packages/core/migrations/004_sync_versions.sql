CREATE TABLE sync_versions (
  shop_id TEXT NOT NULL, table_name TEXT NOT NULL, row_id TEXT NOT NULL, version INTEGER NOT NULL,
  PRIMARY KEY (shop_id, table_name, row_id)
);
CREATE TABLE sync_attention (
  shop_id TEXT NOT NULL, table_name TEXT NOT NULL, row_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('conflict','quarantine')),
  version INTEGER NOT NULL, payload TEXT NOT NULL, reason TEXT NOT NULL, received_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, table_name, row_id, kind, version)
);
CREATE UNIQUE INDEX sync_conflict_identity ON sync_attention(shop_id,table_name,row_id) WHERE kind='conflict';
