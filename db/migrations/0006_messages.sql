CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  body TEXT,
  created_time TEXT NOT NULL
);
