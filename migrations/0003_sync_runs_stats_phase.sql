ALTER TABLE sync_runs
ADD COLUMN stats_status TEXT;

ALTER TABLE sync_runs
ADD COLUMN stats_started_at TEXT;

ALTER TABLE sync_runs
ADD COLUMN stats_finished_at TEXT;

ALTER TABLE sync_runs
ADD COLUMN stats_error TEXT;
