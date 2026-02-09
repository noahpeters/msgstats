ALTER TABLE conversations ADD COLUMN blocked_by_recipient INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN blocked_at TEXT;
ALTER TABLE conversations ADD COLUMN bounced_by_provider INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN bounced_at TEXT;

ALTER TABLE conversation_classification_feedback ADD COLUMN followup_is_correct INTEGER NOT NULL DEFAULT 1;
ALTER TABLE conversation_classification_feedback ADD COLUMN followup_correct_due_at INTEGER;
ALTER TABLE conversation_classification_feedback ADD COLUMN followup_notes TEXT;

CREATE INDEX IF NOT EXISTS conversations_blocked_idx
  ON conversations (user_id, blocked_by_recipient, blocked_at);
CREATE INDEX IF NOT EXISTS conversations_bounced_idx
  ON conversations (user_id, bounced_by_provider, bounced_at);
