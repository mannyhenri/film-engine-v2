-- GRD-4671: per-scene writing readiness, separate from film_scenes.status (the production stage).
-- A readiness row holds only for the full scene text it was given to (fingerprint); lib/scene-writing.js
-- reads it against the current Fountain, so a scene with no row, or whose text moved on, is Draft.
CREATE TABLE film_scene_writing_status (
 scene_id TEXT PRIMARY KEY REFERENCES film_scenes(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewing','production_ready')),
 fingerprint TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Every transition and every automatic reset, with the fingerprint it applied to. Never updated.
CREATE TABLE film_scene_writing_events (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 scene_id TEXT NOT NULL REFERENCES film_scenes(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('transition','auto_reset')),
 fingerprint TEXT, prior_fingerprint TEXT,
 prior_status TEXT NOT NULL CHECK(prior_status IN ('draft','reviewing','production_ready')),
 new_status TEXT NOT NULL CHECK(new_status IN ('draft','reviewing','production_ready')),
 actor TEXT NOT NULL, reason TEXT, idempotency_key TEXT, request_hash TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
);
CREATE UNIQUE INDEX idx_scene_writing_events_key ON film_scene_writing_events(project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_scene_writing_events_scene ON film_scene_writing_events(scene_id);
