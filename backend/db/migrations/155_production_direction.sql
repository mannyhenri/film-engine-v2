-- DIRECTION: what the director sets in Production's Direct studio, kept apart from the scene card it starts from.
-- One row per shot (owner 'shot:<id>': performance, camera moves, the lines as this take speaks them, sounds, light)
-- and one per film (owner 'studio': the picked shots, sequence order and transitions, the sound bed, the notation).
-- The scene card is never rewritten from here except by an explicit "also update the screenplay" (PUT /shots/:id).
CREATE TABLE production_directions (
    project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, owner)
);
