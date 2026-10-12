-- Approved semantics and outgoing transport are separate, immutable facts.
-- A row is an HTTP attempt, never evidence of provider acceptance or billing.
CREATE TABLE IF NOT EXISTS film_generation_transport_receipts (
 id TEXT PRIMARY KEY,
 review_id TEXT NOT NULL UNIQUE REFERENCES film_final_request_reviews(id),
 endpoint TEXT NOT NULL, method TEXT NOT NULL,
 body_json TEXT NOT NULL, serialized_body TEXT,
 serialized_base64 TEXT, body_sha256 TEXT NOT NULL,
 references_json TEXT NOT NULL,
 redactions_json TEXT NOT NULL DEFAULT '[]', serialization_exact INTEGER NOT NULL DEFAULT 1,
 sent_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'http_attempt',
 http_status INTEGER, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_generation_transport_review ON film_generation_transport_receipts(review_id);
