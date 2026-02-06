CREATE TABLE IF NOT EXISTS ai_usage_daily (
  date TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_usage_conversation_daily (
  conversation_id TEXT NOT NULL,
  date TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, date)
);
