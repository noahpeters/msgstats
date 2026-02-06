-- Conversation Inspector inference support
ALTER TABLE conversations ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN inbound_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN outbound_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN is_spam INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN current_state TEXT;
ALTER TABLE conversations ADD COLUMN current_confidence TEXT;
ALTER TABLE conversations ADD COLUMN followup_due_at TEXT;
ALTER TABLE conversations ADD COLUMN followup_suggestion TEXT;
ALTER TABLE conversations ADD COLUMN last_evaluated_at TEXT;
ALTER TABLE conversations ADD COLUMN state_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE conversations ADD COLUMN off_platform_outcome TEXT;
ALTER TABLE conversations ADD COLUMN last_snippet TEXT;

ALTER TABLE messages ADD COLUMN features_json TEXT;
ALTER TABLE messages ADD COLUMN rule_hits_json TEXT;

CREATE TABLE IF NOT EXISTS conversation_state_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  confidence TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  triggered_by_message_id TEXT,
  triggered_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS conversations_state_last_inbound_idx
  ON conversations (user_id, current_state, last_inbound_at);
CREATE INDEX IF NOT EXISTS conversations_followup_due_idx
  ON conversations (user_id, followup_due_at);
CREATE INDEX IF NOT EXISTS conversations_asset_last_message_idx
  ON conversations (user_id, asset_id, last_message_at);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_meta_thread_idx
  ON conversations (user_id, meta_thread_id, platform);

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (user_id, conversation_id, created_time);
CREATE INDEX IF NOT EXISTS messages_asset_created_idx
  ON messages (user_id, asset_id, created_time);
CREATE UNIQUE INDEX IF NOT EXISTS messages_meta_id_idx
  ON messages (user_id, meta_message_id, platform);

CREATE INDEX IF NOT EXISTS conversation_state_events_convo_idx
  ON conversation_state_events (user_id, conversation_id, triggered_at);
