CREATE TABLE IF NOT EXISTS sync_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  last_synced_at TEXT,
  updated_at TEXT NOT NULL
);
