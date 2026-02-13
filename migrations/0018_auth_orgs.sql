CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  auth0_sub TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS org_memberships (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','member','coach')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_user_id ON org_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org_id ON org_memberships (org_id);

CREATE TABLE IF NOT EXISTS org_meta_user (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  meta_user_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_org_meta_user_org_id ON org_meta_user (org_id);
CREATE INDEX IF NOT EXISTS idx_org_meta_user_user_id ON org_meta_user (user_id);

CREATE TABLE IF NOT EXISTS feature_flags_user (
  user_id TEXT NOT NULL,
  flag_key TEXT NOT NULL,
  flag_value TEXT NOT NULL,
  PRIMARY KEY (user_id, flag_key)
);

CREATE TABLE IF NOT EXISTS feature_flags_org (
  org_id TEXT NOT NULL,
  flag_key TEXT NOT NULL,
  flag_value TEXT NOT NULL,
  PRIMARY KEY (org_id, flag_key)
);

CREATE TABLE IF NOT EXISTS auth_tx (
  tx_id TEXT PRIMARY KEY,
  pkce_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_handle_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  active_org_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id);

CREATE TABLE IF NOT EXISTS org_invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','member','coach')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_org_invites_org_id ON org_invites (org_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON org_invites (email);

CREATE TABLE IF NOT EXISTS auth_pending_meta (
  token TEXT PRIMARY KEY,
  meta_user_id TEXT NOT NULL,
  suggested_name TEXT,
  suggested_org_name TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('create','migrate','link')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

ALTER TABLE meta_pages ADD COLUMN org_id TEXT;
ALTER TABLE ig_assets ADD COLUMN org_id TEXT;
ALTER TABLE conversations ADD COLUMN org_id TEXT;
ALTER TABLE messages ADD COLUMN org_id TEXT;
ALTER TABLE sync_states ADD COLUMN org_id TEXT;
ALTER TABLE sync_runs ADD COLUMN org_id TEXT;
ALTER TABLE conversation_tags ADD COLUMN org_id TEXT;
ALTER TABLE saved_responses ADD COLUMN org_id TEXT;
ALTER TABLE conversation_state_events ADD COLUMN org_id TEXT;
ALTER TABLE ai_usage_conversation_daily ADD COLUMN org_id TEXT;
ALTER TABLE meta_custom_labels_cache ADD COLUMN org_id TEXT;
ALTER TABLE followup_events ADD COLUMN org_id TEXT;
ALTER TABLE conversation_classification_audit ADD COLUMN org_id TEXT;
ALTER TABLE conversation_classification_feedback ADD COLUMN org_id TEXT;

CREATE INDEX IF NOT EXISTS idx_meta_pages_org_id ON meta_pages (org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ig_assets_org_id ON ig_assets (org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_org_id ON conversations (org_id, user_id, page_id);
CREATE INDEX IF NOT EXISTS idx_messages_org_id ON messages (org_id, user_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_sync_states_org_id ON sync_states (org_id, user_id, page_id, platform);
CREATE INDEX IF NOT EXISTS idx_sync_runs_org_id ON sync_runs (org_id, user_id, page_id, platform);
CREATE INDEX IF NOT EXISTS idx_conversation_tags_org_id ON conversation_tags (org_id, user_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_saved_responses_org_id ON saved_responses (org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_state_events_org_id ON conversation_state_events (org_id, user_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_conversation_daily_org_id ON ai_usage_conversation_daily (org_id, conversation_id, date);
CREATE INDEX IF NOT EXISTS idx_meta_custom_labels_cache_org_id ON meta_custom_labels_cache (org_id, user_id, page_id);
CREATE INDEX IF NOT EXISTS idx_followup_events_org_id ON followup_events (org_id, user_id, followup_sent_at);
CREATE INDEX IF NOT EXISTS idx_classification_audit_org_id ON conversation_classification_audit (org_id, asset_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_classification_feedback_org_id ON conversation_classification_feedback (org_id, asset_id, created_at DESC);
