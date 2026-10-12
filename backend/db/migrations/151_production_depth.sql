-- Processing state and typed depth assets are independent of screenplay/shot edits.
CREATE TABLE production_depth_nodes (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 source_asset_id TEXT NOT NULL REFERENCES film_assets(id),
 source_json TEXT NOT NULL CHECK(json_valid(source_json)),
 settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX production_depth_project ON production_depth_nodes(project_id);
CREATE TABLE production_depth_jobs (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 node_id TEXT NOT NULL REFERENCES production_depth_nodes(id) ON DELETE CASCADE,
 node_revision INTEGER NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('preview','full')),
 status TEXT NOT NULL CHECK(status IN ('running','validating','encoding','cancelling','cancelled','complete','failed','interrupted')),
 progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 1),
 phase TEXT NOT NULL DEFAULT 'Starting',
 request_json TEXT NOT NULL CHECK(json_valid(request_json)),
 backend_json TEXT NOT NULL CHECK(json_valid(backend_json)),
 owner_pid INTEGER NOT NULL,
 owner_token TEXT NOT NULL,
 error TEXT,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 finished_at TEXT
);
CREATE UNIQUE INDEX production_depth_one_active ON production_depth_jobs(node_id)
 WHERE status IN ('running','validating','encoding','cancelling');
CREATE TABLE production_depth_versions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 node_id TEXT NOT NULL REFERENCES production_depth_nodes(id) ON DELETE CASCADE,
 job_id TEXT NOT NULL UNIQUE REFERENCES production_depth_jobs(id),
 version INTEGER NOT NULL CHECK(version > 0),
 mode TEXT NOT NULL CHECK(mode IN ('preview','full')),
 raw_asset_id TEXT NOT NULL REFERENCES film_assets(id),
 preview_asset_id TEXT NOT NULL REFERENCES film_assets(id),
 manifest_asset_id TEXT NOT NULL REFERENCES film_assets(id),
 metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(node_id,version)
);
