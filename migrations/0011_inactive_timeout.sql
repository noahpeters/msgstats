ALTER TABLE conversations ADD COLUMN final_touch_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN final_touch_sent_at TEXT;
ALTER TABLE conversations ADD COLUMN lost_reason_code TEXT;

ALTER TABLE messages ADD COLUMN message_type TEXT;
ALTER TABLE messages ADD COLUMN message_trigger TEXT;
