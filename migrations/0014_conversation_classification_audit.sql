CREATE TABLE IF NOT EXISTS conversation_classification_audit (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  contact_id TEXT,
  computed_label TEXT NOT NULL,
  reason_codes TEXT NOT NULL,
  feature_snapshot TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  classifier_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_asset_time
  ON conversation_classification_audit (asset_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_asset_convo_time
  ON conversation_classification_audit (asset_id, conversation_id, computed_at DESC);

CREATE TABLE IF NOT EXISTS conversation_classification_feedback (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  contact_id TEXT,
  audit_id TEXT,
  current_label TEXT NOT NULL,
  correct_label TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_asset_time
  ON conversation_classification_feedback (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_asset_convo_time
  ON conversation_classification_feedback (asset_id, conversation_id, created_at DESC);
