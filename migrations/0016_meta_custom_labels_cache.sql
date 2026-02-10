CREATE TABLE IF NOT EXISTS meta_custom_labels_cache (
  user_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  label_name TEXT NOT NULL,
  label_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, page_id, label_name)
);

CREATE INDEX IF NOT EXISTS meta_custom_labels_cache_page_idx
  ON meta_custom_labels_cache (user_id, page_id);
