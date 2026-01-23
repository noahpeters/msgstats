CREATE TABLE IF NOT EXISTS meta_pages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
