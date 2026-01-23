CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  last_error TEXT,
  pages INTEGER NOT NULL,
  conversations INTEGER NOT NULL,
  messages INTEGER NOT NULL
);
