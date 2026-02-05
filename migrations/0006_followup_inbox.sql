-- Follow-up inbox support
ALTER TABLE conversations ADD COLUMN last_inbound_at TEXT;
ALTER TABLE conversations ADD COLUMN last_outbound_at TEXT;
ALTER TABLE conversations ADD COLUMN needs_followup INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN followup_reasons TEXT;
ALTER TABLE conversations ADD COLUMN participant_id TEXT;
ALTER TABLE conversations ADD COLUMN participant_name TEXT;
ALTER TABLE conversations ADD COLUMN participant_handle TEXT;
ALTER TABLE conversations ADD COLUMN meta_thread_id TEXT;
ALTER TABLE conversations ADD COLUMN asset_id TEXT;

ALTER TABLE messages ADD COLUMN asset_id TEXT;
ALTER TABLE messages ADD COLUMN platform TEXT;
ALTER TABLE messages ADD COLUMN ig_business_id TEXT;
ALTER TABLE messages ADD COLUMN direction TEXT;
ALTER TABLE messages ADD COLUMN sender_id TEXT;
ALTER TABLE messages ADD COLUMN sender_name TEXT;
ALTER TABLE messages ADD COLUMN attachments TEXT;
ALTER TABLE messages ADD COLUMN raw TEXT;
ALTER TABLE messages ADD COLUMN meta_message_id TEXT;

CREATE TABLE IF NOT EXISTS conversation_tags (
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, conversation_id, tag)
);

CREATE TABLE IF NOT EXISTS saved_responses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  asset_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_attribution (
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  ad_id TEXT,
  ad_name TEXT,
  click_ts TEXT,
  source TEXT,
  creative_url TEXT,
  thumb_url TEXT,
  raw TEXT,
  PRIMARY KEY (user_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS conversation_leads (
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  status TEXT,
  stage TEXT,
  disposition TEXT,
  updated_at TEXT NOT NULL,
  raw TEXT,
  PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS conversations_followup_idx ON conversations (user_id, needs_followup, last_inbound_at);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages (user_id, conversation_id, created_time);
CREATE INDEX IF NOT EXISTS conversation_tags_user_tag_idx ON conversation_tags (user_id, tag);
