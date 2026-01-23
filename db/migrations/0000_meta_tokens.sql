CREATE TABLE IF NOT EXISTS meta_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encrypted_value TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  token_type TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
