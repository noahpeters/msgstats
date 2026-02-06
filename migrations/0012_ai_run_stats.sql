ALTER TABLE sync_runs
ADD COLUMN ai_stats_json TEXT;

ALTER TABLE sync_runs
ADD COLUMN ai_config_json TEXT;
