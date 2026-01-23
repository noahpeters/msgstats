CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  page_id TEXT NOT NULL,
  ig_business_id TEXT,
  updated_time TEXT NOT NULL,
  customer_count INTEGER NOT NULL,
  business_count INTEGER NOT NULL
);
