-- A modal can replace a review while its batch still owns the original ID.
-- Cancellation revokes all unsent members of that durable consent lineage.
CREATE TABLE IF NOT EXISTS film_final_request_review_lineage (
 review_id TEXT PRIMARY KEY REFERENCES film_final_request_reviews(id),
 parent_id TEXT REFERENCES film_final_request_reviews(id),
 root_id TEXT NOT NULL REFERENCES film_final_request_reviews(id)
);
CREATE INDEX IF NOT EXISTS idx_final_request_lineage_root ON film_final_request_review_lineage(root_id);
