CREATE TABLE IF NOT EXISTS meta_users (
  id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  token_type TEXT,
  expires_at INTEGER,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS meta_pages (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT,
  access_token TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS ig_assets (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  name TEXT,
  updated_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS conversations (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  platform TEXT NOT NULL,
  page_id TEXT NOT NULL,
  ig_business_id TEXT,
  updated_time TEXT NOT NULL,
  started_time TEXT,
  last_message_at TEXT,
  customer_count INTEGER NOT NULL,
  business_count INTEGER NOT NULL,
  price_given INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS conversations_user_page_idx ON conversations (user_id, page_id);
CREATE INDEX IF NOT EXISTS conversations_user_platform_idx ON conversations (user_id, platform);

CREATE TABLE IF NOT EXISTS messages (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  body TEXT,
  created_time TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS messages_user_conversation_idx ON messages (user_id, conversation_id);

CREATE TABLE IF NOT EXISTS sync_states (
  user_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  ig_business_id TEXT,
  last_synced_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, page_id, platform, ig_business_id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  ig_business_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  last_error TEXT,
  conversations INTEGER NOT NULL,
  messages INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_runs_user_page_idx ON sync_runs (user_id, page_id);
CREATE INDEX IF NOT EXISTS sync_runs_user_platform_idx ON sync_runs (user_id, platform);
