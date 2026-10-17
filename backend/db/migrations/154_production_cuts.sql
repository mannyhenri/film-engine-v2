-- A CUT: the director's rough edit, made in Production's Cut tab before (or while) footage exists. Picked shots in the
-- order they play, each held for its own length unless the cut says otherwise, and the sounds wired to them. Versions
-- are rows: "Save as new version" copies a cut forward, so v2 is never overwritten by v3.
CREATE TABLE production_cuts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    shot_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(shot_ids)),
    -- { shot_id: ms }: how long a shot plays in THIS cut, when not its own length.
    holds_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(holds_json)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (project_id, name, version)
);
CREATE INDEX idx_production_cuts_project ON production_cuts(project_id, name, version);

-- A sound wired into a cut: it starts at a shot (plus an offset) and either plays its own length or runs to the end of
-- a later shot. The file is optional until one is dropped on it or generated for it.
CREATE TABLE production_cut_sounds (
    id TEXT PRIMARY KEY,
    cut_id TEXT NOT NULL REFERENCES production_cuts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('music', 'sfx', 'ambient', 'dialogue')),
    label TEXT NOT NULL DEFAULT '',
    asset_id TEXT REFERENCES film_assets(id) ON DELETE SET NULL,
    start_shot_id TEXT NOT NULL REFERENCES film_shots(id) ON DELETE CASCADE,
    offset_ms INTEGER NOT NULL DEFAULT 0 CHECK (offset_ms >= 0),
    end_shot_id TEXT REFERENCES film_shots(id) ON DELETE SET NULL,
    gain_db REAL NOT NULL DEFAULT 0,
    fade_in_ms INTEGER NOT NULL DEFAULT 0 CHECK (fade_in_ms >= 0),
    fade_out_ms INTEGER NOT NULL DEFAULT 0 CHECK (fade_out_ms >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_production_cut_sounds_cut ON production_cut_sounds(cut_id, sort_order);
