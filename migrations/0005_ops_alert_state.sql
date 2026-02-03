CREATE TABLE IF NOT EXISTS ops_alert_state (
  key TEXT PRIMARY KEY,
  last_sent_at INTEGER NOT NULL,
  last_value REAL NOT NULL,
  last_payload TEXT
);
