CREATE TABLE production_composite_nodes (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 node_type TEXT NOT NULL CHECK(node_type IN ('subject-matte','composite')),
 inputs_json TEXT NOT NULL CHECK(json_valid(inputs_json)), source_json TEXT NOT NULL CHECK(json_valid(source_json)),
 settings_json TEXT NOT NULL CHECK(json_valid(settings_json)), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX production_composite_project ON production_composite_nodes(project_id);
CREATE TABLE production_composite_jobs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 node_id TEXT NOT NULL REFERENCES production_composite_nodes(id) ON DELETE CASCADE, node_revision INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','validating','encoding','cancelling','cancelled','complete','failed','interrupted')),
 progress REAL NOT NULL DEFAULT 0 CHECK(progress>=0 AND progress<=1), phase TEXT NOT NULL,
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json)), owner_pid INTEGER NOT NULL, owner_token TEXT NOT NULL,
 error TEXT, created_at TEXT NOT NULL DEFAULT(datetime('now')), finished_at TEXT
);
CREATE UNIQUE INDEX production_composite_one_active ON production_composite_jobs(node_id)
 WHERE status IN ('running','validating','encoding','cancelling');
CREATE TABLE production_composite_versions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 node_id TEXT NOT NULL REFERENCES production_composite_nodes(id) ON DELETE CASCADE,
 job_id TEXT NOT NULL UNIQUE REFERENCES production_composite_jobs(id), version INTEGER NOT NULL CHECK(version>0),
 assets_json TEXT NOT NULL CHECK(json_valid(assets_json)), metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
 created_at TEXT NOT NULL DEFAULT(datetime('now')), UNIQUE(node_id,version)
);
CREATE TABLE production_composite_handoffs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES film_projects(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES production_composite_versions(id) ON DELETE CASCADE,
 directory TEXT NOT NULL, manifest_sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
