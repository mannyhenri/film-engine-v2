CREATE TABLE IF NOT EXISTS film_final_request_reviews (
 id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, snapshot_json TEXT NOT NULL,
 editable_json TEXT NOT NULL, provenance_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'preview',
 request_id TEXT, result_json TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 approved_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
