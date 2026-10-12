-- Six independent face slots. Existing character text and plate assets are untouched.
CREATE TABLE IF NOT EXISTS film_character_expression_slots (
    character_id TEXT NOT NULL REFERENCES film_characters(id) ON DELETE CASCADE,
    slot_id TEXT NOT NULL CHECK (slot_id IN ('slot-1','slot-2','slot-3','slot-4','slot-5','slot-6')),
    label TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT '',
    active_asset_id TEXT REFERENCES film_assets(id) ON DELETE SET NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, slot_id)
);

CREATE TABLE IF NOT EXISTS film_image_handoffs (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL UNIQUE REFERENCES film_final_request_reviews(id),
    fingerprint TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    target_json TEXT NOT NULL,
    source_digest TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','imported','cancelled')),
    result_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
