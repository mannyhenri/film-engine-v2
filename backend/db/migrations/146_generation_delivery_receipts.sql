-- Provider completion is separate from local delivery. Keep the accepted
-- output and use a recoverable ownership lease until its original target is filed.
ALTER TABLE film_generation_jobs ADD COLUMN result_json TEXT;
ALTER TABLE film_generation_jobs ADD COLUMN delivered_json TEXT;
ALTER TABLE film_generation_jobs ADD COLUMN collection_token TEXT;
ALTER TABLE film_generation_jobs ADD COLUMN collection_claimed_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_generation_delivery
ON film_assets(json_extract(metadata,'$.generation_job_id'))
WHERE json_valid(metadata) AND json_extract(metadata,'$.generation_job_id') IS NOT NULL;

-- The existing idx_usage_source already enforces unique non-null source_ref;
-- generation receipt retries reuse that event rather than adding another.
