CREATE TABLE IF NOT EXISTS lead_ads_leads (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  form_id TEXT,
  ad_id TEXT,
  created_time TEXT,
  field_data TEXT,
  raw TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS ads_cache (
  user_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  ad_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  thumbnail_url TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, ad_id)
);

CREATE TABLE IF NOT EXISTS lead_sync_states (
  user_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  last_lead_time TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, page_id, form_id)
);

CREATE INDEX IF NOT EXISTS lead_ads_leads_page_idx ON lead_ads_leads (user_id, page_id, created_time);
CREATE INDEX IF NOT EXISTS ads_cache_campaign_idx ON ads_cache (user_id, campaign_id);
