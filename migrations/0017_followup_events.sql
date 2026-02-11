CREATE TABLE IF NOT EXISTS followup_events (
  followup_message_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  asset_id TEXT,
  followup_sent_at TEXT NOT NULL,
  previous_activity_at TEXT,
  idle_seconds INTEGER,
  revived INTEGER NOT NULL DEFAULT 0,
  immediate_loss INTEGER NOT NULL DEFAULT 0,
  next_inbound_message_id TEXT,
  next_inbound_at TEXT,
  next_inbound_is_loss INTEGER,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS followup_events_user_sent_idx
  ON followup_events (user_id, followup_sent_at);

CREATE INDEX IF NOT EXISTS followup_events_conversation_sent_idx
  ON followup_events (conversation_id, followup_sent_at);

CREATE INDEX IF NOT EXISTS followup_events_page_sent_idx
  ON followup_events (page_id, followup_sent_at);
