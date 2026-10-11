-- Scene placement is editorial workspace state; it never changes shot order.
ALTER TABLE production_group_layout ADD COLUMN x REAL;
ALTER TABLE production_group_layout ADD COLUMN y REAL;
ALTER TABLE production_group_layout ADD COLUMN w REAL CHECK (w IS NULL OR w > 0);
ALTER TABLE production_group_layout ADD COLUMN h REAL CHECK (h IS NULL OR h > 0);

-- Mutable recipes are deliberately separate from generation origins/receipts.
CREATE TABLE production_node_drafts (
    project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    source_asset_id TEXT REFERENCES film_assets(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, node_key)
);

-- These are independent edit tracks, never video conditioning references.
-- Files remain whole; trim/offset/gain/mute describe an explicit timeline edit.
CREATE TABLE production_audio_tracks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    shot_id TEXT REFERENCES film_shots(id) ON DELETE CASCADE,
    sequence_id TEXT REFERENCES film_sequences(id) ON DELETE CASCADE,
    asset_id TEXT REFERENCES film_assets(id) ON DELETE SET NULL,
    source_snapshot_json TEXT NOT NULL CHECK (json_valid(source_snapshot_json)),
    offset_ms INTEGER NOT NULL DEFAULT 0,
    source_in_ms INTEGER NOT NULL DEFAULT 0 CHECK (source_in_ms >= 0),
    duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
    gain_db REAL NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((shot_id IS NOT NULL) != (sequence_id IS NOT NULL))
);
CREATE INDEX idx_production_audio_owner ON production_audio_tracks(project_id, node_key, sort_order);
