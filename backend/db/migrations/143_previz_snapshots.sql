-- Immutable captured setups. Result pointers can change; source JSON and its digest cannot.
CREATE TABLE IF NOT EXISTS film_previz_snapshots (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 shot_id TEXT NOT NULL REFERENCES film_shots(id) ON DELETE CASCADE,
 snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL, preview_path TEXT NOT NULL,
 preview_sha256 TEXT NOT NULL, draft_asset_id TEXT, render_asset_id TEXT,
 job_state TEXT NOT NULL DEFAULT 'draft', job_error TEXT, active_review_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER IF NOT EXISTS film_previz_snapshot_immutable
BEFORE UPDATE OF project_id,shot_id,snapshot_json,snapshot_hash,preview_path,preview_sha256 ON film_previz_snapshots
BEGIN SELECT RAISE(ABORT,'Previz source snapshots are immutable'); END;
