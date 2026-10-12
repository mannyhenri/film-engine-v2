-- Image finishing jobs keep their upstream handle before polling.
CREATE TABLE film_storyboard_upscale_jobs (
 id TEXT PRIMARY KEY, shot_id TEXT NOT NULL REFERENCES film_shots(id) ON DELETE CASCADE,
 plan_token TEXT NOT NULL UNIQUE, source_asset_id TEXT NOT NULL, source_hash TEXT NOT NULL,
 provider TEXT NOT NULL, resolution TEXT NOT NULL, state TEXT NOT NULL,
 request_id TEXT, result_json TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
